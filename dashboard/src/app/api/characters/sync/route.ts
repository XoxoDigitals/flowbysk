import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * Characters live in Prisma for SaaS. Sync is a no-op refresh of the user's
 * character list (Flow entity registration happens on create / generate via BiB).
 */
export async function POST(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const characters = await prisma.character.findMany({
      where: { userId: session.userId, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({
      success: true,
      synced: characters.length,
      characters: characters.map((c) => ({
        character_id: c.id,
        entity_id: c.id,
        display_name: c.name,
        image_url: c.portraitUrl,
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }
}
