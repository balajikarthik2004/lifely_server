import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { ACTIVITY_SOURCES, CATEGORIES } from '@/common/constants';
import { baseSchemaOptions } from '@/common/utils/model';

export interface ActivityDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  title: string;
  icon: string;
  category: (typeof CATEGORIES)[number];
  startTime: Date;
  endTime?: Date;
  durationMinutes: number;
  source: (typeof ACTIVITY_SOURCES)[number];
  /** Links an activity back to the task / habit-day / focus session that made it. */
  sourceRef?: string;
  creditsEarned: number;
  mood?: number;
  energy?: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const activitySchema = new Schema<ActivityDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    icon: { type: String, default: '\u2728', maxlength: 8 },
    category: { type: String, enum: CATEGORIES, default: 'OTHER', index: true },
    startTime: { type: Date, required: true, index: true },
    endTime: { type: Date },
    durationMinutes: { type: Number, default: 0, min: 0, max: 1440 },
    source: { type: String, enum: ACTIVITY_SOURCES, default: 'MANUAL' },
    sourceRef: { type: String, index: true },
    creditsEarned: { type: Number, default: 0 },
    mood: { type: Number, min: 1, max: 5 },
    energy: { type: Number, min: 1, max: 5 },
    notes: { type: String, trim: true, maxlength: 2000 },
  },
  baseSchemaOptions,
);

// The timeline query: one user's day, in order.
activitySchema.index({ userId: 1, startTime: -1 });

/**
 * A derived activity (from a task, a habit-day or a focus session) exists at
 * most once. Manual entries carry no sourceRef and are exempt, so the index is
 * partial. This is what makes replaying a completion safe.
 */
activitySchema.index(
  { userId: 1, sourceRef: 1 },
  { unique: true, partialFilterExpression: { sourceRef: { $type: 'string' } } },
);

export const Activity: Model<ActivityDocument> = model<ActivityDocument>('Activity', activitySchema);

export type ActivityHydrated = HydratedDocument<ActivityDocument>;
