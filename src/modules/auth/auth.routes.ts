import { Router } from 'express';

import { currentUserId, requireAuth } from '@/common/middleware/auth';
import { authRateLimit } from '@/common/middleware/rateLimit';
import { validate } from '@/common/middleware/validate';
import * as authService from './auth.service';
import {
  changePasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
} from './auth.schema';

export const authRouter = Router();

authRouter.post(
  '/register',
  authRateLimit,
  validate({ body: registerSchema }),
  async (req, res) => {
    const result = await authService.register(req.body, req.headers['user-agent']);
    res.status(201).json(result);
  },
);

authRouter.post('/login', authRateLimit, validate({ body: loginSchema }), async (req, res) => {
  const result = await authService.login(req.body, req.headers['user-agent']);
  res.json(result);
});

authRouter.post('/refresh', authRateLimit, validate({ body: refreshSchema }), async (req, res) => {
  const tokens = await authService.refresh(req.body.refreshToken, req.headers['user-agent']);
  res.json(tokens);
});

authRouter.post('/logout', requireAuth, async (req, res) => {
  await authService.logout(currentUserId(req), req.body?.refreshToken);
  res.status(204).send();
});

authRouter.post(
  '/change-password',
  requireAuth,
  authRateLimit,
  validate({ body: changePasswordSchema }),
  async (req, res) => {
    await authService.changePassword(currentUserId(req), req.body);
    res.status(204).send();
  },
);
