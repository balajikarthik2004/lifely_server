import { BadRequestError } from '@/common/errors';
import { todayKey } from '@/common/utils/dates';
import { findOwned, toObjectId } from '@/common/utils/ownership';
import { withTransaction } from '@/common/utils/transaction';
import { DEFAULT_CREDIT_RULES, streakBonus } from '@/domain/credits';
import {
  completionRate,
  currentStreak,
  isScheduled,
  longestStreak,
  type HabitLike,
} from '@/domain/habits';
import {
  removeDerivedActivity,
  upsertDerivedActivity,
} from '@/modules/activities/activities.repository';
import * as credits from '@/modules/credits/credits.service';
import { User } from '@/modules/users/user.model';
import { Habit, type HabitDocument, type HabitHydrated } from './habit.model';

export type { HabitDocument, HabitHydrated };

/** One ledger key per habit-day, so a day can only ever be paid out once. */
const ledgerRef = (habitId: string, dateKey: string) => `habit:${habitId}:${dateKey}`;

/** The domain helpers work on a plain object; Mongoose stores the log as a Map. */
function toHabitLike(habit: HabitHydrated): HabitLike {
  return {
    frequency: habit.frequency,
    days: habit.days,
    isActive: habit.isActive,
    log: Object.fromEntries(habit.log ?? new Map()) as HabitLike['log'],
  };
}

export interface HabitWithStats {
  habit: HabitHydrated;
  currentStreak: number;
  longestStreak: number;
  scheduledToday: boolean;
  stateToday: 'COMPLETED' | 'SKIPPED' | 'PENDING' | 'NOT_SCHEDULED';
}

export function withStats(habit: HabitHydrated, reference = todayKey()): HabitWithStats {
  const like = toHabitLike(habit);
  const scheduledToday = isScheduled(like, reference);
  const logged = like.log[reference];

  return {
    habit,
    currentStreak: currentStreak(like, reference),
    longestStreak: longestStreak(like),
    scheduledToday,
    stateToday: logged ?? (scheduledToday ? 'PENDING' : 'NOT_SCHEDULED'),
  };
}

export async function list(userId: string, includeInactive = true): Promise<HabitWithStats[]> {
  const query: Record<string, unknown> = { userId: toObjectId(userId) };
  if (!includeInactive) query.isActive = true;

  const habits = await Habit.find(query).sort({ createdAt: 1 });
  return habits.map((habit) => withStats(habit));
}

export async function getById(userId: string, id: string): Promise<HabitWithStats> {
  const habit = await findOwned(Habit, id, userId, 'That habit');
  return withStats(habit);
}

export interface CreateHabitInput {
  name: string;
  description?: string;
  icon?: string;
  category?: HabitDocument['category'];
  frequency?: HabitDocument['frequency'];
  days?: number[];
  targetCount?: number;
  creditValue?: number;
  reminderTime?: string;
  goalId?: string;
  isActive?: boolean;
}

export async function create(userId: string, input: CreateHabitInput): Promise<HabitWithStats> {
  const frequency = input.frequency ?? 'DAILY';
  const days = frequency === 'DAILY' ? [0, 1, 2, 3, 4, 5, 6] : (input.days ?? []);

  if (frequency !== 'DAILY' && days.length === 0) {
    throw new BadRequestError('Pick at least one day for this habit.');
  }

  const habit = await Habit.create({
    ...input,
    userId: toObjectId(userId),
    frequency,
    days,
    goalId: input.goalId ? toObjectId(input.goalId) : undefined,
    log: new Map(),
  });

  return withStats(habit);
}

export async function update(
  userId: string,
  id: string,
  patch: Partial<CreateHabitInput>,
): Promise<HabitWithStats> {
  const habit = await findOwned(Habit, id, userId, 'That habit');

  // The log is only ever changed through logDay / clearDay, so a client cannot
  // rewrite its own history and mint credits for it.
  Object.assign(habit, {
    ...patch,
    goalId: 'goalId' in patch ? (patch.goalId ? toObjectId(patch.goalId) : undefined) : habit.goalId,
  });

  if (patch.frequency === 'DAILY') habit.days = [0, 1, 2, 3, 4, 5, 6];

  await habit.save();
  return withStats(habit);
}

export async function remove(userId: string, id: string): Promise<void> {
  const habit = await findOwned(Habit, id, userId, 'That habit');

  await withTransaction(async (session) => {
    // Every day this habit was ever paid out for.
    const refs = Array.from(habit.log.keys()).map((dateKey) => ledgerRef(id, dateKey));
    await Promise.all(refs.map((ref) => credits.revoke(userId, ref, session)));
    await Promise.all(refs.map((ref) => removeDerivedActivity(userId, ref, session)));
    await Habit.deleteOne({ _id: habit._id }, session ? { session } : {});
  });
}

