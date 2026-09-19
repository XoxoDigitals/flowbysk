import { prisma } from '@/lib/prisma';
import { StudioLogLevel, Prisma, JobStatus } from '@prisma/client';

export type StudioLogInput = {
  level?: string;
  message: string;
  source?: string;
  runId?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  flowEmail?: string | null;
  details?: Prisma.InputJsonValue | null;
};

export type StudioRunStatus =
  | 'QUEUED'
  | 'GENERATING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'WARN'
  | 'INFO';

/** Fast in-process set so worker retries/log ingest stop immediately after cancel. */
const cancelledRunIds = new Map<string, number>();
const CANCELLED_RUN_TTL_MS = 60 * 60 * 1000;

export function markRunCancelled(runId?: string | null) {
  const id = (runId || '').trim();
  if (!id) return;
  cancelledRunIds.set(id, Date.now() + CANCELLED_RUN_TTL_MS);
}

export function isRunMarkedCancelled(runId?: string | null): boolean {
  const id = (runId || '').trim();
  if (!id) return false;
  const exp = cancelledRunIds.get(id);
  if (!exp) return false;
  if (Date.now() > exp) {
    cancelledRunIds.delete(id);
    return false;
  }
  return true;
}

export function isUserCancelLogMessage(message: string): boolean {
  return /^(stop(ped)?\s*by\s*user|cancelled( by user)?|canceled( by user)?)\b/i.test(
    String(message || '').trim()
  );
}

/** True if this runId was cancelled (memory mark, cancel log, or CANCELLED job). */
export async function isRunCancelled(runId?: string | null): Promise<boolean> {
  const id = (runId || '').trim();
  if (!id) return false;
  if (isRunMarkedCancelled(id)) return true;

  const cancelLog = await prisma.studioLog.findFirst({
    where: {
      runId: id,
      OR: [
        { message: { equals: 'Cancelled by user', mode: 'insensitive' } },
        { message: { equals: 'Stop by user', mode: 'insensitive' } },
        { message: { startsWith: 'Cancelled by user', mode: 'insensitive' } },
        { message: { startsWith: 'Stop by user', mode: 'insensitive' } },
      ],
    },
    select: { id: true },
  });
  if (cancelLog) {
    markRunCancelled(id);
    return true;
  }

  const jobs = await prisma.generationJob.findMany({
    where: {
      status: JobStatus.CANCELLED,
      OR: [{ id }, { parameters: { path: ['run_id'], equals: id } }],
    },
    take: 1,
    select: { id: true },
  });
  if (jobs.length) {
    markRunCancelled(id);
    return true;
  }
  return false;
}

function mapLevel(raw?: string): StudioLogLevel {
  const v = String(raw || 'info').toLowerCase().trim();
  if (v === 'warning' || v === 'warn') return StudioLogLevel.WARN;
  if (v === 'error' || v === 'critical') return StudioLogLevel.ERROR;
  if (v === 'debug') return StudioLogLevel.DEBUG;
  return StudioLogLevel.INFO;
}

/** Prefer SaaS userId; else resolve by userEmail / flowEmail / provider account email. */
export async function resolveStudioLogUser(opts: {
  userId?: string | null;
  userEmail?: string | null;
  flowEmail?: string | null;
}): Promise<{ userId: string | null; userEmail: string | null; flowEmail: string | null }> {
  const flowEmail = (opts.flowEmail || '').trim().toLowerCase() || null;
  let userId = (opts.userId || '').trim() || null;
  let userEmail = (opts.userEmail || '').trim().toLowerCase() || null;

  if (userId) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (u) {
      return { userId: u.id, userEmail: u.email, flowEmail };
    }
    userId = null;
  }

  const emailCandidates = [userEmail, flowEmail].filter(Boolean) as string[];
  for (const email of emailCandidates) {
    const byUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    });
    if (byUser) {
      return { userId: byUser.id, userEmail: byUser.email, flowEmail };
    }
  }

  if (flowEmail) {
    const provider = await prisma.providerAccount.findFirst({
      where: { accountEmail: { equals: flowEmail, mode: 'insensitive' } },
      select: {
        assignedUsers: { select: { id: true, email: true }, take: 1 },
      },
    });
    const assigned = provider?.assignedUsers?.[0];
    if (assigned) {
      return { userId: assigned.id, userEmail: assigned.email, flowEmail };
    }
  }

  return { userId: null, userEmail, flowEmail };
}

