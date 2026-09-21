import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  deleteCharacterPortraitFiles,
  persistCharacterPortrait,
} from '@/lib/characterPortrait';

const PYTHON_WORKER_URL = process.env.PYTHON_WORKER_URL || 'http://127.0.0.1:8000';

async function deleteCharacterForUser(userId: string, id: string) {
  let character = await prisma.character.findFirst({
    where: { id, userId },
  });
  if (!character) {
    // Allow delete by Flow entity id stored in traits
    const all = await prisma.character.findMany({
      where: { userId },
      take: 300,
    });
    character =
      all.find((c) => {
        const t = (c.traits && typeof c.traits === 'object' ? c.traits : {}) as Record<
          string,
          any
        >;
        return t.flow_entity_id === id || t.flow_character_id === id || c.upstreamCharacterId === id;
      }) || null;
  }
  if (!character) return null;
  deleteCharacterPortraitFiles(userId, character.id, character.traits);
  const traits =
    character.traits && typeof character.traits === 'object'
      ? (character.traits as Record<string, any>)
      : {};
  const flowId = traits.flow_entity_id || traits.flow_character_id || null;
  await prisma.character.delete({ where: { id: character.id } });
  // Best-effort Python store cleanup
  for (const cid of [character.id, flowId].filter(Boolean)) {
    fetch(`${PYTHON_WORKER_URL}/api/characters/${encodeURIComponent(String(cid))}`, {
      method: 'DELETE',
    }).catch(() => 0);
  }
  return character;
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getOrCreateStudioUser(_req);
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Character ID required' }, { status: 400 });
    }

    const deleted = await deleteCharacterForUser(session.userId, id);
    if (!deleted) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'Character deleted' });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Unauthorized' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getOrCreateStudioUser(req);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    const character = await prisma.character.findFirst({
      where: { id, userId: session.userId },
    });
    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    }

    const traits =
      character.traits && typeof character.traits === 'object'
        ? { ...(character.traits as Record<string, any>) }
        : {};

    const data: Record<string, any> = {};
    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim();
    if (typeof body.voiceName === 'string') data.voiceName = body.voiceName;
    else if (Array.isArray(body.voice_presets) && body.voice_presets[0]) {
      data.voiceName = String(body.voice_presets[0]);
    }

    const imageUrl = body.image_url || body.portraitUrl || null;
    const imageMediaId = body.image_media_id || null;
    if (imageMediaId) traits.image_media_id = imageMediaId;
    if (body.flow_entity_id) {
      traits.flow_entity_id = body.flow_entity_id;
      traits.flow_character_id = body.flow_entity_id;
    }
    if (body.portrait_bound === true || body.flow_portrait_bound === true) {
      traits.portrait_bound = true;
      traits.flow_portrait_bound = true;
    }
    if (imageUrl) {
      data.portraitUrl = imageUrl;
      const persisted = await persistCharacterPortrait({
        userId: session.userId,
        characterId: id,
        sourceUrl: imageUrl,
        localImagePath: body.local_image_path || traits.local_image_path || null,
      });
      if (persisted) {
        data.portraitUrl = persisted.portraitUrl;
        traits.local_image_path = persisted.localPath;
        traits.durable_portrait = true;
      }
    }
    data.traits = { ...traits, ...(body.traits && typeof body.traits === 'object' ? body.traits : {}) };

    const updated = await prisma.character.update({
      where: { id },
      data,
    });

    // Forward to Python so Flow entity gets the portrait bind (ogiZ0b destination_character_id)
    const flowId =
      body.flow_entity_id ||
      traits.flow_entity_id ||
      traits.flow_character_id ||
      null;
    if (flowId && (imageMediaId || imageUrl || body.local_image_path)) {
      try {
        await fetch(`${PYTHON_WORKER_URL}/api/characters/${encodeURIComponent(flowId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            display_name: data.name || character.name,
            voice_presets: data.voiceName ? [data.voiceName] : undefined,
            image_media_id: imageMediaId || undefined,
            image_url: imageUrl || undefined,
            local_image_path:
              body.local_image_path || traits.local_image_path || undefined,
          }),
        });
      } catch (e) {
        console.warn('Python character portrait patch skipped:', e);
      }
    }

    return NextResponse.json({ success: true, character: updated });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Unauthorized' },
      { status: 500 }
    );
  }
}
