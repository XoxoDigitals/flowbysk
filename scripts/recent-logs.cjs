const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const logs = await p.studioLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: {
      createdAt: true,
      level: true,
      source: true,
      message: true,
      runId: true,
      userEmail: true,
      flowEmail: true,
    },
  });
  for (const l of logs.reverse()) {
    console.log(
      `${l.createdAt.toISOString()} [${l.level}] ${l.source} | ${l.message.slice(0, 160)}`
    );
  }
  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
