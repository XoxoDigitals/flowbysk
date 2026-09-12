import { NextResponse } from 'next/server';
import { hashPassword, requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { UserStatus } from '@prisma/client';
import { calendarMonthKey } from '@/lib/adminScope';

async function getOwnedReseller(adminId: string, role: string, id: string) {
  const profile = await prisma.resellerProfile.findUnique({
    where: { id },
    include: {
      user: true,
      assignments: { where: { removedAt: null }, select: { customerId: true } },
    },
  });
  if (!profile) return null;
  if (role !== 'SUPER_ADMIN' && profile.parentAdminId !== adminId) return null;
  return profile;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin(req);
    const { id } = await params;
    const body = await req.json();
    const profile = await getOwnedReseller(admin.userId, admin.role, id);
    if (!profile) {
      return NextResponse.json({ error: 'Reseller not found' }, { status: 404 });
    }

    const action = String(body.action || 'update');

    if (action === 'seats') {
      const grants = Array.isArray(body.grants) ? body.grants : [];
      const monthKey = calendarMonthKey();
      for (const g of grants) {
        const planId = String(g.planId);
        if (!planId) continue;
        const seats = Math.max(0, Math.floor(Number(g.seats) || 0));
        const wholesalePrice = Math.max(0, Number(g.wholesalePrice) || 0);
        const existing = await prisma.resellerSeatGrant.findUnique({
          where: {
            resellerProfileId_planId_monthKey: {
              resellerProfileId: profile.id,
              planId,
              monthKey,
            },
          },
        });
        if (existing && seats < existing.seatsUsed) {
          return NextResponse.json(
            { error: `Cannot set seats below used (${existing.seatsUsed}) for a plan` },
            { status: 400 }
          );
        }
        await prisma.resellerSeatGrant.upsert({
          where: {
            resellerProfileId_planId_monthKey: {
              resellerProfileId: profile.id,
              planId,
              monthKey,
            },
          },
          create: {
            resellerProfileId: profile.id,
            planId,
            monthKey,
            seatsAllocated: seats,
            seatsUsed: 0,
            wholesalePrice,
          },
          update: {
            seatsAllocated: seats,
            wholesalePrice,
          },
        });
      }
      await prisma.adminAuditLog.create({
        data: {
          adminId: admin.userId,
          action: 'RESELLER_SEATS_UPDATE',
          targetType: 'USER',
          targetId: profile.userId,
          details: { grants },
        },
      });
      return NextResponse.json({ success: true });
    }

    if (action === 'password') {
      const password = String(body.password || '');
      if (password.length < 6) {
        return NextResponse.json({ error: 'Password min 6 chars' }, { status: 400 });
      }
      await prisma.user.update({
        where: { id: profile.userId },
        data: { passwordHash: await hashPassword(password) },
      });
      await prisma.adminAuditLog.create({
        data: {
          adminId: admin.userId,
          action: 'RESELLER_PASSWORD_RESET',
          targetType: 'USER',
          targetId: profile.userId,
          details: {},
        },
      });
      return NextResponse.json({ success: true });
    }

    if (action === 'deactivate' || action === 'activate') {
      const isActive = action === 'activate';
      const deactivateUsers = body.deactivateUsers === true;
      const message = body.message != null ? String(body.message).trim() : null;

      await prisma.resellerProfile.update({
        where: { id: profile.id },
        data: {
          isActive,
          deactivationMessage: isActive ? null : message || profile.deactivationMessage,
        },
      });

      if (!isActive) {
        await prisma.user.update({
          where: { id: profile.userId },
          data: { status: UserStatus.BANNED, isLocked: true },
        });
        if (deactivateUsers && profile.assignments.length) {
          const ids = profile.assignments.map((a) => a.customerId);
          await prisma.user.updateMany({
            where: { id: { in: ids } },
            data: { status: UserStatus.BANNED, isLocked: true },
          });
        }
      } else {
        await prisma.user.update({
          where: { id: profile.userId },
          data: { status: UserStatus.ACTIVE, isLocked: false },
        });
      }

      await prisma.adminAuditLog.create({
        data: {
          adminId: admin.userId,
          action: isActive ? 'RESELLER_ACTIVATE' : 'RESELLER_DEACTIVATE',
          targetType: 'USER',
          targetId: profile.userId,
          details: { deactivateUsers, message },
        },
      });
      return NextResponse.json({ success: true });
    }

    if (typeof body.label === 'string') {
      await prisma.resellerProfile.update({
        where: { id: profile.id },
        data: { label: body.label.trim() || null },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed' },
      { status: error.message === 'FORBIDDEN' ? 403 : 400 }
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin(req);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const profile = await getOwnedReseller(admin.userId, admin.role, id);
    if (!profile) {
      return NextResponse.json({ error: 'Reseller not found' }, { status: 404 });
    }

    const deactivateUsers = body.deactivateUsers === true;
    const message = body.message != null ? String(body.message).trim() : null;

    if (deactivateUsers && profile.assignments.length) {
      const ids = profile.assignments.map((a) => a.customerId);
      await prisma.user.updateMany({
        where: { id: { in: ids } },
        data: { status: UserStatus.BANNED, isLocked: true },
      });
    } else if (message && profile.assignments.length) {
      // Keep users active but stamp a notice via their reseller profile message first
      await prisma.resellerProfile.update({
        where: { id: profile.id },
        data: { deactivationMessage: message, isActive: false },
      });
    }

    const userId = profile.userId;
    await prisma.resellerProfile.delete({ where: { id: profile.id } });
    await prisma.user.delete({ where: { id: userId } });

    await prisma.adminAuditLog.create({
      data: {
        adminId: admin.userId,
        action: 'RESELLER_DELETE',
        targetType: 'USER',
        targetId: userId,
        details: { deactivateUsers, message },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed' },
      { status: error.message === 'FORBIDDEN' ? 403 : 400 }
    );
  }
}
