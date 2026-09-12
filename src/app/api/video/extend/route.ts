import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { JobStatus } from '@prisma/client';
import { selectProviderAccountForJobDetailed } from '@/lib/routing';
import { prepareProviderWorkerSession, refreshFlowMediaId } from '@/lib/providerSession';
import { bibGenerateVideo, ensureBibAccountReady } from '@/lib/bib';
import { resolveVideoFrontendModel, resolveVideoWireModel } from '@/lib/modelWire';
import { reserveCredits, settleCredits, releaseCredits, resolveModelPricing } from '@/lib/credits';
import { PYTHON_WORKER_URL } from '@/lib/worker';
import { createStudioLog } from '@/lib/studioLogs';

/**
 * Extend = last-frame extract (Python ffmpeg only) → BiB I2V (no CDP gen).
 */
export async function POST(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const body = await req.json();
    const assetId = String(body.asset_id || body.assetId || '').trim();
    const prompt = String(body.prompt || '').trim();
    const model = body.model || 'VEO_3_1_EXTEND_LITE';

    if (!assetId) {
      return NextResponse.json({ error: 'asset_id required' }, { status: 400 });
    }
    if (!prompt) {
      return NextResponse.json({ error: 'Extend prompt cannot be empty' }, { status: 400 });
    }

    const job = await prisma.generationJob.findFirst({
      where: { id: assetId, userId: session.userId },
    });
    const asset = await prisma.asset.findFirst({
      where: {
        userId: session.userId,
        OR: [{ id: assetId }, { upstreamAssetId: assetId }],
      },
    });

    const videoUrl =
      body.url ||
      job?.outputMediaUrl ||
      asset?.url ||
      asset?.storagePath ||
      '';
    if (!videoUrl) {
      return NextResponse.json(
        { error: 'Video has no playable URL yet. Wait until generation completes, then Extend.' },
        { status: 400 }
      );
    }

    const aspect =
      body.aspect_ratio ||
      (job?.parameters as any)?.aspect_ratio ||
      '16:9';

    const pricing =
      (await resolveModelPricing(model)) || (await resolveModelPricing('veo_3_1_lite'))!;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    let project =
      (job?.projectId
        ? await prisma.project.findFirst({ where: { id: job.projectId, userId: session.userId } })
        : null) ||
      (asset?.projectId
        ? await prisma.project.findFirst({ where: { id: asset.projectId, userId: session.userId } })
        : null) ||
      (await prisma.project.findFirst({ where: { userId: session.userId, deletedAt: null } }));

    if (!project) {
      project = await prisma.project.create({
        data: { userId: session.userId, name: 'Studio Workspace' },
      });
    }

    const newJob = await prisma.generationJob.create({
      data: {
        userId: session.userId,
        projectId: project.id,
        modelKey: pricing.modelKey,
        walletType: pricing.walletType,
        creditCost: pricing.price,
        status: JobStatus.PREPARING,
        progress: 5,
        prompt: `[Extended] ${prompt}`,
        parameters: {
          aspect_ratio: aspect,
          model,
          parent_id: assetId,
          extend_mode: 'last_frame_i2v',
          source: 'extend',
        },
        expiresAt,
      },
    });

    try {
      await reserveCredits(session.userId, pricing.modelKey, newJob.id);
    } catch (creditErr: any) {
      await prisma.generationJob.delete({ where: { id: newJob.id } });
      return NextResponse.json(
        { error: creditErr.message || 'Insufficient credits' },
        { status: 402 }
      );
    }

    const { account: provider, reason } = await selectProviderAccountForJobDetailed(
      pricing.walletType,
      pricing.modelKey,
      session.userId
    );
    if (!provider) {
      await releaseCredits(session.userId, pricing.walletType, pricing.price, newJob.id).catch(() => 0);
      await prisma.generationJob.update({
        where: { id: newJob.id },
        data: { status: JobStatus.FAILED, errorMessage: reason || 'No BiB provider', completedAt: new Date() },
      });
      return NextResponse.json({ error: reason || 'No BiB provider ready' }, { status: 503 });
    }

    try {
      const sessionPrep = await prepareProviderWorkerSession(provider, session.userId);
      const liveCookies = sessionPrep.cookies || provider.cookies || undefined;
      const targetProjectId = sessionPrep.projectId;

      // Last-frame extract via Python ffmpeg (HTTP). BiB handles the I2V gen.
      const lfRes = await fetch(`${PYTHON_WORKER_URL}/api/video/last-frame/${encodeURIComponent(assetId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: videoUrl }),
      });
      if (!lfRes.ok) {
        const t = await lfRes.text();
        throw new Error(`Last-frame extract failed: ${t.slice(0, 200)}`);
      }
      const lf = await lfRes.json();
      const stagedId = lf.staged_id || lf.image_id || lf.asset?.staged_id || lf.asset?.id;
      if (!stagedId) throw new Error('Last-frame extract returned no staged id');

      // Clear our local server video copy after frame extract (keep remote CDN URL for canvas)
      if (asset?.storagePath && !String(asset.storagePath).startsWith('http')) {
        try {
          const fs = await import('fs');
          if (fs.existsSync(asset.storagePath)) fs.unlinkSync(asset.storagePath);
        } catch {
          /* ignore */
        }
        await prisma.asset
          .update({
            where: { id: asset.id },
            data: { storagePath: asset.url || videoUrl || '' },
          })
          .catch(() => null);
      }

      const frameId =
        (await refreshFlowMediaId({
          mediaId: stagedId,
          cookies: liveCookies,
          projectId: targetProjectId,
        })) || stagedId;
      if (!/^[a-f0-9-]{36}$/i.test(String(frameId))) {
        throw new Error('Last frame is not Flow-ready yet — retry Extend in a moment');
      }

      await ensureBibAccountReady({
        id: provider.id,
        maxParallelLimit: provider.maxParallelLimit,
        flowProjectIds: provider.flowProjectIds,
        profileDir: provider.profileDir,
      });

      const feModel = resolveVideoFrontendModel(String(model));
      const wireModel = resolveVideoWireModel(feModel, {
        mode: 'i2v',
        duration: 8,
        aspectRatio: aspect,
      });
      const aspectMap: Record<string, number> = { '16:9': 2, '9:16': 1, '1:1': 1 };

      createStudioLog({
        level: 'info',
        source: 'generate',
        message: `Extend via BiB I2V (frame ${String(frameId).slice(0, 8)}…)`,
        runId: newJob.id,
        userId: session.userId,
        userEmail: session.email,
      }).catch(() => 0);

      const bib = await bibGenerateVideo({
        accountId: provider.id,
        mode: 'i2v',
        prompt,
        imageId: frameId,
        videoModel: wireModel,
        aspect: aspectMap[String(aspect)] || 2,
        aspectRatio: aspect,
        projectId: targetProjectId,
        waitForCompletion: false,
      });

      const mediaId = bib.mediaId;
      const doneUrl = bib.videoUrl || bib.url || '';

      if (doneUrl) {
        await prisma.generationJob.update({
          where: { id: newJob.id },
          data: {
            status: JobStatus.COMPLETED,
            progress: 100,
            outputMediaUrl: doneUrl,
            providerAccountId: provider.id,
            completedAt: new Date(),
            outputMetadata: { bibMediaId: mediaId, bibAccountId: provider.id, bibProjectId: targetProjectId },
          },
        });
        await prisma.asset.create({
          data: {
            userId: session.userId,
            projectId: project.id,
            fileName: `extend_${newJob.id.slice(0, 8)}.mp4`,
            fileType: 'video',
            mimeType: 'video/mp4',
            fileSize: 1024 * 1024,
            storagePath: doneUrl,
            url: doneUrl,
            upstreamAssetId: mediaId || null,
            expiresAt,
          },
        });
        await settleCredits(session.userId, pricing.walletType, pricing.price, newJob.id);
        return NextResponse.json({
          success: true,
          asset: {
            id: newJob.id,
            status: 'COMPLETED',
            url: doneUrl,
            type: 'video',
            prompt: newJob.prompt,
            model,
            parent_id: assetId,
            extend_mode: 'last_frame_i2v',
          },
        });
      }

      if (!mediaId) throw new Error(bib.error || 'BiB extend returned no mediaId');

      await prisma.generationJob.update({
        where: { id: newJob.id },
        data: {
          status: JobStatus.GENERATING,
          progress: 20,
          providerAccountId: provider.id,
          outputMetadata: {
            workerTaskId: mediaId,
            bibMediaId: mediaId,
            bibAccountId: provider.id,
            bibProjectId: targetProjectId || null,
            parent_id: assetId,
          },
          parameters: {
            aspect_ratio: aspect,
            model,
            parent_id: assetId,
            extend_mode: 'last_frame_i2v',
            flowProjectId: targetProjectId,
          },
        },
      });

      return NextResponse.json({
        success: true,
        asset: {
          id: newJob.id,
          status: 'PROCESSING',
          progress: 20,
          url: '',
          type: 'video',
          prompt: newJob.prompt,
          model,
          parent_id: assetId,
          extend_mode: 'last_frame_i2v',
          workerTaskId: mediaId,
        },
      });
    } catch (e: any) {
      await releaseCredits(session.userId, pricing.walletType, pricing.price, newJob.id).catch(() => 0);
      await prisma.generationJob.update({
        where: { id: newJob.id },
        data: {
          status: JobStatus.FAILED,
          errorMessage: e?.message || 'Extend failed',
          completedAt: new Date(),
        },
      });
      return NextResponse.json({ error: e?.message || 'Extend failed', detail: e?.message }, { status: 500 });
    }
  } catch (err: any) {
    console.error('API /api/video/extend error:', err);
    return NextResponse.json({ error: err.message || 'Extend failed' }, { status: 500 });
  }
}
