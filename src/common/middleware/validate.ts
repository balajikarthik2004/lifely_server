import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

import { ValidationError } from '../errors';

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Validates and *replaces* the request parts with the parsed output, so
 * handlers downstream receive coerced, trimmed, defaulted values and nothing
 * the schema did not allow (spec section 50, rule 4).
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    const issues: { field: string; message: string }[] = [];

    for (const key of ['body', 'params', 'query'] as const) {
      const schema = schemas[key];
      if (!schema) continue;

      // A request with no body at all is an empty object, not a missing one:
      // endpoints whose fields are all optional must accept being called with
      // nothing to say.
      const value = key === 'body' ? (req.body ?? {}) : req[key];
      const result = schema.safeParse(value);
      if (!result.success) {
        result.error.issues.forEach((issue) => {
          issues.push({
            field: [key, ...issue.path.map(String)].join('.'),
            message: issue.message,
          });
        });
        continue;
      }

      // Express 5 makes req.query a getter-only property, so assign in place.
      if (key === 'query') {
        Object.defineProperty(req, 'query', { value: result.data, writable: true, configurable: true });
      } else {
        req[key] = result.data as never;
      }
    }

    if (issues.length > 0) {
      next(new ValidationError(issues));
      return;
    }
    next();
  };
}
