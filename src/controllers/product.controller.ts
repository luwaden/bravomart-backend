import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import * as productService from '../services/product.service.js';
import type { ProductListQuery, ProductIdParams } from '../schemas/product.schema.js';

export const getProducts = asyncHandler(async (req: Request, res: Response) => {
  // Read from req.validated, not req.query directly — see the comment in
  // middlewares/validate.ts on why Express 5's read-only req.query means
  // coerced/validated query data lives in its own namespace.
  const query = req.validated?.query as ProductListQuery;
  const result = await productService.listProducts(query);

  sendSuccess(res, 200, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
    totalPages: result.totalPages,
  });
});

export const getProductById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.validated?.params as ProductIdParams;
  const product = await productService.getProductById(id);
  sendSuccess(res, 200, product);
});
