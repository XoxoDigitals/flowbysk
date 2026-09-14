import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getModelPricing, reserveCredits, settleCredits, releaseCredits, resolveModelPricing } from '@/lib/credits';
import { toUserFacingQueueMessage } from '@/lib/userMessages';
import { selectProviderAccountForJobDetailed } from '@/lib/routing';
import { getUserPlanLimit, countUserActiveJobs, checkAndDispatchNextJobs } from '@/lib/queue';
import { JobStatus, WalletType } from '@prisma/client';
import { withSystemErrorRetry } from '@/lib/systemErrorRetry';
import { prepareProviderWorkerSession, refreshFlowMediaId } from '@/lib/providerSession';
import { createStudioLog } from '@/lib/studioLogs';
import { bibGenerateImage, bibGenerateVideo, ensureBibAccountReady, bibEnsureLabs } from '@/lib/bib';
import {
  resolveImageFrontendModel,
  resolveImageWireModel,
  resolveVideoFrontendModel,
  resolveVideoWireModel,
} from '@/lib/modelWire';

function isMediaParseError(err: unknown) {
  const msg = String((err as any)?.message || err || '');
  return /mediaId could not be parsed|No image URL|Flow project|media not ready|not found/i.test(msg);
}

function isLabsAuthError(err: unknown) {
  const msg = String((err as any)?.message || err || '');
  return /No labs access_token|aisandbox|reCAPTCHA mint failed|UNUSUAL_ACTIVITY/i.test(msg);
}

function isMediaRepairableError(err: unknown) {
  return isMediaParseError(err) || isLabsAuthError(err);
}

async function repairFlowRefs(opts: {
  refs: string[];
  cookies?: string;
  projectId?: string;
  accountId?: string;
  forceReupload?: boolean;
}) {
  const out: string[] = [];
  for (const mid of opts.refs) {
    const next =
      (await refreshFlowMediaId({
        accountId: opts.accountId,
        mediaId: mid,
        cookies: opts.cookies,
        projectId: opts.projectId,
        forceReupload: opts.forceReupload !== false,
      })) || mid;
    if (next && !out.includes(next)) out.push(next);
  }
  return out;
}

function isFlowUuid(id: string) {
  return /^[a-f0-9-]{36}$/i.test(id);
}

