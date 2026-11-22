import { prisma } from '@/lib/prisma';
import { PaymentGateway } from '@prisma/client';

export type BillingGatewaySettings = {
  resellerMessage: string;
  bankDetails: string;
  stripeEnabled: boolean;
  bankEnabled: boolean;
  resellerEnabled: boolean;
};

export type StripeConfig = {
  publishableKey: string;
  secretKey: string;
  webhookSecret: string;
};

export const DEFAULT_BILLING_GATEWAYS: BillingGatewaySettings = {
  resellerMessage:
    'To purchase a plan via authorized reseller, contact us on Telegram: @GoogleFlowReseller or WhatsApp: +1 (555) 019-2834 with your account email.',
  bankDetails:
    'Bank Name: Silicon Valley Bank / JPMorgan Chase\nAccount Name: Google Flow Cloud Inc\nAccount Number: 84920491823\nRouting / SWIFT: 12100024\nPlease include your account email in the transfer remarks and upload your receipt screenshot below.',
  stripeEnabled: true,
  bankEnabled: true,
  resellerEnabled: true,
};

export const DEFAULT_STRIPE_CONFIG: StripeConfig = {
  publishableKey: '',
  secretKey: '',
  webhookSecret: '',
};

function asBool(v: unknown, fallback: boolean) {
  if (typeof v === 'boolean') return v;
  return fallback;
}

export async function getBillingGatewaySettings(): Promise<BillingGatewaySettings> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: 'BILLING_GATEWAYS' },
  });
  const raw = (setting?.value as Record<string, unknown>) || {};
  return {
    resellerMessage:
      typeof raw.resellerMessage === 'string'
        ? raw.resellerMessage
        : DEFAULT_BILLING_GATEWAYS.resellerMessage,
    bankDetails:
      typeof raw.bankDetails === 'string' ? raw.bankDetails : DEFAULT_BILLING_GATEWAYS.bankDetails,
    stripeEnabled: asBool(raw.stripeEnabled, true),
    bankEnabled: asBool(raw.bankEnabled, true),
    resellerEnabled: asBool(raw.resellerEnabled, true),
  };
}

export async function saveBillingGatewaySettings(
  input: Partial<BillingGatewaySettings>
): Promise<BillingGatewaySettings> {
  const current = await getBillingGatewaySettings();
  const next: BillingGatewaySettings = {
    resellerMessage: input.resellerMessage ?? current.resellerMessage,
    bankDetails: input.bankDetails ?? current.bankDetails,
    stripeEnabled: input.stripeEnabled ?? current.stripeEnabled,
    bankEnabled: input.bankEnabled ?? current.bankEnabled,
    resellerEnabled: input.resellerEnabled ?? current.resellerEnabled,
  };
  await prisma.systemSetting.upsert({
    where: { key: 'BILLING_GATEWAYS' },
    create: { key: 'BILLING_GATEWAYS', value: next },
    update: { value: next },
  });
  return next;
}

export async function getStripeConfig(): Promise<StripeConfig> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: 'STRIPE_CONFIG' },
  });
  const raw = (setting?.value as Record<string, unknown>) || {};
  return {
    publishableKey:
      typeof raw.publishableKey === 'string' ? raw.publishableKey : '',
    secretKey: typeof raw.secretKey === 'string' ? raw.secretKey : '',
    webhookSecret: typeof raw.webhookSecret === 'string' ? raw.webhookSecret : '',
  };
}

export async function saveStripeConfig(input: Partial<StripeConfig>): Promise<StripeConfig> {
  const current = await getStripeConfig();
  const next: StripeConfig = {
    publishableKey: input.publishableKey ?? current.publishableKey,
    secretKey: input.secretKey ?? current.secretKey,
    webhookSecret: input.webhookSecret ?? current.webhookSecret,
  };
  await prisma.systemSetting.upsert({
    where: { key: 'STRIPE_CONFIG' },
    create: { key: 'STRIPE_CONFIG', value: next },
    update: { value: next },
  });
  return next;
}

export function maskSecret(value: string) {
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

export function isGatewayEnabled(
  settings: BillingGatewaySettings,
  gateway: PaymentGateway | string
): boolean {
  if (gateway === PaymentGateway.STRIPE || gateway === 'STRIPE') return settings.stripeEnabled;
  if (gateway === PaymentGateway.RESELLER || gateway === 'RESELLER') return settings.resellerEnabled;
  return settings.bankEnabled;
}
