import pino from 'pino';

import { env, isProduction, isTest } from './env';

/**
 * Structured logs (spec section 53). Pretty-printed while developing, JSON in
 * production so a log shipper can parse it.
 */
export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  transport: isProduction || isTest ? undefined : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
  // Never let a secret reach the log stream.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.currentPassword',
      'req.body.newPassword',
      'req.body.refreshToken',
      'res.headers["set-cookie"]',
    ],
    remove: true,
  },
});
