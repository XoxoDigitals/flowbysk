/**
 * Shared BiB/Flow media poll → terminal job update.
 * Used by /api/video/status and the server-side resume loop after BiB restarts.
 */

import { prisma } from '@/lib/prisma';
import { settleCredits, releaseCredits } from '@/lib/credits';
import { JobStatus, type GenerationJob } from '@prisma/client';
import { createStudioLog } from '@/lib/studioLogs';
import { bibVideoStatus, ensureBibAccountReady } from '@/lib/bib';
import { toUserFacingError } from '@/lib/userMessages';
import { noteUnusualActivityFailure } from '@/lib/unusualActivityProxyRotate';
import { recordJobProxyOutcome } from '@/lib/dataimpulse';

const FLOW_UUID = /^[a-f0-9-]{36}$/i;

export type BibPollOutcome =
  | { kind: 'completed'; url: string }
  | { kind: 'failed'; error: string }
  | { kind: 'processing'; progress?: number }
  | { kind: 'transient'; error: string }
  | { kind: 'skip'; reason: string };

export function extractJobBibRefs(job: {
  providerAccountId?: string | null;
  parameters?: unknown;
  outputMetadata?: unknown;
}): {
  mediaId: string | null;
  accountId: string | null;
  projectId: string | undefined;
} {
  const metadata = (job.outputMetadata as Record<string, any>) || {};
  const jobParams = (job.parameters as Record<string, any>) || {};
  const flowMediaId = String(
    metadata.bibMediaId ||
      jobParams.bibMediaId ||
      metadata.workerTaskId ||
      metadata.primary_media_id ||
      jobParams.primary_media_id ||
      ''
  ).trim();
  const mediaId = FLOW_UUID.test(flowMediaId) ? flowMediaId : null;
  const accountId =
    metadata.bibAccountId || jobParams.bibAccountId || job.providerAccountId || null;
  const projectId =
    metadata.bibProjectId ||
    jobParams.bibProjectId ||
    jobParams.flowProjectId ||
    undefined;
  return {
    mediaId,
    accountId: accountId ? String(accountId) : null,
    projectId: projectId ? String(projectId) : undefined,
  };
}

async function logJobTerminal(
  job: {
    id: string;
    userId: string;
    prompt: string | null;
    parameters: unknown;
    providerAccountId?: string | null;
    modelKey?: string | null;
    startedAt?: Date | null;
  },
  kind: 'complete' | 'failed',
  detail?: string
) {
  try {
    const params = (job.parameters as Record<string, any>) || {};
    const runId = String(params.run_id || job.id);
    const isI2V = !!(
      params.staged_id ||
      params.image_id ||
      params.first_frame_id ||
      params.last_frame_id ||
      params.first_frame_staged_id ||
      params.last_frame_staged_id ||
      params.frame_mode ||
      /i2v|bulki2v/i.test(String(params.source || ''))
    );

    const provider = job.providerAccountId
      ? await prisma.providerAccount.findUnique({
          where: { id: job.providerAccountId },
          select: { accountEmail: true },
        })
      : null;
    const user = await prisma.user.findUnique({
      where: { id: job.userId },
      select: { email: true },
    });

    if (kind === 'complete') {
      const { logGenerationComplete } = await import('@/lib/studioLogs');
      const started = job.startedAt ? new Date(job.startedAt).getTime() : 0;
      const durationSec =
        detail && /^\d+(?:\.\d+)?s$/i.test(String(detail).trim())
          ? Number(String(detail).replace(/s$/i, ''))
          : started > 0
            ? (Date.now() - started) / 1000
            : undefined;
      await logGenerationComplete({
        runId,
        userId: job.userId,
        userEmail: user?.email || null,
        flowEmail: provider?.accountEmail || null,
        kind: isI2V ? 'i2v' : 't2v',
        prompt: job.prompt,
        durationSec,
      });
      return;
    }

    const promptSlice = String(job.prompt || '').trim().slice(0, 80);
    const errSlice = String(detail || 'Generation failed').replace(/\s+/g, ' ').trim().slice(0, 120);
    const failLabel = isI2V ? 'I2V' : 'Video';
    const message = promptSlice
      ? `${failLabel} failed: ${errSlice} — ${promptSlice}`
      : `${failLabel} failed: ${errSlice}`;

    const existing = await prisma.studioLog.findFirst({
      where: {
        runId,
        OR: [
          { message: { startsWith: 'Video failed' } },
          { message: { startsWith: 'I2V failed' } },
        ],
        createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
      },
      select: { id: true },
    });
    if (existing) {
      if (provider?.accountEmail) {
        await prisma.studioLog
          .updateMany({
            where: { id: existing.id, flowEmail: null },
            data: { flowEmail: provider.accountEmail },
          })
          .catch(() => 0);
      }
      return;
    }

    await createStudioLog({
      level: 'error',
      message,
      source: 'generate',
      runId,
      userId: job.userId,
      userEmail: user?.email || null,
      flowEmail: provider?.accountEmail || null,
    });
  } catch (err) {
    console.warn('[jobBibPoll] studio log terminal write failed', err);
  }
}

