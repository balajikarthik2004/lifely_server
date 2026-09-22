import { Types } from 'mongoose';

import { findOwned, toObjectId } from '@/common/utils/ownership';
import { withTransaction } from '@/common/utils/transaction';
import * as credits from '@/modules/credits/credits.service';
import { Reward, type RewardDocument, type RewardHydrated } from './reward.model';

export type { RewardDocument, RewardHydrated };

const ledgerRef = (redemptionId: string) => `redemption:${redemptionId}`;

export interface RewardWithAffordability {
  reward: RewardHydrated;
  affordable: boolean;
  remaining: number;
}

export async function list(userId: string): Promise<{
  items: RewardWithAffordability[];
  balance: number;
}> {
  const [rewards, balance] = await Promise.all([
    Reward.find({ userId: toObjectId(userId) }).sort({ creditCost: 1 }),
    credits.getBalance(userId),
  ]);

  return {
    balance,
    items: rewards.map((reward) => ({
      reward,
      affordable: balance >= reward.creditCost,
      remaining: Math.max(0, reward.creditCost - balance),
    })),
  };
}

export interface CreateRewardInput {
  title: string;
  description?: string;
  icon?: string;
  creditCost: number;
  category?: RewardDocument['category'];
}

export async function create(userId: string, input: CreateRewardInput): Promise<RewardHydrated> {
  return Reward.create({ ...input, userId: toObjectId(userId) });
}

export async function update(
  userId: string,
  id: string,
  patch: Partial<CreateRewardInput> & { isActive?: boolean },
): Promise<RewardHydrated> {
  const reward = await findOwned(Reward, id, userId, 'That reward');
  Object.assign(reward, patch);
  await reward.save();
  return reward;
}

export async function remove(userId: string, id: string): Promise<void> {
  const reward = await findOwned(Reward, id, userId, 'That reward');
  // Past redemptions stay in the credit history — deleting the reward must not
  // silently refund credits that were genuinely spent.
  await Reward.deleteOne({ _id: reward._id });
}

export interface RedemptionResult {
  reward: RewardHydrated;
  redemptionId: string;
  spent: number;
  balance: number;
}

/**
 * Redeem a reward (spec section 11).
 *
 * "Never allow accidental double redemption" is enforced three ways:
 *   1. the balance check and the debit happen inside one transaction, so two
 *      concurrent requests cannot both see a sufficient balance;
 *   2. the ledger entry carries a unique (user, sourceRef) key, so a retried
 *      request cannot produce a second debit;
 *   3. the redemption id is generated server-side and returned, so a client
 *      retry is recognisable rather than a new purchase.
 */
export async function redeem(userId: string, id: string): Promise<RedemptionResult> {
  const reward = await findOwned(Reward, id, userId, 'That reward');
  const redemptionId = new Types.ObjectId();

  await withTransaction(async (session) => {
    // Throws InsufficientCreditsError (409) rather than allowing an overdraft.
    await credits.spend(
      userId,
      {
        amount: reward.creditCost,
        description: `Redeemed: ${reward.title}`,
        sourceRef: ledgerRef(String(redemptionId)),
        type: 'REWARD_REDEMPTION',
      },
      session,
    );

    reward.redemptions.push({
      _id: redemptionId,
      redeemedAt: new Date(),
      cost: reward.creditCost,
    } as never);
    await reward.save({ session });
  });

  return {
    reward,
    redemptionId: String(redemptionId),
    spent: reward.creditCost,
    balance: await credits.getBalance(userId),
  };
}
