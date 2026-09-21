import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword, signToken } from '@/lib/auth';
import { grantZeroPricePlanCredits } from '@/lib/credits';
import { getSiteSettings } from '@/lib/site-settings';
import { UserRole, UserStatus } from '@prisma/client';
import { rateLimit, clientIpFromHeaders } from '@/lib/rateLimit';
import { isValidEmail } from '@/lib/validate';

export async function POST(req: Request) {
  try {
    const ip = clientIpFromHeaders(req.headers);
    const limit = rateLimit(`register:${ip}`, { limit: 5, windowMs: 60_000 });
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many registration attempts. Please try again shortly.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(limit.retryAfterMs / 1000)) } }
      );
    }

    const settings = await getSiteSettings();
    if (!settings.allowSignups) {
      return NextResponse.json(
        { error: 'New registrations are currently closed.' },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => null);
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    const name = typeof body?.name === 'string' ? body.name.trim() : '';

    if (!isValidEmail(email) || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }
    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findUnique({
      where: { email },
    });

    if (existing) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        email,
        name: name || 'Creator',
        passwordHash,
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
      },
    });

    const freePlan = await prisma.plan.findUnique({ where: { name: 'Free' } });
    if (freePlan) {
      await prisma.subscription.create({
        data: {
          userId: user.id,
          planId: freePlan.id,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      // $0 plan → grant whatever Standard/Pro credits admin set on the plan
      await grantZeroPricePlanCredits(user.id, freePlan);
    }

    await prisma.project.create({
      data: {
        userId: user.id,
        name: 'Default Studio Project',
        description: 'Primary workspace for generating images and videos',
      },
    });

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      sessionVersion: user.sessionVersion ?? 0,
    });

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      message: 'Registration successful.',
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
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
