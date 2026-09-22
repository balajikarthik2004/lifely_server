import { Types, type ClientSession } from 'mongoose';

import { InsufficientCreditsError } from '@/common/errors';
import { dayBounds, lastNDayKeys, todayKey } from '@/common/utils/dates';
import { isDuplicateKeyError } from '@/common/utils/transaction';
import type { CreditType } from '@/domain/credits';
import { CreditTransaction, type CreditTransactionHydrated } from './creditTransaction.model';

/**
 * The credit engine (spec section 18).
 *
 * Every credit movement in the system goes through this service. Nothing else
 * writes to the ledger, and no balance is stored anywhere — the balance is
 * always derived by summing the ledger, so the two cannot drift apart.
 *
 *   Action → CreditService → CreditTransaction → (derived) balance → analytics
 */

export interface RecordInput {
  amount: number;
  type: CreditType;
  description: string;
  /** Idempotency key. Two records with the same (user, sourceRef) cannot both exist. */
  sourceRef?: string;
  createdAt?: Date;
}

export interface CreditSummary {
  balance: number;
  today: number;
  week: number;
  month: number;
  lifetime: number;
}

function oid(userId: string): Types.ObjectId {
  return new Types.ObjectId(userId);
}

/**
 * Append one entry to the ledger.
 *
 * Idempotent: if an entry already exists for this `sourceRef` the existing one
 * is returned untouched rather than paying out twice. That guarantee is
 * enforced by a unique index, so a double-tap or a retried request is safe even
 * if two requests race.
 */
export async function record(
  userId: string,
  input: RecordInput,
  session?: ClientSession,
): Promise<CreditTransactionHydrated> {
  const amount = Math.round(input.amount);

  // Cheap guard first: an entry for this source already exists, so there is
  // nothing to pay. The unique index below is the backstop for a genuine race;
  // this check keeps us correct even on a deployment whose indexes are still
  // building.
  if (input.sourceRef) {
    const existing = await CreditTransaction.findOne({
      userId: oid(userId),
      sourceRef: input.sourceRef,
    }).session(session ?? null);
    if (existing) return existing;
  }

  try {
    const [created] = await CreditTransaction.create(
      [
        {
          userId: oid(userId),
          amount,
          type: input.type,
          description: input.description,
          sourceRef: input.sourceRef,
          ...(input.createdAt ? { createdAt: input.createdAt } : {}),
        },
      ],
      session ? { session } : {},
    );
    return created;
  } catch (error) {
    if (isDuplicateKeyError(error) && input.sourceRef) {
      const existing = await CreditTransaction.findOne({
        userId: oid(userId),
        sourceRef: input.sourceRef,
      }).session(session ?? null);
      if (existing) return existing;
    }
    throw error;
  }
}

/**
 * Remove the ledger entries an action created, used when that action is undone
 * (un-completing a task, unticking a habit, deleting an activity). The entry
 * and the thing that caused it always disappear together.
 */
export async function revoke(
  userId: string,
  sourceRef: string,
  session?: ClientSession,
): Promise<number> {
  const result = await CreditTransaction.deleteMany(
    { userId: oid(userId), sourceRef },
    session ? { session } : {},
  );
  return result.deletedCount ?? 0;
}

export async function getBalance(userId: string, session?: ClientSession): Promise<number> {
  const [row] = await CreditTransaction.aggregate<{ total: number }>([
    { $match: { userId: oid(userId) } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]).session(session ?? null);

  return row?.total ?? 0;
}

/**
 * Spend credits. Refuses rather than allowing a negative balance.
 *
 * The caller is expected to wrap this in a transaction along with whatever it
 * is paying for, so the check and the debit cannot be split by a concurrent
 * request.
 */
export async function spend(
  userId: string,
  input: { amount: number; description: string; sourceRef: string; type?: CreditType },
  session?: ClientSession,
): Promise<CreditTransactionHydrated> {
  const cost = Math.round(Math.abs(input.amount));
  const balance = await getBalance(userId, session);

  if (balance < cost) {
    throw new InsufficientCreditsError(cost - balance);
  }

  return record(
    userId,
    {
      amount: -cost,
      type: input.type ?? 'REWARD_REDEMPTION',
      description: input.description,
      sourceRef: input.sourceRef,
    },
    session,
  );
}

export async function getSummary(userId: string): Promise<CreditSummary> {
  const userObjectId = oid(userId);
  const today = todayKey();
  const { start: todayStart } = dayBounds(today);
  const weekStart = dayBounds(lastNDayKeys(7)[0]).start;
  const monthStart = dayBounds(lastNDayKeys(30)[0]).start;

  const [row] = await CreditTransaction.aggregate<{
    balance: number;
    today: number;
    week: number;
    month: number;
    lifetime: number;
  }>([
    { $match: { userId: userObjectId } },
    {
      $group: {
        _id: null,
        balance: { $sum: '$amount' },
        lifetime: { $sum: { $cond: [{ $gt: ['$amount', 0] }, '$amount', 0] } },
        today: { $sum: { $cond: [{ $gte: ['$createdAt', todayStart] }, '$amount', 0] } },
        week: { $sum: { $cond: [{ $gte: ['$createdAt', weekStart] }, '$amount', 0] } },
        month: { $sum: { $cond: [{ $gte: ['$createdAt', monthStart] }, '$amount', 0] } },
      },
    },
  ]);

  return {
    balance: row?.balance ?? 0,
    today: row?.today ?? 0,
    week: row?.week ?? 0,
    month: row?.month ?? 0,
    lifetime: row?.lifetime ?? 0,
  };
}

export async function listTransactions(
  userId: string,
  options: { limit: number; cursor?: string },
): Promise<CreditTransactionHydrated[]> {
  const filter: Record<string, unknown> = { userId: oid(userId) };
  if (options.cursor && Types.ObjectId.isValid(options.cursor)) {
    filter._id = { $lt: new Types.ObjectId(options.cursor) };
  }

  return CreditTransaction.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    // One extra row tells the caller whether another page exists.
    .limit(options.limit + 1);
}

/** Credits earned per calendar day across a window, for the analytics charts. */
export async function creditsByDay(
  userId: string,
  dateKeys: string[],
): Promise<Record<string, number>> {
  if (dateKeys.length === 0) return {};

  const { start } = dayBounds(dateKeys[0]);
  const { end } = dayBounds(dateKeys[dateKeys.length - 1]);

  const rows = await CreditTransaction.aggregate<{ _id: string; total: number }>([
    { $match: { userId: oid(userId), createdAt: { $gte: start, $lt: end } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
        total: { $sum: '$amount' },
      },
    },
  ]);

  const totals: Record<string, number> = Object.fromEntries(dateKeys.map((key) => [key, 0]));
  rows.forEach((row) => {
    if (row._id in totals) totals[row._id] = row.total;
  });
  return totals;
}

/** Total credits attributable to a set of ledger keys (e.g. one goal's milestones). */
export async function getCreditsForRefs(userId: string, refs: string[]): Promise<number> {
  if (refs.length === 0) return 0;

  const [row] = await CreditTransaction.aggregate<{ total: number }>([
    { $match: { userId: oid(userId), sourceRef: { $in: refs } } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);

  return row?.total ?? 0;
}
