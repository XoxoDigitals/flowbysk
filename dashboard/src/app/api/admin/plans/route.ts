import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { parseFeaturesInput } from '@/lib/plans';

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const plans = await prisma.plan.findMany({
      orderBy: { priceMonthly: 'asc' },
    });
    return NextResponse.json({ success: true, plans });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Forbidden' },
      { status: error.message === 'FORBIDDEN' ? 403 : 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const body = await req.json();
    const name = String(body.name || '').trim();
    if (!name) {
      return NextResponse.json({ error: 'Plan name is required' }, { status: 400 });
    }

    const features = parseFeaturesInput(body.features ?? body.featuresText);

    const plan = await prisma.plan.create({
      data: {
        name,
        description: body.description ? String(body.description) : null,
        priceMonthly: Number(body.priceMonthly) || 0,
        maxParallel: Math.max(1, Number(body.maxParallel) || 1),
        standardCreditsCycle: Math.max(0, Number(body.standardCreditsCycle) || 0),
        proCreditsCycle: Math.max(0, Number(body.proCreditsCycle) || 0),
        features,
        isActive: body.isActive !== false,
        contactSeller: body.contactSeller === true,
      },
    });
    return NextResponse.json({ success: true, plan });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 400 });
  }
}
