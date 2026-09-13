import { NextResponse } from 'next/server';
import { requireAdmin, requireSuperAdmin } from '@/lib/auth';
import {
  canAccessProviderAccounts,
  getAccountsPageAccess,
  listAdminCandidates,
  saveAccountsPageAccess,
} from '@/lib/accountsAccess';

/** Who can open Provider Accounts + current allowlist (SUPER_ADMIN manages list). */
export async function GET(req: Request) {
  try {
    const session = await requireAdmin(req);
    const [allowed, access, admins] = await Promise.all([
      canAccessProviderAccounts(session),
      getAccountsPageAccess(),
      session.role === 'SUPER_ADMIN' ? listAdminCandidates() : Promise.resolve([]),
    ]);
    return NextResponse.json({
      success: true,
      allowed,
      adminUserIds: access.adminUserIds,
      admins,
      isSuperAdmin: session.role === 'SUPER_ADMIN',
    });
  } catch (error: any) {
    const msg = error.message || 'Forbidden';
    return NextResponse.json(
      { error: msg },
      { status: msg === 'FORBIDDEN' || msg === 'UNAUTHORIZED' ? 403 : 500 }
    );
  }
}

/** SUPER_ADMIN only — set which ADMIN users can open /admin/accounts. */
export async function PUT(req: Request) {
  try {
    await requireSuperAdmin(req);
    const body = await req.json().catch(() => ({}));
    const adminUserIds = Array.isArray(body.adminUserIds) ? body.adminUserIds : [];
    const access = await saveAccountsPageAccess({ adminUserIds });
    return NextResponse.json({ success: true, adminUserIds: access.adminUserIds });
  } catch (error: any) {
    const msg = error.message || 'Forbidden';
    return NextResponse.json(
      { error: msg },
      { status: msg === 'FORBIDDEN' || msg === 'UNAUTHORIZED' ? 403 : 500 }
    );
  }
}
