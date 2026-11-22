import { prisma } from './prisma';
import type { AuthSession } from './auth';

const KEY = 'ACCOUNTS_PAGE_ACCESS';

export type AccountsPageAccess = {
  /** ADMIN user ids allowed to open Provider Accounts (SUPER_ADMIN always allowed). */
  adminUserIds: string[];
};

const DEFAULTS: AccountsPageAccess = { adminUserIds: [] };

export async function getAccountsPageAccess(): Promise<AccountsPageAccess> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: KEY } });
    const raw = (row?.value as Record<string, unknown>) || {};
    const ids = Array.isArray(raw.adminUserIds)
      ? raw.adminUserIds.map((x) => String(x || '').trim()).filter(Boolean)
      : [];
    return { adminUserIds: [...new Set(ids)] };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveAccountsPageAccess(
  input: Partial<AccountsPageAccess>
): Promise<AccountsPageAccess> {
  const current = await getAccountsPageAccess();
  const next: AccountsPageAccess = {
    adminUserIds: Array.isArray(input.adminUserIds)
      ? [...new Set(input.adminUserIds.map((x) => String(x || '').trim()).filter(Boolean))]
      : current.adminUserIds,
  };
  await prisma.systemSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: next },
    update: { value: next },
  });
  return next;
}

/** SUPER_ADMIN always; ADMIN only if on allowlist. */
export async function canAccessProviderAccounts(session: {
  userId: string;
  role: string;
}): Promise<boolean> {
  if (session.role === 'SUPER_ADMIN') return true;
  if (session.role !== 'ADMIN') return false;
  const access = await getAccountsPageAccess();
  return access.adminUserIds.includes(session.userId);
}

export async function requireAccountsPageAccess(session: AuthSession): Promise<AuthSession> {
  const ok = await canAccessProviderAccounts(session);
  if (!ok) throw new Error('FORBIDDEN');
  return session;
}

export async function listAdminCandidates() {
  return prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
    select: { id: true, email: true, name: true, role: true },
    orderBy: [{ role: 'desc' }, { email: 'asc' }],
  });
}
