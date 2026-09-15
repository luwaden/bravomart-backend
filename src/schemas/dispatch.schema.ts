import { z } from 'zod';

export const updateAvailabilitySchema = z.object({
  isAvailable: z.boolean(),
});
export type UpdateAvailabilityInput = z.infer<typeof updateAvailabilitySchema>;

export const updateRiderLocationSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});
export type UpdateRiderLocationInput = z.infer<typeof updateRiderLocationSchema>;

export const shipmentIdParamsSchema = z.object({
  shipmentId: z.uuid({ error: 'A valid shipment id is required.' }),
});
export type ShipmentIdParams = z.infer<typeof shipmentIdParamsSchema>;
