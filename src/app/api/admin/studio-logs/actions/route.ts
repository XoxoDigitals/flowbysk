import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { JobStatus } from '@prisma/client';
import { cancelJob, retryJob, checkAndDispatchNextJobs } from '@/lib/queue';
import { getStudioQueueControl, setStudioQueuePaused } from '@/lib/studioTools';

/**
 * Admin Studio Logs queue actions:
 * - pause / resume global pending queue
 * - cancel generating / queued jobs (by jobId, runId, or status bulk)
 * - retry failed / cancelled jobs
 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    const body = await req.json();
    const action = String(body.action || '').trim();

    if (action === 'pause_queue') {
      const queue = await setStudioQueuePaused(true, admin.email || 'admin');
      return NextResponse.json({ success: true, queue, message: 'Queue paused — pending jobs will wait' });
    }

    if (action === 'start_queue' || action === 'resume_queue') {
      const queue = await setStudioQueuePaused(false, admin.email || 'admin');
      checkAndDispatchNextJobs().catch(console.error);
      return NextResponse.json({ success: true, queue, message: 'Queue resumed' });
    }

    if (action === 'queue_status') {
      const queue = await getStudioQueueControl();
      const counts = await prisma.generationJob.groupBy({
        by: ['status'],
        _count: { _all: true },
        where: {
          status: {
            in: [
              JobStatus.IN_QUEUE,
              JobStatus.PREPARING,
              JobStatus.GENERATING,
              JobStatus.RETRYING,
              JobStatus.FAILED,
            ],
          },
        },
      });
      return NextResponse.json({ success: true, queue, counts });
    }

    if (action === 'cancel') {
      const jobId = String(body.jobId || '').trim();
      const runId = String(body.runId || '').trim();
      if (!jobId && !runId) {
        return NextResponse.json({ error: 'jobId or runId required' }, { status: 400 });
      }

      let jobs: { id: string; userId: string }[] = [];
      if (jobId) {
        const j = await prisma.generationJob.findUnique({
          where: { id: jobId },
          select: { id: true, userId: true },
        });
        if (j) jobs = [j];
      } else if (runId) {
        const all = await prisma.generationJob.findMany({
          where: {
            status: {
              in: [
                JobStatus.IN_QUEUE,
                JobStatus.PREPARING,
                JobStatus.GENERATING,
                JobStatus.RETRYING,
                JobStatus.CHECKING_STATUS,
              ],
            },
          },
          select: { id: true, userId: true, parameters: true },
          take: 500,
        });
        jobs = all.filter((j) => {
          const p = (j.parameters as Record<string, unknown>) || {};
          return String(p.run_id || '') === runId;
        });
      }

      let cancelled = 0;
      for (const j of jobs) {
        try {
          const r = await cancelJob(j.id, j.userId, { force: true });
          if (r?.success) cancelled += 1;
        } catch (e) {
          console.warn('admin cancel', e);
        }
      }
      return NextResponse.json({ success: true, cancelled, total: jobs.length });
    }

    if (action === 'retry') {
      const jobId = String(body.jobId || '').trim();
      const runId = String(body.runId || '').trim();
      if (!jobId && !runId) {
        return NextResponse.json({ error: 'jobId or runId required' }, { status: 400 });
      }

      let jobIds: string[] = [];
      if (jobId) {
        jobIds = [jobId];
      } else {
        const failed = await prisma.generationJob.findMany({
          where: { status: { in: [JobStatus.FAILED, JobStatus.CANCELLED] } },
          select: { id: true, parameters: true },
          take: 500,
          orderBy: { updatedAt: 'desc' },
        });
        jobIds = failed
          .filter((j) => String(((j.parameters as any) || {}).run_id || '') === runId)
          .map((j) => j.id);
      }

      const results = [];
      for (const id of jobIds) {
        try {
          results.push({ id, ...(await retryJob(id)) });
        } catch (e: any) {
          results.push({ id, success: false, error: e?.message || String(e) });
        }
      }
      return NextResponse.json({ success: true, results, count: results.length });
    }

    if (action === 'retry_failed') {
      const limit = Math.min(50, Math.max(1, Number(body.limit) || 20));
      const failed = await prisma.generationJob.findMany({
        where: { status: JobStatus.FAILED },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        select: { id: true },
      });
      const results = [];
      for (const j of failed) {
        try {
          results.push({ id: j.id, ...(await retryJob(j.id)) });
        } catch (e: any) {
          results.push({ id: j.id, success: false, error: e?.message || String(e) });
        }
      }
      return NextResponse.json({
        success: true,
        results,
        count: results.length,
        message: `Retried ${results.filter((r) => r.success).length}/${results.length} failed jobs`,
      });
    }

    if (action === 'cancel_generating') {
      const active = await prisma.generationJob.findMany({
        where: {
          status: {
            in: [JobStatus.PREPARING, JobStatus.GENERATING, JobStatus.RETRYING, JobStatus.CHECKING_STATUS],
          },
        },
        select: { id: true, userId: true },
        take: 200,
      });
      let cancelled = 0;
      for (const j of active) {
        try {
          const r = await cancelJob(j.id, j.userId, { force: true, skipDispatch: true });
          if (r?.success) cancelled += 1;
        } catch {
          /* ignore */
        }
      }
      checkAndDispatchNextJobs().catch(console.error);
      return NextResponse.json({ success: true, cancelled, total: active.length });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Forbidden' },
      { status: error.message === 'FORBIDDEN' ? 403 : 500 }
    );
  }
}
