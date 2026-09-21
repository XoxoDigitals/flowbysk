import { NextResponse } from 'next/server';
import {
  getBillingGatewaySettings,
  getStripeConfig,
} from '@/lib/billing-settings';

/** Public billing config for checkout — no Stripe secrets. */
export async function GET() {
  try {
    const gateways = await getBillingGatewaySettings();
    const stripe = await getStripeConfig();
    return NextResponse.json({
      success: true,
      gateways: {
        stripeEnabled: gateways.stripeEnabled,
        bankEnabled: gateways.bankEnabled,
        resellerEnabled: gateways.resellerEnabled,
        resellerMessage: gateways.resellerMessage,
        bankDetails: gateways.bankDetails,
      },
      stripe: {
        publishableKey: gateways.stripeEnabled ? stripe.publishableKey : '',
        configured: Boolean(stripe.publishableKey && stripe.secretKey),
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 });
  }
}
