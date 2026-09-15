import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { calculateGpsDistanceKm, calculateShippingCost } from '../utils/geo.js';
import { recordWalletTransaction } from './wallet.service.js';
import {
  toOrderResponse,
  type OrderResponse,
  type DispatchRiderSummary,
} from '../utils/serializers.js';
import type { CheckoutInput } from '../schemas/order.schema.js';
import type { Prisma } from '../generated/prisma/client.js';

const PLATFORM_FEE_RATE = 0.03; // 3% — matches CartSummary.jsx's displayed rate.
export const ESCROW_HOLD_DAYS = 7; // matches Help.jsx / AboutUs.jsx's advertised buyer guarantee.
const FALLBACK_DISTANCE_KM = 8.5; // used only if a vendor has no captured shop GPS yet.
// A single fixed reference point (central Lagos) so a brand-new vendor
// without captured GPS still gets a plausible, non-zero shipping estimate
// rather than an error — matches the frontend's own DEFAULT_VENDOR fallback
// coords in AdminAiAssistant.jsx.
const FALLBACK_VENDOR_COORDS = { lat: 6.4531, lng: 3.3958 };

const ORDER_INCLUDE = {
  shipments: {
    include: {
      items: true,
      vendor: { select: { id: true, shopName: true, shopAddress: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.OrderInclude;

/**
 * Rider identity (name/phone) lives on User, not DispatchRiderProfile, so
 * resolving "who is delivering this shipment" for the API response needs a
 * second query. Batched once per order-detail call rather than once per
 * shipment, to keep this from becoming an N+1 as multi-vendor orders with
 * many shipments become common.
 */
async function buildRiderSummaries(riderIds: string[]): Promise<Map<string, DispatchRiderSummary>> {
  const uniqueIds = [...new Set(riderIds)];
  if (uniqueIds.length === 0) return new Map();

  const riders = await prisma.dispatchRiderProfile.findMany({
    where: { id: { in: uniqueIds } },
    include: { user: { select: { fullName: true, phone: true } } },
  });

  return new Map(
    riders.map((rider) => [rider.id, { id: rider.id, vehicleType: rider.vehicleType, fullName: rider.user.fullName, phone: rider.user.phone }]),
  );
}

async function loadOrderWithRiders(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: ORDER_INCLUDE });
  if (!order) return null;

  const riderIds = order.shipments.map((s) => s.dispatchRiderId).filter((id): id is string => Boolean(id));
  const riderSummaries = await buildRiderSummaries(riderIds);
  return toOrderResponse(order, riderSummaries);
}

/**
 * Turns the caller's current cart into a real Order. Every price, weight,
 * and distance used here is re-derived from live database rows — see the
 * doc comment on checkoutSchema for why nothing about money is ever trusted
 * from the request body.
 */
export async function checkout(userId: string, input: CheckoutInput): Promise<OrderResponse> {
  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: { items: { include: { product: { include: { vendor: true } } } } },
  });

  if (!cart || cart.items.length === 0) {
    throw new AppError('Your cart is empty.', 400);
  }

  // Group cart lines by vendor — this is the one step that turns a flat
  // cart into the multi-vendor Shipment shape. Order of vendors in the
  // resulting array doesn't matter; Map preserves first-seen insertion
  // order, which is enough determinism for a checkout receipt.
  const itemsByVendor = new Map<string, typeof cart.items>();
  for (const item of cart.items) {
    const vendorId = item.product.vendorId;
    if (!itemsByVendor.has(vendorId)) itemsByVendor.set(vendorId, []);
    itemsByVendor.get(vendorId)!.push(item);
  }

  const orderNumber = `BM-${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`;

  const order = await prisma.$transaction(async (tx) => {
    let subtotal = 0;
    let shippingTotal = 0;

    const createdOrder = await tx.order.create({
      data: {
        orderNumber,
        userId,
        status: 'PROCESSING', // no real payment gateway wired yet — see paymentStatus below.
        deliveryAddress: input.deliveryAddress,
        deliveryLat: input.deliveryLat,
        deliveryLng: input.deliveryLng,
        paymentMethod: input.paymentMethod,
        // Immediately marked ESCROW_HELD (rather than PENDING) because
        // there's no payment gateway integrated yet to wait on a webhook
        // from — see docs/CART_ORDERS_DISPATCH.md for how to wire a real
        // one in without touching this transaction's shape.
        paymentStatus: 'ESCROW_HELD',
        subtotal: 0,
        shippingTotal: 0,
        platformFeeTotal: 0,
        grandTotal: 0,
      },
    });

    for (const [vendorId, items] of itemsByVendor) {
      // Guaranteed non-empty: every vendorId only enters `itemsByVendor` via
      // the loop above, which always pushes at least one item in the same
      // pass — the `!` reflects that invariant, not an unchecked assumption.
      const vendor = items[0]!.product.vendor;

      // Defensive re-check at the moment of commit — the cart may have
      // gone stale between "viewed cart" and "clicked pay" (another buyer
      // could have bought the last unit in between).
      for (const item of items) {
        const result = await tx.product.updateMany({
          where: { id: item.productId, inventory: { gte: item.quantity } },
          data: { inventory: { decrement: item.quantity } },
        });
        if (result.count === 0) {
          throw new AppError(`"${item.product.title}" no longer has enough stock. Please update your cart.`, 409);
        }
      }

      const pickupLat = vendor.shopLat ?? FALLBACK_VENDOR_COORDS.lat;
      const pickupLng = vendor.shopLng ?? FALLBACK_VENDOR_COORDS.lng;
      const distanceKm =
        input.deliveryLat !== undefined && input.deliveryLng !== undefined
          ? calculateGpsDistanceKm(pickupLat, pickupLng, input.deliveryLat, input.deliveryLng)
          : FALLBACK_DISTANCE_KM;

      const weightKg = items.reduce((sum, item) => sum + Number(item.product.weightKg) * item.quantity, 0);
      const itemsTotal = items.reduce((sum, item) => sum + Number(item.product.price) * item.quantity, 0);
      const shippingFee = calculateShippingCost({ weightKg, distanceKm });

      subtotal += itemsTotal;
      shippingTotal += shippingFee;

      await tx.shipment.create({
        data: {
          orderId: createdOrder.id,
          vendorId,
          pickupAddress: vendor.shopAddress,
          pickupLat,
          pickupLng,
          distanceKm,
          weightKg,
          itemsTotal,
          shippingFee,
          items: {
            create: items.map((item) => ({
              productId: item.productId,
              titleSnapshot: item.product.title,
              imageSnapshot: item.product.imageUrl,
              priceSnapshot: item.product.price,
              weightKgSnapshot: item.product.weightKg,
              quantity: item.quantity,
              lineTotal: Number(item.product.price) * item.quantity,
            })),
          },
        },
      });
    }

    const platformFeeTotal = Math.round((subtotal + shippingTotal) * PLATFORM_FEE_RATE);
    const grandTotal = subtotal + shippingTotal + platformFeeTotal;

    await tx.order.update({
      where: { id: createdOrder.id },
      data: { subtotal, shippingTotal, platformFeeTotal, grandTotal },
    });

    // Cart is single-use per checkout — clear it now that its contents
    // have been committed into an order.
    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

    return tx.order.findUniqueOrThrow({ where: { id: createdOrder.id }, include: ORDER_INCLUDE });
  });

  return toOrderResponse(order);
}

export async function listOrdersForUser(userId: string, page: number, limit: number) {
  const [orders, total] = await prisma.$transaction([
    prisma.order.findMany({
      where: { userId },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.order.count({ where: { userId } }),
  ]);

  const allRiderIds = orders.flatMap((o) => o.shipments.map((s) => s.dispatchRiderId).filter((id): id is string => Boolean(id)));
  const riderSummaries = await buildRiderSummaries(allRiderIds);

  return {
    items: orders.map((order) => toOrderResponse(order, riderSummaries)),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

/** Also used by the admin controller — `requestingUserId`/`isStaff` gates who's allowed to see it. */
export async function getOrderById(orderId: string, requestingUserId: string, isStaff: boolean): Promise<OrderResponse> {
  const order = await loadOrderWithRiders(orderId);
  if (!order) {
    throw new AppError('Order not found.', 404);
  }
  if (!isStaff && order.userId !== requestingUserId) {
    throw new AppError('You do not have access to this order.', 403);
  }
  return order;
}

/**
 * Recomputes the parent Order's denormalized `status` from its Shipments'
 * current statuses. Called after every shipment-status transition rather
 * than kept in sync ad hoc, so the aggregate can never fall out of step
 * with the shipments it's summarizing.
 */
export async function recomputeOrderStatus(tx: Prisma.TransactionClient, orderId: string) {
  const shipments = await tx.shipment.findMany({ where: { orderId }, select: { status: true } });
  const statuses = shipments.map((s) => s.status);

  let status: 'PROCESSING' | 'PARTIALLY_DELIVERED' | 'DELIVERED' | 'COMPLETED' | 'CANCELLED';
  if (statuses.every((s) => s === 'CANCELLED')) status = 'CANCELLED';
  else if (statuses.every((s) => s === 'DELIVERED' || s === 'CANCELLED')) status = 'COMPLETED';
  else if (statuses.some((s) => s === 'DELIVERED')) status = 'PARTIALLY_DELIVERED';
  else status = 'PROCESSING';

  await tx.order.update({ where: { id: orderId }, data: { status } });
}

/**
 * The buyer's "I received this and it matches what I ordered" action —
 * releases that vendor's escrowed funds immediately. This is the
 * buyer-initiated fast path; the 7-day auto-release for buyers who never
 * explicitly confirm is a background job left as a documented follow-up
 * (see docs/CART_ORDERS_DISPATCH.md) rather than built into this request.
 */
export async function confirmShipmentDelivery(orderId: string, shipmentId: string, userId: string): Promise<OrderResponse> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { shipments: true } });
  if (!order) throw new AppError('Order not found.', 404);
  if (order.userId !== userId) throw new AppError('You do not have access to this order.', 403);

  const shipment = order.shipments.find((s) => s.id === shipmentId);
  if (!shipment) throw new AppError('Shipment not found on this order.', 404);
  if (shipment.escrowStatus !== 'HELD') {
    throw new AppError(`This shipment's escrow has already been ${shipment.escrowStatus.toLowerCase()}.`, 409);
  }

  await prisma.$transaction(async (tx) => {
    await tx.shipment.update({
      where: { id: shipmentId },
      data: {
        status: 'DELIVERED',
        deliveredAt: shipment.deliveredAt ?? new Date(),
        escrowStatus: 'RELEASED',
        escrowReleaseAt: new Date(),
      },
    });

    await recordWalletTransaction(tx, {
      vendorId: shipment.vendorId,
      shipmentId,
      type: 'ESCROW_RELEASE',
      amount: Number(shipment.itemsTotal),
      description: `Escrow released for order ${order.orderNumber}`,
    });

    await recomputeOrderStatus(tx, orderId);
  });

  return loadOrderWithRiders(orderId) as Promise<OrderResponse>;
}

/**
 * Buyer flags a delivered/undelivered shipment as a problem — freezes it
 * for admin review rather than auto-releasing or auto-refunding, since
 * only a human can adjudicate "the item didn't match the listing" claims.
 * See BravoAdmin.jsx's escrow dispute-resolution tab, which this backs.
 */
export async function disputeShipment(orderId: string, shipmentId: string, userId: string): Promise<OrderResponse> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { shipments: true } });
  if (!order) throw new AppError('Order not found.', 404);
  if (order.userId !== userId) throw new AppError('You do not have access to this order.', 403);

  const shipment = order.shipments.find((s) => s.id === shipmentId);
  if (!shipment) throw new AppError('Shipment not found on this order.', 404);
  if (shipment.escrowStatus !== 'HELD') {
    throw new AppError('This shipment has already been resolved and can no longer be disputed.', 409);
  }

  await prisma.shipment.update({ where: { id: shipmentId }, data: { status: 'DISPUTED' } });
  return loadOrderWithRiders(orderId) as Promise<OrderResponse>;
}

