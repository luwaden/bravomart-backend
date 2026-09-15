// Thin wrapper around jsonwebtoken so the rest of the app never imports
// `jsonwebtoken` directly or juggles two different secrets by hand. Keeping
// access-token and refresh-token signing/verifying in one file also makes it
// obvious at a glance that they use two DIFFERENT secrets — mixing those up
// (e.g. verifying a refresh token with the access secret) is a real mistake
// that's easy to make once this logic is scattered across controllers.
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { AccessTokenPayload, RefreshTokenPayload } from '../types/jwt.types.js';

export function signAccessToken(payload: AccessTokenPayload): string {
  const options: SignOptions = {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as SignOptions['expiresIn'],
  };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  const options: SignOptions = {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as SignOptions['expiresIn'],
  };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, options);
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
}

/**
 * Reads a refresh token's payload WITHOUT checking its signature or
 * expiry. Only ever used for best-effort Redis-key cleanup on logout (see
 * token.service.ts) — never for anything that grants access, because a
 * forged or expired token still "decodes" successfully.
 */
export function decodeRefreshTokenUnsafe(token: string): RefreshTokenPayload | null {
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded !== 'object') {
    return null;
  }
  return decoded as RefreshTokenPayload;
}
