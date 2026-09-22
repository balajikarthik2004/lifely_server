import { toObjectId } from '@/common/utils/ownership';
import { todayKey } from '@/common/utils/dates';
import { NotFoundError } from '@/common/errors';
import { DEFAULT_CREDIT_RULES } from '@/domain/credits';
import * as credits from '@/modules/credits/credits.service';
import { User } from '@/modules/users/user.model';
import { Reflection, type ReflectionDocument, type ReflectionHydrated } from './reflection.model';

export type { ReflectionDocument, ReflectionHydrated };

const ledgerRef = (userId: string, dateKey: string) => `reflection:${userId}:${dateKey}`;

export interface SaveReflectionInput {
  date?: string;
  wentWell?: string;
  couldBeBetter?: string;
  learned?: string;
  tomorrow?: string;
  mood: number;
  energy: number;
}

export async function list(userId: string, limit = 60): Promise<ReflectionHydrated[]> {
  return Reflection.find({ userId: toObjectId(userId) }).sort({ date: -1 }).limit(limit);
}

export async function getByDate(userId: string, dateKey: string): Promise<ReflectionHydrated> {
  const reflection = await Reflection.findOne({ userId: toObjectId(userId), date: dateKey });
  if (!reflection) throw new NotFoundError('A reflection for that day');
  return reflection;
}

export async function hasReflection(userId: string, dateKey: string): Promise<boolean> {
  return (await Reflection.exists({ userId: toObjectId(userId), date: dateKey })) !== null;
}

export interface SaveResult {
  reflection: ReflectionHydrated;
  creditsAwarded: number;
  balance: number;
}

/**
 * Save or update the day's reflection.
 *
 * Upserted on (user, date), so there is exactly one per day. The credit is paid
 * on the first save only — editing what you wrote does not pay again, which the
 * ledger's unique key enforces rather than a flag we have to remember to check.
 */
export async function save(userId: string, input: SaveReflectionInput): Promise<SaveResult> {
  const date = input.date ?? todayKey();
  const owner = toObjectId(userId);

  const reflection = await Reflection.findOneAndUpdate(
    { userId: owner, date },
    { $set: { ...input, date, userId: owner } },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
  );

  const user = await User.findById(userId);
  const award = user?.creditRules.reflection ?? DEFAULT_CREDIT_RULES.reflection;

  const before = await credits.getBalance(userId);
  await credits.record(userId, {
    amount: award,
    type: 'REFLECTION',
    description: 'Daily reflection',
    sourceRef: ledgerRef(userId, date),
    createdAt: new Date(`${date}T21:00:00.000Z`),
  });
  const balance = await credits.getBalance(userId);

  return { reflection, creditsAwarded: balance - before, balance };
}

export async function remove(userId: string, dateKey: string): Promise<void> {
  const result = await Reflection.deleteOne({ userId: toObjectId(userId), date: dateKey });
  if (result.deletedCount === 0) throw new NotFoundError('A reflection for that day');
  await credits.revoke(userId, ledgerRef(userId, dateKey));
}
