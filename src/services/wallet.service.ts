import { prisma } from '../config/prisma.js';
import type { Prisma, WalletTransactionType } from '../generated/prisma/client.js';

/**
 * The ONLY function in the codebase allowed to change VendorProfile.walletBalance.
 * Every call site (escrow release, refund, platform fee, a future manual
 * admin adjustment) goes through here so the balance and its audit trail
 * can never drift apart — see the WalletTransaction model's doc comment in
 * schema.prisma for why both exist.
 *
 * Must be called with a transactional Prisma client (the `tx` parameter of
 * `prisma.$transaction(async (tx) => ...)`), never the bare `prisma`
 * import, so the balance update and the ledger row are always committed —
 * or rolled back — together.
 */
export async function recordWalletTransaction(
  tx: Prisma.TransactionClient,
  params: {
    vendorId: string;
    shipmentId?: string;
    type: WalletTransactionType;
    amount: number; // positive = credit, negative = debit
    description: string;
  },
) {
  const vendor = await tx.vendorProfile.update({
    where: { id: params.vendorId },
    data: { walletBalance: { increment: params.amount } },
  });

  return tx.walletTransaction.create({
    data: {
      vendorId: params.vendorId,
      shipmentId: params.shipmentId,
      type: params.type,
      amount: params.amount,
      balanceAfter: vendor.walletBalance,
      description: params.description,
    },
  });
}

export async function listVendorTransactions(vendorId: string, page: number, limit: number) {
  const [items, total] = await prisma.$transaction([
    prisma.walletTransaction.findMany({
      where: { vendorId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.walletTransaction.count({ where: { vendorId } }),
  ]);

  return { items, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
