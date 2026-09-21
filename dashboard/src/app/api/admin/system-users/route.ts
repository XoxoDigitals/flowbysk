import { NextResponse } from 'next/server';
import { hashPassword, requireSuperAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { UserRole, UserStatus } from '@prisma/client';

export async function GET(req: Request) {
  try {
    await requireSuperAdmin(req);
    const staff = await prisma.user.findMany({
      where: { role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        createdAt: true,
        lastSeenAt: true,
        _count: {
          select: {
            ownedCustomers: true,
          },
        },
      },
    });
    return NextResponse.json({
      success: true,
      users: staff.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        status: u.status,
        createdAt: u.createdAt,
        lastSeenAt: u.lastSeenAt,
        ownedCustomers: u._count.ownedCustomers,
      })),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Forbidden' },
      { status: error.message === 'FORBIDDEN' ? 403 : error.message === 'UNAUTHORIZED' ? 401 : 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requireSuperAdmin(req);
    const body = await req.json();
    const email = String(body.email || '')
      .toLowerCase()
      .trim();
    const password = String(body.password || '');
    const name = String(body.name || 'Admin').trim() || 'Admin';

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password min 6 characters' }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: 'Email already in use' }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });

    await prisma.adminAuditLog.create({
      data: {
        adminId: actor.userId,
        action: 'CREATE_SUB_ADMIN',
        targetType: 'USER',
        targetId: user.id,
        details: { email },
      },
    });

    return NextResponse.json({
      success: true,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed' },
      { status: error.message === 'FORBIDDEN' ? 403 : 400 }
    );
  }
}
