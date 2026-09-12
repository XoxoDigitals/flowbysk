import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { JobStatus } from '@prisma/client';
import { dispatchJob, handleJobFailure, retryJob } from '@/lib/queue';
import {
  parseAnalyticsRange,
  parseJobStatusFilter,
  rangeToDateBounds,
} from '@/lib/analytics-range';

export async function GET(req: Request) {
  try {
    await requireAdmin(req);

    const { searchParams } = new URL(req.url);
    const range = parseAnalyticsRange(searchParams.get('range'));
    const statusFilter = parseJobStatusFilter(searchParams.get('status'));
    const { start, end } = rangeToDateBounds(range);

    const where: any = {
      createdAt: { gte: start, lt: end },
    };

    if (statusFilter === 'IN_QUEUE') {
      where.status = JobStatus.IN_QUEUE;
    } else if (statusFilter === 'ACTIVE') {
      where.status = {
        in: [
          JobStatus.PREPARING,
          JobStatus.GENERATING,
          JobStatus.RETRYING,
          JobStatus.CHECKING_STATUS,
        ],
      };
    } else if (statusFilter === 'COMPLETED') {
      where.status = JobStatus.COMPLETED;
    } else if (statusFilter === 'FAILED') {
      where.status = { in: [JobStatus.FAILED, JobStatus.CANCELLED] };
    }

    const jobs = await prisma.generationJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        user: { select: { email: true, name: true } },
        project: { select: { name: true } },
        providerAccount: { select: { label: true } },
      },
    });

    return NextResponse.json({
      success: true,
      range,
      status: statusFilter,
      from: start.toISOString(),
      to: end.toISOString(),
      jobs,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Forbidden' },
      { status: error.message === 'FORBIDDEN' ? 403 : 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const body = await req.json();
    const { action, jobId } = body;

    if (action === 'retry' && jobId) {
      const result = await retryJob(jobId);
      return NextResponse.json({ success: true, message: result.message || 'Job retry initiated' });
    }

    if (action === 'fail_and_refund' && jobId) {
      await handleJobFailure(jobId, 'Terminated and refunded by Administrator');
      return NextResponse.json({ success: true, message: 'Job failed and reservation released' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Operation failed' },
      { status: 400 }
    );
  }
}
