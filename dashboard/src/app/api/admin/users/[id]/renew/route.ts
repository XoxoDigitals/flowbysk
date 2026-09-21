import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { applyCustomDeal } from '@/lib/customDeals';
import { claimUserForAdmin, isSuperAdmin } from '@/lib/adminScope';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin(req);
    const { id } = await params;
    const body = await req.json();

    if (!isSuperAdmin(admin.role)) {
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
    }

    const days = Math.max(1, Math.floor(Number(body.days) || 1));
    const standardCredits = Math.max(0, Math.floor(Number(body.standardCredits) || 0));
    const proCredits = Math.max(0, Math.floor(Number(body.proCredits) || 0));
    const maxParallel = Math.max(1, Math.floor(Number(body.maxParallel) || 1));
    const displayPrice = Math.max(0, Number(body.displayPrice) || 0);

    const sub = await applyCustomDeal(
      id,
      {
        days,
        standardCredits,
        proCredits,
        maxParallel,
        displayPrice,
        reason: body.reason || `Admin renewed custom deal (${days}d · $${displayPrice})`,
      },
      admin.userId
    );

    return NextResponse.json({
      success: true,
      message: `Custom deal applied: ${days} days, $${displayPrice}, ${maxParallel} parallel`,
      subscription: sub,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Renew failed' },
      { status: error.message === 'FORBIDDEN' ? 403 : 400 }
    );
  }
}
