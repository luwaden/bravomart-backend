import type { NextFunction, Request, Response } from 'express';
import type { Role } from '../generated/prisma/client.js';
import { AppError } from '../utils/AppError.js';

/**
 * `authorize('VENDOR', 'ADMIN')` reads almost like English at the route
 * definition, which is exactly the point of RBAC middleware: the list of
 * who's allowed to hit an endpoint lives in one readable line in
 * routes/*.ts, instead of being an `if (user.role !== 'admin') return
 * res.status(403)...` buried inside a controller alongside unrelated logic.
 *
 * Always place this AFTER `authenticate` in the middleware chain —
 * `authorize` only reads `req.user`, it never verifies a token itself.
 */
export function authorize(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError('Authentication required.', 401));
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      next(new AppError(`Your role ('${req.user.role}') is not permitted to perform this action.`, 403));
      return;
    }

    next();
  };
}
