import { dayBounds } from '@/common/utils/dates';
import { findOwned, toObjectId } from '@/common/utils/ownership';
import { withTransaction } from '@/common/utils/transaction';
import { DEFAULT_CREDIT_RULES, creditsForPriority, type Priority } from '@/domain/credits';
import {
  removeDerivedActivity,
  upsertDerivedActivity,
} from '@/modules/activities/activities.repository';
import * as credits from '@/modules/credits/credits.service';
import { User } from '@/modules/users/user.model';
import { Task, type TaskDocument, type TaskHydrated } from './task.model';

export type { TaskDocument, TaskHydrated };

const CATEGORY_ICONS: Record<string, string> = {
  WORK: '\u{1F4BB}',
  HEALTH: '\u{1F3CB}️',
  LEARNING: '\u{1F4DA}',
  PERSONAL: '\u{1F331}',
  FAMILY: '❤️',
  FINANCE: '\u{1F4B0}',
  TRAVEL: '✈️',
  OTHER: '✨',
};

/** The ledger key for a task payout — stable, which is what makes it idempotent. */
const ledgerRef = (taskId: string) => `task:${taskId}`;

export interface ListTaskFilters {
  status?: string;
  dueBefore?: string;
  dueAfter?: string;
  goalId?: string;
  limit: number;
}

export async function list(userId: string, filters: ListTaskFilters): Promise<TaskHydrated[]> {
  const query: Record<string, unknown> = { userId: toObjectId(userId) };

  if (filters.status) query.status = filters.status;
  if (filters.goalId) query.goalId = toObjectId(filters.goalId);
  if (filters.dueBefore || filters.dueAfter) {
    query.dueDate = {
      ...(filters.dueAfter ? { $gte: filters.dueAfter } : {}),
      ...(filters.dueBefore ? { $lte: filters.dueBefore } : {}),
    };
  }

  return Task.find(query).sort({ dueDate: 1, createdAt: -1 }).limit(filters.limit);
}

export async function getById(userId: string, id: string): Promise<TaskHydrated> {
  return findOwned(Task, id, userId, 'That task');
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  category?: TaskDocument['category'];
  priority?: Priority;
  dueDate?: string;
  dueTime?: string;
  estimatedMinutes?: number;
  creditValue?: number;
  goalId?: string;
  habitId?: string;
  recurrence?: TaskDocument['recurrence'];
}

export async function create(userId: string, input: CreateTaskInput): Promise<TaskHydrated> {
  const user = await User.findById(userId);
  const rules = user?.creditRules ?? DEFAULT_CREDIT_RULES;
  const priority = input.priority ?? 'MEDIUM';

  return Task.create({
    ...input,
    userId: toObjectId(userId),
    priority,
    // The client may propose a value, but it is clamped and defaulted from the
    // user's own rules — credits are never simply whatever the client says.
    creditValue:
      typeof input.creditValue === 'number'
        ? Math.max(0, Math.min(1000, Math.round(input.creditValue)))
        : creditsForPriority(priority, rules),
    goalId: input.goalId ? toObjectId(input.goalId) : undefined,
    habitId: input.habitId ? toObjectId(input.habitId) : undefined,
    status: 'TODO',
  });
}

export type UpdateTaskInput = Partial<Omit<CreateTaskInput, 'title'>> & { title?: string };

export async function update(
  userId: string,
  id: string,
  patch: UpdateTaskInput,
): Promise<TaskHydrated> {
  const task = await findOwned(Task, id, userId, 'That task');

  Object.assign(task, {
    ...patch,
    goalId: 'goalId' in patch ? (patch.goalId ? toObjectId(patch.goalId) : undefined) : task.goalId,
    habitId:
      'habitId' in patch ? (patch.habitId ? toObjectId(patch.habitId) : undefined) : task.habitId,
  });

  await task.save();
  return task;
}

export async function remove(userId: string, id: string): Promise<void> {
  const task = await findOwned(Task, id, userId, 'That task');

  // The task, the credits it earned and its timeline entry go together.
  await withTransaction(async (session) => {
    await credits.revoke(userId, ledgerRef(id), session);
    await removeDerivedActivity(userId, ledgerRef(id), session);
    await Task.deleteOne({ _id: task._id }, session ? { session } : {});
  });
}

export interface CompletionResult {
  task: TaskHydrated;
  creditsAwarded: number;
  balance: number;
}

/**
 * Complete a task (spec section 8).
 *
 *   claim the task → award credits → add to the timeline
 *
 * The status flip is an atomic compare-and-set, so exactly one caller can ever
 * win the race; the two writes that follow are keyed on a stable sourceRef and
 * are therefore idempotent. Replaying the request — a retry, a double tap, two
 * concurrent calls — converges on the same single payout, and a request that
 * died halfway repairs itself the next time it runs.
 */
export async function complete(userId: string, id: string): Promise<CompletionResult> {
  const existing = await findOwned(Task, id, userId, 'That task');
  const completedAt = existing.completedAt ?? new Date();
  const minutes = existing.estimatedMinutes ?? 30;
  const ref = ledgerRef(id);

  const claimed = await Task.findOneAndUpdate(
    { _id: existing._id, userId: toObjectId(userId), status: { $ne: 'COMPLETED' } },
    { $set: { status: 'COMPLETED', completedAt } },
    { returnDocument: 'after' },
  );

  const task = claimed ?? existing;
  const wasAlreadyComplete = claimed === null;

  await credits.record(userId, {
    amount: task.creditValue,
    type: 'TASK_COMPLETION',
    description: task.title,
    sourceRef: ref,
    createdAt: completedAt,
  });

  await upsertDerivedActivity({
    userId,
    sourceRef: ref,
    source: 'TASK',
    title: task.title,
    icon: CATEGORY_ICONS[task.category] ?? '✨',
    category: task.category,
    startTime: new Date(completedAt.getTime() - minutes * 60_000),
    endTime: completedAt,
    durationMinutes: minutes,
    creditsEarned: task.creditValue,
  });

  return {
    task,
    creditsAwarded: wasAlreadyComplete ? 0 : task.creditValue,
    balance: await credits.getBalance(userId),
  };
}

/** Undo a completion, removing the credits and the timeline entry with it. */
export async function uncomplete(userId: string, id: string): Promise<CompletionResult> {
  const task = await findOwned(Task, id, userId, 'That task');

  if (task.status !== 'COMPLETED') {
    return { task, creditsAwarded: 0, balance: await credits.getBalance(userId) };
  }

  const refunded = task.creditValue;

  await withTransaction(async (session) => {
    task.status = 'TODO';
    task.completedAt = undefined;
    await task.save({ session });

    await credits.revoke(userId, ledgerRef(id), session);
    await removeDerivedActivity(userId, ledgerRef(id), session);
  });

  return { task, creditsAwarded: -refunded, balance: await credits.getBalance(userId) };
}

/** Tasks that count toward a given day: due that day, or completed that day. */
export async function forDay(userId: string, dateKey: string): Promise<TaskHydrated[]> {
  const { start, end } = dayBounds(dateKey);

  return Task.find({
    userId: toObjectId(userId),
    status: { $ne: 'CANCELLED' },
    $or: [{ dueDate: dateKey }, { completedAt: { $gte: start, $lt: end } }],
  });
}
