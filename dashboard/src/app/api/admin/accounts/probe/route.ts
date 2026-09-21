import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { requireAccountsPageAccess } from '@/lib/accountsAccess';
import { bibAccountStatus } from '@/lib/bib';
import { prisma } from '@/lib/prisma';

/**
 * POST /api/admin/accounts/probe
 *
 * BiB-only: accepts { accountId } and returns live BiB status.
 * Cookie-string probing is permanently disabled.
 */
export async function POST(req: Request) {
  try {
    const session = await requireAdmin(req);
    await requireAccountsPageAccess(session);
    const body = await req.json().catch(() => ({}));

    // Legacy cookie probe — permanently disabled
    if (body.cookies && body.cookies.trim()) {
      return NextResponse.json(
        {
          error: 'Cookie probe is disabled. Use BiB (Browser-in-Browser) login instead.',
          disabled: true,
        },
        { status: 410 }
      );
    }

    const { accountId } = body;
    if (!accountId) {
      return NextResponse.json(
        { error: 'accountId is required' },
        { status: 400 }
      );
    }

    const account = await prisma.providerAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const live = await bibAccountStatus(accountId);

    return NextResponse.json({
      success: true,
      accountId,
      bibStatus: live?.status || 'UNKNOWN',
      running: live?.running ?? false,
      email: live?.email || account.accountEmail,
      projectIds: live?.projectIds || [],
      lastError: live?.lastError || account.bibLastError,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to get BiB account status' },
      { status: error.message === 'FORBIDDEN' ? 403 : 500 }
    );
  }
}
