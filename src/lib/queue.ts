import { prisma } from './prisma';
import { BrowserStatus, JobStatus, WalletType } from '@prisma/client';
import { settleCredits, releaseCredits } from './credits';
import { selectProviderAccountForJobDetailed } from './routing';
import { releaseProviderAccountIfIdle } from './allocation';
import { workerIdentityHeaders } from './worker';
import { bibGenerateImage, bibGenerateVideo, ensureBibAccountReady } from './bib';
import { isSystemGenerationError, withSystemErrorRetry } from './systemErrorRetry';
import { createStudioLog, markRunCancelled } from './studioLogs';
import { resolveMediaExpiresAt } from './mediaExpiry';
import {
  resolveImageFrontendModel,
  resolveImageWireModel,
  resolveVideoFrontendModel,
  resolveVideoWireModel,
  nextImageWireModel,
  isImageModelQuotaError,
} from './modelWire';
import { resolveTargetFlowProject } from './flowProjects';
import {
  downgradeExpiredSubscription,
  resolveEffectiveParallel,
} from '@/lib/customDeals';
import { toUserFacingQueueMessage, toUserFacingError } from '@/lib/userMessages';
import { resetUnusualActivityStreak, isUnusualActivityError } from '@/lib/unusualActivityProxyRotate';
import { recordProxyOutcome, jobKindFromModelKey, recordJobProxyOutcome } from '@/lib/dataimpulse';
import { isThrottleGenerationError } from '@/lib/systemErrorRetry';

const PYTHON_WORKER_URL = process.env.PYTHON_WORKER_URL || 'http://127.0.0.1:8000';

async function isJobCancelled(jobId: string): Promise<boolean> {
  const job = await prisma.generationJob.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  return job?.status === JobStatus.CANCELLED;
}

export async function getUserPlanLimit(userId: string): Promise<number> {
  let sub = await prisma.subscription.findFirst({
    where: { userId, status: 'ACTIVE' },
    include: { plan: true },
  });
  if (sub && sub.currentPeriodEnd.getTime() < Date.now()) {
    sub = await downgradeExpiredSubscription(userId);
  }
  return resolveEffectiveParallel(sub);
}

export async function countUserActiveJobs(userId: string): Promise<number> {
  return prisma.generationJob.count({
    where: {
      userId,
      status: { in: [JobStatus.PREPARING, JobStatus.GENERATING, JobStatus.RETRYING] },
    },
  });
}

export async function checkAndDispatchNextJobs(userId?: string) {
  // Global admin pause — keep jobs IN_QUEUE but do not start them
  try {
    const { getStudioQueueControl } = await import('./studioTools');
    const q = await getStudioQueueControl();
    if (q.paused) return;
  } catch {
    /* ignore — settings unavailable */
  }

  // 1. If userId provided, check user's capacity
  const targetUserIds: string[] = [];
  if (userId) {
    targetUserIds.push(userId);
  } else {
    // Find all users who currently have jobs in queue
    const queuedUsers = await prisma.generationJob.findMany({
      where: { status: JobStatus.IN_QUEUE },
      select: { userId: true },
      distinct: ['userId'],
    });
    targetUserIds.push(...queuedUsers.map((u) => u.userId));
  }

  for (const uid of targetUserIds) {
    const limit = await getUserPlanLimit(uid);
    const active = await countUserActiveJobs(uid);
    const availableSlots = limit - active;

    if (availableSlots > 0) {
      // Fetch oldest pending jobs for this user
      const nextJobs = await prisma.generationJob.findMany({
        where: { userId: uid, status: JobStatus.IN_QUEUE },
        orderBy: { submittedAt: 'asc' },
        take: availableSlots,
      });

      for (const job of nextJobs) {
        // Run dispatch asynchronously without blocking
        dispatchJob(job.id).catch((err) => {
          console.error(`Error during dispatch of job ${job.id}:`, err);
        });
      }
    }
  }
}

