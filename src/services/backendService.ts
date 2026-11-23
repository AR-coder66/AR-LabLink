import { User, Equipment, Booking, Project, ConflictScenario, MaintenanceReport, NotificationItem, Role, WaitlistEntry } from '../types';
import { SecurityGuard } from '../utils/security';
import { calculatePriorityScore, findAlternativeSlotAndEquipment } from '../utils/aiScheduler';
import {
  INITIAL_USERS,
  INITIAL_EQUIPMENT,
  INITIAL_PROJECTS,
  INITIAL_BOOKINGS,
  INITIAL_CONFLICTS,
  INITIAL_MAINTENANCE,
  INITIAL_NOTIFICATIONS,
} from '../data/mockData';

export interface BackendResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  errorCode?: 'UNAUTHORIZED' | 'FORBIDDEN' | 'BAD_REQUEST' | 'CONFLICT' | 'NOT_FOUND';
}

/**
 * Backend Simulation Controller
 * Enforces server-side authentication, RBAC authorization, and state consistency.
 */
export class BackendService {
  private users: User[] = [...INITIAL_USERS];
  private equipment: Equipment[] = [...INITIAL_EQUIPMENT];
  private projects: Project[] = [...INITIAL_PROJECTS];
  private bookings: Booking[] = [...INITIAL_BOOKINGS];
  private conflicts: ConflictScenario[] = [...INITIAL_CONFLICTS];
  private maintenance: MaintenanceReport[] = [...INITIAL_MAINTENANCE];
  private notifications: NotificationItem[] = [...INITIAL_NOTIFICATIONS];
  private waitlist: WaitlistEntry[] = [];

  constructor() {
    this.loadState();
  }

  private loadState() {
    try {
      const savedBookings = localStorage.getItem('lablink_backend_bookings');
      if (savedBookings) this.bookings = JSON.parse(savedBookings);

      const savedEquipment = localStorage.getItem('lablink_backend_equipment');
      if (savedEquipment) this.equipment = JSON.parse(savedEquipment);

      const savedConflicts = localStorage.getItem('lablink_backend_conflicts');
      if (savedConflicts) this.conflicts = JSON.parse(savedConflicts);

      const savedProjects = localStorage.getItem('lablink_backend_projects');
      if (savedProjects) this.projects = JSON.parse(savedProjects);
    } catch {
      // fallback to initial
    }
  }

  private persistState() {
    try {
      localStorage.setItem('lablink_backend_bookings', JSON.stringify(this.bookings));
      localStorage.setItem('lablink_backend_equipment', JSON.stringify(this.equipment));
      localStorage.setItem('lablink_backend_conflicts', JSON.stringify(this.conflicts));
      localStorage.setItem('lablink_backend_projects', JSON.stringify(this.projects));
    } catch {
      // ignore
    }
  }

  // --- AUTHENTICATION & RBAC ---
  public authenticateUser(role: Role): User {
    const user = this.users.find((u) => u.role === role);
    return user || this.users[0];
  }

  public verifyRole(user: User, allowedRoles: Role[]): boolean {
    return allowedRoles.includes(user.role);
  }

