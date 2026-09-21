import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { OrderStatus, PaymentGateway } from '@prisma/client';

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const { searchParams } = new URL(req.url);
    const statusFilter = searchParams.get('status');

    const where: any = {};
    if (statusFilter && statusFilter !== 'ALL') {
      where.status = statusFilter as OrderStatus;
    }

    const [orders, allOrders] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              lastIp: true,
            },
          },
          plan: {
            select: {
              id: true,
              name: true,
              priceMonthly: true,
              standardCreditsCycle: true,
              proCreditsCycle: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.order.findMany({
        select: {
          id: true,
          amount: true,
          status: true,
          gateway: true,
          createdAt: true,
        },
      }),
    ]);

    // Calculate sales analytics
    let totalRevenue = 0;
    let pendingCount = 0;
    let completedCount = 0;
    let rejectedCount = 0;

    const gatewayStats: Record<string, { count: number; volume: number }> = {
      STRIPE: { count: 0, volume: 0 },
      MANUAL_BANK: { count: 0, volume: 0 },
      RESELLER: { count: 0, volume: 0 },
    };

    for (const o of allOrders) {
      if (o.status === OrderStatus.COMPLETED) {
        totalRevenue += o.amount;
        completedCount++;
      } else if (o.status === OrderStatus.PENDING_APPROVAL) {
        pendingCount++;
      } else if (o.status === OrderStatus.REJECTED) {
        rejectedCount++;
      }

      if (gatewayStats[o.gateway]) {
        gatewayStats[o.gateway].count++;
        if (o.status === OrderStatus.COMPLETED) {
          gatewayStats[o.gateway].volume += o.amount;
        }
      }
    }

    return NextResponse.json({
      success: true,
      orders,
      analytics: {
        totalRevenue,
        pendingCount,
        completedCount,
        rejectedCount,
        totalOrders: allOrders.length,
        gatewayStats,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Forbidden' },
      { status: 403 }
    );
  }
}
