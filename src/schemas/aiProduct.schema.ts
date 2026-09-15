import { z } from 'zod';

/**
 * Exactly the five values the task's Gemini `responseSchema` is locked to.
 * This constant is the single source of truth for that enum — it feeds
 * BOTH the Gemini request (services/aiProduct.service.ts builds the
 * `responseSchema.category.enum` from it) AND the seed script that creates
 * matching `Category` rows (prisma/seed.ts). Change it in exactly one place
 * and both sides of the system stay in sync.
 */
export const PRODUCT_CATEGORIES = ['Clothing', 'Electronics', 'Home', 'Beauty', 'Other'] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

// What the client sends to POST /api/admin/products/ai-create. The image
// itself is not part of this schema — multer parses it separately into
// `req.file` before this schema ever sees `req.body`.
export const aiCreateProductBodySchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(10, { error: 'Describe the product in at least 10 characters so the AI has enough to work with.' })
    .max(2000, { error: 'Keep the prompt under 2000 characters.' }),
  // Only meaningful (and required) for ADMIN / SUPER_ADMIN callers — a
  // VENDOR always publishes to their own shop regardless of what's sent
  // here. See resolveTargetVendorId() in services/aiProduct.service.ts.
  vendorId: z.uuid({ error: 'vendorId must be a valid UUID.' }).optional(),
  // Vendor-supplied (not AI-inferred) — matches the separate weight input
  // AdminAiAssistant.jsx already collects alongside the AI prompt. Used for
  // shipping calculations at checkout; see utils/geo.ts.
  weightKg: z.coerce.number().positive().max(5000).default(1),
});
export type AiCreateProductBody = z.infer<typeof aiCreateProductBodySchema>;

/**
 * The shape we require Gemini's JSON to match. We ALSO pass an equivalent
 * shape to Gemini itself as `responseSchema` (see aiProduct.service.ts) —
 * so why validate again here?
 *
 * `responseSchema` constrains what Gemini is *supposed* to output; it is
 * not a contract enforced by our own process. A model update, an API
 * hiccup, or a genuinely malformed response could still hand us JSON that
 * doesn't match — and that JSON is about to be written to our database.
 * "Never trust an upstream service, even one you configured carefully" is
 * the same instinct that makes you validate a request body from your own
 * frontend; it doesn't stop applying just because the upstream is an AI
 * model instead of a browser.
 */
export const aiGeneratedListingSchema = z.object({
  title: z.string().trim().min(3).max(150),
  description: z.string().trim().min(20).max(3000),
  price: z.number().positive(),
  category: z.enum(PRODUCT_CATEGORIES),
  tags: z.array(z.string().trim().min(1)).max(15).default([]),
  inventory: z.number().int().min(0).default(1),
});
export type AiGeneratedListing = z.infer<typeof aiGeneratedListingSchema>;
