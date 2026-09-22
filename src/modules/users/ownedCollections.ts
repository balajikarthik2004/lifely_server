import type { Types } from 'mongoose';

import { Activity } from '@/modules/activities/activity.model';
import { CreditTransaction } from '@/modules/credits/creditTransaction.model';
import { FocusSession } from '@/modules/focus/focusSession.model';
import { Goal } from '@/modules/goals/goal.model';
import { Habit } from '@/modules/habits/habit.model';
import { Reflection } from '@/modules/reflections/reflection.model';
import { Reward } from '@/modules/rewards/reward.model';
import { Task } from '@/modules/tasks/task.model';

/**
 * Every collection that belongs to a user, so export, reset and delete can
 * never silently miss one. Adding a model to the app means adding it here.
 *
 * The models have different document types, so they are referenced through the
 * narrow shape those operations actually need.
 */
export interface OwnedCollection {
  find(filter: { userId: Types.ObjectId }): Promise<unknown[]>;
  deleteMany(filter: { userId: Types.ObjectId }): Promise<unknown>;
}

export const ownedCollections: [string, OwnedCollection][] = [
  ['tasks', Task],
  ['habits', Habit],
  ['goals', Goal],
  ['activities', Activity],
  ['transactions', CreditTransaction],
  ['rewards', Reward],
  ['reflections', Reflection],
  ['focusSessions', FocusSession],
] as unknown as [string, OwnedCollection][];

/** Removes everything the account owns, leaving the account itself in place. */
export async function clearOwnedData(userId: Types.ObjectId): Promise<void> {
  await Promise.all(ownedCollections.map(([, model]) => model.deleteMany({ userId })));
}
