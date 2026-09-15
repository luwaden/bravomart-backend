import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { listVendorTransactions } from './wallet.service.js';
import type { VendorProfile } from '../generated/prisma/client.js';

export async function updateOwnShopLocation(vendorProfileId: string, lat: number, lng: number): Promise<VendorProfile> {
  try {
    return await prisma.vendorProfile.update({
      where: { id: vendorProfileId },
      data: { shopLat: lat, shopLng: lng },
    });
  } catch {
    throw new AppError('Vendor profile not found.', 404);
  }
}

/** Backs a "wallet / payout history" view a vendor dashboard would show alongside its walletBalance figure. */
export async function getOwnWalletHistory(vendorProfileId: string, page: number, limit: number) {
  return listVendorTransactions(vendorProfileId, page, limit);
}