export async function createStudioLog(input: StudioLogInput) {
  const message = String(input.message || '').slice(0, 4000);
  if (!message) throw new Error('message required');

  const identity = await resolveStudioLogUser({
    userId: input.userId,
    userEmail: input.userEmail,
    flowEmail: input.flowEmail,
  });

  const runId = (input.runId || '').trim() || null;

  // After user cancel, drop further tracking events for this run (retries, reCAPTCHA, etc.)
  if (runId && !isUserCancelLogMessage(message) && (await isRunCancelled(runId))) {
    return null;
  }

  if (runId && isUserCancelLogMessage(message)) {
    markRunCancelled(runId);
  }

  return prisma.studioLog.create({
    data: {
      level: mapLevel(input.level),
      message,
      source: String(input.source || 'studio').slice(0, 64),
      details: input.details ?? undefined,
      runId,
      userId: identity.userId,
      userEmail: identity.userEmail,
      flowEmail: identity.flowEmail,
    },
  });
}

/** Label for "Generation queued (…)" — matches Studio / Bulk tool names. */
export function resolveQueuedModeLabel(opts: {
  source?: string | null;
  kind?: 'video' | 'image' | 'image-to-video' | 'image-to-image';
}): string {
  const s = String(opts.source || '')
    .toLowerCase()
    .trim();
  if (/bulkt2v|bulk[_-]?t2v/.test(s)) return 'bulkt2v';
  if (/bulki2v|bulk[_-]?i2v/.test(s)) return 'bulki2v';
  if (/bulkt2i|bulk[_-]?t2i/.test(s)) return 'bulkt2i';
  if (/storyteller/.test(s)) return 'storyteller';
  if (opts.kind === 'image-to-video') return 'i2v';
  if (opts.kind === 'image-to-image') return 'i2i';
  if (opts.kind === 'image') return 'image';
  return 'video';
}

/**
 * Studio-style queue trail for Bulk / Storyteller / plan-limit waits.
 * Returns the user-facing queueMessage to store on the job.
 */
export async function logGenerationQueued(opts: {
  runId?: string | null;
  userId: string;
  userEmail?: string | null;
  flowEmail?: string | null;
  prompt: string;
  source?: string | null;
  kind: 'video' | 'image' | 'image-to-video' | 'image-to-image';
  planLimit: number;
  activeJobs: number;
  /** True when no Google provider was available. */
  noProvider?: boolean;
}): Promise<string> {
  const { toUserFacingQueueMessage } = await import('@/lib/userMessages');
  const mode = resolveQueuedModeLabel({ source: opts.source, kind: opts.kind });
  const runId = String(opts.runId || '').trim() || undefined;
  const atLimit = opts.activeJobs >= opts.planLimit;

  const internal = opts.noProvider
    ? 'In Queue: Waiting for a Google provider (BiB Launch / free user slot).'
    : atLimit
      ? `In Queue: Plan parallel generation limit (${opts.planLimit}) reached.`
      : `In Queue: Bulk ${mode} background`;
  const queueMsg = toUserFacingQueueMessage(internal);

  await createStudioLog({
    level: 'info',
    source: 'ui',
    message: `Generation queued (${mode}): ${String(opts.prompt || '').slice(0, 100)}`,
    runId,
    userId: opts.userId,
    userEmail: opts.userEmail,
    flowEmail: opts.flowEmail,
  });

  await createStudioLog({
    level: 'info',
    source: 'generate',
    message: atLimit
      ? `Waiting in queue. Your plan parallel limit (${opts.planLimit}) is reached — starts when a slot frees (${opts.activeJobs}/${opts.planLimit} active).`
      : opts.noProvider
        ? 'Waiting in queue. Waiting for a free Google account…'
        : queueMsg,
    runId,
    userId: opts.userId,
    userEmail: opts.userEmail,
    flowEmail: opts.flowEmail,
  });

  return queueMsg;
}

