import { PrismaClient, UserRole, UserStatus, WalletType, LedgerType, ProviderStatus, CreditClassification } from '@prisma/client';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Starting Database Seeding ---');

  // 1. Seed Plans
  const plans = [
    {
      name: 'Free',
      maxParallel: 1,
      priceMonthly: 0,
      standardCreditsCycle: 0,
      proCreditsCycle: 0,
      description: 'Ideal for trying out Google Flow generation. 50 one-time credits grant.',
      features: [
        '50 welcome credits (once)',
        'Veo & image models',
        'Community support',
      ],
    },
    {
      name: 'Starter',
      maxParallel: 3,
      priceMonthly: 29,
      standardCreditsCycle: 500,
      proCreditsCycle: 150,
      description: 'Up to 3 parallel generations. Great for solo creators and hobbyists.',
      features: [
        'Omni Flash & Whisk',
        'Unlimited history',
        'Email support',
      ],
    },
    {
      name: 'Pro',
      maxParallel: 5,
      priceMonthly: 79,
      standardCreditsCycle: 1500,
      proCreditsCycle: 500,
      description: 'High-speed parallel workflow with 5 concurrent slots for power users.',
      features: [
        'Everything in Starter',
        'Priority generation lane',
        'Commercial licence',
      ],
    },
    {
      name: 'Business',
      maxParallel: 10,
      priceMonthly: 199,
      standardCreditsCycle: 5000,
      proCreditsCycle: 2000,
      description: 'Enterprise grade 10 concurrent generation slots with priority queue.',
      features: [
        'Everything in Pro',
        'Dedicated account manager',
        'Highest concurrency',
      ],
    },
  ];

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { name: plan.name },
      update: plan,
      create: plan,
    });
  }
  console.log('✓ Seeded 4 subscription plans (Free: 1, Starter: 3, Pro: 5, Business: 10 parallel slots)');

  // 2. Seed Admin User
  const adminPasswordHash = await bcrypt.hash('Admin@123456', 10);
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@googleflow.saas' },
    update: {
      role: UserRole.ADMIN,
      passwordHash: adminPasswordHash,
    },
    create: {
      email: 'admin@googleflow.saas',
      name: 'Super Admin',
      passwordHash: adminPasswordHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    },
  });
  console.log('✓ Seeded Super Admin: admin@googleflow.saas / Admin@123456');

  // 3. Seed Demo Customer User
  const demoPasswordHash = await bcrypt.hash('Demo@123456', 10);
  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@googleflow.saas' },
    update: {
      passwordHash: demoPasswordHash,
    },
    create: {
      email: 'demo@googleflow.saas',
      name: 'Demo Creator',
      passwordHash: demoPasswordHash,
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
    },
  });

  // Assign Free Plan to Demo User
  const freePlan = await prisma.plan.findUnique({ where: { name: 'Free' } });
  if (freePlan) {
    const existingSub = await prisma.subscription.findFirst({
      where: { userId: demoUser.id },
    });
    if (!existingSub) {
      await prisma.subscription.create({
        data: {
          userId: demoUser.id,
          planId: freePlan.id,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
    }
  }

  // Grant One-Time Free Welcome Credits (30 Standard + 20 Pro)
  const existingGrant = await prisma.welcomeGrant.findUnique({
    where: { userId: demoUser.id },
  });

  if (!existingGrant) {
    await prisma.welcomeGrant.create({
      data: {
        userId: demoUser.id,
        standardAmount: 30,
        proAmount: 20,
      },
    });

    // Create or update Standard wallet
    await prisma.wallet.upsert({
      where: { userId_walletType: { userId: demoUser.id, walletType: WalletType.STANDARD } },
      update: { balance: { increment: 30 } },
      create: { userId: demoUser.id, walletType: WalletType.STANDARD, balance: 30 },
    });

    await prisma.creditLedger.create({
      data: {
        userId: demoUser.id,
        walletType: WalletType.STANDARD,
        amount: 30,
        balanceAfter: 30,
        type: LedgerType.GRANT,
        reason: 'One-time Free Welcome Grant (Standard)',
      },
    });

    // Create or update Pro wallet
    await prisma.wallet.upsert({
      where: { userId_walletType: { userId: demoUser.id, walletType: WalletType.PRO } },
      update: { balance: { increment: 20 } },
      create: { userId: demoUser.id, walletType: WalletType.PRO, balance: 20 },
    });

    await prisma.creditLedger.create({
      data: {
        userId: demoUser.id,
        walletType: WalletType.PRO,
        amount: 20,
        balanceAfter: 20,
        type: LedgerType.GRANT,
        reason: 'One-time Free Welcome Grant (Pro)',
      },
    });

    console.log('✓ Granted 50 Welcome Credits to Demo User (30 Standard + 20 Pro)');
  }

  // 4. Seed Default Provider Account from data/settings.json
  try {
    const settingsPath = path.resolve(__dirname, '../data/settings.json');
    if (fs.existsSync(settingsPath)) {
      const rawSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const cookies = rawSettings.cookies || '';
      const email = rawSettings.user_email || 'primary@google.com';

      const existingProvider = await prisma.providerAccount.findFirst({
        where: { accountEmail: email },
      });

      if (!existingProvider) {
        await prisma.providerAccount.create({
          data: {
            label: 'Primary Google Flow Account',
            accountEmail: email,
            cookies: cookies,
            status: ProviderStatus.HEALTHY,
            creditClassification: CreditClassification.CREDITS_AVAILABLE,
            googleCreditsBalance: 100.0,
            googleCreditsReserved: 0.0,
            maxParallelLimit: 5,
            supportedModels: [
              'veo_3_1_lite_low_priority',
              'nano_banana_2',
              'nano_banana_lite',
              'nano_banana_pro',
              'veo_3_1_lite',
              'omni_flash',
              'veo_3_1_fast',
              'veo_3_1_quality',
            ],
            lastHealthCheck: new Date(),
          },
        });
        console.log(`✓ Seeded Provider Account from settings.json: ${email}`);
      }
    }
  } catch (err) {
    console.warn('Notice while reading data/settings.json:', err);
  }

  // 5. Create default project for Demo user
  const existingProject = await prisma.project.findFirst({
    where: { userId: demoUser.id },
  });
  if (!existingProject) {
    await prisma.project.create({
      data: {
        userId: demoUser.id,
        name: 'My First Studio Project',
        description: 'Default generative workspace for Veo 3.1 and Imagen 4',
      },
    });
    console.log('✓ Created initial project for demo creator');
  }

  console.log('--- Database Seeding Completed Successfully ---');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
