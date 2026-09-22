import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CREDIT_RULES,
  creditsForFocus,
  creditsForPriority,
  streakBonus,
} from '@/domain/credits';
import { averageGoalProgress, goalProgress } from '@/domain/goals';
import { currentStreak, isScheduled, longestStreak, completionRate } from '@/domain/habits';
import { calculateLifeScore, DEFAULT_WEIGHTS } from '@/domain/lifeScore';

const rules = DEFAULT_CREDIT_RULES;

describe('credit rules', () => {
  it('scales with priority', () => {
    expect(creditsForPriority('LOW', rules)).toBe(5);
    expect(creditsForPriority('HIGH', rules)).toBe(10);
    expect(creditsForPriority('CRITICAL', rules)).toBe(15);
  });

  it('pays nothing for a session too short to count', () => {
    expect(creditsForFocus(9, rules)).toBe(0);
  });

  it('adds a deep-work bonus from an hour onward', () => {
    expect(creditsForFocus(30, rules)).toBe(5);
    expect(creditsForFocus(60, rules)).toBe(15);
    expect(creditsForFocus(90, rules)).toBe(20);
  });

  it('caps the streak bonus so long streaks cannot inflate credits', () => {
    expect(streakBonus(6, rules)).toBe(0);
    expect(streakBonus(7, rules)).toBe(2);
    expect(streakBonus(365, rules)).toBe(10);
  });
});

describe('life score', () => {
  const emptyDay = {
    tasksCompleted: 0,
    tasksTotal: 0,
    habitsCompleted: 0,
    habitsTotal: 0,
    goalProgressAvg: 0,
    focusMinutes: 0,
    healthMinutes: 0,
    hasReflection: false,
  };

  it('is zero for a day with nothing recorded', () => {
    expect(calculateLifeScore(emptyDay).score).toBe(0);
  });

  it('is 100 when every component is maxed', () => {
    expect(
      calculateLifeScore({
        tasksCompleted: 6,
        tasksTotal: 6,
        habitsCompleted: 8,
        habitsTotal: 8,
        goalProgressAvg: 100,
        focusMinutes: 600,
        healthMinutes: 120,
        hasReflection: true,
      }).score,
    ).toBe(100);
  });

  it('never exceeds 100 when a component overshoots', () => {
    expect(calculateLifeScore({ ...emptyDay, focusMinutes: 10_000 }).score).toBeLessThanOrEqual(100);
  });

  it('treats an empty denominator as zero rather than dividing by zero', () => {
    const { components } = calculateLifeScore(emptyDay);
    expect(components.find((c) => c.key === 'tasks')?.value).toBe(0);
  });

  it('weights components as the spec defines', () => {
    expect(calculateLifeScore({ ...emptyDay, hasReflection: true }).score).toBe(
      DEFAULT_WEIGHTS.reflection,
    );
  });
});

describe('habit streaks', () => {
  const base = {
    frequency: 'DAILY' as const,
    days: [0, 1, 2, 3, 4, 5, 6],
    isActive: true,
  };

  const MON = '2026-09-21';
  const SUN = '2026-09-20';
  const SAT = '2026-09-19';
  const FRI = '2026-09-18';

  it('counts consecutive completed days', () => {
    const habit = { ...base, log: { [MON]: 'COMPLETED', [SUN]: 'COMPLETED' } as never };
    expect(currentStreak(habit, MON)).toBe(2);
  });

  it('does not break while today is still open', () => {
    const habit = { ...base, log: { [SUN]: 'COMPLETED', [SAT]: 'COMPLETED' } as never };
    expect(currentStreak(habit, MON)).toBe(2);
  });

  it('steps over a rest day rather than resetting', () => {
    const habit = {
      ...base,
      log: { [MON]: 'COMPLETED', [SUN]: 'SKIPPED', [SAT]: 'COMPLETED', [FRI]: 'COMPLETED' } as never,
    };
    expect(currentStreak(habit, MON)).toBe(3);
  });

  it('breaks on a genuinely missed scheduled day', () => {
    const habit = { ...base, log: { [MON]: 'COMPLETED', [SAT]: 'COMPLETED' } as never };
    expect(currentStreak(habit, MON)).toBe(1);
  });

  it('skips days the habit was never scheduled for', () => {
    const weekdays = { ...base, frequency: 'CUSTOM' as const, days: [1, 2, 3, 4, 5], log: {} as never };
    expect(isScheduled(weekdays, MON)).toBe(true);
    expect(isScheduled(weekdays, SUN)).toBe(false);
  });

  it('finds the best historical run', () => {
    const habit = {
      ...base,
      log: {
        '2026-09-01': 'COMPLETED',
        '2026-09-02': 'COMPLETED',
        '2026-09-03': 'COMPLETED',
        '2026-09-10': 'COMPLETED',
      } as never,
    };
    expect(longestStreak(habit)).toBe(3);
  });

  it('measures completion only over scheduled days', () => {
    const weekdays = {
      ...base,
      frequency: 'CUSTOM' as const,
      days: [1, 2, 3, 4, 5],
      log: { [MON]: 'COMPLETED', [FRI]: 'COMPLETED' } as never,
    };
    expect(Math.round(completionRate(weekdays, [MON, SUN, SAT, FRI]))).toBe(100);
  });
});

describe('goal progress', () => {
  const base = { status: 'ACTIVE' as const, milestones: [] };

  it('prefers an explicit numeric target', () => {
    expect(goalProgress({ ...base, targetValue: 500, currentValue: 200 })).toBe(40);
  });

  it('falls back to milestones', () => {
    expect(
      goalProgress({
        ...base,
        milestones: [{ isCompleted: true }, { isCompleted: false }],
      }),
    ).toBe(50);
  });

  it('caps at 100 when the target is exceeded', () => {
    expect(goalProgress({ ...base, targetValue: 10, currentValue: 40 })).toBe(100);
  });

  it('is zero, not NaN, with no goals', () => {
    expect(averageGoalProgress([])).toBe(0);
  });

  it('ignores paused goals in the average', () => {
    expect(
      averageGoalProgress([
        { ...base, targetValue: 10, currentValue: 10 },
        { ...base, status: 'PAUSED', targetValue: 10, currentValue: 0 },
      ]),
    ).toBe(100);
  });
});
