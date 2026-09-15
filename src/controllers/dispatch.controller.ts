import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { AppError } from '../utils/AppError.js';
import * as dispatchService from '../services/dispatch.service.js';
import type { UpdateAvailabilityInput, UpdateRiderLocationInput, ShipmentIdParams } from '../schemas/dispatch.schema.js';

function requireRiderProfileId(req: Request): string {
  if (!req.user?.dispatchRiderProfileId) {
    throw new AppError('This account has no linked dispatcher profile.', 400);
  }
  return req.user.dispatchRiderProfileId;
}

export const updateAvailability = asyncHandler(async (req: Request, res: Response) => {
  const { isAvailable } = req.body as UpdateAvailabilityInput;
  const rider = await dispatchService.setAvailability(requireRiderProfileId(req), isAvailable);
  sendSuccess(res, 200, rider);
});

export const updateLocation = asyncHandler(async (req: Request, res: Response) => {
  const { lat, lng } = req.body as UpdateRiderLocationInput;
  const rider = await dispatchService.updateLocation(requireRiderProfileId(req), lat, lng);
  sendSuccess(res, 200, rider);
});

export const listAvailableShipments = asyncHandler(async (req: Request, res: Response) => {
  const shipments = await dispatchService.listAvailableShipments(requireRiderProfileId(req));
  sendSuccess(res, 200, shipments);
});

export const acceptShipment = asyncHandler(async (req: Request, res: Response) => {
  const { shipmentId } = req.validated?.params as ShipmentIdParams;
  const shipment = await dispatchService.acceptShipment(requireRiderProfileId(req), shipmentId);
  sendSuccess(res, 200, shipment);
});

export const markPickedUp = asyncHandler(async (req: Request, res: Response) => {
  const { shipmentId } = req.validated?.params as ShipmentIdParams;
  const shipment = await dispatchService.markPickedUp(requireRiderProfileId(req), shipmentId);
  sendSuccess(res, 200, shipment);
});

export const markDelivered = asyncHandler(async (req: Request, res: Response) => {
  const { shipmentId } = req.validated?.params as ShipmentIdParams;
  const shipment = await dispatchService.markDelivered(requireRiderProfileId(req), shipmentId);
  sendSuccess(res, 200, shipment);
});
