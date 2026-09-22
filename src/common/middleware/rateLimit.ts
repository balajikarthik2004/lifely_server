import rateLimit from 'express-rate-limit';

import { env, isTest } from '@/config/env';
import { TooManyRequestsError } from '../errors';

const shared = {
  standardHeaders: 'draft-7' as const,
  legacyHeaders: false,
  // Rate limiting would make tests order-dependent and slow.
  skip: () => isTest,
  handler: (_req: unknown, _res: unknown, next: (error: unknown) => void) => {
    next(new TooManyRequestsError());
  },
};

/** Baseline limit for the whole API. */
export const apiRateLimit = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
});

/** Tighter limit on the endpoints worth brute-forcing. */
export const authRateLimit = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  handler: (_req: unknown, _res: unknown, next: (error: unknown) => void) => {
    next(new TooManyRequestsError('Too many attempts. Try again in a few minutes.'));
  },
});