/**
 * Staff-only override for BravoAdmin.jsx's "Force manual release" button —
 * bypasses the buyer confirmation step entirely (e.g. to resolve a dispute
 * in the vendor's favor after review).
 */
export async function forceReleaseEscrow(orderId: string, shipmentId: string): Promise<OrderResponse> {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment || shipment.orderId !== orderId) throw new AppError('Shipment not found on this order.', 404);
  if (shipment.escrowStatus !== 'HELD') {
    throw new AppError(`This shipment's escrow has already been ${shipment.escrowStatus.toLowerCase()}.`, 409);
  }

  await prisma.$transaction(async (tx) => {
    await tx.shipment.update({
      where: { id: shipmentId },
      data: { escrowStatus: 'RELEASED', escrowReleaseAt: new Date(), status: shipment.status === 'DISPUTED' ? 'DELIVERED' : shipment.status },
    });
    await recordWalletTransaction(tx, {
      vendorId: shipment.vendorId,
      shipmentId,
      type: 'ESCROW_RELEASE',
      amount: Number(shipment.itemsTotal),
      description: 'Escrow force-released by BravoMart admin',
    });
    await recomputeOrderStatus(tx, orderId);
  });

  return loadOrderWithRiders(orderId) as Promise<OrderResponse>;
}
