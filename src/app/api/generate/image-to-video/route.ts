import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getModelPricing, reserveCredits, settleCredits, releaseCredits, resolveModelPricing } from '@/lib/credits';
import { toUserFacingQueueMessage } from '@/lib/userMessages';
import { resolveVideoFrontendModel } from '@/lib/modelWire';
import { selectProviderAccountForJobDetailed } from '@/lib/routing';
import { getUserPlanLimit, countUserActiveJobs, checkAndDispatchNextJobs } from '@/lib/queue';
import { JobStatus, WalletType } from '@prisma/client';
import { withSystemErrorRetry } from '@/lib/systemErrorRetry';
import { prepareProviderWorkerSession, refreshFlowMediaId } from '@/lib/providerSession';
import { createStudioLog } from '@/lib/studioLogs';
import { bibGenerateVideo, ensureBibAccountReady, bibEnsureLabs } from '@/lib/bib';
import { resolveVideoWireModel } from '@/lib/modelWire';

function isMediaParseError(err: unknown) {
  const msg = String((err as any)?.message || err || '');
  if (/UNUSUAL_ACTIVITY|unusual\s*activity/i.test(msg)) return false;
  return /mediaId could not be parsed|No image URL|Flow project|media not ready|not found/i.test(msg);
}

function isLabsAuthError(err: unknown) {
  const msg = String((err as any)?.message || err || '');
  return /No labs access_token|aisandbox|reCAPTCHA mint failed|UNUSUAL_ACTIVITY/i.test(msg);
}

function isMediaRepairableError(err: unknown) {
  return isMediaParseError(err) || isLabsAuthError(err);
}

