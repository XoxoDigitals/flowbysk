import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getModelPricing, reserveCredits, settleCredits, releaseCredits, resolveModelPricing } from '@/lib/credits';
import { toUserFacingQueueMessage } from '@/lib/userMessages';
import { resolveVideoFrontendModel, resolveVideoWireModel } from '@/lib/modelWire';
import { selectProviderAccountForJobDetailed } from '@/lib/routing';
import { getUserPlanLimit, countUserActiveJobs, checkAndDispatchNextJobs } from '@/lib/queue';
import { JobStatus, WalletType, BrowserStatus } from '@prisma/client';
import { PYTHON_WORKER_URL, formatWorkerFetchError, workerIdentityHeaders } from '@/lib/worker';
import { fetchWorkerJsonWithSystemRetry, withSystemErrorRetry } from '@/lib/systemErrorRetry';
import { bibGenerateVideo, BIB_WORKER_URL, ensureBibAccountReady } from '@/lib/bib';
import { resolveTargetFlowProject } from '@/lib/flowProjects';
import { createStudioLog } from '@/lib/studioLogs';

export async function POST(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const body = await req.json();
    const {
      prompt,
      aspect_ratio = '16:9',
      duration = 8,
      seed,
      model = 'VEO_3_1_LITE',
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
    const pricing = (await resolveModelPricing(model)) || (await resolveModelPricing('veo_3_1_lite'))!;
    const modelKey = pricing.modelKey;
    const feModel = resolveVideoFrontendModel(model);
    const wireModel = resolveVideoWireModel(model, {
      mode: 't2v',
      duration: Number(duration) || 8,
      aspectRatio: String(aspect_ratio || '16:9'),
    });

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
          duration,
          seed,
          model,
          run_id: body.run_id || null,
          source: body.source || null,
        },
        characterIds: characters || [],
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

    // Bulk T2V / Storyteller-style background: enqueue only — dispatcher starts jobs as slots free.
    if (body.enqueue_only === true || body.background === true) {
      const queueMsg = toUserFacingQueueMessage('In Queue: Bulk T2V background');
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
          duration,
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

    // 6. Select provider account (sticky user slots on Google account; plan maxParallel gates concurrent gens)
    const { account: provider, reason: providerReason } = await selectProviderAccountForJobDetailed(
      pricing.walletType,
      modelKey,
      session.userId
    );

    if (!provider || activeJobs >= planLimit) {
      // Keep in queue
      const internal = !provider
        ? providerReason ||
          'In Queue: Waiting for a Google provider (BiB Launch / free user slot).'
        : `In Queue: Plan parallel generation limit (${planLimit}) reached.`;
      if (!provider) console.warn('[generate/video]', internal);
      const queueMsg = toUserFacingQueueMessage(internal);

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
          duration,
          model,
          inQueue: true,
          queueMessage: queueMsg,
          created_at: job.createdAt.toISOString(),
        },
        message: queueMsg,
      });
    }

    // 7. Mark status PREPARING / GENERATING
    const assignedIds = (
      await prisma.user.findMany({
        where: { assignedProviderAccountId: provider.id },
        select: { id: true },
      })
    ).map((u) => u.id);
    const targetProjectId = await resolveTargetFlowProject(
      {
        id: provider.id,
        flowProjectIds: provider.flowProjectIds,
        activeProjectId: provider.activeProjectId,
        projectUrl: provider.projectUrl,
      },
      { preferredUserId: session.userId, assignedUserIds: assignedIds }
    );
    const prevParams =
      job.parameters && typeof job.parameters === 'object' && !Array.isArray(job.parameters)
        ? (job.parameters as Record<string, unknown>)
        : {};
    await prisma.generationJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.PREPARING,
        providerAccountId: provider.id,
        startedAt: new Date(),
        parameters: {
          ...prevParams,
          model: feModel,
          wireModel,
          ...(targetProjectId ? { flowProjectId: targetProjectId } : {}),
        },
      },
    });

    // 8. Forward to BiB (preferred) or Python worker
    try {
      const flowIds = Array.isArray(provider.flowProjectIds)
        ? (provider.flowProjectIds as string[])
        : [];

      const useBib =
        provider.browserStatus === BrowserStatus.READY || flowIds.length > 0;

      let workerAsset: any = {};
      let workerData: any = {};

      if (useBib) {
        const aspectMap: Record<string, number> = { '16:9': 2, '9:16': 1, '1:1': 1 };
        console.info(`[video] FE ${feModel} → wire ${wireModel} via BiB`);
        await ensureBibAccountReady({
          id: provider.id,
          maxParallelLimit: provider.maxParallelLimit,
          flowProjectIds: provider.flowProjectIds,
          profileDir: provider.profileDir,
        });
        try {
          const bibData = await withSystemErrorRetry(
            async () => {
              const charRefs = Array.isArray(body.characters)
                ? body.characters
                    .map((c: any) => ({
                      entity_id: c.flow_entity_id || c.entity_id,
                      flow_entity_id: c.flow_entity_id || c.entity_id || null,
                      character_id: c.character_id || c.flow_character_id || null,
                      name: c.name || c.display_name || 'Character',
                      image_media_id: c.image_media_id || null,
                    }))
                    .filter((c: any) => c.entity_id && c.flow_entity_id)
                : [];
              return bibGenerateVideo({
                accountId: provider.id,
                mode: 't2v',
                prompt: job.prompt,
                videoModel: wireModel,
                aspect: aspectMap[String(aspect_ratio)] || 2,
                aspectRatio: aspect_ratio,
                projectId: targetProjectId,
                waitForCompletion: false,
                characters: charRefs,
              });
            },
            {
              label: `api-video-bib:${job.id}`,
              delayMs: 2000,
              maxAttempts: 3,
              providerAccountId: provider.id,
            }
          );
          workerData = bibData;
          const doneUrl = bibData.videoUrl || bibData.url;
          if (doneUrl) {
            workerAsset = { status: 'COMPLETED', url: doneUrl, id: bibData.mediaId };
          } else if (bibData.mediaId) {
            workerAsset = {
              status: 'PROCESSING',
              progress: 20,
              id: bibData.mediaId,
              bibMediaId: bibData.mediaId,
              bibProjectId: bibData.projectId || targetProjectId,
              bibAccountId: provider.id,
            };
          } else {
            throw new Error(bibData.error || 'BiB video returned no mediaId');
          }
        } catch (bibErr: any) {
          throw new Error(
            formatWorkerFetchError(bibErr, {
              workerLabel: 'BiB video worker',
              workerUrl: BIB_WORKER_URL,
            })
          );
        }
      } else {
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
          : body.characters;

        const workerPayload = {
          prompt: job.prompt,
          aspect_ratio,
          duration,
          seed,
          model: feModel,
          characters,
          project_id: targetProjectId,
          cookies: provider.cookies || undefined,
          run_id: body.run_id || job.id,
        };
        console.info(`[video] FE model ${model} → worker FE-key ${feModel} (Python remaps to Flow wire)`);

        workerData = await fetchWorkerJsonWithSystemRetry(
          `${PYTHON_WORKER_URL}/api/generate/video`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...workerIdentityHeaders({
                ...session,
                runId: body.run_id || job.id,
              }),
            },
            body: JSON.stringify(workerPayload),
          },
          { label: `api-video:${job.id}`, delayMs: 1800, providerAccountId: provider.id }
        );
        workerAsset = workerData.asset || {};
      }

      // If video completed immediately
      if (workerAsset.status === 'COMPLETED' && workerAsset.url) {
        await prisma.generationJob.update({
          where: { id: job.id },
          data: {
            status: JobStatus.COMPLETED,
            progress: 100,
            outputMediaUrl: workerAsset.url,
            completedAt: new Date(),
          },
        });

        // Save into prisma.asset idempotently
        const shortId = job.id.substring(0, 8);
        const existingAsset = await prisma.asset.findFirst({
          where: {
            userId: session.userId,
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
              userId: session.userId,
              projectId: project.id,
              fileName: `veo_${shortId}.mp4`,
              fileType: 'video',
              mimeType: 'video/mp4',
              fileSize: 1024 * 1024,
              storagePath: workerAsset.url,
              url: workerAsset.url,
              expiresAt,
            },
          });
        }

        // Settle credits
        await settleCredits(session.userId, pricing.walletType, pricing.price, job.id);
        checkAndDispatchNextJobs(session.userId).catch(console.error);

        return NextResponse.json({
          success: true,
          asset: {
            id: job.id,
            status: 'COMPLETED',
            url: workerAsset.url,
            prompt: job.prompt,
            aspect_ratio,
            duration,
            model,
            created_at: job.createdAt.toISOString(),
          },
        });
      }

      // If video is rendering asynchronously in background
      await prisma.generationJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.GENERATING,
          progress: workerAsset.progress || 15,
          outputMetadata: {
            workerTaskId: workerAsset.id,
            bibMediaId: workerAsset.bibMediaId || null,
            bibProjectId: workerAsset.bibProjectId || targetProjectId || null,
            bibAccountId: workerAsset.bibAccountId || provider.id || null,
          },
        },
      });

      if (body.run_id) {
        createStudioLog({
          level: 'info',
          source: 'generate',
          message: `T2V submitted — polling Flow for result…`,
          runId: String(body.run_id),
          userId: session.userId,
          userEmail: session.email,
        }).catch(() => 0);
      }

      return NextResponse.json({
        success: true,
        asset: {
          id: job.id,
          workerTaskId: workerAsset.id,
          status: 'PROCESSING',
          progress: workerAsset.progress || 15,
          url: '',
          prompt: job.prompt,
          aspect_ratio,
          duration,
          model,
          created_at: job.createdAt.toISOString(),
        },
      });
    } catch (workerErr: any) {
      const workerMsg =
        typeof workerErr?.message === 'string' && /BiB|8010/i.test(workerErr.message)
          ? workerErr.message
          : formatWorkerFetchError(workerErr);
      console.error('Video generation worker error:', workerMsg);

      await prisma.generationJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.FAILED,
          errorMessage: workerMsg || 'Video generation failed',
          completedAt: new Date(),
          expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
        },
      });

      await releaseCredits(
        session.userId,
        pricing.walletType,
        pricing.price,
        job.id,
        workerMsg || 'Generation failed'
      );
      checkAndDispatchNextJobs(session.userId).catch(console.error);

      return NextResponse.json(
        {
          error: workerMsg || 'Video generation failed',
          detail: workerMsg,
          jobId: job.id,
          status: 'FAILED',
        },
        { status: 500 }
      );
    }
  } catch (err: any) {
    console.error('API /api/generate/video error:', err);
    return NextResponse.json({ error: err.message || 'Video generation failed' }, { status: 500 });
  }
}
