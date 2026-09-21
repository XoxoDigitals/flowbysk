import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';

const UPLOAD_DIR = path.resolve(process.cwd(), 'data/uploads');

export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const filePath = path.join(UPLOAD_DIR, name);

    if (!fs.existsSync(filePath)) {
      return new NextResponse('File not found', { status: 404 });
    }

    // Enforce 24-hour expiration check in database
    const asset = await prisma.asset.findFirst({
      where: { storagePath: filePath },
    });

    if (asset && asset.expiresAt < new Date()) {
      return new NextResponse('This file has expired under the 24-hour retention policy.', {
        status: 410,
      });
    }

    const fileBuffer = fs.readFileSync(filePath);
    const lower = name.toLowerCase();
    const mime =
      asset?.mimeType ||
      (lower.endsWith('.mp4')
        ? 'video/mp4'
        : lower.endsWith('.webm')
          ? 'video/webm'
          : lower.endsWith('.png')
            ? 'image/png'
            : lower.endsWith('.jpg') || lower.endsWith('.jpeg')
              ? 'image/jpeg'
              : lower.endsWith('.webp')
                ? 'image/webp'
                : 'application/octet-stream');

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err: any) {
    return new NextResponse('Error reading file', { status: 500 });
  }
}
