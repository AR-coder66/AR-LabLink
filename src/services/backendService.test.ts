import { describe, it, expect, beforeEach } from 'vitest';
import { backendService } from './backendService';
import { INITIAL_USERS, INITIAL_EQUIPMENT } from '../data/mockData';
import { SecurityGuard } from '../utils/security';
import { calculatePriorityScore, findAlternativeSlotAndEquipment } from '../utils/aiScheduler';

describe('LabLink Backend & Security Audit Tests', () => {
  const student = INITIAL_USERS[0]; // Aarav Sharma (student)
  const student2 = INITIAL_USERS[1]; // Priya Venkatesh (student)
  const faculty = INITIAL_USERS[2]; // Dr. Evelyn Reed (faculty)
  const admin = INITIAL_USERS[3]; // Marcus Vance (admin)

  beforeEach(() => {
    backendService.resetAll();
  });

  // 1. User Registration & Login
  it('authenticates user and returns matching role profile', () => {
    const authStudent = backendService.authenticateUser('student');
    expect(authStudent.role).toBe('student');
    expect(authStudent.email).toBeDefined();

    const authFaculty = backendService.authenticateUser('faculty');
    expect(authFaculty.role).toBe('faculty');
  });

  // 2. Role-Based Access Control (RBAC) Enforcement
  it('prevents students from approving or rejecting bookings (RBAC)', () => {
    const res = backendService.updateBookingStatus(student, 'bk-101', 'approved');
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('FORBIDDEN');
  });

  it('allows faculty and administrator to approve bookings', () => {
    const res = backendService.updateBookingStatus(faculty, 'bk-101', 'approved', 'Authorized for thesis');
    expect(res.success).toBe(true);
    expect(res.data?.status).toBe('approved');
  });

  // 3. Equipment Discovery & Filtering
  it('filters equipment accurately by category, department, and search terms', () => {
    const all = backendService.getEquipmentList();
    expect(all.length).toBeGreaterThanOrEqual(16);

    const roboticsOnly = backendService.getEquipmentList({ category: 'Robotics' });
    expect(roboticsOnly.every((e) => e.category === 'Robotics')).toBe(true);

    const searchH100 = backendService.getEquipmentList({ search: 'H100' });
    expect(searchH100.length).toBeGreaterThan(0);
    expect(searchH100[0].name).toContain('H100');
  });

  // 4. Equipment Availability & Status
  it('reflects equipment status and flags equipment under maintenance', () => {
    const list = backendService.getEquipmentList();
    const maintenanceEquip = list.find((e) => e.status === 'maintenance');
    expect(maintenanceEquip).toBeDefined();
  });

  // 5. Booking Creation
  it('allows student to create a valid booking request', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);
    const dateStr = tomorrow.toISOString().split('T')[0];

    const res = backendService.requestBooking(student, {
      equipmentId: 'eq-2', // KUKA Arm
      date: dateStr,
      startTime: '09:00',
      endTime: '12:00',
      durationHours: 3,
      purpose: 'Autonomous trajectory planning validation',
    });

    expect(res.success).toBe(true);
    expect(res.data?.booking.status).toBe('pending');
    expect(res.data?.booking.userId).toBe(student.id);
  });

  // 6. Double-Booking Prevention & 7. Overlapping Time-Slot Detection
  it('detects concurrent overlapping slots on the same equipment and triggers AI Conflict Resolver', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);
    const dateStr = tomorrow.toISOString().split('T')[0];

    // Student 1 books 10:00 - 13:00 on eq-1
    const res1 = backendService.requestBooking(student, {
      equipmentId: 'eq-1',
      date: dateStr,
      startTime: '10:00',
      endTime: '13:00',
      durationHours: 3,
      projectId: 'proj-2',
      purpose: 'LLM fine-tuning benchmark for capstone jury',
    });
    expect(res1.success).toBe(true);
    expect(res1.data?.hasConflict).toBe(false);

    // Student 2 attempts to concurrently book the exact same slot 10:00 - 13:00 on eq-1
    const res2 = backendService.requestBooking(student2, {
      equipmentId: 'eq-1',
      date: dateStr,
      startTime: '10:00',
      endTime: '13:00',
      durationHours: 3,
      projectId: 'proj-1',
      purpose: 'Quadruped simulation policy training',
    });

    expect(res2.success).toBe(true);
    expect(res2.data?.hasConflict).toBe(true);

    const conflicts = backendService.getConflicts();
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].contenders.length).toBe(2);
  });

  // 8. Booking Cancellation
  it('allows owner to cancel their own booking, but forbids another student', () => {
    const myBookings = backendService.getBookings(student);
    if (myBookings.length > 0) {
      const targetId = myBookings[0].id;
      // student2 attempts to cancel student1's booking
      const failRes = backendService.cancelBooking(student2, targetId);
      expect(failRes.success).toBe(false);
      expect(failRes.errorCode).toBe('FORBIDDEN');

      // student1 cancels their own booking
      const successRes = backendService.cancelBooking(student, targetId);
      expect(successRes.success).toBe(true);
    }
  });

  // 9. Faculty Approval & Rejection
  it('allows faculty supervisor to reject a booking with academic remarks', () => {
    const res = backendService.updateBookingStatus(faculty, 'bk-102', 'rejected', 'Prerequisite lab training incomplete');
    expect(res.success).toBe(true);
    expect(res.data?.status).toBe('rejected');
    expect(res.data?.facultyRemarks).toContain('Prerequisite');
  });

  // 10. Project Access Requests
  it('creates and registers project-based access requests with academic priorities', () => {
    const res = backendService.addProject(student, {
      title: 'Real-time Autonomous Vehicle Perception',
      description: 'Developing high-speed stereo vision algorithms for micro-mobility',
      department: 'Computer Science & AI',
      leadStudentId: student.id,
      leadStudentName: student.name,
      teamMembers: [student.name],
      deadline: '2026-12-15',
      academicPriority: 'Critical',
      academicPurpose: 'Capstone Final Year',
      requiredEquipmentIds: ['eq-1', 'eq-5'],
      facultySupervisor: 'Dr. Evelyn Reed',
    });

    expect(res.success).toBe(true);
    expect(res.data?.academicPriority).toBe('Critical');
  });

  // 11. AI Conflict Resolution & Deterministic Scoring
  it('calculates deterministic priority score giving higher score to imminent deadlines', () => {
    const eq = INITIAL_EQUIPMENT[0];
    const projects = backendService.getProjects();
    const urgentProj = projects.find((p) => p.deadline === '2026-11-25');
    const laterProj = projects.find((p) => p.deadline === '2026-11-28');

    const evalUrgent = calculatePriorityScore(urgentProj, eq, 2, '2026-11-23');
    const evalLater = calculatePriorityScore(laterProj, eq, 4, '2026-11-23');

    expect(evalUrgent.priorityScore).toBeGreaterThan(evalLater.priorityScore);
    expect(evalUrgent.scoreBreakdown.deadlineScore).toBeGreaterThan(evalLater.scoreBreakdown.deadlineScore);
  });

  // 12. Alternative Slot Recommendations
  it('generates zero-waste alternative equipment and slot recommendations', () => {
    const eq1 = INITIAL_EQUIPMENT[0]; // NVIDIA H100
    const allEq = INITIAL_EQUIPMENT;
    const bookings = backendService.getBookings(admin);

    const alt = findAlternativeSlotAndEquipment(eq1, allEq, bookings, '2026-11-24', '10:00', 3);
    expect(alt.alternativeSlot).toBeDefined();
    expect(alt.alternativeEquipmentId).toBeDefined();
  });

  // 13. Equipment Maintenance Restrictions
  it('strictly blocks booking requests on equipment flagged for maintenance', () => {
    const list = backendService.getEquipmentList();
    const maintEq = list.find((e) => e.status === 'maintenance');
    expect(maintEq).toBeDefined();

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);

    const res = backendService.requestBooking(student, {
      equipmentId: maintEq!.id,
      date: tomorrow.toISOString().split('T')[0],
      startTime: '10:00',
      endTime: '12:00',
      durationHours: 2,
      purpose: 'Attempting to book maintenance unit',
    });

    expect(res.success).toBe(false);
    expect(res.message).toContain('offline under maintenance');
  });

  // 14. Invalid Form Submissions & Input Validation
  it('rejects invalid dates in the past and malformed times', () => {
    const resPast = backendService.requestBooking(student, {
      equipmentId: 'eq-1',
      date: '2020-01-01', // past date
      startTime: '10:00',
      endTime: '12:00',
      durationHours: 2,
      purpose: 'Testing past date rejection',
    });
    expect(resPast.success).toBe(false);

    const resDuration = backendService.requestBooking(student, {
      equipmentId: 'eq-1',
      date: '2026-12-01',
      startTime: '10:00',
      endTime: '22:00',
      durationHours: 12, // exceeds maxBookingHours of 6
      purpose: 'Testing duration limit',
    });
    expect(resDuration.success).toBe(false);
    expect(resDuration.message).toContain('exceeds max allowed');
  });

  // 15. Security Sanitization & XSS Protection
  it('sanitizes malicious script tags in input text fields', () => {
    const maliciousPayload = '<script>alert("xss")</script> Research on AI';
    const sanitized = SecurityGuard.sanitizeString(maliciousPayload);
    expect(sanitized).not.toContain('<script>');
    expect(sanitized).toContain('&lt;script&gt;');
  });

  // 16. Admin Authorization for Equipment Commissioning
  it('prevents non-admins from adding new equipment into university registry', () => {
    const res = backendService.addEquipment(student as any, {
      name: 'Unauthorized Supercomputer',
      resourceId: 'SUPER-01',
      category: 'Computing & GPU Workstations',
      department: 'Computer Science & AI',
      location: 'Basement',
      status: 'available',
      maxBookingHours: 4,
      specs: {},
      image: '',
      description: 'Test',
      supervisor: 'Unknown',
    });
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('FORBIDDEN');
  });
});

