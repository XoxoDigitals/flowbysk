import type { Plan } from '@prisma/client';

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
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    priceMonthly: plan.priceMonthly,
    contactSeller: !!plan.contactSeller,
    maxParallel: plan.maxParallel,
    standardCreditsCycle: plan.standardCreditsCycle,
    proCreditsCycle: plan.proCreditsCycle,
    features: resolvePlanFeatures(plan),
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
