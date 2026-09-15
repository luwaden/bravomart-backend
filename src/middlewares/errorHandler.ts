import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { Prisma } from '../generated/prisma/client.js';
import { AppError } from '../utils/AppError.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * The single place in the app that decides "what does the client see when
 * something goes wrong". Every controller is wrapped in asyncHandler (or,
 * on Express 5, would forward automatically anyway), so every thrown error —
 * from any layer — eventually lands here instead of anywhere else.
 *
 * Express identifies error-handling middleware purely by *arity*: a
 * function with exactly four parameters (err, req, res, next) is treated as
 * an error handler, even though `next` is never called below. Renaming or
 * dropping that fourth parameter is a common beginner mistake that silently
 * turns this into a normal (non-error) middleware that Express never calls.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }

  if (err instanceof multer.MulterError) {
    res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({ success: false, message: 'A record with that value already exists.' });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ success: false, message: 'Record not found.' });
      return;
    }
  }

  // Anything that reaches here is NOT an anticipated, operational error —
  // it's a bug. Log the real detail server-side and show the client a
  // generic message in production so we never leak stack traces, file
  // paths, or SQL fragments to the outside world.
  logger.error(`Unhandled error on ${req.method} ${req.originalUrl}`, err);

  const message =
    env.NODE_ENV === 'production'
      ? 'Something went wrong. Please try again.'
      : err instanceof Error
        ? err.message
        : 'Unknown error';

  res.status(500).json({ success: false, message });
}
