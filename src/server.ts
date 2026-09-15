import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/prisma.js';
import { redis } from './config/redis.js';
import { logger } from './utils/logger.js';

async function bootstrap(): Promise<void> {
  await connectDatabase();

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info(`BravoMart API listening on port ${env.PORT} (${env.NODE_ENV})`);
  });

  /**
   * Graceful shutdown: on SIGINT/SIGTERM (Ctrl+C locally, or what
   * container platforms send before killing a pod), stop accepting new
   * connections, let in-flight requests finish, THEN close the database
   * and Redis connections, THEN exit. Skipping this and just letting the
   * process die means requests mid-flight get dropped and connections are
   * closed uncleanly — fine on a laptop, a real source of dropped requests
   * during every deploy in production.
   */
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}. Shutting down gracefully...`);

    server.close(() => {
      void (async () => {
        await disconnectDatabase();
        redis.disconnect();
        process.exit(0);
      })();
    });
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((error: unknown) => {
  logger.error('Failed to start server', error);
  process.exit(1);
});
