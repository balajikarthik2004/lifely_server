import { createHash, randomUUID } from 'node:crypto';

import { ConflictError, UnauthorizedError } from '@/common/errors';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '@/common/middleware/auth';
import { env } from '@/config/env';
import { User, hashPassword, type UserDocument, type UserHydrated } from '@/modules/users/user.model';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface AuthResult extends AuthTokens {
  user: UserDocument;
}

/**
 * Refresh tokens are stored hashed, exactly like passwords: a stolen database
 * dump must not let anyone mint access tokens. Logging out deletes the row, so
 * revocation is real rather than advisory.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function refreshExpiryDate(): Date {
  const ttl = env.JWT_REFRESH_TTL;
  const match = /^(\d+)([smhd])$/.exec(ttl);
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const ms = match ? Number(match[1]) * multipliers[match[2]] : 30 * 86_400_000;
  return new Date(Date.now() + ms);
}

async function issueTokens(user: UserHydrated, userAgent?: string): Promise<AuthTokens> {
  const jti = randomUUID();
  const accessToken = signAccessToken({ sub: String(user._id), email: user.email });
  const refreshToken = signRefreshToken({ sub: String(user._id), jti });

  await User.updateOne(
    { _id: user._id },
    {
      $push: {
        refreshTokens: {
          $each: [
            {
              jti,
              tokenHash: hashToken(refreshToken),
              expiresAt: refreshExpiryDate(),
              createdAt: new Date(),
              userAgent: userAgent?.slice(0, 256),
            },
          ],
          // Keep the five most recent sessions; older devices fall off.
          $slice: -5,
        },
      },
    },
  );

  return { accessToken, refreshToken, expiresIn: env.JWT_ACCESS_TTL };
}

export async function register(
  input: { email: string; password: string; name?: string },
  userAgent?: string,
): Promise<AuthResult> {
  const existing = await User.exists({ email: input.email });
  if (existing) {
    throw new ConflictError('An account with that email already exists. Try signing in instead.');
  }

  const user = await User.create({
    email: input.email,
    passwordHash: await hashPassword(input.password),
    profile: input.name ? { name: input.name } : {},
  });

  const tokens = await issueTokens(user, userAgent);
  return { ...tokens, user: user.toJSON() as unknown as UserDocument };
}

export async function login(
  input: { email: string; password: string },
  userAgent?: string,
): Promise<AuthResult> {
  const user = await User.findOne({ email: input.email }).select('+passwordHash');

  // Same message and roughly the same cost either way, so the response cannot
  // be used to enumerate which emails have accounts.
  const invalid = new UnauthorizedError('That email and password do not match.');
  if (!user) {
    await hashPassword(input.password);
    throw invalid;
  }

  const matches = await user.comparePassword(input.password);
  if (!matches) throw invalid;

  user.lastLoginAt = new Date();
  await user.save();

  const tokens = await issueTokens(user, userAgent);
  return { ...tokens, user: user.toJSON() as unknown as UserDocument };
}

/**
 * Refresh rotation: the presented token is invalidated as it is exchanged, so a
 * leaked refresh token is single-use.
 */
export async function refresh(token: string, userAgent?: string): Promise<AuthTokens> {
  const { sub, jti } = verifyRefreshToken(token);

  const user = await User.findById(sub).select('+refreshTokens');
  if (!user) throw new UnauthorizedError('That session is no longer valid. Please sign in again.');

  const stored = user.refreshTokens.find((t) => t.jti === jti);
  if (!stored || stored.tokenHash !== hashToken(token) || stored.expiresAt.getTime() < Date.now()) {
    throw new UnauthorizedError('That session has expired. Please sign in again.');
  }

  await User.updateOne({ _id: user._id }, { $pull: { refreshTokens: { jti } } });
  return issueTokens(user, userAgent);
}

export async function logout(userId: string, token?: string): Promise<void> {
  if (!token) {
    // No specific session named: sign out everywhere.
    await User.updateOne({ _id: userId }, { $set: { refreshTokens: [] } });
    return;
  }

  try {
    const { jti } = verifyRefreshToken(token);
    await User.updateOne({ _id: userId }, { $pull: { refreshTokens: { jti } } });
  } catch {
    // An expired or malformed token means the session is already gone. Logging
    // out is idempotent by design — never make signing out fail.
  }
}

export async function changePassword(
  userId: string,
  input: { currentPassword: string; newPassword: string },
): Promise<void> {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw new UnauthorizedError();

  const matches = await user.comparePassword(input.currentPassword);
  if (!matches) throw new UnauthorizedError('That is not your current password.');

  user.passwordHash = await hashPassword(input.newPassword);
  await user.save();

  // Changing a password ends every other session.
  await User.updateOne({ _id: userId }, { $set: { refreshTokens: [] } });
}
