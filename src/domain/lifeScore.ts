/**
 * Life Score (spec section 17).
 *
 * A weighted blend of six normalised components. It measures personal
 * consistency for the day -- deliberately not a judgement of the person.
 */
export interface LifeScoreWeights {
  tasks: number;
  habits: number;
  goals: number;
  focus: number;
  health: number;
  reflection: number;
}

export const DEFAULT_WEIGHTS: LifeScoreWeights = {
  tasks: 25,
  habits: 20,
  goals: 20,
  focus: 15,
  health: 10,
  reflection: 10,
};

export interface LifeScoreInput {
  tasksCompleted: number;
  tasksTotal: number;
  habitsCompleted: number;
  habitsTotal: number;
  goalProgressAvg: number;
  focusMinutes: number;
  healthMinutes: number;
  hasReflection: boolean;
}

export interface LifeScoreComponent {
  key: keyof LifeScoreWeights;
  label: string;
  value: number;
  weight: number;
}

export interface LifeScoreBreakdown {
  score: number;
  components: LifeScoreComponent[];
}

const FOCUS_TARGET_MINUTES = 240;
const HEALTH_TARGET_MINUTES = 45;

export function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function calculateLifeScore(
  input: LifeScoreInput,
  weights: LifeScoreWeights = DEFAULT_WEIGHTS,
): LifeScoreBreakdown {
  const tasks = input.tasksTotal > 0 ? (input.tasksCompleted / input.tasksTotal) * 100 : 0;
  const habits = input.habitsTotal > 0 ? (input.habitsCompleted / input.habitsTotal) * 100 : 0;

  const components: LifeScoreComponent[] = [
    { key: 'tasks', label: 'Tasks', value: clamp(tasks), weight: weights.tasks },
    { key: 'habits', label: 'Habits', value: clamp(habits), weight: weights.habits },
    { key: 'goals', label: 'Goals', value: clamp(input.goalProgressAvg), weight: weights.goals },
    {
      key: 'focus',
      label: 'Focus',
      value: clamp((input.focusMinutes / FOCUS_TARGET_MINUTES) * 100),
      weight: weights.focus,
    },
    {
      key: 'health',
      label: 'Health',
      value: clamp((input.healthMinutes / HEALTH_TARGET_MINUTES) * 100),
      weight: weights.health,
    },
    {
      key: 'reflection',
      label: 'Reflection',
      value: input.hasReflection ? 100 : 0,
      weight: weights.reflection,
    },
  ];

  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0) || 1;
  const score = components.reduce((sum, c) => sum + c.value * c.weight, 0) / totalWeight;

  return { score: Math.round(clamp(score)), components };
}
