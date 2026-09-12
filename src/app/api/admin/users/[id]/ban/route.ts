import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { UserStatus } from '@prisma/client';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin(req);
    const { id } = await params;
    const body = await req.json();
    const { banned, reason } = body;

    const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
    if (!target) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (target.role === 'ADMIN' || target.role === 'SUPER_ADMIN' || target.role === 'RESELLER') {
      return NextResponse.json(
        { error: 'Cannot ban staff or reseller accounts from Users' },
        { status: 403 }
      );
    }

    const user = await prisma.user.update({
      where: { id },
      data: { status: banned ? UserStatus.BANNED : UserStatus.ACTIVE },
    });

    await prisma.adminAuditLog.create({
      data: {
        adminId: admin.userId,
        action: banned ? 'USER_BAN' : 'USER_UNBAN',
        targetType: 'USER',
        targetId: id,
        details: { reason },
      },
    });

    return NextResponse.json({
      success: true,
      message: `User ${banned ? 'banned' : 'unbanned'} successfully.`,
      status: user.status,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Operation failed' },
      { status: 400 }
    );
  }
}
