import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { CATEGORIES, GOAL_STATUSES } from '@/common/constants';
import { baseSchemaOptions, subSchemaOptions } from '@/common/utils/model';

export interface MilestoneSubdoc {
  _id: Types.ObjectId;
  title: string;
  isCompleted: boolean;
  completedAt?: Date;
}

export interface GoalDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  title: string;
  why?: string;
  icon: string;
  category: (typeof CATEGORIES)[number];
  targetValue?: number;
  currentValue: number;
  unit?: string;
  deadline?: string;
  milestones: Types.DocumentArray<MilestoneSubdoc>;
  status: (typeof GOAL_STATUSES)[number];
  createdAt: Date;
  updatedAt: Date;
}

const milestoneSchema = new Schema<MilestoneSubdoc>(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    isCompleted: { type: Boolean, default: false },
    completedAt: { type: Date },
  },
  subSchemaOptions,
);

const goalSchema = new Schema<GoalDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    why: { type: String, trim: true, maxlength: 2000 },
    icon: { type: String, default: '\u{1F3AF}', maxlength: 8 },
    category: { type: String, enum: CATEGORIES, default: 'PERSONAL' },
    targetValue: { type: Number, min: 0 },
    currentValue: { type: Number, default: 0, min: 0 },
    unit: { type: String, trim: true, maxlength: 24 },
    deadline: { type: String },
    milestones: { type: [milestoneSchema], default: [] },
    status: { type: String, enum: GOAL_STATUSES, default: 'ACTIVE', index: true },
  },
  baseSchemaOptions,
);

goalSchema.index({ userId: 1, status: 1 });

export const Goal: Model<GoalDocument> = model<GoalDocument>('Goal', goalSchema);

export type GoalHydrated = HydratedDocument<GoalDocument>;
