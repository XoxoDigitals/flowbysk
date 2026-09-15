import { NextResponse } from 'next/server';
import { WalletType } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  deleteCharacterPortraitFiles,
  durableCharacterExpiresAt,
  needsPortraitBackfill,
  persistCharacterPortrait,
} from '@/lib/characterPortrait';
import { selectProviderAccountForJobDetailed } from '@/lib/routing';
import { prepareProviderWorkerSession } from '@/lib/providerSession';
import { bibCreateCharacter, bibGenerateImage, ensureBibAccountReady } from '@/lib/bib';
import { formatWorkerFetchError, PYTHON_WORKER_URL } from '@/lib/worker';
import { resolveImageWireModel } from '@/lib/modelWire';

const CHARACTER_PORTRAIT_PROMPT = 'Make the same picture in white background';

export async function GET(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');

    const whereClause: any = {
      userId: session.userId,
    };

    if (projectId) {
      whereClause.projectId = projectId;
    }

    const characters = await prisma.character.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
    });

    const mapped = [];
    for (const c of characters) {
      let portraitUrl = c.portraitUrl;
      let traits = (c.traits && typeof c.traits === 'object' ? c.traits : {}) as Record<
        string,
        any
      >;

      // One-shot backfill: CDN/expiring URLs → durable local file
      if (needsPortraitBackfill(portraitUrl)) {
        const persisted = await persistCharacterPortrait({
          userId: session.userId,
          characterId: c.id,
          sourceUrl: portraitUrl || '',
          localImagePath: traits.local_image_path || null,
        });
        if (persisted) {
          traits = {
            ...traits,
            local_image_path: persisted.localPath,
            durable_portrait: true,
          };
          portraitUrl = persisted.portraitUrl;
          await prisma.character
            .update({
              where: { id: c.id },
              data: {
                portraitUrl,
                traits,
                expiresAt: durableCharacterExpiresAt(),
              },
            })
            .catch(() => null);
        }
      }

      const flowEntityId =
        traits.flow_entity_id ||
        traits.flow_character_id ||
        c.upstreamCharacterId ||
        null;
      const imageMediaId = traits.image_media_id || null;
      mapped.push({
        ...c,
        portraitUrl,
        traits,
        character_id: c.id,
        entity_id: c.id,
        flow_entity_id: flowEntityId,
        flow_character_id: traits.flow_character_id || flowEntityId || null,
        image_media_id: imageMediaId,
        display_name: c.name,
        image_url: portraitUrl,
        voice_presets: [c.voiceName],
      });
    }

    return NextResponse.json({ success: true, characters: mapped });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Unauthorized' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const body = await req.json();
    const charName = (body.name || body.display_name || '').trim();
    const clientProjectId = body.projectId;
    const gender = body.gender || 'Unspecified';
    const voiceName =
      body.voiceName ||
      (Array.isArray(body.voice_presets) ? body.voice_presets[0] : body.voice_presets) ||
      'A';
    const sourcePortrait =
      body.portraitUrl ||
      body.image_url ||
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80';
    const traits = body.traits || {};

    if (!charName) {
      return NextResponse.json(
        { error: 'Character name is required' },
        { status: 400 }
      );
    }

    let project = clientProjectId
      ? await prisma.project.findFirst({ where: { id: clientProjectId, userId: session.userId, deletedAt: null } })
      : await prisma.project.findFirst({ where: { userId: session.userId, deletedAt: null } });

    if (!project) {
      project = await prisma.project.create({
        data: {
          userId: session.userId,
          name: 'Studio Workspace',
        },
      });
    }

    const expiresAt = durableCharacterExpiresAt();

    const character = await prisma.character.create({
      data: {
        userId: session.userId,
        projectId: project.id,
        name: charName,
        gender,
        voiceName,
        portraitUrl: sourcePortrait,
        traits: {
          ...traits,
          image_media_id: body.image_media_id || null,
          local_image_path: body.local_image_path || null,
        },
        expiresAt,
      },
    });

    const persisted = await persistCharacterPortrait({
      userId: session.userId,
      characterId: character.id,
      sourceUrl: sourcePortrait,
      localImagePath: body.local_image_path || null,
    });

    let portraitUrl = character.portraitUrl;
    let nextTraits =
      character.traits && typeof character.traits === 'object'
        ? { ...(character.traits as Record<string, any>) }
        : {};

    if (persisted) {
      portraitUrl = persisted.portraitUrl;
      nextTraits = {
        ...nextTraits,
        local_image_path: persisted.localPath,
        durable_portrait: true,
      };
      await prisma.character.update({
        where: { id: character.id },
        data: { portraitUrl, traits: nextTraits },
      });
    }

    // Best-effort: create Flow entity via BiB (live WIZ), then store + attach image in Python
    let flowCharacterId = character.id;
    let flowEntityId: string | null = null;
    try {
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
      let flowProjectId: string | undefined;
      if (provider?.id) {
        await ensureBibAccountReady({
          id: provider.id,
          maxParallelLimit: provider.maxParallelLimit,
          flowProjectIds: provider.flowProjectIds,
          profileDir: provider.profileDir,
        }).catch(() => null);
        const sessionPrep = await prepareProviderWorkerSession(provider, session.userId);
        flowProjectId = sessionPrep.projectId || undefined;

        // Upload portrait into Flow first so C4BZMd attaches media (avoid empty character)
        let flowImageMediaId: string | null = body.image_media_id || null;
        const portraitCandidate =
          flowImageMediaId ||
          (persisted?.localPath ? `upload-${path.basename(persisted.localPath)}` : null) ||
          portraitUrl ||
          sourcePortrait;
        if (portraitCandidate && flowProjectId) {
          try {
            const { refreshFlowMediaId } = await import('@/lib/providerSession');
            // If we have a local file path, prefer that id shape via upload-* / absolute path
            let mediaKey = portraitCandidate;
            if (persisted?.localPath && fs.existsSync(persisted.localPath)) {
              // Register as local upload-style by uploading bytes through refresh via character traits path
              const { bibUploadImage } = await import('@/lib/bib');
              const buf = fs.readFileSync(persisted.localPath);
              const bibUp = await bibUploadImage({
                accountId: provider.id,
                projectId: flowProjectId,
                imageBase64: buf.toString('base64'),
                mimeType: 'image/jpeg',
                filename: path.basename(persisted.localPath),
              });
              if (bibUp?.mediaId) {
                flowImageMediaId = bibUp.mediaId;
                mediaKey = bibUp.mediaId;
              }
            }
            if (!flowImageMediaId || !/^[0-9a-f-]{36}$/i.test(flowImageMediaId)) {
              const refreshed = await refreshFlowMediaId({
                accountId: provider.id,
                mediaId: mediaKey,
                cookies: sessionPrep.cookies,
                projectId: flowProjectId,
                forceReupload: true,
              });
              if (refreshed && /^[0-9a-f-]{36}$/i.test(refreshed)) {
                flowImageMediaId = refreshed;
              }
            }
          } catch (upErr: any) {
            console.warn('[characters] portrait upload before create failed:', upErr?.message || upErr);
          }
        }

        if (portraitCandidate && !flowImageMediaId) {
          console.warn(
            `[characters] creating Flow entity without portrait UUID for "${charName}" — will bind if media appears later`
          );
        }
        try {
          const bibChar = await bibCreateCharacter({
            accountId: provider.id,
            name: charName,
            projectId: flowProjectId,
            imageMediaId: flowImageMediaId,
          });
          flowEntityId = bibChar.flowEntityId || bibChar.entity_id || null;
          const bindNeeded =
            !!(bibChar as any)?.portraitBindNeeded ||
            (!!(bibChar as any)?.imageMediaId && !(bibChar as any)?.createdWithMedia);
          if (flowImageMediaId) {
            nextTraits = { ...nextTraits, image_media_id: flowImageMediaId };
          } else if ((bibChar as any)?.imageMediaId) {
            flowImageMediaId = (bibChar as any).imageMediaId;
            nextTraits = { ...nextTraits, image_media_id: flowImageMediaId };
          }
          if (flowEntityId) {
            console.info(
              `[characters] BiB Flow entity ${flowEntityId.slice(0, 8)}… for "${charName}" media=${flowImageMediaId?.slice(0, 8) || 'none'} bind=${!!bindNeeded}`
            );
          }
          // White-bg sheet bind when create-with-media was rejected (e=4) or bind flagged
          if (flowEntityId && flowImageMediaId && (bindNeeded || !(bibChar as any)?.createdWithMedia)) {
            try {
              const wireModel = resolveImageWireModel('GEM_PIX_2');
              const portrait = await bibGenerateImage({
                accountId: provider.id,
                prompt: CHARACTER_PORTRAIT_PROMPT,
                aspectRatio: '1:1',
                model: wireModel,
                projectId: flowProjectId,
                imageId: flowImageMediaId,
                imageIds: [flowImageMediaId],
                destinationCharacterId: flowEntityId,
              });
              if (portrait?.mediaId) {
                flowImageMediaId = portrait.mediaId;
                nextTraits = {
                  ...nextTraits,
                  image_media_id: flowImageMediaId,
                  portrait_bound: true,
                  flow_portrait_bound: true,
                };
              }
            } catch (bindErr: any) {
              console.warn('[characters] portrait bind after create failed:', bindErr?.message || bindErr);
            }
          }
        } catch (bibErr: any) {
          console.warn('[characters] BiB create-character failed:', bibErr?.message || bibErr);
        }
      }

      try {
        const workerRes = await fetch(`${PYTHON_WORKER_URL}/api/characters`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            display_name: charName,
            name: charName,
            voice_presets: voiceName && voiceName !== 'A' ? [voiceName] : body.voice_presets || [],
            image_media_id: flowImageMediaId || body.image_media_id || undefined,
            image_url: sourcePortrait,
            local_image_path: persisted?.localPath || body.local_image_path || undefined,
            flow_entity_id: flowEntityId || undefined,
          }),
        });
        if (workerRes.ok) {
          const workerData = await workerRes.json();
          flowCharacterId =
            workerData.character_id ||
            workerData.character?.character_id ||
            workerData.flow_entity_id ||
            character.id;
          flowEntityId =
            flowEntityId ||
            workerData.flow_entity_id ||
            workerData.character?.flow_entity_id ||
            null;
          nextTraits = {
            ...nextTraits,
            flow_character_id: flowCharacterId,
            flow_entity_id: flowEntityId,
            image_media_id:
              workerData.image_media_id ||
              workerData.character?.image_media_id ||
              flowImageMediaId ||
              body.image_media_id ||
              null,
            local_mode: !flowEntityId || !!workerData.local_mode,
            sync_pending: !flowEntityId || !!workerData.sync_pending,
          };
          await prisma.character.update({
            where: { id: character.id },
            data: { traits: nextTraits },
          });
        }
      } catch (pyErr: any) {
        console.warn(
          'Python character sync skipped:',
          formatWorkerFetchError(pyErr, { workerLabel: 'Python Flow worker' })
        );
      }
    } catch (syncErr: any) {
      console.warn(
        'Character Flow sync skipped:',
        formatWorkerFetchError(syncErr, { workerLabel: 'Flow sync' })
      );
    }

    const returnedChar = {
      ...character,
      portraitUrl,
      traits: nextTraits,
      character_id: character.id,
      entity_id: flowEntityId || character.id,
      flow_character_id: nextTraits.flow_character_id || flowCharacterId,
      flow_entity_id: nextTraits.flow_entity_id || flowEntityId || null,
      display_name: character.name,
      image_url: portraitUrl,
      image_media_id: nextTraits.image_media_id || body.image_media_id || null,
      voice_presets: [character.voiceName],
    };

    return NextResponse.json({
      success: true,
      character: returnedChar,
      character_id: returnedChar.character_id,
      entity_id: returnedChar.entity_id,
      flow_entity_id: returnedChar.flow_entity_id,
      flow_character_id: returnedChar.flow_character_id,
      image_media_id: returnedChar.image_media_id,
      local_mode: !!nextTraits.local_mode && !returnedChar.flow_entity_id,
      sync_pending: !!nextTraits.sync_pending && !returnedChar.flow_entity_id,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Unauthorized' },
      { status: error.message === 'UNAUTHORIZED' ? 401 : 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Character ID required' }, { status: 400 });
    }

    const character = await prisma.character.findFirst({
      where: { id, userId: session.userId },
    });

    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    }

    deleteCharacterPortraitFiles(session.userId, id, character.traits);
    await prisma.character.delete({ where: { id } });
    return NextResponse.json({ success: true, message: 'Character deleted' });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Unauthorized' },
      { status: 500 }
    );
  }
}
