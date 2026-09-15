/**
 * Every error we deliberately throw for a "this request is invalid / not
 * allowed / not found" reason should be an AppError, not a bare `Error` or a
 * `throw { message: '...' }`. The error-handling middleware (see
 * middlewares/errorHandler.ts) checks `err instanceof AppError` first: if it
 * is, we trust the message and statusCode enough to send them straight to
 * the client. If it isn't, we assume it's a *bug* (a null pointer, a typo, a
 * library throwing something we didn't expect) and hide the real message
 * from the client in production, logging it server-side instead.
 *
 * That's what `isOperational` means here: "operational" errors are expected,
 * anticipated failure modes (bad input, missing record, unauthorized) that
 * are safe to describe to the caller. Non-operational errors are bugs.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  constructor(message: string, statusCode = 500, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.isOperational = true;
    this.details = details;

    // Excludes the AppError constructor itself from the stack trace so logs
    // point at where the error was *thrown*, not at this base class.
    Error.captureStackTrace(this, this.constructor);
  }
}
