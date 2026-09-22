import { Router } from 'express';
import { z } from 'zod';

import { CATEGORIES } from '@/common/constants';
import { currentUserId, requireAuth } from '@/common/middleware/auth';
import { validate } from '@/common/middleware/validate';
import { query } from '@/common/utils/request';
import * as focus from './focus.service';

const startSchema = z.object({
  title: z.string().trim().min(1).max(200),
  category: z.enum(CATEGORIES).optional(),
  targetMinutes: z.number().int().min(1).max(600),
  taskId: z.string().optional(),
});

export const focusRouter = Router();

focusRouter.use(requireAuth);

focusRouter.get('/active', async (req, res) => {
  const session = await focus.getActive(currentUserId(req));
  res.json({
    session,
    elapsedMinutes: session ? focus.elapsedMinutes(session) : 0,
  });
});

focusRouter.post('/start', validate({ body: startSchema }), async (req, res) => {
  res.status(201).json(await focus.start(currentUserId(req), req.body));
});

focusRouter.post('/pause', async (req, res) => {
  res.json(await focus.pause(currentUserId(req)));
});

focusRouter.post('/resume', async (req, res) => {
  res.json(await focus.resume(currentUserId(req)));
});

focusRouter.post('/finish', async (req, res) => {
  res.json(await focus.finish(currentUserId(req)));
});

focusRouter.post('/abandon', async (req, res) => {
  await focus.abandon(currentUserId(req));
  res.status(204).send();
});

focusRouter.get(
  '/history',
  validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }) }),
  async (req, res) => {
    const items = await focus.history(currentUserId(req), query<{ limit: number }>(req).limit);
    res.json({ items });
  },
);
