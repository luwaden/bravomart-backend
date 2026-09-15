import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { AppError } from '../utils/AppError.js';
import * as orderService from '../services/order.service.js';
import type { CheckoutInput, OrderListQuery, OrderIdParams, ShipmentParams } from '../schemas/order.schema.js';

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new AppError('Authentication required.', 401);
  }
  return req.user.sub;
}

export const checkout = asyncHandler(async (req: Request, res: Response) => {
  const order = await orderService.checkout(requireUserId(req), req.body as CheckoutInput);
  sendSuccess(res, 201, order);
});

export const listMyOrders = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = req.validated?.query as OrderListQuery;
  const result = await orderService.listOrdersForUser(requireUserId(req), page, limit);
  sendSuccess(res, 200, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
    totalPages: result.totalPages,
  });
});

export const getMyOrder = asyncHandler(async (req: Request, res: Response) => {
  const { orderId } = req.validated?.params as OrderIdParams;
  const order = await orderService.getOrderById(orderId, requireUserId(req), false);
  sendSuccess(res, 200, order);
});

export const confirmDelivery = asyncHandler(async (req: Request, res: Response) => {
  const { orderId, shipmentId } = req.validated?.params as ShipmentParams;
  const order = await orderService.confirmShipmentDelivery(orderId, shipmentId, requireUserId(req));
  sendSuccess(res, 200, order);
});

export const disputeShipment = asyncHandler(async (req: Request, res: Response) => {
  const { orderId, shipmentId } = req.validated?.params as ShipmentParams;
  const order = await orderService.disputeShipment(orderId, shipmentId, requireUserId(req));
  sendSuccess(res, 200, order);
});
