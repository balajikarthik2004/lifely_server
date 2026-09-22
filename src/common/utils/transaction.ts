import mongoose, { type ClientSession } from 'mongoose';

import { supportsTransactions } from '@/config/db';
import { logger } from '@/config/logger';

/**
 * Run `work` inside a MongoDB transaction when the deployment supports one.
 *
 * Atlas is a replica set, so transactions are available there. A bare local
 * mongod is not, and rather than failing we run the work without a session and
 * say so once — the callers that need atomicity also carry a unique index as a
 * second line of defence, so correctness does not depend on this alone.
 */
export async function withTransaction<T>(work: (session?: ClientSession) => Promise<T>): Promise<T> {
  if (!supportsTransactions()) {
    logger.debug('Transactions unavailable on this deployment; running without a session');
    return work(undefined);
  }

  const session = await mongoose.startSession();
  try {
    let result: T;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result!;
  } finally {
    await session.endSession();
  }
}

export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}