export async function dispatchJob(jobId: string) {
  const job = await prisma.generationJob.findUnique({
    where: { id: jobId },
    include: { user: true, project: true },
  });

  if (!job || job.status !== JobStatus.IN_QUEUE) {
    return;
  }

  // 1. Select suitable Provider Account (sticky user slots ≠ plan parallel gens)
  const { account: provider, reason: providerReason } = await selectProviderAccountForJobDetailed(
    job.walletType,
    job.modelKey,
    job.userId,
    job.user.assignedProviderAccountId
  );

  if (!provider) {
    // Keep in queue waiting for provider browser / sticky user capacity
    const internal =
      providerReason ||
      'In Queue: Waiting for a Google provider account (BiB Launch / free user slot).';
    console.warn(`[dispatchJob ${jobId}] ${internal}`);
    await prisma.generationJob.update({
      where: { id: jobId },
      data: {
        errorMessage: toUserFacingQueueMessage(internal),
      },
    });
    return;
  }

  // 2. Mark job as PREPARING
  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: JobStatus.PREPARING,
      providerAccountId: provider.id,
      startedAt: new Date(),
      errorMessage: null,
    },
  });

  // 3. Trigger asynchronous generation call to the execution worker
  executeGenerationAsync(job.id, provider.id).catch(async (err) => {
    console.error(`Execution failed for job ${job.id}:`, err);
    await handleJobFailure(job.id, err instanceof Error ? err.message : 'Unknown generation failure');
  });
}

