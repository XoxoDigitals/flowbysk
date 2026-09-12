import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPassword, signToken } from '@/lib/auth';
import { allocateProviderAccountForUser } from '@/lib/allocation';
import { rateLimit, clientIpFromHeaders } from '@/lib/rateLimit';
import { isValidEmail } from '@/lib/validate';

export async function POST(req: Request) {
  try {
    const ip = clientIpFromHeaders(req.headers);
    const limit = rateLimit(`login:${ip}`, { limit: 10, windowMs: 60_000 });
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again shortly.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(limit.retryAfterMs / 1000)) } }
      );
    }

    const body = await req.json().catch(() => null);
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body?.password === 'string' ? body.password : '';

    if (!isValidEmail(email) || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
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

    const lastIp = ip && ip !== 'unknown' ? ip : null;

    // Bump sessionVersion so any previous JWT becomes invalid
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        sessionVersion: { increment: 1 },
        lastSeenAt: new Date(),
        ...(lastIp ? { lastIp } : {}),
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
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
