import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import fs from 'fs';

const TOOL = 'bulki2v';

async function resolveProject(userId: string, clientProjectId?: string | null) {
  let project = clientProjectId
    ? await prisma.project.findFirst({
        where: { id: clientProjectId, userId, deletedAt: null },
      })
    : null;
  if (!project) {
    project = await prisma.project.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
  }
  if (!project) {
    project = await prisma.project.create({
      data: { userId, name: 'Studio Workspace', description: 'Default creation workspace' },
    });
  }
  return project;
}

function collectDraftAssetIds(payload: any): string[] {
  const ids = new Set<string>();
  const images = Array.isArray(payload?.images) ? payload.images : [];
  for (const img of images) {
    const id = String(img?.assetId || img?.id || '').trim();
    if (id && /^[a-f0-9-]{36}$/i.test(id)) ids.add(id);
  }
  const staged = Array.isArray(payload?.stagedLocalIds) ? payload.stagedLocalIds : [];
  for (const id of staged) {
    const s = String(id || '').trim();
    if (s && /^[a-f0-9-]{36}$/i.test(s)) ids.add(s);
  }
  return [...ids];
}

export async function GET(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const url = new URL(req.url);
    const projectId = url.searchParams.get('projectId');
    const project = await resolveProject(session.userId, projectId);

    const draft = await prisma.studioToolDraft.findUnique({
      where: {
        userId_projectId_tool: {
          userId: session.userId,
          projectId: project.id,
          tool: TOOL,
        },
      },
    });

    return NextResponse.json({
      success: true,
      projectId: project.id,
      draft: draft
        ? {
            id: draft.id,
            tool: draft.tool,
            projectId: draft.projectId,
            payload: draft.payload,
            updatedAt: draft.updatedAt.toISOString(),
          }
        : null,
    });
  } catch (err: any) {
    if (String(err?.message || '').includes('UNAUTHORIZED')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('GET bulki2v draft:', err);
    return NextResponse.json({ error: err.message || 'Failed to load draft' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const body = await req.json().catch(() => ({}));
    const project = await resolveProject(session.userId, body.projectId);
    const payload = body.payload;
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: 'payload object required' }, { status: 400 });
    }

    const draft = await prisma.studioToolDraft.upsert({
      where: {
        userId_projectId_tool: {
          userId: session.userId,
          projectId: project.id,
          tool: TOOL,
        },
      },
      create: {
        userId: session.userId,
        projectId: project.id,
        tool: TOOL,
        payload,
      },
      update: {
        payload,
      },
    });

    return NextResponse.json({
      success: true,
      projectId: project.id,
      draft: {
        id: draft.id,
        tool: draft.tool,
        projectId: draft.projectId,
        payload: draft.payload,
        updatedAt: draft.updatedAt.toISOString(),
      },
    });
  } catch (err: any) {
    if (String(err?.message || '').includes('UNAUTHORIZED')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('PUT bulki2v draft:', err);
    return NextResponse.json({ error: err.message || 'Failed to save draft' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const url = new URL(req.url);
    let projectId = url.searchParams.get('projectId');
    if (!projectId) {
      try {
        const body = await req.json();
        projectId = body?.projectId || null;
      } catch {
        /* no body */
      }
    }
    const project = await resolveProject(session.userId, projectId);

    const existing = await prisma.studioToolDraft.findUnique({
      where: {
        userId_projectId_tool: {
          userId: session.userId,
          projectId: project.id,
          tool: TOOL,
        },
      },
    });

    const assetIds = collectDraftAssetIds(existing?.payload);
    if (assetIds.length) {
      const assets = await prisma.asset.findMany({
        where: {
          userId: session.userId,
          id: { in: assetIds },
        },
      });
      for (const asset of assets) {
        // Only delete staged/local uploads (not gallery flow-content videos)
        const isLocal =
          String(asset.url || '').startsWith('/api/assets/file/') ||
          String(asset.upstreamAssetId || '').startsWith('staged-') ||
          String(asset.upstreamAssetId || '').startsWith('upload-');
        if (!isLocal) continue;
        try {
          if (asset.storagePath && fs.existsSync(asset.storagePath)) {
            fs.unlinkSync(asset.storagePath);
          }
        } catch {
          /* ignore disk errors */
        }
        await prisma.asset.delete({ where: { id: asset.id } }).catch(() => null);
      }
    }

    if (existing) {
      await prisma.studioToolDraft.delete({ where: { id: existing.id } });
    }

    return NextResponse.json({ success: true, projectId: project.id });
  } catch (err: any) {
    if (String(err?.message || '').includes('UNAUTHORIZED')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('DELETE bulki2v draft:', err);
    return NextResponse.json({ error: err.message || 'Failed to clear draft' }, { status: 500 });
  }
}
