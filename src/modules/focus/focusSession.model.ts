import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { CATEGORIES } from '@/common/constants';
import { baseSchemaOptions } from '@/common/utils/model';

export interface FocusSessionDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  title: string;
  category: (typeof CATEGORIES)[number];
  taskId?: Types.ObjectId;
  targetMinutes: number;
  startedAt: Date;
  endedAt?: Date;
  /** Accumulated across pauses; the server recomputes it on finish. */
  completedMinutes: number;
  pausedAt?: Date;
  pausedMinutes: number;
  status: 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'ABANDONED';
  createdAt: Date;
  updatedAt: Date;
}

const focusSessionSchema = new Schema<FocusSessionDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    category: { type: String, enum: CATEGORIES, default: 'WORK' },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task' },
    targetMinutes: { type: Number, required: true, min: 1, max: 600 },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date },
    completedMinutes: { type: Number, default: 0, min: 0 },
    pausedAt: { type: Date },
    pausedMinutes: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['RUNNING', 'PAUSED', 'COMPLETED', 'ABANDONED'],
      default: 'RUNNING',
      index: true,
    },
  },
  baseSchemaOptions,
);

// At most one live session per user; enforced in the service and indexed here.
focusSessionSchema.index({ userId: 1, status: 1 });

export const FocusSession: Model<FocusSessionDocument> = model<FocusSessionDocument>(
  'FocusSession',
  focusSessionSchema,
);

export type FocusSessionHydrated = HydratedDocument<FocusSessionDocument>;
