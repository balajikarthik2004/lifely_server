import { Router } from 'express';
import { z } from 'zod';

import { currentUserId, requireAuth } from '@/common/middleware/auth';
import { validate } from '@/common/middleware/validate';
import { param, query } from '@/common/utils/request';
import { dateKeySchema } from '@/common/utils/dates';
import * as reflections from './reflections.service';

const saveSchema = z.object({
  date: dateKeySchema.optional(),
  wentWell: z.string().trim().max(4000).optional(),
  couldBeBetter: z.string().trim().max(4000).optional(),
  learned: z.string().trim().max(4000).optional(),
  tomorrow: z.string().trim().max(4000).optional(),
  mood: z.number().int().min(1).max(5),
  energy: z.number().int().min(1).max(5),
});

const dateParam = z.object({ date: dateKeySchema });

export const reflectionsRouter = Router();

reflectionsRouter.use(requireAuth);

reflectionsRouter.get(
  '/',
  validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(60) }) }),
  async (req, res) => {
    const items = await reflections.list(
      currentUserId(req),
      query<{ limit: number }>(req).limit,
    );
    res.json({ items });
  },
);

reflectionsRouter.post('/', validate({ body: saveSchema }), async (req, res) => {
  res.json(await reflections.save(currentUserId(req), req.body));
});

reflectionsRouter.get('/:date', validate({ params: dateParam }), async (req, res) => {
  res.json(await reflections.getByDate(currentUserId(req), param(req, 'date')));
});

reflectionsRouter.delete('/:date', validate({ params: dateParam }), async (req, res) => {
  await reflections.remove(currentUserId(req), param(req, 'date'));
  res.status(204).send();
});
