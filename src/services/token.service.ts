// This file is the whole auth architecture in one place: issuing a fresh
// access+refresh pair, rotating a refresh token on use, and revoking
// sessions. Everything here follows one rule — the ACCESS token is stateless
// (any server can verify it alone, offline, just by checking the signature)
// and the REFRESH token is stateful (its validity is decided by whether a
// matching entry still exists in Redis). That split is *why* a dual-token
// system exists at all: it gets you the scalability of stateless auth for
// the token that's checked on every single request, while keeping the
// ability to instantly revoke a session for the token that's checked rarely.
import { randomUUID, createHash } from 'node:crypto';
import type { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { redis } from '../config/redis.js';
import { env } from '../config/env.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken, decodeRefreshTokenUnsafe } from '../utils/jwt.js';
import { AppError } from '../utils/AppError.js';
import type { Role } from '../generated/prisma/client.js';

export const REFRESH_COOKIE_NAME = 'bravomart_refresh_token';

interface IssueTokensInput {
  userId: string;
  role: Role;
  vendorProfileId?: string;
  dispatchRiderProfileId?: string;
  userAgent?: string;
  ipAddress?: string;
}

interface RequestMeta {
  userAgent?: string;
  ipAddress?: string;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * We never store a refresh token in Redis or Postgres in its raw form — only
 * this SHA-256 fingerprint. If either store ever leaked, the leaked hashes
 * would be useless to an attacker (SHA-256 isn't reversible).
 *
 * This is deliberately NOT bcrypt, even though bcrypt is what we use for
 * passwords (see utils/password.ts). Bcrypt is intentionally SLOW — that's
 * exactly what makes it good for passwords, which are low-entropy secrets a
 * human can remember and an attacker might guess. A refresh token is a
 * cryptographically random, high-entropy string; nobody is going to guess
 * it, so there's nothing to slow down for. What we need instead is a FAST,
 * deterministic fingerprint we can compute on every single refresh request
 * without adding noticeable latency — which is exactly what a plain
 * cryptographic hash like SHA-256 is for.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function redisSessionKey(userId: string, jti: string): string {
  return `refresh:${userId}:${jti}`;
}

export async function issueTokenPair(input: IssueTokensInput): Promise<TokenPair> {
  const { userId, role, vendorProfileId, dispatchRiderProfileId, userAgent, ipAddress } = input;

  const accessToken = signAccessToken({ sub: userId, role, vendorProfileId, dispatchRiderProfileId });

  const jti = randomUUID();
  const refreshToken = signRefreshToken({ sub: userId, jti });
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000);

  // Redis is the fast path every /auth/refresh call actually checks. The
  // key's own TTL matching REFRESH_TOKEN_TTL_SECONDS means an expired
  // session simply disappears from Redis on its own — no cleanup job needed.
  await redis.set(redisSessionKey(userId, jti), tokenHash, 'EX', env.REFRESH_TOKEN_TTL_SECONDS);

  // Postgres is the durable audit trail: it survives a Redis flush/restart
  // and is what a future "your active sessions" account page would query.
  await prisma.refreshToken.create({
    data: { userId, tokenHash, expiresAt, userAgent, ipAddress },
  });

  return { accessToken, refreshToken };
}

/**
 * Called on every hit to POST /api/auth/refresh. Implements refresh-token
 * ROTATION: every refresh both consumes the old token and issues a brand
 * new one, rather than letting one refresh token live untouched for its
 * entire 30-day lifetime.
 *
 * Rotation buys us reuse detection almost for free: if the SAME refresh
 * token is ever presented twice, the second attempt finds nothing in Redis
 * (the first attempt already deleted it) and we treat that as a signal the
 * token was stolen and replayed — so we kill every session for that user,
 * not just the one token. A beginner's "just check if the token is valid"
 * implementation has no way to notice this at all.
 */
export async function rotateRefreshToken(rawRefreshToken: string, meta: RequestMeta): Promise<TokenPair> {
  let payload;
  try {
    payload = verifyRefreshToken(rawRefreshToken);
  } catch {
    throw new AppError('Invalid or expired refresh token. Please log in again.', 401);
  }

  const { sub: userId, jti } = payload;
  const key = redisSessionKey(userId, jti);
  const storedHash = await redis.get(key);

  if (!storedHash) {
    // Missing from Redis with a signature that still checks out means one
    // of two things: it naturally expired (fine, just ask them to log back
    // in), or it was already rotated once and someone is replaying the old
    // value (not fine — could be a stolen token). We can't tell those two
    // apart from here, so we treat both the same way: revoke everything and
    // force a fresh login. Erring toward "too cautious" is correct for auth.
    await revokeAllUserSessions(userId);
    throw new AppError('Session expired or already used. Please log in again.', 401);
  }

  if (storedHash !== hashToken(rawRefreshToken)) {
    // The jti matched a real session, but the token's own content doesn't
    // hash to what we stored — extremely unlikely to happen by accident.
    // Same response as above: assume compromise, revoke everything.
    await revokeAllUserSessions(userId);
    throw new AppError('Refresh token integrity check failed. Please log in again.', 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { vendorProfile: true, dispatchRiderProfile: true },
  });

  if (!user) {
    throw new AppError('This account no longer exists.', 401);
  }

  // Rotate: destroy the token that was just used BEFORE minting its
  // replacement, so it can never be validated a second time.
  await redis.del(key);
  await prisma.refreshToken.updateMany({
    where: { userId, tokenHash: storedHash, isRevoked: false },
    data: { isRevoked: true },
  });

  return issueTokenPair({
    userId: user.id,
    role: user.role,
    vendorProfileId: user.vendorProfile?.id,
    dispatchRiderProfileId: user.dispatchRiderProfile?.id,
    userAgent: meta.userAgent,
    ipAddress: meta.ipAddress,
  });
}

/** Revokes exactly one session — used on logout. */
export async function revokeSession(rawRefreshToken: string): Promise<void> {
  // jwt.decode() (unlike jwt.verify()) never checks the signature — we're
  // not trusting this payload for authorization, only using it as a hint
  // for which Redis key to remove. The actual, trustworthy revocation
  // happens below via an exact tokenHash match, which nobody can forge.
  const decoded = decodeRefreshTokenUnsafe(rawRefreshToken);
  if (decoded) {
    await redis.del(redisSessionKey(decoded.sub, decoded.jti));
  }

  const tokenHash = hashToken(rawRefreshToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash },
    data: { isRevoked: true },
  });
}

