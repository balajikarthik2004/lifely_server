import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { baseSchemaOptions } from '@/common/utils/model';
import { CREDIT_TYPES, type CreditType } from '@/domain/credits';

export interface CreditTransactionDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  amount: number;
  type: CreditType;
  /**
   * What caused this entry: a task id, `habitId:yyyy-MM-dd`, a milestone id, a
   * redemption id. Unique per user so an action can never be paid out twice.
   */
  sourceRef?: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

const creditTransactionSchema = new Schema<CreditTransactionDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true },
    type: { type: String, enum: CREDIT_TYPES, required: true },
    sourceRef: { type: String },
    description: { type: String, required: true, trim: true, maxlength: 300 },
  },
  baseSchemaOptions,
);

creditTransactionSchema.index({ userId: 1, createdAt: -1 });

/**
 * The idempotency guarantee.
 *
 * A partial unique index over (userId, sourceRef) makes a duplicate payout a
 * database-level error rather than something the application has to remember to
 * check. Adjustments carry no sourceRef and are exempt.
 */
creditTransactionSchema.index(
  { userId: 1, sourceRef: 1 },
  { unique: true, partialFilterExpression: { sourceRef: { $type: 'string' } } },
);

export const CreditTransaction: Model<CreditTransactionDocument> = model<CreditTransactionDocument>(
  'CreditTransaction',
  creditTransactionSchema,
);

export type CreditTransactionHydrated = HydratedDocument<CreditTransactionDocument>;
