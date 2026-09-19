/**
 * Server-side resume for in-flight Flow jobs after BiB restart / closed UI.
 * Polls jobs that already have bibMediaId; re-queues stuck submits without one.
 */

import { prisma } from '@/lib/prisma';
import { JobStatus, type GenerationJob } from '@prisma/client';
import { ensureBibAccountReady } from '@/lib/bib';
import {
  extractJobBibRefs,
  failJobFromResume,
  pollJobBibStatus,
} from '@/lib/jobBibPoll';

const TICK_MS = 15_000;
const BATCH_LIMIT = 20;
/** Skip jobs updated in the last N ms (avoid racing active submit). */
const MIN_IDLE_MS = 10_000;
/** Re-queue GENERATING/RETRYING without mediaId after this age. */
const NO_MEDIA_REQUEUE_MS = 8 * 60 * 1000;
/** Fail mediaId jobs still processing after this age. */
const MEDIA_TIMEOUT_MS = 45 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let started = false;
let ticking = false;

function jobAgeMs(job: GenerationJob): number {
  const t = job.startedAt || job.createdAt || job.updatedAt;
  return Date.now() - new Date(t).getTime();
}

function hasFlowMediaId(job: GenerationJob): boolean {
  return !!extractJobBibRefs(job).mediaId;
}

async function requeueStuckNoMedia(): Promise<number> {
  const cutoff = new Date(Date.now() - NO_MEDIA_REQUEUE_MS);
  const candidates = await prisma.generationJob.findMany({
    where: {
      status: { in: [JobStatus.GENERATING, JobStatus.RETRYING, JobStatus.PREPARING] },
      updatedAt: { lt: cutoff },
    },
    orderBy: { updatedAt: 'asc' },
    take: 30,
  });

  let requeued = 0;
  const userIds = new Set<string>();
  for (const job of candidates) {
    if (hasFlowMediaId(job)) continue;
    const res = await prisma.generationJob.updateMany({
      where: {
        id: job.id,
        status: { in: [JobStatus.GENERATING, JobStatus.RETRYING, JobStatus.PREPARING] },
      },
      data: {
        status: JobStatus.IN_QUEUE,
        progress: 0,
        errorMessage: null,
        startedAt: null,
      },
    });
    if (res.count > 0) {
      requeued += 1;
      userIds.add(job.userId);
    }
  }
  if (userIds.size) {
    const { checkAndDispatchNextJobs } = await import('@/lib/queue');
    for (const uid of userIds) {
      checkAndDispatchNextJobs(uid).catch(console.error);
    }
  }
  return requeued;
}

async function tick() {
  if (ticking) return;
  ticking = true;
  let polled = 0;
  let completed = 0;
  let failed = 0;
  let requeued = 0;
  try {
    requeued = await requeueStuckNoMedia();

    const idleBefore = new Date(Date.now() - MIN_IDLE_MS);
    const candidates = await prisma.generationJob.findMany({
      where: {
        status: {
          in: [
            JobStatus.CHECKING_STATUS,
            JobStatus.GENERATING,
            JobStatus.RETRYING,
            JobStatus.PREPARING,
          ],
        },
        updatedAt: { lt: idleBefore },
      },
      orderBy: { updatedAt: 'asc' },
      take: 80,
    });

    const withMedia = candidates.filter((j) => hasFlowMediaId(j)).slice(0, BATCH_LIMIT);
    if (!withMedia.length && !requeued) return;

    // Group by account — ensure once, poll sequentially per account
    const byAccount = new Map<string, GenerationJob[]>();
    for (const job of withMedia) {
      const { accountId } = extractJobBibRefs(job);
      const key = accountId || '_none';
      if (!byAccount.has(key)) byAccount.set(key, []);
      byAccount.get(key)!.push(job);
    }

    for (const [accountId, jobs] of byAccount) {
      if (accountId !== '_none') {
        try {
          const acc = await prisma.providerAccount.findUnique({
            where: { id: accountId },
            select: {
              id: true,
              maxParallelLimit: true,
              flowProjectIds: true,
              profileDir: true,
            },
          });
          if (acc) await ensureBibAccountReady(acc);
        } catch (e) {
          console.warn(
            `[job-resume] ensure account ${accountId.slice(0, 8)}:`,
            (e as Error)?.message || e
          );
          continue;
        }
      }

      for (const job of jobs) {
        polled += 1;
        try {
          if (jobAgeMs(job) > MEDIA_TIMEOUT_MS) {
            await failJobFromResume(job, 'Generation timed out');
            failed += 1;
            continue;
          }
          const outcome = await pollJobBibStatus(job);
          if (outcome.kind === 'completed') completed += 1;
          else if (outcome.kind === 'failed') failed += 1;
          else if (outcome.kind === 'transient') {
            // Skip remaining jobs for this account this tick
            break;
          }
        } catch (e) {
          console.warn(
            `[job-resume] poll ${job.id.slice(0, 8)}:`,
            (e as Error)?.message || e
          );
        }
      }
    }

    if (polled || completed || failed || requeued) {
      console.log(
        `[job-resume] polled=${polled} completed=${completed} failed=${failed} requeued=${requeued}`
      );
    }
  } catch (e) {
    console.warn('[job-resume] tick failed:', e);
  } finally {
    ticking = false;
  }
}

/** Start background resume loop (idempotent). */
export function startJobStatusResumeLoop() {
  if (started) return;
  started = true;
  void tick();
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  if (typeof timer === 'object' && timer && 'unref' in timer) {
    try {
      (timer as NodeJS.Timeout).unref();
    } catch {
      /* ignore */
    }
  }
  console.log('[job-resume] loop started');
}
