import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { WalletType, LedgerType } from '@prisma/client';

export async function POST(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const body = await req.json();
    const { transactionId, reason } = body;

    if (!transactionId) {
      return NextResponse.json({ error: 'Transaction ID is required' }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Find original reserve entry
      const originalEntry = await tx.creditLedger.findFirst({
        where: {
          id: transactionId,
          userId: session.userId,
          type: LedgerType.RESERVE,
        },
      });

      if (!originalEntry) {
        return { refunded: 0, message: 'Transaction not found or already settled/released' };
      }

      const amountToRelease = Math.abs(originalEntry.amount);

      // Decrement reserved amount on wallet
      const wallet = await tx.wallet.findUnique({
        where: { userId_walletType: { userId: session.userId, walletType: originalEntry.walletType } },
      });

      if (!wallet) return { refunded: 0 };

      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          reserved: { decrement: Math.min(wallet.reserved, amountToRelease) },
        },
      });

      // Record release in ledger
      await tx.creditLedger.create({
        data: {
          userId: session.userId,
          walletType: originalEntry.walletType,
          amount: amountToRelease,
          balanceAfter: updatedWallet.balance,
          type: LedgerType.RELEASE,
          reason: `Refunded ${amountToRelease} ${originalEntry.walletType} credits (${reason || 'Generation failed'})`,
        },
      });

      return {
        refunded: amountToRelease,
        walletType: originalEntry.walletType,
        balance: updatedWallet.balance - updatedWallet.reserved,
      };
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err: any) {
    console.error('Credit refund error:', err);
    return NextResponse.json({ error: err.message || 'Refund failed' }, { status: 500 });
  }
}
