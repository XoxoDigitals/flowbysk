import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { parseFeaturesInput } from '@/lib/plans';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(req);
    const { id } = await params;
    const body = await req.json();
    const data: any = {};

    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim();
    if (typeof body.description === 'string') data.description = body.description;
    if (body.description === null) data.description = null;
    if (body.priceMonthly !== undefined) data.priceMonthly = Number(body.priceMonthly) || 0;
    if (body.maxParallel !== undefined) data.maxParallel = Math.max(1, Number(body.maxParallel) || 1);
    if (body.standardCreditsCycle !== undefined) {
      data.standardCreditsCycle = Math.max(0, Number(body.standardCreditsCycle) || 0);
    }
    if (body.proCreditsCycle !== undefined) {
      data.proCreditsCycle = Math.max(0, Number(body.proCreditsCycle) || 0);
    }
    if (typeof body.isActive === 'boolean') data.isActive = body.isActive;
    if (typeof body.contactSeller === 'boolean') data.contactSeller = body.contactSeller;
    if (body.features !== undefined || body.featuresText !== undefined) {
      data.features = parseFeaturesInput(body.features ?? body.featuresText);
    }

    const plan = await prisma.plan.update({ where: { id }, data });
    return NextResponse.json({ success: true, plan });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 400 });
  }
}
