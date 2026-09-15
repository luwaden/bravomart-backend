import { z } from 'zod';

// `z.coerce.number()` matters here: everything arriving in `req.query` is a
// string (URL query strings have no concept of a "number" type), so without
// coercion `page=2` would parse as the *string* "2" and fail a `z.number()`
// check outright.
export const productListQuerySchema = z.object({
  category: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export const productIdParamsSchema = z.object({
  id: z.uuid({ error: 'A valid product id is required.' }),
});
export type ProductIdParams = z.infer<typeof productIdParamsSchema>;