/** When dispatcher/API actually submits to Flow — same wording as Studio T2V. */
export async function logGenerationSubmitted(opts: {
  runId?: string | null;
  userId: string;
  userEmail?: string | null;
  flowEmail?: string | null;
  kind: 't2v' | 'i2v' | 't2i' | 'i2i';
  prompt?: string | null;
}) {
  const runId = String(opts.runId || '').trim() || undefined;
  const promptSlice = String(opts.prompt || '').trim().slice(0, 60);
  const base =
    opts.kind === 'i2v'
      ? 'I2V submitted — polling Flow for result…'
      : opts.kind === 't2i'
        ? 'T2I submitted — waiting for Flow…'
        : opts.kind === 'i2i'
          ? 'I2I submitted — waiting for Flow…'
          : 'T2V submitted — polling Flow for result…';
  const message = promptSlice ? `${base} — ${promptSlice}` : base;

  // Dedupe: avoid double log if route already wrote the same line
  if (runId) {
    const existing = await prisma.studioLog.findFirst({
      where: {
        runId,
        message: { startsWith: base.slice(0, 24) },
        createdAt: { gte: new Date(Date.now() - 2 * 60 * 1000) },
      },
      select: { id: true },
    });
    if (existing) return;
  }

  await createStudioLog({
    level: 'info',
    source: 'generate',
    message,
    runId,
    userId: opts.userId,
    userEmail: opts.userEmail,
    flowEmail: opts.flowEmail,
  });
}

/**
 * Immediate accept log for sync Studio/tool gens (not waiting in queue).
 * Dedupe so UI + server don't double-write.
 */
export async function logGenerationAccepted(opts: {
  runId?: string | null;
  userId: string;
  userEmail?: string | null;
  flowEmail?: string | null;
  prompt: string;
  source?: string | null;
  kind: 'video' | 'image' | 'image-to-video' | 'image-to-image';
}) {
  const mode = resolveQueuedModeLabel({ source: opts.source, kind: opts.kind });
  const runId = String(opts.runId || '').trim() || undefined;
  const message = `Generation queued (${mode}): ${String(opts.prompt || '').slice(0, 100)}`;

  if (runId) {
    const existing = await prisma.studioLog.findFirst({
      where: {
        runId,
        message: { startsWith: 'Generation queued' },
        createdAt: { gte: new Date(Date.now() - 2 * 60 * 1000) },
      },
      select: { id: true },
    });
    if (existing) return;
  }

  await createStudioLog({
    level: 'info',
    source: 'generate',
    message,
    runId,
    userId: opts.userId,
    userEmail: opts.userEmail,
    flowEmail: opts.flowEmail,
  });
}

/** Terminal complete line — short prompt slice; includes Google flowEmail when known. */
export async function logGenerationComplete(opts: {
  runId?: string | null;
  userId: string;
  userEmail?: string | null;
  flowEmail?: string | null;
  kind: 't2v' | 'i2v' | 't2i' | 'i2i';
  prompt?: string | null;
  durationSec?: number;
}) {
  const runId = String(opts.runId || '').trim() || undefined;
  const secs =
    opts.durationSec != null && Number.isFinite(opts.durationSec)
      ? ` (${Math.max(0.1, opts.durationSec).toFixed(1)}s)`
      : '';
  const label =
    opts.kind === 'i2v'
      ? 'I2V'
      : opts.kind === 't2i'
        ? 'T2I'
        : opts.kind === 'i2i'
          ? 'I2I'
          : 'T2V';
  const message = `${label} complete${secs}: ${String(opts.prompt || 'scene').slice(0, 80)}`;

  if (runId) {
    const existing = await prisma.studioLog.findFirst({
      where: {
        runId,
        OR: [
          { message: { startsWith: `${label} complete` } },
          { message: { startsWith: 'Video complete' } },
          { message: { startsWith: 'Image complete' } },
        ],
        createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
      },
      select: { id: true },
    });
    if (existing) {
      // Backfill flowEmail on older complete row if missing
      if (opts.flowEmail) {
        await prisma.studioLog
          .updateMany({
            where: { id: existing.id, flowEmail: null },
            data: { flowEmail: opts.flowEmail },
          })
          .catch(() => 0);
      }
      return;
    }
  }

  await createStudioLog({
    level: 'info',
    source: 'generate',
    message,
    runId,
    userId: opts.userId,
    userEmail: opts.userEmail,
    flowEmail: opts.flowEmail,
  });
}

