import { prisma } from '@/lib/prisma';
import { cancelJob } from '@/lib/queue';
import { JobStatus } from '@prisma/client';

/**
 * Soft-purge gallery media for a user without deleting GenerationJob rows.
 * Analytics (credits used, success rate, job counts) stay intact.
 */
export async function softPurgeUserMedia(userId: string) {
  const pending = await prisma.generationJob.findMany({
    where: {
      userId,
      status: {
        in: [
          JobStatus.IN_QUEUE,
          JobStatus.PREPARING,
          JobStatus.GENERATING,
          JobStatus.RETRYING,
          JobStatus.CHECKING_STATUS,
        ],
      },
    },
    select: { id: true },
  });

  let cancelled = 0;
  for (const job of pending) {
    try {
      const result = await cancelJob(job.id, userId, {
        force: true,
        skipDispatch: true,
      });
      if (result?.success) cancelled += 1;
    } catch (err) {
      console.warn(`softPurge cancel failed for ${job.id}:`, err);
    }
  }

  const assets = await prisma.asset.findMany({
    where: { userId },
    select: { id: true, storagePath: true },
  });

  for (const asset of assets) {
    if (asset.storagePath && !String(asset.storagePath).startsWith('http')) {
      try {
        const fs = await import('fs');
        if (fs.existsSync(asset.storagePath)) fs.unlinkSync(asset.storagePath);
      } catch {
        /* ignore */
      }
    }
  }

  const deletedAssets = await prisma.asset.deleteMany({ where: { userId } });

  const jobs = await prisma.generationJob.findMany({
    where: { userId },
    select: { id: true, parameters: true, outputMetadata: true, outputMediaUrl: true },
  });

  const purgedAt = new Date().toISOString();
  let purgedJobs = 0;
  for (const job of jobs) {
    const params = ((job.parameters as Record<string, unknown>) || {}) as Record<string, unknown>;
    const meta = ((job.outputMetadata as Record<string, unknown>) || {}) as Record<string, unknown>;
    if (!job.outputMediaUrl && params.galleryPurged) continue;
    await prisma.generationJob.update({
      where: { id: job.id },
      data: {
        outputMediaUrl: null,
        parameters: { ...params, galleryPurged: true, purgedAt },
        outputMetadata: {
          ...meta,
          galleryPurged: true,
          purgedAt,
          upscaled_url: undefined,
          upscaled_download_url: undefined,
        },
      },
    });
    purgedJobs += 1;
  }

  return { cancelled, deletedAssets: deletedAssets.count, purgedJobs };
}

/** Soft-purge a single job's media (keep row for analytics). */
export async function softPurgeJobMedia(jobId: string, userId: string) {
  const job = await prisma.generationJob.findFirst({
    where: { id: jobId, userId },
    select: { id: true, parameters: true, outputMetadata: true },
  });
  if (!job) return false;

  const params = ((job.parameters as Record<string, unknown>) || {}) as Record<string, unknown>;
  const meta = ((job.outputMetadata as Record<string, unknown>) || {}) as Record<string, unknown>;
  const purgedAt = new Date().toISOString();

  await prisma.generationJob.update({
    where: { id: job.id },
    data: {
      outputMediaUrl: null,
      parameters: { ...params, galleryPurged: true, purgedAt },
      outputMetadata: {
        ...meta,
        galleryPurged: true,
        purgedAt,
        upscaled_url: undefined,
        upscaled_download_url: undefined,
      },
    },
  });
  return true;
}

/**
 * Resolve which GenerationJob(s) belong to a gallery card id (asset uuid and/or job uuid).
 * Asset.id ≠ GenerationJob.id for completed media — must match by URL / filename too.
 */
export async function resolveJobsForGalleryDelete(opts: {
  userId: string;
  id: string;
  jobId?: string | null;
  url?: string | null;
}): Promise<string[]> {
  const ids = new Set<string>();
  const directJobId = String(opts.jobId || '').trim();
  const cardId = String(opts.id || '').trim();
  if (directJobId) ids.add(directJobId);
  if (cardId) {
    const byId = await prisma.generationJob.findFirst({
      where: { id: cardId, userId: opts.userId },
      select: { id: true },
    });
    if (byId) ids.add(byId.id);
  }

  const asset = await prisma.asset.findFirst({
    where: { id: cardId, userId: opts.userId },
    select: { id: true, url: true, fileName: true },
  });
  const url = String(opts.url || asset?.url || '').trim();
  const urlBase = url.split('?')[0];

  if (url || asset) {
    const jobs = await prisma.generationJob.findMany({
      where: { userId: opts.userId },
      select: { id: true, outputMediaUrl: true },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    for (const j of jobs) {
      const out = String(j.outputMediaUrl || '').trim();
      if (url && out && (out === url || out.split('?')[0] === urlBase)) {
        ids.add(j.id);
        continue;
      }
      if (asset?.fileName && asset.fileName.includes(j.id)) {
        ids.add(j.id);
      }
    }
  }

  return [...ids];
}
