import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NoticeSeverity } from '@prisma/client';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(req);
    const { id } = await params;
    const body = await req.json();
    const data: any = {};
    if (typeof body.title === 'string') data.title = body.title.trim();
    if (typeof body.body === 'string') data.body = body.body.trim();
    if (typeof body.isActive === 'boolean') data.isActive = body.isActive;
    if (body.severity === 'INFO' || body.severity === 'WARNING' || body.severity === 'SUCCESS') {
      data.severity = body.severity as NoticeSeverity;
    }
    const notice = await prisma.notice.update({ where: { id }, data });
    return NextResponse.json({ success: true, notice });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 400 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(req);
    const { id } = await params;
    await prisma.notice.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 400 });
  }
}
