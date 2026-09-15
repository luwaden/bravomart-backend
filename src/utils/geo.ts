// Mirrors src/utils/distanceCalculator.js on the frontend (Haversine
// distance + the weight × distance × rate shipping formula already shown
// to buyers in DispatchConfigurator.jsx / AdminAiAssistant.jsx). Keeping
// both sides on the exact same formula matters here specifically: this
// file is what actually computes the `shippingFee` written to a Shipment
// row at checkout, and a buyer who was quoted one number by the frontend
// and charged a different one by the backend is a textbook "why don't my
// numbers match" support ticket — the two must never be allowed to drift
// apart into two different formulas maintained independently.

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance between two lat/lng points, in kilometers, rounded to 1 decimal place. */
export function calculateGpsDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(EARTH_RADIUS_KM * c * 10) / 10;
}

export const DEFAULT_RATE_PER_KG_PER_KM = 50;
const MINIMUM_SHIPPING_FEE_NGN = 500;

interface ShippingCostInput {
  weightKg: number;
  distanceKm: number;
  ratePerKgPerKm?: number;
}

/** weight × distance × rate, floored at a minimum charge — same formula the frontend previews before checkout. */
export function calculateShippingCost({
  weightKg,
  distanceKm,
  ratePerKgPerKm = DEFAULT_RATE_PER_KG_PER_KM,
}: ShippingCostInput): number {
  const raw = Math.max(1, weightKg) * Math.max(1, distanceKm) * ratePerKgPerKm;
  return Math.max(MINIMUM_SHIPPING_FEE_NGN, Math.round(raw));
}
