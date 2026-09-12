import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { PaymentGateway, OrderStatus } from '@prisma/client';
import { getBillingGatewaySettings, isGatewayEnabled } from '@/lib/billing-settings';

export async function GET(req: Request) {
  try {
    const auth = await requireAuth(req);

    const orders = await prisma.order.findMany({
      where: { userId: auth.userId },
      include: {
        plan: {
          select: {
            id: true,
            name: true,
            priceMonthly: true,
            standardCreditsCycle: true,
            proCreditsCycle: true,
            maxParallel: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ success: true, orders });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Unauthorized' },
      { status: 401 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireAuth(req);
    const body = await req.json();
    const { planId, gateway, bankReference, proofImageUrl } = body;

    if (!planId) {
      return NextResponse.json({ error: 'Plan ID is required' }, { status: 400 });
    }

    const plan = await prisma.plan.findUnique({
      where: { id: planId },
    });

    if (!plan) {
      return NextResponse.json({ error: 'Selected plan not found' }, { status: 404 });
    }

    let selectedGateway: PaymentGateway = PaymentGateway.MANUAL_BANK;
    if (gateway === 'STRIPE') selectedGateway = PaymentGateway.STRIPE;
    else if (gateway === 'RESELLER') selectedGateway = PaymentGateway.RESELLER;

    const gatewaySettings = await getBillingGatewaySettings();
    if (!isGatewayEnabled(gatewaySettings, selectedGateway)) {
      return NextResponse.json(
        { error: 'This payment gateway is currently disabled' },
        { status: 400 }
      );
    }

    // Status determination
    // Stripe test can be completed immediately or pending, Manual Bank & Reseller are pending approval
    const initialStatus =
      selectedGateway === PaymentGateway.STRIPE
        ? OrderStatus.COMPLETED
        : OrderStatus.PENDING_APPROVAL;

    const order = await prisma.order.create({
      data: {
        userId: auth.userId,
        planId: plan.id,
        gateway: selectedGateway,
        status: initialStatus,
        amount: plan.priceMonthly,
        currency: 'USD',
        bankReference: bankReference || null,
        proofImageUrl: proofImageUrl || null,
      },
      include: { plan: true },
    });

    // If completed immediately (e.g. Stripe mock/webhook)
    if (initialStatus === OrderStatus.COMPLETED) {
      // 1. Activate or upgrade subscription
      const existingSub = await prisma.subscription.findFirst({
        where: { userId: auth.userId, status: 'ACTIVE' },
      });

      const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      if (existingSub) {
        await prisma.subscription.update({
          where: { id: existingSub.id },
          data: {
            planId: plan.id,
            currentPeriodEnd: periodEnd,
          },
        });
      } else {
        await prisma.subscription.create({
          data: {
            userId: auth.userId,
            planId: plan.id,
            currentPeriodStart: new Date(),
            currentPeriodEnd: periodEnd,
          },
        });
      }

      // 2. Grant plan credits to user's wallets
      if (plan.standardCreditsCycle > 0) {
        const stdWallet = await prisma.wallet.findUnique({
          where: { userId_walletType: { userId: auth.userId, walletType: 'STANDARD' } },
        });
        if (stdWallet) {
          const newBal = stdWallet.balance + plan.standardCreditsCycle;
          await prisma.wallet.update({
            where: { id: stdWallet.id },
            data: { balance: newBal },
          });
          await prisma.creditLedger.create({
            data: {
              userId: auth.userId,
              walletType: 'STANDARD',
              type: 'GRANT',
              amount: plan.standardCreditsCycle,
              balanceAfter: newBal,
              reason: `Stripe purchase of ${plan.name} plan`,
            },
          });
        }
      }

      if (plan.proCreditsCycle > 0) {
        const proWallet = await prisma.wallet.findUnique({
          where: { userId_walletType: { userId: auth.userId, walletType: 'PRO' } },
        });
        if (proWallet) {
          const newBal = proWallet.balance + plan.proCreditsCycle;
          await prisma.wallet.update({
            where: { id: proWallet.id },
            data: { balance: newBal },
          });
          await prisma.creditLedger.create({
            data: {
              userId: auth.userId,
              walletType: 'PRO',
              type: 'GRANT',
              amount: plan.proCreditsCycle,
              balanceAfter: newBal,
              reason: `Stripe purchase of ${plan.name} plan`,
            },
          });
        }
      }

      // System Log
      await prisma.systemLog.create({
        data: {
          category: 'BILLING',
          level: 'INFO',
          message: `Stripe checkout completed for ${plan.name} ($${plan.priceMonthly})`,
          userId: auth.userId,
          details: { orderId: order.id, planId: plan.id },
        },
      });
    } else {
      // Pending order log
      await prisma.systemLog.create({
        data: {
          category: 'BILLING',
          level: 'INFO',
          message: `New ${selectedGateway} order placed: $${plan.priceMonthly} (${plan.name}), awaiting admin approval`,
          userId: auth.userId,
          details: { orderId: order.id, bankReference, hasProof: !!proofImageUrl },
        },
      });
    }

    return NextResponse.json({
      success: true,
      message:
        initialStatus === OrderStatus.COMPLETED
          ? 'Payment processed and plan activated!'
          : 'Order submitted! Awaiting administrator verification.',
      order,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to create order' },
      { status: 400 }
    );
  }
}
