import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import {
  getBillingGatewaySettings,
  saveBillingGatewaySettings,
} from '@/lib/billing-settings';

export async function GET(req: Request) {
  try {
    // Allow authenticated users to read messages; admin for full. Public messages needed on billing.
    const settings = await getBillingGatewaySettings();
    return NextResponse.json({ success: true, settings });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const body = await req.json();
    const settings = await saveBillingGatewaySettings({
      resellerMessage: body.resellerMessage,
      bankDetails: body.bankDetails,
      stripeEnabled: body.stripeEnabled,
      bankEnabled: body.bankEnabled,
      resellerEnabled: body.resellerEnabled,
    });
    return NextResponse.json({ success: true, settings });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Operation failed' },
      { status: 400 }
    );
  }
}

export async function PUT(req: Request) {
  return POST(req);
}
