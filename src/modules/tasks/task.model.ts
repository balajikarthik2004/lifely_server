import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { CATEGORIES, PRIORITIES, RECURRENCES, TASK_STATUSES } from '@/common/constants';
import { baseSchemaOptions } from '@/common/utils/model';

export interface TaskDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  title: string;
  description?: string;
  category: (typeof CATEGORIES)[number];
  priority: (typeof PRIORITIES)[number];
  status: (typeof TASK_STATUSES)[number];
  dueDate?: string;
  dueTime?: string;
  estimatedMinutes?: number;
  creditValue: number;
  goalId?: Types.ObjectId;
  habitId?: Types.ObjectId;
  recurrence: (typeof RECURRENCES)[number];
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const taskSchema = new Schema<TaskDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 2000 },
    category: { type: String, enum: CATEGORIES, default: 'WORK' },
    priority: { type: String, enum: PRIORITIES, default: 'MEDIUM' },
    status: { type: String, enum: TASK_STATUSES, default: 'TODO', index: true },
    dueDate: { type: String, index: true },
    dueTime: { type: String },
    estimatedMinutes: { type: Number, min: 0, max: 1440 },
    creditValue: { type: Number, required: true, min: 0, max: 1000 },
    goalId: { type: Schema.Types.ObjectId, ref: 'Goal', index: true },
    habitId: { type: Schema.Types.ObjectId, ref: 'Habit' },
    recurrence: { type: String, enum: RECURRENCES, default: 'NONE' },
    completedAt: { type: Date },
  },
  baseSchemaOptions,
);

// The dashboard's hot query: this user's open tasks for today, by priority.
taskSchema.index({ userId: 1, status: 1, dueDate: 1 });
taskSchema.index({ userId: 1, completedAt: -1 });

export const Task: Model<TaskDocument> = model<TaskDocument>('Task', taskSchema);

export type TaskHydrated = HydratedDocument<TaskDocument>;