async function executeGenerationAsync(jobId: string, providerAccountId: string) {
  const job = await prisma.generationJob.findUnique({
    where: { id: jobId },
    include: { project: true },
  });

  if (!job) return;
  if (job.status === JobStatus.CANCELLED) return;

  const provider = await prisma.providerAccount.findUnique({
    where: { id: providerAccountId },
  });

  if (!provider) {
    throw new Error('Assigned provider account was not found');
  }

  // Mark status GENERATING
  await prisma.generationJob.update({
    where: { id: jobId },
    data: { status: JobStatus.GENERATING, progress: 25 },
  });

  // Call the Python FastAPI execution engine (one automatic retry on System Error)
  let attemptImageModel: string | null = null;
  try {
    await withSystemErrorRetry(
      async () => {
        if (await isJobCancelled(job.id)) {
          throw new Error('Stop by user');
        }
        const params = (job.parameters as Record<string, any>) || {};
        const isVideo = job.modelKey.includes('veo') || job.modelKey.includes('omni');
        const isI2V =
          isVideo &&
          !!(
            params.staged_id ||
            params.image_id ||
            params.first_frame_id ||
            params.last_frame_id ||
            params.first_frame_staged_id ||
            params.last_frame_staged_id ||
            params.frame_mode
          );
        const endpoint = isI2V
          ? '/api/generate/image-to-video'
          : isVideo
            ? '/api/generate/video'
            : '/api/generate/image';

        const targetProjectId = await resolveTargetFlowProject(
          {
            id: provider.id,
            flowProjectIds: provider.flowProjectIds,
            activeProjectId: provider.activeProjectId,
            projectUrl: provider.projectUrl,
          },
          {
            preferredUserId: job.userId,
            assignedUserIds: (
              await prisma.user.findMany({
                where: { assignedProviderAccountId: provider.id },
                select: { id: true },
              })
            ).map((u) => u.id),
          }
        );

        const feRaw = String(params.model || job.modelKey || '').trim();
        const feModel = isVideo
          ? resolveVideoFrontendModel(feRaw)
          : resolveImageFrontendModel(feRaw);
        const wireModel = isVideo
          ? resolveVideoWireModel(feRaw, {
              mode: isI2V ? 'i2v' : 't2v',
              duration: Number(params.duration) || 8,
              aspectRatio: String(params.aspect_ratio || '16:9'),
            })
          : resolveImageWireModel(feRaw);
        const useBib =
          provider.browserStatus === BrowserStatus.READY ||
          (Array.isArray(provider.flowProjectIds) && (provider.flowProjectIds as string[]).length > 0);
        // BiB needs remapped wire keys for all BiB paths (including I2V)
        if (!isVideo) {
          if (!attemptImageModel) attemptImageModel = useBib ? wireModel : feModel;
        }
        const workerModel = isVideo
          ? useBib
            ? wireModel
            : feModel
          : attemptImageModel || wireModel;

        if (targetProjectId) {
          await prisma.generationJob.update({
            where: { id: job.id },
            data: {
              parameters: {
                ...params,
                model: feModel,
                wireModel,
                flowProjectId: targetProjectId,
              },
            },
          });
        }

        console.info(
          `[queue] job=${job.id} FE=${feModel} → wire=${wireModel} via ${useBib ? 'BiB' : 'Python'} (${isI2V ? 'i2v' : isVideo ? 't2v' : 'image'}) project=${targetProjectId || 'none'}`
        );

        if (useBib) {
          await ensureBibAccountReady({
            id: provider.id,
            maxParallelLimit: provider.maxParallelLimit,
            flowProjectIds: provider.flowProjectIds,
            profileDir: provider.profileDir,
          });
          if (isVideo) {
            const aspectMap: Record<string, number> = { '16:9': 2, '9:16': 1, '1:1': 1 };
            const first =
              params.first_frame_id || params.image_id || params.staged_id || undefined;
            const last = params.last_frame_id || undefined;
            const dual =
              first &&
              last &&
              String(first) !== String(last) &&
              (params.frame_mode === 'first_and_last' || !!params.last_frame_id);
            // Dual frames → ingredients-style multi-ref (imageIds), never StartImage endImageId
            const imageIds = dual
              ? [String(first), String(last)]
              : Array.isArray(params.image_ids)
                ? params.image_ids
                : undefined;
            const bibData = await bibGenerateVideo({
              accountId: provider.id,
              mode: dual || isI2V ? (dual ? 'r2v' : 'i2v') : 't2v',
              prompt: job.prompt,
              videoModel: workerModel,
              aspect: aspectMap[String(params.aspect_ratio || '16:9')] || 2,
              projectId: targetProjectId,
              imageId: dual ? String(first) : first || undefined,
              imageIds,
              waitForCompletion: false,
            });
            const mediaUrl = bibData.videoUrl || bibData.url;
            if (mediaUrl) {
              await handleJobSuccess(job.id, mediaUrl, bibData);
            } else if (bibData.mediaId) {
              await prisma.generationJob.update({
                where: { id: job.id },
                data: {
                  status: JobStatus.CHECKING_STATUS,
                  progress: 20,
                  parameters: {
                    ...params,
                    model: feModel,
                    wireModel,
                    flowProjectId: targetProjectId,
                    bibMediaId: bibData.mediaId,
                    bibAccountId: provider.id,
                    bibProjectId: targetProjectId,
                  },
                  outputMetadata: {
                    bibMediaId: bibData.mediaId,
                    bibAccountId: provider.id,
                    bibProjectId: targetProjectId,
                  },
                },
              });
            } else {
              throw new Error((bibData as any).error || 'BiB returned no video URL/mediaId');
            }
            return;
          }
          const bibData = await bibGenerateImage({
            accountId: provider.id,
            prompt: job.prompt,
            model: workerModel,
            aspectRatio: String(params.aspect_ratio || '16:9'),
            projectId: targetProjectId,
            imageId: params.image_id || undefined,
            imageIds: Array.isArray(params.image_ids) ? params.image_ids : undefined,
          });
          const mediaUrl = bibData.imageUrl || bibData.url || bibData.assets?.[0]?.url;
          if (mediaUrl) {
            await handleJobSuccess(job.id, mediaUrl, bibData);
          } else if (bibData.mediaId) {
            await prisma.generationJob.update({
              where: { id: job.id },
              data: {
                status: JobStatus.CHECKING_STATUS,
                progress: 20,
                parameters: {
                  ...params,
                  model: feModel,
                  wireModel,
                  flowProjectId: targetProjectId,
                  bibMediaId: bibData.mediaId,
                  bibAccountId: provider.id,
                  bibProjectId: targetProjectId,
                },
                outputMetadata: {
                  bibMediaId: bibData.mediaId,
                  bibAccountId: provider.id,
                  bibProjectId: targetProjectId,
                },
              },
            });
          } else {
            throw new Error((bibData as any).error || 'BiB returned no image URL/mediaId');
          }
          return;
        }

        // Python fallback only when BiB is not available
        const payload = isI2V
          ? {
              prompt: job.prompt,
              aspect_ratio: params.aspect_ratio || '16:9',
              duration: params.duration || 8,
              seed: params.seed,
              model: workerModel,
              frame_mode: params.frame_mode || 'first_only',
              staged_id: params.staged_id || undefined,
              image_id: params.image_id || undefined,
              first_frame_id: params.first_frame_id || undefined,
              last_frame_id: params.last_frame_id || undefined,
              first_frame_staged_id: params.first_frame_staged_id || undefined,
              last_frame_staged_id: params.last_frame_staged_id || undefined,
              project_id: targetProjectId,
              cookies: provider.cookies || undefined,
              run_id: params.run_id || job.id,
            }
          : isVideo
            ? {
                prompt: job.prompt,
                aspect_ratio: params.aspect_ratio || '16:9',
                duration: params.duration || 8,
                seed: params.seed,
                model: workerModel,
                project_id: targetProjectId,
                cookies: provider.cookies || undefined,
                run_id: params.run_id || job.id,
              }
            : {
                prompt: job.prompt,
                aspect_ratio: params.aspect_ratio || '16:9',
                seed: params.seed,
                num_images: 1,
                model: workerModel,
                project_id: targetProjectId,
                cookies: provider.cookies || undefined,
                run_id: params.run_id || job.id,
              };

        const user = await prisma.user.findUnique({
          where: { id: job.userId },
          select: { id: true, email: true },
        });

        const response = await fetch(`${PYTHON_WORKER_URL}${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...workerIdentityHeaders(
              user
                ? {
                    userId: user.id,
                    email: user.email,
                    runId: (job.parameters as any)?.run_id || job.id,
                  }
                : { runId: job.id }
            ),
          },
          body: JSON.stringify(payload),
        });

        if (await isJobCancelled(job.id)) {
          throw new Error('Stop by user');
        }

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Worker HTTP ${response.status}: ${errText.substring(0, 200)}`);
        }

        const data = await response.json();
        const mediaUrl =
          data.url ||
          data.video_url ||
          data.image_url ||
          (data.assets && data.assets[0]?.url) ||
          (data.images && data.images[0]?.url) ||
          (data.asset && data.asset.url);

        const workerAsset = data.asset || data;
        const workerStatus = workerAsset.status || data.status;
        const workerTaskId = workerAsset.id || data.id || data.task_id;

        if (mediaUrl && (workerStatus === 'COMPLETED' || !workerStatus)) {
          await handleJobSuccess(job.id, mediaUrl, data);
          return;
        }

        if (workerStatus === 'FAILED') {
          const failMsg = workerAsset.error || data.error || 'Generation failed upstream';
          // Throw system failures so withSystemErrorRetry can attempt once more.
          if (isSystemGenerationError(failMsg)) {
            throw new Error(failMsg);
          }
          await handleJobFailure(job.id, failMsg);
          return;
        }

        // Asynchronous rendering in progress
        await prisma.generationJob.update({
          where: { id: job.id },
          data: {
            status: JobStatus.GENERATING,
            progress: workerAsset.progress || 35,
            outputMetadata: {
              ...((job.outputMetadata as any) || {}),
              workerTaskId: workerTaskId,
              ...data,
            },
          },
        });
      },
      {
        label: `queue-job:${job.id}`,
        delayMs: 1800,
        throttleDelaysMs: [10000, 20000],
        providerAccountId: provider.id,
        jobId: job.id,
        shouldContinue: async () => !(await isJobCancelled(job.id)),
        onRetry: async (err) => {
          if (isImageModelQuotaError(err) && attemptImageModel) {
            const prev = attemptImageModel;
            attemptImageModel = nextImageWireModel(attemptImageModel);
            console.warn(
              `[queue-job:${job.id}] daily quota on ${prev} — retry with next image model ${attemptImageModel}`
            );
          }
          if (await isJobCancelled(job.id)) return;
          await prisma.generationJob.update({
            where: { id: job.id },
            data: {
              status: JobStatus.RETRYING,
              progress: 20,
              errorMessage: 'Retrying after system error…',
            },
          });
        },
      }
    );
  } catch (err: any) {
    if (/stop by user|cancelled by user/i.test(String(err?.message || ''))) {
      return;
    }
    if (await isJobCancelled(job.id)) return;
    console.error(`Worker generation failed for job ${job.id}:`, err.message);
    await handleJobFailure(job.id, err.message || 'Generation failed');
  }
}

