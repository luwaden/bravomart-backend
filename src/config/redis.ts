// One shared ioredis connection for the whole process. Redis wears two hats
// in this backend:
//   1. Session store — refresh tokens live here so /auth/refresh is an O(1)
//      lookup instead of a database round trip (see token.service.ts).
//   2. Cache — product/category reads use a cache-aside pattern so the
//      catalog doesn't hit Postgres on every request (see cache.service.ts).
import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

export const redis = new Redis(env.REDIS_URL, {
  // Fail fast instead of queuing requests forever if Redis is unreachable —
  // for a cache/session store, a quick, visible error beats a silent hang.
  maxRetriesPerRequest: 3,
});

redis.on('connect', () => {
  logger.info('Redis connected');
});

redis.on('error', (error: Error) => {
  logger.error('Redis connection error', error.message);
});
