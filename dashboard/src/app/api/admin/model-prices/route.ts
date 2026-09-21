import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { listEditableModelPrices, saveModelCreditPriceOverrides } from '@/lib/credits';

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const models = await listEditableModelPrices();
    return NextResponse.json({ success: true, models });
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
    const prices: Record<string, number> = {};
    if (Array.isArray(body.models)) {
      for (const row of body.models) {
        if (row?.modelKey != null) prices[String(row.modelKey)] = Number(row.price);
      }
    } else if (body.prices && typeof body.prices === 'object') {
      Object.assign(prices, body.prices);
    } else {
      return NextResponse.json({ error: 'models or prices required' }, { status: 400 });
    }
    const saved = await saveModelCreditPriceOverrides(prices);
    const models = await listEditableModelPrices();
    return NextResponse.json({ success: true, prices: saved, models });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 400 });
  }
}
