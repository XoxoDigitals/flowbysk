import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { settleCredits, releaseCredits } from '@/lib/credits';
import { checkAndDispatchNextJobs } from '@/lib/queue';
import { JobStatus } from '@prisma/client';
import { createStudioLog } from '@/lib/studioLogs';
import { toUserFacingError } from '@/lib/userMessages';
import { noteUnusualActivityFailure } from '@/lib/unusualActivityProxyRotate';
import { recordJobProxyOutcome } from '@/lib/dataimpulse';
import { extractJobBibRefs, pollJobBibStatus } from '@/lib/jobBibPoll';
import { fetchWithRetry, formatWorkerFetchError, PYTHON_WORKER_URL } from '@/lib/worker';

function isBibRoutedJob(job: {
  providerAccountId?: string | null;
  parameters?: unknown;
  outputMetadata?: unknown;
}): boolean {
  const refs = extractJobBibRefs(job);
  if (refs.accountId) return true;
  const params = (job.parameters as Record<string, any>) || {};
  const meta = (job.outputMetadata as Record<string, any>) || {};
  if (params.bibAccountId || params.bibMediaId || meta.bibAccountId || meta.bibMediaId) {
    return true;
  }
  // BiB queue path stamps wireModel / source without Python workerTaskId
  if (params.wireModel && !meta.workerTaskId && job.providerAccountId) return true;
  return false;
}

