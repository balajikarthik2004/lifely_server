import compression from 'compression';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import pinoHttp from 'pino-http';

import { errorHandler, notFoundHandler } from '@/common/middleware/errorHandler';
import { apiRateLimit } from '@/common/middleware/rateLimit';
import { requestId } from '@/common/middleware/requestId';
import { env, isTest } from '@/config/env';
import { logger } from '@/config/logger';
import { activitiesRouter } from '@/modules/activities/activities.routes';
import { aiRouter } from '@/modules/ai/ai.routes';
import { analyticsRouter } from '@/modules/analytics/analytics.routes';
import { authRouter } from '@/modules/auth/auth.routes';
import { creditsRouter } from '@/modules/credits/credits.routes';
import { focusRouter } from '@/modules/focus/focus.routes';
import { goalsRouter } from '@/modules/goals/goals.routes';
import { habitsRouter } from '@/modules/habits/habits.routes';
import { reflectionsRouter } from '@/modules/reflections/reflections.routes';
import { rewardsRouter } from '@/modules/rewards/rewards.routes';
import { tasksRouter } from '@/modules/tasks/tasks.routes';
import { usersRouter } from '@/modules/users/users.routes';

export function createApp(): Express {
  const app = express();

  // Behind a proxy (Render, Railway, Fly, nginx) the client IP arrives in a
  // header; rate limiting is meaningless without this.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  if (!isTest) {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req) => (req as { id?: string }).id ?? '',
        autoLogging: { ignore: (req) => req.url === '/health' },
      }),
    );
  }

  /** Liveness and readiness in one: reports whether the database is reachable. */
  app.get('/health', (_req, res) => {
    const dbReady = mongoose.connection.readyState === 1;
    res.status(dbReady ? 200 : 503).json({
      status: dbReady ? 'ok' : 'degraded',
      database: dbReady ? 'connected' : 'disconnected',
      uptimeSeconds: Math.round(process.uptime()),
      version: process.env.npm_package_version ?? '1.0.0',
    });
  });

  const api = express.Router();
  api.use(apiRateLimit);

  api.use('/auth', authRouter);
  api.use('/users', usersRouter);
  api.use('/tasks', tasksRouter);
  api.use('/habits', habitsRouter);
  api.use('/goals', goalsRouter);
  api.use('/activities', activitiesRouter);
  api.use('/focus', focusRouter);
  api.use('/credits', creditsRouter);
  api.use('/rewards', rewardsRouter);
  api.use('/reflections', reflectionsRouter);
  api.use('/analytics', analyticsRouter);
  api.use('/ai', aiRouter);

  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
