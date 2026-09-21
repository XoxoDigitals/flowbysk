import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { JobStatus } from '@prisma/client';
import { selectProviderAccountForJobDetailed } from '@/lib/routing';
import { prepareProviderWorkerSession, refreshFlowMediaId } from '@/lib/providerSession';
import { bibGenerateImage, ensureBibAccountReady } from '@/lib/bib';
import { resolveImageFrontendModel, resolveImageWireModel } from '@/lib/modelWire';
import { reserveCredits, settleCredits, releaseCredits, resolveModelPricing } from '@/lib/credits';

function collectIngredients(body: any): Array<{ token?: string; mediaId?: string; stagedId?: string; name?: string }> {
  const out: any[] = [];
  const pushList = (list: any[] | undefined, single: any, cat: string) => {
    if (Array.isArray(list)) {
      list.forEach((item, idx) => {
        if (item && typeof item === 'object') {
          out.push({
            ...item,
            token: item.token || `${cat} ${idx + 1}`,
            mediaId: item.mediaId || item.media_id || item.id,
            stagedId: item.stagedId || item.staged_id,
          });
        }
      });
    } else if (single && typeof single === 'object') {
      out.push({
        ...single,
        token: single.token || `${cat} 1`,
        mediaId: single.mediaId || single.media_id || single.id,
        stagedId: single.stagedId || single.staged_id,
      });
    }
  };
  pushList(body.subjects, body.subject, 'Subject');
  pushList(body.scenes, body.scene, 'Scene');
  pushList(body.styles, body.style, 'Style');
  if (Array.isArray(body.referenced_ingredients)) {
    for (const ref of body.referenced_ingredients) {
      if (ref && typeof ref === 'object') out.push(ref);
    }
  }
  return out;
}

