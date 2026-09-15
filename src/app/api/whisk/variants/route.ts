import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { JobStatus } from '@prisma/client';
import { selectProviderAccountForJobDetailed } from '@/lib/routing';
import { prepareProviderWorkerSession } from '@/lib/providerSession';
import { bibGenerateImage, bibEnsureProjects, ensureBibAccountReady } from '@/lib/bib';
import { resolveImageFrontendModel, resolveImageWireModel } from '@/lib/modelWire';
import { reserveCredits, settleCredits, releaseCredits, resolveModelPricing } from '@/lib/credits';

/** Whisk variants → BiB image gen (Python whisk_variants prompt), no CDP. */
export async function POST(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const body = await req.json();
    const ingredient = (body.ingredient && typeof body.ingredient === 'object' ? body.ingredient : {}) as {
      name?: string;
      category?: string;
    };
    const name = String(ingredient.name || '').trim();
    const category = String(ingredient.category || 'subject').trim() || 'subject';
    let captionClean = String(body.caption || '').trim();
    if (!captionClean) {
      captionClean = name || `Visual ${category}`;
    }
    const numVariants = Math.min(Math.max(Number(body.num_variants) || 3, 1), 4);
    const model = body.model || 'GEM_PIX_2';

    // Match Python whisk_variants prompt
    const nameLower = name.toLowerCase();
    const captionLower = captionClean.toLowerCase();
    const fullPrompt =
      !name ||
      nameLower === captionLower ||
      nameLower.startsWith('subject') ||
      nameLower.startsWith('scene') ||
      nameLower.startsWith('style')
        ? `${captionClean}, clean studio composition, high fidelity, 8k resolution`
        : `${captionClean}, ${name}, clean studio composition, high fidelity, 8k resolution`;

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
    let targetProjectId = sessionPrep.projectId;

    const flowIds = Array.isArray(provider.flowProjectIds) ? (provider.flowProjectIds as string[]) : [];
    if (!flowIds.length) {
      const ensured = await bibEnsureProjects(provider.id, provider.maxParallelLimit || 4);
      const nextIds = Array.isArray(ensured?.projectIds) ? ensured.projectIds.filter(Boolean) : [];
      if (nextIds.length) {
        targetProjectId = targetProjectId || String(nextIds[0]);
        await prisma.providerAccount.update({
          where: { id: provider.id },
          data: { flowProjectIds: nextIds },
        });
      }
    }

    await ensureBibAccountReady({
      id: provider.id,
      maxParallelLimit: provider.maxParallelLimit,
      flowProjectIds: flowIds.length ? flowIds : provider.flowProjectIds,
      profileDir: provider.profileDir,
    });

    const feModel = resolveImageFrontendModel(String(model));
    const wireModel = resolveImageWireModel(feModel);

    const variants: Array<{
      id: string;
      name: string;
      category: string;
      imageUrl: string;
      mediaId: string;
      description: string;
      source: string;
    }> = [];

    for (let i = 0; i < numVariants; i++) {
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
            aspect_ratio: '1:1',
            model: feModel,
            wireModel,
            source: 'whisk_variants',
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
          aspectRatio: '1:1',
          model: wireModel,
          projectId: targetProjectId,
        });
        const url = bib.imageUrl || bib.url || bib.assets?.[0]?.url || '';
        const mediaId = String(bib.mediaId || bib.assets?.[0]?.id || '');

        if (!url) {
          throw new Error('BiB whisk variants returned no image');
        }

        await prisma.generationJob.update({
          where: { id: job.id },
          data: {
            status: JobStatus.COMPLETED,
            progress: 100,
            outputMediaUrl: url,
            completedAt: new Date(),
            outputMetadata: {
              bibMediaId: mediaId,
              bibAccountId: provider.id,
              bibProjectId: targetProjectId,
            },
          },
        });
        await prisma.asset.create({
          data: {
            userId: session.userId,
            projectId: project.id,
            fileName: `whisk_var_${job.id.slice(0, 8)}.png`,
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

        variants.push({
          id: mediaId || `whisk-var-${Date.now()}-${i}`,
          name: name ? `${name} (Var ${i + 1})` : `Var ${i + 1}`,
          category,
          imageUrl: url,
          mediaId,
          description: String(body.caption || captionClean),
          source: 'variant',
        });
      } catch (e: any) {
        await releaseCredits(session.userId, pricing.walletType, pricing.price, job.id).catch(() => 0);
        await prisma.generationJob.update({
          where: { id: job.id },
          data: {
            status: JobStatus.FAILED,
            errorMessage: e?.message || 'Whisk variants failed',
            completedAt: new Date(),
          },
        });
        if (i === 0) {
          return NextResponse.json(
            { error: e?.message || 'Whisk variants failed', detail: e?.message },
            { status: 500 }
          );
        }
      }
    }

    return NextResponse.json({ success: true, variants, count: variants.length });
  } catch (err: any) {
    console.error('API /api/whisk/variants error:', err);
    return NextResponse.json(
      { error: err.message || 'Whisk variants failed', detail: err.message },
      { status: 500 }
    );
  }
}
