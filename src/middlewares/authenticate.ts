import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../utils/jwt.js';
import { AppError } from '../utils/AppError.js';

/**
 * Checks the short-lived ACCESS token only — sent as `Authorization: Bearer
 * <token>` on every protected request. The long-lived REFRESH token never
 * appears here; it only ever travels as an httpOnly cookie to
 * POST /api/auth/refresh (see routes/auth.routes.ts and
 * services/token.service.ts). Keeping the two completely separate is the
 * point of the dual-token pattern: a stolen access token expires in
 * minutes and can't be used to mint new ones, because minting new tokens
 * requires the refresh token, which JavaScript can never read (httpOnly).
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    next(new AppError('Authentication required. Send an Authorization: Bearer <token> header.', 401));
    return;
  }

  const token = header.slice('Bearer '.length).trim();

  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    next(new AppError('Invalid or expired access token.', 401));
  }
}
