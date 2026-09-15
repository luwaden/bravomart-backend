import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { AppError } from '../utils/AppError.js';
import { createAiGeneratedProduct } from '../services/aiProduct.service.js';
import type { AiCreateProductBody } from '../schemas/aiProduct.schema.js';

/**
 * POST /api/admin/products/ai-create
 *
 * By the time this function runs, the middleware chain in
 * routes/admin.routes.ts has already: verified the access token
 * (authenticate), checked the caller's role (authorize), rate-limited them
 * (aiCreateRateLimiter), parsed the optional image into `req.file`
 * (upload.single('image')), and validated `prompt`/`vendorId` (validate).
 * This controller's whole job is to hand those off to the service layer and
 * shape the HTTP response — 201 Created with the saved product.
 */
export const createProductWithAi = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('Authentication required.', 401);
  }

  const { prompt, vendorId, weightKg } = req.body as AiCreateProductBody;

  const image = req.file ? { buffer: req.file.buffer, mimeType: req.file.mimetype } : undefined;

  const product = await createAiGeneratedProduct({
    prompt,
    vendorId,
    weightKg,
    image,
    requestingUser: req.user,
  });

  sendSuccess(res, 201, product);
});
