/**
 * Deeper UI checks: real login form, admin modals, accounts TOTP fields.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3100';
const OUT = path.join(process.env.TEMP || '/tmp', 'flow-smoke-deep.json');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const report = {};

  // Real login as admin
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle', timeout: 90000 });
    await page.fill('input[type="text"], input[autocomplete="username"]', 'admin');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/admin/, { timeout: 20000 });
    await page.waitForTimeout(1500);
    report.adminLogin = {
      ok: page.url().includes('/admin'),
      url: page.url(),
      title: await page.title(),
      pageErrors,
      bodyHasEndUsers: /END USERS/i.test(await page.locator('body').innerText()),
    };

    // Users modal
    await page.goto(`${BASE}/admin/users`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /Add user/i }).click();
    await page.waitForTimeout(500);
    report.usersModal = {
      visible: await page.locator('form, [role="dialog"]').filter({ hasText: /username|password/i }).count().then((n) => n > 0),
      hasUsername: await page.locator('text=/Username/i').count().then((n) => n > 0),
    };
    await page.keyboard.press('Escape');

    // Accounts modal + TOTP
    await page.goto(`${BASE}/admin/accounts`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const body = await page.locator('body').innerText();
    report.accountsPage = {
      hasTotpColumn: /TOTP/i.test(body),
      hasEmail: /Email|email/i.test(body),
    };
    const addBtn = page.getByRole('button', { name: /Add account|Add/i }).first();
    if (await addBtn.count()) {
      await addBtn.click();
      await page.waitForTimeout(500);
    }
    const modalText = await page.locator('body').innerText();
    report.accountsModal = {
      hasTotpSecret: /TOTP|Authenticator|secret/i.test(modalText),
      hasEmailField: /Email/i.test(modalText),
      hasPasswordField: /Password/i.test(modalText),
    };

    // Settings sections
    await page.goto(`${BASE}/admin/settings`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const settingsText = await page.locator('body').innerText();
    report.settings = {
      hasDownloadMgmt: /Download file management|Windows package|Android package/i.test(settingsText),
      hasBranding: /Site branding|WEBSITE NAME|Website name/i.test(settingsText),
      hasNotices: /Notice|Announcements/i.test(settingsText),
      title: await page.title(),
    };

    await context.close();
  }

  // Real login as user
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle', timeout: 90000 });
    await page.fill('input[type="text"], input[autocomplete="username"]', 'user1');
    await page.fill('input[type="password"]', 'pass123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/dashboard/, { timeout: 20000 });
    await page.waitForTimeout(1500);
    const body = await page.locator('body').innerText();
    const nav = await page.locator('nav').first().innerText().catch(() => '');
    report.userLogin = {
      ok: page.url().includes('/dashboard'),
      url: page.url(),
      title: await page.title(),
      hasPlan: /PLAN/i.test(body),
      hasDownload: /Download for Windows/i.test(body),
      hasAndroid: /Download for Android/i.test(body),
      hasStudioNav: /Studio|Library|Create|Characters/i.test(nav),
    };
    await context.close();
  }

  // Real login as reseller
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle', timeout: 90000 });
    await page.fill('input[type="text"], input[autocomplete="username"]', 'qa_reseller_tmp');
    await page.fill('input[type="password"]', 'qa_pass_123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/reseller/, { timeout: 20000 });
    await page.waitForTimeout(1500);
    const body = await page.locator('body').innerText();
    report.resellerLogin = {
      ok: page.url().includes('/reseller'),
      url: page.url(),
      title: await page.title(),
      hasUsersSection: /Your users/i.test(body),
      noForbidden: !/Forbidden|prisma/i.test(body),
    };
    await context.close();
  }

  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
