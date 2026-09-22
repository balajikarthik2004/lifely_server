import type { Server } from 'node:http';

import { createApp } from './app';
import { connectDatabase, disconnectDatabase, ensureIndexes } from './config/db';
import { env } from './config/env';
import { logger } from './config/logger';

async function main(): Promise<void> {
  // The database is connected before the port opens, so the service never
  // accepts a request it cannot serve.
  await connectDatabase();

  // createApp pulls in every route, and therefore every model, so the index
  // build below sees the full set.
  const app = createApp();
  await ensureIndexes();
  const server: Server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV },
      `Lifely API listening on http://localhost:${env.PORT}/api/v1`,
    );
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');

    // Stop accepting connections, let in-flight requests finish, then close the
    // database. A hard exit after 10s covers a hung connection.
    const timer = setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
    timer.unref();

    server.close(async () => {
      await disconnectDatabase();
      logger.info('Shutdown complete');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception — exiting');
    process.exit(1);
  });
}

main().catch((error) => {
  logger.fatal({ err: error }, 'Failed to start');
  process.exit(1);
});
