import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isInternalRequestAllowed } from '@/lib/internalAuth';

/**
 * Authoritative roster of BiB accounts that flow-bib should launch/restore.
 * Sourced from the DB (ProviderAccount) so flow-bib no longer relies on its
 * drift-prone local bib-autolaunch.json. Secret-gated (called by flow-bib on
 * startup with x-internal-secret). Mirrors the selection in
 * scripts/bib-autolaunch.cjs: accounts that are READY / NEEDS_LOGIN or have a
 * saved profile directory.
 */
export async function GET(req: Request) {
  if (!isInternalRequestAllowed(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const rows = await prisma.providerAccount.findMany({
      where: {
        OR: [
          { browserStatus: 'READY' },
          { browserStatus: 'NEEDS_LOGIN' },
          { profileDir: { not: null } },
        ],
      },
      select: {
        id: true,
        maxParallelLimit: true,
        flowProjectIds: true,
        profileDir: true,
      },
    });
    const accounts = rows.map((r) => ({
      id: r.id,
      maxSlots: r.maxParallelLimit || 5,
      projectIds: Array.isArray(r.flowProjectIds) ? (r.flowProjectIds as string[]) : [],
      profileDir: r.profileDir || undefined,
    }));
    return NextResponse.json({ ok: true, accounts });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'roster failed' },
      { status: 500 }
    );
  }
}
