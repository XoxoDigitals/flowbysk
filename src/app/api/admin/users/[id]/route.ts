import { NextResponse } from 'next/server';
import { requireAdmin, hashPassword } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { UserStatus } from '@prisma/client';
import { setUserProviderAssignment } from '@/lib/allocation';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(req);
    const { id } = await params;

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        wallets: true,
        subscriptions: {
          include: { plan: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        assignedProviderAccount: {
          select: {
            id: true,
            label: true,
            accountEmail: true,
            status: true,
            googleCreditsBalance: true,
          },
        },
        orders: {
          include: { plan: true },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        ledgerEntries: {
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
        _count: {
          select: {
            generationJobs: true,
            projects: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Generation analytics
    const jobs = await prisma.generationJob.findMany({
      where: { userId: id },
      select: {
        id: true,
        modelKey: true,
        creditCost: true,
        walletType: true,
        status: true,
        progress: true,
        prompt: true,
        parameters: true,
        outputMediaUrl: true,
        errorMessage: true,
        submittedAt: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    let totalCreditsSpent = 0;
    let successfulJobs = 0;
    let failedJobs = 0;
    let videoJobs = 0;
    let imageJobs = 0;

    for (const j of jobs) {
      if (j.status === 'COMPLETED') {
        successfulJobs++;
        totalCreditsSpent += j.creditCost;
      } else if (j.status === 'FAILED') {
        const err = String(j.errorMessage || '');
        if (!/stop by user|cancelled by user|canceled by user/i.test(err)) {
          failedJobs++;
        }
      }

      const m = (j.modelKey || '').toLowerCase();
      if (m.includes('veo') || m.includes('omni') || m.includes('video')) {
        videoJobs++;
      } else {
        imageJobs++;
      }
    }

    // Available provider accounts for assignment
    const availableProviderAccounts = await prisma.providerAccount.findMany({
      select: {
        id: true,
        label: true,
        accountEmail: true,
        status: true,
        googleCreditsBalance: true,
      },
      orderBy: { label: 'asc' },
    });

    // Available plans for quick switching
    const availablePlans = await prisma.plan.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        maxParallel: true,
        priceMonthly: true,
        standardCreditsCycle: true,
        proCreditsCycle: true,
      },
      orderBy: { maxParallel: 'asc' },
    });

    const activeSub = user.subscriptions[0];
    const stdWallet = user.wallets.find((w) => w.walletType === 'STANDARD');
    const proWallet = user.wallets.find((w) => w.walletType === 'PRO');

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        isLocked: user.isLocked ?? false,
        lastIp: user.lastIp || '127.0.0.1',
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        plan: activeSub?.plan?.name || 'Free',
        maxParallel:
          activeSub?.maxParallelOverride != null && activeSub.maxParallelOverride > 0
            ? activeSub.maxParallelOverride
            : activeSub?.plan?.maxParallel || 1,
        displayPrice: activeSub?.displayPrice ?? null,
        isCustomDeal: !!activeSub?.isCustomDeal,
        periodDays: activeSub?.periodDays ?? null,
        periodEnd: activeSub?.currentPeriodEnd || null,
        providerAssignmentManual: user.providerAssignmentManual,
        wallets: {
          standard: {
            available: (stdWallet?.balance || 0) - (stdWallet?.reserved || 0),
            total: stdWallet?.balance || 0,
            reserved: stdWallet?.reserved || 0,
          },
          pro: {
            available: (proWallet?.balance || 0) - (proWallet?.reserved || 0),
            total: proWallet?.balance || 0,
            reserved: proWallet?.reserved || 0,
          },
        },
        assignedProviderAccount: user.assignedProviderAccount,
        stats: {
          totalJobs: user._count.generationJobs,
          successfulJobs,
          failedJobs,
          totalCreditsSpent,
          videoJobs,
          imageJobs,
          totalProjects: user._count.projects,
        },
        recentJobs: jobs,
        transactions: user.ledgerEntries,
        orders: user.orders,
      },
      availableProviderAccounts,
      availablePlans,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin(req);
    const { id } = await params;
    const body = await req.json();

    const {
      newPassword,
      isLocked,
      assignedProviderAccountId,
      role,
      name,
    } = body;

    const updateData: any = {};

    if (newPassword && newPassword.trim().length >= 6) {
      updateData.passwordHash = await hashPassword(newPassword.trim());
    }

    if (isLocked !== undefined) {
      updateData.isLocked = Boolean(isLocked);
      updateData.status = isLocked ? UserStatus.BANNED : UserStatus.ACTIVE;
    }

    if (role && (role === 'CUSTOMER' || role === 'ADMIN')) {
      updateData.role = role;
    }

    if (name && name.trim()) {
      updateData.name = name.trim();
    }

    let assignmentResult: {
      assignedProviderAccountId: string | null;
      providerAssignmentManual: boolean;
    } | null = null;

    if (assignedProviderAccountId !== undefined) {
      assignmentResult = await setUserProviderAssignment(
        id,
        assignedProviderAccountId || null
      );
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.user.update({
        where: { id },
        data: updateData,
      });
    } else if (!assignmentResult) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const updatedUser = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        isLocked: true,
        assignedProviderAccountId: true,
        providerAssignmentManual: true,
      },
    });

    await prisma.adminAuditLog.create({
      data: {
        adminId: admin.userId,
        action: 'ADMIN_USER_UPDATED',
        targetType: 'USER',
        targetId: id,
        details: {
          fields: [
            ...Object.keys(updateData),
            ...(assignedProviderAccountId !== undefined
              ? ['assignedProviderAccountId', 'providerAssignmentManual']
              : []),
          ],
          assignmentResult,
        },
      },
    });

    return NextResponse.json({
      success: true,
      message: 'User successfully updated',
      user: updatedUser,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to update user' },
      { status: 400 }
    );
  }
}
