import './env';

import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll } from 'vitest';

/**
 * Refuse to run against anything that is not a throwaway database.
 *
 * `afterEach` empties every collection, so if the in-memory URI ever failed to
 * reach a worker and a real `.env` took its place, the suite would quietly
 * destroy live data. This makes that impossible rather than merely unlikely.
 */
function assertDisposableDatabase(uri: string): void {
  const isLocal = /^mongodb:\/\/(127\.0\.0\.1|localhost)/.test(uri);
  const looksDisposable = /lifely-test|lifely-smoke|memory/i.test(uri);

  if (!isLocal || !looksDisposable) {
    throw new Error(
      `Refusing to run tests against ${uri.replace(/\/\/[^@]*@/, '//***@')}.\n` +
        'The suite wipes every collection after each test, so it only runs against ' +
        'the in-memory replica set that globalSetup starts.',
    );
  }
}

/** Connects to the replica set that globalSetup started for this run. */
beforeAll(async () => {
  const uri = process.env.MONGODB_URI as string;
  assertDisposableDatabase(uri);

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 30_000 });
  // Indexes are what enforce idempotency; build them before the first test.
  await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()));
});

afterEach(async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
});