/** Terminal fail line — keeps Studio Logs off GENERATING when the job is FAILED. */
export async function logGenerationFailed(opts: {
  runId?: string | null;
  userId: string;
  userEmail?: string | null;
  flowEmail?: string | null;
  kind: 't2v' | 'i2v' | 't2i' | 'i2i' | 'ingredients';
  error?: string | null;
  prompt?: string | null;
}) {
  const runId = String(opts.runId || '').trim() || undefined;
  const label =
    opts.kind === 'i2v'
      ? 'I2V'
      : opts.kind === 't2i'
        ? 'T2I'
        : opts.kind === 'i2i'
          ? 'I2I'
          : opts.kind === 'ingredients'
            ? 'Ingredients'
            : 'Video';
  const errSlice = String(opts.error || 'Generation failed').replace(/\s+/g, ' ').trim().slice(0, 120);
  const promptSlice = String(opts.prompt || '').trim().slice(0, 80);
  const message = promptSlice
    ? `${label} failed: ${errSlice} — ${promptSlice}`
    : `${label} failed: ${errSlice}`;

  if (runId) {
    const existing = await prisma.studioLog.findFirst({
      where: {
        runId,
        OR: [
          { message: { startsWith: `${label} failed` } },
          { message: { startsWith: 'Video failed' } },
          { message: { startsWith: 'Generation failed' } },
        ],
        createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
      },
      select: { id: true },
    });
    if (existing) {
      if (opts.flowEmail) {
        await prisma.studioLog
          .updateMany({
            where: { id: existing.id, flowEmail: null },
            data: { flowEmail: opts.flowEmail },
          })
          .catch(() => 0);
      }
      return;
    }
  }

  await createStudioLog({
    level: 'error',
    source: 'generate',
    message,
    runId,
    userId: opts.userId,
    userEmail: opts.userEmail,
    flowEmail: opts.flowEmail,
  });
}

function isTerminalCompleteMessage(message: string): boolean {
  return /\b(?:t2[iv]|i2[iv])\s+complete\b|\bingredients?\s+complete\b|\bvideo complete\b|\bimage complete\b|\bi2i complete\b|\bupscale complete\b|\bcomplete:\s*\d+\s+asset|\basset\(s\)\s*$|\bupscaled to 1080p successfully\b/i.test(
    String(message || '')
  );
}

/** Real generation failure — not transient UI/network noise like "Failed to fetch". */
function isTerminalFailMessage(message: string): boolean {
  const msg = String(message || '');
  if (/failed to fetch|networkerror|load failed|aborted|err_network|econnreset|econnrefused|socket hang up/i.test(msg)) {
    return false;
  }
  return (
    /\b(?:t2[iv]|i2[iv]|video|image|i2i|upscale|generation|ingredient)\s+failed\b/i.test(msg) ||
    /^video failed:/i.test(msg) ||
    /^generation failed\b/i.test(msg) ||
    /\bfailed:\s*(?:no |empty |timeout|unusual|captcha|login|account)/i.test(msg)
  );
}

