import { NextResponse } from 'next/server';
import { getSessionUser, hashPassword, verifyPassword } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: Request) {
  try {
    const session = await getSessionUser(req);
    if (!session) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
    return NextResponse.json({ success: true, user });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getSessionUser(req);
    if (!session) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }

    const body = await req.json();
    const name = body.name !== undefined ? String(body.name).trim() : undefined;
    const currentPassword = body.currentPassword ? String(body.currentPassword) : undefined;
    const newPassword = body.newPassword ? String(body.newPassword) : undefined;

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (user.email.startsWith('guest_') && user.email.endsWith('@googleflow.ai')) {
      return NextResponse.json(
        { error: 'Guest accounts cannot update profile. Please register a full account.' },
        { status: 400 }
      );
    }

    const data: { name?: string; passwordHash?: string } = {};
    if (name !== undefined) {
      if (name.length < 1) {
        return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
      }
      data.name = name;
    }

    if (newPassword) {
      if (!currentPassword) {
        return NextResponse.json({ error: 'Current password is required' }, { status: 400 });
      }
      if (newPassword.length < 8) {
        return NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 400 });
      }
      const ok = await verifyPassword(currentPassword, user.passwordHash);
      if (!ok) {
        return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
      }
      data.passwordHash = await hashPassword(newPassword);
    }

    const updated = await prisma.user.update({
      where: { id: session.userId },
      data,
      select: { id: true, email: true, name: true, role: true },
    });

    return NextResponse.json({ success: true, user: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 });
  }
}