export async function handleJobSuccess(jobId: string, outputUrl: string, metadata: any) {
  const job = await prisma.generationJob.findUnique({
    where: { id: jobId },
  });
  if (!job) return;
  // User Stop already cancelled — do not revive into gallery / charge settle.
  if (job.status === JobStatus.CANCELLED) {
    return;
  }

  const now = new Date();
  // Prefer Google CDN Expires= on the media URL; fall back to 24h retention clock.
  const expiresAt =
    resolveMediaExpiresAt(outputUrl, null) ||
    new Date(now.getTime() + 24 * 60 * 60 * 1000);

  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: JobStatus.COMPLETED,
      progress: 100,
      outputMediaUrl: outputUrl,
      outputMetadata: metadata,
      completedAt: now,
      expiresAt: expiresAt,
    },
  });

  resetUnusualActivityStreak();

  try {
    recordJobProxyOutcome(job, 'ok');
  } catch {
    /* ignore */
  }

  // Persist into prisma.asset so media gallery and projects find it in DB
  const isVideo = job.modelKey.includes('veo') || job.modelKey.includes('omni');
  const isJpg = outputUrl.includes('.jpg') || outputUrl.includes('.jpeg');
  const ext = isVideo ? 'mp4' : (isJpg ? 'jpg' : 'png');
  const mime = isVideo ? 'video/mp4' : (isJpg ? 'image/jpeg' : 'image/png');
  const shortId = job.id.substring(0, 8);
  const urlPath = String(outputUrl || '').split('?')[0];
  try {
    const existingAsset = await prisma.asset.findFirst({
      where: {
        userId: job.userId,
        OR: [
          { fileName: { contains: shortId } },
          { url: outputUrl },
          { storagePath: outputUrl },
          ...(urlPath ? [{ url: { startsWith: urlPath } }, { storagePath: { startsWith: urlPath } }] : []),
        ],
      },
      select: { id: true },
    });
    if (!existingAsset) {
      await prisma.asset.create({
        data: {
          userId: job.userId,
          projectId: job.projectId,
          fileName: `${job.modelKey}_${shortId}.${ext}`,
          fileType: isVideo ? 'video' : 'image',
          mimeType: mime,
          fileSize: 1024 * 1024,
          storagePath: outputUrl,
          url: outputUrl,
          expiresAt,
        },
      });
    }
  } catch (assetErr) {
    console.warn('Failed to save asset record in DB:', assetErr);
  }

  // Settle reserved credits into permanent spend
  await settleCredits(job.userId, job.walletType, job.creditCost, job.id);

  try {
    const { drainPendingProxyRelaunch } = await import('./unusualActivityProxyRotate');
    await drainPendingProxyRelaunch(job.providerAccountId);
  } catch {
    /* ignore */
  }

  try {
    const { createStudioLog } = await import('./studioLogs');
    const params = (job.parameters as Record<string, any>) || {};
    const runId = String(params.run_id || job.id);
    const started = job.startedAt ? new Date(job.startedAt).getTime() : 0;
    const dur = started > 0 ? `${((Date.now() - started) / 1000).toFixed(1)}s` : undefined;
    const existing = await prisma.studioLog.findFirst({
      where: {
        runId,
        message: { startsWith: 'Video complete' },
        createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
      },
      select: { id: true },
    });
    if (!existing) {
      await createStudioLog({
        level: 'info',
        source: 'generate',
        message: `Video complete${dur ? ` (${dur})` : ''}: ${(job.prompt || 'video').slice(0, 80)}`,
        runId,
        userId: job.userId,
      });
    }
  } catch (logErr) {
    console.warn('[queue] terminal studio log failed', logErr);
  }

  // Auto-dispatch next queued job for this user or others
  checkAndDispatchNextJobs(job.userId).catch(console.error);

  // Free Google account slot when queue is empty and user is offline
  releaseProviderAccountIfIdle(job.userId).catch(() => false);
}

