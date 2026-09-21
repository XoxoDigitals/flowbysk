import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { JobStatus, WalletType } from '@prisma/client';

export async function POST(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const body = await req.json();
    const { projectId, url, name, category, token } = body;

    if (!url) {
      return NextResponse.json({ error: 'Media URL is required' }, { status: 400 });
    }

    let activeProject = null;
    if (projectId) {
      activeProject = await prisma.project.findFirst({
        where: { id: projectId, userId: session.userId, deletedAt: null },
      });
    }
    if (!activeProject) {
      activeProject = await prisma.project.findFirst({
        where: { userId: session.userId, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
      });
    }
    if (!activeProject) {
      activeProject = await prisma.project.create({
        data: {
          userId: session.userId,
          name: 'Studio Workspace',
          description: 'Default workspace',
        },
      });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const cleanTitle = name || `${category || 'Whisk'} Creation`;
    const fileName = `whisk_${(category || 'item').toLowerCase()}_${Date.now().toString(36)}.png`;

    // 1. Create asset in Prisma so it appears in "All Media" and gallery
    const asset = await prisma.asset.create({
      data: {
        userId: session.userId,
        projectId: activeProject.id,
        fileName,
        fileType: 'image',
        mimeType: 'image/png',
        fileSize: 1024 * 1024,
        storagePath: url,
        url,
        expiresAt,
      },
    });

    // 2. Also record completed generation job for studio history
    try {
      await prisma.generationJob.create({
        data: {
          userId: session.userId,
          projectId: activeProject.id,
          modelKey: 'nano_banana_2',
          walletType: WalletType.STANDARD,
          creditCost: 0,
          status: JobStatus.COMPLETED,
          progress: 100,
          prompt: cleanTitle,
          parameters: {
            model: 'nano_banana_2',
            category: category || 'whisk',
            token: token || null,
          },
          outputMediaUrl: url,
          completedAt: now,
          expiresAt,
        },
      });
    } catch (jobErr) {
      console.warn('Could not record Whisk generation job:', jobErr);
    }

    return NextResponse.json({
      success: true,
      asset,
      message: 'Whisk asset saved to studio library and database successfully.',
    });
  } catch (error: any) {
    console.error('Failed to save whisk asset:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to save whisk asset' },
      { status: 500 }
    );
  }
}
