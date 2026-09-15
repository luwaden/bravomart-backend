import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { AppError } from '../utils/AppError.js';
import * as cartService from '../services/cart.service.js';
import type { AddCartItemInput, UpdateCartItemBody, CartItemParams } from '../schemas/cart.schema.js';

/** Every handler below assumes `authenticate` already ran — see cart.routes.ts. */
function requireUserId(req: Request): string {
  if (!req.user) {
    throw new AppError('Authentication required.', 401);
  }
  return req.user.sub;
}

export const getCart = asyncHandler(async (req: Request, res: Response) => {
  const cart = await cartService.getCart(requireUserId(req));
  sendSuccess(res, 200, cart);
});

export const addItem = asyncHandler(async (req: Request, res: Response) => {
  const { productId, quantity } = req.body as AddCartItemInput;
  const cart = await cartService.addItem(requireUserId(req), productId, quantity);
  sendSuccess(res, 200, cart);
});

export const updateItem = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.validated?.params as CartItemParams;
  const { quantity } = req.body as UpdateCartItemBody;
  const cart = await cartService.updateItemQuantity(requireUserId(req), productId, quantity);
  sendSuccess(res, 200, cart);
});

export const removeItem = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.validated?.params as CartItemParams;
  const cart = await cartService.removeItem(requireUserId(req), productId);
  sendSuccess(res, 200, cart);
});

export const clearCart = asyncHandler(async (req: Request, res: Response) => {
  const cart = await cartService.clearCart(requireUserId(req));
  sendSuccess(res, 200, cart);
});
