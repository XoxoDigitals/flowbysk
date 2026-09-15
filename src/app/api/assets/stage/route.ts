import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import fs from 'fs';
import path from 'path';

const UPLOAD_DIR = path.resolve(process.cwd(), 'data/uploads');
const PYTHON_WORKER_URL = process.env.PYTHON_WORKER_URL || 'http://127.0.0.1:8000';

function isValidPythonStagedId(id: unknown): id is string {
  const s = String(id || '');
  return s.startsWith('staged-') || s.startsWith('upload-');
}

function extractPythonStagedId(upData: any): string | null {
  const cand =
    upData?.asset?.staged_id ||
    upData?.asset?.id ||
    upData?.staged_id ||
    upData?.media_id ||
    null;
  return isValidPythonStagedId(cand) ? cand : null;
}

export async function POST(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const clientProjectId = formData.get('projectId') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 });
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

    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const cleanFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const diskFileName = `${uniqueSuffix}-${cleanFileName}`;
    const filePath = path.join(UPLOAD_DIR, diskFileName);

    fs.writeFileSync(filePath, buffer);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24-hour expiry
    const isVideo = file.type.startsWith('video');

    // Upstream staging on Python worker — preferred so Generate can resolve staged-* ids.
    // If worker is down, keep a local upload-* id so Studio Upload media still works.
    let pythonStagedId: string | null = null;
    let upstreamError = '';
    try {
      const upForm = new FormData();
      upForm.append('file', new Blob([buffer], { type: file.type }), file.name);
      const upRes = await fetch(`${PYTHON_WORKER_URL}/api/assets/stage`, {
        method: 'POST',
        body: upForm,
      });
      if (!upRes.ok) {
        const errText = await upRes.text().catch(() => '');
        upstreamError = `Worker stage returned ${upRes.status}: ${errText.substring(0, 160)}`;
      } else {
        const upData = await upRes.json();
        pythonStagedId = extractPythonStagedId(upData);
        if (!pythonStagedId) {
          upstreamError = 'Worker stage response missing staged-* id';
        }
      }
    } catch (e: any) {
      upstreamError = e?.message || 'Worker stage unreachable';
    }

    const localStagedId = `upload-${diskFileName}`;
    const stagedId = pythonStagedId || localStagedId;
    if (!pythonStagedId) {
      console.warn('[assets/stage] Python stage failed, using local id:', upstreamError);
    }

    const asset = await prisma.asset.create({
      data: {
        userId: session.userId,
        projectId: project.id,
        fileName: file.name,
        fileType: isVideo ? 'video' : 'image',
        mimeType: file.type,
        fileSize: file.size,
        storagePath: filePath,
        url: `/api/assets/file/${diskFileName}`,
        upstreamAssetId: stagedId,
        expiresAt,
      },
    });

    return NextResponse.json({
      success: true,
      asset: {
        id: asset.id,
        staged_id: stagedId,
        url: asset.url,
        name: asset.fileName,
        type: asset.fileType,
        source: 'upload',
      },
      staged_id: stagedId,
      media_id: stagedId,
      localOnly: !pythonStagedId,
      warning: pythonStagedId ? undefined : upstreamError || 'Staged locally (worker offline)',
    });
  } catch (error: any) {
    console.error('Asset stage error:', error);
    return NextResponse.json({ error: error.message || 'Stage failed' }, { status: 500 });
  }
}
