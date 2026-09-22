import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';

import { env } from '@/config/env';
import { UnauthorizedError } from '../errors';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  type: 'access';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated by `requireAuth`; every handler behind it can rely on it. */
      user?: { id: string; email: string };
      id?: string;
    }
  }
}

export function signAccessToken(payload: Omit<AccessTokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'access' }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions['expiresIn'],
  });
}

export function signRefreshToken(payload: { sub: string; jti: string }): string {
  return jwt.sign({ ...payload, type: 'refresh' }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_TTL as jwt.SignOptions['expiresIn'],
  });
}

export function verifyRefreshToken(token: string): { sub: string; jti: string } {
  try {
    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as jwt.JwtPayload & {
      type?: string;
      jti?: string;
    };
    if (decoded.type !== 'refresh' || !decoded.sub || !decoded.jti) {
      throw new UnauthorizedError('That session is no longer valid. Please sign in again.');
    }
    return { sub: String(decoded.sub), jti: decoded.jti };
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    throw new UnauthorizedError('That session has expired. Please sign in again.');
  }
}

/**
 * Gate for every route that touches user data. Downstream handlers read
 * `req.user.id` and must scope every query by it (spec section 52).
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    next(new UnauthorizedError('Please sign in to continue.'));
    return;
  }

  const token = header.slice('Bearer '.length).trim();

  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload & { type?: string };
    if (decoded.type !== 'access' || !decoded.sub) {
      next(new UnauthorizedError());
      return;
    }
    req.user = { id: String(decoded.sub), email: String(decoded.email ?? '') };
    next();
  } catch (error) {
    const expired = error instanceof jwt.TokenExpiredError;
    next(
      new UnauthorizedError(
        expired ? 'Your session has expired. Signing you back in…' : 'Please sign in again to continue.',
      ),
    );
  }
};

/** Narrowing helper so handlers do not repeat the non-null assertion. */
export function currentUserId(req: { user?: { id: string } }): string {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
}
