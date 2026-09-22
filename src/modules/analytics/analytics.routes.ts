import { Router } from 'express';
import { z } from 'zod';

import { currentUserId, requireAuth } from '@/common/middleware/auth';
import { validate } from '@/common/middleware/validate';
import { query } from '@/common/utils/request';
import { dateKeySchema } from '@/common/utils/dates';
import * as analytics from './analytics.service';

export const analyticsRouter = Router();

analyticsRouter.use(requireAuth);

analyticsRouter.get('/today', async (req, res) => {
  res.json(await analytics.today(currentUserId(req)));
});

analyticsRouter.get('/week', async (req, res) => {
  const items = await analytics.recordsForRange(currentUserId(req), 7);
  res.json({ items });
});

analyticsRouter.get('/month', async (req, res) => {
  const items = await analytics.recordsForRange(currentUserId(req), 30);
  res.json({ items });
});

analyticsRouter.get(
  '/life-score',
  validate({ query: z.object({ date: dateKeySchema.optional() }) }),
  async (req, res) => {
    res.json(await analytics.lifeScore(currentUserId(req), query<{ date?: string }>(req).date));
  },
);

/** One call that fills the whole Insights screen. */
analyticsRouter.get(
  '/overview',
  validate({ query: z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }) }),
  async (req, res) => {
    res.json(await analytics.overview(currentUserId(req), query<{ days: number }>(req).days));
  },
);
