import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ProviderStatus } from '@prisma/client';

export async function GET(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    let targetProvider = null;

    if (session?.userId) {
      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        include: { assignedProviderAccount: true },
      });

      if (user?.assignedProviderAccount && user.assignedProviderAccount.status === ProviderStatus.HEALTHY) {
        targetProvider = user.assignedProviderAccount;
      }
    }

    if (!targetProvider) {
      targetProvider = await prisma.providerAccount.findFirst({
        where: { status: ProviderStatus.HEALTHY },
        orderBy: [{ googleCreditsBalance: 'desc' }, { createdAt: 'asc' }],
      });
    }

    if (targetProvider) {
      const isUltra = targetProvider.planTier === 'Google AI Ultra';
      return NextResponse.json({
        is_authenticated: true,
        email: targetProvider.accountEmail,
        account_email: targetProvider.accountEmail,
        plan_name: targetProvider.planTier || (isUltra ? 'Google AI Ultra' : 'Google AI Pro'),
        paygate_tier: isUltra ? 'PAYGATE_TIER_THREE' : 'PAYGATE_TIER_TWO',
        credits: targetProvider.googleCreditsBalance,
        active_project_id: targetProvider.activeProjectId,
        project_url: targetProvider.projectUrl,
        expires_seconds: 86400,
        simulation_mode: false,
        user_email: session?.email || null,
        assigned_account_label: targetProvider.label,
        assigned_account_id: targetProvider.id,
      });
    }

    // Fallback to FastAPI status if no provider accounts exist in DB
    const upstreamRes = await fetch('http://127.0.0.1:8000/api/auth/status').catch(() => null);
    if (upstreamRes && upstreamRes.ok) {
      const data = await upstreamRes.json();
      return NextResponse.json(data);
    }

    return NextResponse.json({
      is_authenticated: false,
      email: 'No Provider Account',
      plan_name: 'Free Tier',
      credits: 0,
      simulation_mode: true,
    });
  } catch (err: any) {
    console.error('Error in /api/auth/status:', err);
    return NextResponse.json({
      is_authenticated: false,
      email: 'Error',
      error: err.message,
    }, { status: 500 });
  }
}