export async function handleJobFailure(jobId: string, errorMessage: string) {
  const job = await prisma.generationJob.findUnique({
    where: { id: jobId },
  });
  if (!job) return;
  if (job.status === JobStatus.CANCELLED) {
    return;
  }

  // User Stop must never inflate FAILED / failure-rate metrics
  if (/stop by user|cancelled by user|canceled by user/i.test(String(errorMessage || ''))) {
    await prisma.generationJob.update({
      where: { id: jobId },
      data: {
        status: JobStatus.CANCELLED,
        errorMessage: /stop by user/i.test(String(errorMessage || ''))
          ? 'Stop by user'
          : 'Cancelled by user',
        completedAt: new Date(),
        progress: 0,
      },
    });
    await releaseCredits(job.userId, job.walletType, job.creditCost, job.id, 'User cancelled');
    checkAndDispatchNextJobs(job.userId).catch(console.error);
    releaseProviderAccountIfIdle(job.userId).catch(() => false);
    return;
  }

  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: JobStatus.FAILED,
      errorMessage: toUserFacingError(errorMessage),
      completedAt: new Date(),
      // Failed cards auto-purge after 4h (see retention.ts)
      expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
    },
  });

  console.error(`[jobFailure ${jobId}]`, errorMessage);

  try {
    const unusual = isUnusualActivityError(errorMessage);
    const throttle = isThrottleGenerationError(errorMessage);
    recordJobProxyOutcome(
      job,
      unusual ? 'unusual' : throttle ? 'throttle' : 'fail'
    );
  } catch {
    /* ignore */
  }

  // Unusual streak is counted inside withSystemErrorRetry (each attempt).

  // Release customer reserved credits
  await releaseCredits(job.userId, job.walletType, job.creditCost, job.id, errorMessage);

  // Auto-dispatch next queued job for this user
  checkAndDispatchNextJobs(job.userId).catch(console.error);

  releaseProviderAccountIfIdle(job.userId).catch(() => false);

  try {
    const { drainPendingProxyRelaunch } = await import('./unusualActivityProxyRotate');
    await drainPendingProxyRelaunch(job.providerAccountId);
  } catch {
    /* ignore */
  }
}

