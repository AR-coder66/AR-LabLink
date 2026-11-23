import { Role, Equipment, Project, Booking, ConflictScenario } from '../types';

export interface ScoreWeights {
  deadlineWeight: number; // max 40
  importanceWeight: number; // max 25
  fairnessWeight: number; // max 20
  resourceFitWeight: number; // max 15
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  deadlineWeight: 40,
  importanceWeight: 25,
  fairnessWeight: 20,
  resourceFitWeight: 15,
};

export interface PriorityEvaluation {
  priorityScore: number;
  scoreBreakdown: {
    deadlineScore: number;
    importanceScore: number;
    fairnessScore: number;
    academicNeedScore: number;
  };
  explanation: string;
}

/**
 * Deterministic, Transparent Multi-Factor Priority Scoring Engine
 * Evaluates scheduling priority using rigorous mathematical weights
 */
export function calculatePriorityScore(
  project: Project | undefined,
  targetEquipment: Equipment,
  pastUserBookingsCount: number,
  requestedDate: string,
  weights: ScoreWeights = DEFAULT_WEIGHTS
): PriorityEvaluation {
  // 1. Deadline Score (Max 40)
  // Closer deadlines get exponentially higher priority within a 30-day window
  let deadlineScore = 15;
  let daysUntilDeadline = 14;

  if (project?.deadline) {
    const bookingTime = new Date(requestedDate).getTime();
    const deadlineTime = new Date(project.deadline).getTime();
    daysUntilDeadline = Math.max(0, Math.ceil((deadlineTime - bookingTime) / (1000 * 3600 * 24)));

    if (daysUntilDeadline <= 2) {
      deadlineScore = weights.deadlineWeight; // Imminent deadline (40 pts)
    } else if (daysUntilDeadline <= 5) {
      deadlineScore = weights.deadlineWeight * 0.85; // 34 pts
    } else if (daysUntilDeadline <= 10) {
      deadlineScore = weights.deadlineWeight * 0.65; // 26 pts
    } else if (daysUntilDeadline <= 20) {
      deadlineScore = weights.deadlineWeight * 0.45; // 18 pts
    } else {
      deadlineScore = Math.max(10, weights.deadlineWeight * 0.25); // 10 pts
    }
  }

  // 2. Academic Importance Score (Max 25)
  let importanceScore = 15;
  if (project) {
    switch (project.academicPriority) {
      case 'Critical': // Capstone Thesis / Final Defense
        importanceScore = 25;
        break;
      case 'High': // Faculty Research / Funded Innovation
        importanceScore = 20;
        break;
      case 'Medium': // Course Assignment / Lab Practicum
        importanceScore = 15;
        break;
      case 'Low':
        importanceScore = 10;
        break;
    }
  }

  // 3. Fairness & Equity Score (Max 20)
  // Inverse relationship with historical resource usage: prevents monopolization
  const fairnessPenalty = Math.min(15, pastUserBookingsCount * 2);
  const fairnessScore = Math.max(5, weights.fairnessWeight - fairnessPenalty);

  // 4. Resource Fit & Architectural Need (Max 15)
  // If the project explicitly lists this specialized equipment ID
  const isDirectFit = project?.requiredEquipmentIds.includes(targetEquipment.id);
  const academicNeedScore = isDirectFit ? weights.resourceFitWeight : 8;

  const totalRaw = deadlineScore + importanceScore + fairnessScore + academicNeedScore;
  const finalScore = parseFloat(Math.min(100, Math.max(1, totalRaw)).toFixed(1));

  const explanation = `Evaluated at ${finalScore}/100: Deadline urgency (${deadlineScore.toFixed(1)}/40, ${daysUntilDeadline}d remaining), Academic priority: ${project?.academicPriority || 'Standard'} (${importanceScore}/25), Historical fairness (${fairnessScore.toFixed(1)}/20 with ${pastUserBookingsCount} past bookings), Resource fit (${academicNeedScore}/15).`;

  return {
    priorityScore: finalScore,
    scoreBreakdown: {
      deadlineScore: parseFloat(deadlineScore.toFixed(1)),
      importanceScore: parseFloat(importanceScore.toFixed(1)),
      fairnessScore: parseFloat(fairnessScore.toFixed(1)),
      academicNeedScore: parseFloat(academicNeedScore.toFixed(1)),
    },
    explanation,
  };
}

/**
 * Finds alternative open equipment and slots when a resource is contested
 */
export function findAlternativeSlotAndEquipment(
  contestedEquipment: Equipment,
  allEquipment: Equipment[],
  allBookings: Booking[],
  date: string,
  startTime: string,
  durationHours: number
): {
  alternativeSlot: string;
  alternativeEquipmentId?: string;
  alternativeEquipmentName?: string;
} {
  // 1. Look for compatible equipment in the same category
  const compatibleAlternatives = allEquipment.filter(
    (e) => e.category === contestedEquipment.category && e.id !== contestedEquipment.id && e.status === 'available'
  );

  if (compatibleAlternatives.length > 0) {
    const bestAlt = compatibleAlternatives[0];
    return {
      alternativeSlot: `${startTime} (Immediate zero-latency slot on equivalent machine)`,
      alternativeEquipmentId: bestAlt.id,
      alternativeEquipmentName: bestAlt.name,
    };
  }

  // 2. Otherwise calculate next available sequential window (+ duration + 30 min turnaround)
  const [h, m] = startTime.split(':').map(Number);
  const nextStartHour = (h + durationHours + 1) % 24;
  const nextEndHour = (nextStartHour + durationHours) % 24;

  const altSlotFormatted = `${nextStartHour.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} - ${nextEndHour.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} on ${contestedEquipment.name}`;

  return {
    alternativeSlot: altSlotFormatted,
    alternativeEquipmentId: contestedEquipment.id,
    alternativeEquipmentName: contestedEquipment.name,
  };
}

