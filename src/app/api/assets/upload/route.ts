import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import fs from 'fs';
import path from 'path';

const UPLOAD_DIR = path.resolve(process.cwd(), 'data/uploads');
const PYTHON_WORKER_URL = process.env.PYTHON_WORKER_URL || 'http://127.0.0.1:8000';

function findStagedFile(stagedId: string): { filePath: string; fileName: string } | null {
  const id = String(stagedId || '').trim();
  if (!id || (!id.startsWith('staged-') && !id.startsWith('upload-'))) return null;
  if (!fs.existsSync(UPLOAD_DIR)) return null;
  const exact = path.join(UPLOAD_DIR, id);
  if (fs.existsSync(exact) && fs.statSync(exact).isFile()) {
    return { filePath: exact, fileName: path.basename(exact) };
  }
  const match = fs.readdirSync(UPLOAD_DIR).find((name) => name === id || name.startsWith(`${id}.`));
  if (!match) return null;
  return { filePath: path.join(UPLOAD_DIR, match), fileName: match };
}

export async function POST(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const stagedId = String(formData.get('staged_id') || '').trim();
    const clientProjectId = formData.get('projectId') as string | null;
    const localOnly =
      String(formData.get('local_only') || '').trim() === '1' ||
      String(formData.get('local_only') || '').toLowerCase() === 'true';
    const deferFlow =
      localOnly ||
      String(formData.get('defer_flow') || '').trim() === '1' ||
      String(formData.get('defer_flow') || '').toLowerCase() === 'true';

    if (!file && !stagedId) {
      return NextResponse.json(
        { error: 'File or staged_id is required' },
        { status: 400 }
      );
    }

    let project = clientProjectId
      ? await prisma.project.findFirst({ where: { id: clientProjectId, userId: session.userId } })
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

    let buffer: Buffer;
    let originalName: string;
    let mimeType: string;
    let upstreamAssetId: string | undefined;

    if (file) {
      buffer = Buffer.from(await file.arrayBuffer());
      originalName = file.name;
      mimeType = file.type || 'application/octet-stream';
    } else {
      const staged = findStagedFile(stagedId);
      if (!staged) {
        return NextResponse.json(
          { error: `Staged image not found: ${stagedId}` },
          { status: 404 }
        );
      }
      buffer = fs.readFileSync(staged.filePath);
      originalName = staged.fileName;
      mimeType = staged.fileName.toLowerCase().endsWith('.png')
        ? 'image/png'
        : staged.fileName.toLowerCase().endsWith('.webp')
          ? 'image/webp'
          : 'image/jpeg';
      upstreamAssetId = stagedId;
    }

    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const cleanFileName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const diskFileName = `${uniqueSuffix}-${cleanFileName}`;
    const filePath = path.join(UPLOAD_DIR, diskFileName);
    fs.writeFileSync(filePath, buffer);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const isVideo = mimeType.startsWith('video');

    const asset = await prisma.asset.create({
      data: {
        userId: session.userId,
        projectId: project.id,
        fileName: originalName,
        fileType: isVideo ? 'video' : 'image',
        mimeType,
        fileSize: buffer.length,
        storagePath: filePath,
        url: `/api/assets/file/${diskFileName}`,
        upstreamAssetId: upstreamAssetId || undefined,
        expiresAt,
      },
    });

    // Push bytes to Google Flow (deferred for character create — background sync uploads to Flow)
    let flowMediaId: string | null = null;
    if (!isVideo && !deferFlow) {
      try {
        const upForm = new FormData();
        if (upstreamAssetId && (upstreamAssetId.startsWith('staged-') || upstreamAssetId.startsWith('upload-'))) {
          upForm.append('staged_id', upstreamAssetId);
        } else {
          upForm.append('file', new Blob([buffer], { type: mimeType }), originalName);
        }
        const upRes = await fetch(`${PYTHON_WORKER_URL}/api/assets/upload`, {
          method: 'POST',
          body: upForm,
        });
        if (upRes.ok) {
          const upData = await upRes.json().catch(() => ({}));
          flowMediaId =
            upData?.asset?.id ||
            upData?.asset?.media_id ||
            upData?.id ||
            upData?.media_id ||
            null;
          if (flowMediaId) {
            await prisma.asset.update({
              where: { id: asset.id },
              data: { upstreamAssetId: flowMediaId },
            });
          }
        } else {
          const errText = await upRes.text().catch(() => '');
          console.warn('Flow upload after local save failed:', upRes.status, errText.slice(0, 200));
        }
      } catch (flowErr) {
        console.warn('Flow upload after local save skipped:', flowErr);
      }
    }

    const resolvedId = flowMediaId || asset.upstreamAssetId || asset.id;

    return NextResponse.json({
      success: true,
      asset: {
        ...asset,
        upstreamAssetId: flowMediaId || asset.upstreamAssetId || undefined,
        id: resolvedId,
        media_id: resolvedId,
        local_path: filePath,
        path: filePath,
        flow_ready: Boolean(flowMediaId),
        image_media_id: flowMediaId || undefined,
      },
      message: flowMediaId
        ? 'Asset uploaded to Google Flow.'
        : deferFlow
          ? 'Saved for handoff — Google Flow upload runs in background with character sync.'
          : 'Asset saved. Flow media id pending.',
    });
  } catch (error: any) {
    console.error('Asset upload error:', error);
    return NextResponse.json(
      { error: error.message || 'Upload failed' },
      { status: 500 }
    );
  }
}
