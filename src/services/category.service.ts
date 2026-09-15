import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { getOrSetCache, invalidateCache } from './cache.service.js';
import type { Category } from '../generated/prisma/client.js';

const CATEGORY_LIST_CACHE_KEY = 'categories:list';
// Categories change extremely rarely (they're seeded once), so this cache
// is long-lived compared to the product cache — a much higher hit rate for
// almost zero staleness risk.
const CATEGORY_LIST_TTL_SECONDS = 60 * 60;

export async function listCategories(): Promise<Category[]> {
  return getOrSetCache(CATEGORY_LIST_CACHE_KEY, CATEGORY_LIST_TTL_SECONDS, () =>
    prisma.category.findMany({ orderBy: { name: 'asc' } }),
  );
}

/**
 * Looks a category up by its exact seeded name — this is how a Gemini
 * response like `"category": "Electronics"` (see aiProduct.service.ts)
 * turns into a real `categoryId` foreign key on the Product being created.
 */
export async function findCategoryByName(name: string): Promise<Category> {
  const category = await prisma.category.findUnique({ where: { name } });
  if (!category) {
    throw new AppError(
      `Category '${name}' does not exist yet. Run \`npm run prisma:seed\` to create the default categories.`,
      500,
    );
  }
  return category;
}

export async function invalidateCategoryCache(): Promise<void> {
  await invalidateCache(CATEGORY_LIST_CACHE_KEY);
}
