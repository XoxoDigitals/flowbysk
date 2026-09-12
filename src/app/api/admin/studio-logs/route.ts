import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { StudioLogLevel, Prisma } from '@prisma/client';
import { groupStudioLogsIntoRuns } from '@/lib/studioLogs';

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const { searchParams } = new URL(req.url);
    const level = searchParams.get('level');
    const source = searchParams.get('source');
    const user = searchParams.get('user');
    const userId = searchParams.get('userId');
    const q = searchParams.get('q');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const group = searchParams.get('group') !== '0';
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '300', 10) || 300, 1), 800);

    const where: Prisma.StudioLogWhereInput = {};
    if (level && level !== 'ALL') {
      where.level = level.toUpperCase() as StudioLogLevel;
    }
    if (source && source.trim() && source !== 'ALL') {
      where.source = { equals: source.trim(), mode: 'insensitive' };
    }
    if (userId && userId.trim()) {
      const uid = userId.trim();
      const u = await prisma.user.findUnique({
        where: { id: uid },
        select: { email: true },
      });
      where.OR = [
        { userId: uid },
        ...(u?.email
          ? [
              { userEmail: { equals: u.email, mode: 'insensitive' as const } },
              { flowEmail: { equals: u.email, mode: 'insensitive' as const } },
            ]
          : []),
      ];
    } else if (user && user.trim()) {
      const term = user.trim();
      where.OR = [
        { userId: term },
        { userEmail: { contains: term, mode: 'insensitive' } },
        { flowEmail: { contains: term, mode: 'insensitive' } },
      ];
    }
    if (q && q.trim()) {
      const term = q.trim();
      const messageFilter: Prisma.StudioLogWhereInput = {
        message: { contains: term, mode: 'insensitive' },
      };
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        messageFilter,
      ];
    }

    const createdAt: Prisma.DateTimeFilter = {};
    if (from) {
      const d = new Date(from);
      if (!Number.isNaN(d.getTime())) createdAt.gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (!Number.isNaN(d.getTime())) createdAt.lte = d;
    }
    if (createdAt.gte || createdAt.lte) {
      where.createdAt = createdAt;
    }

    const [logs, total, sources] = await Promise.all([
      prisma.studioLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          user: { select: { id: true, email: true, name: true } },
        },
      }),
      prisma.studioLog.count({ where }),
      prisma.studioLog.findMany({
        distinct: ['source'],
        select: { source: true },
        orderBy: { source: 'asc' },
        take: 50,
      }),
    ]);

    const runs = group ? groupStudioLogsIntoRuns(logs) : [];

    return NextResponse.json({
      success: true,
      logs,
      runs,
      grouped: group,
      total,
      runCount: runs.length,
      sources: sources.map((s) => s.source).filter(Boolean),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Forbidden' },
      { status: 403 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    await requireAdmin(req);
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const where: Prisma.StudioLogWhereInput = {};
    if (userId) where.userId = userId;

    const result = await prisma.studioLog.deleteMany({ where });
    return NextResponse.json({ success: true, cleared: result.count });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Forbidden' },
      { status: 403 }
    );
  }
}
