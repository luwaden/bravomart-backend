import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { AppError } from '../utils/AppError.js';
import * as vendorService from '../services/vendor.service.js';
import type { UpdateVendorLocationInput, VendorWalletQuery } from '../schemas/vendor.schema.js';

export const updateOwnShopLocation = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.vendorProfileId) {
    throw new AppError('This account has no linked shop profile.', 400);
  }

  const { lat, lng } = req.body as UpdateVendorLocationInput;
  const vendorProfile = await vendorService.updateOwnShopLocation(req.user.vendorProfileId, lat, lng);
  sendSuccess(res, 200, vendorProfile);
});

export const getOwnWalletHistory = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.vendorProfileId) {
    throw new AppError('This account has no linked shop profile.', 400);
  }

  const { page, limit } = req.validated?.query as VendorWalletQuery;
  const result = await vendorService.getOwnWalletHistory(req.user.vendorProfileId, page, limit);
  sendSuccess(res, 200, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
    totalPages: result.totalPages,
  });
});
