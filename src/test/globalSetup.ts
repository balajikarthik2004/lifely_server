import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * Starts one MongoDB replica set for the whole run, and tears it down after.
 *
 * A replica set rather than a standalone because that is what Atlas is, so the
 * transaction paths the credit engine relies on are genuinely exercised here.
 */
let replSet: MongoMemoryReplSet | undefined;

export async function setup(): Promise<void> {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    // Pinned: the newest mongod rejects the metadata the bundled client sends.
    // 7.0.x is also what Atlas runs.
    binary: { version: process.env.MONGOMS_VERSION ?? '7.0.14' },
  });
  process.env.MONGODB_URI = replSet.getUri('lifely-test');
}

export async function teardown(): Promise<void> {
  await replSet?.stop();
}
