import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { AppError } from '../utils/AppError.js';
import * as orderService from '../services/order.service.js';
import type { OrderIdParams, ShipmentParams } from '../schemas/order.schema.js';

function requireStaffId(req: Request): string {
  if (!req.user) throw new AppError('Authentication required.', 401);
  return req.user.sub;
}

export const getAnyOrder = asyncHandler(async (req: Request, res: Response) => {
  const { orderId } = req.validated?.params as OrderIdParams;
  const order = await orderService.getOrderById(orderId, requireStaffId(req), true);
  sendSuccess(res, 200, order);
});

/** Backs BravoAdmin.jsx's "Force manual release" button in the escrow tab. */
export const forceReleaseEscrow = asyncHandler(async (req: Request, res: Response) => {
  const { orderId, shipmentId } = req.validated?.params as ShipmentParams;
  const order = await orderService.forceReleaseEscrow(orderId, shipmentId);
  sendSuccess(res, 200, order);
});
