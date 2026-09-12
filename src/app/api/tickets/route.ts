import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: Request) {
  try {
    const session = await requireAuth(req);
    const tickets = await prisma.supportTicket.findMany({
      where: { userId: session.userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: { orderBy: { createdAt: 'asc' }, take: 1 },
        _count: { select: { messages: true } },
      },
    });
    return NextResponse.json({ success: true, tickets });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Unauthorized' },
      { status: error.message === 'UNAUTHORIZED' ? 401 : 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireAuth(req);
    const body = await req.json();
    const subject = String(body.subject || '').trim();
    const message = String(body.message || '').trim();
    if (subject.length < 3) {
      return NextResponse.json({ error: 'Subject is required' }, { status: 400 });
    }
    if (message.length < 5) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const ticket = await prisma.supportTicket.create({
      data: {
        userId: session.userId,
        subject,
        messages: {
          create: {
            authorId: session.userId,
            isStaff: false,
            body: message,
          },
        },
      },
      include: { messages: true },
    });

    return NextResponse.json({ success: true, ticket });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 400 });
  }
}
