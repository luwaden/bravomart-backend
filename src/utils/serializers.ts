// Prisma models money-like columns (`Product.price`, `VendorProfile.walletBalance`)
// as `Decimal` — a wrapper around decimal.js, not a plain JavaScript number.
// That's the *correct* choice at the database layer: floating-point numbers
// cannot represent money exactly (0.1 + 0.2 !== 0.3 in every language that
// uses IEEE 754 floats), so a fixed-point Decimal type avoids rounding bugs
// creeping into prices over many calculations.
//
// The gotcha: `Prisma.Decimal` has a `toJSON()` method that turns it into a
// STRING when you `JSON.stringify` it — so `res.json(productFromDb)` would
// hand the frontend `"price": "24000.00"` (a string), not `"price": 24000`
// (a number). The BravoMart frontend already does
// `product.salePrice.toLocaleString()`, which expects a number. A beginner
// discovers this the hard way in the browser console; a professional draws
// an explicit line between "how the database stores it" and "what the API
// returns" — that line is this file.
import type { Category, Product, VendorProfile } from '../generated/prisma/client.js';
import type { Cart, CartItem, Order, Shipment, OrderItem, DispatchRiderProfile } from '../generated/prisma/client.js';

type VendorSummary = Pick<VendorProfile, 'id' | 'shopName' | 'shopAddress'>;

export interface ProductWithRelations extends Product {
  category: Category;
  vendor: VendorSummary;
}

export interface ProductResponse extends Omit<ProductWithRelations, 'price' | 'weightKg'> {
  price: number;
  weightKg: number;
}

export function toProductResponse(product: ProductWithRelations): ProductResponse {
  return {
    ...product,
    price: Number(product.price),
    weightKg: Number(product.weightKg),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Cart
// ─────────────────────────────────────────────────────────────────────────

type CartItemWithProduct = CartItem & { product: ProductWithRelations };

export interface CartItemResponse extends Omit<CartItemWithProduct, 'product'> {
  product: ProductResponse;
  lineTotal: number;
}

export interface CartResponse extends Omit<Cart, 'items'> {
  items: CartItemResponse[];
  itemCount: number;
  subtotal: number;
}

/**
 * Computes `lineTotal`/`subtotal` from the product's CURRENT price, on
 * every read — a cart deliberately has no snapshot of its own (see the
 * CartItem model's doc comment in schema.prisma), so "what does this cart
 * cost right now" is always derived here, never stored.
 */
export function toCartResponse(cart: Cart & { items: CartItemWithProduct[] }): CartResponse {
  const items = cart.items.map((item) => {
    const product = toProductResponse(item.product);
    return { ...item, product, lineTotal: product.price * item.quantity };
  });

  return {
    ...cart,
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: items.reduce((sum, item) => sum + item.lineTotal, 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Orders & shipments
// ─────────────────────────────────────────────────────────────────────────

export interface OrderItemResponse extends Omit<OrderItem, 'priceSnapshot' | 'weightKgSnapshot' | 'lineTotal'> {
  priceSnapshot: number;
  weightKgSnapshot: number;
  lineTotal: number;
}

function toOrderItemResponse(item: OrderItem): OrderItemResponse {
  return {
    ...item,
    priceSnapshot: Number(item.priceSnapshot),
    weightKgSnapshot: Number(item.weightKgSnapshot),
    lineTotal: Number(item.lineTotal),
  };
}

type ShipmentWithRelations = Shipment & {
  items: OrderItem[];
  dispatchRider?: DispatchRiderProfile | null;
  vendor?: VendorSummary;
};

export interface ShipmentResponse
  extends Omit<ShipmentWithRelations, 'distanceKm' | 'weightKg' | 'itemsTotal' | 'shippingFee' | 'items' | 'dispatchRider'> {
  distanceKm: number;
  weightKg: number;
  itemsTotal: number;
  shippingFee: number;
  items: OrderItemResponse[];
  dispatchRider: DispatchRiderSummary | null;
}

export type DispatchRiderSummary = Pick<DispatchRiderProfile, 'id' | 'vehicleType'> & {
  fullName: string;
  phone: string | null;
};

function toShipmentResponse(
  shipment: ShipmentWithRelations,
  riderSummary: DispatchRiderSummary | null,
): ShipmentResponse {
  const { dispatchRider: _dispatchRider, ...rest } = shipment;
  return {
    ...rest,
    distanceKm: Number(shipment.distanceKm),
    weightKg: Number(shipment.weightKg),
    itemsTotal: Number(shipment.itemsTotal),
    shippingFee: Number(shipment.shippingFee),
    items: shipment.items.map(toOrderItemResponse),
    dispatchRider: riderSummary,
  };
}

type OrderWithRelations = Order & { shipments: ShipmentWithRelations[] };

export interface OrderResponse
  extends Omit<OrderWithRelations, 'subtotal' | 'shippingTotal' | 'platformFeeTotal' | 'grandTotal' | 'shipments'> {
  subtotal: number;
  shippingTotal: number;
  platformFeeTotal: number;
  grandTotal: number;
  shipments: ShipmentResponse[];
}

/**
 * `riderSummaries` is a map keyed by shipmentId because rider identity
 * (name/phone) lives on User, not on DispatchRiderProfile — resolving it
 * requires an extra query the service layer already ran once for every
 * shipment in the order (see order.service.ts), so the serializer just
 * plugs the results in rather than querying again per shipment here.
 */
export function toOrderResponse(
  order: OrderWithRelations,
  riderSummaries: Map<string, DispatchRiderSummary> = new Map(),
): OrderResponse {
  return {
    ...order,
    subtotal: Number(order.subtotal),
    shippingTotal: Number(order.shippingTotal),
    platformFeeTotal: Number(order.platformFeeTotal),
    grandTotal: Number(order.grandTotal),
    shipments: order.shipments.map((shipment) => toShipmentResponse(shipment, riderSummaries.get(shipment.id) ?? null)),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Dispatch riders
// ─────────────────────────────────────────────────────────────────────────

export interface DispatchRiderResponse extends Omit<DispatchRiderProfile, 'walletBalance' | 'rating'> {
  walletBalance: number;
  rating: number;
}

export function toDispatchRiderResponse(rider: DispatchRiderProfile): DispatchRiderResponse {
  return { ...rider, walletBalance: Number(rider.walletBalance), rating: Number(rider.rating) };
}
