import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { claimUserForAdmin, isSuperAdmin } from '@/lib/adminScope';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin(req);
    const { id } = await params;
    const body = await req.json();
    const { planName, reason } = body;

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, email: true },
    });
    if (!target) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Only SUPER_ADMIN may change plans for ADMIN / RESELLER / other staff-owned users
    if (!isSuperAdmin(admin.role)) {
      if (target.role !== 'CUSTOMER') {
        return NextResponse.json(
          { error: 'Only Super Admin can change plans for admin or reseller accounts' },
          { status: 403 }
        );
      }
      try {
        await claimUserForAdmin(id, admin.userId);
      } catch (e: any) {
        if (e.message === 'USER_OWNED_BY_OTHER_ADMIN') {
          return NextResponse.json(
            { error: 'This user belongs to another admin' },
            { status: 403 }
          );
        }
        throw e;
      }
    } else if (target.role === 'SUPER_ADMIN' && target.id !== admin.userId) {
      return NextResponse.json(
        { error: 'Cannot change another Super Admin plan from this screen' },
        { status: 403 }
      );
    }

    const plan = await prisma.plan.findUnique({
      where: { name: planName },
    });

    if (!plan) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    }

    await prisma.subscription.updateMany({
      where: { userId: id, status: 'ACTIVE' },
      data: { status: 'CANCELLED' },
    });

    const newSub = await prisma.subscription.create({
      data: {
        userId: id,
        planId: plan.id,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        periodDays: 30,
        displayPrice: plan.priceMonthly,
      },
      include: { plan: true },
    });

    await prisma.adminAuditLog.create({
      data: {
        adminId: admin.userId,
        action: 'PLAN_CHANGE',
        targetType: 'USER',
        targetId: id,
        details: { planName, reason, targetRole: target.role },
      },
    });

    return NextResponse.json({
      success: true,
      message: `User plan upgraded to ${plan.name} (${plan.maxParallel} parallel generations)`,
      subscription: newSub,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Operation failed' },
      { status: 400 }
    );
  }
}
