/**
 * Error types.
 *
 * Messages here are written for the person using the app, not for the console
 * (spec section 35): they say what happened, reassure where appropriate, and
 * suggest what to do. Stack traces and internals never reach the client.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  /** Expected errors are not logged as server faults. */
  readonly isOperational = true;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'That request could not be understood.', details?: unknown) {
    super(400, 'BAD_REQUEST', message, details);
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown, message = 'Some of those details need another look.') {
    super(422, 'VALIDATION_FAILED', message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Please sign in again to continue.') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'That does not belong to your account.') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(what = 'That') {
    super(404, 'NOT_FOUND', `${what} could not be found. It may have been deleted.`);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'That conflicts with something that already exists.') {
    super(409, 'CONFLICT', message);
  }
}

export class InsufficientCreditsError extends AppError {
  constructor(shortfall: number) {
    super(
      409,
      'INSUFFICIENT_CREDITS',
      `You need ${shortfall} more ${shortfall === 1 ? 'credit' : 'credits'} for this one.`,
      { shortfall },
    );
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'That is a lot of requests in a short time. Give it a moment.') {
    super(429, 'TOO_MANY_REQUESTS', message);
  }
}
