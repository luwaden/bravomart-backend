import { Type } from '@google/genai';
import { genAI, GEMINI_MODEL } from '../config/genai.js';
import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { findCategoryByName } from './category.service.js';
import { invalidateProductCaches } from './product.service.js';
import { persistImageBuffer } from './upload.service.js';
import { toProductResponse, type ProductResponse } from '../utils/serializers.js';
import { aiGeneratedListingSchema, PRODUCT_CATEGORIES, type AiGeneratedListing } from '../schemas/aiProduct.schema.js';
import type { AccessTokenPayload } from '../types/jwt.types.js';

const VENDOR_SUMMARY_SELECT = { id: true, shopName: true, shopAddress: true } as const;

/**
 * Told to Gemini as `systemInstruction` — it shapes HOW the model writes,
 * separately from `responseSchema` below, which only constrains the JSON
 * *shape* of the output, not its content or tone.
 */
const SYSTEM_INSTRUCTION = `You are BravoMart's cataloguing assistant. Given a vendor's short product
description (and optionally a photo), write a clean, honest e-commerce listing.

Rules:
- "title" is a concise, buyer-facing product name (max ~12 words). No ALL CAPS, no emojis.
- "description" is 2-4 sentences written for an online storefront, and naturally works in a few
  relevant SEO keywords a shopper might search for. Do not invent facts the vendor did not provide
  and that are not visible in the photo — no fake certifications, no fabricated specifications.
- "price" is a plain number in Nigerian Naira, with no currency symbol or thousands separators,
  taken from what the vendor stated. If no price was given, provide a reasonable market estimate
  and say in the description that the price is an estimate.
- "category" must be exactly one of: ${PRODUCT_CATEGORIES.join(', ')}.
- "tags" is 3-8 short, lowercase search keywords with no duplicates.
- "inventory" is the stock count if the vendor mentioned one, otherwise default to 1.`;

/**
 * The JSON Schema handed to Gemini as `config.responseSchema`, paired with
 * `config.responseMimeType: 'application/json'`. This is what makes the
 * output "strict structured JSON" rather than "an LLM doing its best to
 * follow instructions written in the prompt" — Gemini's decoding is
 * constrained so it can only emit tokens that keep the output valid against
 * this shape.
 */
const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: 'Buyer-facing product title.' },
    description: { type: Type.STRING, description: 'SEO-aware e-commerce description, 2-4 sentences.' },
    price: { type: Type.NUMBER, description: 'Price in Naira as a plain number.' },
    category: { type: Type.STRING, enum: [...PRODUCT_CATEGORIES] },
    tags: { type: Type.ARRAY, items: { type: Type.STRING }, description: '3-8 lowercase search keywords.' },
    inventory: { type: Type.INTEGER, description: 'Units in stock; default to 1 if not mentioned.' },
  },
  required: ['title', 'description', 'price', 'category', 'tags'],
} as const;

interface ImageInput {
  buffer: Buffer;
  mimeType: string;
}

interface GenerateListingInput {
  prompt: string;
  image?: ImageInput;
}

/**
 * Calls Gemini with the vendor's prompt (and optional photo) and returns a
 * listing that has ALREADY been re-validated against `aiGeneratedListingSchema`
 * — never the raw, unchecked model output.
 */