  // --- QUERY APIS ---
  public getEquipmentList(filter?: { category?: string; department?: string; status?: string; search?: string }): Equipment[] {
    let result = [...this.equipment];

    if (filter?.category && filter.category !== 'all') {
      result = result.filter((e) => e.category === filter.category);
    }
    if (filter?.department && filter.department !== 'all') {
      result = result.filter((e) => e.department === filter.department);
    }
    if (filter?.status && filter.status !== 'all') {
      result = result.filter((e) => e.status === filter.status);
    }
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      result = result.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.resourceId.toLowerCase().includes(q) ||
          e.location.toLowerCase().includes(q) ||
          Object.values(e.specs).some((s) => s.toLowerCase().includes(q))
      );
    }
    return result;
  }

  public getBookings(user: User): Booking[] {
    // If student, only their own bookings; if faculty or admin, all bookings
    if (user.role === 'student') {
      return this.bookings.filter((b) => b.userId === user.id);
    }
    return [...this.bookings];
  }

  public getProjects(): Project[] {
    return [...this.projects];
  }

  public getConflicts(): ConflictScenario[] {
    return [...this.conflicts];
  }

  public getMaintenanceReports(): MaintenanceReport[] {
    return [...this.maintenance];
  }

  // --- BOOKING OPERATIONS WITH STRICT SERVER RULES ---
  public requestBooking(
    actor: User,
    data: {
      equipmentId: string;
      date: string;
      startTime: string;
      endTime: string;
      durationHours: number;
      projectId?: string;
      purpose: string;
    }
  ): BackendResponse<{ booking: Booking; hasConflict: boolean }> {
    // 1. RBAC check
    if (!this.verifyRole(actor, ['student', 'faculty', 'admin'])) {
      return { success: false, message: 'Unauthorized role', errorCode: 'FORBIDDEN' };
    }

    // 2. Input validation
    const dateCheck = SecurityGuard.isValidBookingDate(data.date);
    if (!dateCheck.valid) {
      return { success: false, message: dateCheck.reason || 'Invalid date', errorCode: 'BAD_REQUEST' };
    }

    if (!SecurityGuard.isValidTime(data.startTime) || !SecurityGuard.isValidTime(data.endTime)) {
      return { success: false, message: 'Invalid time format', errorCode: 'BAD_REQUEST' };
    }

    const sanitizedPurpose = SecurityGuard.sanitizeString(data.purpose);
    if (!sanitizedPurpose || sanitizedPurpose.length < 5) {
      return { success: false, message: 'Academic purpose description too short (minimum 5 characters)', errorCode: 'BAD_REQUEST' };
    }

    // 3. Equipment check
    const eq = this.equipment.find((e) => e.id === data.equipmentId);
    if (!eq) {
      return { success: false, message: 'Target equipment not found', errorCode: 'NOT_FOUND' };
    }

    if (eq.status === 'maintenance') {
      return {
        success: false,
        message: `Equipment is offline under maintenance: ${eq.maintenanceNote || 'Service in progress'}`,
        errorCode: 'BAD_REQUEST',
      };
    }

    if (data.durationHours > eq.maxBookingHours) {
      return {
        success: false,
        message: `Duration (${data.durationHours}h) exceeds max allowed slot of ${eq.maxBookingHours}h`,
        errorCode: 'BAD_REQUEST',
      };
    }

    // 4. Overlap & Conflict Check
    const isOverlapping = (s1: string, e1: string, s2: string, e2: string) => {
      const n1 = parseInt(s1.replace(':', ''), 10);
      const n2 = parseInt(e1.replace(':', ''), 10);
      const n3 = parseInt(s2.replace(':', ''), 10);
      const n4 = parseInt(e2.replace(':', ''), 10);
      return Math.max(n1, n3) < Math.min(n2, n4);
    };

    const existingOverlaps = this.bookings.filter(
      (b) =>
        b.equipmentId === data.equipmentId &&
        b.date === data.date &&
        b.status !== 'rejected' &&
        b.status !== 'cancelled' &&
        isOverlapping(b.startTime, b.endTime, data.startTime, data.endTime)
    );

    const project = this.projects.find((p) => p.id === data.projectId);
    const pastBookings = this.bookings.filter((b) => b.userId === actor.id).length;
    const aiPriority = calculatePriorityScore(project, eq, pastBookings, data.date);

    const newBookingId = `bk-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const newBooking: Booking = {
      id: newBookingId,
      equipmentId: data.equipmentId,
      userId: actor.id,
      userName: actor.name,
      userRole: actor.role,
      userDepartment: actor.department,
      projectId: project?.id,
      projectTitle: project?.title || 'Independent Academic Research',
      date: data.date,
      startTime: data.startTime,
      endTime: data.endTime,
      durationHours: data.durationHours,
      purpose: sanitizedPurpose,
      status: 'pending',
      createdAt: new Date().toISOString(),
      priorityScore: aiPriority.priorityScore,
      qrCode: `LL-PASS-${newBookingId}-${eq.resourceId}`,
    };

    this.bookings.unshift(newBooking);

    // If an overlap is present, dispatch to AI Conflict Resolver
    if (existingOverlaps.length > 0) {
      const incumbent = existingOverlaps[0];
      const conflictId = `conf-${Date.now()}`;

      const newIsHigher = aiPriority.priorityScore > (incumbent.priorityScore || 80);
      const recommendedWinnerId = newIsHigher ? newBookingId : incumbent.id;

      const altInfo = findAlternativeSlotAndEquipment(
        eq,
        this.equipment,
        this.bookings,
        data.date,
        data.startTime,
        data.durationHours
      );

      const conflict: ConflictScenario = {
        id: conflictId,
        equipmentId: eq.id,
        equipmentName: eq.name,
        date: data.date,
        timeSlot: `${data.startTime} - ${data.endTime}`,
        contenders: [
          {
            bookingId: incumbent.id,
            teamName: incumbent.userName,
            studentName: incumbent.userName,
            studentId: incumbent.userId,
            projectTitle: incumbent.projectTitle,
            projectDeadline: 'Project Linked',
            academicImportance: 'Critical',
            requestedSlot: `${incumbent.startTime} - ${incumbent.endTime}`,
            durationHours: incumbent.durationHours,
            previousUsageHours: 6,
            priorityScore: incumbent.priorityScore || 85,
            scoreBreakdown: {
              deadlineScore: 32,
              importanceScore: 25,
              fairnessScore: 18,
              academicNeedScore: 10,
            },
          },
          {
            bookingId: newBookingId,
            teamName: actor.name,
            studentName: actor.name,
            studentId: actor.id,
            projectTitle: newBooking.projectTitle,
            projectDeadline: project ? project.deadline : 'Standard',
            academicImportance: project?.academicPriority || 'High',
            requestedSlot: `${data.startTime} - ${data.endTime}`,
            durationHours: data.durationHours,
            previousUsageHours: pastBookings * 3,
            priorityScore: aiPriority.priorityScore,
            scoreBreakdown: aiPriority.scoreBreakdown,
          },
        ],
        recommendedWinnerId,
        aiExplanation: `LabLink AI evaluated 7 mathematical scheduling criteria. ${
          newIsHigher ? actor.name : incumbent.userName
        } was prioritized (Score: ${Math.max(aiPriority.priorityScore, incumbent.priorityScore || 85)}) based on submission urgency and campus fairness ratios. Compatible alternative equipment and open slots have been computed for the secondary contender.`,
        suggestedAlternative: {
          bookingId: newIsHigher ? incumbent.id : newBookingId,
          alternativeSlot: altInfo.alternativeSlot,
          alternativeEquipmentId: altInfo.alternativeEquipmentId,
          alternativeEquipmentName: altInfo.alternativeEquipmentName,
        },
      };

      this.conflicts.unshift(conflict);
      this.persistState();

      return {
        success: true,
        message: 'Concurrent slot contention detected. LabLink AI Conflict Resolver has scored priority and forwarded to faculty review.',
        data: { booking: newBooking, hasConflict: true },
      };
    }

    this.persistState();
    return {
      success: true,
      message: 'Booking request logged successfully! Awaiting supervisor sign-off.',
      data: { booking: newBooking, hasConflict: false },
    };
  }

  // --- CANCELLATION ---
  public cancelBooking(actor: User, bookingId: string): BackendResponse<null> {
    const booking = this.bookings.find((b) => b.id === bookingId);
    if (!booking) {
      return { success: false, message: 'Booking not found', errorCode: 'NOT_FOUND' };
    }

    // Only creator or faculty/admin can cancel
    if (actor.role === 'student' && booking.userId !== actor.id) {
      return { success: false, message: 'Cannot cancel another student’s booking', errorCode: 'FORBIDDEN' };
    }

    booking.status = 'cancelled';
    this.persistState();
    return { success: true, message: 'Booking successfully cancelled' };
  }

  // --- FACULTY APPROVAL & OVERRIDE ACTIONS (STRICT RBAC) ---
  public updateBookingStatus(
    actor: User,
    bookingId: string,
    status: 'approved' | 'rejected',
    remarks?: string
  ): BackendResponse<Booking> {
    // SECURITY: Students MUST NOT approve or reject bookings
    if (!this.verifyRole(actor, ['faculty', 'admin'])) {
      return {
        success: false,
        message: 'Access Denied: Only faculty supervisors or lab administrators can approve or reject bookings.',
        errorCode: 'FORBIDDEN',
      };
    }

    const booking = this.bookings.find((b) => b.id === bookingId);
    if (!booking) {
      return { success: false, message: 'Booking not found', errorCode: 'NOT_FOUND' };
    }

    booking.status = status;
    booking.facultyRemarks = SecurityGuard.sanitizeString(remarks || '');
    this.persistState();

    return { success: true, message: `Booking marked as ${status}`, data: booking };
  }

  public resolveConflict(
    actor: User,
    conflictId: string,
    approvedBookingId: string,
    overridden: boolean,
    reason: string
  ): BackendResponse<ConflictScenario> {
    // SECURITY: Only faculty or admin can resolve disputes
    if (!this.verifyRole(actor, ['faculty', 'admin'])) {
      return {
        success: false,
        message: 'Access Denied: Conflict resolution requires Faculty or Administrator credentials.',
        errorCode: 'FORBIDDEN',
      };
    }

    const conflict = this.conflicts.find((c) => c.id === conflictId);
    if (!conflict) {
      return { success: false, message: 'Conflict scenario not found', errorCode: 'NOT_FOUND' };
    }

    const cleanReason = SecurityGuard.sanitizeString(reason);
    conflict.facultyDecision = {
      approvedBookingId,
      overridden,
      reason: cleanReason,
      decidedAt: new Date().toISOString(),
      facultyName: actor.name,
    };

    // Update the winning booking
    const winner = this.bookings.find((b) => b.id === approvedBookingId);
    if (winner) {
      winner.status = 'approved';
      winner.facultyRemarks = `Approved via ${overridden ? 'Faculty Override' : 'AI Priority Resolution'}: ${cleanReason}`;
    }

    // Reassign / reject the losing contender
    const loserContender = conflict.contenders.find((c) => c.bookingId !== approvedBookingId);
    if (loserContender) {
      const loserBooking = this.bookings.find((b) => b.id === loserContender.bookingId);
      if (loserBooking) {
        loserBooking.status = 'rejected';
        loserBooking.facultyRemarks = `Slot reassigned to peer team with higher deadline urgency. Suggested alternative: ${conflict.suggestedAlternative.alternativeSlot}`;
      }
    }

    this.persistState();
    return { success: true, message: 'Conflict successfully arbitrated and bookings updated', data: conflict };
  }

  // --- ADMIN ACTIONS (STRICT RBAC) ---
  public addEquipment(actor: User, equipmentData: Omit<Equipment, 'id' | 'totalBookings' | 'qrToken'>): BackendResponse<Equipment> {
    if (!this.verifyRole(actor, ['admin'])) {
      return { success: false, message: 'Unauthorized: Only Lab Administrators can commission equipment.', errorCode: 'FORBIDDEN' };
    }

    const newEq: Equipment = {
      ...equipmentData,
      id: `eq-${Date.now()}`,
      name: SecurityGuard.sanitizeString(equipmentData.name),
      resourceId: SecurityGuard.sanitizeString(equipmentData.resourceId),
      totalBookings: 0,
      qrToken: `LL-QR-${equipmentData.resourceId}`,
    };

    this.equipment.push(newEq);
    this.persistState();
    return { success: true, message: 'Equipment commissioned into campus registry', data: newEq };
  }

  public updateEquipmentStatus(actor: User, equipmentId: string, status: Equipment['status'], note?: string): BackendResponse<Equipment> {
    if (!this.verifyRole(actor, ['admin', 'faculty'])) {
      return { success: false, message: 'Unauthorized: Status changes require faculty or admin credentials', errorCode: 'FORBIDDEN' };
    }

    const eq = this.equipment.find((e) => e.id === equipmentId);
    if (!eq) {
      return { success: false, message: 'Equipment not found', errorCode: 'NOT_FOUND' };
    }

    eq.status = status;
    if (note !== undefined) {
      eq.maintenanceNote = SecurityGuard.sanitizeString(note);
    }
    this.persistState();
    return { success: true, message: `Status updated to ${status}`, data: eq };
  }

  // --- PROJECT MANAGEMENT ---
  public addProject(actor: User, projectData: Omit<Project, 'id' | 'createdAt' | 'status'>): BackendResponse<Project> {
    const cleanTitle = SecurityGuard.sanitizeString(projectData.title);
    const cleanDesc = SecurityGuard.sanitizeString(projectData.description);

    if (!cleanTitle || cleanTitle.length < 5) {
      return { success: false, message: 'Project title must be at least 5 characters', errorCode: 'BAD_REQUEST' };
    }

    const newProj: Project = {
      ...projectData,
      id: `proj-${Date.now()}`,
      title: cleanTitle,
      description: cleanDesc,
      leadStudentId: actor.id,
      leadStudentName: actor.name,
      createdAt: new Date().toISOString().split('T')[0],
      status: 'active',
    };

    this.projects.push(newProj);
    this.persistState();
    return { success: true, message: 'Academic project portfolio registered', data: newProj };
  }

  // --- RESET STATE ---
  public resetAll() {
    this.users = [...INITIAL_USERS];
    this.equipment = [...INITIAL_EQUIPMENT];
    this.projects = [...INITIAL_PROJECTS];
    this.bookings = [...INITIAL_BOOKINGS];
    this.conflicts = [...INITIAL_CONFLICTS];
    this.maintenance = [...INITIAL_MAINTENANCE];
    this.notifications = [...INITIAL_NOTIFICATIONS];
    this.waitlist = [];
    localStorage.clear();
  }
}

export const backendService = new BackendService();

