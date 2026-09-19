import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getModelPricing, reserveCredits, settleCredits, releaseCredits, resolveModelPricing } from '@/lib/credits';
import { selectProviderAccountForJobDetailed } from '@/lib/routing';
import { getUserPlanLimit, countUserActiveJobs, checkAndDispatchNextJobs } from '@/lib/queue';
import { JobStatus, WalletType, BrowserStatus } from '@prisma/client';
import { PYTHON_WORKER_URL, workerIdentityHeaders } from '@/lib/worker';
import { withSystemErrorRetry } from '@/lib/systemErrorRetry';
import { resolveMediaExpiresAt } from '@/lib/mediaExpiry';
import { bibGenerateImage, ensureBibAccountReady } from '@/lib/bib';
import { createStudioLog, logGenerationQueued } from '@/lib/studioLogs';
import { resolveTargetFlowProject } from '@/lib/flowProjects';
import { resolveImageFrontendModel, resolveImageWireModel, nextImageWireModel, isImageModelQuotaError } from '@/lib/modelWire';
// image remaps: Python remaps FE→wire once; BiB needs wire keys directly.

export async function POST(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const body = await req.json();
    const {
      prompt,
      aspect_ratio = '1:1',
      model = 'GEM_PIX_2',
      num_images = 1,
      seed,
      characters,
      projectId: clientProjectId,
    } = body;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    // 1. Resolve project
    let project = clientProjectId
      ? await prisma.project.findFirst({ where: { id: clientProjectId, userId: session.userId, deletedAt: null } })
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

    // 2. Resolve model key and pricing (includes admin price overrides)
    const pricing = (await resolveModelPricing(model)) || (await resolveModelPricing('nano_banana_pro'))!;
    const modelKey = pricing.modelKey;
    const feModel = resolveImageFrontendModel(String(model || 'GEM_PIX_2'));
    const wireModel = resolveImageWireModel(feModel);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // 3. Create job record in IN_QUEUE status
    const job = await prisma.generationJob.create({
      data: {
        userId: session.userId,
        projectId: project.id,
        modelKey,
        walletType: pricing.walletType,
        creditCost: pricing.price,
        status: JobStatus.IN_QUEUE,
        progress: 0,
        prompt: prompt.trim(),
        parameters: {
          aspect_ratio,
          num_images,
          seed,
          model,
          characters: characters || [],
          run_id: body.run_id || null,
          source: body.source || null,
        },
        characterIds: Array.isArray(characters) ? characters : [],
        expiresAt,
      },
    });

    // 4. Reserve credits atomically
    try {
      await reserveCredits(session.userId, modelKey, job.id);
    } catch (creditErr: any) {
      await prisma.generationJob.delete({ where: { id: job.id } });
      return NextResponse.json(
        {
          error: creditErr.message || `Insufficient ${pricing.walletType} credits (${pricing.price} needed)`,
          detail: creditErr.message,
        },
        { status: 402 }
      );
    }

    // Storyteller / Bulk T2I background: enqueue only — dispatcher starts jobs as parallel slots free.
    if (body.enqueue_only === true || body.background === true) {
      const planLimit = await getUserPlanLimit(session.userId);
      const activeJobs = await countUserActiveJobs(session.userId);
      const queueMsg = await logGenerationQueued({
        runId: body.run_id || job.id,
        userId: session.userId,
        userEmail: session.email,
        prompt: job.prompt,
        source: body.source || 'bulkt2i',
        kind: 'image',
        planLimit,
        activeJobs,
      });
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

    // 5. Check user plan capacity (Free=1, Starter=3, Pro=5, Business=10)
    const planLimit = await getUserPlanLimit(session.userId);
    const activeJobs = await countUserActiveJobs(session.userId);

    // 6. Select provider account (sticky user slots; plan maxParallel gates concurrent gens)
    const { account: provider, reason: providerReason } = await selectProviderAccountForJobDetailed(
      pricing.walletType,
      modelKey,
      session.userId
    );

    if (!provider || activeJobs >= planLimit) {
      const queueMsg = await logGenerationQueued({
        runId: body.run_id || job.id,
        userId: session.userId,
        userEmail: session.email,
        flowEmail: provider?.accountEmail || null,
        prompt: job.prompt,
        source: body.source || 'image',
        kind: 'image',
        planLimit,
        activeJobs,
        noProvider: !provider,
      });
      if (!provider) {
        console.warn(
          '[generate/image]',
          providerReason || 'In Queue: Waiting for a Google provider (BiB Launch / free user slot).'
        );
      }

      await prisma.generationJob.update({
        where: { id: job.id },
        data: { errorMessage: queueMsg },
      });

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

    // 7. Forward to BiB worker (preferred) or legacy Python CDP worker
    const genStartedAt = Date.now();
    try {
      const flowIds = Array.isArray(provider.flowProjectIds)
        ? (provider.flowProjectIds as string[])
        : [];
      let useBib =
        !!provider.id &&
        (provider.browserStatus === BrowserStatus.READY || flowIds.length > 0);

      // Live BiB check — Prisma can lag behind the running browser
      if (provider.id && !useBib) {
        try {
          const { bibAccountStatus } = await import('@/lib/bib');
          const live = await bibAccountStatus(provider.id);
          if (live?.status === 'READY' || live?.authenticated || (live?.projectCount || 0) > 0) {
            useBib = true;
            if (Array.isArray(live.projectIds) && live.projectIds.length) {
              flowIds.splice(0, flowIds.length, ...live.projectIds);
              await prisma.providerAccount.update({
                where: { id: provider.id },
                data: {
                  browserStatus: BrowserStatus.READY,
                  flowProjectIds: live.projectIds,
                  status: 'HEALTHY' as any,
                },
              });
            }
          }
        } catch {
          /* BiB unreachable */
        }
      }

      const providerForPick = {
        id: provider.id,
        flowProjectIds: flowIds.length ? flowIds : provider.flowProjectIds,
        activeProjectId: provider.activeProjectId,
        projectUrl: provider.projectUrl,
      };
      const assignedIds = (
        await prisma.user.findMany({
          where: { assignedProviderAccountId: provider.id },
          select: { id: true },
        })
      ).map((u) => u.id);
      const targetProjectId = await resolveTargetFlowProject(providerForPick, {
        preferredUserId: session.userId,
        assignedUserIds: assignedIds,
      });

      // Mark GENERATING + record which Flow project slot this user is using
      const prevParams =
        job.parameters && typeof job.parameters === 'object' && !Array.isArray(job.parameters)
          ? (job.parameters as Record<string, unknown>)
          : {};
      await prisma.generationJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.GENERATING,
          providerAccountId: provider?.id,
          startedAt: new Date(),
          progress: 50,
          parameters: {
            ...prevParams,
            model: feModel,
            wireModel,
            ...(targetProjectId ? { flowProjectId: targetProjectId } : {}),
          },
        },
      });

      console.info(
        `[image] FE ${feModel} → wire ${wireModel} via ${useBib ? 'BiB' : 'Python'} project=${targetProjectId || 'none'}`
      );

      if (useBib && provider?.id) {
        await ensureBibAccountReady({
          id: provider.id,
          maxParallelLimit: provider.maxParallelLimit,
          flowProjectIds: flowIds.length ? flowIds : provider.flowProjectIds,
          profileDir: provider.profileDir,
        });
      }

      let attemptModel = wireModel;
      const { primaryUrl } = await withSystemErrorRetry(
        async () => {
          if (useBib) {
            const charPayload = Array.isArray(characters)
              ? characters
                  .map((c: any) => ({
                    entity_id: c.flow_entity_id || c.entity_id,
                    flow_entity_id: c.flow_entity_id || c.entity_id || null,
                    character_id: c.character_id || c.flow_character_id || null,
                    name: c.name || c.display_name || 'Character',
                    image_media_id: c.image_media_id || null,
                    image_url: c.image_url || c.portraitUrl || null,
                  }))
                  .filter((c: any) => c.entity_id && c.flow_entity_id)
              : [];
            const bibData = await bibGenerateImage({
              accountId: provider.id,
              prompt: job.prompt!,
              aspectRatio: aspect_ratio,
              model: attemptModel,
              projectId: targetProjectId,
              characters: charPayload,
            });
            const url = bibData.imageUrl || bibData.url || bibData.assets?.[0]?.url;
            if (!url) {
              // BiB may return mediaId while Flow is still rendering
              if (bibData.mediaId) {
                throw new Error(
                  `BiB image still processing (mediaId ${String(bibData.mediaId).slice(0, 8)}…) — retry shortly`
                );
              }
              throw new Error(bibData.error || 'BiB returned no image URL');
            }
            return { primaryUrl: url, workerData: bibData, assetsList: [{ url }] };
          }

          throw new Error('BiB provider required for image generation — Launch account in Admin');
        },
        {
          label: `api-image:${job.id}`,
          delayMs: 1800,
          providerAccountId: provider.id,
          jobId: job.id,
          onRetry: async (err) => {
            if (!isImageModelQuotaError(err)) return;
            const prev = attemptModel;
            attemptModel = nextImageWireModel(attemptModel);
            console.warn(
              `[api-image:${job.id}] daily quota on ${prev} — retry with next image model ${attemptModel}`
            );
          },
        }
      );

      // User may have pressed Stop while worker was running
      const latest = await prisma.generationJob.findUnique({ where: { id: job.id } });
      if (latest?.status === JobStatus.CANCELLED) {
        return NextResponse.json({
          success: true,
          cancelled: true,
          asset: { id: job.id, status: 'CANCELLED', url: '', prompt: job.prompt },
        });
      }

      // Mark COMPLETED — store Google CDN Expires= when present
      const durationMs = Date.now() - genStartedAt;
      const durationSec = Math.max(0.1, durationMs / 1000);
      const mediaExpiresAt = resolveMediaExpiresAt(primaryUrl, expiresAt) || expiresAt;
      await prisma.generationJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.COMPLETED,
          progress: 100,
          outputMediaUrl: primaryUrl,
          completedAt: new Date(),
          expiresAt: mediaExpiresAt,
        },
      });
      try {
        const { recordJobProxyOutcome } = await import('@/lib/dataimpulse');
        recordJobProxyOutcome(job, 'ok');
      } catch {
        /* ignore */
      }

      try {
        const runId = String(body.run_id || job.id);
        await createStudioLog({
          level: 'info',
          message: `T2I complete (${durationSec.toFixed(1)}s): ${(job.prompt || 'image').slice(0, 80)}`,
          source: 'generate',
          runId,
          userId: session.userId,
        });
      } catch {
        /* ignore */
      }

      // Save into prisma.asset
      const savedAsset = await prisma.asset.create({
        data: {
          userId: session.userId,
          projectId: project.id,
          fileName: `image_${job.id.substring(0, 8)}.png`,
          fileType: 'image',
          mimeType: 'image/png',
          fileSize: 512 * 1024,
          storagePath: primaryUrl,
          url: primaryUrl,
          expiresAt: mediaExpiresAt,
        },
      });

      // Settle credits
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
        durationMs,
        durationSec: Number(durationSec.toFixed(1)),
        characters: Array.isArray(characters) ? characters : [],
      };

      return NextResponse.json({
        success: true,
        asset: returnedAsset,
        assets: [returnedAsset],
        durationMs,
        durationSec: Number(durationSec.toFixed(1)),
      });
    } catch (workerErr: any) {
      console.error('Image generation worker error:', workerErr.message);

      await prisma.generationJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.FAILED,
          errorMessage: workerErr.message || 'Image generation failed',
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
          error: workerErr.message || 'Image generation failed',
          detail: workerErr.message,
          jobId: job.id,
          status: 'FAILED',
        },
        { status: 500 }
      );
    }
  } catch (err: any) {
    console.error('API /api/generate/image error:', err);
    return NextResponse.json({ error: err.message || 'Image generation failed' }, { status: 500 });
  }
}
