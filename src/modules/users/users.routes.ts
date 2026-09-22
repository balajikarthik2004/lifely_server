import { Router } from 'express';
import { z } from 'zod';

import { CATEGORIES } from '@/common/constants';
import { NotFoundError } from '@/common/errors';
import { currentUserId, requireAuth } from '@/common/middleware/auth';
import { validate } from '@/common/middleware/validate';
import { toObjectId } from '@/common/utils/ownership';
import { seedDemoData } from './demoData';
import { clearOwnedData, ownedCollections } from './ownedCollections';
import { User } from './user.model';

const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time like 09:00');

const profileSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  statement: z.string().trim().max(160).optional(),
  avatarEmoji: z.string().max(8).optional(),
  focusAreas: z.array(z.enum(CATEGORIES)).max(8).optional(),
  wakeTime: timeString.optional(),
  workStart: timeString.optional(),
  workEnd: timeString.optional(),
  sleepTime: timeString.optional(),
});

const creditRulesSchema = z.object({
  taskLow: z.number().int().min(0).max(100).optional(),
  taskMedium: z.number().int().min(0).max(100).optional(),
  taskHigh: z.number().int().min(0).max(100).optional(),
  taskCritical: z.number().int().min(0).max(100).optional(),
  focusPer30Min: z.number().int().min(0).max(100).optional(),
  reflection: z.number().int().min(0).max(100).optional(),
  streakBonusPerWeek: z.number().int().min(0).max(50).optional(),
  missedCriticalHabit: z.number().int().min(-100).max(0).optional(),
  goalMilestone: z.number().int().min(0).max(200).optional(),
});

const weightsSchema = z.object({
  tasks: z.number().min(0).max(100).optional(),
  habits: z.number().min(0).max(100).optional(),
  goals: z.number().min(0).max(100).optional(),
  focus: z.number().min(0).max(100).optional(),
  health: z.number().min(0).max(100).optional(),
  reflection: z.number().min(0).max(100).optional(),
});

const notificationsSchema = z.object({
  morningBrief: z.boolean().optional(),
  habitReminders: z.boolean().optional(),
  focusReminders: z.boolean().optional(),
  eveningReflection: z.boolean().optional(),
  weeklyReview: z.boolean().optional(),
});

export const usersRouter = Router();

usersRouter.use(requireAuth);

usersRouter.get('/me', async (req, res) => {
  const user = await User.findById(currentUserId(req));
  if (!user) throw new NotFoundError('Your account');
  res.json(user);
});

usersRouter.patch(
  '/me',
  validate({
    body: z.object({
      profile: profileSchema.optional(),
      creditRules: creditRulesSchema.optional(),
      weights: weightsSchema.optional(),
      notifications: notificationsSchema.optional(),
      onboarded: z.boolean().optional(),
    }),
  }),
  async (req, res) => {
    const user = await User.findById(currentUserId(req));
    if (!user) throw new NotFoundError('Your account');

    const { profile, creditRules, weights, notifications, onboarded } = req.body;
    if (profile) Object.assign(user.profile, profile);
    if (creditRules) Object.assign(user.creditRules, creditRules);
    if (weights) Object.assign(user.weights, weights);
    if (notifications) Object.assign(user.notifications, notifications);
    if (typeof onboarded === 'boolean') user.onboarded = onboarded;

    await user.save();
    res.json(user);
  },
);

/**
 * Export everything this account holds (spec section 31).
 *
 * Data portability is a right, not a feature — no filtering, no summarising.
 */
usersRouter.get('/me/export', async (req, res) => {
  const userId = currentUserId(req);
  const owner = toObjectId(userId);

  const [user, ...rows] = await Promise.all([
    User.findById(userId),
    ...ownedCollections.map(([, model]) => model.find({ userId: owner })),
  ]);

  const payload: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    account: user,
  };
  ownedCollections.forEach(([name], index) => {
    payload[name] = rows[index];
  });

  res.setHeader('Content-Disposition', 'attachment; filename="lifely-export.json"');
  res.json(payload);
});

/**
 * Delete the account and everything in it (spec section 31). Irreversible, and
 * deliberately not soft — "delete my data" has to mean it.
 */
usersRouter.delete('/me', async (req, res) => {
  const userId = currentUserId(req);
  const owner = toObjectId(userId);

  await clearOwnedData(owner);
  await User.deleteOne({ _id: owner });

  res.status(204).send();
});

/**
 * Replace this account's history with the demo fortnight, so the app's "load
 * sample data" produces a real ledger rather than a fabricated one.
 */
usersRouter.post('/me/demo-data', async (req, res) => {
  await seedDemoData(currentUserId(req));
  res.status(204).send();
});

/** Erase everything in the account without deleting the account itself. */
usersRouter.post('/me/reset', async (req, res) => {
  const userId = currentUserId(req);
  await clearOwnedData(toObjectId(userId));
  await User.updateOne({ _id: toObjectId(userId) }, { $set: { onboarded: false } });
  res.status(204).send();
});
