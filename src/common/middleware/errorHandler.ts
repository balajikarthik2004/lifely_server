import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';

import { logger } from '@/config/logger';
import { isProduction } from '@/config/env';
import { AppError, NotFoundError } from '../errors';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new NotFoundError('That endpoint'));
};

/**
 * The single place an error becomes a response.
 *
 * Express 5 forwards rejected promises from async handlers here automatically,
 * so route code can simply throw.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const requestId = (req as { id?: string }).id;
  let status = 500;
  let body: ErrorBody = {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side. Your data is safe — please try again.',
      requestId,
    },
  };

  if (error instanceof AppError) {
    status = error.statusCode;
    body = { error: { code: error.code, message: error.message, details: error.details, requestId } };
  } else if (error instanceof ZodError) {
    status = 422;
    body = {
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Some of those details need another look.',
        details: formatZodIssues(error),
        requestId,
      },
    };
  } else if (error instanceof mongoose.Error.ValidationError) {
    status = 422;
    body = {
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Some of those details need another look.',
        details: Object.entries(error.errors).map(([field, e]) => ({ field, message: e.message })),
        requestId,
      },
    };
  } else if (error instanceof mongoose.Error.CastError) {
    status = 400;
    body = {
      error: { code: 'BAD_REQUEST', message: 'That identifier is not valid.', requestId },
    };
  } else if (isDuplicateKeyError(error)) {
    status = 409;
    body = {
      error: {
        code: 'CONFLICT',
        message: 'An account with that email already exists.',
        requestId,
      },
    };
  }

  // Only genuine faults are logged at error level; expected 4xx are noise.
  if (status >= 500) {
    logger.error({ err: error, requestId, path: req.originalUrl, method: req.method }, 'Unhandled error');
  } else {
    logger.debug({ code: body.error.code, requestId, path: req.originalUrl }, 'Request rejected');
  }

  if (!isProduction && status >= 500 && error instanceof Error) {
    (body.error as { stack?: string }).stack = error.stack;
  }

  res.status(status).json(body);
};

function formatZodIssues(error: ZodError): { field: string; message: string }[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(body)',
    message: issue.message,
  }));
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}
