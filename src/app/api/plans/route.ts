import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { toPublicPlan } from '@/lib/plans';

export async function GET() {
  try {
    const plans = await prisma.plan.findMany({
      where: { isActive: true, NOT: { name: 'Custom' } },
      orderBy: { priceMonthly: 'asc' },
    });
    return NextResponse.json({
      success: true,
      plans: plans.map(toPublicPlan),
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch plans' }, { status: 500 });
  }
}
