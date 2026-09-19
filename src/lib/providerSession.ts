import { BrowserStatus } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { ensureBibAccountReady, bibExportCookies } from '@/lib/bib';
import { resolveTargetFlowProject } from '@/lib/flowProjects';
import { PYTHON_WORKER_URL } from '@/lib/worker';

const UPLOAD_DIR = path.resolve(process.cwd(), 'data/uploads');

function mimeFromPath(filePath: string, fallback = 'image/jpeg'): string {
  const lower = String(filePath || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return fallback;
}

type ProviderLike = {
  id: string;
  maxParallelLimit?: number | null;
  flowProjectIds?: unknown;
  profileDir?: string | null;
  activeProjectId?: string | null;
  projectUrl?: string | null;
  cookies?: string | null;
  browserStatus?: string | null;
};

/**
 * Ensure BiB Chrome is up, export live cookies into Prisma, pick a Flow project.
 * Used by Python-backed paths (I2I / I2V / ingredients).
 *
 * Fails closed: if BiB is not READY, we skip the export rather than falling back to
 * stale DB cookies (which may be expired and cause silent auth failures).
 */
export async function prepareProviderWorkerSession(
  provider: ProviderLike | null | undefined,
  userId?: string | null
): Promise<{ cookies?: string; projectId?: string }> {
  if (!provider?.id) return {};

  // Always require BiB to be READY; do not fall back to stale DB cookies for HTTP paths
  const isBibReady =
    provider.browserStatus === BrowserStatus.READY ||
    provider.browserStatus === 'READY';

  if (!isBibReady) {
    // Try to auto-ensure if browser was started but status is stale
    const canAutoEnsure =
      Array.isArray(provider.flowProjectIds) && (provider.flowProjectIds as string[]).length > 0;
    if (!canAutoEnsure) {
      // BiB not READY and no projects; cannot proceed safely
      console.warn(`[provider-session] BiB not READY for account ${provider.id}; skipping session prep`);
      return {};
    }
  }

  let cookies: string | undefined;

  try {
    await ensureBibAccountReady({
      id: provider.id,
      maxParallelLimit: provider.maxParallelLimit,
      flowProjectIds: provider.flowProjectIds,
      profileDir: provider.profileDir,
    });
    const exported = await bibExportCookies(provider.id);
    if (!exported?.authenticated || !exported.cookie || exported.cookie.length < 40) {
      // Fail closed: BiB export returned unauthenticated or empty cookie
      console.warn(`[provider-session] BiB export not authenticated for ${provider.id}; failing closed`);
      return {};
    }
    cookies = exported.cookie;
    await prisma.providerAccount
      .update({
        where: { id: provider.id },
        data: { cookies: exported.cookie, bibLastSeenAt: new Date() },
      })
      .catch(() => 0);

    // Push cookies into Python worker session so uploads/I2I share the BiB Google login
    // (accountId selects that account's sticky egress proxy for Python HTTP)
    if (cookies) {
      await fetch(`${PYTHON_WORKER_URL}/api/auth/cookies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies, accountId: provider.id, account_id: provider.id }),
      }).catch(() => 0);
    }
    // Push live WIZ SNlM0e so Python batchexecute works even when labs OAuth is stale
    if (exported?.at && String(exported.at).length >= 20) {
      await fetch(`${PYTHON_WORKER_URL}/api/auth/wiz-meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          at: exported.at,
          bl: exported.bl || undefined,
          sid: exported.sid || undefined,
          preferred_base: 'https://flow.google.com',
          accountId: provider.id,
          account_id: provider.id,
        }),
      }).catch(() => 0);
    }
  } catch (e: any) {
    console.warn('[provider-session] BiB sync failed:', e?.message || e);
    // Fail closed: do not proceed with stale/no cookies
    return {};
  }

  const assignedIds = userId
    ? (
        await prisma.user.findMany({
          where: { assignedProviderAccountId: provider.id },
          select: { id: true },
        })
      ).map((u) => u.id)
    : [];

  let projectId = await resolveTargetFlowProject(
    {
      id: provider.id,
      flowProjectIds: provider.flowProjectIds,
      activeProjectId: provider.activeProjectId,
      projectUrl: provider.projectUrl,
    },
    { preferredUserId: userId || undefined, assignedUserIds: assignedIds }
  );

  if (!projectId) {
    projectId =
      provider.activeProjectId ||
      (provider.projectUrl
        ? provider.projectUrl.split('/project/')[1]?.split('?')[0]?.split('#')[0]?.trim()
        : undefined) ||
      undefined;
  }

  if (projectId) {
    await fetch(`${PYTHON_WORKER_URL}/api/projects/switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId }),
    }).catch(() => 0);
  }

  return { cookies, projectId };
}

/**
 * Reuse an existing Flow media id when it is already Ready in the target project.
 * Only re-upload when the media is missing, not ready, or from another session.
 */
/**
 * Poll the Python worker until a freshly (re)uploaded Flow media id reports READY.
 * Best-effort: returns true when ready, false on timeout, but callers should still
 * proceed on false (no worse than before). This closes the i2i race where ogiZ0b
 * was called while the reference media was still ingesting, which Flow rejects with
 * PUBLIC_ERROR_UNUSUAL_ACTIVITY (batchexecute e=4).
 */
export async function waitFlowMediaReady(
  mediaId: string,
  opts?: { attempts?: number; intervalMs?: number }
): Promise<boolean> {
  if (!/^[a-f0-9-]{36}$/i.test(mediaId)) return true; // not a Flow UUID — nothing to wait on
  const attempts = opts?.attempts ?? 12; // ~4.8s max at 400ms
  const intervalMs = opts?.intervalMs ?? 400;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(
        `${PYTHON_WORKER_URL}/api/assets/${encodeURIComponent(mediaId)}/ready`,
        { method: 'GET' }
      );
      if (res.ok) {
        const d: any = await res.json().catch(() => ({}));
        const ready =
          d?.ready === true ||
          d?.status === 'READY' ||
          d?.asset?.ready === true ||
          String(d?.asset?.status || '').toUpperCase() === 'READY';
        if (ready) return true;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  console.warn(`[refreshFlowMediaId] media ${mediaId.slice(0, 8)} not READY after wait; proceeding`);
  return false;
}

export async function refreshFlowMediaId(opts: {
  mediaId?: string | null;
  cookies?: string;
  projectId?: string;
  /** When set, prefer BiB upload over Python HTTP path */
  accountId?: string;
  /** Skip ready-check and always re-download + re-upload into the target project */
  forceReupload?: boolean;
}): Promise<string | undefined> {
  const mediaId = String(opts.mediaId || '').trim();
  if (!mediaId) return undefined;
  if (mediaId.startsWith('staged-') || mediaId.startsWith('upload-')) {
    // Prefer local prisma asset → BiB base64 upload (avoids CDN / Python staged lookup)
    if (opts.accountId && opts.projectId) {
      try {
        const { bibUploadImage } = await import('@/lib/bib');
        const assetRec = await prisma.asset.findFirst({
          where: { OR: [{ upstreamAssetId: mediaId }, { id: mediaId }] },
          select: { url: true, storagePath: true, mimeType: true },
        });

        let filePath: string | null = null;
        if (assetRec?.storagePath && !String(assetRec.storagePath).startsWith('http')) {
          if (fs.existsSync(assetRec.storagePath)) {
            filePath = assetRec.storagePath;
          }
        }
        if (!filePath && assetRec?.url) {
          const m = String(assetRec.url).match(/^\/api\/assets\/file\/(.+)$/);
          if (m?.[1]) {
            const candidate = path.join(UPLOAD_DIR, path.basename(m[1]));
            if (fs.existsSync(candidate)) filePath = candidate;
          }
        }

        if (filePath) {
          const buf = fs.readFileSync(filePath);
          if (buf.length >= 100) {
            const mimeType =
              assetRec?.mimeType || mimeFromPath(filePath, 'image/jpeg');
            const { withSystemErrorRetry } = await import('./systemErrorRetry');
            const bibResult = await withSystemErrorRetry(
              () =>
                bibUploadImage({
                  accountId: opts.accountId!,
                  projectId: opts.projectId,
                  imageBase64: buf.toString('base64'),
                  mimeType,
                  filename: path.basename(filePath!),
                }),
              {
                label: `refreshFlowMediaId:${mediaId.slice(0, 8)}`,
                providerAccountId: opts.accountId,
                delayMs: 2000,
                maxAttempts: 3,
              }
            );
            if (bibResult?.mediaId) {
              console.info(
                `[refreshFlowMediaId] BiB local ${mediaId} → ${bibResult.mediaId.slice(0, 8)}`
              );
              await waitFlowMediaReady(bibResult.mediaId);
              return bibResult.mediaId;
            }
          }
        }
      } catch (bibErr: any) {
        const { isUnusualActivityError } = await import('./unusualActivityProxyRotate');
        if (isUnusualActivityError(bibErr)) throw bibErr;
        console.warn(
          '[refreshFlowMediaId] BiB local staged upload failed, falling back:',
          bibErr?.message || bibErr
        );
      }
    }

    // Python staged_id upload fallback — staged-* only (upload-* is local-only)
    if (mediaId.startsWith('staged-')) {
      try {
        if (opts.cookies) {
          await fetch(`${PYTHON_WORKER_URL}/api/auth/cookies`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              cookies: opts.cookies,
              accountId: opts.accountId,
              account_id: opts.accountId,
            }),
          }).catch(() => 0);
        }
        if (opts.projectId) {
          await fetch(`${PYTHON_WORKER_URL}/api/projects/switch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project_id: opts.projectId }),
          }).catch(() => 0);
        }
        const form = new FormData();
        form.append('staged_id', mediaId);
        const upRes = await fetch(`${PYTHON_WORKER_URL}/api/assets/upload`, {
          method: 'POST',
          body: form,
        });
        if (upRes.ok) {
          const data = await upRes.json().catch(() => ({}));
          const newId = data?.asset?.id || data?.id;
          if (newId && typeof newId === 'string') {
            console.info(`[refreshFlowMediaId] staged ${mediaId} → ${newId.slice(0, 8)}`);
            await waitFlowMediaReady(newId);
            return newId;
          }
        } else {
          console.warn(
            '[refreshFlowMediaId] staged upload failed',
            await upRes.text().then((t) => t.slice(0, 160))
          );
        }
      } catch (e: any) {
        console.warn('[refreshFlowMediaId] staged', e?.message || e);
      }
    }

    if (mediaId.startsWith('upload-')) {
      throw new Error(
        `Failed to promote local upload ${mediaId} into Flow — file missing or BiB upload unavailable`
      );
    }
    return mediaId;
  }

  try {
    if (opts.cookies) {
      await fetch(`${PYTHON_WORKER_URL}/api/auth/cookies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cookies: opts.cookies,
          accountId: opts.accountId,
          account_id: opts.accountId,
        }),
      }).catch(() => 0);
    }
    if (opts.projectId) {
      await fetch(`${PYTHON_WORKER_URL}/api/projects/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: opts.projectId }),
      }).catch(() => 0);
    }

    // Fast path: media already Ready in Flow — do not re-upload
    if (!opts.forceReupload && /^[a-f0-9-]{36}$/i.test(mediaId)) {
      const readyRes = await fetch(
        `${PYTHON_WORKER_URL}/api/assets/${encodeURIComponent(mediaId)}/ready`,
        { method: 'GET' }
      ).catch(() => null);
      if (readyRes?.ok) {
        const readyData = await readyRes.json().catch(() => ({}));
        const ready =
          readyData?.ready === true ||
          readyData?.status === 'READY' ||
          readyData?.asset?.ready === true ||
          String(readyData?.asset?.status || '').toUpperCase() === 'READY';
        if (ready) {
          console.info(`[refreshFlowMediaId] reuse ready ${mediaId.slice(0, 8)}`);
          return mediaId;
        }
      }
    }

    // Prefer local asset bytes / stored flow URL for re-upload only when needed
    let sourceUrl: string | null = null;
    let localFilePath: string | null = null;
    const byUpstream = await prisma.asset.findFirst({
      where: { OR: [{ upstreamAssetId: mediaId }, { id: mediaId }] },
      select: { url: true, storagePath: true, mimeType: true },
    });
    if (byUpstream) {
      sourceUrl = byUpstream.url || byUpstream.storagePath || null;
      if (byUpstream.storagePath && !String(byUpstream.storagePath).startsWith('http')) {
        if (fs.existsSync(byUpstream.storagePath)) localFilePath = byUpstream.storagePath;
      }
      if (!localFilePath && byUpstream.url) {
        const m = String(byUpstream.url).match(/^\/api\/assets\/file\/(.+)$/);
        if (m?.[1]) {
          const candidate = path.join(UPLOAD_DIR, path.basename(m[1]));
          if (fs.existsSync(candidate)) localFilePath = candidate;
        }
      }
    }
    // Character portraits may live on Character.portraitUrl / traits.local_image_path
    if (!localFilePath && /^[a-f0-9-]{36}$/i.test(mediaId)) {
      const charRec = await prisma.character
        .findFirst({
          where: { id: mediaId },
          select: { portraitUrl: true, traits: true },
        })
        .catch(() => null);
      if (charRec) {
        const traits =
          charRec.traits && typeof charRec.traits === 'object'
            ? (charRec.traits as Record<string, any>)
            : {};
        const localPath = String(traits.local_image_path || '').trim();
        if (localPath && fs.existsSync(localPath)) localFilePath = localPath;
        else if (charRec.portraitUrl && !sourceUrl) sourceUrl = charRec.portraitUrl;
      }
    }
    if (!sourceUrl && /^https?:\/\//i.test(mediaId)) {
      sourceUrl = mediaId;
    }
    if (!sourceUrl && /^[a-f0-9-]{36}$/i.test(mediaId)) {
      sourceUrl = `https://flow-content.google/image/${mediaId}`;
    }
    if (!sourceUrl && !localFilePath) return mediaId;

    // Prefer BiB base64 from local disk — avoids CDN 403
    if (opts.accountId && opts.projectId && localFilePath) {
      try {
        const { bibUploadImage } = await import('@/lib/bib');
        const buf = fs.readFileSync(localFilePath);
        if (buf.length >= 100) {
          const bibResult = await bibUploadImage({
            accountId: opts.accountId,
            projectId: opts.projectId,
            imageBase64: buf.toString('base64'),
            mimeType: byUpstream?.mimeType || mimeFromPath(localFilePath),
            filename: path.basename(localFilePath),
          });
          if (bibResult?.mediaId) {
            console.info(
              `[refreshFlowMediaId] BiB local-file ${mediaId.slice(0, 8)} → ${bibResult.mediaId.slice(0, 8)}`
            );
            await waitFlowMediaReady(bibResult.mediaId);
            return bibResult.mediaId;
          }
        }
      } catch (bibErr: any) {
        const { isUnusualActivityError } = await import('./unusualActivityProxyRotate');
        if (isUnusualActivityError(bibErr)) throw bibErr;
        console.warn(
          '[refreshFlowMediaId] BiB local-file upload failed:',
          bibErr?.message || bibErr
        );
      }
    }

    // Prefer BiB upload when accountId and projectId are provided
    if (opts.accountId && opts.projectId && sourceUrl) {
      try {
        const { bibUploadImage } = await import('@/lib/bib');
        // If CDN URL, pull via same-origin proxy into base64 first
        let imageBase64: string | undefined;
        let imageUrl: string | undefined = sourceUrl;
        if (/flow-content\.google|googleusercontent\.com/i.test(sourceUrl)) {
          try {
            const origin =
              process.env.NEXTAUTH_URL ||
              process.env.APP_URL ||
              'http://127.0.0.1:3000';
            const proxyUrl = `${origin.replace(/\/$/, '')}/api/assets/proxy?url=${encodeURIComponent(sourceUrl)}`;
            const proxied = await fetch(proxyUrl, {
              headers: opts.cookies ? { Cookie: opts.cookies } : undefined,
            }).catch(() => null);
            if (proxied?.ok) {
              const buf = Buffer.from(await proxied.arrayBuffer());
              if (buf.length >= 100) {
                imageBase64 = buf.toString('base64');
                imageUrl = undefined;
              }
            }
          } catch {
            /* keep imageUrl */
          }
        }
        const bibResult = await bibUploadImage({
          accountId: opts.accountId,
          projectId: opts.projectId,
          imageUrl,
          imageBase64,
        });
        if (bibResult?.mediaId) {
          console.info(`[refreshFlowMediaId] BiB reupload ${mediaId.slice(0, 8)} → ${bibResult.mediaId.slice(0, 8)}`);
          await waitFlowMediaReady(bibResult.mediaId);
          return bibResult.mediaId;
        }
      } catch (bibErr: any) {
        const { isUnusualActivityError } = await import('./unusualActivityProxyRotate');
        if (isUnusualActivityError(bibErr)) throw bibErr;
        console.warn('[refreshFlowMediaId] BiB reupload failed, falling back to Python:', bibErr?.message || bibErr);
      }
    }

    if (!sourceUrl) {
      if (opts.forceReupload) {
        throw new Error(`Failed to re-upload media ${mediaId} into Flow (no fetchable source)`);
      }
      return mediaId;
    }

    const imgRes = await fetch(sourceUrl, {
      headers: opts.cookies ? { Cookie: opts.cookies } : undefined,
    });
    if (!imgRes.ok) {
      console.warn('[refreshFlowMediaId] download failed', imgRes.status, sourceUrl.slice(0, 80));
      if (opts.forceReupload) {
        throw new Error(
          `Failed to re-upload media ${mediaId} into Flow (download ${imgRes.status})`
        );
      }
      return mediaId;
    }
    const buf = Buffer.from(await imgRes.arrayBuffer());
    if (buf.length < 100) {
      if (opts.forceReupload) {
        throw new Error(`Failed to re-upload media ${mediaId} into Flow (empty download)`);
      }
      return mediaId;
    }

    // If BiB available, upload bytes as base64 instead of Python when CDN path already failed
    if (opts.accountId && opts.projectId) {
      try {
        const { bibUploadImage } = await import('@/lib/bib');
        const bibResult = await bibUploadImage({
          accountId: opts.accountId,
          projectId: opts.projectId,
          imageBase64: buf.toString('base64'),
          mimeType: imgRes.headers.get('content-type') || 'image/png',
          filename: `refresh-${mediaId.slice(0, 8)}.png`,
        });
        if (bibResult?.mediaId) {
          console.info(
            `[refreshFlowMediaId] BiB bytes ${mediaId.slice(0, 8)} → ${bibResult.mediaId.slice(0, 8)}`
          );
          await waitFlowMediaReady(bibResult.mediaId);
          return bibResult.mediaId;
        }
      } catch (bibErr: any) {
        const { isUnusualActivityError } = await import('./unusualActivityProxyRotate');
        if (isUnusualActivityError(bibErr)) throw bibErr;
        console.warn('[refreshFlowMediaId] BiB bytes upload failed:', bibErr?.message || bibErr);
      }
    }

    const form = new FormData();
    const blob = new Blob([new Uint8Array(buf)], {
      type: imgRes.headers.get('content-type') || 'image/png',
    });
    form.append('file', blob, `refresh-${mediaId.slice(0, 8)}.png`);

    const upRes = await fetch(`${PYTHON_WORKER_URL}/api/assets/upload`, {
      method: 'POST',
      body: form,
    });
    if (!upRes.ok) {
      console.warn('[refreshFlowMediaId] upload failed', await upRes.text().then((t) => t.slice(0, 160)));
      if (opts.forceReupload) {
        throw new Error(`Failed to re-upload media ${mediaId} into Flow (Python upload failed)`);
      }
      return mediaId;
    }
    const data = await upRes.json().catch(() => ({}));
    const newId = data?.asset?.id || data?.id;
    if (newId && typeof newId === 'string') {
      console.info(`[refreshFlowMediaId] ${mediaId.slice(0, 8)} → ${newId.slice(0, 8)}`);
      await waitFlowMediaReady(newId);
      return newId;
    }
  } catch (e: any) {
    console.warn('[refreshFlowMediaId]', e?.message || e);
    if (opts.forceReupload) throw e;
  }
  if (opts.forceReupload) {
    throw new Error(`Failed to re-upload media ${mediaId} into Flow`);
  }
  return mediaId;
}
