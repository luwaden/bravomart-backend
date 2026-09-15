import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { calculateGpsDistanceKm } from '../utils/geo.js';
import { toDispatchRiderResponse, type DispatchRiderResponse } from '../utils/serializers.js';
import { recomputeOrderStatus, ESCROW_HOLD_DAYS } from './order.service.js';
import type { VehicleType } from '../generated/prisma/client.js';

/**
 * Typed as `Record<VehicleType, number>` (a finite, fully-covered mapped
 * type) rather than `Record<string, number>` specifically so this lookup
 * stays a plain `number` under `noUncheckedIndexedAccess` — a generic
 * string-indexed record would make every access `number | undefined` even
 * though every VehicleType enum member is listed here.
 */
const VEHICLE_WEIGHT_CAPACITY_KG: Record<VehicleType, number> = {
  MOTORCYCLE: 25,
  TRICYCLE: 150,
  CAR: 80,
  VAN: 800,
  TRUCK: 20000,
};

async function requireRiderProfile(riderProfileId: string) {
  const rider = await prisma.dispatchRiderProfile.findUnique({ where: { id: riderProfileId } });
  if (!rider) throw new AppError('Dispatcher profile not found.', 404);
  if (rider.status !== 'APPROVED') {
    throw new AppError('Your dispatcher account is still pending BravoMart admin verification.', 403);
  }
  return rider;
}

export async function setAvailability(riderProfileId: string, isAvailable: boolean): Promise<DispatchRiderResponse> {
  await requireRiderProfile(riderProfileId);
  const rider = await prisma.dispatchRiderProfile.update({ where: { id: riderProfileId }, data: { isAvailable } });
  return toDispatchRiderResponse(rider);
}

export async function updateLocation(riderProfileId: string, lat: number, lng: number): Promise<DispatchRiderResponse> {
  await requireRiderProfile(riderProfileId);
  const rider = await prisma.dispatchRiderProfile.update({
    where: { id: riderProfileId },
    data: { currentLat: lat, currentLng: lng },
  });
  return toDispatchRiderResponse(rider);
}

/**
 * Shipments a rider could pick up right now: unassigned, matching their
 * vehicle type, sorted nearest-pickup-first when we know where they are.
 * This is the "flip side" of DispatchConfigurator.jsx's current design
 * (which shows a buyer a list of riders to WhatsApp) — see
 * docs/CART_ORDERS_DISPATCH.md for the frontend follow-up needed to let
 * riders actually browse this list rather than being manually messaged.
 */
export async function listAvailableShipments(riderProfileId: string) {
  const rider = await requireRiderProfile(riderProfileId);

  const shipments = await prisma.shipment.findMany({
    where: { status: 'PENDING', dispatchRiderId: null },
    include: {
      vendor: { select: { id: true, shopName: true, shopAddress: true } },
      order: { select: { orderNumber: true, deliveryAddress: true, deliveryLat: true, deliveryLng: true } },
      items: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  // Vehicle matching is filtered in application code rather than the Prisma
  // `where` above because it depends on comparing the SHIPMENT's weight
  // against what the RIDER's vehicle type can carry, not a simple column
  // equality — see VEHICLE_WEIGHT_CAPACITY_KG below.
  const eligible = shipments.filter((s) => Number(s.weightKg) <= VEHICLE_WEIGHT_CAPACITY_KG[rider.vehicleType]);

  return eligible
    .map((shipment) => ({
      ...shipment,
      distanceKm: Number(shipment.distanceKm),
      weightKg: Number(shipment.weightKg),
      itemsTotal: Number(shipment.itemsTotal),
      shippingFee: Number(shipment.shippingFee),
      distanceFromRiderKm:
        rider.currentLat !== null && rider.currentLng !== null && shipment.pickupLat !== null && shipment.pickupLng !== null
          ? calculateGpsDistanceKm(rider.currentLat, rider.currentLng, shipment.pickupLat, shipment.pickupLng)
          : null,
    }))
    .sort((a, b) => (a.distanceFromRiderKm ?? Infinity) - (b.distanceFromRiderKm ?? Infinity));
}

export async function acceptShipment(riderProfileId: string, shipmentId: string) {
  await requireRiderProfile(riderProfileId);

  // Conditional update guards against two riders accepting the same
  // shipment in the same instant — only the request that still finds
  // status='PENDING' and no rider assigned actually wins the race.
  const result = await prisma.shipment.updateMany({
    where: { id: shipmentId, status: 'PENDING', dispatchRiderId: null },
    data: { dispatchRiderId: riderProfileId, status: 'RIDER_ASSIGNED', riderAssignedAt: new Date() },
  });

  if (result.count === 0) {
    throw new AppError('This shipment is no longer available — it may already have a rider assigned.', 409);
  }

  return prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
}

async function requireOwnedShipment(riderProfileId: string, shipmentId: string) {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) throw new AppError('Shipment not found.', 404);
  if (shipment.dispatchRiderId !== riderProfileId) {
    throw new AppError('This shipment is not assigned to you.', 403);
  }
  return shipment;
}

export async function markPickedUp(riderProfileId: string, shipmentId: string) {
  const shipment = await requireOwnedShipment(riderProfileId, shipmentId);
  if (shipment.status !== 'RIDER_ASSIGNED') {
    throw new AppError(`Cannot mark picked up from status "${shipment.status}".`, 409);
  }
  return prisma.shipment.update({
    where: { id: shipmentId },
    data: { status: 'OUT_FOR_DELIVERY', pickedUpAt: new Date() },
  });
}

/**
 * Rider-side "I dropped this off". Does NOT release escrow — that stays
 * gated on the buyer's explicit confirmation (or a future scheduled
 * auto-release job at `escrowReleaseAt`, documented but not built here) —
 * a rider's own word that they delivered something is not sufficient
 * evidence to pay the vendor out.
 */
export async function markDelivered(riderProfileId: string, shipmentId: string) {
  const shipment = await requireOwnedShipment(riderProfileId, shipmentId);
  if (shipment.status !== 'OUT_FOR_DELIVERY') {
    throw new AppError(`Cannot mark delivered from status "${shipment.status}".`, 409);
  }

  const escrowReleaseAt = new Date();
  escrowReleaseAt.setDate(escrowReleaseAt.getDate() + ESCROW_HOLD_DAYS);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.shipment.update({
      where: { id: shipmentId },
      data: { status: 'DELIVERED', deliveredAt: new Date(), escrowReleaseAt },
    });
    await recomputeOrderStatus(tx, shipment.orderId);
    return updated;
  });
}