/** Move GENERATING/RETRYING → CHECKING_STATUS when mediaId already exists. */
export async function normalizeToCheckingStatus(job: GenerationJob): Promise<GenerationJob> {
  const { mediaId } = extractJobBibRefs(job);
  if (
    !mediaId ||
    (job.status !== JobStatus.GENERATING &&
      job.status !== JobStatus.RETRYING &&
      job.status !== JobStatus.PREPARING)
  ) {
    return job;
  }
  const updated = await prisma.generationJob.updateMany({
    where: {
      id: job.id,
      status: {
        in: [JobStatus.GENERATING, JobStatus.RETRYING, JobStatus.PREPARING],
      },
    },
    data: {
      status: JobStatus.CHECKING_STATUS,
      progress: Math.max(job.progress || 0, 20),
      errorMessage: null,
    },
  });
  if (updated.count > 0) {
    return (await prisma.generationJob.findUnique({ where: { id: job.id } })) || job;
  }
  return job;
}

/**
 * Poll BiB for a job that already has a Flow mediaId.
 * Applies COMPLETED/FAILED side effects once (status guards).
 */
export async function pollJobBibStatus(job: GenerationJob): Promise<BibPollOutcome> {
  if (
    job.status === JobStatus.COMPLETED ||
    job.status === JobStatus.FAILED ||
    job.status === JobStatus.CANCELLED ||
    job.status === JobStatus.IN_QUEUE
  ) {
    return { kind: 'skip', reason: job.status };
  }

  const refs = extractJobBibRefs(job);
  if (!refs.mediaId || !refs.accountId) {
    return { kind: 'skip', reason: 'no bibMediaId/account' };
  }

  job = await normalizeToCheckingStatus(job);

  try {
    const bib = await bibVideoStatus({
      accountId: refs.accountId,
      mediaId: refs.mediaId,
      projectId: refs.projectId,
    });
    const mediaUrl = bib.videoUrl || bib.imageUrl || bib.url || null;

    if (bib.status === 'FAILED') {
      const failMsg = String(bib.error || 'Generation failed in Veo').slice(0, 300);
      await applyBibPollFailure(job, failMsg);
      return { kind: 'failed', error: failMsg };
    }

    if (bib.status === 'COMPLETED' && mediaUrl) {
      await applyBibPollSuccess(job, mediaUrl, refs.mediaId);
      return { kind: 'completed', url: mediaUrl };
    }

    const progress = Math.min(90, (job.progress || 15) + 5);
    await prisma.generationJob.updateMany({
      where: {
        id: job.id,
        status: {
          in: [
            JobStatus.GENERATING,
            JobStatus.PREPARING,
            JobStatus.CHECKING_STATUS,
            JobStatus.RETRYING,
          ],
        },
      },
      data: { progress },
    });
    return { kind: 'processing', progress };
  } catch (bibErr: any) {
    const msg = String(bibErr?.message || bibErr);
    if (
      /browser not launched|Target closed|not attached|startScreencast|CDP|ECONNREFUSED|fetch failed|retryable|PROCESSING|Waiting for browser/i.test(
        msg
      )
    ) {
      try {
        const acc = await prisma.providerAccount.findUnique({
          where: { id: refs.accountId },
          select: {
            id: true,
            maxParallelLimit: true,
            flowProjectIds: true,
            profileDir: true,
          },
        });
        if (acc) {
          try {
            await ensureBibAccountReady(acc);
          } catch (e: any) {
            console.warn('[jobBibPoll] ensure launch:', e?.message || e);
          }
        }
      } catch {
        /* ignore */
      }
      return { kind: 'transient', error: msg };
    }
    return { kind: 'transient', error: msg };
  }
}

