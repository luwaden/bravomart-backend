import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate.js';
import { authorize } from '../middlewares/authorize.js';
import { upload } from '../middlewares/upload.js';
import { validate } from '../middlewares/validate.js';
import { aiCreateRateLimiter } from '../middlewares/rateLimiter.js';
import { aiCreateProductBodySchema } from '../schemas/aiProduct.schema.js';
import { orderIdParamsSchema, shipmentParamsSchema } from '../schemas/order.schema.js';
import { createProductWithAi } from '../controllers/aiProduct.controller.js';
import * as adminController from '../controllers/admin.controller.js';

const router = Router();

/**
 * POST /api/admin/products/ai-create
 *
 * Middleware order matters and is deliberate:
 *  1. authenticate     — must have a valid access token at all.
 *  2. authorize(...)    — must be a VENDOR (their own shop) or platform staff.
 *  3. aiCreateRateLimiter — throttle BEFORE we spend money calling Gemini.
 *  4. upload.single()  — parse the optional image out of the multipart body.
 *  5. validate(...)     — check `prompt` (and `vendorId` for staff callers).
 *  6. createProductWithAi — the actual controller.
 *
 * See resolveTargetVendorId() in services/aiProduct.service.ts for exactly
 * how VENDOR vs ADMIN/SUPER_ADMIN callers are handled differently.
 */
router.post(
  '/products/ai-create',
  authenticate,
  authorize('VENDOR', 'ADMIN', 'SUPER_ADMIN'),
  aiCreateRateLimiter,
  upload.single('image'),
  validate({ body: aiCreateProductBodySchema }),
  createProductWithAi,
);

/**
 * Staff-only order/escrow oversight — backs BravoAdmin.jsx's escrow tab.
 * ADMIN and SUPER_ADMIN only; a VENDOR seeing another vendor's order or
 * force-releasing their own escrow would defeat the point of escrow.
 */
router.get(
  '/orders/:orderId',
  authenticate,
  authorize('ADMIN', 'SUPER_ADMIN'),
  validate({ params: orderIdParamsSchema }),
  adminController.getAnyOrder,
);
router.post(
  '/orders/:orderId/shipments/:shipmentId/force-release',
  authenticate,
  authorize('ADMIN', 'SUPER_ADMIN'),
  validate({ params: shipmentParamsSchema }),
  adminController.forceReleaseEscrow,
);

export default router;
