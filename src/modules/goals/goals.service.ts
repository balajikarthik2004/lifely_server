import { NotFoundError } from '@/common/errors';
import { findOwned, toObjectId } from '@/common/utils/ownership';
import { withTransaction } from '@/common/utils/transaction';
import { DEFAULT_CREDIT_RULES } from '@/domain/credits';
import { averageGoalProgress, goalProgress } from '@/domain/goals';
import { Habit } from '@/modules/habits/habit.model';
import * as credits from '@/modules/credits/credits.service';
import { Task } from '@/modules/tasks/task.model';
import { User } from '@/modules/users/user.model';
import { Goal, type GoalDocument, type GoalHydrated } from './goal.model';

export type { GoalDocument, GoalHydrated };

const ledgerRef = (milestoneId: string) => `milestone:${milestoneId}`;

export interface GoalWithProgress {
  goal: GoalHydrated;
  progress: number;
}

function decorate(goal: GoalHydrated): GoalWithProgress {
  return { goal, progress: goalProgress(goal) };
}

export async function list(userId: string, status?: string): Promise<GoalWithProgress[]> {
  const query: Record<string, unknown> = { userId: toObjectId(userId) };
  if (status) query.status = status;

  const goals = await Goal.find(query).sort({ createdAt: -1 });
  return goals.map(decorate);
}

export async function averageProgress(userId: string): Promise<number> {
  const goals = await Goal.find({ userId: toObjectId(userId) });
  return averageGoalProgress(goals);
}

/** The goal detail screen: the goal plus everything pointing at it. */
export async function getDetail(userId: string, id: string) {
  const goal = await findOwned(Goal, id, userId, 'That goal');
  const owner = toObjectId(userId);

  const [tasks, habits, milestoneCredits] = await Promise.all([
    Task.find({ userId: owner, goalId: goal._id }).sort({ createdAt: -1 }),
    Habit.find({ userId: owner, goalId: goal._id }),
    credits.getCreditsForRefs(
      userId,
      goal.milestones.map((m) => ledgerRef(String(m._id))),
    ),
  ]);

  return {
    goal,
    progress: goalProgress(goal),
    tasks,
    habits,
    tasksCompleted: tasks.filter((t) => t.status === 'COMPLETED').length,
    creditsEarned: milestoneCredits,
  };
}

export interface CreateGoalInput {
  title: string;
  why?: string;
  icon?: string;
  category?: GoalDocument['category'];
  targetValue?: number;
  currentValue?: number;
  unit?: string;
  deadline?: string;
  milestones?: { title: string }[];
}

export async function create(userId: string, input: CreateGoalInput): Promise<GoalWithProgress> {
  const goal = await Goal.create({
    ...input,
    userId: toObjectId(userId),
    milestones: (input.milestones ?? []).map((m) => ({ title: m.title, isCompleted: false })),
  });
  return decorate(goal);
}

export async function update(
  userId: string,
  id: string,
  patch: Partial<Omit<CreateGoalInput, 'milestones'>> & { status?: GoalDocument['status'] },
): Promise<GoalWithProgress> {
  const goal = await findOwned(Goal, id, userId, 'That goal');
  Object.assign(goal, patch);
  await goal.save();
  return decorate(goal);
}

export async function remove(userId: string, id: string): Promise<void> {
  const goal = await findOwned(Goal, id, userId, 'That goal');
  const owner = toObjectId(userId);

  await withTransaction(async (session) => {
    const refs = goal.milestones.map((m) => ledgerRef(String(m._id)));
    await Promise.all(refs.map((ref) => credits.revoke(userId, ref, session)));

    // Tasks and habits survive; they are simply unlinked.
    await Task.updateMany(
      { userId: owner, goalId: goal._id },
      { $unset: { goalId: '' } },
      session ? { session } : {},
    );
    await Habit.updateMany(
      { userId: owner, goalId: goal._id },
      { $unset: { goalId: '' } },
      session ? { session } : {},
    );
    await Goal.deleteOne({ _id: goal._id }, session ? { session } : {});
  });
}

export async function addMilestone(
  userId: string,
  id: string,
  title: string,
): Promise<GoalWithProgress> {
  const goal = await findOwned(Goal, id, userId, 'That goal');
  goal.milestones.push({ title, isCompleted: false } as never);
  await goal.save();
  return decorate(goal);
}

export async function removeMilestone(
  userId: string,
  id: string,
  milestoneId: string,
): Promise<GoalWithProgress> {
  const goal = await findOwned(Goal, id, userId, 'That goal');
  const milestone = goal.milestones.id(milestoneId);
  if (!milestone) throw new NotFoundError('That milestone');

  await withTransaction(async (session) => {
    await credits.revoke(userId, ledgerRef(milestoneId), session);
    goal.milestones.pull({ _id: milestone._id });
    await goal.save({ session });
  });

  return decorate(goal);
}

export interface MilestoneResult extends GoalWithProgress {
  creditsAwarded: number;
  balance: number;
}

/** Reaching a milestone pays out once; unticking it takes the payout back. */
export async function setMilestone(
  userId: string,
  id: string,
  milestoneId: string,
  isCompleted: boolean,
): Promise<MilestoneResult> {
  const goal = await findOwned(Goal, id, userId, 'That goal');
  const milestone = goal.milestones.id(milestoneId);
  if (!milestone) throw new NotFoundError('That milestone');

  if (milestone.isCompleted === isCompleted) {
    return { ...decorate(goal), creditsAwarded: 0, balance: await credits.getBalance(userId) };
  }

  const user = await User.findById(userId);
  const award = user?.creditRules.goalMilestone ?? DEFAULT_CREDIT_RULES.goalMilestone;

  await withTransaction(async (session) => {
    milestone.isCompleted = isCompleted;
    milestone.completedAt = isCompleted ? new Date() : undefined;
    await goal.save({ session });

    if (isCompleted) {
      await credits.record(
        userId,
        {
          amount: award,
          type: 'GOAL_MILESTONE',
          description: `Milestone: ${milestone.title}`,
          sourceRef: ledgerRef(milestoneId),
        },
        session,
      );
    } else {
      await credits.revoke(userId, ledgerRef(milestoneId), session);
    }
  });

  return {
    ...decorate(goal),
    creditsAwarded: isCompleted ? award : -award,
    balance: await credits.getBalance(userId),
  };
}

/** Log progress against a numeric target. */
export async function logProgress(
  userId: string,
  id: string,
  amount: number,
): Promise<GoalWithProgress> {
  const goal = await findOwned(Goal, id, userId, 'That goal');
  goal.currentValue = Math.max(0, (goal.currentValue ?? 0) + amount);
  await goal.save();
  return decorate(goal);
}
