import { HEALTH_CATEGORIES, PRODUCTIVE_CATEGORIES } from '@/common/constants';
import { dayBounds, lastNDayKeys, todayKey } from '@/common/utils/dates';
import { toObjectId } from '@/common/utils/ownership';
import { calculateLifeScore, DEFAULT_WEIGHTS, type LifeScoreBreakdown } from '@/domain/lifeScore';
import { Activity } from '@/modules/activities/activity.model';
import * as activitiesService from '@/modules/activities/activities.service';
import * as credits from '@/modules/credits/credits.service';
import * as goalsService from '@/modules/goals/goals.service';
import * as habitsService from '@/modules/habits/habits.service';
import { Reflection } from '@/modules/reflections/reflection.model';
import { Task } from '@/modules/tasks/task.model';
import { User } from '@/modules/users/user.model';

export interface DailyRecord {
  date: string;
  lifeScore: number;
  creditsEarned: number;
  tasksCompleted: number;
  tasksTotal: number;
  habitsCompleted: number;
  habitsTotal: number;
  focusMinutes: number;
  productiveMinutes: number;
  healthMinutes: number;
  mood?: number;
  energy?: number;
}

interface DayAggregates {
  focusMinutes: number;
  healthMinutes: number;
  productiveMinutes: number;
}

/**
 * One pass over a window of days.
 *
 * Everything the dashboard and the analytics screen need comes from grouped
 * aggregations rather than a query per day, so a 30-day view is a handful of
 * round trips instead of a hundred.
 */
async function activityTotalsByDay(
  userId: string,
  dateKeys: string[],
): Promise<Record<string, DayAggregates>> {
  const empty: DayAggregates = { focusMinutes: 0, healthMinutes: 0, productiveMinutes: 0 };
  const totals: Record<string, DayAggregates> = Object.fromEntries(
    dateKeys.map((key) => [key, { ...empty }]),
  );
  if (dateKeys.length === 0) return totals;

  const { start } = dayBounds(dateKeys[0]);
  const { end } = dayBounds(dateKeys[dateKeys.length - 1]);

  const rows = await Activity.aggregate<{
    _id: { day: string; category: string; source: string };
    minutes: number;
  }>([
    { $match: { userId: toObjectId(userId), startTime: { $gte: start, $lt: end } } },
    {
      $group: {
        _id: {
          day: { $dateToString: { format: '%Y-%m-%d', date: '$startTime', timezone: 'UTC' } },
          category: '$category',
          source: '$source',
        },
        minutes: { $sum: '$durationMinutes' },
      },
    },
  ]);

  rows.forEach((row) => {
    const bucket = totals[row._id.day];
    if (!bucket) return;
    if (row._id.source === 'FOCUS') bucket.focusMinutes += row.minutes;
    if (HEALTH_CATEGORIES.includes(row._id.category as never)) bucket.healthMinutes += row.minutes;
    if (PRODUCTIVE_CATEGORIES.includes(row._id.category as never)) {
      bucket.productiveMinutes += row.minutes;
    }
  });

  return totals;
}

async function taskTotalsByDay(
  userId: string,
  dateKeys: string[],
): Promise<Record<string, { total: number; completed: number }>> {
  const totals: Record<string, { total: number; completed: number }> = Object.fromEntries(
    dateKeys.map((key) => [key, { total: 0, completed: 0 }]),
  );
  if (dateKeys.length === 0) return totals;

  const { start } = dayBounds(dateKeys[0]);
  const { end } = dayBounds(dateKeys[dateKeys.length - 1]);
  const owner = toObjectId(userId);

  const tasks = await Task.find({
    userId: owner,
    status: { $ne: 'CANCELLED' },
    $or: [
      { dueDate: { $gte: dateKeys[0], $lte: dateKeys[dateKeys.length - 1] } },
      { completedAt: { $gte: start, $lt: end } },
    ],
  });

  tasks.forEach((task) => {
    const completedKey = task.completedAt?.toISOString().slice(0, 10);
    // A task counts on its due day, and on the day it was actually finished if
    // that is a different day — otherwise a late completion would vanish.
    const keys = new Set<string>();
    if (task.dueDate && task.dueDate in totals) keys.add(task.dueDate);
    if (completedKey && completedKey in totals) keys.add(completedKey);

    keys.forEach((key) => {
      totals[key].total += 1;
      if (task.status === 'COMPLETED') totals[key].completed += 1;
    });
  });

  return totals;
}

export async function recordsForRange(userId: string, days: number): Promise<DailyRecord[]> {
  return recordsForKeys(userId, lastNDayKeys(days));
}

