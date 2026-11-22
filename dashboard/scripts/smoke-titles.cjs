const { chromium } = require('playwright');

(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage();
  await p.goto('http://localhost:3100/auth/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(800);
  console.log('login title=', await p.title());

  await p.fill('input[autocomplete="username"], input[type="text"]', 'admin');
  await p.fill('input[type="password"]', 'admin123');
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/admin/, { timeout: 20000 });
  await p.waitForTimeout(1000);
  console.log('admin title=', await p.title());

  await p.goto('http://localhost:3100/admin/accounts');
  await p.waitForTimeout(1200);
  const t = await p.locator('body').innerText();
  console.log('accounts email shown=', /@|No email|Google email/i.test(t));
  console.log('accounts TOTP=', /TOTP/i.test(t));

  await p.goto('http://localhost:3100/auth/login');
  await p.evaluate(() => localStorage.clear());
  await p.fill('input[autocomplete="username"], input[type="text"]', 'user1');
  await p.fill('input[type="password"]', 'pass123');
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/dashboard/, { timeout: 20000 });
  await p.waitForTimeout(1200);
  console.log('user title=', await p.title());

  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
