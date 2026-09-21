import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { LogCategory, LogLevel } from '@prisma/client';

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');
    const level = searchParams.get('level');
    const query = searchParams.get('q');

    const where: any = {};
    if (category && category !== 'ALL') {
      where.category = category as LogCategory;
    }
    if (level && level !== 'ALL') {
      where.level = level as LogLevel;
    }
    if (query && query.trim()) {
      where.message = { contains: query.trim(), mode: 'insensitive' };
    }

    const [logs, stats] = await Promise.all([
      prisma.systemLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.systemLog.groupBy({
        by: ['category', 'level'],
        _count: true,
      }),
    ]);

    // Aggregate category counts
    const categoryCounts: Record<string, number> = {};
    let securityAlertsCount = 0;
    let criticalCount = 0;

    for (const s of stats) {
      categoryCounts[s.category] = (categoryCounts[s.category] || 0) + s._count;
      if (s.category === 'SECURITY_ALERT') {
        securityAlertsCount += s._count;
      }
      if (s.level === 'CRITICAL') {
        criticalCount += s._count;
      }
    }

    return NextResponse.json({
      success: true,
      logs,
      summary: {
        total: logs.length,
        securityAlertsCount,
        criticalCount,
        categoryCounts,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Forbidden' },
      { status: 403 }
    );
  }
}
