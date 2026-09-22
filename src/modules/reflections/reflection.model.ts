import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { baseSchemaOptions } from '@/common/utils/model';

export interface ReflectionDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  date: string;
  wentWell?: string;
  couldBeBetter?: string;
  learned?: string;
  tomorrow?: string;
  mood: number;
  energy: number;
  createdAt: Date;
  updatedAt: Date;
}

const reflectionSchema = new Schema<ReflectionDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    date: { type: String, required: true },
    wentWell: { type: String, trim: true, maxlength: 4000 },
    couldBeBetter: { type: String, trim: true, maxlength: 4000 },
    learned: { type: String, trim: true, maxlength: 4000 },
    tomorrow: { type: String, trim: true, maxlength: 4000 },
    mood: { type: Number, required: true, min: 1, max: 5 },
    energy: { type: Number, required: true, min: 1, max: 5 },
  },
  baseSchemaOptions,
);

// One reflection per day per user -- an upsert, never a duplicate.
reflectionSchema.index({ userId: 1, date: 1 }, { unique: true });

export const Reflection: Model<ReflectionDocument> = model<ReflectionDocument>(
  'Reflection',
  reflectionSchema,
);

export type ReflectionHydrated = HydratedDocument<ReflectionDocument>;
