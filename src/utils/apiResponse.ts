import type { Response } from 'express';

/**
 * Every successful response in this API has the same envelope shape:
 * `{ success: true, data, meta? }`. A consistent shape means the frontend
 * can write one generic response parser instead of guessing per-endpoint
 * whether the payload is the object itself, `{ result: ... }`,
 * `{ product: ... }`, or something else — inconsistency here is a classic
 * source of frontend bugs that professionals avoid by picking one envelope
 * and using it everywhere, including in error responses (see AppError +
 * errorHandler, which mirrors this with `{ success: false, message }`).
 */
export function sendSuccess<T>(
  res: Response,
  statusCode: number,
  data: T,
  meta?: Record<string, unknown>,
): Response {
  return res.status(statusCode).json({
    success: true,
    data,
    ...(meta ? { meta } : {}),
  });
}
