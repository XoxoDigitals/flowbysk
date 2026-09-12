import { prisma } from './prisma';
import { WalletType, LedgerType } from '@prisma/client';

export interface ModelPricing {
  modelKey: string;
  displayName: string;
  mediaType: 'VIDEO' | 'IMAGE';
  walletType: WalletType;
  price: number;
  description: string;
  wireModel: string;
}

export const MODEL_CATALOG: Record<string, ModelPricing> = {
  // Standard credits — frontend Lite charges Standard; wire remapped to low-priority in worker
  veo_3_1_lite: {
    modelKey: 'veo_3_1_lite',
    displayName: 'Veo 3.1 - Lite',
    mediaType: 'VIDEO',
    walletType: WalletType.STANDARD,
    price: 15,
    description: 'Veo 3.1 Lite (Standard credits). Flow runs low-priority Lite under the hood.',
    wireModel: 'veo_3_1_t2v_lite_low_priority',
  },
  // Legacy key — same pricing as frontend Lite (LP removed from UI)
  veo_3_1_lite_low_priority: {
    modelKey: 'veo_3_1_lite_low_priority',
    displayName: 'Veo 3.1 - Lite',
    mediaType: 'VIDEO',
    walletType: WalletType.STANDARD,
    price: 15,
    description: 'Legacy Low Priority key; charged and labeled as Veo 3.1 Lite.',
    wireModel: 'veo_3_1_t2v_lite_low_priority',
  },
  nano_banana_2: {
    modelKey: 'nano_banana_2',
    displayName: 'Nano Banana 2',
    mediaType: 'IMAGE',
    walletType: WalletType.STANDARD,
    price: 3,
    description: 'Standard image tier (frontend). Flow wire remapped to Lite.',
    wireModel: 'HARBOR_SEAL',
  },
  nano_banana_lite: {
    modelKey: 'nano_banana_lite',
    displayName: 'Nano Banana 2 Lite',
    mediaType: 'IMAGE',
    walletType: WalletType.STANDARD,
    price: 2,
    description: 'Lite image tier (frontend). Flow wire remapped to Pro.',
    wireModel: 'GEM_PIX_2',
  },
  nano_banana_pro: {
    modelKey: 'nano_banana_pro',
    displayName: 'Nano Banana 2 Pro',
    mediaType: 'IMAGE',
    walletType: WalletType.STANDARD,
    price: 5,
    description: 'Default image tier (frontend). Flow wire remapped to Nano Banana 2.',
    wireModel: 'NARWHAL',
  },

  // Pro credits models
  omni_flash: {
    modelKey: 'omni_flash',
    displayName: 'Omni 1.1 Flash',
    mediaType: 'VIDEO',
    walletType: WalletType.PRO,
    price: 20,
    description: 'Omni-modal multi-reference video generation with rapid turnaround.',
    wireModel: 'OMNI_1_1_FLASH',
  },
  veo_3_1_fast: {
    modelKey: 'veo_3_1_fast',
    displayName: 'Veo 3.1 - Fast',
    mediaType: 'VIDEO',
    walletType: WalletType.PRO,
    price: 40,
    description: 'Veo 3.1 Fast (Pro credits). Flow runs Lite under the hood.',
    wireModel: 'veo_3_1_t2v_lite',
  },
  veo_3_1_quality: {
    modelKey: 'veo_3_1_quality',
    displayName: 'Veo 3.1 - Quality',
    mediaType: 'VIDEO',
    walletType: WalletType.PRO,
    price: 150,
    description: 'Veo 3.1 Quality (Pro credits). Flow runs Fast under the hood.',
    wireModel: 'veo_3_1_t2v_fast',
  },
};

const MODEL_ALIASES: Record<string, string> = {
  'OMNI_1_1_FLASH': 'omni_flash',
  'VEO_3_1_LITE': 'veo_3_1_lite',
  'VEO_3_1_FAST': 'veo_3_1_fast',
  'VEO_3_1_QUALITY': 'veo_3_1_quality',
  'VEO_3_1_LITE_LOW_PRIORITY': 'veo_3_1_lite',
  'NARWHAL': 'nano_banana_2',
  'HARBOR_SEAL': 'nano_banana_lite',
  'GEM_PIX_2': 'nano_banana_pro',
  'VEO_3_1_EXTEND_LITE': 'veo_3_1_extend_lite',
  'VEO_3_1_R2V_LITE': 'veo_3_1_r2v_lite',
};

export function getModelPricing(modelKey: string): ModelPricing | null {
  if (!modelKey) return null;
  const direct = MODEL_CATALOG[modelKey];
  if (direct) return applyCachedPriceOverride(direct);

  const keyUpper = modelKey.toUpperCase();
  if (MODEL_ALIASES[keyUpper] && MODEL_CATALOG[MODEL_ALIASES[keyUpper]]) {
    return applyCachedPriceOverride(MODEL_CATALOG[MODEL_ALIASES[keyUpper]]);
  }

  const keyLower = modelKey.toLowerCase();
  if (MODEL_CATALOG[keyLower]) {
    return applyCachedPriceOverride(MODEL_CATALOG[keyLower]);
  }

  // Fallback search across catalog by wireModel or display name
  for (const item of Object.values(MODEL_CATALOG)) {
    if (item.wireModel.toUpperCase() === keyUpper || item.displayName.toUpperCase().includes(keyUpper)) {
      return applyCachedPriceOverride(item);
    }
  }

  return null;
}

