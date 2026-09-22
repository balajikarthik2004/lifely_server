import { Router } from 'express';
import { z } from 'zod';

import { REWARD_CATEGORIES } from '@/common/constants';
import { currentUserId, requireAuth } from '@/common/middleware/auth';
import { validate } from '@/common/middleware/validate';
import { param } from '@/common/utils/request';
import * as rewards from './rewards.service';

const idParam = z.object({ id: z.string().min(1) });

const createSchema = z.object({
  title: z.string().trim().min(1, 'What are you giving yourself?').max(160),
  description: z.string().trim().max(1000).optional(),
  icon: z.string().max(8).optional(),
  creditCost: z.number().int().min(1).max(1_000_000),
  category: z.enum(REWARD_CATEGORIES).optional(),
});

export const rewardsRouter = Router();

rewardsRouter.use(requireAuth);

rewardsRouter.get('/', async (req, res) => {
  res.json(await rewards.list(currentUserId(req)));
});

rewardsRouter.post('/', validate({ body: createSchema }), async (req, res) => {
  res.status(201).json(await rewards.create(currentUserId(req), req.body));
});

rewardsRouter.patch(
  '/:id',
  validate({ params: idParam, body: createSchema.partial().extend({ isActive: z.boolean().optional() }) }),
  async (req, res) => {
    res.json(await rewards.update(currentUserId(req), param(req, 'id'), req.body));
  },
);

rewardsRouter.delete('/:id', validate({ params: idParam }), async (req, res) => {
  await rewards.remove(currentUserId(req), param(req, 'id'));
  res.status(204).send();
});

rewardsRouter.post('/:id/redeem', validate({ params: idParam }), async (req, res) => {
  res.json(await rewards.redeem(currentUserId(req), param(req, 'id')));
});
