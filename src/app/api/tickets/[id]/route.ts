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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth(req);
    if (await ticketsDisabledFor(session.role)) {
      return NextResponse.json({ error: 'Support tickets are disabled' }, { status: 403 });
    }
    const { id } = await params;
    const ticket = await prisma.supportTicket.findFirst({
      where: {
        id,
        ...(session.role === 'ADMIN' ? {} : { userId: session.userId }),
      },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        user: { select: { id: true, email: true, name: true } },
      },
    });
    if (!ticket) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, ticket });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Unauthorized' },
      { status: error.message === 'UNAUTHORIZED' ? 401 : 500 }
    );
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth(req);
    if (await ticketsDisabledFor(session.role)) {
      return NextResponse.json({ error: 'Support tickets are disabled' }, { status: 403 });
    }
    const { id } = await params;
    const body = await req.json();
    const message = String(body.message || '').trim();
    if (message.length < 1) {
      return NextResponse.json({ error: 'Message required' }, { status: 400 });
    }

    const ticket = await prisma.supportTicket.findFirst({
      where: {
        id,
        ...(session.role === 'ADMIN' ? {} : { userId: session.userId }),
      },
    });
    if (!ticket) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (ticket.status === 'CLOSED' && session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Ticket is closed' }, { status: 400 });
    }

    const isStaff = session.role === 'ADMIN';
    const msg = await prisma.supportTicketMessage.create({
      data: {
        ticketId: id,
        authorId: session.userId,
        isStaff,
        body: message,
      },
    });

    await prisma.supportTicket.update({
      where: { id },
      data: {
        updatedAt: new Date(),
        ...(isStaff && ticket.status === 'OPEN' ? { status: 'IN_PROGRESS' } : {}),
      },
    });

    return NextResponse.json({ success: true, message: msg });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 400 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth(req);
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { id } = await params;
    const body = await req.json();
    const status = String(body.status || '').toUpperCase();
    if (!['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    const ticket = await prisma.supportTicket.update({
      where: { id },
      data: { status: status as any },
    });
    return NextResponse.json({ success: true, ticket });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 400 });
  }
}
