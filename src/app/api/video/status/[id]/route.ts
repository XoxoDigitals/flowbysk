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

const PYTHON_WORKER_URL = process.env.PYTHON_WORKER_URL || 'http://127.0.0.1:8000';

async function logJobTerminal(
  job: {
    id: string;
    userId: string;
    prompt: string | null;
    parameters: unknown;
  },
  kind: 'complete' | 'failed',
  detail?: string
) {
  try {
    const params = (job.parameters as Record<string, any>) || {};
    const runId = String(params.run_id || job.id);
    const message =
      kind === 'failed'
        ? `Video failed: ${(detail || 'Generation failed').slice(0, 200)}`
        : `Video complete${detail ? ` (${detail})` : ''}: ${(job.prompt || 'video').slice(0, 80)}`;

    // One terminal event per run (overlapping status polls)
    const existing = await prisma.studioLog.findFirst({
      where: {
        runId,
        message: {
          startsWith: kind === 'failed' ? 'Video failed' : 'Video complete',
        },
        createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
      },
      select: { id: true },
    });
    if (existing) return;

    await createStudioLog({
      level: kind === 'failed' ? 'error' : 'info',
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
        const workerRes = await fetch(`${PYTHON_WORKER_URL}/api/video/status/${id}`);
        if (workerRes.ok) {
          const wData = await workerRes.json();
          return NextResponse.json(wData);
        }
      } catch {}
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

    if (
      refs.accountId &&
      refs.mediaId &&
      (job.status === JobStatus.GENERATING ||
        job.status === JobStatus.PREPARING ||
        job.status === JobStatus.CHECKING_STATUS ||
        job.status === JobStatus.RETRYING)
    ) {
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
      // skip → fall through to Python
    }

    try {
      const workerRes = await fetch(`${PYTHON_WORKER_URL}/api/video/status/${workerTaskId}`);
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
