import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { getOrSetCache, invalidateCache, invalidateCachePattern } from './cache.service.js';
import { toProductResponse, type ProductResponse } from '../utils/serializers.js';
import type { ProductListQuery } from '../schemas/product.schema.js';

const PRODUCT_LIST_TTL_SECONDS = 60;
const PRODUCT_DETAIL_TTL_SECONDS = 120;
const PRODUCT_LIST_CACHE_PREFIX = 'products:list';
const PRODUCT_DETAIL_CACHE_PREFIX = 'products:detail';

const VENDOR_SUMMARY_SELECT = { id: true, shopName: true, shopAddress: true } as const;

export interface ProductListResult {
  items: ProductResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function listProducts(query: ProductListQuery): Promise<ProductListResult> {
  const { category, page, limit } = query;
  // The cache key encodes every input that changes the result — category
  // filter, page, and limit — because two different queries that happened
  // to share a key would silently serve each other's (wrong) cached data.
  const cacheKey = `${PRODUCT_LIST_CACHE_PREFIX}:${category ?? 'all'}:${page}:${limit}`;

  return getOrSetCache(cacheKey, PRODUCT_LIST_TTL_SECONDS, async () => {
    const where = category ? { category: { name: category } } : {};

    const [rows, total] = await prisma.$transaction([
      prisma.product.findMany({
        where,
        include: { category: true, vendor: { select: VENDOR_SUMMARY_SELECT } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.product.count({ where }),
    ]);

    // Converted to plain numbers BEFORE this object gets JSON.stringify'd
    // into Redis — not after reading it back out. That matters: on a cache
    // HIT, `getOrSetCache` returns whatever was stored via `JSON.parse`,
    // with no chance to run Prisma-specific conversion logic afterwards.
    // If we cached the raw Prisma rows (with `price` as a Decimal object),
    // a cache MISS would return `price` as a number but a cache HIT would
    // return it as a string — a bug that only appears intermittently,
    // exactly the kind that's miserable to track down later.
    const items = rows.map(toProductResponse);

    return { items, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
  });
}

export async function getProductById(id: string): Promise<ProductResponse> {
  const cacheKey = `${PRODUCT_DETAIL_CACHE_PREFIX}:${id}`;

  return getOrSetCache(cacheKey, PRODUCT_DETAIL_TTL_SECONDS, async () => {
    const product = await prisma.product.findUnique({
      where: { id },
      include: { category: true, vendor: { select: VENDOR_SUMMARY_SELECT } },
    });

    if (!product) {
      throw new AppError('Product not found.', 404);
    }

    return toProductResponse(product);
  });
}

/**
 * Called after any write that changes the product catalog (right now, only
 * the AI-create endpoint — see aiProduct.service.ts). Every cached LIST page
 * is invalidated unconditionally, because a new product can affect any
 * page's contents and ordering; the single DETAIL cache entry is only
 * invalidated when we know exactly which product changed.
 */
export async function invalidateProductCaches(productId?: string): Promise<void> {
  await invalidateCachePattern(`${PRODUCT_LIST_CACHE_PREFIX}:*`);
  if (productId) {
    await invalidateCache(`${PRODUCT_DETAIL_CACHE_PREFIX}:${productId}`);
  }
}
