import { NextResponse } from 'next/server';
import { hashPassword, requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { AcquiredVia, UserRole, UserStatus } from '@prisma/client';
import { calendarMonthKey, ensureMonthSeatGrants } from '@/lib/adminScope';

export async function GET(req: Request) {
  try {
    const session = await requireAdmin(req);
    const monthKey = calendarMonthKey();
    const where =
      session.role === 'SUPER_ADMIN'
        ? {}
        : { parentAdminId: session.userId };

    const profiles = await prisma.resellerProfile.findMany({
      where,
      include: {
        user: { select: { id: true, email: true, name: true, status: true } },
        parentAdmin: { select: { id: true, email: true, name: true } },
        seatGrants: {
          where: { monthKey },
          include: { plan: { select: { id: true, name: true } } },
        },
        assignments: {
          where: { removedAt: null },
          include: {
            customer: { select: { id: true, email: true, name: true } },
            plan: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const plans = await prisma.plan.findMany({
      where: { isActive: true, NOT: { name: { in: ['Custom'] } } },
      orderBy: { priceMonthly: 'asc' },
      select: { id: true, name: true, priceMonthly: true },
    });

    return NextResponse.json({
      success: true,
      monthKey,
      plans,
      resellers: profiles.map((p) => ({
        id: p.id,
        label: p.label || p.user.name || p.user.email,
        isActive: p.isActive,
        deactivationMessage: p.deactivationMessage,
        user: p.user,
        parentAdmin: p.parentAdmin,
        seats: p.seatGrants.map((g) => ({
          planId: g.planId,
          planName: g.plan.name,
          allocated: g.seatsAllocated,
          used: g.seatsUsed,
          remaining: Math.max(0, g.seatsAllocated - g.seatsUsed),
          wholesalePrice: g.wholesalePrice,
        })),
        activeUsers: p.assignments.map((a) => ({
          assignmentId: a.id,
          id: a.customer.id,
          email: a.customer.email,
          name: a.customer.name,
          planId: a.plan.id,
          planName: a.plan.name,
          displayPrice: a.displayPrice,
          addedAt: a.addedAt,
        })),
      })),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Forbidden' },
      { status: error.message === 'FORBIDDEN' ? 403 : 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    const body = await req.json();
    const email = String(body.email || '')
      .toLowerCase()
      .trim();
    const password = String(body.password || '');
    const label = String(body.label || '').trim();
    const name = String(body.name || label || 'Reseller').trim();
    const grants = Array.isArray(body.grants) ? body.grants : [];

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password min 6 chars' }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: 'Email already in use' }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: UserRole.RESELLER,
        status: UserStatus.ACTIVE,
      },
    });

    const profile = await prisma.resellerProfile.create({
      data: {
        userId: user.id,
        parentAdminId: admin.userId,
        label: label || name,
      },
    });

    await ensureMonthSeatGrants(
      profile.id,
      grants.map((g: any) => ({
        planId: String(g.planId),
        seats: Number(g.seats) || 0,
        wholesalePrice: Number(g.wholesalePrice) || 0,
      }))
    );

    await prisma.adminAuditLog.create({
      data: {
        adminId: admin.userId,
        action: 'CREATE_RESELLER',
        targetType: 'USER',
        targetId: user.id,
        details: { email, grants },
      },
    });

    return NextResponse.json({ success: true, resellerId: profile.id, userId: user.id });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 400 });
  }
}
