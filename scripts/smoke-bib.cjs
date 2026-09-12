const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const acc = await p.providerAccount.create({
    data: {
      label: 'BiB Test Account',
      accountEmail: 'bib-test@example.com',
      cookies: '',
      status: 'UNAVAILABLE',
      maxParallelLimit: 3,
      browserStatus: 'STOPPED',
    },
  });
  console.log(JSON.stringify({ id: acc.id, label: acc.label }));

  // Launch via BiB
  const launch = await fetch(`http://127.0.0.1:8010/accounts/${acc.id}/launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maxSlots: 3 }),
  });
  const launchBody = await launch.json();
  console.log('launch', launch.status, launchBody.status, launchBody.running);

  const st = await (await fetch(`http://127.0.0.1:8010/accounts/${acc.id}/status`)).json();
  console.log('status', st.status, 'auth', st.authenticated);

  // Auth-lost webhook (simulate) — create second healthy account first
  const healthy = await p.providerAccount.create({
    data: {
      label: 'BiB Healthy Peer',
      accountEmail: 'peer@example.com',
      cookies: '',
      status: 'HEALTHY',
      maxParallelLimit: 5,
      browserStatus: 'READY',
    },
  });

  const user = await p.user.create({
    data: {
      email: `bib-user-${Date.now()}@test.local`,
      passwordHash: 'x',
      assignedProviderAccountId: acc.id,
      providerAssignmentManual: false,
    },
  });

  const secret =
    process.env.INTERNAL_API_SECRET ||
    process.env.JWT_SECRET ||
    'google-flow-saas-super-secret-jwt-key-2026-production-ready';

  // Mark wasReady path: update acc then call redistribute directly via webhook after marking
  await p.providerAccount.update({
    where: { id: acc.id },
    data: { status: 'HEALTHY', browserStatus: 'READY' },
  });

  const lost = await fetch('http://127.0.0.1:3000/api/internal/provider-auth-lost', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
    body: JSON.stringify({ accountId: acc.id, detail: 'test logout' }),
  });
  const lostBody = await lost.json();
  console.log('failover', lost.status, lostBody);

  const movedUser = await p.user.findUnique({
    where: { id: user.id },
    select: { assignedProviderAccountId: true },
  });
  console.log(
    'user reassigned',
    movedUser.assignedProviderAccountId === healthy.id,
    'to',
    movedUser.assignedProviderAccountId
  );

  // Disconnect browser
  const disc = await fetch(`http://127.0.0.1:8010/accounts/${acc.id}/disconnect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  console.log('disconnect', disc.status, await disc.json());

  // Cleanup test rows (keep profiles optional)
  await p.user.delete({ where: { id: user.id } }).catch(() => null);
  await p.providerAccount.delete({ where: { id: acc.id } }).catch(() => null);
  await p.providerAccount.delete({ where: { id: healthy.id } }).catch(() => null);
  console.log('cleanup ok');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
