/**
 * Role-by-role dashboard smoke test with console + network error capture.
 * Run: node scripts/smoke-roles.mjs
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3100';
const API = 'http://localhost:3000';
const OUT = path.join(process.env.TEMP || '/tmp', 'flow-smoke-roles.json');

const IGNORE_CONSOLE = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /multiple modules with names that only differ in casing/i,
  /hydrat/i, // collect separately but don't fail alone if cascade
];

async function loginApi(username, password) {
  const res = await fetch(`${API}/api/session/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(`login ${username}: ${data.error || res.status}`);
  return data;
}

async function visitPage(page, url, { clickSelectors = [] } = {}) {
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];

  const onConsole = (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORE_CONSOLE.some((re) => re.test(text))) return;
    consoleErrors.push(text.slice(0, 400));
  };
  const onPageError = (err) => pageErrors.push(String(err).slice(0, 400));
  const onRequestFailed = (req) => {
    const u = req.url();
    if (u.includes('_next/static') || u.includes('favicon')) return;
    failedRequests.push({ url: u, error: req.failure()?.errorText || 'failed' });
  };
  const onResponse = (res) => {
    const u = res.url();
    const status = res.status();
    if (status < 400) return;
    if (!u.includes('/api/') && !u.startsWith(BASE) && !u.startsWith(API)) return;
    if (u.includes('_next/static') || u.includes('favicon')) return;
    // Next.js RSC payloads for blocked old admin pages may 404 — still record
    failedRequests.push({ url: u, status });
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);

  let status = 'ok';
  let notes = [];
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (resp && resp.status() >= 400) {
      status = 'error';
      notes.push(`HTTP ${resp.status()}`);
    }
    await page.waitForTimeout(1800);

    // Detect Next error overlay / stuck verify / obvious error text
    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (/Application error|Unhandled Runtime Error|This page could not be found/i.test(bodyText)) {
      status = 'error';
      notes.push('error overlay or not found');
    }
    if (/Verifying Flow Browser admin/i.test(bodyText) && bodyText.trim().length < 80) {
      status = 'error';
      notes.push('stuck on admin verify');
    }

    for (const sel of clickSelectors) {
      const el = page.locator(sel).first();
      if (await el.count()) {
        await el.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(600);
      }
    }

    // Close any modal with Escape
    await page.keyboard.press('Escape').catch(() => {});
  } catch (e) {
    status = 'error';
    notes.push(String(e.message || e).slice(0, 200));
  }

  page.off('console', onConsole);
  page.off('pageerror', onPageError);
  page.off('requestfailed', onRequestFailed);
  page.off('response', onResponse);

  // Filter noisy failed requests: CORS preflight noise, etc.
  const badApi = failedRequests.filter((f) => {
    const u = f.url || '';
    if (f.status && f.status < 500 && !u.includes('/api/')) {
      // page-level 404 for intentional redirects is ok sometimes
      return f.status >= 500;
    }
    return true;
  });

  if (pageErrors.length || consoleErrors.length || badApi.some((f) => (f.status || 500) >= 500)) {
    if (status === 'ok') status = 'warn';
  }
  if (pageErrors.length || badApi.some((f) => (f.status || 0) >= 500 && String(f.url).includes('/api/'))) {
    status = 'error';
  }

  return {
    url,
    status,
    notes,
    consoleErrors: [...new Set(consoleErrors)].slice(0, 8),
    pageErrors: [...new Set(pageErrors)].slice(0, 8),
    failedRequests: badApi.slice(0, 15),
    finalUrl: page.url(),
    title: await page.title().catch(() => ''),
    bodySnippet: (await page.locator('body').innerText().catch(() => '')).slice(0, 280),
  };
}

async function withSession(context, session) {
  await context.addInitScript((s) => {
    localStorage.setItem('flowbro_session', JSON.stringify(s));
    document.cookie = 'saas_token=; Path=/; Max-Age=0; SameSite=Lax';
  }, session);
}

async function main() {
  const results = { startedAt: new Date().toISOString(), roles: {} };

  const adminLogin = await loginApi('admin', 'admin123');
  const userLogin = await loginApi('user1', 'pass123');
  let resellerLogin;
  try {
    resellerLogin = await loginApi('qa_reseller_tmp', 'qa_pass_123');
  } catch {
    // create if missing
    const adminTok = adminLogin.token;
    await fetch(`${API}/api/admin/resellers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminTok}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: 'qa_reseller_tmp', password: 'qa_pass_123' }),
    });
    resellerLogin = await loginApi('qa_reseller_tmp', 'qa_pass_123');
  }

  const browser = await chromium.launch({ headless: true });

  // LOGIN PAGE (no session)
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    results.roles.login = [];
    results.roles.login.push(await visitPage(page, `${BASE}/auth/login`));
    await context.close();
  }

  // ADMIN
  {
    const context = await browser.newContext();
    await withSession(context, {
      token: adminLogin.token,
      role: 'admin',
      username: adminLogin.user?.username || 'admin',
    });
    const page = await context.newPage();
    const pages = [
      { url: `${BASE}/admin`, clicks: [] },
      { url: `${BASE}/admin/users`, clicks: ['button:has-text("Add")', 'button:has-text("Add user")'] },
      { url: `${BASE}/admin/accounts`, clicks: ['button:has-text("Add")', 'button:has-text("Add account")'] },
      { url: `${BASE}/admin/resellers`, clicks: [] },
      { url: `${BASE}/admin/system-users`, clicks: [] },
      { url: `${BASE}/admin/plans`, clicks: [] },
      { url: `${BASE}/admin/logs`, clicks: [] },
      { url: `${BASE}/admin/settings`, clicks: [] },
    ];
    results.roles.admin = [];
    for (const p of pages) {
      results.roles.admin.push(await visitPage(page, p.url, { clickSelectors: p.clicks }));
    }

    // Confirm nav does not include old items
    await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const navText = await page.locator('nav').first().innerText().catch(() => '');
    results.roles.adminNav = {
      text: navText.slice(0, 500),
      hasOrders: /Orders/i.test(navText),
      hasJobs: /Jobs/i.test(navText),
      hasStripe: /Stripe/i.test(navText),
      hasFlowbysk: /Flowbysk/i.test(navText),
    };

    // Metrics check
    const metricsBody = await page.locator('body').innerText();
    results.roles.adminMetricsHint = {
      hasEndUsers: /END USERS/i.test(metricsBody),
      hasGoogleAccounts: /GOOGLE ACCOUNTS/i.test(metricsBody),
      hasTotp: /TOTP/i.test(metricsBody),
    };

    await context.close();
  }

  // USER
  {
    const context = await browser.newContext();
    await withSession(context, {
      token: userLogin.token,
      role: 'user',
      username: userLogin.user?.username || 'user1',
    });
    const page = await context.newPage();
    results.roles.user = [];
    for (const url of [
      `${BASE}/dashboard`,
      `${BASE}/dashboard/billing`,
      `${BASE}/dashboard/settings`,
    ]) {
      results.roles.user.push(await visitPage(page, url));
    }
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const body = await page.locator('body').innerText();
    const nav = await page.locator('nav').first().innerText().catch(() => '');
    results.roles.userChecks = {
      hasPlan: /PLAN/i.test(body),
      hasCredits: /CREDITS/i.test(body),
      hasDownload: /Download for Windows|Download Flow/i.test(body),
      hasBib: /\bBiB\b|Browser-in-Browser/i.test(body + nav),
      hasStudio: /Studio/i.test(nav),
    };
    await context.close();
  }

  // RESELLER
  {
    const context = await browser.newContext();
    await withSession(context, {
      token: resellerLogin.token,
      role: 'reseller',
      username: resellerLogin.user?.username || 'qa_reseller_tmp',
    });
    const page = await context.newPage();
    results.roles.reseller = [];
    results.roles.reseller.push(
      await visitPage(page, `${BASE}/reseller`, {
        clickSelectors: ['button:has-text("Add user")'],
      })
    );
    await context.close();
  }

  await browser.close();
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  console.log('WROTE', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
