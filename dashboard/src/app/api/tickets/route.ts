import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getSiteSettings } from '@/lib/site-settings';

const isStaff = (role?: string) => role === 'ADMIN' || role === 'SUPER_ADMIN';

async function ticketsDisabledFor(role?: string) {
  if (isStaff(role)) return false;
  const settings = await getSiteSettings();
  return !settings.ticketSystemEnabled;
}

export async function GET(req: Request) {
  try {
    const session = await requireAuth(req);
    if (await ticketsDisabledFor(session.role)) {
      return NextResponse.json({ error: 'Support tickets are disabled' }, { status: 403 });
    }
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
    if (await ticketsDisabledFor(session.role)) {
      return NextResponse.json({ error: 'Support tickets are disabled' }, { status: 403 });
    }
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