export interface HabitDayResult {
  habit: HabitWithStats;
  creditsAwarded: number;
  balance: number;
}

/**
 * Mark a habit day complete (spec section 9).
 *
 * The credit is the habit's value plus any streak bonus, computed server-side
 * from the log the server holds — the client never says what a streak is worth.
 *
 * Setting the day is an atomic compare-and-set on that one map key, so two
 * concurrent taps cannot both claim it, and the ledger and timeline writes that
 * follow are keyed on a stable sourceRef and so are safe to replay.
 */
export async function complete(
  userId: string,
  id: string,
  dateKey = todayKey(),
): Promise<HabitDayResult> {
  const existing = await findOwned(Habit, id, userId, 'That habit');

  if (dateKey > todayKey()) {
    throw new BadRequestError('You cannot tick off a habit for a day that has not happened yet.');
  }

  const logField = `log.${dateKey}`;
  const claimed = await Habit.findOneAndUpdate(
    { _id: existing._id, userId: toObjectId(userId), [logField]: { $ne: 'COMPLETED' } },
    { $set: { [logField]: 'COMPLETED' } },
    { returnDocument: 'after' },
  );

  const habit = claimed ?? existing;
  const wasAlreadyComplete = claimed === null;

  const user = await User.findById(userId);
  const rules = user?.creditRules ?? DEFAULT_CREDIT_RULES;

  const streak = currentStreak(toHabitLike(habit), dateKey);
  const bonus = streakBonus(streak, rules);
  const amount = habit.creditValue + bonus;
  const ref = ledgerRef(id, dateKey);
  const at = new Date(`${dateKey}T12:00:00.000Z`);

  await credits.record(userId, {
    amount,
    type: 'HABIT_COMPLETION',
    description: bonus > 0 ? `${habit.name} (${streak} day streak)` : habit.name,
    sourceRef: ref,
    createdAt: at,
  });

  await upsertDerivedActivity({
    userId,
    sourceRef: ref,
    source: 'HABIT',
    title: habit.name,
    icon: habit.icon,
    category: habit.category,
    startTime: at,
    endTime: at,
    durationMinutes: 15,
    creditsEarned: amount,
  });

  return {
    habit: withStats(habit),
    creditsAwarded: wasAlreadyComplete ? 0 : amount,
    balance: await credits.getBalance(userId),
  };
}

/** Mark a rest day. Neutral: no credits either way, and the streak survives. */
export async function skip(
  userId: string,
  id: string,
  dateKey = todayKey(),
): Promise<HabitDayResult> {
  const habit = await findOwned(Habit, id, userId, 'That habit');
  const ref = ledgerRef(id, dateKey);

  await withTransaction(async (session) => {
    habit.log.set(dateKey, 'SKIPPED');
    await habit.save({ session });
    // If the day had been completed, its payout is withdrawn with it.
    await credits.revoke(userId, ref, session);
    await removeDerivedActivity(userId, ref, session);
  });

  return { habit: withStats(habit), creditsAwarded: 0, balance: await credits.getBalance(userId) };
}

/** Clear a day entirely, undoing a completion or a rest day. */
export async function clearDay(
  userId: string,
  id: string,
  dateKey = todayKey(),
): Promise<HabitDayResult> {
  const habit = await findOwned(Habit, id, userId, 'That habit');
  const ref = ledgerRef(id, dateKey);

  await withTransaction(async (session) => {
    habit.log.delete(dateKey);
    await habit.save({ session });
    await credits.revoke(userId, ref, session);
    await removeDerivedActivity(userId, ref, session);
  });

  return { habit: withStats(habit), creditsAwarded: 0, balance: await credits.getBalance(userId) };
}

/** How many of the days scheduled in this window were kept, per habit. */
export async function consistency(
  userId: string,
  dateKeys: string[],
): Promise<{ habitId: string; name: string; rate: number }[]> {
  const habits = await Habit.find({ userId: toObjectId(userId) });
  return habits.map((habit) => ({
    habitId: String(habit._id),
    name: habit.name,
    rate: completionRate(toHabitLike(habit), dateKeys),
  }));
}

/** Scheduled and completed counts for one day — used by the Life Score. */
export async function dayTotals(
  userId: string,
  dateKey: string,
): Promise<{ scheduled: number; completed: number }> {
  const habits = await Habit.find({ userId: toObjectId(userId) });
  let scheduled = 0;
  let completed = 0;

  habits.forEach((habit) => {
    const like = toHabitLike(habit);
    if (!isScheduled(like, dateKey)) return;
    scheduled += 1;
    if (like.log[dateKey] === 'COMPLETED') completed += 1;
  });

  return { scheduled, completed };
}
