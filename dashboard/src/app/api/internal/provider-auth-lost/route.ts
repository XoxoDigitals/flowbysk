import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { handleProviderAuthLost } from '@/lib/allocation';
import { UserRole } from '@prisma/client';
import { isInternalRequestAllowed } from '@/lib/internalAuth';

/**
 * Called by flow-bib health loop when a Google session dies.
 * Header: x-internal-secret must match INTERNAL_API_SECRET or JWT_SECRET
 * (or the request must originate from localhost, as a dev convenience).
 */
export async function POST(req: Request) {
  if (!isInternalRequestAllowed(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const accountId = String(body.accountId || '').trim();
  if (!accountId) {
    return NextResponse.json({ error: 'accountId required' }, { status: 400 });
  }

  const exists = await prisma.providerAccount.findUnique({
    where: { id: accountId },
    select: { id: true },
  });
  if (!exists) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  const result = await handleProviderAuthLost(
    accountId,
    typeof body.detail === 'string' ? body.detail : body.detail?.lastError || 'Google session lost'
  );

  return NextResponse.json({ success: true, ...result });
}

/** Admin manual trigger of failover (optional). */
export async function PUT(req: Request) {
  const session = await getOrCreateStudioUser(req);
  if (session.role !== UserRole.ADMIN && session.role !== UserRole.SUPER_ADMIN) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const accountId = String(body.accountId || '').trim();
  if (!accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 });
  const result = await handleProviderAuthLost(accountId, 'Admin-triggered failover');
  return NextResponse.json({ success: true, ...result });
}