/** Build a daily record for each of the given calendar days. */
export async function recordsForKeys(userId: string, dateKeys: string[]): Promise<DailyRecord[]> {
  if (dateKeys.length === 0) return [];
  const owner = toObjectId(userId);

  const [user, activityTotals, taskTotals, creditTotals, reflections, habits, goalProgressAvg] =
    await Promise.all([
      User.findById(userId),
      activityTotalsByDay(userId, dateKeys),
      taskTotalsByDay(userId, dateKeys),
      credits.creditsByDay(userId, dateKeys),
      Reflection.find({ userId: owner, date: { $in: dateKeys } }),
      habitsService.list(userId),
      goalsService.averageProgress(userId),
    ]);

  const weights = user?.weights ?? DEFAULT_WEIGHTS;
  const reflectionByDate = new Map(reflections.map((r) => [r.date, r]));

  return dateKeys.map((date) => {
    const activity = activityTotals[date];
    const tasks = taskTotals[date];
    const reflection = reflectionByDate.get(date);

    let habitsTotal = 0;
    let habitsCompleted = 0;
    habits.forEach(({ habit }) => {
      const log = Object.fromEntries(habit.log ?? new Map());
      const scheduled =
        habit.isActive &&
        (habit.frequency === 'DAILY' ||
          habit.days.includes(new Date(`${date}T00:00:00.000Z`).getUTCDay()));
      if (!scheduled) return;
      habitsTotal += 1;
      if (log[date] === 'COMPLETED') habitsCompleted += 1;
    });

    const { score } = calculateLifeScore(
      {
        tasksCompleted: tasks.completed,
        tasksTotal: tasks.total,
        habitsCompleted,
        habitsTotal,
        goalProgressAvg,
        focusMinutes: activity.focusMinutes,
        healthMinutes: activity.healthMinutes,
        hasReflection: Boolean(reflection),
      },
      weights,
    );

    return {
      date,
      lifeScore: score,
      creditsEarned: creditTotals[date] ?? 0,
      tasksCompleted: tasks.completed,
      tasksTotal: tasks.total,
      habitsCompleted,
      habitsTotal,
      focusMinutes: activity.focusMinutes,
      productiveMinutes: activity.productiveMinutes,
      healthMinutes: activity.healthMinutes,
      mood: reflection?.mood,
      energy: reflection?.energy,
    };
  });
}

export async function today(userId: string): Promise<DailyRecord> {
  const [record] = await recordsForRange(userId, 1);
  return record;
}

/** The Life Score with its components, so the client can show the breakdown. */
export async function lifeScore(userId: string, dateKey = todayKey()): Promise<LifeScoreBreakdown> {
  const [record] = await recordsForKeys(userId, [dateKey]);
  const [user, goalProgressAvg] = await Promise.all([
    User.findById(userId),
    goalsService.averageProgress(userId),
  ]);

  return calculateLifeScore(
    {
      tasksCompleted: record.tasksCompleted,
      tasksTotal: record.tasksTotal,
      habitsCompleted: record.habitsCompleted,
      habitsTotal: record.habitsTotal,
      goalProgressAvg,
      focusMinutes: record.focusMinutes,
      healthMinutes: record.healthMinutes,
      hasReflection: record.mood !== undefined,
    },
    user?.weights ?? DEFAULT_WEIGHTS,
  );
}

export interface Overview {
  today: DailyRecord;
  week: DailyRecord[];
  breakdown: LifeScoreBreakdown;
  credits: Awaited<ReturnType<typeof credits.getSummary>>;
  averages: { lifeScore: number; credits: number; focusMinutes: number; habitRate: number };
  minutesByCategory: Record<string, number>;
  habitConsistency: { habitId: string; name: string; rate: number }[];
}

/** One call that fills the whole Insights screen. */
export async function overview(userId: string, days = 7): Promise<Overview> {
  const dateKeys = lastNDayKeys(days);
  const [records, creditSummary, breakdown, minutesByCategory, habitConsistency] = await Promise.all([
    recordsForRange(userId, days),
    credits.getSummary(userId),
    lifeScore(userId),
    activitiesService.minutesByCategory(userId, dateKeys[0], dateKeys[dateKeys.length - 1]),
    habitsService.consistency(userId, dateKeys),
  ]);

  const past = records.filter((r) => r.date <= todayKey());
  const divisor = past.length || 1;

  return {
    today: records[records.length - 1],
    week: records,
    breakdown,
    credits: creditSummary,
    averages: {
      lifeScore: past.reduce((sum, r) => sum + r.lifeScore, 0) / divisor,
      credits: past.reduce((sum, r) => sum + r.creditsEarned, 0) / divisor,
      focusMinutes: past.reduce((sum, r) => sum + r.focusMinutes, 0) / divisor,
      habitRate:
        past.reduce((sum, r) => sum + (r.habitsTotal ? r.habitsCompleted / r.habitsTotal : 0), 0) /
        divisor,
    },
    minutesByCategory,
    habitConsistency,
  };
}
