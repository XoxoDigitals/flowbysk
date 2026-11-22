import type { WalletType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { selectProviderAccountForJobDetailed } from '@/lib/routing';
import { prepareProviderWorkerSession } from '@/lib/providerSession';
import { createStudioLog } from '@/lib/studioLogs';

export type AlternateProviderSession = {
  provider: any;
  cookies?: string;
  projectId?: string;
};

/**
 * Pick another READY Google account (excluding the failed one) and prepare BiB session.
 * Does not require a generation job — used by character portrait uploads too.
 */
export async function pickAlternateProviderAccount(opts: {
  userId: string;
  walletType: WalletType;
  modelKey: string;
  excludeAccountId: string;
  failedEmail?: string | null;
  userEmail?: string | null;
  runId?: string | null;
  prompt?: string | null;
  logSource?: string;
}): Promise<AlternateProviderSession | null> {
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

  const sessionPrep = await prepareProviderWorkerSession(next, opts.userId);
  const emailA = String(opts.failedEmail || excludeAccountId).slice(0, 64);
  const emailB = String(next.accountEmail || next.id).slice(0, 64);
  const promptSlice = String(opts.prompt || '').trim().slice(0, 60);
  const message = promptSlice
    ? `Upload failed on ${emailA}; retrying on ${emailB}… — ${promptSlice}`
    : `Upload failed on ${emailA}; retrying on ${emailB}…`;

  await createStudioLog({
    level: 'info',
    source: opts.logSource || 'generate',
    message,
    runId: String(opts.runId || next.id),
    userId: opts.userId,
    userEmail: opts.userEmail,
    flowEmail: next.accountEmail || null,
  }).catch(() => 0);

  console.info(`[upload-failover] ${emailA} → ${emailB}`);

  return {
    provider: next,
    cookies: sessionPrep.cookies || next.cookies || undefined,
    projectId: sessionPrep.projectId,
  };
}

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
}): Promise<AlternateProviderSession | null> {
  const alt = await pickAlternateProviderAccount({
    userId: opts.userId,
    walletType: opts.walletType,
    modelKey: opts.modelKey,
    excludeAccountId: opts.excludeAccountId,
    failedEmail: opts.failedEmail,
    userEmail: opts.userEmail,
    runId: opts.runId || opts.jobId,
    prompt: opts.prompt,
    logSource: 'generate',
  });
  if (!alt?.provider?.id) return null;

  await prisma.generationJob.update({
    where: { id: opts.jobId },
    data: { providerAccountId: alt.provider.id },
  });

  console.info(
    `[upload-failover] job=${opts.jobId.slice(0, 8)} → ${String(alt.provider.accountEmail || alt.provider.id).slice(0, 64)}`
  );

  return alt;
}
