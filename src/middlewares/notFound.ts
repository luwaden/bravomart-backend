import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/AppError.js';

/**
 * Mounted last, right before the error handler. Any request that reached
 * this point matched no route at all — turning that into an AppError means
 * it flows through the exact same JSON error shape as every other failure
 * instead of Express's default HTML 404 page.
 */
export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
}
