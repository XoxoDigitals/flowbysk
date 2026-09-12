import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPassword, signToken } from '@/lib/auth';
import { allocateProviderAccountForUser } from '@/lib/allocation';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    if (user.status === 'BANNED') {
      let msg = 'Your account has been suspended by administration.';
      if (user.role === 'RESELLER') {
        const rp = await prisma.resellerProfile.findUnique({
          where: { userId: user.id },
          select: { isActive: true, deactivationMessage: true },
        });
        if (rp?.deactivationMessage) msg = rp.deactivationMessage;
      } else if (user.createdByResellerId) {
        const rp = await prisma.resellerProfile.findUnique({
          where: { userId: user.createdByResellerId },
          select: { isActive: true, deactivationMessage: true },
        });
        if (rp && !rp.isActive && rp.deactivationMessage) {
          msg = rp.deactivationMessage;
        }
      }
      return NextResponse.json({ error: msg }, { status: 403 });
    }

    if (user.role === 'RESELLER') {
      const rp = await prisma.resellerProfile.findUnique({
        where: { userId: user.id },
        select: { isActive: true, deactivationMessage: true },
      });
      if (rp && !rp.isActive) {
        return NextResponse.json(
          {
            error:
              rp.deactivationMessage ||
              'Your reseller account has been deactivated. Contact your admin.',
          },
          { status: 403 }
        );
      }
    }

    // Active customers under an inactive reseller: allow login but surface notice
    let accountNotice: string | null = null;
    if (user.role === 'CUSTOMER' && user.createdByResellerId) {
      const rp = await prisma.resellerProfile.findUnique({
        where: { userId: user.createdByResellerId },
        select: { isActive: true, deactivationMessage: true },
      });
      if (rp && !rp.isActive && rp.deactivationMessage) {
        accountNotice = rp.deactivationMessage;
      }
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const forwarded = req.headers.get('x-forwarded-for');
    const ip = (forwarded?.split(',')[0] || req.headers.get('x-real-ip') || '').trim() || null;

    // Bump sessionVersion so any previous JWT becomes invalid
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        sessionVersion: { increment: 1 },
        lastSeenAt: new Date(),
        ...(ip ? { lastIp: ip } : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        sessionVersion: true,
      },
    });

    const token = signToken({
      userId: updated.id,
      email: updated.email,
      role: updated.role,
      name: updated.name,
      sessionVersion: updated.sessionVersion,
    });

    let assignedAccountId: string | null = null;
    try {
      assignedAccountId = await allocateProviderAccountForUser(updated.id);
    } catch (allocErr) {
      console.warn('Login allocation failed:', allocErr);
    }

    const response = NextResponse.json({
      success: true,
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        role: updated.role,
        assignedProviderAccountId: assignedAccountId,
      },
      notice: accountNotice,
    });

    response.cookies.set('saas_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    });

    return response;
  } catch (error: any) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
