import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { OrderStatus } from '@prisma/client';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin(req);
    const { id } = await params;
    const body = await req.json();
    const { action, adminNotes } = body;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        plan: true,
        user: true,
      },
    });

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    if (action === 'APPROVE') {
      // 1. Mark order COMPLETED
      const updatedOrder = await prisma.order.update({
        where: { id },
        data: {
          status: OrderStatus.COMPLETED,
          adminNotes: adminNotes || 'Approved by admin',
        },
      });

      // 2. Activate user subscription
      const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const existingSub = await prisma.subscription.findFirst({
        where: { userId: order.userId },
      });

      if (existingSub) {
        await prisma.subscription.update({
          where: { id: existingSub.id },
          data: {
            planId: order.planId,
            status: 'ACTIVE',
            currentPeriodStart: new Date(),
            currentPeriodEnd: periodEnd,
          },
        });
      } else {
        await prisma.subscription.create({
          data: {
            userId: order.userId,
            planId: order.planId,
            status: 'ACTIVE',
            currentPeriodStart: new Date(),
            currentPeriodEnd: periodEnd,
          },
        });
      }

      // 3. Grant Plan Credits
      if (order.plan.standardCreditsCycle > 0) {
        const stdWallet = await prisma.wallet.findUnique({
          where: { userId_walletType: { userId: order.userId, walletType: 'STANDARD' } },
        });
        if (stdWallet) {
          const newBal = stdWallet.balance + order.plan.standardCreditsCycle;
          await prisma.wallet.update({
            where: { id: stdWallet.id },
            data: { balance: newBal },
          });
          await prisma.creditLedger.create({
            data: {
              userId: order.userId,
              walletType: 'STANDARD',
              type: 'GRANT',
              amount: order.plan.standardCreditsCycle,
              balanceAfter: newBal,
              reason: `Approved bank payment for ${order.plan.name} plan`,
            },
          });
        }
      }

      if (order.plan.proCreditsCycle > 0) {
        const proWallet = await prisma.wallet.findUnique({
          where: { userId_walletType: { userId: order.userId, walletType: 'PRO' } },
        });
        if (proWallet) {
          const newBal = proWallet.balance + order.plan.proCreditsCycle;
          await prisma.wallet.update({
            where: { id: proWallet.id },
            data: { balance: newBal },
          });
          await prisma.creditLedger.create({
            data: {
              userId: order.userId,
              walletType: 'PRO',
              type: 'GRANT',
              amount: order.plan.proCreditsCycle,
              balanceAfter: newBal,
              reason: `Approved bank payment for ${order.plan.name} plan`,
            },
          });
        }
      }

      // 4. Audit & System logs
      await prisma.adminAuditLog.create({
        data: {
          adminId: admin.userId,
          action: 'ORDER_APPROVED',
          targetType: 'ORDER',
          targetId: id,
          details: {
            amount: order.amount,
            plan: order.plan.name,
            customer: order.user.email,
          },
        },
      });

      await prisma.systemLog.create({
        data: {
          category: 'BILLING',
          level: 'INFO',
          message: `Order #${order.id} approved: ${order.plan.name} activated for ${order.user.email}`,
          userId: order.userId,
          details: { orderId: id, amount: order.amount },
        },
      });

      return NextResponse.json({
        success: true,
        message: 'Order approved, subscription activated, and credits deposited successfully!',
        order: updatedOrder,
      });
    } else if (action === 'REJECT') {
      const updatedOrder = await prisma.order.update({
        where: { id },
        data: {
          status: OrderStatus.REJECTED,
          adminNotes: adminNotes || 'Rejected by administrator',
        },
      });

      await prisma.adminAuditLog.create({
        data: {
          adminId: admin.userId,
          action: 'ORDER_REJECTED',
          targetType: 'ORDER',
          targetId: id,
          details: { reason: adminNotes },
        },
      });

      await prisma.systemLog.create({
        data: {
          category: 'BILLING',
          level: 'WARN',
          message: `Order #${order.id} rejected for ${order.user.email}: ${adminNotes || 'No notes provided'}`,
          userId: order.userId,
          details: { orderId: id },
        },
      });

      return NextResponse.json({
        success: true,
        message: 'Order rejected.',
        order: updatedOrder,
      });
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Operation failed' },
      { status: 400 }
    );
  }
}
