import mongoose from 'mongoose';

import { env } from './env';
import { logger } from './logger';

mongoose.set('strictQuery', true);

let connected = false;

/** Connect to MongoDB Atlas. Safe to call more than once. */
export async function connectDatabase(uri: string = env.MONGODB_URI): Promise<typeof mongoose> {
  if (connected) return mongoose;

  mongoose.connection.on('error', (error) => logger.error({ err: error }, 'MongoDB connection error'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));

  await mongoose.connect(uri, {
    // Fail fast on a bad URI or an IP that Atlas has not allow-listed, rather
    // than hanging for the default 30 seconds.
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
    // Indexes are built explicitly below instead, so it happens once at boot
    // rather than being attempted on every query.
    autoIndex: false,
  });

  connected = true;
  logger.info({ db: mongoose.connection.name }, 'MongoDB connected');
  return mongoose;
}

/**
 * Build every index the models declare.
 *
 * This is not optional housekeeping: the unique partial indexes on
 * (userId, sourceRef) are what make credit payouts idempotent, so a deployment
 * that skipped them would silently allow double payouts under a retry. Running
 * it at boot means a fresh Atlas cluster is correct from the first request.
 */
export async function ensureIndexes(): Promise<void> {
  const models = Object.values(mongoose.models);
  await Promise.all(models.map((model) => model.createIndexes()));
  logger.info({ collections: models.length }, 'Indexes ensured');
}

export async function disconnectDatabase(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}

/**
 * Whether this deployment can run multi-document transactions. Atlas (a replica
 * set) can; a bare local mongod cannot.
 */
export function supportsTransactions(): boolean {
  const topology = (mongoose.connection as unknown as { client?: { topology?: { description?: { type?: string } } } })
    .client?.topology?.description?.type;
  return topology === 'ReplicaSetWithPrimary' || topology === 'Sharded' || topology === 'LoadBalanced';
}
