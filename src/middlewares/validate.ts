import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { AppError } from '../utils/AppError.js';

interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

function formatZodError(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
  }));
}

/**
 * A single reusable middleware factory instead of hand-writing `try {
 * schema.parse(req.body) } catch {...}` in every controller. Attach it in
 * the route definition — `validate({ body: loginSchema })` — and the
 * controller can trust that whatever it reads from `req.body` already
 * matches the schema.
 *
 * Body vs. query/params is handled differently on purpose: `req.body` is a
 * plain writable property (set by express.json()), so we can safely replace
 * it with the parsed-and-coerced data. `req.query` in Express 5 is a
 * **read-only getter** derived from the URL — `req.query = anything` throws
 * at runtime. So validated query/param data is attached to `req.validated`
 * instead (see types/express.d.ts) and controllers read from there when
 * they need the coerced version (e.g. `page` as a number, not a string).
 */
export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (!result.success) {
        next(new AppError('Validation failed.', 422, formatZodError(result.error)));
        return;
      }
      req.body = result.data;
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) {
        next(new AppError('Validation failed.', 422, formatZodError(result.error)));
        return;
      }
      req.validated = { ...req.validated, params: result.data };
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) {
        next(new AppError('Validation failed.', 422, formatZodError(result.error)));
        return;
      }
      req.validated = { ...req.validated, query: result.data };
    }

    next();
  };
}
