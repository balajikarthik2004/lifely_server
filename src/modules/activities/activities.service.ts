import { dayBounds } from '@/common/utils/dates';
import { findOwned, toObjectId } from '@/common/utils/ownership';
import { withTransaction } from '@/common/utils/transaction';
import * as credits from '@/modules/credits/credits.service';
import { Activity, type ActivityDocument, type ActivityHydrated } from './activity.model';

export type { ActivityDocument, ActivityHydrated };

const ledgerRef = (activityId: string) => `activity:${activityId}`;

/** Manual logging is capped, so a client cannot award itself a fortune. */
const MAX_MANUAL_CREDITS = 60;

/** Gaps of 45 minutes or more between logged activities (spec section 7). */
export interface TimelineGap {
  afterActivityId: string;
  startTime: Date;
  endTime: Date;
  minutes: number;
}

export function findGaps(activities: ActivityHydrated[], minMinutes = 45): TimelineGap[] {
  const sorted = [...activities].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  const gaps: TimelineGap[] = [];

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const end = sorted[i].endTime ?? sorted[i].startTime;
    const nextStart = sorted[i + 1].startTime;
    const minutes = Math.round((nextStart.getTime() - end.getTime()) / 60_000);
    if (minutes >= minMinutes) {
      gaps.push({
        afterActivityId: String(sorted[i]._id),
        startTime: end,
        endTime: nextStart,
        minutes,
      });
    }
  }
  return gaps;
}

export async function forDay(userId: string, dateKey: string): Promise<ActivityHydrated[]> {
  const { start, end } = dayBounds(dateKey);
  return Activity.find({
    userId: toObjectId(userId),
    startTime: { $gte: start, $lt: end },
  }).sort({ startTime: 1 });
}

export async function forRange(
  userId: string,
  startKey: string,
  endKey: string,
): Promise<ActivityHydrated[]> {
  const { start } = dayBounds(startKey);
  const { end } = dayBounds(endKey);
  return Activity.find({
    userId: toObjectId(userId),
    startTime: { $gte: start, $lt: end },
  }).sort({ startTime: 1 });
}

export async function getById(userId: string, id: string): Promise<ActivityHydrated> {
  return findOwned(Activity, id, userId, 'That activity');
}

export interface CreateActivityInput {
  title: string;
  icon?: string;
  category?: ActivityDocument['category'];
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
  creditsEarned?: number;
  mood?: number;
  energy?: number;
  notes?: string;
}

export async function create(
  userId: string,
  input: CreateActivityInput,
): Promise<{ activity: ActivityHydrated; balance: number }> {
  const startTime = input.startTime ? new Date(input.startTime) : new Date();
  const duration =
    input.durationMinutes ??
    (input.endTime
      ? Math.max(0, Math.round((new Date(input.endTime).getTime() - startTime.getTime()) / 60_000))
      : 30);

  const awarded = Math.max(0, Math.min(MAX_MANUAL_CREDITS, Math.round(input.creditsEarned ?? 0)));

  const activity = await Activity.create({
    ...input,
    userId: toObjectId(userId),
    startTime,
    endTime: input.endTime
      ? new Date(input.endTime)
      : new Date(startTime.getTime() + duration * 60_000),
    durationMinutes: duration,
    creditsEarned: awarded,
    source: 'MANUAL',
  });

  if (awarded > 0) {
    await credits.record(userId, {
      amount: awarded,
      type: 'ADJUSTMENT',
      description: activity.title,
      sourceRef: ledgerRef(String(activity._id)),
      createdAt: startTime,
    });
  }

  return { activity, balance: await credits.getBalance(userId) };
}

export async function update(
  userId: string,
  id: string,
  patch: Partial<CreateActivityInput>,
): Promise<{ activity: ActivityHydrated; balance: number }> {
  const activity = await findOwned(Activity, id, userId, 'That activity');
  const ref = ledgerRef(id);

  const nextCredits =
    typeof patch.creditsEarned === 'number'
      ? Math.max(0, Math.min(MAX_MANUAL_CREDITS, Math.round(patch.creditsEarned)))
      : activity.creditsEarned;

  await withTransaction(async (session) => {
    Object.assign(activity, {
      ...patch,
      startTime: patch.startTime ? new Date(patch.startTime) : activity.startTime,
      endTime: patch.endTime ? new Date(patch.endTime) : activity.endTime,
      creditsEarned: nextCredits,
    });
    await activity.save({ session });

    // The ledger entry is rewritten rather than adjusted, so it always states
    // the current value of the activity.
    await credits.revoke(userId, ref, session);
    if (nextCredits > 0) {
      await credits.record(
        userId,
        {
          amount: nextCredits,
          type: 'ADJUSTMENT',
          description: activity.title,
          sourceRef: ref,
          createdAt: activity.startTime,
        },
        session,
      );
    }
  });

  return { activity, balance: await credits.getBalance(userId) };
}

export async function remove(userId: string, id: string): Promise<void> {
  const activity = await findOwned(Activity, id, userId, 'That activity');

  await withTransaction(async (session) => {
    await credits.revoke(userId, ledgerRef(id), session);
    await Activity.deleteOne({ _id: activity._id }, session ? { session } : {});
  });
}

/** Minutes per category across a window, for the allocation chart. */
export async function minutesByCategory(
  userId: string,
  startKey: string,
  endKey: string,
): Promise<Record<string, number>> {
  const { start } = dayBounds(startKey);
  const { end } = dayBounds(endKey);

  const rows = await Activity.aggregate<{ _id: string; minutes: number }>([
    { $match: { userId: toObjectId(userId), startTime: { $gte: start, $lt: end } } },
    { $group: { _id: '$category', minutes: { $sum: '$durationMinutes' } } },
  ]);

  return Object.fromEntries(rows.map((row) => [row._id, row.minutes]));
}
