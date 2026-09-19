import { NextResponse } from 'next/server';
import { hashPassword, requireReseller } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { AcquiredVia, UserRole, UserStatus } from '@prisma/client';
import { calendarMonthKey, sameCalendarDay } from '@/lib/adminScope';

async function getProfile(userId: string) {
  return prisma.resellerProfile.findUnique({
    where: { userId },
    include: {
      seatGrants: {
        where: { monthKey: calendarMonthKey() },
        include: { plan: true },
      },
    },
  });
}

export async function GET(req: Request) {
  try {
    const session = await requireReseller(req);
    const profile = await getProfile(session.userId);
    if (!profile || !profile.isActive) {
      return NextResponse.json({ error: 'Reseller profile inactive' }, { status: 403 });
    }

    const assignments = await prisma.resellerUserAssignment.findMany({
      where: { resellerProfileId: profile.id, removedAt: null },
      include: {
        customer: { select: { id: true, email: true, name: true, status: true } },
        plan: { select: { id: true, name: true } },
      },
      orderBy: { addedAt: 'desc' },
    });

    return NextResponse.json({
      success: true,
      monthKey: calendarMonthKey(),
      seats: profile.seatGrants.map((g) => ({
        planId: g.planId,
        planName: g.plan.name,
        allocated: g.seatsAllocated,
        used: g.seatsUsed,
        remaining: Math.max(0, g.seatsAllocated - g.seatsUsed),
        wholesalePrice: g.wholesalePrice,
      })),
      users: assignments.map((a) => ({
        assignmentId: a.id,
        id: a.customer.id,
        email: a.customer.email,
        name: a.customer.name,
        status: a.customer.status,
        planId: a.plan.id,
        planName: a.plan.name,
        displayPrice: a.displayPrice,
        addedAt: a.addedAt,
      })),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Forbidden' },
      { status: error.message === 'FORBIDDEN' ? 403 : 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await requireReseller(req);
    const profile = await getProfile(session.userId);
    if (!profile || !profile.isActive) {
      return NextResponse.json({ error: 'Reseller profile inactive' }, { status: 403 });
    }

    const body = await req.json();
    const action = String(body.action || '');
    const assignmentId = String(body.assignmentId || '');
    if (!assignmentId) {
      return NextResponse.json({ error: 'assignmentId required' }, { status: 400 });
    }

    const assignment = await prisma.resellerUserAssignment.findFirst({
      where: { id: assignmentId, resellerProfileId: profile.id, removedAt: null },
      include: { plan: true },
    });
    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    if (action === 'password') {
      const password = String(body.password || '');
      if (password.length < 6) {
        return NextResponse.json({ error: 'Password min 6 chars' }, { status: 400 });
      }
      await prisma.user.update({
        where: { id: assignment.customerId },
        data: { passwordHash: await hashPassword(password) },
      });
      return NextResponse.json({ success: true });
    }

    if (action === 'change_plan') {
      const newPlanId = String(body.planId || '');
      const displayPrice =
        body.displayPrice != null ? Math.max(0, Number(body.displayPrice) || 0) : assignment.displayPrice;
      if (!newPlanId) {
        return NextResponse.json({ error: 'planId required' }, { status: 400 });
      }
      if (newPlanId === assignment.planId) {
        await prisma.resellerUserAssignment.update({
          where: { id: assignment.id },
          data: { displayPrice },
        });
        await prisma.subscription.updateMany({
          where: { userId: assignment.customerId, status: 'ACTIVE' },
          data: { displayPrice },
        });
        return NextResponse.json({ success: true });
      }

      const newGrant = profile.seatGrants.find((g) => g.planId === newPlanId);
      if (!newGrant) {
        return NextResponse.json({ error: 'No seats allocated for that plan' }, { status: 400 });
      }
      if (newGrant.seatsUsed >= newGrant.seatsAllocated) {
        return NextResponse.json({ error: 'No remaining seats for the new plan' }, { status: 400 });
      }

      const plan = await prisma.plan.findUnique({ where: { id: newPlanId } });
      if (!plan) {
        return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
      }

      const oldGrant = profile.seatGrants.find((g) => g.planId === assignment.planId);

      await prisma.$transaction(async (tx) => {
        if (oldGrant && oldGrant.seatsUsed > 0) {
          await tx.resellerSeatGrant.update({
            where: { id: oldGrant.id },
            data: { seatsUsed: { decrement: 1 } },
          });
        }
        await tx.resellerSeatGrant.update({
          where: { id: newGrant.id },
          data: { seatsUsed: { increment: 1 } },
        });
        await tx.resellerUserAssignment.update({
          where: { id: assignment.id },
          data: { planId: newPlanId, displayPrice },
        });
        await tx.subscription.updateMany({
          where: { userId: assignment.customerId, status: 'ACTIVE' },
          data: { status: 'CANCELLED' },
        });
        await tx.subscription.create({
          data: {
            userId: assignment.customerId,
            planId: newPlanId,
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            periodDays: 30,
            displayPrice,
          },
        });
      });

      const { grantDealCredits } = await import('@/lib/customDeals');
      await grantDealCredits(
        assignment.customerId,
        plan.standardCreditsCycle,
        plan.proCreditsCycle,
        `Reseller plan change: ${plan.name}`,
        profile.parentAdminId
      );

      return NextResponse.json({ success: true, planName: plan.name });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 400 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireReseller(req);
    const profile = await getProfile(session.userId);
    if (!profile || !profile.isActive) {
      return NextResponse.json({ error: 'Reseller profile inactive' }, { status: 403 });
    }

    const body = await req.json();
    const email = String(body.email || '')
      .toLowerCase()
      .trim();
    const password = String(body.password || '');
    const name = String(body.name || 'Creator').trim() || 'Creator';
    const planId = String(body.planId || '');
    const displayPrice = Math.max(0, Number(body.displayPrice) || 0);
    const days = Math.max(1, Math.floor(Number(body.days) || 30));

    if (!email || !password || !planId) {
      return NextResponse.json({ error: 'Email, password, and plan required' }, { status: 400 });
    }

    const grant = profile.seatGrants.find((g) => g.planId === planId);
    if (!grant) {
      return NextResponse.json({ error: 'No seats allocated for this plan this month' }, { status: 400 });
    }
    if (grant.seatsUsed >= grant.seatsAllocated) {
      return NextResponse.json({ error: 'No remaining seats for this plan' }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: 'Email already in use' }, { status: 409 });
    }

    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
        ownedByAdminId: profile.parentAdminId,
        createdByResellerId: session.userId,
        acquiredVia: AcquiredVia.RESELLER,
        claimedAt: new Date(),
      },
    });

    await prisma.project.create({
      data: {
        userId: user.id,
        name: 'Default Studio Project',
        description: 'Primary workspace',
      },
    });

    await prisma.subscription.create({
      data: {
        userId: user.id,
        planId: plan.id,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
        periodDays: days,
        displayPrice,
        maxParallelOverride: null,
      },
    });

    const { grantDealCredits } = await import('@/lib/customDeals');
    await grantDealCredits(
      user.id,
      plan.standardCreditsCycle,
      plan.proCreditsCycle,
      `Reseller seat: ${plan.name}`,
      profile.parentAdminId
    );

    await prisma.resellerSeatGrant.update({
      where: { id: grant.id },
      data: { seatsUsed: { increment: 1 } },
    });

    await prisma.resellerUserAssignment.create({
      data: {
        resellerProfileId: profile.id,
        customerId: user.id,
        planId: plan.id,
        displayPrice,
        countsForAdmin: true,
      },
    });

    return NextResponse.json({ success: true, userId: user.id });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await requireReseller(req);
    const profile = await getProfile(session.userId);
    if (!profile || !profile.isActive) {
      return NextResponse.json({ error: 'Reseller profile inactive' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    let assignmentIds: string[] = [];
    const single = searchParams.get('assignmentId');
    if (single) {
      assignmentIds = [single];
    } else {
      const body = await req.json().catch(() => ({}));
      if (Array.isArray(body.assignmentIds)) {
        assignmentIds = body.assignmentIds.map((id: unknown) => String(id || '').trim()).filter(Boolean);
      } else if (body.assignmentId) {
        assignmentIds = [String(body.assignmentId).trim()].filter(Boolean);
      }
    }

    assignmentIds = [...new Set(assignmentIds)];
    if (!assignmentIds.length) {
      return NextResponse.json({ error: 'assignmentId or assignmentIds required' }, { status: 400 });
    }
    if (assignmentIds.length > 200) {
      return NextResponse.json({ error: 'Max 200 users per bulk remove' }, { status: 400 });
    }

    const now = new Date();
    let removed = 0;
    let seatsRestored = 0;
    const failed: { id: string; error: string }[] = [];

    for (const assignmentId of assignmentIds) {
      try {
        const assignment = await prisma.resellerUserAssignment.findFirst({
          where: { id: assignmentId, resellerProfileId: profile.id, removedAt: null },
        });
        if (!assignment) {
          failed.push({ id: assignmentId, error: 'Assignment not found' });
          continue;
        }

        const sameDay = sameCalendarDay(new Date(assignment.addedAt), now);
        const countsForAdmin = sameDay ? false : assignment.countsForAdmin;

        await prisma.resellerUserAssignment.update({
          where: { id: assignment.id },
          data: { removedAt: now, countsForAdmin },
        });

        if (sameDay) {
          const grant = profile.seatGrants.find((g) => g.planId === assignment.planId);
          if (grant && grant.seatsUsed > 0) {
            await prisma.resellerSeatGrant.update({
              where: { id: grant.id },
              data: { seatsUsed: { decrement: 1 } },
            });
            seatsRestored += 1;
            grant.seatsUsed = Math.max(0, grant.seatsUsed - 1);
          }
        }

        await prisma.user.update({
          where: { id: assignment.customerId },
          data: { status: UserStatus.BANNED, isLocked: true },
        });
        await prisma.subscription.updateMany({
          where: { userId: assignment.customerId, status: 'ACTIVE' },
          data: { status: 'CANCELLED' },
        });
        removed += 1;
      } catch (e: any) {
        failed.push({ id: assignmentId, error: e?.message || 'Failed' });
      }
    }

    return NextResponse.json({
      success: removed > 0,
      removed,
      seatsRestored,
      failed,
      message:
        failed.length === 0
          ? `Removed ${removed} user(s)`
          : `Removed ${removed}; ${failed.length} failed`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 400 });
  }
}