/** Force-fail a mediaId job (timeout / resume sweeper). */
export async function failJobFromResume(job: GenerationJob, reason: string) {
  await applyBibPollFailure(job, reason);
}

async function applyBibPollFailure(job: GenerationJob, failMsg: string) {
  const userMsg = toUserFacingError(failMsg, failMsg);
  const updateRes = await prisma.generationJob.updateMany({
    where: {
      id: job.id,
      status: {
        in: [
          JobStatus.GENERATING,
          JobStatus.PREPARING,
          JobStatus.CHECKING_STATUS,
          JobStatus.RETRYING,
        ],
      },
    },
    data: {
      status: JobStatus.FAILED,
      progress: 0,
      errorMessage: userMsg,
      completedAt: new Date(),
      expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
    },
  });
  if (updateRes.count === 0) return;

  noteUnusualActivityFailure(failMsg, job.providerAccountId || undefined, job.id).catch(
    (e) => console.warn('[proxy-rotate]', e)
  );
  try {
    recordJobProxyOutcome(job, 'fail');
  } catch {
    /* ignore */
  }
  await releaseCredits(job.userId, job.walletType, job.creditCost, job.id, failMsg);
  const { checkAndDispatchNextJobs } = await import('@/lib/queue');
  checkAndDispatchNextJobs(job.userId).catch(console.error);
  await logJobTerminal(job, 'failed', failMsg);
  try {
    const { drainPendingProxyRelaunch } = await import('@/lib/unusualActivityProxyRotate');
    await drainPendingProxyRelaunch(job.providerAccountId);
  } catch {
    /* ignore */
  }
}

async function applyBibPollSuccess(job: GenerationJob, mediaUrl: string, flowMediaId: string) {
  const isImage =
    /\/image\//i.test(mediaUrl) ||
    /pix|narwhal|harbor|gem_pix|nano/i.test(String(job.modelKey || ''));
  const updateRes = await prisma.generationJob.updateMany({
    where: { id: job.id, status: { not: JobStatus.COMPLETED } },
    data: {
      status: JobStatus.COMPLETED,
      progress: 100,
      outputMediaUrl: mediaUrl,
      completedAt: new Date(),
      errorMessage: null,
    },
  });
  if (updateRes.count === 0) return;

  const shortId = job.id.substring(0, 8);
  const urlPath = String(mediaUrl || '').split('?')[0];
  try {
    recordJobProxyOutcome(job, 'ok');
  } catch {
    /* ignore */
  }
  const existingAsset = await prisma.asset.findFirst({
    where: {
      userId: job.userId,
      OR: [
        { fileName: { contains: shortId } },
        { url: mediaUrl },
        { storagePath: mediaUrl },
        ...(urlPath
          ? [{ url: { startsWith: urlPath } }, { storagePath: { startsWith: urlPath } }]
          : []),
      ],
    },
  });
  if (!existingAsset) {
    await prisma.asset.create({
      data: {
        userId: job.userId,
        projectId: job.projectId,
        fileName: isImage ? `i2i_${shortId}.png` : `veo_${shortId}.mp4`,
        fileType: isImage ? 'image' : 'video',
        mimeType: isImage ? 'image/png' : 'video/mp4',
        fileSize: 1024 * 1024,
        storagePath: mediaUrl,
        url: mediaUrl,
        upstreamAssetId: flowMediaId,
        expiresAt: job.expiresAt,
      },
    });
  }
  await settleCredits(job.userId, job.walletType, job.creditCost, job.id);
  const { checkAndDispatchNextJobs } = await import('@/lib/queue');
  checkAndDispatchNextJobs(job.userId).catch(console.error);
  const started = job.startedAt ? new Date(job.startedAt).getTime() : 0;
  const dur = started > 0 ? `${((Date.now() - started) / 1000).toFixed(1)}s` : undefined;
  await logJobTerminal(job, 'complete', dur);
  try {
    const { drainPendingProxyRelaunch } = await import('@/lib/unusualActivityProxyRotate');
    await drainPendingProxyRelaunch(job.providerAccountId);
  } catch {
    /* ignore */
  }
}
