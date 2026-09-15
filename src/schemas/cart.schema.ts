import { z } from 'zod';

export const addCartItemSchema = z.object({
  productId: z.uuid({ error: 'productId must be a valid product id.' }),
  quantity: z.coerce.number().int().positive().max(999).default(1),
});
export type AddCartItemInput = z.infer<typeof addCartItemSchema>;

export const updateCartItemBodySchema = z.object({
  // 0 is a valid input here and is treated as "remove this item" — see
  // cart.service.ts's updateItemQuantity(). A dedicated DELETE route also
  // exists for the same action; this just means the frontend's existing
  // quantity stepper (which can decrement to 0) doesn't need special-case
  // handling to call a different endpoint at the boundary.
  quantity: z.coerce.number().int().min(0).max(999),
});
export type UpdateCartItemBody = z.infer<typeof updateCartItemBodySchema>;

export const cartItemParamsSchema = z.object({
  productId: z.uuid({ error: 'A valid product id is required.' }),
});
export type CartItemParams = z.infer<typeof cartItemParamsSchema>;
