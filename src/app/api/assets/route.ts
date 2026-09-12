import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { formatModelDisplayName } from '@/lib/modelLabels';
import { isCompletedMediaExpired, resolveMediaExpiresAt } from '@/lib/mediaExpiry';
import { isFailedCardStale, runRetentionCleanupSweep } from '@/lib/retention';
import { softPurgeJobMedia, resolveJobsForGalleryDelete } from '@/lib/mediaPurge';

/** Tools own their queue UI — do not flood All Media with Waiting-in-Queue cards. */
const TOOL_SOURCES = new Set(['storyteller', 'bulkt2v', 'bulkt2i', 'bulki2v']);

function isToolOwnedQueueJob(job: {
  status: string;
  errorMessage?: string | null;
  parameters?: unknown;
}): boolean {
  if (job.status !== 'IN_QUEUE') return false;
  const params = (job.parameters as Record<string, unknown>) || {};
  const src = String(params.source || '').trim();
  if (TOOL_SOURCES.has(src)) return true;
  // Fallback for older rows that only set the queue message
  const msg = String(job.errorMessage || '');
  return /In Queue:\s*(Storyteller|Bulk)\b/i.test(msg);
}

export async function GET(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') || 'all';
    const projectId = searchParams.get('projectId');

    // 1. Resolve user's active project (Strict 1-project policy fallback)
    let activeProject = null;
    if (projectId) {
      activeProject = await prisma.project.findFirst({
        where: { id: projectId, userId: session.userId, deletedAt: null },
      });
    }
    if (!activeProject) {
      activeProject = await prisma.project.findFirst({
        where: { userId: session.userId, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
      });
    }
    if (!activeProject) {
      activeProject = await prisma.project.create({
        data: {
          userId: session.userId,
          name: 'Studio Workspace',
          description: 'Default creation workspace',
        },
      });
    }

    const where: any = {
      userId: session.userId,
      projectId: activeProject.id,
    };

    if (type !== 'all') {
      where.fileType = type;
    }

    let assets = await prisma.asset.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Also fetch generation jobs for this user and project
    const jobWhere: any = {
      userId: session.userId,
      projectId: activeProject.id,
    };

    let jobs = await prisma.generationJob.findMany({
      where: jobWhere,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const existingAssetUrls = new Set(assets.map((a) => a.url).filter(Boolean));
    const existingAssetIds = new Set(assets.map((a) => a.id));

    // Opportunistic retention: wipe CDN-expired media + Failed cards older than 4h
    runRetentionCleanupSweep().catch((err) => {
      console.warn('Retention sweep skipped:', err?.message || err);
    });

    const now = new Date();

    const jobAssets = jobs
      .filter((job) => {
        const params = (job.parameters as Record<string, unknown>) || {};
        const meta = (job.outputMetadata as Record<string, unknown>) || {};
        // Soft-deleted from gallery — keep analytics row, hide from All Media
        if (params.galleryPurged || meta.galleryPurged) return false;
        // User-cancelled / retention-expired jobs should not clutter All Media
        if (job.status === 'CANCELLED' || job.status === 'EXPIRED') return false;
        // Tool queues (Storyteller / Bulk *) stay in the tool pane — All Media shows generating+ready only
        if (isToolOwnedQueueJob(job)) return false;
        // Failed cards auto-hide after 4 hours
        if (job.status === 'FAILED' && isFailedCardStale(job.completedAt, job.updatedAt, job.createdAt, now)) {
          return false;
        }
        // Completed with no media URL is not gallery-usable — drop from list
        if (job.status === 'COMPLETED' && !(job.outputMediaUrl || '').trim()) {
          return false;
        }
        // CDN/DB expiry passed — hide (do not show "Expired" placeholder cards)
        if (
          job.status === 'COMPLETED' &&
          isCompletedMediaExpired(job.outputMediaUrl, job.expiresAt, now)
        ) {
          return false;
        }
        // If job completed and is already recorded in assets table, avoid duplicate
        if (job.status === 'COMPLETED' && (existingAssetUrls.has(job.outputMediaUrl || '') || existingAssetIds.has(job.id))) {
          return false;
        }
        return true;
      })
      .map((job) => {
        const isVideo = job.modelKey.includes('veo') || job.modelKey.includes('omni');
        const params = (job.parameters as any) || {};
        const meta = (job.outputMetadata as any) || {};
        let uiStatus = 'PROCESSING';
        if (job.status === 'IN_QUEUE') {
          uiStatus = 'IN_QUEUE';
        } else if (job.status === 'CANCELLED') {
          uiStatus = 'CANCELLED';
        } else if (job.status === 'FAILED') {
          uiStatus = 'FAILED';
        } else if (job.status === 'COMPLETED') {
          uiStatus = 'COMPLETED';
        }

        const assetType = isVideo ? 'video' : 'image';
        let safeUrl = job.outputMediaUrl || '';
        if (assetType === 'image' && safeUrl.endsWith('.mp4')) {
          safeUrl = safeUrl.replace(/\.mp4$/, '.jpg');
        }

        const resolvedExpires = resolveMediaExpiresAt(safeUrl, job.expiresAt);

        return {
          id: job.id,
          jobId: job.id,
          runId: params.run_id || undefined,
          source: params.source || undefined,
          name: job.prompt ? (job.prompt.length > 30 ? job.prompt.slice(0, 30) + '...' : job.prompt) : job.modelKey,
          prompt: job.prompt,
          url: safeUrl,
          type: assetType,
          status: uiStatus,
          inQueue: job.status === 'IN_QUEUE',
          error: job.errorMessage || (job.status === 'FAILED' ? 'Generation failed' : undefined),
          queueMessage: job.status === 'IN_QUEUE' ? (job.errorMessage || undefined) : undefined,
          progress: job.progress || 0,
          aspect_ratio: params.aspect_ratio || '16:9',
          duration: params.duration || 8,
          model: formatModelDisplayName(params.model || job.modelKey, assetType === 'image' ? 'image' : 'video'),
          model_key: params.model || job.modelKey,
          created_at: job.createdAt.toISOString(),
          completed_at: job.completedAt ? job.completedAt.toISOString() : null,
          expires_at: resolvedExpires ? resolvedExpires.toISOString() : null,
          projectId: job.projectId,
          upscaled_url: meta.upscaled_url || undefined,
          upscaled_download_url: meta.upscaled_download_url || undefined,
          upscaled_resolution: meta.upscaled_resolution || undefined,
          characters: Array.isArray(params.characters)
            ? params.characters
            : Array.isArray(job.characterIds)
              ? job.characterIds
              : [],
        };
      });

    const formatted = assets
      .filter((a) => (a.url || '').trim())
      .filter((a) => !isCompletedMediaExpired(a.url, a.expiresAt, now))
      .map((a) => {
        const urlBase = (a.url || '').split('?')[0];
        // Prefer exact ownership for upscale metadata — weak substring matches leak HD onto other cards
        const matchingJob =
          jobs.find((j) => j.id === a.id) ||
          jobs.find((j) => j.outputMediaUrl === a.url) ||
          jobs.find(
            (j) =>
              !!urlBase &&
              !!j.outputMediaUrl &&
              j.outputMediaUrl.split('?')[0] === urlBase
          ) ||
          jobs.find((j) => a.fileName.includes(j.id)) ||
          jobs.find(
            (j) =>
              j.id.length >= 8 &&
              (a.fileName.includes(`${j.modelKey}_${j.id.substring(0, 8)}.`) ||
                a.fileName.includes(`_${j.id.substring(0, 8)}.`))
          );
        const isImg = a.fileType === 'image';
        let safeUrl = a.url;
        if (isImg && safeUrl.endsWith('.mp4')) {
          safeUrl = safeUrl.replace(/\.mp4$/, '.jpg');
        }

        const cleanTitle =
          matchingJob?.prompt ||
          a.fileName
            .replace(/\.[^/.]+$/, '')
            .replace(/^veo_[a-zA-Z0-9_]+_|^test_video_[a-zA-Z0-9_]+|^veo_|^nano_banana_[a-zA-Z0-9_]+_|^whisk_[a-zA-Z0-9_]+_/, '')
            .trim() ||
          (isImg ? 'Generated Image' : 'Generated Video');

        const matchingMeta = (matchingJob?.outputMetadata as any) || {};
        const matchingParams = (matchingJob?.parameters as any) || {};
        const resolvedExpires = resolveMediaExpiresAt(safeUrl, a.expiresAt);
        return {
          id: a.id,
          jobId: matchingJob?.id || undefined,
          runId: matchingParams.run_id || undefined,
          name: cleanTitle,
          prompt: cleanTitle,
          url: safeUrl,
          type: a.fileType,
          mimeType: isImg && safeUrl.endsWith('.jpg') ? 'image/jpeg' : a.mimeType,
          fileSize: a.fileSize,
          status: 'COMPLETED',
          created_at: a.createdAt.toISOString(),
          expires_at: resolvedExpires ? resolvedExpires.toISOString() : null,
          projectId: a.projectId,
          model: formatModelDisplayName(
            matchingParams.model || matchingJob?.modelKey || undefined,
            isImg ? 'image' : 'video'
          ),
          // Keep raw key for retries
          model_key: matchingParams.model || matchingJob?.modelKey || undefined,
          upscaled_url: matchingMeta.upscaled_url || undefined,
          upscaled_download_url: matchingMeta.upscaled_download_url || undefined,
          upscaled_resolution: matchingMeta.upscaled_resolution || undefined,
          characters: Array.isArray(matchingParams.characters)
            ? matchingParams.characters
            : Array.isArray(matchingJob?.characterIds)
              ? matchingJob.characterIds
              : [],
        };
      });

    const filteredJobs = type === 'all' ? jobAssets : jobAssets.filter((j) => j.type === type);

    // Jobs + permanent assets, newest first (so fresh gens beat older failed/fetch-failed cards)
    const combined = [...filteredJobs, ...formatted].sort((a, b) => {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return tb - ta;
    });

    // Strictly deduplicate combined assets so no duplicate card is ever rendered in gallery
    const seenAssetKeys = new Set<string>();
    const deduplicatedAssets = [];
    for (const item of combined) {
      // Clean URL (stripping dynamic CDN query params like ?Expires=...)
      const cleanUrl = item.url ? item.url.split('?')[0].trim() : '';
      // Prefer id for failed/processing (no stable URL) so we keep ordering by time
      const key =
        item.status === 'FAILED' || item.status === 'PROCESSING' || item.status === 'IN_QUEUE' || !cleanUrl
          ? item.id
          : `${item.type}:${cleanUrl}`;
      if (!seenAssetKeys.has(key)) {
        seenAssetKeys.add(key);
        deduplicatedAssets.push(item);
      }
    }

    return NextResponse.json({
      success: true,
      assets: deduplicatedAssets,
    });
  } catch (err: any) {
    console.error('Error fetching assets:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const jobId = searchParams.get('jobId') || searchParams.get('job_id');
    const url = searchParams.get('url');

    if (!id && !jobId) {
      return NextResponse.json({ error: 'Asset ID required' }, { status: 400 });
    }

    const cardId = id || jobId || '';

    const asset = await prisma.asset.findFirst({
      where: { id: cardId, userId: session.userId },
      select: { id: true, storagePath: true, url: true },
    });

    if (asset?.storagePath && !String(asset.storagePath).startsWith('http')) {
      try {
        const fs = await import('fs');
        if (fs.existsSync(asset.storagePath)) fs.unlinkSync(asset.storagePath);
      } catch {
        /* ignore disk cleanup errors */
      }
    }

    if (asset) {
      await prisma.asset.deleteMany({
        where: { id: asset.id, userId: session.userId },
      });
    }

    // Soft-purge matching GenerationJob(s) — Asset.id ≠ Job.id for completed media
    const jobIds = await resolveJobsForGalleryDelete({
      userId: session.userId,
      id: cardId,
      jobId,
      url: url || asset?.url || null,
    });
    let purged = 0;
    for (const jid of jobIds) {
      if (await softPurgeJobMedia(jid, session.userId)) purged += 1;
    }

    // Also cancel in-flight/queued when deleting a processing card
    for (const jid of jobIds) {
      try {
        const { cancelJob } = await import('@/lib/queue');
        await cancelJob(jid, session.userId, { force: true, skipDispatch: true });
      } catch {
        /* already terminal or not cancellable */
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Asset deleted',
      purgedJobs: purged,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
