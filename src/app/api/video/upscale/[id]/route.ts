import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { workerIdentityHeaders, PYTHON_WORKER_URL } from '@/lib/worker';

const UPLOAD_DIR = path.resolve(process.cwd(), 'data/uploads');

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getOrCreateStudioUser(req);
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ error: 'Asset id required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        subscriptions: {
          where: { status: 'ACTIVE' },
          include: { plan: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    const planName = (user?.subscriptions?.[0]?.plan?.name || 'Free').toLowerCase();
    if (planName !== 'pro' && planName !== 'business') {
      return NextResponse.json(
        { error: 'Video upscale to 1080p is available on Pro and Business plans only.' },
        { status: 403 }
      );
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const job = await prisma.generationJob.findFirst({
      where: { id, userId: session.userId },
    });
    const asset = await prisma.asset.findFirst({
      where: { id, userId: session.userId },
    });

    const meta = (job?.outputMetadata as any) || {};
    const videoUrl = body.url || job?.outputMediaUrl || asset?.url || '';
    if (!videoUrl) {
      return NextResponse.json(
        { error: 'Video has no playable URL yet. Wait until generation completes.' },
        { status: 400 }
      );
    }

    const params = (job?.parameters as any) || {};
    const runId = body.run_id || params.run_id || job?.id || id;
    const mediaId =
      body.media_id ||
      meta.bibMediaId ||
      meta.workerTaskId ||
      asset?.upstreamAssetId ||
      (job?.outputMediaUrl || '').match(/video\/([a-f0-9-]{36})/i)?.[1] ||
      id;
    const projectId =
      body.project_id || meta.bibProjectId || params.flowProjectId || undefined;
    const accountId = meta.bibAccountId || job?.providerAccountId || undefined;

    // Prefer BiB native cloud upsample when we have a Flow media id + BiB account
    if (accountId && mediaId && /^[a-f0-9-]{36}$/i.test(String(mediaId))) {
      try {
        const { bibFetch, ensureBibAccountReady } = await import('@/lib/bib');
        const provider = await prisma.providerAccount.findUnique({ where: { id: accountId } });
        if (provider) {
          await ensureBibAccountReady({
            id: provider.id,
            maxParallelLimit: provider.maxParallelLimit,
            flowProjectIds: provider.flowProjectIds,
            profileDir: provider.profileDir,
          });
        }
        const upRes = await bibFetch('/upsample-video', {
          method: 'POST',
          body: JSON.stringify({
            accountId,
            mediaId,
            projectId,
            aspectRatio: body.aspect_ratio || params.aspect_ratio || '16:9',
            videoModel: params.wireModel || undefined,
          }),
        });
        const upData = await upRes.json().catch(() => ({}));
        if (upRes.ok && (upData.videoUrl || upData.url || upData.mediaId)) {
          const cloudUrl = upData.videoUrl || upData.url || '';
          // Fall through to Python only if BiB accepted but gave no URL yet — store media for poll
          if (cloudUrl) {
            const fileName = `upscaled_${id.slice(0, 16)}.mp4`;
            if (job) {
              await prisma.generationJob.update({
                where: { id: job.id },
                data: {
                  outputMetadata: {
                    ...meta,
                    upscaled_url: cloudUrl,
                    upscaled_download_url: cloudUrl,
                    upscaled_resolution: '1080p',
                    upscaled_method: 'native_cloud_bib',
                    upscaled_at: new Date().toISOString(),
                  },
                },
              });
            }
            return NextResponse.json({
              success: true,
              asset_id: id,
              upscaled_url: cloudUrl,
              upscaled_download_url: cloudUrl,
              upscaled_resolution: '1080p',
              method: 'native_cloud_bib',
            });
          }
        }
      } catch (bibUpErr: any) {
        console.warn('[upscale] BiB native upsample unavailable:', bibUpErr?.message || bibUpErr);
      }
    }

    const workerRes = await fetch(`${PYTHON_WORKER_URL}/api/video/upscale/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...workerIdentityHeaders({
          ...session,
          runId,
        }),
      },
      body: JSON.stringify({
        url: videoUrl,
        aspect_ratio: body.aspect_ratio || params.aspect_ratio || '16:9',
        media_id: body.media_id || meta.primary_media_id || meta.mediaId || '',
        workflow_id: body.workflow_id || meta.workflow_id || '',
        run_id: runId,
      }),
    });

    const text = await workerRes.text();
    let data: any = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text };
    }

    if (!workerRes.ok) {
      return NextResponse.json(
        { error: data.detail || data.error || 'Video upscale failed', detail: data.detail || data.error },
        { status: workerRes.status || 500 }
      );
    }

    const fileName = `upscaled_${id.slice(0, 16)}.mp4`;
    const filePath = path.join(UPLOAD_DIR, fileName);
    const durableFileUrl = fs.existsSync(filePath) ? `/api/assets/file/${fileName}` : '';

    // Prefer a public Google/Flow https URL for share/copy; keep local file as durable fallback.
    const cloudUrl = data.upscaled_url || data.upscaledUrl || '';
    const preferCloud = typeof cloudUrl === 'string' && /^https?:\/\//i.test(cloudUrl);
    const upscaledUrl = preferCloud ? cloudUrl : (durableFileUrl || cloudUrl || '');
    const upscaledDownloadUrl =
      durableFileUrl ||
      data.upscaled_download_url ||
      data.upscaledDownloadUrl ||
      upscaledUrl;
    const resolution = data.upscaled_resolution || data.resolution || '1080p';

    if (job) {
      const prev = (job.outputMetadata as any) || {};
      await prisma.generationJob.update({
        where: { id: job.id },
        data: {
          outputMetadata: {
            ...prev,
            upscaled_url: upscaledUrl,
            upscaled_download_url: upscaledDownloadUrl,
            upscaled_resolution: resolution,
            upscaled_method: data.method || 'studio_hd',
            upscaled_at: new Date().toISOString(),
          },
        },
      });
    }
    if (asset) {
      // Only attach upscale meta to the job that actually owns this asset URL — never fuzzy id contains
      const matchingJob = await prisma.generationJob.findFirst({
        where: {
          userId: session.userId,
          OR: [
            { id: asset.id },
            ...(asset.url
              ? [
                  { outputMediaUrl: asset.url },
                  {
                    outputMediaUrl: {
                      startsWith: asset.url.split('?')[0],
                    },
                  },
                ]
              : []),
          ],
        },
        orderBy: { createdAt: 'desc' },
      });
      if (matchingJob && matchingJob.id !== job?.id) {
        const prev = (matchingJob.outputMetadata as any) || {};
        await prisma.generationJob.update({
          where: { id: matchingJob.id },
          data: {
            outputMetadata: {
              ...prev,
              upscaled_url: upscaledUrl,
              upscaled_download_url: upscaledDownloadUrl,
              upscaled_resolution: resolution,
              asset_id: asset.id,
              upscaled_at: new Date().toISOString(),
            },
          },
        });
      }
    }

    return NextResponse.json({
      ...data,
      upscaled_url: upscaledUrl,
      upscaled_download_url: upscaledDownloadUrl,
      upscaled_resolution: resolution,
      resolution,
      success: true,
    });
  } catch (err: any) {
    console.error('Upscale API error:', err);
    return NextResponse.json({ error: err.message || 'Video upscale failed' }, { status: 500 });
  }
}
