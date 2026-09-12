import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword, signToken } from '@/lib/auth';
import { grantZeroPricePlanCredits } from '@/lib/credits';
import { getSiteSettings } from '@/lib/site-settings';
import { UserRole, UserStatus } from '@prisma/client';

export async function POST(req: Request) {
  try {
    const settings = await getSiteSettings();
    if (!settings.allowSignups) {
      return NextResponse.json(
        { error: 'New registrations are currently closed.' },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { email, password, name } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
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
        email: email.toLowerCase().trim(),
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
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
