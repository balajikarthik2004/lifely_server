import { ConflictError, NotFoundError } from '@/common/errors';
import { toObjectId } from '@/common/utils/ownership';
import { withTransaction } from '@/common/utils/transaction';
import { DEFAULT_CREDIT_RULES, creditsForFocus } from '@/domain/credits';
import { Activity } from '@/modules/activities/activity.model';
import * as credits from '@/modules/credits/credits.service';
import { User } from '@/modules/users/user.model';
import { FocusSession, type FocusSessionDocument, type FocusSessionHydrated } from './focusSession.model';

export type { FocusSessionDocument, FocusSessionHydrated };

const ledgerRef = (sessionId: string) => `focus:${sessionId}`;

/**
 * Elapsed minutes, measured from the stored start time minus any paused time.
 *
 * The client never tells the server how long it focused — it could be wrong,
 * and it could be lying. The server derives it from timestamps it wrote itself.
 */
export function elapsedMinutes(session: FocusSessionHydrated, now = new Date()): number {
  const until = session.status === 'PAUSED' && session.pausedAt ? session.pausedAt : now;
  const gross = (until.getTime() - session.startedAt.getTime()) / 60_000;
  return Math.max(0, Math.round(gross - session.pausedMinutes));
}

export async function getActive(userId: string): Promise<FocusSessionHydrated | null> {
  return FocusSession.findOne({
    userId: toObjectId(userId),
    status: { $in: ['RUNNING', 'PAUSED'] },
  });
}

export async function start(
  userId: string,
  input: { title: string; category?: FocusSessionDocument['category']; targetMinutes: number; taskId?: string },
): Promise<FocusSessionHydrated> {
  const existing = await getActive(userId);
  if (existing) {
    throw new ConflictError('A focus session is already running. Finish or discard it first.');
  }

  return FocusSession.create({
    userId: toObjectId(userId),
    title: input.title,
    category: input.category ?? 'WORK',
    targetMinutes: input.targetMinutes,
    taskId: input.taskId ? toObjectId(input.taskId) : undefined,
    startedAt: new Date(),
    status: 'RUNNING',
  });
}

async function requireActive(userId: string): Promise<FocusSessionHydrated> {
  const session = await getActive(userId);
  if (!session) throw new NotFoundError('An active focus session');
  return session;
}

export async function pause(userId: string): Promise<FocusSessionHydrated> {
  const session = await requireActive(userId);
  if (session.status === 'PAUSED') return session;

  session.status = 'PAUSED';
  session.pausedAt = new Date();
  session.completedMinutes = elapsedMinutes(session);
  await session.save();
  return session;
}

export async function resume(userId: string): Promise<FocusSessionHydrated> {
  const session = await requireActive(userId);
  if (session.status === 'RUNNING') return session;

  if (session.pausedAt) {
    session.pausedMinutes += Math.max(
      0,
      Math.round((Date.now() - session.pausedAt.getTime()) / 60_000),
    );
  }
  session.status = 'RUNNING';
  session.pausedAt = undefined;
  await session.save();
  return session;
}

export interface FinishResult {
  session: FocusSessionHydrated;
  minutes: number;
  creditsAwarded: number;
  balance: number;
}

/** Finish a session: log the timeline entry and pay out for the time spent. */
export async function finish(userId: string): Promise<FinishResult> {
  const session = await requireActive(userId);
  const user = await User.findById(userId);
  const rules = user?.creditRules ?? DEFAULT_CREDIT_RULES;

  const endedAt = new Date();
  const minutes = elapsedMinutes(session, endedAt);
  const awarded = creditsForFocus(minutes, rules);
  const ref = ledgerRef(String(session._id));

  await withTransaction(async (txn) => {
    session.status = 'COMPLETED';
    session.endedAt = endedAt;
    session.completedMinutes = minutes;
    await session.save({ session: txn });

    await Activity.create(
      [
        {
          userId: toObjectId(userId),
          title: session.title,
          icon: '⏱️',
          category: session.category,
          startTime: session.startedAt,
          endTime: endedAt,
          durationMinutes: minutes,
          source: 'FOCUS',
          sourceRef: ref,
          creditsEarned: awarded,
        },
      ],
      txn ? { session: txn } : {},
    );

    if (awarded > 0) {
      await credits.record(
        userId,
        {
          amount: awarded,
          type: 'FOCUS_SESSION',
          description: `Focus: ${session.title} (${minutes}m)`,
          sourceRef: ref,
          createdAt: endedAt,
        },
        txn,
      );
    }
  });

  return { session, minutes, creditsAwarded: awarded, balance: await credits.getBalance(userId) };
}

/** Abandon a session: nothing is logged and nothing is paid. */
export async function abandon(userId: string): Promise<void> {
  const session = await getActive(userId);
  if (!session) return;

  session.status = 'ABANDONED';
  session.endedAt = new Date();
  session.completedMinutes = elapsedMinutes(session);
  await session.save();
}

export async function history(userId: string, limit = 30): Promise<FocusSessionHydrated[]> {
  return FocusSession.find({ userId: toObjectId(userId), status: 'COMPLETED' })
    .sort({ endedAt: -1 })
    .limit(limit);
}
