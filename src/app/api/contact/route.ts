import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSiteSettings } from '@/lib/site-settings';

export async function POST(req: Request) {
  try {
    const settings = await getSiteSettings();
    if (settings.contactPageEnabled === false) {
      return NextResponse.json({ error: 'Contact form is currently disabled' }, { status: 403 });
    }

    const body = await req.json();
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim();
    const subject = String(body.subject || '').trim() || null;
    const message = String(body.message || '').trim();

    if (!name || name.length < 2) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }
    if (!message || message.length < 10) {
      return NextResponse.json({ error: 'Message must be at least 10 characters' }, { status: 400 });
    }

    await prisma.contactMessage.create({
      data: { name, email, subject, message },
    });

    return NextResponse.json({
      success: true,
      message: `Thanks! We received your message and will reply to you soon${settings.contactEmail ? ` (team: ${settings.contactEmail})` : ''}.`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to send' }, { status: 500 });
  }
}
