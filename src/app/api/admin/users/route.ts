import { NextResponse } from 'next/server';
import { hashPassword, requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isUserOnline, releaseIdleOfflineAllocations, ONLINE_WINDOW_MS } from '@/lib/allocation';
import { AcquiredVia, Prisma, UserRole } from '@prisma/client';
import { claimUserForAdmin, customerScopeWhere, isSuperAdmin } from '@/lib/adminScope';
import { applyCustomDeal } from '@/lib/customDeals';

export async function GET(req: Request) {
  try {
    const session = await requireAdmin(req);
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q')?.toLowerCase() || '';
    const status = (searchParams.get('status') || 'ALL').toUpperCase();
    const online = (searchParams.get('online') || 'ALL').toUpperCase();
    const plan = searchParams.get('plan') || 'ALL';
    const assignment = (searchParams.get('assignment') || 'ALL').toUpperCase();
    const ownerId = searchParams.get('owner') || 'ALL';
    const createdBy = searchParams.get('createdBy') || 'ALL';
    const via = (searchParams.get('via') || 'ALL').toUpperCase();
    const resellerId = searchParams.get('reseller') || 'ALL';

    releaseIdleOfflineAllocations().catch(() => 0);

    const and: Prisma.UserWhereInput[] = [customerScopeWhere(session) as Prisma.UserWhereInput];

    if (query) {
      and.push({
        OR: [
          { email: { contains: query, mode: 'insensitive' } },
          { name: { contains: query, mode: 'insensitive' } },
        ],
      });
    }

    if (status === 'ACTIVE' || status === 'BANNED') {
      and.push({ status: status as 'ACTIVE' | 'BANNED' });
    }

    if (assignment === 'ASSIGNED') {
      and.push({ assignedProviderAccountId: { not: null } });
    } else if (assignment === 'UNASSIGNED') {
      and.push({ assignedProviderAccountId: null });
    }

    if (online === 'ONLINE') {
      and.push({ lastSeenAt: { gte: new Date(Date.now() - ONLINE_WINDOW_MS) } });
    } else if (online === 'OFFLINE') {
      and.push({
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(Date.now() - ONLINE_WINDOW_MS) } }],
      });
    }

    if (plan !== 'ALL') {
      if (plan === 'Free') {
        and.push({
          OR: [
            { subscriptions: { none: { status: 'ACTIVE' } } },
            { subscriptions: { some: { status: 'ACTIVE', plan: { name: 'Free' } } } },
          ],
        });
      } else {
        and.push({
          subscriptions: { some: { status: 'ACTIVE', plan: { name: plan } } },
        });
      }
    }

    if (isSuperAdmin(session.role)) {
      if (ownerId === 'UNCLAIMED') {
        and.push({ ownedByAdminId: null });
      } else if (ownerId !== 'ALL') {
        and.push({ ownedByAdminId: ownerId });
      }
    }

    if (createdBy === 'ME') {
      and.push({ createdByAdminId: session.userId });
    } else if (createdBy !== 'ALL' && isSuperAdmin(session.role)) {
      and.push({ createdByAdminId: createdBy });
    }

    if (via === 'SIGNUP' || via === 'ADMIN_MANUAL' || via === 'RESELLER') {
      and.push({ acquiredVia: via as AcquiredVia });
    }

    if (resellerId !== 'ALL') {
      and.push({ createdByResellerId: resellerId });
    }

    const users = await prisma.user.findMany({
      where: { AND: and },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        createdAt: true,
        lastSeenAt: true,
        providerAssignmentManual: true,
        ownedByAdminId: true,
        createdByAdminId: true,
        createdByResellerId: true,
        acquiredVia: true,
        claimedAt: true,
        wallets: true,
        ownedByAdmin: { select: { id: true, name: true, email: true } },
        createdByAdmin: { select: { id: true, name: true, email: true } },
        subscriptions: {
          where: { status: 'ACTIVE' },
          include: { plan: true },
          take: 1,
        },
        assignedProviderAccount: {
          select: { id: true, label: true, accountEmail: true },
        },
        _count: {
          select: { generationJobs: true, projects: true },
        },
      },
    });

    const resellerIds = [
      ...new Set(users.map((u) => u.createdByResellerId).filter(Boolean) as string[]),
    ];
    const resellers = resellerIds.length
      ? await prisma.user.findMany({
          where: { id: { in: resellerIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const resellerMap = Object.fromEntries(resellers.map((r) => [r.id, r]));

    const staffForFilters = isSuperAdmin(session.role)
      ? await prisma.user.findMany({
          where: { role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] } },
          select: { id: true, name: true, email: true, role: true },
          orderBy: { email: 'asc' },
        })
      : [];

    const resellerList = await prisma.resellerProfile.findMany({
      where: isSuperAdmin(session.role) ? undefined : { parentAdminId: session.userId },
      select: {
        id: true,
        userId: true,
        label: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });

    const formatted = users.map((u) => {
      const sub = u.subscriptions[0];
      const planName = sub?.plan?.name || 'Free';
      const maxParallel =
        sub?.maxParallelOverride != null && sub.maxParallelOverride > 0
          ? sub.maxParallelOverride
          : sub?.plan?.maxParallel || 1;
      const stdWallet = u.wallets.find((w) => w.walletType === 'STANDARD');
      const proWallet = u.wallets.find((w) => w.walletType === 'PRO');
      const onlineNow = isUserOnline(u.lastSeenAt);
      const reseller = u.createdByResellerId ? resellerMap[u.createdByResellerId] : null;

      return {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        status: u.status,
        plan: planName,
        maxParallel,
        displayPrice: sub?.displayPrice ?? null,
        isCustomDeal: !!sub?.isCustomDeal,
        periodEnd: sub?.currentPeriodEnd || null,
        periodDays: sub?.periodDays ?? null,
        acquiredVia: u.acquiredVia,
        ownedByAdminId: u.ownedByAdminId,
        ownerLabel: u.ownedByAdmin
          ? u.ownedByAdmin.name || u.ownedByAdmin.email
          : u.ownedByAdminId
            ? 'Admin'
            : 'Unclaimed',
        createdByAdminId: u.createdByAdminId,
        createdByLabel: u.createdByAdmin
          ? u.createdByAdmin.name || u.createdByAdmin.email
          : null,
        createdByResellerId: u.createdByResellerId,
        resellerLabel: reseller ? reseller.name || reseller.email : null,
        claimedAt: u.claimedAt,
        createdAt: u.createdAt,
        lastSeenAt: u.lastSeenAt,
        isOnline: onlineNow,
        standardCredits: {
          available: (stdWallet?.balance || 0) - (stdWallet?.reserved || 0),
          total: stdWallet?.balance || 0,
          reserved: stdWallet?.reserved || 0,
        },
        proCredits: {
          available: (proWallet?.balance || 0) - (proWallet?.reserved || 0),
          total: proWallet?.balance || 0,
          reserved: proWallet?.reserved || 0,
        },
        totalJobs: u._count.generationJobs,
        totalProjects: u._count.projects,
        assignedAccount: u.assignedProviderAccount?.label || 'Unassigned',
        assignedAccountEmail: u.assignedProviderAccount?.accountEmail || null,
        assignedAccountId: u.assignedProviderAccount?.id || null,
        providerAssignmentManual: u.providerAssignmentManual,
      };
    });

    return NextResponse.json({
      success: true,
      users: formatted,
      filters: {
        staff: staffForFilters,
        resellers: resellerList.map((r) => ({
          id: r.userId,
          label: r.label || r.user.name || r.user.email,
        })),
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Forbidden' },
      { status: error.message === 'FORBIDDEN' ? 403 : error.message === 'UNAUTHORIZED' ? 401 : 500 }
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
    const name = String(body.name || 'Creator').trim() || 'Creator';
    const mode = String(body.mode || 'custom').toLowerCase(); // custom | catalog

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: UserRole.CUSTOMER,
        status: 'ACTIVE',
        ownedByAdminId: admin.userId,
        createdByAdminId: admin.userId,
        acquiredVia: AcquiredVia.ADMIN_MANUAL,
        claimedAt: new Date(),
      },
    });

    await prisma.project.create({
      data: {
        userId: user.id,
        name: 'Default Studio Project',
        description: 'Primary workspace for generating images and videos',
      },
    });

    const days = Math.max(1, Math.floor(Number(body.days) || 30));
    const standardCredits = Math.max(0, Math.floor(Number(body.standardCredits) || 0));
    const proCredits = Math.max(0, Math.floor(Number(body.proCredits) || 0));
    const maxParallel = Math.max(1, Math.floor(Number(body.maxParallel) || 1));
    const displayPrice = Math.max(0, Number(body.displayPrice) || 0);
    const planName = String(body.planName || '').trim();

    let subscription;
    if (mode === 'catalog' && planName && planName.toLowerCase() !== 'custom') {
      const plan = await prisma.plan.findUnique({ where: { name: planName } });
      if (!plan || plan.name === 'Custom') {
        return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
      }
      const periodDays = 30;
      subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          planId: plan.id,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + periodDays * 24 * 60 * 60 * 1000),
          isCustomDeal: false,
          displayPrice,
          maxParallelOverride: null,
          periodDays,
        },
        include: { plan: true },
      });
      const { grantDealCredits } = await import('@/lib/customDeals');
      await grantDealCredits(
        user.id,
        plan.standardCreditsCycle,
        plan.proCreditsCycle,
        `Admin created user on ${plan.name}`,
        admin.userId
      );
    } else {
      subscription = await applyCustomDeal(
        user.id,
        {
          days,
          standardCredits,
          proCredits,
          maxParallel,
          displayPrice,
          reason: body.reason || `Admin created user with custom deal (${days}d)`,
        },
        admin.userId
      );
    }

    await claimUserForAdmin(user.id, admin.userId);

    return NextResponse.json({
      success: true,
      user: { id: user.id, email: user.email, name: user.name },
      subscription,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to create user' },
      { status: error.message === 'FORBIDDEN' ? 403 : 400 }
    );
  }
}
