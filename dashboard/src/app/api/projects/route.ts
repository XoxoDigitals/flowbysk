import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ProviderStatus, JobStatus } from '@prisma/client';
import { cancelJob } from '@/lib/queue';

export async function GET(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const projects = await prisma.project.findMany({
      where: { userId: session.userId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: {
          select: { jobs: true, characters: true, assets: true },
        },
      },
    });

    if (projects.length > 1) {
      const toDelete = projects.slice(1).map((p) => p.id);
      // Soft-delete extras — hard delete cascades GenerationJob and wipes analytics
      await prisma.project.updateMany({
        where: { id: { in: toDelete }, userId: session.userId },
        data: { deletedAt: new Date() },
      });
    }

    let userProjects = projects.slice(0, 1);
    if (userProjects.length === 0) {
      const defaultProj = await prisma.project.create({
        data: {
          userId: session.userId,
          name: 'Studio Workspace',
          description: 'Default creation workspace',
        },
      });
      userProjects = [defaultProj as any];
    }

    const activeProj = userProjects[0];
    return NextResponse.json({
      success: true,
      projects: userProjects,
      active_project_id: activeProj?.id || null,
      active_project_url: activeProj ? `https://flow.google.com/project/${activeProj.id}` : null,
    });
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
    const { name, description } = body;

    if (!name || name.trim().length === 0) {
      return NextResponse.json({ error: 'Project name is required' }, { status: 400 });
    }

    // 1. AUTO-CANCEL ALL ACTIVE / QUEUED / GENERATING JOBS:
    // When a user creates a new project, all active/in-queue generations cancel automatically
    // and release their reserved credits back to the user's wallet.
    const activeJobs = await prisma.generationJob.findMany({
      where: {
        userId: session.userId,
        status: {
          in: [
            JobStatus.IN_QUEUE,
            JobStatus.PREPARING,
            JobStatus.GENERATING,
            JobStatus.RETRYING,
            JobStatus.CHECKING_STATUS,
          ],
        },
      },
    });

    for (const job of activeJobs) {
      try {
        await cancelJob(job.id, session.userId);
      } catch (cancelErr) {
        console.warn(`Failed to auto-cancel job ${job.id} during project reset:`, cancelErr);
      }
    }

    // STRICT 1 PROJECT PER USER RULE:
    // Soft-delete previous projects so GenerationJob history (analytics) is preserved.
    await prisma.project.updateMany({
      where: { userId: session.userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    // 1. Create internal project
    const project = await prisma.project.create({
      data: {
        userId: session.userId,
        name: name.trim(),
        description: description || '',
      },
    });

    // 2. Select eligible provider account to bind
    const defaultProvider = await prisma.providerAccount.findFirst({
      where: { status: ProviderStatus.HEALTHY },
    });

    if (defaultProvider) {
      // Create project provider binding
      await prisma.projectProviderBinding.create({
        data: {
          projectId: project.id,
          providerAccountId: defaultProvider.id,
          upstreamFlowProjectId: `flow-proj-${project.id.slice(0, 8)}`,
        },
      });
    }

    return NextResponse.json({
      success: true,
      project,
      message: 'Workspace created and prepared successfully.',
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Unauthorized' },
      { status: error.message === 'UNAUTHORIZED' ? 401 : 500 }
    );
  }
}