export async function cancelJob(
  jobId: string,
  userId: string,
  opts?: { force?: boolean; skipDispatch?: boolean }
) {
  const job = await prisma.generationJob.findUnique({
    where: { id: jobId },
  });

  if (!job || job.userId !== userId) {
    throw new Error('Job not found or access denied');
  }

  if (job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED || job.status === JobStatus.CANCELLED) {
    return { success: false, message: `Job is already in terminal state: ${job.status}` };
  }

  const inFlight =
    job.status === JobStatus.PREPARING ||
    job.status === JobStatus.GENERATING ||
    job.status === JobStatus.RETRYING;

  // Default: only IN_QUEUE is cancellable. Force=true (Storyteller Stop) also abandons in-flight.
  if (inFlight && !opts?.force) {
    throw new Error('Cannot cancel: generation request has already been submitted to Google Flow.');
  }

  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: JobStatus.CANCELLED,
      errorMessage: opts?.force ? 'Stop by user' : 'Cancelled by user',
      completedAt: new Date(),
      progress: 0,
    },
  });

  // Stop studio-log tracking for this run (no more retry / reCAPTCHA events).
  const runId = String((job.parameters as any)?.run_id || job.id || '').trim();
  if (runId) markRunCancelled(runId);
  try {
    await createStudioLog({
      level: 'info',
      message: opts?.force ? 'Stop by user' : 'Cancelled by user',
      source: 'cancel',
      runId: runId || null,
      userId: userId,
    });
  } catch (_) {
    /* ignore log write failures */
  }

  // Release reserved credits immediately
  await releaseCredits(job.userId, job.walletType, job.creditCost, job.id, 'User cancelled');

  if (!opts?.skipDispatch) {
    checkAndDispatchNextJobs(userId).catch(console.error);
  }

  return { success: true, forced: !!inFlight };
}

