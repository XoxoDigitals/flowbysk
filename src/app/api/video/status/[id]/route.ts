import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { settleCredits, releaseCredits } from '@/lib/credits';
import { checkAndDispatchNextJobs } from '@/lib/queue';
import { JobStatus } from '@prisma/client';
import { createStudioLog } from '@/lib/studioLogs';
import { bibVideoStatus } from '@/lib/bib';

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

    if (job.status === JobStatus.CANCELLED) {
      return NextResponse.json({
        success: false,
        asset: {
          id: job.id,
          status: 'CANCELLED',
          progress: 0,
          error: job.errorMessage || 'Stop by user',
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

    // 2. If status is GENERATING or PREPARING, poll BiB (preferred) or Python worker
    const metadata = (job.outputMetadata as Record<string, any>) || {};
    const workerTaskId = metadata.workerTaskId || job.id;

    // Prefer BiB poll whenever we have a provider account + Flow media UUID.
    // Ingredients / I2V / Python-async jobs often only store workerTaskId — without
    // bibMediaId — and Python OAuth is frequently stale, so BiB is the reliable path.
    const flowMediaId = String(
      metadata.bibMediaId || metadata.workerTaskId || metadata.primary_media_id || ''
    ).trim();
    const looksLikeFlowUuid = /^[a-f0-9-]{36}$/i.test(flowMediaId);
    const providerAccountId = metadata.bibAccountId || job.providerAccountId || null;
    const flowProjectId =
      metadata.bibProjectId ||
      (job.parameters as any)?.flowProjectId ||
      undefined;

    if (
      providerAccountId &&
      looksLikeFlowUuid &&
      (job.status === JobStatus.GENERATING ||
        job.status === JobStatus.PREPARING ||
        job.status === JobStatus.CHECKING_STATUS)
    ) {
      try {
        const bib = await bibVideoStatus({
          accountId: String(providerAccountId),
          mediaId: flowMediaId,
          projectId: flowProjectId || undefined,
        });
        const mediaUrl = bib.videoUrl || bib.imageUrl || bib.url;
        if (bib.status === 'COMPLETED' && mediaUrl) {
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
            },
          });
          if (updateRes.count > 0) {
            const shortId = job.id.substring(0, 8);
            const urlPath = String(mediaUrl || '').split('?')[0];
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
            checkAndDispatchNextJobs(job.userId).catch(console.error);
            const started = job.startedAt ? new Date(job.startedAt).getTime() : 0;
            const dur =
              started > 0 ? `${((Date.now() - started) / 1000).toFixed(1)}s` : undefined;
            await logJobTerminal(job, 'complete', dur);
          }
          return NextResponse.json({
            success: true,
            asset: {
              id: job.id,
              status: 'COMPLETED',
              progress: 100,
              url: mediaUrl,
              prompt: job.prompt,
            },
          });
        }

        return NextResponse.json({
          success: true,
          asset: {
            id: job.id,
            status: 'PROCESSING',
            progress: Math.min(90, (job.progress || 15) + 5),
            url: '',
            prompt: job.prompt,
          },
        });
      } catch (bibErr: any) {
        console.warn('[video/status] BiB poll failed:', bibErr?.message || bibErr);
        // fall through to Python
      }
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

          // If this request was the one that marked the job COMPLETED, persist the asset and settle credits
          if (updateRes.count > 0) {
            const shortId = job.id.substring(0, 8);
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
          await prisma.generationJob.update({
            where: { id: job.id },
            data: {
              status: JobStatus.FAILED,
              errorMessage: workerAsset.error || 'Generation failed upstream',
              completedAt: new Date(),
              expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
            },
          });
          await releaseCredits(
            job.userId,
            job.walletType,
            job.creditCost,
            job.id,
            workerAsset.error || 'Generation failed upstream'
          );
          checkAndDispatchNextJobs(job.userId).catch(console.error);
          await logJobTerminal(job, 'failed', workerAsset.error || 'Generation failed upstream');

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

        // Still rendering
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
