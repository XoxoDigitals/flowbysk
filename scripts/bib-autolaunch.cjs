/**
 * Auto-launch READY / previously logged-in BiB provider accounts.
 * Usage: node scripts/bib-autolaunch.mjs
 */
const { PrismaClient, BrowserStatus } = require('@prisma/client');

const BIB = (process.env.BIB_WORKER_URL || 'http://127.0.0.1:8010').replace(/\/$/, '');
const prisma = new PrismaClient();

async function waitBib(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BIB}/health`);
      if (r.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function main() {
  const ok = await waitBib();
  if (!ok) {
    console.error('[bib-autolaunch] BiB worker not reachable at', BIB);
    process.exit(1);
  }

  const accounts = await prisma.providerAccount.findMany({
    where: {
      OR: [
        { browserStatus: BrowserStatus.READY },
        { browserStatus: BrowserStatus.NEEDS_LOGIN },
        { profileDir: { not: null } },
      ],
    },
    select: {
      id: true,
      maxParallelLimit: true,
      flowProjectIds: true,
      profileDir: true,
      browserStatus: true,
      label: true,
    },
  });

  // Also include any account that has a profile folder on disk
  const fs = require('fs');
  const path = require('path');
  const root = path.join(process.cwd(), 'data', 'bib-profiles');
  if (fs.existsSync(root)) {
    for (const name of fs.readdirSync(root)) {
      if (!accounts.some((a) => a.id === name)) {
        const row = await prisma.providerAccount.findUnique({
          where: { id: name },
          select: {
            id: true,
            maxParallelLimit: true,
            flowProjectIds: true,
            profileDir: true,
            browserStatus: true,
            label: true,
          },
        });
        if (row) accounts.push(row);
      }
    }
  }

  if (!accounts.length) {
    console.log('[bib-autolaunch] No accounts to launch');
    return;
  }

  console.log(`[bib-autolaunch] Launching ${accounts.length} account(s)…`);
  const payload = {
    accounts: accounts.map((a) => ({
      id: a.id,
      maxSlots: a.maxParallelLimit || 5,
      projectIds: Array.isArray(a.flowProjectIds) ? a.flowProjectIds : [],
      profileDir: a.profileDir,
    })),
  };

  const res = await fetch(`${BIB}/bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  console.log('[bib-autolaunch] result:', JSON.stringify(data, null, 2));

  for (const r of data.results || []) {
    if (!r.ok) continue;
    const browserStatus =
      r.status === 'READY'
        ? BrowserStatus.READY
        : r.status === 'NEEDS_LOGIN'
          ? BrowserStatus.NEEDS_LOGIN
          : BrowserStatus.STARTING;
    await prisma.providerAccount.update({
      where: { id: r.id },
      data: {
        browserStatus,
        bibLastSeenAt: new Date(),
        flowProjectIds: Array.isArray(r.projectIds) ? r.projectIds : undefined,
        accountEmail: r.email || undefined,
      },
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
