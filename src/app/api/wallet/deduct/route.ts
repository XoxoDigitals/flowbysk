import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getModelPricing, resolveModelPricing } from '@/lib/credits';
import { WalletType, LedgerType } from '@prisma/client';

export async function POST(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const body = await req.json();
    const { model, prompt, type } = body;

    const pricing =
      (await resolveModelPricing(model)) ||
      (type === 'video'
        ? await resolveModelPricing('veo_3_1_lite')
        : await resolveModelPricing('nano_banana_pro'))!;
    const walletType = pricing.walletType;
    const cost = pricing.price;

    // Use transaction to ensure atomic check-and-reserve
    const result = await prisma.$transaction(async (tx) => {
      // Find or create wallet
      let wallet = await tx.wallet.findUnique({
        where: { userId_walletType: { userId: session.userId, walletType } },
      });

      if (!wallet) {
        wallet = await tx.wallet.create({
          data: {
            userId: session.userId,
            walletType,
            balance: walletType === WalletType.STANDARD ? 30 : 20, // default initial
            reserved: 0,
          },
        });
      }

      const available = wallet.balance - wallet.reserved;
      if (available < cost) {
        throw new Error(
          `Insufficient ${walletType} credits: needed ${cost}, available ${available}. Please upgrade or top-up.`
        );
      }

      // Reserve credits
      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          reserved: { increment: cost },
        },
      });

      // Record in Credit Ledger
      const ledgerEntry = await tx.creditLedger.create({
        data: {
          userId: session.userId,
          walletType,
          amount: -cost,
          balanceAfter: updatedWallet.balance,
          type: LedgerType.RESERVE,
          reason: `Reserved ${cost} ${walletType} credits for ${pricing.displayName} (${prompt ? prompt.slice(0, 30) : ''})`,
        },
      });

      return {
        updatedWallet,
        ledgerEntry,
      };
    });

    return NextResponse.json({
      success: true,
      deducted: cost,
      walletType,
      transactionId: result.ledgerEntry.id,
      remainingBalance: result.updatedWallet.balance - result.updatedWallet.reserved,
      message: `Reserved ${cost} ${walletType} credits`,
    });
  } catch (err: any) {
    console.warn('Credit deduction error:', err.message);
    return NextResponse.json(
      {
        success: false,
        error: err.message || 'Credit deduction failed',
      },
      { status: 402 }
    );
  }
}
