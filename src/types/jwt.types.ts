import type { Role } from '../generated/prisma/client.js';

/**
 * What we encode into the short-lived access token. This is the only thing
 * `middlewares/authenticate.ts` puts on `req.user` — it deliberately does
 * NOT include anything sensitive (no password hash, obviously, but also no
 * email/phone) because access tokens are sent as a bearer header on every
 * request and are the more exposed of the two tokens.
 */
export interface AccessTokenPayload {
  /** User id — kept as `sub` (subject) to follow standard JWT claim naming. */
  sub: string;
  role: Role;
  /** Present only for VENDOR users; lets RBAC-protected routes know which shop this token can act for. */
  vendorProfileId?: string;
  /** Present only for DISPATCHER users; mirrors vendorProfileId's purpose for rider-scoped routes. */
  dispatchRiderProfileId?: string;
}

/**
 * What we encode into the long-lived refresh token. Deliberately minimal:
 * just enough to look the session up in Redis (`sub` + `jti`). Everything
 * else about the user (role, vendor profile) is re-fetched from the
 * database at rotation time in token.service.ts, so a refresh always
 * reflects the user's *current* role/status — not whatever it was 30 days
 * ago when the refresh token was first issued.
 */
export interface RefreshTokenPayload {
  sub: string;
  /** Unique id for this specific refresh token; doubles as its Redis key suffix. */
  jti: string;
}