export async function generateListingFromPrompt(input: GenerateListingInput): Promise<AiGeneratedListing> {
  const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];

  if (input.image) {
    // Gemini's multimodal input takes inline image bytes as base64 —
    // exactly the buffer multer already handed us in memory, no temp file
    // needed on either side of this call.
    parts.push({
      inlineData: {
        mimeType: input.image.mimeType,
        data: input.image.buffer.toString('base64'),
      },
    });
  }

  let rawText: string;

  try {
    const response = await genAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    rawText = response.text ?? '';
  } catch (error) {
    throw new AppError('The AI listing service is temporarily unavailable. Please try again shortly.', 502, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  if (!rawText) {
    throw new AppError('The AI did not return any content for this prompt.', 502);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    throw new AppError('The AI returned a response that was not valid JSON.', 502);
  }

  // Defense in depth: `responseSchema` above ASKS Gemini to conform to a
  // shape; it is not a contract our own process enforces. We re-validate
  // with the exact same rules we'd apply to a request body from a browser,
  // because "the upstream is an AI model" doesn't change the fact that it's
  // still an upstream we don't fully control.
  const validation = aiGeneratedListingSchema.safeParse(parsedJson);
  if (!validation.success) {
    throw new AppError('The AI response did not match the expected product shape.', 502, validation.error.issues);
  }

  return validation.data;
}

interface CreateAiProductInput {
  prompt: string;
  vendorId?: string;
  weightKg: number;
  image?: ImageInput;
  requestingUser: AccessTokenPayload;
}

/**
 * The full flow behind POST /api/admin/products/ai-create:
 * resolve which shop the listing belongs to → call Gemini → persist the
 * photo (if any) → write the Product row → invalidate the product caches →
 * return the saved product.
 */
export async function createAiGeneratedProduct(input: CreateAiProductInput): Promise<ProductResponse> {
  const vendorId = await resolveTargetVendorId(input.requestingUser, input.vendorId);

  const listing = await generateListingFromPrompt({ prompt: input.prompt, image: input.image });
  const category = await findCategoryByName(listing.category);

  let imageUrl: string | undefined;
  if (input.image) {
    const stored = await persistImageBuffer(input.image.buffer, input.image.mimeType, 'products');
    imageUrl = stored.url;
  }

  const product = await prisma.product.create({
    data: {
      title: listing.title,
      description: listing.description,
      price: listing.price,
      weightKg: input.weightKg,
      inventory: listing.inventory,
      tags: listing.tags,
      imageUrl,
      isAiGenerated: true,
      categoryId: category.id,
      vendorId,
    },
    include: { category: true, vendor: { select: VENDOR_SUMMARY_SELECT } },
  });

  // A new product invalidates every cached catalog page — see the comment
  // on invalidateProductCaches() in product.service.ts for why this is
  // unconditional rather than trying to patch individual cache entries.
  await invalidateProductCaches();

  return toProductResponse(product);
}

/**
 * Maps "who is calling this endpoint" onto "which shop does the new product
 * belong to" — and this is where the task's `/api/admin/products/ai-create`
 * naming and the frontend's actual UI meet. In BravoMart's frontend, the
 * page that calls this flow is literally named AdminAiAssistant.jsx, but
 * it's rendered as a VENDOR's own dashboard for managing their shop, not a
 * platform-staff screen — "Admin" there means "administer my store," not
 * "BravoMart staff." So a VENDOR token is allowed to hit this endpoint and
 * always publishes to their own shop; a platform ADMIN / SUPER_ADMIN token
 * is also allowed (e.g. to create a listing on a vendor's behalf) but must
 * say which shop via `vendorId`, since staff accounts have no shop of their
 * own to default to.
 */
async function resolveTargetVendorId(user: AccessTokenPayload, requestedVendorId?: string): Promise<string> {
  if (user.role === 'VENDOR') {
    if (!user.vendorProfileId) {
      throw new AppError('This vendor account has no linked shop profile.', 400);
    }
    // The request body's vendorId (if any) is ignored on purpose here — a
    // vendor must never be able to publish into another vendor's shop just
    // by passing a different id in the request.
    return user.vendorProfileId;
  }

  if (!requestedVendorId) {
    throw new AppError('vendorId is required when an admin creates a listing on behalf of a vendor.', 400);
  }

  const vendorProfile = await prisma.vendorProfile.findUnique({ where: { id: requestedVendorId } });
  if (!vendorProfile) {
    throw new AppError('No vendor exists with that vendorId.', 404);
  }

  return vendorProfile.id;
}
