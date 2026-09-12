import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const { searchParams } = new URL(req.url);
    const status = (searchParams.get('status') || 'ALL').toUpperCase();

    const tickets = await prisma.supportTicket.findMany({
      where:
        status === 'ALL'
          ? undefined
          : { status: status as 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: {
        user: { select: { id: true, email: true, name: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { messages: true } },
      },
    });

    return NextResponse.json({ success: true, tickets });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Forbidden' },
      { status: error.message === 'FORBIDDEN' ? 403 : 500 }
    );
  }
}
