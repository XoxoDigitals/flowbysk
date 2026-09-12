import { NextResponse } from 'next/server';
import { WalletType } from '@prisma/client';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { selectProviderAccountForJobDetailed } from '@/lib/routing';
import { prepareProviderWorkerSession, refreshFlowMediaId } from '@/lib/providerSession';
import { bibCreateCharacter, bibGenerateImage, ensureBibAccountReady } from '@/lib/bib';
import { PYTHON_WORKER_URL } from '@/lib/worker';
import { resolveImageWireModel } from '@/lib/modelWire';

const CHARACTER_PORTRAIT_PROMPT = 'Make the same picture in white background';

type CharIn = {
  entity_id?: string;
  character_id?: string;
  flow_entity_id?: string;
  name?: string;
  display_name?: string;
  image_media_id?: string | null;
  image_url?: string | null;
  local_image_path?: string | null;
  portraitUrl?: string | null;
};

/**
 * Ensure selected characters exist in Google Flow (create if needed),
 * re-upload portrait media into the active project, and bind a white-bg
 * portrait when the entity has an image but was never sheet-bound.
 */
export async function POST(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const body = await req.json().catch(() => ({}));
    const incoming: CharIn[] = Array.isArray(body.characters) ? body.characters : [];
    if (!incoming.length) {
      return NextResponse.json({ success: true, characters: [] });
    }

    const studioUser = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { assignedProviderAccountId: true },
    });
    const { account: provider } = await selectProviderAccountForJobDetailed(
      WalletType.PRO,
      'character',
      session.userId,
      studioUser?.assignedProviderAccountId
    );
    if (!provider?.id) {
      return NextResponse.json(
        { error: 'No Google Flow provider ready — launch BiB account in Admin' },
        { status: 503 }
      );
    }

    await ensureBibAccountReady({
      id: provider.id,
      maxParallelLimit: provider.maxParallelLimit,
      flowProjectIds: provider.flowProjectIds,
      profileDir: provider.profileDir,
    });
    const sessionPrep = await prepareProviderWorkerSession(provider, session.userId);
    const projectId = sessionPrep.projectId;

    const prepared = [];
    for (const raw of incoming.slice(0, 4)) {
      const name = String(raw.name || raw.display_name || 'Character').trim() || 'Character';
      let flowEntityId = String(
        raw.flow_entity_id || raw.entity_id || raw.character_id || ''
      ).trim();
      // Local studio UUIDs are not Flow entities — look up traits
      const localId = String(raw.character_id || raw.entity_id || '').trim();
      let dbChar =
        localId
          ? await prisma.character.findFirst({
              where: { id: localId, userId: session.userId },
            })
          : null;
      if (!dbChar && flowEntityId) {
        const all = await prisma.character.findMany({
          where: { userId: session.userId },
          take: 200,
        });
        dbChar =
          all.find((c) => {
            const t = (c.traits && typeof c.traits === 'object' ? c.traits : {}) as Record<
              string,
              any
            >;
            return t.flow_entity_id === flowEntityId || t.flow_character_id === flowEntityId;
          }) || null;
      }

      const traits =
        dbChar?.traits && typeof dbChar.traits === 'object'
          ? { ...(dbChar.traits as Record<string, any>) }
          : {};
      if (traits.flow_entity_id) flowEntityId = String(traits.flow_entity_id);
      // Reject local-only ids that are not Flow UUIDs already known
      const looksLocalOnly =
        flowEntityId &&
        dbChar &&
        flowEntityId === dbChar.id &&
        !traits.flow_entity_id;

      let imageMediaId =
        raw.image_media_id ||
        traits.image_media_id ||
        null;
      const imageUrl =
        raw.image_url || raw.portraitUrl || dbChar?.portraitUrl || traits.image_url || null;

      if (looksLocalOnly || !flowEntityId || !/^[0-9a-f-]{36}$/i.test(flowEntityId)) {
        try {
          const created = await bibCreateCharacter({
            accountId: provider.id,
            name: dbChar?.name || name,
            projectId: projectId || undefined,
            imageMediaId: imageMediaId || null,
          });
          flowEntityId = created.flowEntityId || created.entity_id || flowEntityId;
        } catch (e: any) {
          console.warn('[characters/prepare] create failed:', e?.message || e);
        }
      }

      if (imageMediaId || imageUrl) {
        const refreshed = await refreshFlowMediaId({
          mediaId: imageMediaId || imageUrl,
          cookies: sessionPrep.cookies,
          projectId: projectId || undefined,
        });
        if (refreshed) imageMediaId = refreshed;
      }

      // White-bg portrait bind when we have Flow entity + source image
      const needsPortrait =
        !!flowEntityId &&
        !!imageMediaId &&
        !traits.portrait_bound &&
        !traits.flow_portrait_bound;
      if (needsPortrait) {
        try {
          const wireModel = resolveImageWireModel('GEM_PIX_2');
          const portrait = await bibGenerateImage({
            accountId: provider.id,
            prompt: CHARACTER_PORTRAIT_PROMPT,
            aspectRatio: '1:1',
            model: wireModel,
            projectId: projectId || undefined,
            imageId: imageMediaId!,
            imageIds: [imageMediaId!],
            destinationCharacterId: flowEntityId,
          });
          if (portrait.mediaId) {
            imageMediaId = portrait.mediaId;
          }
          traits.portrait_bound = true;
          traits.flow_portrait_bound = true;
        } catch (e: any) {
          console.warn('[characters/prepare] portrait bind failed:', e?.message || e);
          // Fallback: Python attach (same prompt)
          try {
            await fetch(`${PYTHON_WORKER_URL}/api/characters/${encodeURIComponent(flowEntityId)}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                display_name: dbChar?.name || name,
                image_media_id: imageMediaId,
                image_url: imageUrl,
              }),
            });
            traits.portrait_bound = true;
          } catch {
            /* keep going — entity + media still usable */
          }
        }
      }

      if (dbChar) {
        const nextTraits = {
          ...traits,
          flow_entity_id: flowEntityId || traits.flow_entity_id || null,
          flow_character_id: flowEntityId || traits.flow_character_id || null,
          image_media_id: imageMediaId || traits.image_media_id || null,
        };
        await prisma.character
          .update({
            where: { id: dbChar.id },
            data: { traits: nextTraits },
          })
          .catch(() => 0);
      }

      prepared.push({
        entity_id: flowEntityId || localId,
        character_id: dbChar?.id || localId || flowEntityId,
        flow_entity_id: flowEntityId || null,
        name: dbChar?.name || name,
        image_media_id: imageMediaId || null,
        image_url: imageUrl || null,
        local_image_path: raw.local_image_path || traits.local_image_path || null,
      });
    }

    return NextResponse.json({ success: true, characters: prepared, projectId });
  } catch (error: any) {
    console.error('[characters/prepare]', error);
    return NextResponse.json(
      { error: error.message || 'Failed to prepare characters' },
      { status: 500 }
    );
  }
}
