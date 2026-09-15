import type { AccessTokenPayload } from './jwt.types.js';

// Express's own types don't know about `req.user` or our validation
// middleware — this file adds them to the global `Express.Request`
// interface so every controller gets autocomplete and type-checking on
// `req.user` without needing to cast it.
declare global {
  namespace Express {
    interface Request {
      /** Set by middlewares/authenticate.ts after a valid access token. Absent on public routes. */
      user?: AccessTokenPayload;

      /**
       * Set by middlewares/validate.ts for `query`/`params` schemas.
       * We deliberately do NOT overwrite `req.query`/`req.params` directly —
       * Express 5 made `req.query` a read-only getter derived from the URL,
       * so `req.query = parsedData` throws at runtime. Validated,
       * coerced query/param data lives here instead. (`req.body` has no such
       * restriction, so validated body data is written straight back to
       * `req.body` as usual.)
       */
      validated?: {
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

export {};
