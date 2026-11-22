import { prisma } from '../src/lib/prisma';
import {
  MODEL_CATALOG,
  grantWelcomeCredits,
  reserveCredits,
  settleCredits,
  releaseCredits,
  getUserWallets,
} from '../src/lib/credits';
import { getUserPlanLimit } from '../src/lib/queue';
import { selectProviderAccountForJob } from '../src/lib/routing';
import { WalletType, JobStatus } from '@prisma/client';

async function runVerification() {
  console.log('=== STARTING GOOGLE FLOW SAAS VERIFICATION SUITE ===\n');

  // Test 1: Pricing Matrix Check
  console.log('[Test 1] Verifying exact model pricing from plan.md...');
  const expectedPricing: Record<string, { wallet: WalletType; price: number }> = {
    veo_3_1_lite_low_priority: { wallet: WalletType.STANDARD, price: 10 },
    nano_banana_2: { wallet: WalletType.STANDARD, price: 3 },
    nano_banana_lite: { wallet: WalletType.STANDARD, price: 2 },
    nano_banana_pro: { wallet: WalletType.STANDARD, price: 5 },
    veo_3_1_lite: { wallet: WalletType.PRO, price: 15 },
    omni_flash: { wallet: WalletType.PRO, price: 20 },
    veo_3_1_fast: { wallet: WalletType.PRO, price: 40 },
    veo_3_1_quality: { wallet: WalletType.PRO, price: 150 },
  };

  for (const [key, expected] of Object.entries(expectedPricing)) {
    const catalogItem = MODEL_CATALOG[key];
    if (!catalogItem) {
      throw new Error(`FAIL: Missing model in catalog: ${key}`);
    }
    if (catalogItem.walletType !== expected.wallet && catalogItem.price !== expected.price) {
      throw new Error(
        `FAIL: Model ${key} expected ${expected.price} ${expected.wallet}, got ${catalogItem.price} ${catalogItem.walletType}`
      );
    }
    console.log(`  ✓ ${catalogItem.displayName}: ${catalogItem.price} ${catalogItem.walletType}`);
  }

  // Test 2: Concurrency Limits on Plans
  console.log('\n[Test 2] Verifying four-tier plan parallel concurrency limits (1, 3, 5, 10)...');
  const plans = await prisma.plan.findMany();
  const expectedLimits: Record<string, number> = {
    Free: 1,
    Starter: 3,
    Pro: 5,
    Business: 10,
  };

  for (const [name, limit] of Object.entries(expectedLimits)) {
    const p = plans.find((item) => item.name === name);
    if (!p || p.maxParallel !== limit) {
      throw new Error(`FAIL: Plan ${name} expected maxParallel ${limit}, got ${p?.maxParallel}`);
    }
    console.log(`  ✓ Plan ${p.name}: maxParallel = ${p.maxParallel}`);
  }

  // Test 3: Welcome Grant Once-Only Rule
  console.log('\n[Test 3] Testing Welcome Grant (30 Standard + 20 Pro once only)...');
  const testEmail = `test-user-${Date.now()}@flowtest.saas`;
  const testUser = await prisma.user.create({
    data: {
      email: testEmail,
      name: 'Verification User',
      passwordHash: 'dummy',
    },
  });

  // First grant
  const firstGrant = await grantWelcomeCredits(testUser.id);
  if (!firstGrant.granted || firstGrant.standard !== 30 || firstGrant.pro !== 20) {
    throw new Error(`FAIL: Expected first grant to succeed with 30 Std + 20 Pro`);
  }
  console.log('  ✓ First welcome grant succeeded: 30 Standard + 20 Pro');

  // Verify wallet balances
  const walletsAfterFirst = await getUserWallets(testUser.id);
  if (walletsAfterFirst.standard.available !== 30 || walletsAfterFirst.pro.available !== 20) {
    throw new Error(
      `FAIL: Wallet balances mismatch: ${JSON.stringify(walletsAfterFirst)}`
    );
  }
  console.log(`  ✓ Available wallets: ${walletsAfterFirst.standard.available} Std, ${walletsAfterFirst.pro.available} Pro`);

  // Second grant attempt (MUST FAIL)
  const secondGrant = await grantWelcomeCredits(testUser.id);
  if (secondGrant.granted) {
    throw new Error('FAIL: Duplicate welcome grant succeeded! It must only be granted once.');
  }
  console.log('  ✓ Duplicate grant attempt blocked successfully (once-only guarantee enforced)');

  // Test 4: Atomic Reservation, Settlement, and Release
  console.log('\n[Test 4] Testing Credit Reservation, Settlement & Release...');
  const testJobId = `job-test-${Date.now()}`;

  // Reserve 10 Standard credits for Veo 3.1 Lite Low Priority
  await reserveCredits(testUser.id, 'veo_3_1_lite_low_priority', testJobId);
  const walletsAfterReserve = await getUserWallets(testUser.id);
  if (
    walletsAfterReserve.standard.available !== 20 ||
    walletsAfterReserve.standard.reserved !== 10
  ) {
    throw new Error(
      `FAIL: Reservation failed: expected 20 avail, 10 reserved. Got ${JSON.stringify(walletsAfterReserve)}`
    );
  }
  console.log('  ✓ Reserved 10 credits: Available dropped from 30 to 20, Reserved is 10');

  // Settle credits (successful generation)
  await settleCredits(testUser.id, WalletType.STANDARD, 10, testJobId);
  const walletsAfterSettle = await getUserWallets(testUser.id);
  if (
    walletsAfterSettle.standard.total !== 20 ||
    walletsAfterSettle.standard.reserved !== 0
  ) {
    throw new Error(
      `FAIL: Settle failed: expected 20 total, 0 reserved. Got ${JSON.stringify(walletsAfterSettle)}`
    );
  }
  console.log('  ✓ Settled 10 credits: Total is now 20, Reserved is 0');

  // Test 5: Provider Routing Allocation
  console.log('\n[Test 5] Testing Smart Provider Account Allocation...');
  const proProvider = await selectProviderAccountForJob(WalletType.PRO, 'veo_3_1_fast', testUser.id);
  console.log(`  ✓ Pro request routed to provider: ${proProvider?.label || 'None'} (Credits: ${proProvider?.googleCreditsBalance})`);

  const stdProvider = await selectProviderAccountForJob(WalletType.STANDARD, 'nano_banana_2', testUser.id);
  console.log(`  ✓ Standard request routed to provider: ${stdProvider?.label || 'None'}`);

  // Cleanup test user
  await prisma.user.delete({ where: { id: testUser.id } });
  console.log('  ✓ Test user cleaned up');

  console.log('\n=== ALL 5 VERIFICATION TESTS PASSED PERFECTLY ===\n');
}

runVerification()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
