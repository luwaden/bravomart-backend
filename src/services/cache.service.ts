import { redis } from '../config/redis.js';
import { logger } from '../utils/logger.js';

/**
 * The "cache-aside" pattern, spelled out: check Redis first: if the key
 * exists, return the cached value and never touch Postgres. If it doesn't,
 * run the (expensive) loader against Postgres, store the result in Redis
 * with a TTL, and return it. The very next request for the same key is a
 * cache hit — until the TTL expires or something explicitly invalidates it.
 *
 * `T` must be JSON-serializable, because Redis strings hold bytes, not
 * JavaScript objects — we JSON.stringify going in and JSON.parse coming
 * back out.
 */
export async function getOrSetCache<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
  const cached = await redis.get(key);
  if (cached !== null) {
    return JSON.parse(cached) as T;
  }

  const fresh = await loader();
  await redis.set(key, JSON.stringify(fresh), 'EX', ttlSeconds);
  return fresh;
}

/** Deletes one exact cache key — used when you know precisely which key is now stale. */
export async function invalidateCache(key: string): Promise<void> {
  await redis.del(key);
}

/**
 * Deletes every key matching a pattern (e.g. "products:list:*") using SCAN
 * rather than the blocking KEYS command — see the identical reasoning in
 * token.service.ts's revokeAllUserSessions(). This is what "update Redis
 * cache invalidation" means in practice: after the AI-create endpoint (or
 * any product create/update/delete) writes to Postgres, every previously
 * cached product LIST becomes stale — a buyer paging through the catalog
 * should see the new item, not a 60-second-old snapshot — so we clear every
 * list-cache entry rather than trying to patch each one individually.
 */
export async function invalidateCachePattern(pattern: string): Promise<void> {
  let cursor = '0';
  const keysToDelete: string[] = [];

  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    keysToDelete.push(...keys);
    cursor = nextCursor;
  } while (cursor !== '0');

  if (keysToDelete.length === 0) {
    return;
  }

  await redis.del(...keysToDelete);
  logger.info(`Cache invalidated: ${keysToDelete.length} key(s) matching "${pattern}"`);
}
