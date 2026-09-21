import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { JobStatus, ProviderStatus, SubscriptionStatus } from '@prisma/client';
import { parseAnalyticsRange, rangeToDateBounds } from '@/lib/analytics-range';
import {
  ACTIVE_JOB_STATUSES,
  LIVE_JOB_STATUSES,
  calendarMonthBounds,
  classifyMethod,
  classifyTool,
  dayKey,
  eachDayKeys,
  isPaidPlan,
  isStopFailureMessage,
  isVideoModelKey,
  modelLabelForJob,
  rankCounts,
} from '@/lib/adminAnalytics';

export async function GET(req: Request) {
  try {
    await requireAdmin(req);

    const { searchParams } = new URL(req.url);
    const range = parseAnalyticsRange(searchParams.get('range'));
    const { start, end } = rangeToDateBounds(range);
    const month = calendarMonthBounds();
    const onlineSince = new Date(Date.now() - 15 * 60 * 1000);
    const createdInRange = { createdAt: { gte: start, lt: end } };

    const [
      totalUsers,
      activeUsersMonth,
      paidPlanUsers,
      activeSubscriptions,
      plans,
      monthSubs,
      newUsersInRange,
      newPaidSubsInRange,
      healthyProviders,
      liveJobs,
      rangeJobs,
      rangeFailedRaw,
      onlineNow,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({
        where: {
          status: 'ACTIVE',
          lastSeenAt: { gte: month.start, lt: month.end },
        },
      }),
      prisma.subscription.count({
        where: {
          status: SubscriptionStatus.ACTIVE,
          plan: { priceMonthly: { gt: 0 } },
        },
      }),
      prisma.subscription.count({ where: { status: SubscriptionStatus.ACTIVE } }),
      prisma.plan.findMany({
        where: { isActive: true },
        select: { id: true, name: true, priceMonthly: true },
        orderBy: { priceMonthly: 'asc' },
      }),
      prisma.subscription.findMany({
        where: {
          status: SubscriptionStatus.ACTIVE,
          OR: [
            { currentPeriodStart: { gte: month.start, lt: month.end } },
            { createdAt: { gte: month.start, lt: month.end } },
            {
              AND: [
                { currentPeriodStart: { lt: month.end } },
                { currentPeriodEnd: { gte: month.start } },
              ],
            },
          ],
        },
        select: { planId: true, plan: { select: { id: true, name: true, priceMonthly: true } } },
      }),
      prisma.user.count({ where: createdInRange }),
      prisma.subscription.count({
        where: {
          createdAt: { gte: start, lt: end },
          status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED] },
          plan: { priceMonthly: { gt: 0 } },
        },
      }),
      prisma.providerAccount.count({ where: { status: ProviderStatus.HEALTHY } }),
      prisma.generationJob.findMany({
        where: { status: { in: LIVE_JOB_STATUSES } },
        select: {
          id: true,
          userId: true,
          status: true,
          modelKey: true,
          prompt: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      prisma.generationJob.findMany({
        where: createdInRange,
        select: {
          id: true,
          status: true,
          modelKey: true,
          parameters: true,
          errorMessage: true,
          createdAt: true,
          completedAt: true,
        },
        orderBy: { createdAt: 'asc' },
        take: 5000,
      }),
      prisma.generationJob.count({
        where: {
          status: JobStatus.FAILED,
          ...createdInRange,
        },
      }),
      prisma.user.count({
        where: { status: 'ACTIVE', lastSeenAt: { gte: onlineSince } },
      }),
    ]);

    const planCountMap: Record<string, { planId: string; name: string; count: number; paid: boolean }> = {};
    for (const p of plans) {
      planCountMap[p.id] = {
        planId: p.id,
        name: p.name,
        count: 0,
        paid: isPaidPlan(p),
      };
    }
    for (const s of monthSubs) {
      const id = s.planId;
      if (!planCountMap[id]) {
        planCountMap[id] = {
          planId: id,
          name: s.plan.name,
          count: 0,
          paid: isPaidPlan(s.plan),
        };
      }
      planCountMap[id].count += 1;
    }
    const planBreakdown = Object.values(planCountMap).sort((a, b) => b.count - a.count);

    const inQueueNow = liveJobs.filter((j) => j.status === JobStatus.IN_QUEUE).length;
    const inProgressNow = liveJobs.filter((j) => ACTIVE_JOB_STATUSES.includes(j.status)).length;
    const activeUserMap = new Map<string, { id: string; name: string | null; email: string; jobs: number }>();
    for (const j of liveJobs) {
      const u = j.user;
      if (!u) continue;
      const prev = activeUserMap.get(u.id);
      if (prev) prev.jobs += 1;
      else activeUserMap.set(u.id, { id: u.id, name: u.name, email: u.email, jobs: 1 });
    }
    const activeUsersNowList = Array.from(activeUserMap.values()).sort((a, b) => b.jobs - a.jobs);

    let completed = 0;
    let failed = 0;
    let images = 0;
    let videos = 0;
    const toolMap: Record<string, number> = {};
    const methodMap: Record<string, number> = {};
    const modelMap: Record<string, number> = {};
    const gensByDay: Record<string, number> = {};
    const imagesByDay: Record<string, number> = {};
    const videosByDay: Record<string, number> = {};

    for (const key of eachDayKeys(start, end)) {
      gensByDay[key] = 0;
      imagesByDay[key] = 0;
      videosByDay[key] = 0;
    }

    for (const job of rangeJobs) {
      const dk = dayKey(new Date(job.createdAt));
      if (gensByDay[dk] !== undefined) gensByDay[dk] += 1;

      const video = isVideoModelKey(job.modelKey);
      if (video) {
        videos += 1;
        if (videosByDay[dk] !== undefined) videosByDay[dk] += 1;
      } else {
        images += 1;
        if (imagesByDay[dk] !== undefined) imagesByDay[dk] += 1;
      }

      if (job.status === JobStatus.COMPLETED) completed += 1;
      if (job.status === JobStatus.FAILED && !isStopFailureMessage(job.errorMessage)) failed += 1;

      const tool = classifyTool(job.parameters);
      toolMap[tool] = (toolMap[tool] || 0) + 1;
      const method = classifyMethod(job);
      methodMap[method] = (methodMap[method] || 0) + 1;
      const label = modelLabelForJob(job);
      modelMap[label] = (modelMap[label] || 0) + 1;
    }

    // New users daily series
    const newUsers = await prisma.user.findMany({
      where: createdInRange,
      select: { createdAt: true },
      take: 5000,
    });
    const newUsersByDay: Record<string, number> = {};
    for (const key of eachDayKeys(start, end)) newUsersByDay[key] = 0;
    for (const u of newUsers) {
      const dk = dayKey(new Date(u.createdAt));
      if (newUsersByDay[dk] !== undefined) newUsersByDay[dk] += 1;
    }

    const resolved = completed + failed;
    const successRate = resolved > 0 ? (completed / resolved) * 100 : 100;
    const failureRate = resolved > 0 ? (failed / resolved) * 100 : 0;

    // Keep legacy flat metrics for any old clients
    const legacyMetrics = {
      totalUsers,
      activeUsersNow: activeUsersNowList.length,
      activeLogins: onlineNow,
      onlineNow,
      pendingRequestsNow: inQueueNow,
      totalProjects: await prisma.project.count({
        where: { deletedAt: null, createdAt: { gte: start, lt: end } },
      }),
      activeSubscriptions,
      totalJobs: rangeJobs.length,
      completedJobs: completed,
      failedJobs: failed,
      inQueueJobs: inQueueNow,
      activeGeneratingJobs: inProgressNow,
      healthyProviders,
      successRate: Number(successRate.toFixed(1)),
      failureRate: Number(failureRate.toFixed(1)),
    };

    const staffAdmins = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { createdAt: 'asc' },
    });
    const monthKey = `${month.start.getFullYear()}-${String(month.start.getMonth() + 1).padStart(2, '0')}`;

    const paidOwned = await prisma.user.findMany({
      where: {
        role: 'CUSTOMER',
        ownedByAdminId: { not: null },
        OR: [
          {
            subscriptions: {
              some: {
                status: 'ACTIVE',
                OR: [
                  { isCustomDeal: true },
                  { plan: { priceMonthly: { gt: 0 } } },
                ],
                currentPeriodStart: { gte: month.start, lt: month.end },
              },
            },
          },
          {
            claimedAt: { gte: month.start, lt: month.end },
            subscriptions: {
              some: {
                status: 'ACTIVE',
                OR: [{ isCustomDeal: true }, { plan: { priceMonthly: { gt: 0 } } }],
              },
            },
          },
        ],
      },
      select: {
        id: true,
        ownedByAdminId: true,
        acquiredVia: true,
        createdByResellerId: true,
        subscriptions: {
          where: { status: 'ACTIVE' },
          take: 1,
          select: {
            isCustomDeal: true,
            displayPrice: true,
            planId: true,
            plan: { select: { name: true, priceMonthly: true } },
          },
        },
      },
    });

    const excluded = await prisma.resellerUserAssignment.findMany({
      where: { countsForAdmin: false },
      select: { customerId: true },
    });
    const excludedSet = new Set(excluded.map((e) => e.customerId));

    const activeResellerAssignments = await prisma.resellerUserAssignment.findMany({
      where: {
        countsForAdmin: true,
        customerId: { in: paidOwned.map((u) => u.id) },
      },
      select: {
        customerId: true,
        planId: true,
        resellerProfileId: true,
        displayPrice: true,
      },
    });
    const assignmentByCustomer = new Map(
      activeResellerAssignments.map((a) => [a.customerId, a])
    );

    const seatGrants = await prisma.resellerSeatGrant.findMany({
      where: { monthKey },
      select: {
        resellerProfileId: true,
        planId: true,
        wholesalePrice: true,
      },
    });
    const wholesaleKey = (resellerProfileId: string, planId: string) =>
      `${resellerProfileId}:${planId}`;
    const wholesaleMap = new Map(
      seatGrants.map((g) => [wholesaleKey(g.resellerProfileId, g.planId), g.wholesalePrice])
    );

    const paidByAdminMap: Record<string, number> = {};
    const revenueByAdminMap: Record<string, number> = {};
    const planByAdminMap: Record<string, Record<string, number>> = {};
    for (const a of staffAdmins) {
      paidByAdminMap[a.id] = 0;
      revenueByAdminMap[a.id] = 0;
      planByAdminMap[a.id] = {};
    }

    let totalRevenueMonth = 0;

    for (const u of paidOwned) {
      if (!u.ownedByAdminId || excludedSet.has(u.id)) continue;
      const sub = u.subscriptions[0];
      const planLabel = sub?.isCustomDeal ? 'Custom' : sub?.plan?.name || 'Unknown';

      let amount = 0;
      const viaReseller =
        u.acquiredVia === 'RESELLER' || !!u.createdByResellerId || assignmentByCustomer.has(u.id);
      if (viaReseller) {
        const asg = assignmentByCustomer.get(u.id);
        if (asg) {
          amount = Number(
            wholesaleMap.get(wholesaleKey(asg.resellerProfileId, asg.planId)) ?? 0
          );
        }
      } else {
        amount = Number(
          sub?.displayPrice != null ? sub.displayPrice : sub?.plan?.priceMonthly ?? 0
        );
      }
      if (!Number.isFinite(amount) || amount < 0) amount = 0;

      paidByAdminMap[u.ownedByAdminId] = (paidByAdminMap[u.ownedByAdminId] || 0) + 1;
      revenueByAdminMap[u.ownedByAdminId] =
        (revenueByAdminMap[u.ownedByAdminId] || 0) + amount;
      totalRevenueMonth += amount;
      if (!planByAdminMap[u.ownedByAdminId]) planByAdminMap[u.ownedByAdminId] = {};
      planByAdminMap[u.ownedByAdminId][planLabel] =
        (planByAdminMap[u.ownedByAdminId][planLabel] || 0) + 1;
    }

    // Cards: sub-admins only (hide SUPER_ADMIN)
    const subAdmins = staffAdmins.filter((a) => a.role === 'ADMIN');
    const paidByAdmin = subAdmins.map((a) => ({
      adminId: a.id,
      name: a.name || a.email,
      email: a.email,
      role: a.role,
      paidUsersMonth: paidByAdminMap[a.id] || 0,
      revenueMonth: Number((revenueByAdminMap[a.id] || 0).toFixed(2)),
      plans: Object.entries(planByAdminMap[a.id] || {})
        .map(([name, count]) => ({ name, count }))
        .sort((x, y) => y.count - x.count),
    }));

    const revenue = {
      totalMonth: Number(totalRevenueMonth.toFixed(2)),
      byAdmin: paidByAdmin.map((a) => ({
        adminId: a.adminId,
        name: a.name,
        email: a.email,
        revenueMonth: a.revenueMonth,
      })),
    };

    return NextResponse.json({
      success: true,
      range,
      from: start.toISOString(),
      to: end.toISOString(),
      month: { start: month.start.toISOString(), end: month.end.toISOString() },
      metrics: legacyMetrics,
      paidByAdmin,
      revenue,
      users: {
        totalUsers,
        activeUsersMonth,
        paidPlanUsers,
        activeSubscriptions,
        newUsersInRange,
        newPaidUsersInRange: newPaidSubsInRange,
        onlineNow,
      },
      plans: {
        breakdown: planBreakdown,
      },
      live: {
        activeUsersNow: activeUsersNowList.length,
        activeUsers: activeUsersNowList,
        activeJobsNow: liveJobs.length,
        inQueue: inQueueNow,
        inProgress: inProgressNow,
      },
      generations: {
        total: rangeJobs.length,
        images,
        videos,
        completed,
        failed,
        // rangeFailedRaw kept for debugging mismatch with stop-filtered failed
        failedRaw: rangeFailedRaw,
        successRate: Number(successRate.toFixed(1)),
        failureRate: Number(failureRate.toFixed(1)),
      },
      breakdowns: {
        tools: rankCounts(toolMap),
        methods: rankCounts(methodMap),
        models: rankCounts(modelMap),
      },
      series: {
        generationsDaily: Object.keys(gensByDay).map((date) => ({
          date,
          total: gensByDay[date],
          images: imagesByDay[date],
          videos: videosByDay[date],
        })),
        newUsersDaily: Object.keys(newUsersByDay).map((date) => ({
          date,
          count: newUsersByDay[date],
        })),
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Forbidden' },
      { status: error.message === 'FORBIDDEN' ? 403 : 500 }
    );
  }
}
