import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getModelPricing, reserveCredits, settleCredits, releaseCredits, resolveModelPricing } from '@/lib/credits';
import { toUserFacingQueueMessage } from '@/lib/userMessages';
import { selectProviderAccountForJobDetailed } from '@/lib/routing';
import { checkAndDispatchNextJobs } from '@/lib/queue';
import { JobStatus } from '@prisma/client';
import { withSystemErrorRetry } from '@/lib/systemErrorRetry';
import { resolveImageFrontendModel, resolveImageWireModel } from '@/lib/modelWire';
import { createStudioLog } from '@/lib/studioLogs';
import { prepareProviderWorkerSession, refreshFlowMediaId } from '@/lib/providerSession';
import { bibGenerateImage, ensureBibAccountReady } from '@/lib/bib';

async function resolveMediaId(id?: string | null) {
  if (!id) return id || undefined;
  if (String(id).startsWith('staged-') || String(id).startsWith('upload-')) {
    return id;
  }
  const urlMatch = String(id).match(/flow-content\.google\/(?:image|video)\/([a-f0-9-]+)/i);
  if (urlMatch) return urlMatch[1];
  const assetRec = await prisma.asset.findUnique({
    where: { id },
    select: { url: true, storagePath: true, upstreamAssetId: true },
  });
  if (assetRec) {
    if (assetRec.upstreamAssetId) return assetRec.upstreamAssetId;
    const targetUrl = assetRec.url || assetRec.storagePath || '';
    const m = targetUrl.match(/flow-content\.google\/(?:image|video)\/([a-f0-9-]+)/i);
    if (m) return m[1];
  }
  return id;
}