/** Whisk compose → BiB multi-ref image (ogiZ0b), no Python CDP. */
export async function POST(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const body = await req.json();
    const ings = collectIngredients(body);
    const customPrompt = String(body.custom_prompt || body.prompt || '').trim();
    const aspect_ratio = body.aspect_ratio || '16:9';
    const model = body.model || 'GEM_PIX_2';
    const numImages = Math.min(Math.max(Number(body.num_images) || 1, 1), 4);

    const pricing =
      (await resolveModelPricing(model)) || (await resolveModelPricing('nano_banana_pro'))!;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    let project = await prisma.project.findFirst({
      where: { userId: session.userId, deletedAt: null },
    });
    if (!project) {
      project = await prisma.project.create({
        data: { userId: session.userId, name: 'Studio Workspace' },
      });
    }

    const { account: provider, reason } = await selectProviderAccountForJobDetailed(
      pricing.walletType,
      pricing.modelKey,
      session.userId
    );
    if (!provider) {
      return NextResponse.json({ error: reason || 'No BiB provider ready', detail: reason }, { status: 503 });
    }

    const sessionPrep = await prepareProviderWorkerSession(provider, session.userId);
    const liveCookies = sessionPrep.cookies || provider.cookies || undefined;
    const targetProjectId = sessionPrep.projectId;

    const flowRefs: string[] = [];
    const details: string[] = [];
    for (const ing of ings) {
      const raw = ing.mediaId || ing.stagedId;
      if (!raw) continue;
      const mid = await refreshFlowMediaId({
        accountId: provider.id,
        mediaId: String(raw),
        cookies: liveCookies,
        projectId: targetProjectId,
      });
      if (mid && /^[a-f0-9-]{36}$/i.test(mid) && !flowRefs.includes(mid)) {
        flowRefs.push(mid);
      }
      const t = ing.token || 'Ingredient';
      const n = (ing.name || '').trim();
      details.push(n ? `${t}: ${n}` : t);
    }

    const promptParts = [customPrompt, details.join('. ')].filter(Boolean);
    const fullPrompt =
      promptParts.join('. ') ||
      'A high fidelity combinatorial composition synthesizing visual ingredients';

    const feModel = resolveImageFrontendModel(String(model));
    const wireModel = resolveImageWireModel(feModel);

    await ensureBibAccountReady({
      id: provider.id,
      maxParallelLimit: provider.maxParallelLimit,
      flowProjectIds: provider.flowProjectIds,
      profileDir: provider.profileDir,
    });

    const assets: any[] = [];
    for (let i = 0; i < numImages; i++) {
      const job = await prisma.generationJob.create({
        data: {
          userId: session.userId,
          projectId: project.id,
          modelKey: pricing.modelKey,
          walletType: pricing.walletType,
          creditCost: pricing.price,
          status: JobStatus.GENERATING,
          progress: 50,
          prompt: fullPrompt,
          parameters: {
            aspect_ratio,
            model: feModel,
            wireModel,
            source: 'whisk',
            flowProjectId: targetProjectId,
          },
          providerAccountId: provider.id,
          startedAt: new Date(),
          expiresAt,
        },
      });

      try {
        await reserveCredits(session.userId, pricing.modelKey, job.id);
      } catch (creditErr: any) {
        await prisma.generationJob.delete({ where: { id: job.id } });
        if (i === 0) {
          return NextResponse.json(
            { error: creditErr.message || 'Insufficient credits', detail: creditErr.message },
            { status: 402 }
          );
        }
        break;
      }

      try {
        const bib = await bibGenerateImage({
          accountId: provider.id,
          prompt: fullPrompt,
          aspectRatio: aspect_ratio,
          model: wireModel,
          projectId: targetProjectId,
          imageIds: flowRefs,
          imageId: flowRefs[0],
        });
        const url = bib.imageUrl || bib.url || bib.assets?.[0]?.url || '';
        const mediaId = bib.mediaId || bib.assets?.[0]?.id;

        if (url) {
          await prisma.generationJob.update({
            where: { id: job.id },
            data: {
              status: JobStatus.COMPLETED,
              progress: 100,
              outputMediaUrl: url,
              completedAt: new Date(),
              outputMetadata: { bibMediaId: mediaId, bibAccountId: provider.id, bibProjectId: targetProjectId },
            },
          });
          await prisma.asset.create({
            data: {
              userId: session.userId,
              projectId: project.id,
              fileName: `whisk_${job.id.slice(0, 8)}.png`,
              fileType: 'image',
              mimeType: 'image/png',
              fileSize: 512 * 1024,
              storagePath: url,
              url,
              upstreamAssetId: mediaId || null,
              expiresAt,
            },
          });
          await settleCredits(session.userId, pricing.walletType, pricing.price, job.id);
          assets.push({
            id: job.id,
            status: 'COMPLETED',
            url,
            type: 'image',
            prompt: fullPrompt,
            model: feModel,
            whisk: true,
          });
        } else if (mediaId) {
          await prisma.generationJob.update({
            where: { id: job.id },
            data: {
              status: JobStatus.GENERATING,
              progress: 20,
              outputMetadata: {
                workerTaskId: mediaId,
                bibMediaId: mediaId,
                bibAccountId: provider.id,
                bibProjectId: targetProjectId,
              },
            },
          });
          assets.push({
            id: job.id,
            status: 'PROCESSING',
            url: '',
            type: 'image',
            prompt: fullPrompt,
            model: feModel,
            whisk: true,
          });
        } else {
          throw new Error('BiB whisk returned no image');
        }
      } catch (e: any) {
        await releaseCredits(session.userId, pricing.walletType, pricing.price, job.id).catch(() => 0);
        await prisma.generationJob.update({
          where: { id: job.id },
          data: {
            status: JobStatus.FAILED,
            errorMessage: e?.message || 'Whisk failed',
            completedAt: new Date(),
          },
        });
        if (i === 0) {
          return NextResponse.json(
            { error: e?.message || 'Whisk compose failed', detail: e?.message },
            { status: 500 }
          );
        }
      }
    }

    return NextResponse.json({ success: true, assets });
  } catch (err: any) {
    console.error('API /api/whisk/compose error:', err);
    return NextResponse.json({ error: err.message || 'Whisk compose failed' }, { status: 500 });
  }
}