/** Cancel pending jobs scoped by source / ids / runIds. Never cancels unrelated Studio jobs. */
export async function cancelPendingJobs(
  userId: string,
  opts?: { source?: string; jobIds?: string[]; runIds?: string[] }
) {
  const idSet = new Set((opts?.jobIds || []).filter(Boolean).map(String));
  const runSet = new Set((opts?.runIds || []).filter(Boolean).map(String));
  const source = (opts?.source || '').trim();

  if (!idSet.size && !runSet.size && !source) {
    return { success: true, cancelled: 0, forced: 0, total: 0 };
  }

  const pending = await prisma.generationJob.findMany({
    where: {
      userId,
      status: {
        in: [
          JobStatus.IN_QUEUE,
          JobStatus.PREPARING,
          JobStatus.GENERATING,
          JobStatus.RETRYING,
        ],
      },
    },
    select: { id: true, status: true, parameters: true },
  });

  const toCancel = pending.filter((job) => {
    if (idSet.has(job.id)) return true;
    const params = (job.parameters as Record<string, unknown>) || {};
    if (runSet.size && params.run_id && runSet.has(String(params.run_id))) return true;
    if (source && params.source === source) return true;
    return false;
  });

  let cancelled = 0;
  let forced = 0;
  for (const job of toCancel) {
    try {
      const result = await cancelJob(job.id, userId, { force: true, skipDispatch: true });
      if (result?.success) {
        cancelled += 1;
        if (result.forced) forced += 1;
      }
    } catch (err) {
      console.warn(`cancelPendingJobs failed for ${job.id}:`, err);
    }
  }

  // After scoped cancel, resume other (non-storyteller) queued jobs if slots free
  checkAndDispatchNextJobs(userId).catch(console.error);
  releaseProviderAccountIfIdle(userId).catch(() => false);

  return { success: true, cancelled, forced, total: toCancel.length };
}

/** @deprecated Use cancelPendingJobs with an explicit source/ids filter. */
export async function cancelAllPendingJobs(userId: string) {
  return cancelPendingJobs(userId, { source: 'storyteller' });
}

/**
 * Re-queue a failed/cancelled (or stuck) job and dispatch it.
 * Used by Admin Studio Logs Retry.
 */
export async function retryJob(jobId: string) {
  const job = await prisma.generationJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error('Job not found');

  const terminal =
    job.status === JobStatus.FAILED ||
    job.status === JobStatus.CANCELLED ||
    job.status === JobStatus.COMPLETED ||
    job.status === JobStatus.EXPIRED;

  if (job.status === JobStatus.IN_QUEUE) {
    await dispatchJob(jobId);
    return { success: true, message: 'Dispatched from queue' };
  }

  if (
    job.status === JobStatus.PREPARING ||
    job.status === JobStatus.GENERATING ||
    job.status === JobStatus.RETRYING ||
    job.status === JobStatus.CHECKING_STATUS
  ) {
    // Cancel in-flight then requeue
    await cancelJob(jobId, job.userId, { force: true, skipDispatch: true });
  } else if (!terminal && job.status !== JobStatus.IN_QUEUE) {
    throw new Error(`Cannot retry job in status ${job.status}`);
  }

  // Re-reserve credits for a fresh attempt when previous attempt settled/released
  try {
    const { reserveCredits } = await import('./credits');
    await reserveCredits(job.userId, job.modelKey, job.id);
  } catch (e: any) {
    const msg = String(e?.message || e || '');
    if (/insufficient/i.test(msg)) throw e;
    // Ignore "already reserved" style failures — continue to requeue
  }

  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: JobStatus.IN_QUEUE,
      progress: 0,
      errorMessage: 'Retry requested',
      completedAt: null,
      startedAt: null,
      retryCount: { increment: 1 },
      outputMediaUrl: job.status === JobStatus.COMPLETED ? job.outputMediaUrl : null,
    },
  });

  await dispatchJob(jobId);
  return { success: true, message: 'Job requeued and dispatching' };
}
