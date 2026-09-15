import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { toCartResponse, type CartResponse } from '../utils/serializers.js';

const CART_INCLUDE = {
  items: {
    include: { product: { include: { category: true, vendor: { select: { id: true, shopName: true, shopAddress: true } } } } },
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

/**
 * Lazily creates a Cart the first time a user touches one, instead of at
 * registration — see the model's doc comment in schema.prisma. Every other
 * function in this file calls this first, so callers never have to worry
 * about a missing cart.
 */
async function getOrCreateCart(userId: string) {
  const existing = await prisma.cart.findUnique({ where: { userId }, include: CART_INCLUDE });
  if (existing) return existing;

  return prisma.cart.create({ data: { userId }, include: CART_INCLUDE });
}

export async function getCart(userId: string): Promise<CartResponse> {
  const cart = await getOrCreateCart(userId);
  return toCartResponse(cart);
}

async function assertProductIsPurchasable(productId: string, requestedQuantity: number): Promise<void> {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) {
    throw new AppError('Product not found.', 404);
  }
  if (product.inventory < requestedQuantity) {
    throw new AppError(`Only ${product.inventory} unit(s) of "${product.title}" left in stock.`, 409);
  }
}

export async function addItem(userId: string, productId: string, quantity: number): Promise<CartResponse> {
  const cart = await getOrCreateCart(userId);

  const existingItem = cart.items.find((item) => item.productId === productId);
  const newQuantity = (existingItem?.quantity ?? 0) + quantity;
  await assertProductIsPurchasable(productId, newQuantity);

  // `upsert` on the (cartId, productId) unique constraint means "add to
  // cart" and "add MORE of a product already in the cart" are the exact
  // same call — no separate "does this line already exist" branch needed
  // in the controller.
  await prisma.cartItem.upsert({
    where: { cartId_productId: { cartId: cart.id, productId } },
    update: { quantity: newQuantity },
    create: { cartId: cart.id, productId, quantity: newQuantity },
  });

  return getCart(userId);
}

export async function updateItemQuantity(userId: string, productId: string, quantity: number): Promise<CartResponse> {
  const cart = await getOrCreateCart(userId);
  const existingItem = cart.items.find((item) => item.productId === productId);
  if (!existingItem) {
    throw new AppError('That product is not in your cart.', 404);
  }

  if (quantity === 0) {
    await prisma.cartItem.delete({ where: { id: existingItem.id } });
    return getCart(userId);
  }

  await assertProductIsPurchasable(productId, quantity);
  await prisma.cartItem.update({ where: { id: existingItem.id }, data: { quantity } });
  return getCart(userId);
}

export async function removeItem(userId: string, productId: string): Promise<CartResponse> {
  const cart = await getOrCreateCart(userId);
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id, productId } });
  return getCart(userId);
}

export async function clearCart(userId: string): Promise<CartResponse> {
  const cart = await getOrCreateCart(userId);
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  return getCart(userId);
}
