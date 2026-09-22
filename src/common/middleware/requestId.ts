import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

/** Correlates a log line with the error the client was shown. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.headers['x-request-id'];
  req.id = typeof incoming === 'string' && incoming.length <= 128 ? incoming : randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
};
