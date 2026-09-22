import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Two projects.
 *
 * `unit` covers the pure domain rules and needs no database, so it stays fast.
 * `integration` boots a real MongoDB replica set -- a replica set rather than a
 * standalone because that is what Atlas is, which means the transactions and
 * unique indexes the credit engine depends on are genuinely exercised.
 *
 * Vitest rather than Jest: the MongoDB 7 driver builds its handshake metadata
 * through an async dynamic import that Jest's module sandbox cannot resolve,
 * which makes every connection fail there.
 */
const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/domain/__tests__/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['src/modules/__tests__/**/*.test.ts'],
          globalSetup: ['./src/test/globalSetup.ts'],
          setupFiles: ['./src/test/setup.ts'],
          hookTimeout: 120_000,
          testTimeout: 60_000,
          // One database, so suites cannot wipe each other's rows mid-run.
          fileParallelism: false,
        },
      },
    ],
  },
});
