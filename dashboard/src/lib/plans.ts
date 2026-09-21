import type { Plan } from '@prisma/client';

/** Marketing STD credits — never read these display numbers from DB. */
export const HARDCODED_STD_CREDITS: Record<string, number> = {
  Free: 50,
  Starter: 5000,
  Pro: 25000,
  Business: 45000,
};

export function hardcodedStdForPlanName(name: string | null | undefined): number | null {
  const key = String(name || '').trim();
  if (Object.prototype.hasOwnProperty.call(HARDCODED_STD_CREDITS, key)) {
    return HARDCODED_STD_CREDITS[key];
  }
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(HARDCODED_STD_CREDITS)) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

export type PublicPlan = {
  id: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  contactSeller: boolean;
  maxParallel: number;
  standardCreditsCycle: number;
  proCreditsCycle: number;
  features: string[];
  isActive?: boolean;
};

/** Normalize Plan.features JSON + always include core capacity bullets. */
export function resolvePlanFeatures(plan: {
  features?: unknown;
  description?: string | null;
  maxParallel: number;
  standardCreditsCycle: number;
  proCreditsCycle: number;
}): string[] {
  const custom = Array.isArray(plan.features)
    ? plan.features.map((f) => String(f).trim()).filter(Boolean)
    : [];

  const core = [
    `${plan.maxParallel} parallel slot${plan.maxParallel === 1 ? '' : 's'}`,
    `${plan.standardCreditsCycle.toLocaleString()} standard credits / cycle`,
    `${plan.proCreditsCycle.toLocaleString()} pro credits / cycle`,
  ];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of [...custom, ...core]) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  if (plan.description?.trim() && !seen.has(plan.description.trim().toLowerCase())) {
    out.push(plan.description.trim());
  }
  return out;
}

export function toPublicPlan(plan: Plan): PublicPlan {
  const hard = hardcodedStdForPlanName(plan.name);
  const standardCreditsCycle = hard != null ? hard : plan.standardCreditsCycle;
  const withCredits = { ...plan, standardCreditsCycle };
  let description = plan.description;
  if (description && /google flow/i.test(description)) {
    description = description.replace(/Google Flow/gi, 'Flow Creator Ai');
  }
  return {
    id: plan.id,
    name: plan.name,
    description,
    priceMonthly: plan.priceMonthly,
    contactSeller: !!plan.contactSeller,
    maxParallel: plan.maxParallel,
    standardCreditsCycle,
    proCreditsCycle: plan.proCreditsCycle,
    features: resolvePlanFeatures(withCredits),
    isActive: plan.isActive,
  };
}

export function parseFeaturesInput(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((f) => String(f).trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw
      .split('\n')
      .map((l) => l.replace(/^[-•*]\s*/, '').trim())
      .filter(Boolean);
  }
  return [];
}
