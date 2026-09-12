import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
import { prisma } from './prisma';

const JWT_SECRET = process.env.JWT_SECRET || 'google-flow-saas-fallback-secret-2026';

export interface AuthSession {
  userId: string;
  email: string;
  role: 'CUSTOMER' | 'ADMIN' | 'SUPER_ADMIN' | 'RESELLER';
  name?: string | null;
  sessionVersion?: number;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(session: AuthSession): string {
  return jwt.sign(session, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): AuthSession | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthSession;
  } catch {
    return null;
  }
}

export async function getSessionUser(request?: Request): Promise<AuthSession | null> {
  let token: string | undefined;

  // 1. Check Authorization Bearer header
  if (request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
  }

  // 2. Check Cookie header from request if present
  if (!token && request) {
    const cookieHeader = request.headers.get('cookie');
    if (cookieHeader) {
      const match = cookieHeader.match(/saas_token=([^;]+)/);
      if (match) token = match[1];
    }
  }

  // 3. Fallback to next/headers cookies()
  if (!token) {
    try {
      const cookieStore = await cookies();
      token = cookieStore.get('saas_token')?.value;
    } catch {}
  }

  if (!token) return null;

  const decoded = verifyToken(token);
  if (!decoded) return null;

  // Validate user still exists, is ACTIVE, and session version matches (single login)
  const user = await prisma.user.findUnique({
    where: { id: decoded.userId },
    select: {
      id: true,
      email: true,
      role: true,
      name: true,
      status: true,
      sessionVersion: true,
    },
  });

  if (!user || user.status === 'BANNED') return null;

  const tokenVersion = decoded.sessionVersion ?? 0;
  if (tokenVersion !== user.sessionVersion) return null;

  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    sessionVersion: user.sessionVersion,
  };
}

export async function requireAuth(request?: Request): Promise<AuthSession> {
  const session = await getSessionUser(request);
  if (!session) {
    throw new Error('UNAUTHORIZED');
  }
  return session;
}

export async function requireAdmin(request?: Request): Promise<AuthSession> {
  const session = await requireAuth(request);
  if (session.role !== 'ADMIN' && session.role !== 'SUPER_ADMIN') {
    throw new Error('FORBIDDEN');
  }
  return session;
}

export async function requireSuperAdmin(request?: Request): Promise<AuthSession> {
  const session = await requireAuth(request);
  if (session.role !== 'SUPER_ADMIN') {
    throw new Error('FORBIDDEN');
  }
  return session;
}

export async function requireReseller(request?: Request): Promise<AuthSession> {
  const session = await requireAuth(request);
  if (session.role !== 'RESELLER') {
    throw new Error('FORBIDDEN');
  }
  return session;
}

export async function getOrCreateStudioUser(request?: Request): Promise<AuthSession> {
  // 1. Check authenticated session
  const session = await getSessionUser(request);
  if (session) return session;

  // 2. Check if a guest studio_user cookie was passed in request
  let guestId: string | undefined;
  if (request) {
    const cookieHeader = request.headers.get('cookie');
    if (cookieHeader) {
      const match = cookieHeader.match(/(?:studio_user|guest_id)=([^;]+)/);
      if (match) guestId = match[1].trim();
    }
  }

  if (!guestId) {
    try {
      const cookieStore = await cookies();
      guestId = cookieStore.get('studio_user')?.value || cookieStore.get('guest_id')?.value;
    } catch {}
  }

  // 3. If guestId exists, find or create the user associated with that guest session
  if (guestId) {
    const guestEmail = `guest_${guestId.replace(/[^a-zA-Z0-9_-]/g, '')}@googleflow.ai`;
    const guestUser = await prisma.user.findUnique({
      where: { email: guestEmail },
      select: { id: true, email: true, role: true, name: true, status: true },
    });

    if (guestUser && guestUser.status !== 'BANNED') {
      return {
        userId: guestUser.id,
        email: guestUser.email,
        role: guestUser.role,
        name: guestUser.name,
      };
    }

    // Provision new guest user specifically for this browser session
    const passwordHash = await hashPassword('GoogleFlowGuest2026!');
    const newGuest = await prisma.user.create({
      data: {
        email: guestEmail,
        passwordHash,
        name: 'Studio Creator',
        role: 'CUSTOMER',
        status: 'ACTIVE',
      },
    });

    const { grantWelcomeCredits } = await import('./credits');
    await grantWelcomeCredits(newGuest.id);

    return {
      userId: newGuest.id,
      email: newGuest.email,
      role: newGuest.role,
      name: newGuest.name,
    };
  }

  // 4. Default fallback: create distinct guest user for this session
  const randomId = Math.random().toString(36).substring(2, 12);
  const guestEmail = `guest_${randomId}@googleflow.ai`;
  const passwordHash = await hashPassword('GoogleFlowGuest2026!');
  const newGuest = await prisma.user.create({
    data: {
      email: guestEmail,
      passwordHash,
      name: 'Studio Creator',
      role: 'CUSTOMER',
      status: 'ACTIVE',
    },
  });

  const { grantWelcomeCredits } = await import('./credits');
  await grantWelcomeCredits(newGuest.id);

  return {
    userId: newGuest.id,
    email: newGuest.email,
    role: newGuest.role,
    name: newGuest.name,
  };
}

