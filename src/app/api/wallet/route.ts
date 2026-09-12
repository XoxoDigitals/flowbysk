import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getUserWallets } from '@/lib/credits';

export async function GET(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const wallets = await getUserWallets(session.userId);

    const ledger = await prisma.creditLedger.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json({
      success: true,
      wallets,
      history: ledger,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Unauthorized' },
      { status: error.message === 'UNAUTHORIZED' ? 401 : 500 }
    );
  }
}
