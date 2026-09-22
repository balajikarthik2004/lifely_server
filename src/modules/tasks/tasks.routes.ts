import { Router } from 'express';
import { z } from 'zod';

import { CATEGORIES, PRIORITIES, RECURRENCES, TASK_STATUSES } from '@/common/constants';
import { currentUserId, requireAuth } from '@/common/middleware/auth';
import { validate } from '@/common/middleware/validate';
import { param, query } from '@/common/utils/request';
import { dateKeySchema } from '@/common/utils/dates';
import * as tasks from './tasks.service';

const idParam = z.object({ id: z.string().min(1) });

const createSchema = z.object({
  title: z.string().trim().min(1, 'Give it a name you will recognise later').max(200),
  description: z.string().trim().max(2000).optional(),
  category: z.enum(CATEGORIES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  dueDate: dateKeySchema.optional(),
  dueTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time like 09:00')
    .optional(),
  estimatedMinutes: z.number().int().min(1).max(1440).optional(),
  creditValue: z.number().int().min(0).max(1000).optional(),
  goalId: z.string().optional(),
  habitId: z.string().optional(),
  recurrence: z.enum(RECURRENCES).optional(),
});

const updateSchema = createSchema.partial();

const listSchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  dueBefore: dateKeySchema.optional(),
  dueAfter: dateKeySchema.optional(),
  goalId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const tasksRouter = Router();

tasksRouter.use(requireAuth);

tasksRouter.get('/', validate({ query: listSchema }), async (req, res) => {
  const items = await tasks.list(currentUserId(req), query<never>(req));
  res.json({ items });
});

tasksRouter.post('/', validate({ body: createSchema }), async (req, res) => {
  const task = await tasks.create(currentUserId(req), req.body);
  res.status(201).json(task);
});

tasksRouter.get('/:id', validate({ params: idParam }), async (req, res) => {
  const task = await tasks.getById(currentUserId(req), param(req, 'id'));
  res.json(task);
});

tasksRouter.patch('/:id', validate({ params: idParam, body: updateSchema }), async (req, res) => {
  const task = await tasks.update(currentUserId(req), param(req, 'id'), req.body);
  res.json(task);
});

tasksRouter.delete('/:id', validate({ params: idParam }), async (req, res) => {
  await tasks.remove(currentUserId(req), param(req, 'id'));
  res.status(204).send();
});

tasksRouter.post('/:id/complete', validate({ params: idParam }), async (req, res) => {
  const result = await tasks.complete(currentUserId(req), param(req, 'id'));
  res.json(result);
});

tasksRouter.post('/:id/uncomplete', validate({ params: idParam }), async (req, res) => {
  const result = await tasks.uncomplete(currentUserId(req), param(req, 'id'));
  res.json(result);
});
