import { Router } from 'express';
import { z } from 'zod';

import { CATEGORIES, GOAL_STATUSES } from '@/common/constants';
import { currentUserId, requireAuth } from '@/common/middleware/auth';
import { validate } from '@/common/middleware/validate';
import { param, query } from '@/common/utils/request';
import { dateKeySchema } from '@/common/utils/dates';
import * as goals from './goals.service';

const idParam = z.object({ id: z.string().min(1) });
const milestoneParam = z.object({ id: z.string().min(1), milestoneId: z.string().min(1) });

const createSchema = z.object({
  title: z.string().trim().min(1, 'What is the goal?').max(200),
  why: z.string().trim().max(2000).optional(),
  icon: z.string().max(8).optional(),
  category: z.enum(CATEGORIES).optional(),
  targetValue: z.number().min(0).optional(),
  currentValue: z.number().min(0).optional(),
  unit: z.string().trim().max(24).optional(),
  deadline: dateKeySchema.optional(),
  milestones: z.array(z.object({ title: z.string().trim().min(1).max(200) })).max(50).optional(),
});

export const goalsRouter = Router();

goalsRouter.use(requireAuth);

goalsRouter.get(
  '/',
  validate({ query: z.object({ status: z.enum(GOAL_STATUSES).optional() }) }),
  async (req, res) => {
    const items = await goals.list(currentUserId(req), query<{ status?: string }>(req).status);
    res.json({ items });
  },
);

goalsRouter.post('/', validate({ body: createSchema }), async (req, res) => {
  res.status(201).json(await goals.create(currentUserId(req), req.body));
});

goalsRouter.get('/:id', validate({ params: idParam }), async (req, res) => {
  res.json(await goals.getDetail(currentUserId(req), param(req, 'id')));
});

goalsRouter.patch(
  '/:id',
  validate({
    params: idParam,
    body: createSchema.omit({ milestones: true }).partial().extend({
      status: z.enum(GOAL_STATUSES).optional(),
    }),
  }),
  async (req, res) => {
    res.json(await goals.update(currentUserId(req), param(req, 'id'), req.body));
  },
);

goalsRouter.delete('/:id', validate({ params: idParam }), async (req, res) => {
  await goals.remove(currentUserId(req), param(req, 'id'));
  res.status(204).send();
});

goalsRouter.post(
  '/:id/progress',
  validate({ params: idParam, body: z.object({ amount: z.number() }) }),
  async (req, res) => {
    res.json(await goals.logProgress(currentUserId(req), param(req, 'id'), req.body.amount));
  },
);

goalsRouter.post(
  '/:id/milestones',
  validate({ params: idParam, body: z.object({ title: z.string().trim().min(1).max(200) }) }),
  async (req, res) => {
    res.status(201).json(await goals.addMilestone(currentUserId(req), param(req, 'id'), req.body.title));
  },
);

goalsRouter.patch(
  '/:id/milestones/:milestoneId',
  validate({ params: milestoneParam, body: z.object({ isCompleted: z.boolean() }) }),
  async (req, res) => {
    res.json(
      await goals.setMilestone(
        currentUserId(req),
        param(req, 'id'),
        param(req, 'milestoneId'),
        req.body.isCompleted,
      ),
    );
  },
);

goalsRouter.delete(
  '/:id/milestones/:milestoneId',
  validate({ params: milestoneParam }),
  async (req, res) => {
    res.json(
      await goals.removeMilestone(currentUserId(req), param(req, 'id'), param(req, 'milestoneId')),
    );
  },
);
