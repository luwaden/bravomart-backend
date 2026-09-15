import { z } from 'zod';

// What the client sends to POST /api/orders to turn their current cart into
// a real order. Deliberately does NOT accept prices, item weights, or
// distances from the client — see order.service.ts's checkout(), which
// recomputes every one of those server-side from the live cart/product/
// vendor data. Trusting client-submitted totals for money is how you get a
// ₦0 order for a ₦300,000 excavator.
export const checkoutSchema = z.object({
  deliveryAddress: z.string().trim().min(5, { error: 'Enter a full delivery address.' }).max(300),
  deliveryLat: z.coerce.number().min(-90).max(90).optional(),
  deliveryLng: z.coerce.number().min(-180).max(180).optional(),
  paymentMethod: z.enum(['CARD', 'BANK_TRANSFER'], { error: 'paymentMethod must be CARD or BANK_TRANSFER.' }),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const orderListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
});
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

export const orderIdParamsSchema = z.object({
  orderId: z.uuid({ error: 'A valid order id is required.' }),
});
export type OrderIdParams = z.infer<typeof orderIdParamsSchema>;

export const shipmentParamsSchema = z.object({
  orderId: z.uuid({ error: 'A valid order id is required.' }),
  shipmentId: z.uuid({ error: 'A valid shipment id is required.' }),
});
export type ShipmentParams = z.infer<typeof shipmentParamsSchema>;
