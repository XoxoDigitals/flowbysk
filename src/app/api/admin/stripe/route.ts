import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import {
  getStripeConfig,
  maskSecret,
  saveStripeConfig,
} from '@/lib/billing-settings';

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const config = await getStripeConfig();
    return NextResponse.json({
      success: true,
      config: {
        publishableKey: config.publishableKey,
        secretKey: config.secretKey,
        webhookSecret: config.webhookSecret,
        secretKeyMasked: maskSecret(config.secretKey),
        webhookSecretMasked: maskSecret(config.webhookSecret),
        configured: Boolean(config.publishableKey && config.secretKey),
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Forbidden' },
      { status: error.message === 'FORBIDDEN' ? 403 : 500 }
    );
  }
}

export async function PUT(req: Request) {
  try {
    await requireAdmin(req);
    const body = await req.json();
    const current = await getStripeConfig();

    const next = await saveStripeConfig({
      publishableKey:
        typeof body.publishableKey === 'string' ? body.publishableKey.trim() : current.publishableKey,
      secretKey:
        typeof body.secretKey === 'string' && body.secretKey.trim() && !body.secretKey.includes('••••')
          ? body.secretKey.trim()
          : current.secretKey,
      webhookSecret:
        typeof body.webhookSecret === 'string' &&
        body.webhookSecret.trim() &&
        !body.webhookSecret.includes('••••')
          ? body.webhookSecret.trim()
          : current.webhookSecret,
    });

    return NextResponse.json({
      success: true,
      config: {
        publishableKey: next.publishableKey,
        secretKeyMasked: maskSecret(next.secretKey),
        webhookSecretMasked: maskSecret(next.webhookSecret),
        configured: Boolean(next.publishableKey && next.secretKey),
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 400 });
  }
}
