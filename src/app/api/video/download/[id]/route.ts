import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

function dispositionFilename(name: string) {
  const safe = String(name || 'download').replace(/[^\w.\-]+/g, '_');
  return `attachment; filename="${safe}"`;
}

async function streamRemoteAsAttachment(remoteUrl: string, filename: string) {
  const upstream = await fetch(remoteUrl, {
    headers: { Accept: '*/*', 'User-Agent': 'Mozilla/5.0' },
    redirect: 'follow',
  });
  if (!upstream.ok) {
    return NextResponse.json(
      { error: `Upstream fetch failed (${upstream.status})` },
      { status: 502 }
    );
  }
  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  const buf = await upstream.arrayBuffer();
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': dispositionFilename(filename),
      'Cache-Control': 'private, no-store',
    },
  });
}

/**
 * Download original or 1080p upscaled video.
 * Streams bytes with Content-Disposition: attachment (never redirect — that opens a tab).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getOrCreateStudioUser(req);
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ error: 'Asset id required' }, { status: 400 });
    }

    const urlObj = new URL(req.url);
    const wantUpscaled = ['1', 'true', 'yes'].includes(
      String(urlObj.searchParams.get('upscaled') || '').toLowerCase()
    );

    const job = await prisma.generationJob.findFirst({
      where: { id, userId: session.userId },
    });
    const asset = await prisma.asset.findFirst({
      where: { id, userId: session.userId },
    });

    let meta = (job?.outputMetadata as Record<string, any>) || {};
    let linkedJob = job;
    if ((!meta.upscaled_url && asset?.url) || (!job && asset)) {
      const mediaKey =
        asset?.upstreamAssetId ||
        (asset?.url || '').match(/\/video\/([a-f0-9-]{36})/i)?.[1] ||
        '';
      linkedJob =
        (await prisma.generationJob.findFirst({
          where: {
            userId: session.userId,
            OR: [
              ...(asset?.url
                ? [
                    { outputMediaUrl: asset.url },
                    { outputMediaUrl: { startsWith: asset.url.split('?')[0] } },
                  ]
                : []),
              ...(mediaKey
                ? [
                    { outputMediaUrl: { contains: mediaKey } },
                    { parameters: { path: ['bibMediaId'], equals: mediaKey } },
                  ]
                : []),
              { id: asset?.fileName?.replace(/^veo_|\.mp4$/gi, '') || '__none__' },
            ],
          },
          orderBy: { updatedAt: 'desc' },
        })) || job;
      meta = (linkedJob?.outputMetadata as Record<string, any>) || meta;
    }

    const original =
      linkedJob?.outputMediaUrl || asset?.url || job?.outputMediaUrl || '';
    const baseName = `google-flow-${id}${wantUpscaled ? '-1080p' : ''}.mp4`;

    if (wantUpscaled) {
      const hdCandidates = [
        meta.upscaled_download_url,
        meta.upscaled_url,
      ].filter(Boolean) as string[];
      let hdHttps = hdCandidates.find((u) => /^https?:\/\//i.test(String(u)));

      if (!hdHttps && meta.upscaleMediaId && (meta.bibAccountId || linkedJob?.providerAccountId)) {
        try {
          const { bibVideoStatus } = await import('@/lib/bib');
          const bib = await bibVideoStatus({
            accountId: String(meta.bibAccountId || linkedJob?.providerAccountId),
            mediaId: String(meta.upscaleMediaId),
            projectId: meta.bibProjectId || undefined,
          });
          const recovered = bib.videoUrl || bib.url;
          if (recovered && /^https?:\/\//i.test(recovered)) {
            hdHttps = recovered;
            if (linkedJob?.id) {
              await prisma.generationJob.update({
                where: { id: linkedJob.id },
                data: {
                  outputMetadata: {
                    ...meta,
                    upscaled_url: recovered,
                    upscaled_download_url: recovered,
                  },
                },
              });
            }
          }
        } catch (recoverErr: any) {
          console.warn('[download] upscale URL recover failed:', recoverErr?.message || recoverErr);
        }
      }

      if (hdHttps) {
        return streamRemoteAsAttachment(hdHttps, baseName);
      }
      return NextResponse.json(
        {
          error:
            '1080p upscaled file is not available yet. Run Upscale to 1080p first, then download again.',
        },
        { status: 404 }
      );
    }

    if (original && /^https?:\/\//i.test(original)) {
      return streamRemoteAsAttachment(original, baseName);
    }
    if (original && original.startsWith('/')) {
      const origin = new URL(req.url).origin;
      return streamRemoteAsAttachment(`${origin}${original}`, baseName);
    }

    return NextResponse.json({ error: 'Video file not found' }, { status: 404 });
  } catch (err: any) {
    console.error('video download error:', err);
    if (String(err?.message || '').includes('UNAUTHORIZED')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: err.message || 'Download failed' }, { status: 500 });
  }
}
