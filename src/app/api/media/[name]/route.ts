import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const cleanName = path.basename(name);

    const uploadsDir = path.join(process.cwd(), 'data', 'uploads');
    const targetPath = path.join(uploadsDir, cleanName);

    // Exact file only — never substitute another upload (hides broken placeholder URLs)
    if (!fs.existsSync(targetPath)) {
      return NextResponse.json({ error: 'Media file not found' }, { status: 404 });
    }

    const stat = fs.statSync(targetPath);
    const fileSize = stat.size;
    const isVideo = targetPath.endsWith('.mp4');
    const mimeType = isVideo ? 'video/mp4' : (targetPath.endsWith('.png') ? 'image/png' : 'image/jpeg');

    const range = req.headers.get('range');
    if (range && isVideo) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;
      const fileStream = fs.createReadStream(targetPath, { start, end });

      // @ts-ignore
      return new NextResponse(fileStream, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize.toString(),
          'Content-Type': mimeType,
        },
      });
    }

    const fileStream = fs.createReadStream(targetPath);
    // @ts-ignore
    return new NextResponse(fileStream, {
      status: 200,
      headers: {
        'Content-Length': fileSize.toString(),
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
