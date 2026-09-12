const accountId = 'c7cf5f65-2862-40a3-a6df-6778827e99e7';
const BIB = (process.env.BIB_WORKER_URL || 'http://127.0.0.1:8010').replace(/\/$/, '');
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || process.env.JWT_SECRET || '';
const jsonHeaders = {
  'Content-Type': 'application/json',
  ...(INTERNAL_SECRET ? { 'x-internal-secret': INTERNAL_SECRET } : {}),
};
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  console.log('launch…');
  const launch = await (await fetch(`${BIB}/accounts/${accountId}/launch`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ maxSlots: 25 }),
  })).json();
  console.log('launch status', launch.status, 'auth', launch.authenticated);

  console.log('scrape/ensure…');
  const ensured = await fetch(`${BIB}/accounts/${accountId}/ensure-projects`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ maxSlots: 25 }),
  });
  const body = await ensured.json();
  console.log('ensure http', ensured.status, 'projects', body.projectCount, body.projectIds?.slice?.(0, 8), body.error || '');

  if (Array.isArray(body.projectIds) && body.projectIds.length) {
    await p.providerAccount.update({
      where: { id: accountId },
      data: {
        flowProjectIds: body.projectIds,
        activeProjectId: body.projectIds[0],
        projectUrl: `https://flow.google.com/project/${body.projectIds[0]}`,
        browserStatus: 'READY',
        status: 'HEALTHY',
      },
    });
    console.log('prisma synced', body.projectIds.length);
  }
  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
