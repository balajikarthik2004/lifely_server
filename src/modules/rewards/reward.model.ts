import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { REWARD_CATEGORIES } from '@/common/constants';
import { baseSchemaOptions, subSchemaOptions } from '@/common/utils/model';

export interface RedemptionSubdoc {
  _id: Types.ObjectId;
  redeemedAt: Date;
  cost: number;
}

export interface RewardDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  title: string;
  description?: string;
  icon: string;
  creditCost: number;
  category: (typeof REWARD_CATEGORIES)[number];
  isActive: boolean;
  redemptions: Types.DocumentArray<RedemptionSubdoc>;
  createdAt: Date;
  updatedAt: Date;
}

const redemptionSchema = new Schema<RedemptionSubdoc>(
  {
    redeemedAt: { type: Date, default: () => new Date() },
    cost: { type: Number, required: true },
  },
  subSchemaOptions,
);

const rewardSchema = new Schema<RewardDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 1000 },
    icon: { type: String, default: '\u{1F381}', maxlength: 8 },
    creditCost: { type: Number, required: true, min: 1, max: 1_000_000 },
    category: { type: String, enum: REWARD_CATEGORIES, default: 'PERSONAL' },
    isActive: { type: Boolean, default: true },
    redemptions: { type: [redemptionSchema], default: [] },
  },
  baseSchemaOptions,
);

export const Reward: Model<RewardDocument> = model<RewardDocument>('Reward', rewardSchema);

export type RewardHydrated = HydratedDocument<RewardDocument>;
