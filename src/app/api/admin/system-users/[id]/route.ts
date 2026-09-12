import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { UserRole, UserStatus } from '@prisma/client';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSuperAdmin(req);
    const { id } = await params;
    const body = await req.json();

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target || (target.role !== UserRole.ADMIN && target.role !== UserRole.SUPER_ADMIN)) {
      return NextResponse.json({ error: 'Staff user not found' }, { status: 404 });
    }
    if (target.id === actor.userId) {
      return NextResponse.json({ error: 'Cannot modify your own staff account here' }, { status: 400 });
    }
    if (target.role === UserRole.SUPER_ADMIN) {
      return NextResponse.json({ error: 'Cannot modify other super admins' }, { status: 403 });
    }

    const data: { status?: UserStatus; name?: string } = {};
    if (body.status === 'ACTIVE' || body.status === 'BANNED') {
      data.status = body.status;
    }
    if (typeof body.name === 'string' && body.name.trim()) {
      data.name = body.name.trim();
    }

    if (!Object.keys(data).length) {
      return NextResponse.json({ error: 'No changes' }, { status: 400 });
    }

    const user = await prisma.user.update({ where: { id }, data });
    await prisma.adminAuditLog.create({
      data: {
        adminId: actor.userId,
        action: 'UPDATE_SUB_ADMIN',
        targetType: 'USER',
        targetId: id,
        details: data,
      },
    });

    return NextResponse.json({ success: true, user });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed' },
      { status: error.message === 'FORBIDDEN' ? 403 : 400 }
    );
  }
}