async function logJobTerminal(
  job: {
    id: string;
    userId: string;
    prompt: string | null;
    parameters: unknown;
    providerAccountId?: string | null;
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

    if (kind === 'complete') {
      const { logGenerationComplete } = await import('@/lib/studioLogs');
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

    const failLabel = isI2V ? 'I2V' : 'Video';
    const message = `${failLabel} failed: ${(detail || 'Generation failed').slice(0, 200)}`;

    // One terminal event per run (overlapping status polls)
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
    if (existing) return;

    await createStudioLog({
      level: 'error',
      message,
      source: 'generate',
      runId,
      userId: job.userId,
    });
  } catch (err) {
    console.warn('studio log terminal write failed', err);
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    try {
      const { startJobStatusResumeLoop } = await import('@/lib/jobStatusResume');
      startJobStatusResumeLoop();
    } catch {
      /* ignore */
    }

    const { id } = await params;

    // 1. Query database for job
    const job = await prisma.generationJob.findUnique({
      where: { id },
    });

    if (!job) {
      // Fallback: check if id is Python worker task id or query worker directly
      try {
        const workerRes = await fetchWithRetry(
          `${PYTHON_WORKER_URL}/api/video/status/${id}`,
          { timeoutMs: 10_000, retries: 2 }
        );
        if (workerRes.ok) {
          const wData = await workerRes.json();
          return NextResponse.json(wData);
        }
        // 404 from Python = unknown id — return Next 404, not worker-down
      } catch (e) {
        console.warn(
          '[video/status] python fallback:',
          formatWorkerFetchError(e)
        );
      }
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (job.status === JobStatus.CANCELLED) {
      return NextResponse.json({
        success: true,
        cancelled: true,
        asset: {
          id: job.id,
          status: 'CANCELLED',
          progress: 0,
          url: '',
          error: job.errorMessage || 'Cancelled by user',
        },
      });
    }

    if (job.status === JobStatus.COMPLETED) {
      const started = job.startedAt ? new Date(job.startedAt).getTime() : 0;
      const dur = started > 0 ? `${((Date.now() - started) / 1000).toFixed(1)}s` : undefined;
      await logJobTerminal(job, 'complete', dur);
      return NextResponse.json({
        success: true,
        asset: {
          id: job.id,
          status: 'COMPLETED',
          progress: 100,
          url: job.outputMediaUrl,
          prompt: job.prompt,
          parameters: job.parameters,
        },
      });
    }

    if (job.status === JobStatus.IN_QUEUE) {
      return NextResponse.json({
        success: true,
        asset: {
          id: job.id,
          status: 'IN_QUEUE',
          progress: 0,
          url: '',
          prompt: job.prompt,
          error: job.errorMessage || 'Waiting in queue...',
          inQueue: true,
        },
      });
    }

    if (job.status === JobStatus.FAILED) {
      return NextResponse.json({
        success: false,
        asset: {
          id: job.id,
          status: 'FAILED',
          progress: 0,
          error: job.errorMessage || 'Generation failed',
        },
      });
    }

    // 2. Prefer BiB poll whenever we have a provider account + Flow media UUID
    const metadata = (job.outputMetadata as Record<string, any>) || {};
    const workerTaskId = metadata.workerTaskId || job.id;
    const refs = extractJobBibRefs(job);
    const bibRouted = isBibRoutedJob(job);
    const activeJob =
      job.status === JobStatus.GENERATING ||
      job.status === JobStatus.PREPARING ||
      job.status === JobStatus.CHECKING_STATUS ||
      job.status === JobStatus.RETRYING;

    if (refs.accountId && refs.mediaId && activeJob) {
      const outcome = await pollJobBibStatus(job);
      if (outcome.kind === 'failed') {
        return NextResponse.json({
          success: false,
          asset: {
            id: job.id,
            status: 'FAILED',
            progress: 0,
            url: '',
            error: toUserFacingError(outcome.error, outcome.error),
            prompt: job.prompt,
          },
        });
      }
      if (outcome.kind === 'completed') {
        return NextResponse.json({
          success: true,
          asset: {
            id: job.id,
            status: 'COMPLETED',
            progress: 100,
            url: outcome.url,
            prompt: job.prompt,
          },
        });
      }
      if (outcome.kind === 'processing') {
        return NextResponse.json({
          success: true,
          asset: {
            id: job.id,
            status: 'PROCESSING',
            progress: outcome.progress ?? Math.min(90, (job.progress || 15) + 5),
            url: '',
            prompt: job.prompt,
          },
        });
      }
      if (outcome.kind === 'transient') {
        return NextResponse.json({
          success: true,
          asset: {
            id: job.id,
            status: 'PROCESSING',
            progress: Math.min(90, Math.max(5, job.progress || 15)),
            url: '',
            prompt: job.prompt,
            error: 'Waiting for browser…',
            inQueue: true,
          },
        });
      }
      // skip with BiB refs — still do not fall through to Python
    }

    // BiB-routed job waiting for mediaId / browser — never poll Python (404 / unreachable noise)
    if (bibRouted && activeJob) {
      return NextResponse.json({
        success: true,
        asset: {
          id: job.id,
          status: 'PROCESSING',
          progress: Math.min(90, Math.max(5, job.progress || 15)),
          url: '',
          prompt: job.prompt,
          error: refs.mediaId ? 'Waiting for browser…' : 'Submitting…',
          inQueue: true,
        },
      });
    }

    try {
      const workerRes = await fetchWithRetry(
        `${PYTHON_WORKER_URL}/api/video/status/${workerTaskId}`,
        { timeoutMs: 15_000, retries: 2 }
      );
      if (workerRes.ok) {
        const workerData = await workerRes.json();
        const workerAsset = workerData.asset || {};

        if (workerAsset.status === 'COMPLETED' && workerAsset.url) {
          const updateRes = await prisma.generationJob.updateMany({
            where: {
              id: job.id,
              status: { not: JobStatus.COMPLETED },
            },
            data: {
              status: JobStatus.COMPLETED,
              progress: 100,
              outputMediaUrl: workerAsset.url,
              completedAt: new Date(),
            },
          });

          if (updateRes.count > 0) {
            const shortId = job.id.substring(0, 8);
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
                  { url: workerAsset.url },
                  { storagePath: workerAsset.url },
                ],
              },
            });

            if (!existingAsset) {
              await prisma.asset.create({
                data: {
                  userId: job.userId,
                  projectId: job.projectId,
                  fileName: `veo_${shortId}.mp4`,
                  fileType: 'video',
                  mimeType: 'video/mp4',
                  fileSize: 1024 * 1024,
                  storagePath: workerAsset.url,
                  url: workerAsset.url,
                  expiresAt: job.expiresAt,
                },
              });
            }

            await settleCredits(job.userId, job.walletType, job.creditCost, job.id);
            checkAndDispatchNextJobs(job.userId).catch(console.error);
            const started = job.startedAt ? new Date(job.startedAt).getTime() : 0;
            const dur =
              started > 0 ? `${((Date.now() - started) / 1000).toFixed(1)}s` : undefined;
            await logJobTerminal(job, 'complete', dur);
            try {
              const { drainPendingProxyRelaunch } = await import(
                '@/lib/unusualActivityProxyRotate'
              );
              await drainPendingProxyRelaunch(job.providerAccountId);
            } catch {
              /* ignore */
            }
          }

          return NextResponse.json({
            success: true,
            asset: {
              id: job.id,
              status: 'COMPLETED',
              progress: 100,
              url: workerAsset.url,
              prompt: job.prompt,
            },
          });
        }

        if (workerAsset.status === 'FAILED') {
          const failMsg = workerAsset.error || 'Generation failed upstream';
          noteUnusualActivityFailure(
            failMsg,
            job.providerAccountId || undefined,
            job.id
          ).catch((e) => console.warn('[proxy-rotate]', e));
          try {
            recordJobProxyOutcome(job, 'fail');
          } catch {
            /* ignore */
          }
          await prisma.generationJob.update({
            where: { id: job.id },
            data: {
              status: JobStatus.FAILED,
              errorMessage: failMsg,
              completedAt: new Date(),
              expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
            },
          });
          await releaseCredits(
            job.userId,
            job.walletType,
            job.creditCost,
            job.id,
            failMsg
          );
          checkAndDispatchNextJobs(job.userId).catch(console.error);
          await logJobTerminal(job, 'failed', failMsg);

          return NextResponse.json({
            success: false,
            asset: {
              id: job.id,
              status: 'FAILED',
              progress: 0,
              error: workerAsset.error || 'Generation failed upstream',
            },
          });
        }

        const currentProgress = Math.min(95, (job.progress || 25) + 5);
        await prisma.generationJob.update({
          where: { id: job.id },
          data: { progress: currentProgress },
        });

        return NextResponse.json({
          success: true,
          asset: {
            id: job.id,
            status: 'PROCESSING',
            progress: workerAsset.progress || currentProgress,
            url: '',
            prompt: job.prompt,
          },
        });
      }
    } catch {
      // If worker check fails, simulate incremental progress
    }

    const currentProgress = Math.min(95, (job.progress || 20) + 10);
    await prisma.generationJob.update({
      where: { id: job.id },
      data: { progress: currentProgress },
    });

    return NextResponse.json({
      success: true,
      asset: {
        id: job.id,
        status: 'PROCESSING',
        progress: currentProgress,
        url: '',
        prompt: job.prompt,
      },
    });
  } catch (err: any) {
    console.error('Error fetching video status:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
