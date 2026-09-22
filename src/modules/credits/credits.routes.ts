import { Router } from 'express';
import { z } from 'zod';

import { currentUserId, requireAuth } from '@/common/middleware/auth';
import { validate } from '@/common/middleware/validate';
import { paginationSchema, toPage } from '@/common/utils/pagination';
import * as credits from './credits.service';

export const creditsRouter = Router();

creditsRouter.use(requireAuth);

creditsRouter.get('/balance', async (req, res) => {
  res.json(await credits.getSummary(currentUserId(req)));
});

creditsRouter.get('/transactions', validate({ query: paginationSchema }), async (req, res) => {
  const { limit, cursor } = req.query as unknown as { limit: number; cursor?: string };
  const rows = await credits.listTransactions(currentUserId(req), { limit, cursor });
  res.json(toPage(rows.map((row) => row.toJSON() as unknown as { id: string }), limit));
});

/**
 * Manual adjustment. Bounded on purpose — this exists to correct a mistake,
 * not as a way for a client to mint credits.
 */
creditsRouter.post(
  '/adjust',
  validate({
    body: z.object({
      amount: z.number().int().min(-500).max(500).refine((v) => v !== 0, 'Adjust by something'),
      description: z.string().trim().min(1).max(300),
    }),
  }),
  async (req, res) => {
    const userId = currentUserId(req);
    const transaction = await credits.record(userId, {
      amount: req.body.amount,
      type: 'ADJUSTMENT',
      description: req.body.description,
    });
    res.status(201).json({ transaction, balance: await credits.getBalance(userId) });
  },
);
