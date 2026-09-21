import { prisma } from '@/lib/prisma';
import { LedgerType, WalletType } from '@prisma/client';

export const MODEL_CREDIT_PRICES_KEY = 'model_credit_prices';

/** Ensure inactive Custom plan exists for admin deals (never on public pricing). */
export async function ensureCustomPlan() {
  return prisma.plan.upsert({
    where: { name: 'Custom' },
    create: {
      name: 'Custom',
      description: 'Admin-assigned custom deal (not sold publicly)',
      priceMonthly: 0,
      maxParallel: 1,
      standardCreditsCycle: 0,
      proCreditsCycle: 0,
      contactSeller: false,
      isActive: false,
      features: [],
    },
    update: { isActive: false },
  });
}

/** If ACTIVE sub past period end, cancel it and attach Free. */
export async function downgradeExpiredSubscription(userId: string) {
  const sub = await prisma.subscription.findFirst({
    where: { userId, status: 'ACTIVE' },
    include: { plan: true },
  });
  if (!sub) return null;
  if (sub.currentPeriodEnd.getTime() >= Date.now()) return sub;

  await prisma.subscription.update({
    where: { id: sub.id },
    data: { status: 'CANCELLED' },
  });

  const free = await prisma.plan.findUnique({ where: { name: 'Free' } });
  if (!free) return null;

  return prisma.subscription.create({
    data: {
      userId,
      planId: free.id,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      isCustomDeal: false,
      displayPrice: null,
      maxParallelOverride: null,
      periodDays: null,
    },
    include: { plan: true },
  });
}

export function resolveEffectiveParallel(sub: {
  maxParallelOverride?: number | null;
  plan?: { maxParallel: number } | null;
} | null): number {
  if (!sub) return 1;
  if (sub.maxParallelOverride != null && sub.maxParallelOverride > 0) {
    return sub.maxParallelOverride;
  }
  return sub.plan?.maxParallel || 1;
}

export async function grantDealCredits(
  userId: string,
  standardCredits: number,
  proCredits: number,
  reason: string,
  adminId?: string
) {
  const std = Math.max(0, Math.floor(Number(standardCredits) || 0));
  const pro = Math.max(0, Math.floor(Number(proCredits) || 0));

  if (std > 0) {
    const wallet = await prisma.wallet.upsert({
      where: { userId_walletType: { userId, walletType: WalletType.STANDARD } },
      update: { balance: { increment: std } },
      create: { userId, walletType: WalletType.STANDARD, balance: std, reserved: 0 },
    });
    await prisma.creditLedger.create({
      data: {
        userId,
        walletType: WalletType.STANDARD,
        amount: std,
        balanceAfter: wallet.balance,
        type: LedgerType.GRANT,
        adminId: adminId || null,
        reason,
      },
    });
  } else {
    await prisma.wallet.upsert({
      where: { userId_walletType: { userId, walletType: WalletType.STANDARD } },
      update: {},
      create: { userId, walletType: WalletType.STANDARD, balance: 0, reserved: 0 },
    });
  }

  if (pro > 0) {
    const wallet = await prisma.wallet.upsert({
      where: { userId_walletType: { userId, walletType: WalletType.PRO } },
      update: { balance: { increment: pro } },
      create: { userId, walletType: WalletType.PRO, balance: pro, reserved: 0 },
    });
    await prisma.creditLedger.create({
      data: {
        userId,
        walletType: WalletType.PRO,
        amount: pro,
        balanceAfter: wallet.balance,
        type: LedgerType.GRANT,
        adminId: adminId || null,
        reason,
      },
    });
  } else {
    await prisma.wallet.upsert({
      where: { userId_walletType: { userId, walletType: WalletType.PRO } },
      update: {},
      create: { userId, walletType: WalletType.PRO, balance: 0, reserved: 0 },
    });
  }
}

export type CustomDealInput = {
  days: number;
  standardCredits: number;
  proCredits: number;
  maxParallel: number;
  displayPrice: number;
  reason?: string;
};

/** Cancel active subs and create a Custom deal period. */
export async function applyCustomDeal(
  userId: string,
  deal: CustomDealInput,
  adminId?: string
) {
  const days = Math.max(1, Math.floor(Number(deal.days) || 1));
  const maxParallel = Math.max(1, Math.floor(Number(deal.maxParallel) || 1));
  const displayPrice = Math.max(0, Number(deal.displayPrice) || 0);
  const customPlan = await ensureCustomPlan();

  await prisma.subscription.updateMany({
    where: { userId, status: 'ACTIVE' },
    data: { status: 'CANCELLED' },
  });

  const start = new Date();
  const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);

  const sub = await prisma.subscription.create({
    data: {
      userId,
      planId: customPlan.id,
      currentPeriodStart: start,
      currentPeriodEnd: end,
      isCustomDeal: true,
      displayPrice,
      maxParallelOverride: maxParallel,
      periodDays: days,
    },
    include: { plan: true },
  });

  const reason =
    deal.reason?.trim() ||
    `Custom deal: ${days}d · $${displayPrice} · ${maxParallel} parallel`;

  await grantDealCredits(userId, deal.standardCredits, deal.proCredits, reason, adminId);

  if (adminId) {
    await prisma.adminAuditLog.create({
      data: {
        adminId,
        action: 'CUSTOM_DEAL',
        targetType: 'USER',
        targetId: userId,
        details: {
          days,
          standardCredits: deal.standardCredits,
          proCredits: deal.proCredits,
          maxParallel,
          displayPrice,
          reason: deal.reason || null,
        },
      },
    });
  }

  return sub;
}