export async function POST(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const body = await req.json();
    const {
      prompt,
      image_id,
      image_ids,
      aspect_ratio = '1:1',
      model = 'GEM_PIX_2',
      seed,
      projectId: clientProjectId,
    } = body;

    let project = clientProjectId
      ? await prisma.project.findFirst({ where: { id: clientProjectId, userId: session.userId } })
      : await prisma.project.findFirst({ where: { userId: session.userId, deletedAt: null } });

    if (!project) {
      project = await prisma.project.create({
        data: {
          userId: session.userId,
          name: 'Studio Workspace',
          description: 'Default creation workspace',
        },
      });
    }

    const pricing = (await resolveModelPricing(model)) || (await resolveModelPricing('nano_banana_pro'))!;
    const modelKey = pricing.modelKey;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const job = await prisma.generationJob.create({
      data: {
        userId: session.userId,
        projectId: project.id,
        modelKey,
        walletType: pricing.walletType,
        creditCost: pricing.price,
        status: JobStatus.IN_QUEUE,
        progress: 0,
        prompt: (prompt || 'Image to Image Remix').trim(),
        parameters: {
          aspect_ratio,
          seed,
          model,
          image_id,
          image_ids,
          run_id: body.run_id || null,
          source: body.source || null,
        },
        expiresAt,
      },
    });

    try {
      await reserveCredits(session.userId, modelKey, job.id);
    } catch (creditErr: any) {
      await prisma.generationJob.delete({ where: { id: job.id } });
      return NextResponse.json(
        { error: creditErr.message || `Insufficient ${pricing.walletType} credits`, detail: creditErr.message },
        { status: 402 }
      );
    }

    if (body.enqueue_only === true || body.background === true) {
      const queueMsg = toUserFacingQueueMessage('In Queue: Storyteller background');
      await prisma.generationJob.update({
        where: { id: job.id },
        data: { errorMessage: queueMsg },
      });
      checkAndDispatchNextJobs(session.userId).catch(console.error);
      return NextResponse.json({
        success: true,
        asset: {
          id: job.id,
          status: 'IN_QUEUE',
          progress: 0,
          url: '',
          prompt: job.prompt,
          aspect_ratio,
          model,
          inQueue: true,
          queueMessage: queueMsg,
          created_at: job.createdAt.toISOString(),
        },
        message: queueMsg,
      });
    }

    const { account: provider, reason: providerReason } = await selectProviderAccountForJobDetailed(
      pricing.walletType,
      modelKey,
      session.userId
    );

    if (!provider) {
      const internal =
        providerReason ||
        'In Queue: Waiting for a Google provider (BiB Launch / free user slot).';
      console.warn('[generate/i2i]', internal);
      const queueMsg = toUserFacingQueueMessage(internal);
      await prisma.generationJob.update({
        where: { id: job.id },
        data: { errorMessage: queueMsg },
      });
      checkAndDispatchNextJobs(session.userId).catch(console.error);
      return NextResponse.json({
        success: true,
        asset: {
          id: job.id,
          status: 'IN_QUEUE',
          progress: 0,
          url: '',
          prompt: job.prompt,
          aspect_ratio,
          model,
          inQueue: true,
          queueMessage: queueMsg,
          created_at: job.createdAt.toISOString(),
        },
        message: queueMsg,
      });
    }

    const sessionPrep = await prepareProviderWorkerSession(provider, session.userId);
    const liveCookies = sessionPrep.cookies || provider?.cookies || undefined;
    const targetProjectId = sessionPrep.projectId;

    const feModel = resolveImageFrontendModel(String(model || 'GEM_PIX_2'));
    const wireModel = resolveImageWireModel(feModel);

    await prisma.generationJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.GENERATING,
        providerAccountId: provider?.id,
        startedAt: new Date(),
        progress: 50,
        parameters: {
          aspect_ratio,
          seed,
          model: feModel,
          wireModel,
          image_id,
          image_ids,
          run_id: body.run_id || null,
          source: body.source || null,
          ...(targetProjectId ? { flowProjectId: targetProjectId } : {}),
        },
      },
    });

    try {
      const rawIds: string[] = Array.isArray(image_ids)
        ? image_ids.filter(Boolean)
        : image_id
          ? [image_id]
          : [];
      const stagedIds: string[] = Array.isArray(body.staged_ids)
        ? body.staged_ids.filter(Boolean)
        : body.staged_id
          ? [body.staged_id]
          : [];

      const resolvedIds = (
        await Promise.all([...rawIds, ...stagedIds].map((id) => resolveMediaId(id)))
      ).filter(Boolean) as string[];

      // Re-upload refs into THIS Google account/project so media becomes Ready
      const freshIds: string[] = [];
      for (const mid of resolvedIds) {
        const refreshed = await refreshFlowMediaId({
          mediaId: mid,
          cookies: liveCookies,
          projectId: targetProjectId,
        });
        freshIds.push(refreshed || mid);
      }

      // Characters: use portrait Flow media ids as remix refs (BiB; no Python CDP)
      const characters = Array.isArray(body.characters)
        ? body.characters
            .map((c: any) => ({
              entity_id: c.flow_entity_id || c.entity_id,
              flow_entity_id: c.flow_entity_id || c.entity_id || null,
              character_id: c.character_id || c.flow_character_id || null,
              name: c.name || c.display_name || 'Character',
              image_media_id: c.image_media_id || null,
              image_url: c.image_url || c.portraitUrl || null,
              local_image_path: c.local_image_path || null,
            }))
            .filter((c: any) => c.entity_id && c.flow_entity_id)
        : [];

      for (const c of characters) {
        const mid = c.image_media_id;
        if (!mid) continue;
        const refreshed = await refreshFlowMediaId({
          mediaId: mid,
          cookies: liveCookies,
          projectId: targetProjectId,
        });
        if (refreshed) freshIds.push(refreshed);
      }

      const flowRefs = [...new Set(freshIds.map((id) => String(id || '').trim()))].filter((id) =>
        /^[a-f0-9-]{36}$/i.test(id)
      );
      if (!flowRefs.length && !characters.length) {
        throw new Error('No Flow-ready reference image for I2I — select a ready image and retry');
      }

      console.info(
        `[i2i] BiB FE ${feModel} → wire ${wireModel} project=${targetProjectId || 'none'} refs=${flowRefs.length}`
      );
      if (body.run_id) {
        createStudioLog({
          level: 'info',
          source: 'generate',
          message: `I2I dispatching to Flow via BiB (project ${String(targetProjectId || 'default').slice(0, 8)}…)`,
          runId: String(body.run_id),
          userId: session.userId,
          userEmail: session.email,
        }).catch(() => 0);
      }

      await ensureBibAccountReady({
        id: provider.id,
        maxParallelLimit: provider.maxParallelLimit,
        flowProjectIds: provider.flowProjectIds,
        profileDir: provider.profileDir,
      });

      const { primary, primaryUrl, workerData } = await withSystemErrorRetry(
        async () => {
          const data = await bibGenerateImage({
            accountId: provider.id,
            prompt: job.prompt,
            aspectRatio: aspect_ratio,
            model: wireModel,
            projectId: targetProjectId,
            imageIds: flowRefs,
            imageId: flowRefs[0],
            characters,
            destinationCharacterId: body.destination_character_id || body.destinationCharacterId || undefined,
          });
          const list = data.assets || [];
          const p = list[0] || {
            id: data.mediaId,
            url: data.imageUrl || data.url,
            status: data.status,
          };
          const url = p.url || data.imageUrl || data.url || '';
          const st = String(p.status || data.status || '').toUpperCase();
          if (!url && !data.mediaId && st !== 'PROCESSING' && st !== 'PENDING') {
            throw new Error('BiB returned no image URL or media id');
          }
          return {
            primary: { ...p, id: p.id || data.mediaId, media_id: data.mediaId },
            primaryUrl: url,
            workerData: data,
          };
        },
        { label: `api-i2i-bib:${job.id}`, delayMs: 2000, maxAttempts: 3 }
      );

      const latest = await prisma.generationJob.findUnique({ where: { id: job.id } });
      if (latest?.status === JobStatus.CANCELLED) {
        return NextResponse.json({
          success: true,
          cancelled: true,
          asset: { id: job.id, status: 'CANCELLED', url: '', prompt: job.prompt },
        });
      }

      // Allow async PROCESSING (parity with I2V / ingredients) — do not fail when URL is empty yet
      if (primaryUrl) {
        await prisma.generationJob.update({
          where: { id: job.id },
          data: {
            status: JobStatus.COMPLETED,
            progress: 100,
            outputMediaUrl: primaryUrl,
            completedAt: new Date(),
            outputMetadata: {
              primary_media_id: primary.primary_media_id || primary.media_id || primary.id || null,
            },
          },
        });

        const shortId = job.id.substring(0, 8);
        const urlPath = String(primaryUrl || '').split('?')[0];
        const existingAsset = await prisma.asset.findFirst({
          where: {
            userId: session.userId,
            OR: [
              { fileName: { contains: shortId } },
              { url: primaryUrl },
              { storagePath: primaryUrl },
              ...(urlPath
                ? [{ url: { startsWith: urlPath } }, { storagePath: { startsWith: urlPath } }]
                : []),
            ],
          },
        });
        const savedAsset =
          existingAsset ||
          (await prisma.asset.create({
            data: {
              userId: session.userId,
              projectId: project.id,
              fileName: `i2i_${shortId}.png`,
              fileType: 'image',
              mimeType: 'image/png',
              fileSize: 512 * 1024,
              storagePath: primaryUrl,
              url: primaryUrl,
              upstreamAssetId: primary.primary_media_id || primary.media_id || null,
              expiresAt,
            },
          }));

        await settleCredits(session.userId, pricing.walletType, pricing.price, job.id);
        checkAndDispatchNextJobs(session.userId).catch(console.error);

        const returnedAsset = {
          id: job.id,
          assetId: savedAsset.id,
          status: 'COMPLETED',
          url: primaryUrl,
          prompt: job.prompt,
          aspect_ratio,
          model,
          type: 'image',
          created_at: job.createdAt.toISOString(),
        };

        return NextResponse.json({
          success: true,
          asset: returnedAsset,
          assets: [returnedAsset],
        });
      }

      await prisma.generationJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.GENERATING,
          progress: primary.progress || 20,
          outputMetadata: {
            workerTaskId: primary.id || workerData.operation_id || null,
            bibMediaId: primary.id || primary.primary_media_id || primary.media_id || null,
            bibAccountId: provider?.id || null,
            bibProjectId: targetProjectId || null,
          },
          ...(targetProjectId
            ? {
                parameters: {
                  ...((job.parameters as any) || {}),
                  flowProjectId: targetProjectId,
                },
              }
            : {}),
        },
      });

      return NextResponse.json({
        success: true,
        asset: {
          id: job.id,
          workerTaskId: primary.id,
          status: 'PROCESSING',
          progress: primary.progress || 20,
          url: '',
          prompt: job.prompt,
          aspect_ratio,
          model,
          type: 'image',
          created_at: job.createdAt.toISOString(),
        },
        assets: [
          {
            id: job.id,
            status: 'PROCESSING',
            progress: primary.progress || 20,
            url: '',
            type: 'image',
          },
        ],
      });
    } catch (workerErr: any) {
      console.error('I2I generation worker error:', workerErr.message);

      await prisma.generationJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.FAILED,
          errorMessage: workerErr.message || 'Image to image failed',
          completedAt: new Date(),
          expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
        },
      });

      await releaseCredits(
        session.userId,
        pricing.walletType,
        pricing.price,
        job.id,
        workerErr.message || 'Generation failed'
      );
      checkAndDispatchNextJobs(session.userId).catch(console.error);

      return NextResponse.json(
        {
          error: workerErr.message || 'Image to image failed',
          detail: workerErr.message,
          jobId: job.id,
          status: 'FAILED',
        },
        { status: 500 }
      );
    }
  } catch (err: any) {
    console.error('API /api/generate/image-to-image error:', err);
    return NextResponse.json({ error: err.message || 'Image to image failed' }, { status: 500 });
  }
}
