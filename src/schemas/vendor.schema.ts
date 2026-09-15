import { z } from 'zod';

// Captured by navigator.geolocation on the vendor's device
// (AdminAiAssistant.jsx's "capture shop GPS" button) and persisted here so
// order.service.ts can compute real pickup-to-delivery distances instead of
// falling back to a guessed default for every shipment.
export const updateVendorLocationSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});
export type UpdateVendorLocationInput = z.infer<typeof updateVendorLocationSchema>;

export const vendorWalletQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
});
export type VendorWalletQuery = z.infer<typeof vendorWalletQuerySchema>;
