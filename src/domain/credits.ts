/**
 * Credit rules (spec section 18).
 *
 * This is the authoritative copy. The mobile app carries the same rules so it
 * can show a number immediately, but the server recomputes on every write and
 * the server's answer wins (spec section 50, rule 5).
 */
export interface CreditRules {
  taskLow: number;
  taskMedium: number;
  taskHigh: number;
  taskCritical: number;
  focusPer30Min: number;
  reflection: number;
  streakBonusPerWeek: number;
  missedCriticalHabit: number;
  goalMilestone: number;
}

export const DEFAULT_CREDIT_RULES: CreditRules = {
  taskLow: 5,
  taskMedium: 5,
  taskHigh: 10,
  taskCritical: 15,
  focusPer30Min: 5,
  reflection: 5,
  streakBonusPerWeek: 2,
  missedCriticalHabit: -5,
  goalMilestone: 20,
};

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export function creditsForPriority(priority: Priority, rules: CreditRules): number {
  switch (priority) {
    case 'LOW':
      return rules.taskLow;
    case 'MEDIUM':
      return rules.taskMedium;
    case 'HIGH':
      return rules.taskHigh;
    case 'CRITICAL':
      return rules.taskCritical;
  }
}

/** 30 focused minutes = base rate; 60+ minutes of deep work earns a bonus tier. */
export function creditsForFocus(minutes: number, rules: CreditRules): number {
  if (minutes < 10) return 0;
  const blocks = Math.floor(minutes / 30);
  const base = blocks * rules.focusPer30Min;
  const deepWorkBonus = minutes >= 60 ? rules.focusPer30Min : 0;
  return Math.max(rules.focusPer30Min, base + deepWorkBonus);
}

/** Streak bonus, capped so long streaks cannot inflate credits indefinitely. */
export function streakBonus(streak: number, rules: CreditRules): number {
  if (streak < 7) return 0;
  return Math.min(10, Math.floor(streak / 7) * rules.streakBonusPerWeek);
}

export const CREDIT_TYPES = [
  'TASK_COMPLETION',
  'HABIT_COMPLETION',
  'FOCUS_SESSION',
  'WORKOUT',
  'READING',
  'LEARNING',
  'REFLECTION',
  'GOAL_MILESTONE',
  'REWARD_REDEMPTION',
  'ADJUSTMENT',
] as const;

export type CreditType = (typeof CREDIT_TYPES)[number];
