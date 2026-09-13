import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { BrowserStatus } from '@prisma/client';
import {
  bibFetch,
  bibVideoStatus,
  ensureBibAccountReady,
} from '@/lib/bib';

/**
 * Upscale video to 1080p via Google Flow cloud API only (BiB aisandbox).
 * No Python CDP helper Chrome and no local ffmpeg remaster.
 */
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
        assignedProviderAccountId: true,
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

    const jobById = await prisma.generationJob.findFirst({
      where: { id, userId: session.userId },
    });
    const asset = await prisma.asset.findFirst({
      where: { id, userId: session.userId },
    });

    // Gallery cards often use Asset.id, not GenerationJob.id — resolve the owning job
    let job = jobById;
    if (!job && asset) {
      const mediaKey =
        asset.upstreamAssetId ||
        (asset.url || '').match(/\/video\/([a-f0-9-]{36})/i)?.[1] ||
        '';
      job = await prisma.generationJob.findFirst({
        where: {
          userId: session.userId,
          OR: [
            ...(asset.url
              ? [
                  { outputMediaUrl: asset.url },
                  { outputMediaUrl: { startsWith: asset.url.split('?')[0] } },
                ]
              : []),
            ...(mediaKey
              ? [
                  { outputMediaUrl: { contains: mediaKey } },
                  { parameters: { path: ['bibMediaId'], equals: mediaKey } },
                ]
              : []),
          ],
        },
        orderBy: { updatedAt: 'desc' },
      });
    }

    const meta = (job?.outputMetadata as any) || {};
    const jobParams = (job?.parameters as any) || {};
    const videoUrl = body.url || job?.outputMediaUrl || asset?.url || '';
    if (!videoUrl) {
      return NextResponse.json(
        { error: 'Video has no playable URL yet. Wait until generation completes.' },
        { status: 400 }
      );
    }

    const mediaId = String(
      body.media_id ||
        meta.bibMediaId ||
        jobParams.bibMediaId ||
        meta.workerTaskId ||
        asset?.upstreamAssetId ||
        (videoUrl.match(/\/(?:video|image)\/([a-f0-9-]{36})/i) || [])[1] ||
        ''
    )
      .replace(/_upsampled$/i, '')
      .trim();

    if (!mediaId || !/^[a-f0-9-]{36}$/i.test(mediaId)) {
      return NextResponse.json(
        {
          error:
            'Missing Flow media id for cloud upsample. Wait until the video finishes generating, then retry.',
        },
        { status: 400 }
      );
    }

    let accountId =
      body.account_id ||
      meta.bibAccountId ||
      jobParams.bibAccountId ||
      job?.providerAccountId ||
      user?.assignedProviderAccountId ||
      null;

    if (!accountId) {
      const ready = await prisma.providerAccount.findFirst({
        where: { browserStatus: BrowserStatus.READY },
        orderBy: { bibLastSeenAt: 'desc' },
        select: { id: true },
      });
      accountId = ready?.id || null;
    }

    if (!accountId) {
      return NextResponse.json(
        {
          error:
            'No BiB provider account available for cloud upsample. Launch a READY Google account in Admin first.',
        },
        { status: 503 }
      );
    }

    const projectId =
      body.project_id ||
      meta.bibProjectId ||
      jobParams.bibProjectId ||
      jobParams.flowProjectId ||
      undefined;

    const provider = await prisma.providerAccount.findUnique({ where: { id: accountId } });
    if (!provider) {
      return NextResponse.json({ error: 'Provider account not found' }, { status: 404 });
    }

    await ensureBibAccountReady({
      id: provider.id,
      maxParallelLimit: provider.maxParallelLimit,
      flowProjectIds: provider.flowProjectIds,
      profileDir: provider.profileDir,
    });

    const upRes = await bibFetch('/upsample-video', {
      method: 'POST',
      body: JSON.stringify({
        accountId,
        mediaId,
        projectId,
        aspectRatio: body.aspect_ratio || jobParams.aspect_ratio || '16:9',
        videoModel: jobParams.wireModel || undefined,
      }),
    });
    const upData = await upRes.json().catch(() => ({}));
    if (!upRes.ok) {
      return NextResponse.json(
        {
          error:
            upData.error ||
            'Google Flow cloud upsample failed. Sign into flow.google.com in BiB and retry.',
        },
        { status: upRes.status >= 400 ? upRes.status : 502 }
      );
    }

    let cloudUrl = String(upData.videoUrl || upData.url || '').trim();
    const outMediaId = String(upData.mediaId || '').trim();

    // Poll BiB until Flow finishes the 1080p upsample (cloud only — no local remaster)
    if (!cloudUrl && outMediaId) {
      for (let i = 0; i < 24 && !cloudUrl; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const st = await bibVideoStatus({
            accountId,
            mediaId: outMediaId,
            projectId: upData.projectId || projectId,
          });
          cloudUrl = String(st.videoUrl || st.url || '').trim();
          if (cloudUrl || st.status === 'COMPLETED') break;
          if (st.status === 'FAILED') {
            return NextResponse.json(
              { error: 'Google Flow cloud upsample failed on Flow side' },
              { status: 502 }
            );
          }
        } catch (pollErr: any) {
          console.warn('[upscale] BiB poll:', pollErr?.message || pollErr);
        }
      }
    }

    if (!cloudUrl) {
      // Still processing — return media id so client can keep polling video status
      if (job && outMediaId) {
        await prisma.generationJob.update({
          where: { id: job.id },
          data: {
            outputMetadata: {
              ...meta,
              upscaleMediaId: outMediaId,
              upscaled_method: 'native_cloud_bib',
              upscaled_resolution: '1080p',
              bibAccountId: accountId,
              bibProjectId: upData.projectId || projectId,
              upscaled_at: new Date().toISOString(),
            },
          },
        });
      }
      return NextResponse.json({
        success: true,
        status: 'PROCESSING',
        asset_id: id,
        mediaId: outMediaId || mediaId,
        method: 'native_cloud_bib',
        upscaled_resolution: '1080p',
        message: 'Cloud upsample submitted — still rendering on Google Flow',
      });
    }

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
            upscaleMediaId: outMediaId || undefined,
            bibAccountId: accountId,
            bibProjectId: upData.projectId || projectId,
            upscaled_at: new Date().toISOString(),
          },
        },
      });
    }

    return NextResponse.json({
      success: true,
      status: 'COMPLETED',
      asset_id: id,
      upscaled_url: cloudUrl,
      upscaled_download_url: cloudUrl,
      upscaled_resolution: '1080p',
      resolution: '1080p',
      method: 'native_cloud_bib',
      mediaId: outMediaId || mediaId,
    });
  } catch (err: any) {
    console.error('Upscale API error:', err);
    return NextResponse.json({ error: err.message || 'Video upscale failed' }, { status: 500 });
  }
}
