import { prisma } from '@/lib/prisma';
import type { AuthSession } from '@/lib/auth';
import { AcquiredVia, UserRole } from '@prisma/client';

export function isStaffAdmin(role: string | undefined | null): boolean {
  return role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN;
}

export function isSuperAdmin(role: string | undefined | null): boolean {
  return role === UserRole.SUPER_ADMIN;
}

export function calendarMonthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Claim customer for this admin if unowned or already owned by them. */
export async function claimUserForAdmin(customerId: string, adminId: string) {
  const user = await prisma.user.findUnique({
    where: { id: customerId },
    select: { id: true, ownedByAdminId: true, role: true },
  });
  if (!user || user.role !== UserRole.CUSTOMER) return null;
  if (user.ownedByAdminId && user.ownedByAdminId !== adminId) {
    throw new Error('USER_OWNED_BY_OTHER_ADMIN');
  }
  if (user.ownedByAdminId === adminId) return user;
  return prisma.user.update({
    where: { id: customerId },
    data: {
      ownedByAdminId: adminId,
      claimedAt: new Date(),
    },
  });
}

/** Where clause for customers visible to this staff session. */
export function customerScopeWhere(session: AuthSession): Record<string, unknown> {
  if (isSuperAdmin(session.role)) {
    // Super admin sees everyone; still filter to customers for user lists by default
    return { role: UserRole.CUSTOMER };
  }
  // Sub-admin: owned by me OR unclaimed pool
  return {
    role: UserRole.CUSTOMER,
    OR: [{ ownedByAdminId: session.userId }, { ownedByAdminId: null }],
  };
}

export async function ensureMonthSeatGrants(
  resellerProfileId: string,
  grants: { planId: string; seats: number; wholesalePrice: number }[]
) {
  const monthKey = calendarMonthKey();
  const out = [];
  for (const g of grants) {
    if (!g.planId || g.seats <= 0) continue;
    const row = await prisma.resellerSeatGrant.upsert({
      where: {
        resellerProfileId_planId_monthKey: {
          resellerProfileId,
          planId: g.planId,
          monthKey,
        },
      },
      create: {
        resellerProfileId,
        planId: g.planId,
        monthKey,
        seatsAllocated: Math.floor(g.seats),
        seatsUsed: 0,
        wholesalePrice: Number(g.wholesalePrice) || 0,
      },
      update: {
        seatsAllocated: Math.floor(g.seats),
        wholesalePrice: Number(g.wholesalePrice) || 0,
      },
      include: { plan: true },
    });
    out.push(row);
  }
  return out;
}

export function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export { AcquiredVia, UserRole };
