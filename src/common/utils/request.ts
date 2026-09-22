import type { Request } from 'express';

/**
 * Express 5 types route params as `string | string[]`. Every param in this API
 * is a single value, and `validate()` has already checked it, so these helpers
 * narrow once here instead of casting at each call site.
 */
export function param(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(value) ? String(value[0]) : String(value ?? '');
}

/** The parsed query, as produced by `validate({ query })`. */
export function query<T>(req: Request): T {
  return req.query as unknown as T;
}
