import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const { searchParams } = new URL(req.url);
    const requestedProjId = searchParams.get('projectId');

    let activeProject = null;
    if (requestedProjId) {
      activeProject = await prisma.project.findFirst({
        where: { id: requestedProjId, userId: session.userId, deletedAt: null },
      });
    }
    if (!activeProject) {
      activeProject = await prisma.project.findFirst({
        where: { userId: session.userId, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
      });
    }

    if (!activeProject) {
      return NextResponse.json({ success: true, state: null });
    }

    const whiskState = await prisma.whiskState.findUnique({
      where: { projectId: activeProject.id },
    });

    return NextResponse.json({
      success: true,
      projectId: activeProject.id,
      state: whiskState ? whiskState.data : null,
    });
  } catch (error: any) {
    console.error('Failed to get whisk state:', error);
    return NextResponse.json({ error: error.message || 'Unauthorized' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const body = await req.json();
    const { projectId, state } = body;

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
      return NextResponse.json({ error: 'No active project found' }, { status: 400 });
    }

    const saved = await prisma.whiskState.upsert({
      where: { projectId: activeProject.id },
      update: {
        data: state || {},
        updatedAt: new Date(),
      },
      create: {
        userId: session.userId,
        projectId: activeProject.id,
        data: state || {},
      },
    });

    return NextResponse.json({
      success: true,
      projectId: activeProject.id,
      updatedAt: saved.updatedAt,
    });
  } catch (error: any) {
    console.error('Failed to save whisk state:', error);
    return NextResponse.json({ error: error.message || 'Failed to save whisk state' }, { status: 500 });
  }
}
