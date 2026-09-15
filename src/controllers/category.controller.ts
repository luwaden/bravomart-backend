import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { listCategories } from '../services/category.service.js';

export const getCategories = asyncHandler(async (_req: Request, res: Response) => {
  const categories = await listCategories();
  sendSuccess(res, 200, categories);
});
