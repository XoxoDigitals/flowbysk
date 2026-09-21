import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { adminAdjustCredits } from '@/lib/credits';
import { WalletType } from '@prisma/client';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin(req);
    const { id } = await params;
    const body = await req.json();
    const { walletType, delta, reason } = body;

    if (!walletType || delta === undefined || !reason) {
      return NextResponse.json(
        { error: 'walletType (STANDARD or PRO), delta (number), and reason are required' },
        { status: 400 }
      );
    }

    const type = walletType.toUpperCase() === 'PRO' ? WalletType.PRO : WalletType.STANDARD;
    const wallet = await adminAdjustCredits(admin.userId, id, type, Number(delta), reason);

    return NextResponse.json({
      success: true,
      message: `Successfully adjusted ${delta} ${type} credits.`,
      wallet,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Operation failed' },
      { status: 400 }
    );
  }
}
