import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getUserWallets } from '@/lib/credits';

export async function GET(req: Request) {
  try {
    const session = await getSessionUser(req);
    if (!session) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        assignedProviderAccount: {
          select: {
            id: true,
            label: true,
            accountEmail: true,
            planTier: true,
            projectUrl: true,
            googleCreditsBalance: true,
          },
        },
        subscriptions: {
          where: { status: 'ACTIVE' },
          include: { plan: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!user) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    // Heartbeat for "Active Login users" — throttle writes to ~1/min
    const staleBefore = new Date(Date.now() - 60_000);
    await prisma.user.updateMany({
      where: {
        id: session.userId,
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: staleBefore } }],
      },
      data: { lastSeenAt: new Date() },
    });

    // Ensure a Google account is allocated while the session is alive
    if (!user.assignedProviderAccount) {
      try {
        const { allocateProviderAccountForUser } = await import('@/lib/allocation');
        await allocateProviderAccountForUser(session.userId);
        const refreshed = await prisma.user.findUnique({
          where: { id: session.userId },
          select: {
            assignedProviderAccount: {
              select: {
                id: true,
                label: true,
                accountEmail: true,
                planTier: true,
                projectUrl: true,
                googleCreditsBalance: true,
              },
            },
          },
        });
        if (refreshed?.assignedProviderAccount) {
          (user as any).assignedProviderAccount = refreshed.assignedProviderAccount;
        }
      } catch (e) {
        console.warn('Session allocation failed:', e);
      }
    }

    const currentSub = user.subscriptions[0];
    let sub:
      | (typeof currentSub)
      | Awaited<ReturnType<typeof import('@/lib/customDeals').downgradeExpiredSubscription>>
      | null = currentSub || null;
    if (sub && sub.currentPeriodEnd.getTime() < Date.now()) {
      const { downgradeExpiredSubscription } = await import('@/lib/customDeals');
      sub = await downgradeExpiredSubscription(session.userId);
    }

    const { resolveEffectiveParallel } = await import('@/lib/customDeals');
    const plan = sub?.plan || {
      name: 'Free',
      maxParallel: 1,
      priceMonthly: 0,
      contactSeller: false,
    };

    const wallets = await getUserWallets(user.id);

    const displayPrice =
      sub?.displayPrice != null
        ? sub.displayPrice
        : (plan as { priceMonthly?: number }).priceMonthly ?? null;

    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        plan: plan.name,
        maxParallel: resolveEffectiveParallel(sub),
        displayPrice,
        isCustomDeal: !!sub?.isCustomDeal,
        periodDays: sub?.periodDays ?? null,
        periodEnd: sub?.currentPeriodEnd?.toISOString?.() || null,
        wallets,
        assignedProviderAccount: user.assignedProviderAccount,
      },
    });
  } catch (error: any) {
    console.error('Error fetching /api/auth/me:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
