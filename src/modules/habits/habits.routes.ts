import { Router } from 'express';
import { z } from 'zod';

import { CATEGORIES, HABIT_FREQUENCIES } from '@/common/constants';
import { currentUserId, requireAuth } from '@/common/middleware/auth';
import { validate } from '@/common/middleware/validate';
import { param, query } from '@/common/utils/request';
import { dateKeySchema } from '@/common/utils/dates';
import * as habits from './habits.service';

const idParam = z.object({ id: z.string().min(1) });
const dayBody = z.object({ date: dateKeySchema.optional() });

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name it so you recognise it at 6am').max(120),
  description: z.string().trim().max(1000).optional(),
  icon: z.string().max(8).optional(),
  category: z.enum(CATEGORIES).optional(),
  frequency: z.enum(HABIT_FREQUENCIES).optional(),
  days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  targetCount: z.number().int().min(1).max(100).optional(),
  creditValue: z.number().int().min(0).max(1000).optional(),
  reminderTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time like 07:00')
    .optional(),
  goalId: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const habitsRouter = Router();

habitsRouter.use(requireAuth);

habitsRouter.get(
  '/',
  validate({ query: z.object({ includeInactive: z.coerce.boolean().default(true) }) }),
  async (req, res) => {
    const items = await habits.list(currentUserId(req), query<{ includeInactive: boolean }>(req).includeInactive);
    res.json({ items });
  },
);

habitsRouter.post('/', validate({ body: createSchema }), async (req, res) => {
  const habit = await habits.create(currentUserId(req), req.body);
  res.status(201).json(habit);
});

habitsRouter.get('/:id', validate({ params: idParam }), async (req, res) => {
  res.json(await habits.getById(currentUserId(req), param(req, 'id')));
});

habitsRouter.patch(
  '/:id',
  validate({ params: idParam, body: createSchema.partial() }),
  async (req, res) => {
    res.json(await habits.update(currentUserId(req), param(req, 'id'), req.body));
  },
);

habitsRouter.delete('/:id', validate({ params: idParam }), async (req, res) => {
  await habits.remove(currentUserId(req), param(req, 'id'));
  res.status(204).send();
});

habitsRouter.post(
  '/:id/complete',
  validate({ params: idParam, body: dayBody }),
  async (req, res) => {
    res.json(await habits.complete(currentUserId(req), param(req, 'id'), req.body.date));
  },
);

habitsRouter.post('/:id/skip', validate({ params: idParam, body: dayBody }), async (req, res) => {
  res.json(await habits.skip(currentUserId(req), param(req, 'id'), req.body.date));
});

habitsRouter.post('/:id/clear', validate({ params: idParam, body: dayBody }), async (req, res) => {
  res.json(await habits.clearDay(currentUserId(req), param(req, 'id'), req.body.date));
});
