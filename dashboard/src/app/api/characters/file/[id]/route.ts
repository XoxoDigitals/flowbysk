import { NextResponse } from 'next/server';
import fs from 'fs';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  findCharacterPortraitFile,
  mimeForPortraitPath,
} from '@/lib/characterPortrait';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getOrCreateStudioUser(req);
    const { id } = await params;

    const character = await prisma.character.findFirst({
      where: { id, userId: session.userId },
      select: { id: true, userId: true, traits: true },
    });

    if (!character) {
      return new NextResponse('Character not found', { status: 404 });
    }

    const traits =
      character.traits && typeof character.traits === 'object'
        ? (character.traits as Record<string, any>)
        : {};
    const fromTraits =
      typeof traits.local_image_path === 'string' ? traits.local_image_path : null;
    const filePath =
      (fromTraits && fs.existsSync(fromTraits) ? fromTraits : null) ||
      findCharacterPortraitFile(character.userId, character.id);

    if (!filePath || !fs.existsSync(filePath)) {
      return new NextResponse('Portrait not found', { status: 404 });
    }

    const buf = fs.readFileSync(filePath);
    return new NextResponse(buf, {
      headers: {
        'Content-Type': mimeForPortraitPath(filePath),
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return new NextResponse('Error reading portrait', { status: 500 });
  }
}
