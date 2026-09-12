import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getModelPricing, reserveCredits, resolveModelPricing } from '@/lib/credits';
import { getUserPlanLimit, countUserActiveJobs, dispatchJob } from '@/lib/queue';
import { JobStatus } from '@prisma/client';
import { isCompletedMediaExpired, resolveMediaExpiresAt } from '@/lib/mediaExpiry';

export async function GET(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    const allProjects = searchParams.get('all') === '1' || searchParams.get('scope') === 'user';
    const forAnalytics = searchParams.get('analytics') === '1';

    const whereClause: any = {
      userId: session.userId,
    };

    if (projectId) {
      whereClause.projectId = projectId;
    } else if (!allProjects) {
      const activeProj = await prisma.project.findFirst({
        where: { userId: session.userId, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      });
      if (!activeProj) {
        return NextResponse.json({ success: true, jobs: [] });
      }
      whereClause.projectId = activeProj.id;
    }

    const jobs = await prisma.generationJob.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: forAnalytics ? 500 : allProjects || !projectId ? 100 : 50,
      select: {
        id: true,
        projectId: true,
        modelKey: true,
        walletType: true,
        creditCost: true,
        status: true,
        progress: true,
        prompt: true,
        parameters: true,
        outputMediaUrl: true,
        errorMessage: true,
        submittedAt: true,
        startedAt: true,
        completedAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    // Gallery/library: hide completed shells with no media. Analytics: keep all jobs.
    const now = new Date();
    const mapped = jobs
      .filter((job) => {
        if (forAnalytics) return true;
        if (job.status !== JobStatus.COMPLETED) return true;
        if (!(job.outputMediaUrl || '').trim()) return false;
        if (isCompletedMediaExpired(job.outputMediaUrl, job.expiresAt, now)) return false;
        return true;
      })
      .map((job) => {
        const resolved = resolveMediaExpiresAt(job.outputMediaUrl, job.expiresAt);
        return {
          ...job,
          expiresAt: resolved ? resolved.toISOString() : job.expiresAt,
        };
      });

    return NextResponse.json({ success: true, jobs: mapped });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Unauthorized' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const body = await req.json();
    const {
      projectId,
      modelKey,
      prompt,
      parameters,
      inputAssetIds,
      characterIds,
    } = body;

    if (!projectId || !modelKey || !prompt) {
      return NextResponse.json(
        { error: 'projectId, modelKey, and prompt are required' },
        { status: 400 }
      );
    }

    // 1. Validate model in catalog
    const pricing = await resolveModelPricing(modelKey);
    if (!pricing) {
      return NextResponse.json(
        { error: `Invalid or unsupported model key: ${modelKey}` },
        { status: 400 }
      );
    }

    // 2. Validate user owns project
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: session.userId },
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24-hour expiry

    // 3. Create job record in IN_QUEUE status initially
    const job = await prisma.generationJob.create({
      data: {
        userId: session.userId,
        projectId,
        modelKey,
        walletType: pricing.walletType,
        creditCost: pricing.price,
        status: JobStatus.IN_QUEUE,
        progress: 0,
        prompt: prompt.trim(),
        parameters: parameters || {},
        inputAssetIds: inputAssetIds || [],
        characterIds: characterIds || [],
        expiresAt,
      },
    });

    // 4. Reserve credits atomically
    try {
      await reserveCredits(session.userId, modelKey, job.id);
    } catch (creditErr: any) {
      // Clean up unreserved job record
      await prisma.generationJob.delete({ where: { id: job.id } });
      return NextResponse.json(
        { error: creditErr.message || 'Insufficient credits' },
        { status: 402 }
      );
    }

    // 5. Check user's concurrency capacity
    const limit = await getUserPlanLimit(session.userId);
    const active = await countUserActiveJobs(session.userId);

    let immediateDispatch = false;
    if (active < limit) {
      immediateDispatch = true;
      // Start dispatching in background
      dispatchJob(job.id).catch((err) => {
        console.error(`Dispatch error for job ${job.id}:`, err);
      });
    } else {
      // Set status message
      await prisma.generationJob.update({
        where: { id: job.id },
        data: {
          errorMessage: `In Queue: Max parallel generation limit (${limit}) reached for your plan. Will start automatically when an active slot frees up.`,
        },
      });
    }

    return NextResponse.json({
      success: true,
      job: {
        id: job.id,
        projectId: job.projectId,
        modelKey: job.modelKey,
        walletType: job.walletType,
        creditCost: job.creditCost,
        status: immediateDispatch ? JobStatus.PREPARING : JobStatus.IN_QUEUE,
        progress: job.progress,
        prompt: job.prompt,
        parameters: job.parameters,
        submittedAt: job.submittedAt,
        expiresAt: job.expiresAt,
      },
      immediateDispatch,
      message: immediateDispatch
        ? 'Generation started!'
        : `Job queued. Your current plan allows ${limit} concurrent generation(s).`,
    });
  } catch (error: any) {
    console.error('Generations POST error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
