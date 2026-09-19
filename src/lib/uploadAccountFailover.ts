import type { WalletType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { selectProviderAccountForJobDetailed } from '@/lib/routing';
import { prepareProviderWorkerSession } from '@/lib/providerSession';
import { createStudioLog } from '@/lib/studioLogs';

/**
 * After Flow image-upload exhaustion on one Google account, pick another READY
 * account, rebind the job, prepare BiB session, and log the failover.
 * Returns null when no alternate account is available.
 */
export async function switchJobToAlternateProviderAccount(opts: {
  userId: string;
  walletType: WalletType;
  modelKey: string;
  jobId: string;
  excludeAccountId: string;
  runId?: string | null;
  userEmail?: string | null;
  prompt?: string | null;
  failedEmail?: string | null;
}): Promise<{
  provider: any;
  cookies?: string;
  projectId?: string;
} | null> {
  const excludeAccountId = String(opts.excludeAccountId || '').trim();
  if (!excludeAccountId) return null;

  const { account: next } = await selectProviderAccountForJobDetailed(
    opts.walletType,
    opts.modelKey,
    opts.userId,
    null,
    { excludeAccountIds: [excludeAccountId] }
  );
  if (!next?.id || next.id === excludeAccountId) return null;

  await prisma.generationJob.update({
    where: { id: opts.jobId },
    data: { providerAccountId: next.id },
  });

  const sessionPrep = await prepareProviderWorkerSession(next, opts.userId);
  const emailA = String(opts.failedEmail || excludeAccountId).slice(0, 64);
  const emailB = String(next.accountEmail || next.id).slice(0, 64);
  const promptSlice = String(opts.prompt || '').trim().slice(0, 60);
  const message = promptSlice
    ? `Upload failed on ${emailA}; retrying on ${emailB}… — ${promptSlice}`
    : `Upload failed on ${emailA}; retrying on ${emailB}…`;

  await createStudioLog({
    level: 'info',
    source: 'generate',
    message,
    runId: String(opts.runId || opts.jobId),
    userId: opts.userId,
    userEmail: opts.userEmail,
    flowEmail: next.accountEmail || null,
  }).catch(() => 0);

  console.info(
    `[upload-failover] job=${opts.jobId.slice(0, 8)} ${emailA} → ${emailB}`
  );

  return {
    provider: next,
    cookies: sessionPrep.cookies || next.cookies || undefined,
    projectId: sessionPrep.projectId,
  };
}
