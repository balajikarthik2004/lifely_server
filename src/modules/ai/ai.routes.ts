import { Router } from 'express';
import { z } from 'zod';

import { currentUserId, requireAuth } from '@/common/middleware/auth';
import { validate } from '@/common/middleware/validate';
import { AI_QUICK_ACTIONS, aiProvider, buildContext, contextWindowDays } from './ai.service';

export const aiRouter = Router();

aiRouter.use(requireAuth);

/**
 * Each endpoint builds the context fresh, so the assistant always answers from
 * the current record rather than anything cached.
 */
function endpoint(method: keyof typeof aiProvider) {
  return async (req: { user?: { id: string } }, res: { json: (body: unknown) => void }) => {
    const context = await buildContext(currentUserId(req));
    const reply = await (aiProvider[method] as (ctx: typeof context) => Promise<unknown>).call(
      aiProvider,
      context,
    );
    res.json(reply);
  };
}

aiRouter.get('/quick-actions', (_req, res) => {
  res.json({ actions: AI_QUICK_ACTIONS, contextWindowDays: contextWindowDays() });
});

aiRouter.post('/summarize-day', endpoint('summarizeDay'));
aiRouter.post('/analyze-productivity', endpoint('analyzeProductivity'));
aiRouter.post('/plan-tomorrow', endpoint('planTomorrow'));
aiRouter.post('/analyze-habits', endpoint('analyzeHabits'));
aiRouter.post('/analyze-goals', endpoint('analyzeGoals'));

aiRouter.post(
  '/chat',
  validate({ body: z.object({ message: z.string().trim().min(1).max(1000) }) }),
  async (req, res) => {
    const context = await buildContext(currentUserId(req));
    res.json(await aiProvider.chat(req.body.message, context));
  },
);

/** Exposed so the client can show exactly what the assistant can see. */
aiRouter.get('/context', async (req, res) => {
  res.json(await buildContext(currentUserId(req)));
});
