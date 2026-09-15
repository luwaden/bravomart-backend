import type { NextFunction, Request, Response } from 'express';
import { redis } from '../config/redis.js';
import { AppError } from '../utils/AppError.js';

interface RateLimitOptions {
  windowSeconds: number;
  maxRequests: number;
  keyPrefix: string;
}

/**
 * A small, hand-rolled fixed-window rate limiter instead of a library, so
 * the mechanism is visible instead of hidden behind a package. The whole
 * trick is that Redis's `INCR` is atomic: even if two requests from the
 * same user arrive at the exact same millisecond, Redis guarantees they
 * each get a distinct, correctly-incremented count back — there's no race
 * where both requests read "0" and both think they're first.
 *
 * This limits by user id when we have one (from an already-verified access
 * token) and falls back to IP address for anonymous routes like login,
 * where there's no user id yet to key on.
 */
function createRateLimiter({ windowSeconds, maxRequests, keyPrefix }: RateLimitOptions) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const identity = req.user?.sub ?? req.ip ?? 'anonymous';
    const key = `ratelimit:${keyPrefix}:${identity}`;

    try {
      const currentCount = await redis.incr(key);

      if (currentCount === 1) {
        // Only the request that just CREATED the counter sets its expiry.
        // If every request re-set the TTL, a steady stream of requests
        // would keep pushing the window forward forever and the limit
        // would never actually reset — a subtle bug that only shows up
        // under sustained load.
        await redis.expire(key, windowSeconds);
      }

      if (currentCount > maxRequests) {
        const secondsRemaining = await redis.ttl(key);
        next(new AppError(`Too many requests. Try again in ${Math.max(secondsRemaining, 1)} second(s).`, 429));
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Applied to POST /api/auth/login — slows down credential-stuffing / brute-force attempts. */
export const authRateLimiter = createRateLimiter({
  windowSeconds: 60,
  maxRequests: 10,
  keyPrefix: 'auth-login',
});

/** Applied to the AI product-creation endpoint — Gemini calls cost real money and quota. */
export const aiCreateRateLimiter = createRateLimiter({
  windowSeconds: 60,
  maxRequests: 5,
  keyPrefix: 'ai-create',
});