export function deriveRunStatus(
  events: Array<{ level: string; message: string; createdAt?: Date | string }>
): StudioRunStatus {
  if (events.some((e) => isUserCancelLogMessage(e.message))) {
    return 'CANCELLED';
  }

  // Chronological last terminal wins so retry-after-fail → COMPLETED (not stuck FAILED).
  const sorted = [...events].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return ta - tb;
  });

  let lastTerminal: StudioRunStatus | null = null;
  for (const e of sorted) {
    if (isUserCancelLogMessage(e.message)) {
      lastTerminal = 'CANCELLED';
      continue;
    }
    if (isTerminalCompleteMessage(e.message)) {
      lastTerminal = 'COMPLETED';
      continue;
    }
    if (isTerminalFailMessage(e.message)) {
      lastTerminal = 'FAILED';
      continue;
    }
  }
  if (lastTerminal) return lastTerminal;

  const text = events.map((e) => `${e.level} ${e.message}`).join('\n').toLowerCase();

  // Past the initial queue ack — worker accepted / rendering / ingredients / started / upload / upscale
  if (
    /\bgenerating\b|\bdispatch|\brender|\bwaiting|\bupload|\bupscal|\bwhisking\b|\bwhisky\b|\bstarted\b|\bingredient mode\b|\bingredients?\s+(?:video|image)\b|\bt2[iv]\s+generate\b|\bi2[iv]\s+generate\b|\banimat/.test(
      text
    )
  ) {
    return 'GENERATING';
  }
  if (/\bqueued\b|\bin queue\b|\bin_queue\b|\bqueue\b|\back\b/.test(text)) {
    return 'QUEUED';
  }
  if (events.some((e) => e.level === 'WARN')) return 'WARN';
  // Lone ERROR without a real generation-fail message → still surface as failed
  if (events.some((e) => e.level === 'ERROR' && isTerminalFailMessage(e.message))) {
    return 'FAILED';
  }
  if (
    events.some(
      (e) =>
        e.level === 'ERROR' &&
        !/failed to fetch|networkerror|load failed|aborted|err_network/i.test(e.message)
    )
  ) {
    return 'FAILED';
  }
  return 'INFO';
}

export function extractRunTitle(message: string): string {
  const m = String(message || '');
  if (/\bcomplete\b|\bfailed\b/i.test(m) && /asset\(s\)|^\s*T2[IV]\s+complete/i.test(m)) {
    return '';
  }
  const patterns = [
    /Generation queued\s*\([^)]*\):\s*(.+)$/i,
    /T2[IV]\s+generate(?:\s*×\d+)?:\s*(.+)$/i,
    /T2[IV]\s+generating[^:]*:\s*(.+)$/i,
    /I2[IV]\s+generate(?:\s*×\d+)?:\s*(.+)$/i,
    /I2[IV]\s+(?:generating|animating|will upload)[^:]*:\s*(.+)$/i,
    /Ingredient mode\s*\([^)]*\):\s*(.+)$/i,
    /Ingredients?\s+(?:video|image):\s*(.+)$/i,
    /(?:I2I|Remix)[^:]*:\s*(.+)$/i,
    /T2V[^:]*:\s*(.+)$/i,
  ];
  for (const re of patterns) {
    const hit = m.match(re);
    if (hit?.[1]) {
      const title = hit[1].trim();
      if (!title || /^\d+\s+asset/i.test(title)) continue;
      return title.slice(0, 140);
    }
  }
  return m.slice(0, 140) || 'Studio event';
}

function whoKey(log: {
  userId?: string | null;
  userEmail?: string | null;
  flowEmail?: string | null;
  user?: { id: string; email: string } | null;
}): string {
  return log.userId || log.user?.id || log.userEmail || log.flowEmail || 'anon';
}