/** Revokes every session for a user — used on suspected token theft/reuse. */
export async function revokeAllUserSessions(userId: string): Promise<void> {
  const pattern = redisSessionKey(userId, '*');
  const keysToDelete: string[] = [];
  let cursor = '0';

  // SCAN, never KEYS: KEYS blocks the entire single-threaded Redis event
  // loop until it has walked the whole keyspace, which is fine on your
  // laptop with 40 keys and a production incident with 40 million. SCAN
  // walks the same keyspace in small, non-blocking batches via a cursor.
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    keysToDelete.push(...keys);
    cursor = nextCursor;
  } while (cursor !== '0');

  if (keysToDelete.length > 0) {
    await redis.del(...keysToDelete);
  }

  await prisma.refreshToken.updateMany({
    where: { userId, isRevoked: false },
    data: { isRevoked: true },
  });
}

/**
 * The refresh cookie is scoped to `/api/auth` on purpose: the browser will
 * only ever attach it to requests under that path, not to every request to
 * the API. That's a small but real reduction in exposure — routes that have
 * nothing to do with auth never see this cookie at all, which matters if
 * one of them were ever vulnerable to something like reflected data leakage.
 */
export function setRefreshTokenCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth',
    domain: env.COOKIE_DOMAIN,
    maxAge: env.REFRESH_TOKEN_TTL_SECONDS * 1000,
  });
}

export function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth',
    domain: env.COOKIE_DOMAIN,
  });
}