const MODEL_CREDIT_PRICES_KEY = 'model_credit_prices';
let priceOverrideCache: Record<string, number> = {};
let priceOverrideLoadedAt = 0;

function applyCachedPriceOverride(item: ModelPricing): ModelPricing {
  const ov = priceOverrideCache[item.modelKey];
  if (typeof ov === 'number' && ov >= 0) {
    return { ...item, price: Math.floor(ov) };
  }
  return item;
}

export async function loadModelCreditPriceOverrides(force = false): Promise<Record<string, number>> {
  if (!force && Date.now() - priceOverrideLoadedAt < 15_000 && priceOverrideLoadedAt > 0) {
    return priceOverrideCache;
  }
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: MODEL_CREDIT_PRICES_KEY } });
    const raw = (row?.value || {}) as Record<string, unknown>;
    const next: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) next[k] = Math.floor(n);
    }
    priceOverrideCache = next;
    priceOverrideLoadedAt = Date.now();
  } catch {
    // keep prior cache
  }
  return priceOverrideCache;
}

export async function saveModelCreditPriceOverrides(prices: Record<string, number>) {
  const cleaned: Record<string, number> = {};
  for (const [k, v] of Object.entries(prices)) {
    if (!(k in MODEL_CATALOG)) continue;
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n < 0) continue;
    cleaned[k] = n;
  }
  await prisma.systemSetting.upsert({
    where: { key: MODEL_CREDIT_PRICES_KEY },
    create: { key: MODEL_CREDIT_PRICES_KEY, value: cleaned },
    update: { value: cleaned },
  });
  priceOverrideCache = cleaned;
  priceOverrideLoadedAt = Date.now();
  return cleaned;
}

/** Catalog models (skip legacy aliases) with effective prices for admin UI. */
export async function listEditableModelPrices() {
  await loadModelCreditPriceOverrides();
  const skip = new Set(['veo_3_1_lite_low_priority']);
  return Object.values(MODEL_CATALOG)
    .filter((m) => !skip.has(m.modelKey))
    .map((m) => {
      const effective = applyCachedPriceOverride(m);
      return {
        modelKey: m.modelKey,
        displayName: m.displayName,
        mediaType: m.mediaType,
        walletType: m.walletType,
        defaultPrice: m.price,
        price: effective.price,
      };
    });
}

/** Prefer this in async charge paths so DB overrides are fresh. */
export async function resolveModelPricing(modelKey: string): Promise<ModelPricing | null> {
  await loadModelCreditPriceOverrides();
  return getModelPricing(modelKey);
}

/** Grant credits from a $0 plan's configured cycle amounts (once per user). */
export async function grantZeroPricePlanCredits(
  userId: string,
  plan: {
    name: string;
    priceMonthly: number;
    standardCreditsCycle: number;
    proCreditsCycle: number;
  }
) {
  if (Number(plan.priceMonthly) > 0) {
    return { granted: false, reason: 'Paid plan — credits come from billing' };
  }

  const standardAmount = Math.max(0, Math.floor(Number(plan.standardCreditsCycle) || 0));
  const proAmount = Math.max(0, Math.floor(Number(plan.proCreditsCycle) || 0));

  return prisma.$transaction(async (tx) => {
    const existing = await tx.welcomeGrant.findUnique({ where: { userId } });
    if (existing) {
      return { granted: false, reason: 'Already granted' };
    }

    await tx.welcomeGrant.create({
      data: { userId, standardAmount, proAmount },
    });

    if (standardAmount > 0) {
      const standardWallet = await tx.wallet.upsert({
        where: { userId_walletType: { userId, walletType: WalletType.STANDARD } },
        update: { balance: { increment: standardAmount } },
        create: {
          userId,
          walletType: WalletType.STANDARD,
          balance: standardAmount,
          reserved: 0,
        },
      });
      await tx.creditLedger.create({
        data: {
          userId,
          walletType: WalletType.STANDARD,
          amount: standardAmount,
          balanceAfter: standardWallet.balance,
          type: LedgerType.GRANT,
          reason: `${plan.name} plan credits (Standard)`,
        },
      });
    }

    if (proAmount > 0) {
      const proWallet = await tx.wallet.upsert({
        where: { userId_walletType: { userId, walletType: WalletType.PRO } },
        update: { balance: { increment: proAmount } },
        create: {
          userId,
          walletType: WalletType.PRO,
          balance: proAmount,
          reserved: 0,
        },
      });
      await tx.creditLedger.create({
        data: {
          userId,
          walletType: WalletType.PRO,
          amount: proAmount,
          balanceAfter: proWallet.balance,
          type: LedgerType.GRANT,
          reason: `${plan.name} plan credits (Pro)`,
        },
      });
    }

    return { granted: true, standard: standardAmount, pro: proAmount };
  });
}

