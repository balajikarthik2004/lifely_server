import type { ClientSession } from 'mongoose';

import { toObjectId } from '@/common/utils/ownership';
import type { CATEGORIES } from '@/common/constants';
import { Activity, type ActivityHydrated } from './activity.model';

export interface DerivedActivityInput {
  userId: string;
  /** The stable key for whatever produced this entry. */
  sourceRef: string;
  source: 'TASK' | 'HABIT' | 'FOCUS' | 'SYSTEM';
  title: string;
  icon: string;
  category: (typeof CATEGORIES)[number];
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  creditsEarned: number;
}

/**
 * Write the timeline entry for a completed task, habit-day or focus session.
 *
 * An upsert keyed on (userId, sourceRef), so replaying a request — a retry, a
 * double tap, two racing calls — leaves exactly one entry rather than a
 * duplicate. The unique partial index on those fields is what enforces it.
 */
export async function upsertDerivedActivity(
  input: DerivedActivityInput,
  session?: ClientSession,
): Promise<ActivityHydrated> {
  const { userId, sourceRef, ...rest } = input;

  return Activity.findOneAndUpdate(
    { userId: toObjectId(userId), sourceRef },
    { $setOnInsert: { userId: toObjectId(userId), sourceRef, ...rest } },
    { returnDocument: 'after', upsert: true, session: session ?? null },
  ) as unknown as Promise<ActivityHydrated>;
}

export async function removeDerivedActivity(
  userId: string,
  sourceRef: string,
  session?: ClientSession,
): Promise<void> {
  await Activity.deleteMany(
    { userId: toObjectId(userId), sourceRef },
    session ? { session } : {},
  );
}
