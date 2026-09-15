import type { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/**
 * Wraps an async controller so a rejected promise (a thrown error inside an
 * `async function`) reaches Express's error-handling middleware instead of
 * turning into an unhandled rejection.
 *
 * Honest note, because this exact thing trips people up in 2026: Express 5
 * (which this project uses) actually forwards rejected promises from route
 * handlers to `next()` automatically — so on Express 5 alone, this wrapper
 * is no longer strictly required the way it was on Express 4. We still use
 * it here for three reasons: it makes every controller's error-handling
 * behaviour explicit and identical regardless of Express version, it keeps
 * this codebase portable if you ever downgrade or mix in Express 4
 * middleware, and relying on "the framework happens to catch this" is a
 * fragile thing to build a habit around. Cheap insurance, zero downside.
 */
export function asyncHandler(handler: AsyncRouteHandler): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
