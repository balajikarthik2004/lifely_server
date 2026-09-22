import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { CATEGORIES, HABIT_FREQUENCIES } from '@/common/constants';
import { baseSchemaOptions } from '@/common/utils/model';
import type { HabitDayEntry } from '@/domain/habits';

export interface HabitDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  description?: string;
  icon: string;
  category: (typeof CATEGORIES)[number];
  frequency: (typeof HABIT_FREQUENCIES)[number];
  days: number[];
  targetCount: number;
  creditValue: number;
  reminderTime?: string;
  goalId?: Types.ObjectId;
  isActive: boolean;
  /** Date-keyed log, 'yyyy-MM-dd' -> COMPLETED | SKIPPED. */
  log: Map<string, HabitDayEntry>;
  createdAt: Date;
  updatedAt: Date;
}

const habitSchema = new Schema<HabitDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 1000 },
    icon: { type: String, default: '\u2B50', maxlength: 8 },
    category: { type: String, enum: CATEGORIES, default: 'PERSONAL' },
    frequency: { type: String, enum: HABIT_FREQUENCIES, default: 'DAILY' },
    days: { type: [Number], default: [0, 1, 2, 3, 4, 5, 6] },
    targetCount: { type: Number, default: 1, min: 1, max: 100 },
    creditValue: { type: Number, default: 5, min: 0, max: 1000 },
    reminderTime: { type: String },
    goalId: { type: Schema.Types.ObjectId, ref: 'Goal', index: true },
    isActive: { type: Boolean, default: true },
    log: {
      type: Map,
      of: { type: String, enum: ['COMPLETED', 'SKIPPED'] },
      default: () => new Map<string, HabitDayEntry>(),
    },
  },
  baseSchemaOptions,
);

habitSchema.index({ userId: 1, isActive: 1 });

export const Habit: Model<HabitDocument> = model<HabitDocument>('Habit', habitSchema);

export type HabitHydrated = HydratedDocument<HabitDocument>;
