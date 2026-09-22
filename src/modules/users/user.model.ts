import bcrypt from 'bcryptjs';
import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { baseSchemaOptions } from '@/common/utils/model';
import { DEFAULT_CREDIT_RULES, type CreditRules } from '@/domain/credits';
import { DEFAULT_WEIGHTS, type LifeScoreWeights } from '@/domain/lifeScore';

const BCRYPT_ROUNDS = 12;

export interface UserProfile {
  name: string;
  statement: string;
  avatarEmoji: string;
  focusAreas: string[];
  wakeTime: string;
  workStart: string;
  workEnd: string;
  sleepTime: string;
}

export interface NotificationPrefs {
  morningBrief: boolean;
  habitReminders: boolean;
  focusReminders: boolean;
  eveningReflection: boolean;
  weeklyReview: boolean;
}

/** A hashed, revocable refresh token. Logging out deletes the row. */
export interface RefreshTokenRecord {
  jti: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  userAgent?: string;
}

export interface UserDocument {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  profile: UserProfile;
  creditRules: CreditRules;
  weights: LifeScoreWeights;
  notifications: NotificationPrefs;
  refreshTokens: RefreshTokenRecord[];
  onboarded: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidate: string): Promise<boolean>;
}

export type UserHydrated = HydratedDocument<UserDocument>;

const profileSchema = new Schema<UserProfile>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80, default: 'Friend' },
    statement: { type: String, trim: true, maxlength: 160, default: 'Building a better me.' },
    avatarEmoji: { type: String, default: '\u{1F331}', maxlength: 8 },
    focusAreas: { type: [String], default: ['WORK', 'HEALTH', 'LEARNING'] },
    wakeTime: { type: String, default: '06:30' },
    workStart: { type: String, default: '09:00' },
    workEnd: { type: String, default: '18:00' },
    sleepTime: { type: String, default: '22:30' },
  },
  { _id: false },
);

const creditRulesSchema = new Schema<CreditRules>(
  {
    taskLow: { type: Number, default: DEFAULT_CREDIT_RULES.taskLow },
    taskMedium: { type: Number, default: DEFAULT_CREDIT_RULES.taskMedium },
    taskHigh: { type: Number, default: DEFAULT_CREDIT_RULES.taskHigh },
    taskCritical: { type: Number, default: DEFAULT_CREDIT_RULES.taskCritical },
    focusPer30Min: { type: Number, default: DEFAULT_CREDIT_RULES.focusPer30Min },
    reflection: { type: Number, default: DEFAULT_CREDIT_RULES.reflection },
    streakBonusPerWeek: { type: Number, default: DEFAULT_CREDIT_RULES.streakBonusPerWeek },
    missedCriticalHabit: { type: Number, default: DEFAULT_CREDIT_RULES.missedCriticalHabit },
    goalMilestone: { type: Number, default: DEFAULT_CREDIT_RULES.goalMilestone },
  },
  { _id: false },
);

const weightsSchema = new Schema<LifeScoreWeights>(
  {
    tasks: { type: Number, default: DEFAULT_WEIGHTS.tasks },
    habits: { type: Number, default: DEFAULT_WEIGHTS.habits },
    goals: { type: Number, default: DEFAULT_WEIGHTS.goals },
    focus: { type: Number, default: DEFAULT_WEIGHTS.focus },
    health: { type: Number, default: DEFAULT_WEIGHTS.health },
    reflection: { type: Number, default: DEFAULT_WEIGHTS.reflection },
  },
  { _id: false },
);

const notificationsSchema = new Schema<NotificationPrefs>(
  {
    morningBrief: { type: Boolean, default: true },
    habitReminders: { type: Boolean, default: true },
    focusReminders: { type: Boolean, default: true },
    eveningReflection: { type: Boolean, default: true },
    weeklyReview: { type: Boolean, default: true },
  },
  { _id: false },
);

const refreshTokenSchema = new Schema<RefreshTokenRecord>(
  {
    jti: { type: String, required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    createdAt: { type: Date, default: () => new Date() },
    userAgent: { type: String, maxlength: 256 },
  },
  { _id: false },
);

const userSchema = new Schema<UserDocument>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    // `select: false` keeps the hash out of every query that does not ask for it.
    passwordHash: { type: String, required: true, select: false },
    profile: { type: profileSchema, default: () => ({}) },
    creditRules: { type: creditRulesSchema, default: () => ({}) },
    weights: { type: weightsSchema, default: () => ({}) },
    notifications: { type: notificationsSchema, default: () => ({}) },
    refreshTokens: { type: [refreshTokenSchema], default: [], select: false },
    onboarded: { type: Boolean, default: false },
    lastLoginAt: { type: Date },
  },
  {
    ...baseSchemaOptions,
    toJSON: {
      virtuals: true,
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = String(ret._id);
        delete ret._id;
        delete ret.passwordHash;
        delete ret.refreshTokens;
        return ret;
      },
    },
  },
);

userSchema.methods.comparePassword = function comparePassword(
  this: UserHydrated,
  candidate: string,
): Promise<boolean> {
  return bcrypt.compare(candidate, this.passwordHash);
};

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export const User: Model<UserDocument> = model<UserDocument>('User', userSchema);
