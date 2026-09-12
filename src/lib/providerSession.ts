import { BrowserStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ensureBibAccountReady, bibExportCookies } from '@/lib/bib';
import { resolveTargetFlowProject } from '@/lib/flowProjects';
import { PYTHON_WORKER_URL } from '@/lib/worker';

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
 */
export async function prepareProviderWorkerSession(
  provider: ProviderLike | null | undefined,
  userId?: string | null
): Promise<{ cookies?: string; projectId?: string }> {
  if (!provider?.id) return {};

  let cookies = provider.cookies || undefined;
  const canBib =
    provider.browserStatus === BrowserStatus.READY ||
    provider.browserStatus === 'READY' ||
    (Array.isArray(provider.flowProjectIds) && (provider.flowProjectIds as string[]).length > 0);

  if (canBib) {
    try {
      await ensureBibAccountReady({
        id: provider.id,
        maxParallelLimit: provider.maxParallelLimit,
        flowProjectIds: provider.flowProjectIds,
        profileDir: provider.profileDir,
      });
      const exported = await bibExportCookies(provider.id);
      if (exported?.cookie && exported.cookie.length > 40) {
        cookies = exported.cookie;
        await prisma.providerAccount
          .update({
            where: { id: provider.id },
            data: { cookies: exported.cookie, bibLastSeenAt: new Date() },
          })
          .catch(() => 0);
      }
      // Push cookies into Python worker session so uploads/I2I share the BiB Google login
      if (cookies) {
        await fetch(`${PYTHON_WORKER_URL}/api/auth/cookies`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cookies }),
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
          }),
        }).catch(() => 0);
      }
    } catch (e: any) {
      console.warn('[provider-session] BiB sync failed:', e?.message || e);
    }
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
  /** Skip ready-check and always re-download + re-upload into the target project */
  forceReupload?: boolean;
}): Promise<string | undefined> {
  const mediaId = String(opts.mediaId || '').trim();
  if (!mediaId) return undefined;
  if (mediaId.startsWith('staged-') || mediaId.startsWith('upload-')) {
    // Promote staged local file into Flow via Python upload (HTTP, not generation CDP)
    try {
      if (opts.cookies) {
        await fetch(`${PYTHON_WORKER_URL}/api/auth/cookies`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cookies: opts.cookies }),
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
        console.warn('[refreshFlowMediaId] staged upload failed', await upRes.text().then((t) => t.slice(0, 160)));
      }
    } catch (e: any) {
      console.warn('[refreshFlowMediaId] staged', e?.message || e);
    }
    return mediaId;
  }

  try {
    if (opts.cookies) {
      await fetch(`${PYTHON_WORKER_URL}/api/auth/cookies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies: opts.cookies }),
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

    // Prefer local asset URL / stored flow URL for re-upload only when needed
    let sourceUrl: string | null = null;
    const byUpstream = await prisma.asset.findFirst({
      where: { OR: [{ upstreamAssetId: mediaId }, { id: mediaId }] },
      select: { url: true, storagePath: true },
    });
    if (byUpstream) {
      sourceUrl = byUpstream.url || byUpstream.storagePath || null;
    }
    if (!sourceUrl && /^https?:\/\//i.test(mediaId)) {
      sourceUrl = mediaId;
    }
    if (!sourceUrl && /^[a-f0-9-]{36}$/i.test(mediaId)) {
      sourceUrl = `https://flow-content.google/image/${mediaId}`;
    }
    if (!sourceUrl) return mediaId;

    const imgRes = await fetch(sourceUrl, {
      headers: opts.cookies ? { Cookie: opts.cookies } : undefined,
    });
    if (!imgRes.ok) {
      console.warn('[refreshFlowMediaId] download failed', imgRes.status, sourceUrl.slice(0, 80));
      return mediaId;
    }
    const buf = Buffer.from(await imgRes.arrayBuffer());
    if (buf.length < 100) return mediaId;

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
  }
  return mediaId;
}