export async function POST(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const body = await req.json();
    const {
      prompt,
      output_type = 'video',
      ingredient_ids,
      staged_ids,
      characters,
      aspect_ratio = '16:9',
      duration = 8,
      seed,
      model = output_type === 'video' ? 'VEO_3_1_LITE' : 'GEM_PIX_2',
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

    const pricing =
      (await resolveModelPricing(model)) ||
      (output_type === 'video'
        ? await resolveModelPricing('veo_3_1_lite')
        : await resolveModelPricing('nano_banana_pro'))!;
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
        prompt: (prompt || 'Ingredients Composition').trim(),
        parameters: {
          output_type,
          aspect_ratio,
          duration,
          seed,
          model,
          ingredient_ids,
          staged_ids,
          characters: Array.isArray(characters) ? characters : undefined,
          run_id: body.run_id || null,
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

    const { account: provider, reason: providerReason } = await selectProviderAccountForJobDetailed(
      pricing.walletType,
      modelKey,
      session.userId
    );

    if (!provider) {
      const internal =
        providerReason ||
        'In Queue: Waiting for a Google provider (BiB Launch / free user slot).';
      console.warn('[generate/ingredients]', internal);
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
          duration,
          model,
          type: output_type,
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
        providerAccountId: provider.id,
        startedAt: new Date(),
      },
    });

    try {
      const sessionPrep = await prepareProviderWorkerSession(provider, session.userId);
      const liveCookies = sessionPrep.cookies || provider?.cookies || undefined;
      const targetProjectId = sessionPrep.projectId;

      const resolveMediaId = async (id?: string) => {
        if (!id) return id;
        // Already a Python staged / upload id — pass through
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

      const refreshOne = async (id?: string) => {
        const resolved = await resolveMediaId(id);
        if (!resolved) return resolved;
        // Includes staged-* → Flow UUID via HTTP upload (not CDP generation)
        return (
          (await refreshFlowMediaId({
            accountId: provider.id,
            mediaId: resolved,
            cookies: liveCookies,
            projectId: targetProjectId,
          })) || resolved
        );
      };

      const resolvedIngredientIds = (
        await Promise.all((ingredient_ids || []).map((id: string) => refreshOne(id)))
      ).filter(Boolean) as string[];
      const resolvedStagedIds = (
        await Promise.all((staged_ids || []).map((id: string) => refreshOne(id)))
      ).filter(Boolean) as string[];

      console.info(
        `[ingredients] BiB project=${targetProjectId || 'none'} refs=${resolvedIngredientIds.length + resolvedStagedIds.length}`
      );
      if (body.run_id) {
        createStudioLog({
          level: 'info',
          source: 'generate',
          message: `Ingredients dispatching to Flow (project ${String(targetProjectId || 'default').slice(0, 8)}…)`,
          runId: String(body.run_id),
          userId: session.userId,
          userEmail: session.email,
        }).catch(() => 0);
      }

      const requestedRefCount =
        (Array.isArray(ingredient_ids) ? ingredient_ids.length : 0) +
        (Array.isArray(staged_ids) ? staged_ids.length : 0);

      let flowRefs = [...resolvedIngredientIds, ...resolvedStagedIds]
        .map((id) => String(id || '').trim())
        .filter(Boolean);

      const unresolved = flowRefs.filter((id) => !isFlowUuid(id));
      if (unresolved.length) {
        throw new Error(
          `Ingredient image(s) not uploaded to Flow yet (${unresolved
            .map((id) => id.slice(0, 24))
            .join(', ')}). Wait until Ready, then retry.`
        );
      }
      flowRefs = flowRefs.filter(isFlowUuid);
      if (requestedRefCount > 0 && flowRefs.length < requestedRefCount) {
        throw new Error(
          `Only ${flowRefs.length}/${requestedRefCount} ingredient images are Flow-ready. Wait until all show Ready, then retry.`
        );
      }

      const charRefs = Array.isArray(characters)
        ? characters
            .map((c: any) => ({
              entity_id: c.flow_entity_id || c.entity_id,
              flow_entity_id: c.flow_entity_id || c.entity_id || null,
              character_id: c.character_id || c.flow_character_id || null,
              name: c.name || c.display_name || 'Character',
              image_media_id: c.image_media_id || null,
            }))
            .filter((c: any) => c.entity_id && c.flow_entity_id)
        : [];

      // Refresh character portraits into this Flow project when present.
      // Do NOT merge portraits into flowRefs — that falsely triggers multi-ref aisandbox.
      for (const c of charRefs) {
        if (!c.image_media_id) continue;
        const mid = await refreshOne(String(c.image_media_id));
        if (mid && isFlowUuid(mid)) c.image_media_id = mid;
      }

      if (!flowRefs.length && !charRefs.length) {
        throw new Error(
          'No Flow-ready ingredient image or character. Wait until the reference shows Ready, then retry.'
        );
      }

      await ensureBibAccountReady({
        id: provider.id,
        maxParallelLimit: provider.maxParallelLimit,
        flowProjectIds: provider.flowProjectIds,
        profileDir: provider.profileDir,
      });

      const isVid = output_type === 'video';
      const aspectMap: Record<string, number> = { '16:9': 2, '9:16': 1, '1:1': 1 };

      const runOnce = async (refs: string[]) => {
        if (isVid) {
          const feModel = resolveVideoFrontendModel(model);
          const multi = refs.length > 1;
          const wireModel = resolveVideoWireModel(feModel, {
            mode: multi ? 'r2v' : 'i2v',
            duration,
            aspectRatio: aspect_ratio,
          });
          return bibGenerateVideo({
            accountId: provider.id,
            mode: multi ? 'r2v' : 'i2v',
            prompt: job.prompt,
            imageId: refs[0],
            imageIds: refs,
            characters: charRefs,
            videoModel: wireModel,
            aspect: aspectMap[String(aspect_ratio)] || 2,
            aspectRatio: aspect_ratio,
            projectId: targetProjectId,
            waitForCompletion: false,
          });
        }
        const feModel = resolveImageFrontendModel(String(model || 'GEM_PIX_2'));
        const wireModel = resolveImageWireModel(feModel);
        return bibGenerateImage({
          accountId: provider.id,
          prompt: job.prompt,
          aspectRatio: aspect_ratio,
          model: wireModel,
          projectId: targetProjectId,
          imageIds: refs,
          imageId: refs[0],
          characters: charRefs,
        });
      };

      let bibResult;
      try {
        bibResult = await withSystemErrorRetry(() => runOnce(flowRefs), {
          label: `api-ingredients-bib:${job.id}`,
          delayMs: 2000,
          maxAttempts: 2,
          providerAccountId: provider.id,
        });
      } catch (err) {
        if (!isMediaRepairableError(err) || !flowRefs.length) throw err;
        const forceReupload = isMediaParseError(err);
        console.warn(
          `[ingredients] BiB failed (${(err as Error).message}); ${
            forceReupload ? 're-uploading refs' : 'retrying without force-reupload'
          }`
        );
        if (body.run_id) {
          createStudioLog({
            level: 'info',
            source: 'generate',
            message: forceReupload
              ? 'Media repair: re-uploading refs into Flow project, then retrying…'
              : 'Retrying ingredients submit after labs/aisandbox error…',
            runId: String(body.run_id),
            userId: session.userId,
            userEmail: session.email,
          }).catch(() => 0);
        }
        // Warm BiB/labs session again before the single repair retry
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
        const repaired = await repairFlowRefs({
          refs: flowRefs,
          cookies: liveCookies,
          projectId: targetProjectId,
          accountId: provider.id,
          forceReupload,
        });
        if (requestedRefCount > 0 && repaired.filter(isFlowUuid).length < Math.min(requestedRefCount, flowRefs.length)) {
          throw new Error(
            `Media repair dropped ingredient refs (${repaired.length}/${flowRefs.length}). Retry when images are Ready.`
          );
        }
        flowRefs = repaired.filter(isFlowUuid);
        bibResult = await runOnce(flowRefs);
      }

      const workerAsset = {
        id: bibResult.mediaId || (bibResult as any).assets?.[0]?.id,
        url: bibResult.videoUrl || bibResult.url || bibResult.imageUrl || '',
        status: (bibResult.status || (bibResult.url || bibResult.imageUrl || bibResult.videoUrl ? 'COMPLETED' : 'PROCESSING')).toUpperCase(),
        progress: bibResult.videoUrl || bibResult.url || bibResult.imageUrl ? 100 : 20,
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

        const isVid = output_type === 'video';
        const shortId = job.id.substring(0, 8);
        const urlPath = String(workerAsset.url || '').split('?')[0];
        const existingAsset = await prisma.asset.findFirst({
          where: {
            userId: session.userId,
            OR: [
              { fileName: { contains: shortId } },
              { url: workerAsset.url },
              { storagePath: workerAsset.url },
              ...(urlPath
                ? [{ url: { startsWith: urlPath } }, { storagePath: { startsWith: urlPath } }]
                : []),
            ],
          },
        });

        if (!existingAsset) {
          await prisma.asset.create({
            data: {
              userId: session.userId,
              projectId: project.id,
              fileName: `ingredients_${shortId}.${isVid ? 'mp4' : 'png'}`,
              fileType: isVid ? 'video' : 'image',
              mimeType: isVid ? 'video/mp4' : 'image/png',
              fileSize: 1024 * 1024,
              storagePath: workerAsset.url,
              url: workerAsset.url,
              expiresAt,
            },
          });
        }

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
            type: output_type,
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
          type: output_type,
          created_at: job.createdAt.toISOString(),
        },
      });
    } catch (workerErr: any) {
      console.error('Ingredients generation worker error:', workerErr.message);
      await prisma.generationJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.FAILED,
          errorMessage: workerErr.message || 'Ingredients generation failed',
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
          error: workerErr.message || 'Ingredients generation failed',
          detail: workerErr.message,
          jobId: job.id,
          status: 'FAILED',
        },
        { status: 500 }
      );
    }
  } catch (err: any) {
    console.error('API /api/generate/ingredients error:', err);
    return NextResponse.json({ error: err.message || 'Ingredients generation failed' }, { status: 500 });
  }
}