/** Parse media + tool chips from queued/mode messages already written on the run. */
export function deriveRunLabels(events: Array<{ message: string; source?: string }>): {
  mediaKind: 'img' | 'video' | null;
  toolLabel: string | null;
  mode: string | null;
} {
  let mode: string | null = null;
  for (const e of events) {
    const queued = String(e.message || '').match(/Generation queued\s*\(([^)]+)\)/i);
    if (queued?.[1]) {
      mode = queued[1].trim().toLowerCase();
      break;
    }
  }
  const joined = events.map((e) => e.message).join('\n');
  if (!mode) {
    if (/\b(?:bulkt2v|bulk[_-]?t2v)\b/i.test(joined)) mode = 'bulkt2v';
    else if (/\b(?:bulki2v|bulk[_-]?i2v)\b/i.test(joined)) mode = 'bulki2v';
    else if (/\b(?:bulkt2i|bulk[_-]?t2i)\b/i.test(joined)) mode = 'bulkt2i';
    else if (/\bstoryteller\b/i.test(joined)) mode = 'storyteller';
    else if (/\bwhisk\b/i.test(joined) || events.some((e) => /whisk/i.test(String(e.source || ''))))
      mode = 'whisk';
    else if (/\bextend\b/i.test(joined) || events.some((e) => /extend/i.test(String(e.source || ''))))
      mode = 'extend';
    else if (/\bingredients?\b/i.test(joined)) mode = 'ingredients';
    else if (/\bi2i\b/i.test(joined)) mode = 'i2i';
    else if (/\bi2v\b/i.test(joined)) mode = 'i2v';
    else if (/\bt2i\b/i.test(joined)) mode = 'image';
    else if (/\bt2v\b/i.test(joined)) mode = 'video';
    else if (/\bimage complete\b|\bimage failed\b/i.test(joined)) mode = 'image';
    else if (/\bvideo complete\b|\bvideo failed\b/i.test(joined)) mode = 'video';
  }

  if (!mode) return { mediaKind: null, toolLabel: null, mode: null };

  let mediaKind: 'img' | 'video' | null = null;
  if (mode === 'ingredients') {
    mediaKind = /\bvideo\b/i.test(joined) && !/\bimage complete\b|\bt2i\b|\bi2i\b/i.test(joined)
      ? 'video'
      : 'img';
  } else if (/bulkt2v|bulki2v|^video$|i2v|t2v|extend/.test(mode)) {
    mediaKind = 'video';
  } else if (/bulkt2i|i2i|^image$|whisk|t2i|storyteller/.test(mode)) {
    mediaKind = 'img';
  }

  let toolLabel: string | null = null;
  if (/^bulk/.test(mode)) toolLabel = 'bulk';
  else if (mode === 'storyteller') toolLabel = 'storyteller';
  else if (mode === 'whisk') toolLabel = 'whisk';
  else if (mode === 'extend') toolLabel = 'extend';
  else if (mode === 'ingredients') toolLabel = 'ingredients';
  else toolLabel = 'studio';

  return { mediaKind, toolLabel, mode };
}

function isRunStartMessage(message: string): boolean {
  return (
    /Generation queued|T2[IV]\s+generate(?!ing)|I2[IV]\s+generate(?!ing)|Ingredient mode|Ingredients?\s+(?:video|image)|Whisk composition/i.test(
      message
    ) && !/\bcomplete\b|\bfailed\b/i.test(message)
  );
}

function isRunFollowupMessage(message: string): boolean {
  return /\bcomplete\b|\bfailed\b|\berror\b|\bgenerating\b|\bupload|\bdispatch|\bstarted\b|\banimat|\bwaiting\b|\bcharacter|\bupscal/i.test(
    message
  );
}

export function groupStudioLogsIntoRuns<
  T extends {
    id: string;
    level: string;
    message: string;
    source: string;
    runId?: string | null;
    userId?: string | null;
    userEmail?: string | null;
    flowEmail?: string | null;
    createdAt: Date | string;
    user?: { id: string; email: string; name: string | null } | null;
  },