export async function POST(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const body = await req.json();
    const {
      prompt,
      image_id,
      first_frame_id,
      last_frame_id,
      frame_mode = 'first_only',
      aspect_ratio = '16:9',
      duration = 8,
      seed,
      model = 'VEO_3_1_LITE',
      projectId: clientProjectId,
    } = body;

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

    const pricing = (await resolveModelPricing(model)) || (await resolveModelPricing('veo_3_1_lite'))!;
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
        prompt: (prompt || 'Image to Video Animation').trim(),
        parameters: {
          aspect_ratio,
          duration,
          seed,
          model,
          frame_mode,
          first_frame_id,
          last_frame_id,
          image_id,
          run_id: body.run_id || null,
          source: body.source || null,
          staged_id: body.staged_id || null,
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

    // Bulk I2V background: enqueue only — dispatcher starts jobs as slots free.
    if (body.enqueue_only === true || body.background === true) {
      const queueMsg = toUserFacingQueueMessage('In Queue: Bulk I2V background');
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

    const planLimit = await getUserPlanLimit(session.userId);
    const activeJobs = await countUserActiveJobs(session.userId);
    const { account: provider, reason: providerReason } = await selectProviderAccountForJobDetailed(
      pricing.walletType,
      modelKey,
      session.userId
    );

    if (!provider || activeJobs >= planLimit) {
      const internal = !provider
        ? providerReason ||
          'In Queue: Waiting for a Google provider (BiB Launch / free user slot).'
        : `In Queue: Plan parallel generation limit (${planLimit}) reached.`;
      if (!provider) console.warn('[generate/i2v]', internal);
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

    await prisma.generationJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.PREPARING,
        providerAccountId: provider?.id,
        startedAt: new Date(),
      },
    });

    try {
      const sessionPrep = await prepareProviderWorkerSession(provider, session.userId);
      const liveCookies = sessionPrep.cookies || provider?.cookies || undefined;
      const targetProjectId = sessionPrep.projectId;

      const resolveMediaId = async (id?: string) => {
        if (!id) return id;
        if (String(id).startsWith('staged-') || String(id).startsWith('upload-')) {
          return id;
        }
        const urlMatch = id.match(/flow-content\.google\/(?:image|video)\/([a-f0-9-]+)/i);
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
      };

      const refreshOne = async (id?: string, forceReupload = false) => {
        const resolved = await resolveMediaId(id);
        if (!resolved) return resolved;
        return (
          (await refreshFlowMediaId({
            accountId: provider.id,
            mediaId: resolved,
            cookies: liveCookies,
            projectId: targetProjectId,
            forceReupload,
          })) || resolved
        );
      };

      const dualFrames =
        frame_mode === 'first_and_last' ||
        Boolean(first_frame_id && last_frame_id) ||
        Boolean(body.first_frame_staged_id && body.last_frame_staged_id);

      const [resFirst, resLast, resImg, resStaged, resFirstStaged, resLastStaged] = await Promise.all([
        refreshOne(first_frame_id, dualFrames),
        refreshOne(last_frame_id, dualFrames),
        refreshOne(image_id, dualFrames),
        refreshOne(body.staged_id, dualFrames),
        refreshOne(body.first_frame_staged_id, dualFrames),
        refreshOne(body.last_frame_staged_id, dualFrames),
      ]);

      const feModel = resolveVideoFrontendModel(model);
      const useR2v =
        frame_mode === 'first_and_last' ||
        Boolean(
          [resFirst, resImg, resStaged, resFirstStaged].find((id) =>
            /^[a-f0-9-]{36}$/i.test(String(id || ''))
          ) &&
            [resLast, resLastStaged].find((id) => /^[a-f0-9-]{36}$/i.test(String(id || '')))
        );
      const wireModel = resolveVideoWireModel(feModel, {
        mode: useR2v ? 'r2v' : 'i2v',
        duration,
        aspectRatio: aspect_ratio,
      });
      console.info(
        `[i2v] BiB FE ${model} → wire ${wireModel} project=${targetProjectId || 'none'} mode=${useR2v ? 'r2v' : 'i2v'}`
      );
      if (body.run_id) {
        createStudioLog({
          level: 'info',
          source: 'generate',
          message: `I2V dispatching to Flow via BiB (project ${String(targetProjectId || 'default').slice(0, 8)}…)`,
          runId: String(body.run_id),
          userId: session.userId,
          userEmail: session.email,
        }).catch(() => 0);
      }

      const firstId =
        [resFirst, resImg, resStaged, resFirstStaged]
          .map((id) => String(id || '').trim())
          .find((id) => /^[a-f0-9-]{36}$/i.test(id)) || null;
      const lastId =
        [resLast, resLastStaged]
          .map((id) => String(id || '').trim())
          .find((id) => /^[a-f0-9-]{36}$/i.test(id)) || null;

      if (dualFrames && (!firstId || !lastId)) {
        throw new Error(
          'First and last frames must both be Flow-ready UUIDs. Re-upload the frames and retry.'
        );
      }

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
      for (const c of charRefs) {
        if (!c.image_media_id) continue;
        const mid = await refreshOne(String(c.image_media_id));
        if (mid && /^[a-f0-9-]{36}$/i.test(mid)) c.image_media_id = mid;
      }

      if (frame_mode === 'last_only' && lastId && !firstId) {
        // last-only: use last as start frame
      } else if (!firstId && !lastId && !charRefs.length) {
        throw new Error(
          'No Flow-ready frame image. Wait until the reference shows Ready, then retry.'
        );
      }

      await ensureBibAccountReady({
        id: provider.id,
        maxParallelLimit: provider.maxParallelLimit,
        flowProjectIds: provider.flowProjectIds,
        profileDir: provider.profileDir,
      });

      const startId =
        frame_mode === 'last_only' ? lastId || firstId : firstId || lastId;
      // When both frames are present, treat as ingredients-style multi-ref (not StartImage end frame)
      const ingredientRefs =
        dualFrames && firstId && lastId && firstId !== lastId
          ? [firstId, lastId]
          : ([startId].filter(Boolean) as string[]);

      const aspectMap: Record<string, number> = { '16:9': 2, '9:16': 1, '1:1': 1 };
      const runI2v = async (refs: string[]) => {
        const multi = refs.length > 1;
        if (multi) {
          console.info(
            `[i2v] dual frames → ingredients-style multi-ref (${refs.map((r) => r.slice(0, 8)).join('+')})`
          );
        }
        return bibGenerateVideo({
          accountId: provider.id,
          mode: multi ? 'r2v' : 'i2v',
          prompt: job.prompt,
          imageId: refs[0] || undefined,
          // Do not pass endImageId — that triggers StartImage; ingredients use imageIds only
          imageIds: refs,
          characters: charRefs,
          videoModel: wireModel,
          aspect: aspectMap[String(aspect_ratio)] || 2,
          aspectRatio: aspect_ratio,
          projectId: targetProjectId,
          waitForCompletion: false,
        });
      };

      let bibResult;
      try {
        bibResult = await withSystemErrorRetry(
          async () => runI2v(ingredientRefs),
          { label: `api-i2v-bib:${job.id}`, delayMs: 2000, maxAttempts: 3, throttleDelaysMs: [10000, 20000], providerAccountId: provider.id, jobId: job.id }
        );
      } catch (err) {
        if (!isMediaRepairableError(err)) throw err;
        const forceReupload = isMediaParseError(err);
        console.warn(
          `[i2v] BiB failed (${(err as Error).message}); ${
            forceReupload ? 're-uploading frames' : 'warming labs then retrying'
          }`
        );
        if (body.run_id) {
          createStudioLog({
            level: 'info',
            source: 'generate',
            message: forceReupload
              ? 'Media repair: re-uploading frames into Flow project, then retrying…'
              : 'Retrying I2V after labs/aisandbox error…',
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
        if (isLabsAuthError(err)) {
          const labs = await bibEnsureLabs(provider.id).catch((e) => ({
            success: false,
            error: (e as Error).message,
          }));
          if (!(labs as any)?.hasAccessToken && !(labs as any)?.success) {
            throw new Error(
              (labs as any)?.error ||
                (err as Error).message ||
                'No labs access_token for aisandbox — sign into labs.google in BiB viewer, then retry'
            );
          }
        }
        const repairedRefs: string[] = [];
        for (const mid of ingredientRefs) {
          const next =
            (await refreshFlowMediaId({
              accountId: provider.id,
              mediaId: mid,
              cookies: liveCookies,
              projectId: targetProjectId,
              forceReupload,
            })) || mid;
          if (next && /^[a-f0-9-]{36}$/i.test(next) && !repairedRefs.includes(next)) {
            repairedRefs.push(next);
          }
        }
        if (dualFrames && repairedRefs.length < 2) {
          throw new Error(
            'First and last frames must both be Flow-ready after repair. Re-upload and retry.'
          );
        }
        bibResult = await runI2v(repairedRefs.length ? repairedRefs : ingredientRefs);
      }

      const workerAsset = {
        id: bibResult.mediaId,
        url: bibResult.videoUrl || bibResult.url || '',
        status: (bibResult.status || (bibResult.videoUrl || bibResult.url ? 'COMPLETED' : 'PROCESSING')).toUpperCase(),
        progress: bibResult.videoUrl || bibResult.url ? 100 : 20,
      };

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
        try {
          const { recordJobProxyOutcome } = await import('@/lib/dataimpulse');
          recordJobProxyOutcome(job, 'ok');
        } catch {
          /* ignore */
        }

        await prisma.asset.create({
          data: {
            userId: session.userId,
            projectId: project.id,
            fileName: `i2v_${job.id.substring(0, 8)}.mp4`,
            fileType: 'video',
            mimeType: 'video/mp4',
            fileSize: 1024 * 1024,
            storagePath: workerAsset.url,
            url: workerAsset.url,
            expiresAt,
          },
        });

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

      await prisma.generationJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.GENERATING,
          progress: workerAsset.progress || 20,
          outputMetadata: {
            workerTaskId: workerAsset.id,
            bibMediaId: workerAsset.id || null,
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
          workerTaskId: workerAsset.id,
          status: 'PROCESSING',
          progress: workerAsset.progress || 20,
          url: '',
          prompt: job.prompt,
          aspect_ratio,
          duration,
          model,
          created_at: job.createdAt.toISOString(),
        },
      });
    } catch (workerErr: any) {
      console.error('I2V generation worker error:', workerErr.message);

      await prisma.generationJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.FAILED,
          errorMessage: workerErr.message || 'Image to video failed',
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
          error: workerErr.message || 'Image to video failed',
          detail: workerErr.message,
          jobId: job.id,
          status: 'FAILED',
        },
        { status: 500 }
      );
    }
  } catch (err: any) {
    console.error('API /api/generate/image-to-video error:', err);
    return NextResponse.json({ error: err.message || 'Image to video failed' }, { status: 500 });
  }
}
