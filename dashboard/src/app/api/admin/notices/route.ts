import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NoticeSeverity } from '@prisma/client';

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const notices = await prisma.notice.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ success: true, notices });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Forbidden' },
      { status: error.message === 'FORBIDDEN' ? 403 : 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const body = await req.json();
    const title = String(body.title || '').trim();
    const noticeBody = String(body.body || '').trim();
    if (!title || !noticeBody) {
      return NextResponse.json({ error: 'Title and body are required' }, { status: 400 });
    }
    let severity: NoticeSeverity = NoticeSeverity.INFO;
    if (body.severity === 'WARNING') severity = NoticeSeverity.WARNING;
    if (body.severity === 'SUCCESS') severity = NoticeSeverity.SUCCESS;

    const notice = await prisma.notice.create({
      data: {
        title,
        body: noticeBody,
        severity,
        isActive: body.isActive !== false,
      },
    });
    return NextResponse.json({ success: true, notice });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 400 });
  }
}
