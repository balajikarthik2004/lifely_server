import { clamp } from './lifeScore';

export interface GoalLike {
  status: 'ACTIVE' | 'COMPLETED' | 'PAUSED' | 'ARCHIVED';
  targetValue?: number | null;
  currentValue?: number | null;
  milestones: { isCompleted: boolean }[];
}

/**
 * Progress prefers an explicit numeric target and falls back to the share of
 * milestones completed. Nothing is inferred from task activity -- the number
 * stays something the user chose.
 */
export function goalProgress(goal: GoalLike): number {
  if (goal.status === 'COMPLETED') return 100;
  if (typeof goal.targetValue === 'number' && goal.targetValue > 0) {
    return clamp(((goal.currentValue ?? 0) / goal.targetValue) * 100);
  }
  if (goal.milestones.length > 0) {
    const done = goal.milestones.filter((m) => m.isCompleted).length;
    return clamp((done / goal.milestones.length) * 100);
  }
  return 0;
}

export function averageGoalProgress(goals: GoalLike[]): number {
  const relevant = goals.filter((g) => g.status === 'ACTIVE' || g.status === 'COMPLETED');
  if (relevant.length === 0) return 0;
  return relevant.reduce((sum, g) => sum + goalProgress(g), 0) / relevant.length;
}