/** @deprecated Use grantZeroPricePlanCredits — hardcoded welcome grant removed. */
export async function grantWelcomeCredits(userId: string) {
  const freePlan = await prisma.plan.findUnique({ where: { name: 'Free' } });
  if (!freePlan) {
    return { granted: false, reason: 'No Free plan' };
  }
  return grantZeroPricePlanCredits(userId, freePlan);
}

export async function getUserWallets(userId: string) {
  const wallets = await prisma.wallet.findMany({
    where: { userId },
  });

  const standard = wallets.find((w) => w.walletType === WalletType.STANDARD) || {
    balance: 0,
    reserved: 0,
  };
  const pro = wallets.find((w) => w.walletType === WalletType.PRO) || {
    balance: 0,
    reserved: 0,
  };

  return {
    standard: {
      available: Math.max(0, standard.balance - standard.reserved),
      total: standard.balance,
      reserved: standard.reserved,
    },
    pro: {
      available: Math.max(0, pro.balance - pro.reserved),
      total: pro.balance,
      reserved: pro.reserved,
    },
  };
}

export async function reserveCredits(userId: string, modelKey: string, jobId: string) {
  const pricing = await resolveModelPricing(modelKey);
  if (!pricing) {
    throw new Error(`Invalid model key: ${modelKey}`);
  }

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({
      where: { userId_walletType: { userId, walletType: pricing.walletType } },
    });

    if (!wallet) {
      throw new Error(`Insufficient ${pricing.walletType} credits: wallet not found`);
    }

    const available = wallet.balance - wallet.reserved;
    if (available < pricing.price) {
      throw new Error(
        `Insufficient ${pricing.walletType} credits: needed ${pricing.price}, available ${available}`
      );
    }

    // Atomically increment reserved count
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { reserved: { increment: pricing.price } },
    });

    await tx.creditLedger.create({
      data: {
        userId,
        walletType: pricing.walletType,
        amount: -pricing.price,
        balanceAfter: wallet.balance,
        type: LedgerType.RESERVE,
        jobId,
        reason: `Reserved ${pricing.price} ${pricing.walletType} credits for job ${jobId}`,
      },
    });

    return {
      walletType: pricing.walletType,
      cost: pricing.price,
    };
  });
}

export async function settleCredits(
  userId: string,
  walletType: WalletType,
  amount: number,
  jobId: string
) {
  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({
      where: { userId_walletType: { userId, walletType } },
    });
    if (!wallet) return;

    // Decrease both balance and reserved
    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: { decrement: amount },
        reserved: { decrement: amount },
      },
    });

    await tx.creditLedger.create({
      data: {
        userId,
        walletType,
        amount: -amount,
        balanceAfter: updated.balance,
        type: LedgerType.SETTLE,
        jobId,
        reason: `Settled ${amount} ${walletType} credits for successful generation ${jobId}`,
      },
    });
  });
}

export async function releaseCredits(
  userId: string,
  walletType: WalletType,
  amount: number,
  jobId: string,
  reason = 'Job cancelled or failed'
) {
  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({
      where: { userId_walletType: { userId, walletType } },
    });
    if (!wallet) return;

    // Release reservation back into available balance
    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        reserved: { decrement: amount },
      },
    });

    await tx.creditLedger.create({
      data: {
        userId,
        walletType,
        amount: 0,
        balanceAfter: wallet.balance,
        type: LedgerType.RELEASE,
        jobId,
        reason: `Released ${amount} reserved ${walletType} credits for ${jobId} (${reason})`,
      },
    });
  });
}

export async function adminAdjustCredits(
  adminId: string,
  targetUserId: string,
  walletType: WalletType,
  delta: number,
  reason: string
) {
  if (!reason || reason.trim().length === 0) {
    throw new Error('Admin reason is strictly required for credit adjustments');
  }

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.upsert({
      where: { userId_walletType: { userId: targetUserId, walletType } },
      update: { balance: { increment: delta } },
      create: { userId: targetUserId, walletType, balance: Math.max(0, delta), reserved: 0 },
    });

    if (wallet.balance < wallet.reserved) {
      throw new Error(
        `Cannot reduce credits below currently reserved amount (${wallet.reserved})`
      );
    }

    await tx.creditLedger.create({
      data: {
        userId: targetUserId,
        walletType,
        amount: delta,
        balanceAfter: wallet.balance,
        type: LedgerType.ADMIN_ADJUSTMENT,
        adminId,
        reason: `Admin adjustment: ${reason}`,
      },
    });

    await tx.adminAuditLog.create({
      data: {
        adminId,
        action: 'CREDIT_ADJUSTMENT',
        targetType: 'USER',
        targetId: targetUserId,
        details: { walletType, delta, reason, newBalance: wallet.balance },
      },
    });

    return wallet;
  });
}
