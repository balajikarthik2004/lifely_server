import { Router } from 'express';
import { z } from 'zod';

import { CATEGORIES } from '@/common/constants';
import { currentUserId, requireAuth } from '@/common/middleware/auth';
import { validate } from '@/common/middleware/validate';
import { param } from '@/common/utils/request';
import { dateKeySchema, todayKey } from '@/common/utils/dates';
import * as activities from './activities.service';

const idParam = z.object({ id: z.string().min(1) });

const createSchema = z.object({
  title: z.string().trim().min(1, 'What did you do?').max(200),
  icon: z.string().max(8).optional(),
  category: z.enum(CATEGORIES).optional(),
  startTime: z.iso.datetime().optional(),
  endTime: z.iso.datetime().optional(),
  durationMinutes: z.number().int().min(1).max(1440).optional(),
  creditsEarned: z.number().int().min(0).max(60).optional(),
  mood: z.number().int().min(1).max(5).optional(),
  energy: z.number().int().min(1).max(5).optional(),
  notes: z.string().trim().max(2000).optional(),
});

const listSchema = z.object({
  date: dateKeySchema.optional(),
  from: dateKeySchema.optional(),
  to: dateKeySchema.optional(),
});

export const activitiesRouter = Router();

activitiesRouter.use(requireAuth);

activitiesRouter.get('/', validate({ query: listSchema }), async (req, res) => {
  const userId = currentUserId(req);
  const { date, from, to } = req.query as { date?: string; from?: string; to?: string };

  const items =
    from && to
      ? await activities.forRange(userId, from, to)
      : await activities.forDay(userId, date ?? todayKey());

  // Untracked gaps are computed here rather than in the client, so every
  // surface agrees on what counts as a gap.
  res.json({ items, gaps: activities.findGaps(items) });
});

activitiesRouter.post('/', validate({ body: createSchema }), async (req, res) => {
  res.status(201).json(await activities.create(currentUserId(req), req.body));
});

activitiesRouter.get('/:id', validate({ params: idParam }), async (req, res) => {
  res.json(await activities.getById(currentUserId(req), param(req, 'id')));
});

activitiesRouter.patch(
  '/:id',
  validate({ params: idParam, body: createSchema.partial() }),
  async (req, res) => {
    res.json(await activities.update(currentUserId(req), param(req, 'id'), req.body));
  },
);

activitiesRouter.delete('/:id', validate({ params: idParam }), async (req, res) => {
  await activities.remove(currentUserId(req), param(req, 'id'));
  res.status(204).send();
});
