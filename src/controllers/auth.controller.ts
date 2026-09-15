import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { AppError } from '../utils/AppError.js';
import * as authService from '../services/auth.service.js';
import * as tokenService from '../services/token.service.js';
import { persistImageBuffer } from '../services/upload.service.js';

/**
 * Controllers only translate between HTTP and the service layer — reading
 * `req`, calling a service, shaping `res`. No business logic (password
 * checks, database queries, token math) lives here; all of that is in
 * services/*.ts, which is what makes the services independently testable
 * without spinning up Express at all.
 */
function requestMeta(req: Request): { userAgent?: string; ipAddress?: string } {
  const userAgent = req.headers['user-agent'];
  return {
    userAgent,
    ipAddress: req.ip,
  };
}

export const registerCustomer = asyncHandler(async (req: Request, res: Response) => {
  const { user, tokens } = await authService.registerCustomer(req.body, requestMeta(req));
  tokenService.setRefreshTokenCookie(res, tokens.refreshToken);
  sendSuccess(res, 201, { user, accessToken: tokens.accessToken });
});

export const registerVendor = asyncHandler(async (req: Request, res: Response) => {
  let idCardUrl: string | undefined;
  if (req.file) {
    const stored = await persistImageBuffer(req.file.buffer, req.file.mimetype, 'kyc');
    idCardUrl = stored.url;
  }

  const result = await authService.registerVendor(req.body, idCardUrl);
  sendSuccess(res, 201, result);
});

export const registerDispatcher = asyncHandler(async (req: Request, res: Response) => {
  let idCardUrl: string | undefined;
  if (req.file) {
    const stored = await persistImageBuffer(req.file.buffer, req.file.mimetype, 'kyc');
    idCardUrl = stored.url;
  }

  const result = await authService.registerDispatcher(req.body, idCardUrl);
  sendSuccess(res, 201, result);
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { user, tokens } = await authService.login(req.body, requestMeta(req));
  tokenService.setRefreshTokenCookie(res, tokens.refreshToken);
  sendSuccess(res, 200, { user, accessToken: tokens.accessToken });
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const rawRefreshToken = req.cookies?.[tokenService.REFRESH_COOKIE_NAME] as string | undefined;
  if (!rawRefreshToken) {
    throw new AppError('No refresh token was supplied.', 401);
  }

  const tokens = await tokenService.rotateRefreshToken(rawRefreshToken, requestMeta(req));
  tokenService.setRefreshTokenCookie(res, tokens.refreshToken);
  sendSuccess(res, 200, { accessToken: tokens.accessToken });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const rawRefreshToken = req.cookies?.[tokenService.REFRESH_COOKIE_NAME] as string | undefined;
  if (rawRefreshToken) {
    await tokenService.revokeSession(rawRefreshToken);
  }
  tokenService.clearRefreshTokenCookie(res);
  sendSuccess(res, 200, { loggedOut: true });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('Authentication required.', 401);
  }
  const user = await authService.getCurrentUser(req.user.sub);
  sendSuccess(res, 200, user);
});
