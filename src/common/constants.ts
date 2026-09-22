export const CATEGORIES = [
  'WORK',
  'HEALTH',
  'LEARNING',
  'PERSONAL',
  'FAMILY',
  'FINANCE',
  'TRAVEL',
  'OTHER',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;

export const ACTIVITY_SOURCES = ['MANUAL', 'TASK', 'HABIT', 'FOCUS', 'SYSTEM'] as const;

export const REWARD_CATEGORIES = ['ENTERTAINMENT', 'FOOD', 'SHOPPING', 'TRAVEL', 'PERSONAL'] as const;

export const GOAL_STATUSES = ['ACTIVE', 'COMPLETED', 'PAUSED', 'ARCHIVED'] as const;

export const HABIT_FREQUENCIES = ['DAILY', 'WEEKLY', 'CUSTOM'] as const;

export const RECURRENCES = ['NONE', 'DAILY', 'WEEKDAYS', 'WEEKLY'] as const;

/** Counts toward the health slice of the Life Score. */
export const HEALTH_CATEGORIES: readonly Category[] = ['HEALTH'];

/** Counts as productive time in analytics. */
export const PRODUCTIVE_CATEGORIES: readonly Category[] = ['WORK', 'LEARNING', 'HEALTH', 'FINANCE'];