>(logs: T[]) {
  const chronological = [...logs].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const keyById = new Map<string, string>();
  const openByWho = new Map<string, { key: string; prompt: string; at: number }[]>();

  const pushOpen = (who: string, key: string, prompt: string, at: number) => {
    const stack = openByWho.get(who) || [];
    stack.push({ key, prompt, at });
    // Keep recent opens only
    openByWho.set(
      who,
      stack.filter((o) => at - o.at < 10 * 60 * 1000).slice(-12)
    );
  };

  const findOpen = (who: string, at: number, prompt?: string) => {
    const stack = openByWho.get(who) || [];
    for (let i = stack.length - 1; i >= 0; i--) {
      const o = stack[i];
      if (at - o.at > 10 * 60 * 1000) continue;
      if (prompt && o.prompt && o.prompt === prompt) return o.key;
      if (!prompt) return o.key;
    }
    if (prompt) {
      for (let i = stack.length - 1; i >= 0; i--) {
        const o = stack[i];
        if (at - o.at <= 10 * 60 * 1000) return o.key;
      }
    }
    return null;
  };

  for (const log of chronological) {
    if (log.runId) {
      const key = `run:${log.runId}`;
      keyById.set(log.id, key);
      const prompt = extractRunTitle(log.message).toLowerCase().replace(/\s+/g, ' ').trim();
      if (isRunStartMessage(log.message) || prompt) {
        pushOpen(whoKey(log), key, prompt, new Date(log.createdAt).getTime());
      }
      continue;
    }

    const who = whoKey(log);
    const at = new Date(log.createdAt).getTime();
    const prompt = extractRunTitle(log.message).toLowerCase().replace(/\s+/g, ' ').trim();
    const meaningfulPrompt =
      prompt && !/^\d+\s+asset/i.test(prompt) && prompt !== 'studio event' ? prompt : '';

    if (isRunStartMessage(log.message) && meaningfulPrompt) {
      // Same user + same prompt within 2 minutes → one run (UI queued + worker generate)
      const bucket = Math.floor(at / (2 * 60 * 1000));
      const key = `h:${who}:${bucket}:${meaningfulPrompt.slice(0, 80)}`;
      keyById.set(log.id, key);
      pushOpen(who, key, meaningfulPrompt, at);
      continue;
    }

    if (isRunFollowupMessage(log.message)) {
      const openKey = findOpen(who, at, meaningfulPrompt || undefined);
      if (openKey) {
        keyById.set(log.id, openKey);
        continue;
      }
    }

    if (meaningfulPrompt && /generat|queue|t2i|t2v|i2i|i2v|upload|whisk/i.test(log.message)) {
      const bucket = Math.floor(at / (2 * 60 * 1000));
      const key = `h:${who}:${bucket}:${meaningfulPrompt.slice(0, 80)}`;
      keyById.set(log.id, key);
      pushOpen(who, key, meaningfulPrompt, at);
      continue;
    }

    keyById.set(log.id, `solo:${log.id}`);
  }

  const map = new Map<string, T[]>();
  for (const log of chronological) {
    const key = keyById.get(log.id) || `solo:${log.id}`;
    const list = map.get(key) || [];
    list.push(log);
    map.set(key, list);
  }

  const runs = [...map.entries()].map(([key, events]) => {
    const sorted = [...events].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const titleEvent =
      sorted.find((e) => {
        const t = extractRunTitle(e.message);
        return t && !/^\d+\s+asset/i.test(t) && isRunStartMessage(e.message);
      }) ||
      sorted.find((e) => {
        const t = extractRunTitle(e.message);
        return Boolean(t && t !== 'Studio event' && !/^\d+\s+asset/i.test(t));
      }) ||
      first;
    const title = extractRunTitle(titleEvent.message) || first.message.slice(0, 140);
    const startedMs = new Date(first.createdAt).getTime();
    const updatedMs = new Date(last.createdAt).getTime();
    const durationMs = Math.max(0, updatedMs - startedMs);
    // Prefer explicit "(12.3s)" from complete messages when present
    let durationSec = durationMs / 1000;
    for (let i = sorted.length - 1; i >= 0; i--) {
      const hit = String(sorted[i].message || '').match(/\((\d+(?:\.\d+)?)s\)/);
      if (hit) {
        durationSec = Number(hit[1]);
        break;
      }
    }
    const labels = deriveRunLabels(sorted);
    return {
      id: key,
      runId: first.runId || sorted.find((e) => e.runId)?.runId || null,
      title: title || 'Studio event',
      status: deriveRunStatus(sorted),
      mediaKind: labels.mediaKind,
      toolLabel: labels.toolLabel,
      mode: labels.mode,
      startedAt: first.createdAt,
      updatedAt: last.createdAt,
      durationMs: Math.round(durationSec * 1000),
      durationSec: Number(durationSec.toFixed(1)),
      userId: first.userId || first.user?.id || sorted.find((e) => e.userId)?.userId || null,
      userEmail:
        first.user?.email ||
        first.userEmail ||
        sorted.find((e) => e.user?.email || e.userEmail)?.user?.email ||
        sorted.find((e) => e.userEmail)?.userEmail ||
        null,
      flowEmail: sorted.find((e) => e.flowEmail)?.flowEmail || first.flowEmail || null,
      eventCount: sorted.length,
      events: sorted,
    };
  });

  runs.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  return runs;
}

