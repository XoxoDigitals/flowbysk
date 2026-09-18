'use strict';

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const {
  SITE_KEY,
  START_URL,
  UA,
  VIEW_W,
  VIEW_H,
  COOKIE_ALLOW,
  cookieAllowed,
  WEB_SESSION,
  findChrome,
  projectFromHref,
  sleep,
} = require('./helpers');
const { resolveEgressProxyUrl, parseProxyForChrome, rotateAccountProxy, clearEgressProxyCache } = require('./egressProxy');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const HEADLESS = process.env.HEADLESS === 'false' ? false : true;
const PROFILES_ROOT =
  process.env.BIB_PROFILES_DIR || path.resolve(__dirname, '..', '..', 'data', 'bib-profiles');
const PROFILES_ROOT_RESOLVED = path.resolve(PROFILES_ROOT);

/** Remove Chrome profile lock files so relaunch can reuse the same logged-in profile. */
function clearProfileLockFiles(profileDir) {
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    try {
      fs.unlinkSync(path.join(profileDir, name));
    } catch {
      /* ignore */
    }
  }
}

/**
 * Kill orphan Chrome processes still holding this user-data-dir (profile stays intact → no logout).
 */
async function killOrphanChromeForProfile(profileDir) {
  const dir = path.resolve(profileDir);
  try {
    if (process.platform === 'win32') {
      const ps = `
        $d = '${dir.replace(/'/g, "''")}';
        Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue |
          Where-Object { $_.CommandLine -and $_.CommandLine.Contains($d) } |
          ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
      `;
      await execFileAsync('powershell.exe', ['-NoProfile', '-Command', ps], {
        timeout: 20000,
        windowsHide: true,
      }).catch(() => {});
    } else {
      await execFileAsync('pkill', ['-f', dir], { timeout: 10000 }).catch(() => {});
    }
  } catch {
    /* ignore */
  }
  await sleep(600);
  clearProfileLockFiles(dir);
}

/** Strip path separators / traversal segments so accountId can't escape PROFILES_ROOT. */
function sanitizeAccountId(accountId) {
  return String(accountId || '').replace(/[\\/]/g, '_').replace(/\.\./g, '_') || 'unknown';
}

/**
 * Resolve a requested profile dir, rejecting (falling back to the safe default)
 * anything that would land outside PROFILES_ROOT.
 */
function safeProfileDir(accountId, requestedDir) {
  const safeId = sanitizeAccountId(accountId);
  const fallback = path.join(PROFILES_ROOT_RESOLVED, safeId);
  if (!requestedDir) return fallback;
  const resolved = path.resolve(requestedDir);
  if (resolved === PROFILES_ROOT_RESOLVED || resolved.startsWith(PROFILES_ROOT_RESOLVED + path.sep)) {
    return resolved;
  }
  console.warn(
    `[${accountId}] rejected profileDir outside PROFILES_ROOT: ${requestedDir} — using ${fallback}`
  );
  return fallback;
}

class AccountSession {
  constructor(accountId, opts = {}) {
    this.accountId = accountId;
    this.profileDir = safeProfileDir(accountId, opts.profileDir);
    this.maxSlots = opts.maxSlots || 5;
    this.status = 'STOPPED'; // STOPPED | STARTING | NEEDS_LOGIN | READY | ERROR
    this.browser = null;
    this.page = null;
    this.cdp = null;
    this.latestFrame = null;
    this.screencasting = false;
    this.wsClients = new Set();
    this.projectIds = Array.isArray(opts.projectIds) ? [...opts.projectIds] : [];
    this.rrIndex = 0;
    this.lastError = null;
    this.authLostNotified = false;
    this.email = null;
    this._healthTimer = null;
    this.wasReady = false;
    this._labsTokenCache = null;
    this._bearerSniffInstalled = false;
    this.egressProxyUrl = null;
    this.egressIp = null;
    this.egressCountry = null;
    this.egressCountryCode = null;
    this.egressError = null;
    this._mintLock = null;
    this._proxyFailStreak = 0;
    this._proxyCheckTick = 0;
    this._proxyRecovering = false;
    /** When false (default), Chrome aborts Image/Media/Font — saves residential proxy GB. */
    this.allowMedia = false;
    this._mediaGuardInstalled = false;
  }

  /** Safely update profileDir post-construction (e.g. re-launch with a new opts.profileDir). */
  setProfileDir(requestedDir) {
    if (!requestedDir) return this.profileDir;
    this.profileDir = safeProfileDir(this.accountId, requestedDir);
    return this.profileDir;
  }

  broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const ws of this.wsClients) {
      if (ws.readyState === 1) {
        try {
          ws.send(s);
        } catch {
          /* ignore */
        }
      }
    }
  }

  async startScreencast() {
    if (!this.cdp || !this.page) return;
    // Never throw — detached page / mid-reload must not fail Launch or surface to admins.
    try {
      if (this.screencasting) {
        try {
          await this.cdp.send('Page.stopScreencast').catch(() => {});
        } catch {
          /* ignore */
        }
        this.screencasting = false;
      }
      this.screencasting = true;
      this._lastFrameAt = 0;
      this.cdp.removeAllListeners?.('Page.screencastFrame');
      this.cdp.on('Page.screencastFrame', async (ev) => {
        this.latestFrame = ev.data;
        this._lastFrameAt = Date.now();
        this.broadcast({ type: 'frame', data: ev.data });
        try {
          await this.cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId });
        } catch {
          /* ignore */
        }
      });
      await this.cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 55,
        maxWidth: VIEW_W,
        maxHeight: VIEW_H,
        everyNthFrame: 1,
      });
    } catch (e) {
      this.screencasting = false;
      console.warn(
        `[${this.accountId}] startScreencast skipped:`,
        e?.message || e
      );
    }

    // Headless / detached CDP — screenshots still work for the admin stream
    if (this._shotTimer) clearInterval(this._shotTimer);
    this._shotTimer = setInterval(() => {
      this._screenshotFallback().catch(() => {});
    }, 700);
  }

  async _screenshotFallback() {
    if (!this.page || !this.browser) return;
    if (this._lastFrameAt && Date.now() - this._lastFrameAt < 1500) return;
    try {
      const buf = await this.page.screenshot({
        type: 'jpeg',
        quality: 55,
        encoding: 'base64',
      });
      if (!buf) return;
      this.latestFrame = buf;
      this._lastFrameAt = Date.now();
      this.broadcast({ type: 'frame', data: buf });
    } catch {
      /* page may be navigating */
    }
  }

  async launch() {
    if (this.browser) return this.publicStatus();
    this.status = 'STARTING';
    this.lastError = null;
    this.authLostNotified = false;
    fs.mkdirSync(this.profileDir, { recursive: true });
    // Ensure no orphan Chrome holds this profile (keeps cookies — no Google logout).
    await killOrphanChromeForProfile(this.profileDir);

    const chromePath = findChrome();
    if (!chromePath) {
      const tip =
        'Chrome not found. On the server run: cd /opt/flowbysk/flow-bib && npm run install:chrome';
      this.status = 'ERROR';
      this.lastError = tip;
      throw new Error(tip);
    }

    try {
      const launchArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-blink-features=AutomationControlled',
        `--window-size=${VIEW_W},${VIEW_H}`,
      ];
      let proxyAuth = null;
      try {
        const proxyUrl = await resolveEgressProxyUrl({ force: true, accountId: this.accountId });
        if (proxyUrl) {
          const parsed = parseProxyForChrome(proxyUrl);
          launchArgs.push(`--proxy-server=${parsed.server}`);
          if (parsed.username) {
            proxyAuth = { username: parsed.username, password: parsed.password || '' };
          }
          console.log(`[${this.accountId}] egress proxy: ${parsed.server}`);
          this.egressProxyUrl = proxyUrl;
        }
      } catch (e) {
        console.warn(`[${this.accountId}] egress proxy resolve failed:`, e.message);
      }

      this.browser = await puppeteer.launch({
        headless: HEADLESS,
        executablePath: chromePath,
        userDataDir: this.profileDir,
        defaultViewport: { width: VIEW_W, height: VIEW_H },
        args: launchArgs,
      });
      this.browser.on('disconnected', () => {
        console.warn(`[${this.accountId}] browser disconnected`);
        this.browser = null;
        this.page = null;
        this.cdp = null;
        this.screencasting = false;
        if (this.status !== 'STOPPED') this.status = 'STOPPED';
      });

      const pages = await this.browser.pages();
      this.page = pages[0] || (await this.browser.newPage());
      if (proxyAuth) {
        await this.page.authenticate(proxyAuth);
      }
      await this.page.setUserAgent(UA);
      this.cdp = await this.page.target().createCDPSession();
      this._bearerSniffInstalled = false;
      this._mediaGuardInstalled = false;
      await this._installMediaBandwidthGuard();
      await this._installBearerSniff();
      await this.page
        .goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
        .catch((e) => console.warn(`[${this.accountId}] nav:`, e.message));
      await this.startScreencast().catch((e) =>
        console.warn(`[${this.accountId}] screencast:`, e?.message || e)
      );

      await this.refreshEgressIp().catch((e) =>
        console.warn(`[${this.accountId}] egress IP probe:`, e.message)
      );

      const st = await this.refreshAuthStatus();
      await this.parkWarmProject().catch((e) =>
        console.warn(`[${this.accountId}] warm park:`, e.message || e)
      );
      await this.ensureWizAt(this.projectIds[0] || null).catch((e) =>
        console.warn(`[${this.accountId}] launch WIZ:`, e.message || e)
      );
      this._startHealthLoop();
      return st;
    } catch (e) {
      this.status = 'ERROR';
      this.lastError = e.message || String(e);
      this.browser = null;
      throw e;
    }
  }

  async disconnect({ clearProfile = false } = {}) {
    this._stopHealthLoop();
    this.screencasting = false;
    if (this._shotTimer) {
      clearInterval(this._shotTimer);
      this._shotTimer = null;
    }
    try {
      if (this.browser) await this.browser.close();
    } catch (e) {
      console.warn(`[${this.accountId}] close:`, e.message);
    }
    this.browser = null;
    this.page = null;
    this.cdp = null;
    this.latestFrame = null;
    this.status = 'STOPPED';
    this.allowMedia = false;
    this._mediaGuardInstalled = false;
    this._bearerSniffInstalled = false;
    // Always clear orphan locks so the next launch reuses the same profile (stay logged in).
    await killOrphanChromeForProfile(this.profileDir);
    if (clearProfile) {
      try {
        fs.rmSync(this.profileDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      this.projectIds = [];
    }
    this.broadcast({ type: 'status', status: this.status });
    return this.publicStatus();
  }

  async navigate(url = START_URL) {
    if (!this.page) throw new Error('Browser not launched');
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    return { url: this.page.url() };
  }

  async readContext() {
    if (!this.page) throw new Error('Browser not launched');
    return await this.page.evaluate(() => {
      const g = window.WIZ_global_data || {};
      return {
        origin: location.origin,
        href: location.href,
        at: g.SNlM0e || '',
        sid: g.FdrFJe || '',
        bl: g.cfb2h || '',
      };
    });
  }

  /**
   * If not already on any Flow project page, navigate to warm home (projectIds[0]
   * or preferred). Does NOT hop A→B when already on a different project.
   */
  async ensureOnAnyProjectPage(preferredProjectId) {
    if (!this.page) return null;
    const ctx = await this.readContext();
    const onProject = projectFromHref(ctx.href);
    if (onProject) return onProject;
    const warm =
      String(preferredProjectId || '').trim() ||
      this.projectIds[0] ||
      null;
    if (!warm) return null;
    await this.navigate(`https://flow.google.com/project/${warm}`);
    await sleep(800);
    return projectFromHref((await this.readContext()).href) || warm;
  }

  /** Best-effort: leave Chrome parked on projectIds[0] when not on a project. */
  async parkWarmProject() {
    return this.ensureOnAnyProjectPage(this.projectIds[0] || null);
  }

  /**
   * Light human-like mouse + scroll before reCAPTCHA mint (~1–2.5s).
   * No navigation — avoids destroying the JS context.
   */
  async humanizeBeforeMint() {
    if (!this.page || this.page.isClosed()) return;
    try {
      const viewport = this.page.viewport() || { width: VIEW_W, height: VIEW_H };
      const w = Math.max(320, viewport.width || VIEW_W);
      const h = Math.max(240, viewport.height || VIEW_H);
      let x = w * (0.25 + Math.random() * 0.4);
      let y = h * (0.3 + Math.random() * 0.35);
      await this.page.mouse.move(x, y, { steps: 2 + Math.floor(Math.random() * 3) });
      const moves = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < moves; i++) {
        x = Math.min(w - 20, Math.max(20, x + (Math.random() * 120 - 60)));
        y = Math.min(h - 20, Math.max(20, y + (Math.random() * 80 - 40)));
        await this.page.mouse.move(x, y, { steps: 2 + Math.floor(Math.random() * 4) });
        await sleep(150 + Math.floor(Math.random() * 250));
      }
      const dy = 40 + Math.floor(Math.random() * 140);
      try {
        await this.page.mouse.wheel({ deltaY: dy });
      } catch {
        await this.page.evaluate((d) => window.scrollBy(0, d), dy);
      }
      await sleep(200 + Math.floor(Math.random() * 300));
      if (Math.random() > 0.4) {
        const back = -Math.floor(dy * (0.3 + Math.random() * 0.5));
        try {
          await this.page.mouse.wheel({ deltaY: back });
        } catch {
          await this.page.evaluate((d) => window.scrollBy(0, d), back);
        }
        await sleep(120 + Math.floor(Math.random() * 200));
      }
    } catch (e) {
      console.warn(`[${this.accountId}] humanizeBeforeMint:`, e.message || e);
    }
  }

  async mintRecaptcha(action = 'IMAGE_GENERATION') {
    if (!this.page) throw new Error('Browser not launched');

    // Serialize mints so status polls / generates don't race the same tab.
    while (this._mintLock) {
      await this._mintLock.catch(() => {});
    }
    let release;
    this._mintLock = new Promise((r) => {
      release = r;
    });

    const ensureProjectPage = async () => {
      // Any project page is enough for grecaptcha; do not hop to a different sticky id.
      return this.ensureOnAnyProjectPage(this.projectIds[0] || null);
    };

    const waitForSettle = async () => {
      try {
        await this.page.waitForFunction(() => document.readyState === 'complete', {
          timeout: 8000,
        });
      } catch {
        /* ignore */
      }
      await sleep(600);
    };

    try {
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          await ensureProjectPage();
          try {
            await this.page.waitForFunction(
              () =>
                !!(
                  window.grecaptcha &&
                  window.grecaptcha.enterprise &&
                  typeof window.grecaptcha.enterprise.execute === 'function'
                ),
              { timeout: 10000 }
            );
          } catch {
            await ensureProjectPage();
            const stillMissing = !(await this.readContext()
              .then((c) => projectFromHref(c.href))
              .catch(() => null));
            if (stillMissing) {
              await this.page.reload({ waitUntil: 'domcontentloaded' });
            }
            await sleep(1500);
          }

          await this.humanizeBeforeMint();

          const token = await this.page.evaluate(
            async (key, act) => {
              await new Promise((resolve) => {
                try {
                  if (
                    window.grecaptcha &&
                    window.grecaptcha.enterprise &&
                    typeof window.grecaptcha.enterprise.ready === 'function'
                  ) {
                    window.grecaptcha.enterprise.ready(resolve);
                  } else {
                    resolve();
                  }
                } catch {
                  resolve();
                }
              });
              if (!(window.grecaptcha && window.grecaptcha.enterprise)) return '';
              try {
                return await window.grecaptcha.enterprise.execute(key, { action: act });
              } catch (e) {
                try {
                  return await window.grecaptcha.enterprise.execute(key, { action: act });
                } catch {
                  return '';
                }
              }
            },
            SITE_KEY,
            action
          );

          if (token && String(token).length >= 50) {
            if (attempt > 1) {
              console.log(`[${this.accountId}] reCAPTCHA mint ok on attempt ${attempt} (${action})`);
            }
            return token;
          }
          console.warn(
            `[${this.accountId}] reCAPTCHA mint empty (attempt ${attempt}/4, action=${action})`
          );
        } catch (e) {
          const msg = e && e.message ? e.message : String(e);
          console.warn(`[${this.accountId}] reCAPTCHA mint error attempt ${attempt}:`, msg);
          if (/Execution context was destroyed|navigation|Target closed/i.test(msg)) {
            await waitForSettle();
          }
        }
        await sleep(800 * attempt);
      }
      return '';
    } finally {
      this._mintLock = null;
      if (typeof release === 'function') release();
    }
  }

  /**
   * Block Image / Media through the egress proxy in background (no admin viewer).
   * Fonts stay allowed so Flow shell/WIZ can still load. Manual viewer = allow all.
   */
  async _installMediaBandwidthGuard(opts = {}) {
    if (!this.cdp || this._mediaGuardInstalled) return;
    this._mediaGuardInstalled = true;
    if (!opts.keepAllowMedia) this.allowMedia = false;
    try {
      await this.cdp.send('Fetch.enable', {
        patterns: [
          { resourceType: 'Image', requestStage: 'Request' },
          { resourceType: 'Media', requestStage: 'Request' },
        ],
      });
    } catch (e) {
      console.warn(`[${this.accountId}] Fetch.enable media guard:`, e.message);
      return;
    }

    this.cdp.on('Fetch.requestPaused', async (ev) => {
      try {
        if (this.allowMedia) {
          await this.cdp.send('Fetch.continueRequest', { requestId: ev.requestId });
          return;
        }
        await this.cdp.send('Fetch.failRequest', {
          requestId: ev.requestId,
          errorReason: 'BlockedByClient',
        });
      } catch {
        /* page/cdp may be gone */
      }
    });
    console.log(
      `[${this.accountId}] media bandwidth guard ON (images/video blocked in background; fonts OK)`
    );
  }

  /**
   * Toggle media loading. Manual viewer → everything on (no forced reload).
   * Background → block images/video again.
   */
  async setMediaLoadingEnabled(enabled, { reload = false } = {}) {
    const next = !!enabled;
    if (this.allowMedia === next && !(next && reload)) {
      return { allowMedia: this.allowMedia };
    }
    this.allowMedia = next;
    console.log(
      `[${this.accountId}] media loading ${next ? 'ENABLED (manual viewer)' : 'BLOCKED (background)'}`
    );
    if (next && reload && this.page) {
      try {
        const href = this.page.url() || '';
        const warm =
          (href.match(/\/project\/([0-9a-f-]{36})/i) || [])[1] ||
          this.projectIds[0] ||
          null;
        if (warm) {
          await this.navigate(`https://flow.google.com/project/${warm}`);
        } else {
          await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        }
        try {
          this.cdp = await this.page.target().createCDPSession();
          this._bearerSniffInstalled = false;
          this._mediaGuardInstalled = false;
          this.screencasting = false;
          await this._installMediaBandwidthGuard({ keepAllowMedia: true });
          this.allowMedia = true;
          await this._installBearerSniff();
          await this.startScreencast();
          this.refreshEgressIp().catch(() => {});
        } catch (e) {
          console.warn(`[${this.accountId}] rebind after media enable:`, e.message || e);
        }
      } catch (e) {
        console.warn(`[${this.accountId}] media enable nav:`, e.message);
      }
    }
    return { allowMedia: this.allowMedia };
  }

  async onViewerConnected() {
    const n = this.wsClients.size;
    if (n === 1) {
      // Manual mode: show everything. Soft project nav (not blind reload) + ensure WIZ at.
      await this.setMediaLoadingEnabled(true, { reload: true });
      await this.ensureWizAt(this.projectIds[0] || null).catch((e) =>
        console.warn(`[${this.accountId}] viewer WIZ recover:`, e.message || e)
      );
    }
  }

  async onViewerDisconnected() {
    if (this.wsClients.size === 0) {
      await this.setMediaLoadingEnabled(false);
    }
  }

  /**
   * Ensure Flow WIZ `at` (SNlM0e) is present — navigate to a project page if missing.
   * Used in background gens and manual viewer.
   */
  async ensureWizAt(preferredProjectId = null, opts = {}) {
    if (!this.page) return { ok: false, at: '', reason: 'no page' };
    const maxAttempts = Math.max(1, opts.attempts || 3);
    for (let i = 0; i < maxAttempts; i++) {
      let ctx;
      try {
        ctx = await this.readContext();
      } catch (e) {
        console.warn(`[${this.accountId}] ensureWizAt read:`, e.message || e);
        await sleep(500);
        continue;
      }
      if (ctx?.at && String(ctx.at).length > 10) {
        return { ok: true, at: ctx.at, href: ctx.href };
      }
      const warm =
        String(preferredProjectId || '').trim() ||
        projectFromHref(ctx?.href || '') ||
        this.projectIds[0] ||
        null;
      console.warn(
        `[${this.accountId}] WIZ at missing — loading project ${warm ? warm.slice(0, 8) : '?'}… (try ${i + 1}/${maxAttempts})`
      );
      try {
        if (warm) {
          await this.ensureOnAnyProjectPage(warm);
        } else {
          await this.navigate('https://flow.google.com/');
        }
        await sleep(900 + i * 400);
        // Wait briefly for WIZ_global_data to appear
        for (let w = 0; w < 8; w++) {
          try {
            const at = await this.page.evaluate(() => {
              const g = window.WIZ_global_data || {};
              return g.SNlM0e || '';
            });
            if (at && String(at).length > 10) {
              return { ok: true, at, href: this.page.url() };
            }
          } catch {
            /* navigating */
          }
          await sleep(400);
        }
      } catch (e) {
        console.warn(`[${this.accountId}] ensureWizAt nav:`, e.message || e);
      }
    }
    return { ok: false, at: '', reason: 'WIZ at still missing after project load' };
  }

  async _installBearerSniff() {
    if (!this.cdp || this._bearerSniffInstalled) return;
    this._bearerSniffInstalled = true;
    this._networkCaptures = this._networkCaptures || [];
    this._pendingCaptureByRequestId = this._pendingCaptureByRequestId || new Map();
    try {
      await this.cdp.send('Network.enable', {
        maxPostDataSize: 2_000_000,
      });
    } catch {
      /* ignore */
    }

    const interesting = (url) =>
      /aisandbox-pa\.googleapis\.com/i.test(url) ||
      (/batchexecute/i.test(url) && /flow\.google|google\.com/i.test(url));

    const pushCapture = (entry) => {
      try {
        this._networkCaptures.push(entry);
        if (this._networkCaptures.length > 80) this._networkCaptures.shift();
        const fs = require('fs');
        const pathMod = require('path');
        const dir = pathMod.join(
          pathMod.dirname(this.profileDir),
          '..',
          'bib-captures',
          this.accountId
        );
        fs.mkdirSync(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const kind = String(entry.url || '')
          .split('?')[0]
          .split('/')
          .pop()
          .replace(/[^\w.-]+/g, '_')
          .slice(0, 80);
        const file = pathMod.join(dir, `${stamp}_${entry.phase || 'req'}_${kind}.json`);
        fs.writeFileSync(file, JSON.stringify(entry, null, 2));
        if (/Upsample|upsample|batchAsyncGenerateVideo/i.test(entry.url || '')) {
          console.log(
            `[${this.accountId}] CAPTURE ${entry.phase} ${entry.method || ''} ${entry.url} status=${entry.status || '-'}`
          );
        }
      } catch (e) {
        console.warn(`[${this.accountId}] capture write:`, e.message);
      }
    };

    this.cdp.on('Network.requestWillBeSent', async (ev) => {
      try {
        const url = ev?.request?.url || '';
        if (!interesting(url)) return;
        const headers = ev.request.headers || {};
        const auth =
          headers.Authorization ||
          headers.authorization ||
          headers.AUTHORIZATION ||
          '';
        const m = String(auth).match(/Bearer\s+(\S+)/i);
        if (m?.[1] && m[1].length > 20) {
          this._labsTokenCache = {
            token: m[1],
            expiresAt: Date.now() + 50 * 60 * 1000,
            source: 'sniff',
          };
        }

        let postData = ev.request.postData || '';
        if (!postData && ev.requestId) {
          try {
            const got = await this.cdp.send('Network.getRequestPostData', {
              requestId: ev.requestId,
            });
            postData = got?.postData || '';
          } catch {
            /* no body */
          }
        }

        let bodyPreview = postData;
        let bodyJson = null;
        if (postData) {
          try {
            bodyJson = JSON.parse(postData);
            bodyPreview = JSON.stringify(bodyJson).slice(0, 8000);
          } catch {
            bodyPreview = String(postData).slice(0, 8000);
          }
        }

        const entry = {
          ts: new Date().toISOString(),
          phase: 'request',
          requestId: ev.requestId,
          method: ev.request.method,
          url,
          hasBearer: !!m,
          contentType: headers['Content-Type'] || headers['content-type'] || '',
          bodyJson,
          bodyPreview,
        };
        this._pendingCaptureByRequestId.set(ev.requestId, entry);
        pushCapture(entry);
      } catch {
        /* ignore */
      }
    });

    this.cdp.on('Network.responseReceived', (ev) => {
      try {
        const url = ev?.response?.url || '';
        if (!interesting(url)) return;
        const prev = this._pendingCaptureByRequestId.get(ev.requestId) || {
          requestId: ev.requestId,
          url,
        };
        prev.responseMeta = {
          status: ev.response.status,
          mimeType: ev.response.mimeType,
        };
        this._pendingCaptureByRequestId.set(ev.requestId, prev);
      } catch {
        /* ignore */
      }
    });

    this.cdp.on('Network.loadingFinished', async (ev) => {
      try {
        const prev = this._pendingCaptureByRequestId.get(ev.requestId);
        if (!prev) return;
        let bodyText = '';
        try {
          const got = await this.cdp.send('Network.getResponseBody', {
            requestId: ev.requestId,
          });
          bodyText = got?.body || '';
          if (got?.base64Encoded) {
            bodyText = Buffer.from(bodyText, 'base64').toString('utf8');
          }
        } catch {
          /* ignore */
        }
        let bodyJson = null;
        try {
          bodyJson = JSON.parse(bodyText);
        } catch {
          /* not json */
        }
        const entry = {
          ts: new Date().toISOString(),
          phase: 'response',
          requestId: ev.requestId,
          method: prev.method,
          url: prev.url,
          status: prev.responseMeta?.status,
          requestBodyJson: prev.bodyJson || null,
          responseJson: bodyJson,
          responsePreview: String(bodyText || '').slice(0, 12000),
        };
        pushCapture(entry);
        this._pendingCaptureByRequestId.delete(ev.requestId);
      } catch {
        /* ignore */
      }
    });
  }

  getNetworkCaptures(limit = 40) {
    const list = Array.isArray(this._networkCaptures) ? this._networkCaptures : [];
    return list.slice(-Math.max(1, Math.min(100, Number(limit) || 40)));
  }

  _cachedAccessToken(force = false) {
    const cached = this._labsTokenCache;
    if (
      !force &&
      cached?.token &&
      cached.expiresAt &&
      cached.expiresAt > Date.now() + 60_000
    ) {
      return cached.token;
    }
    return '';
  }

  _storeAccessToken(token, expires) {
    if (!token || String(token).length < 20) return '';
    let expiresAt = Date.now() + 50 * 60 * 1000;
    if (expires) {
      const t = Date.parse(expires);
      if (!Number.isNaN(t)) expiresAt = t;
    }
    this._labsTokenCache = { token: String(token), expiresAt, source: 'session' };
    return String(token);
  }

  /**
   * aisandbox Bearer: prefer sniffed Flow traffic; fallback to labs NextAuth API only
   * (never navigate to labs.google/fx/tools/flow — it 308s to flow.google.com).
   */
  async fetchLabsAccessToken(opts = {}) {
    if (!this.page) return '';
    const force = opts.force === true;
    const hit = this._cachedAccessToken(force);
    if (hit) return hit;

    await this._installBearerSniff();

    // 1) Absolute labs session JSON (still works when next-auth cookie exists)
    let token = await this._fetchLabsTokenViaCdpCookies();
    if (token) return this._storeAccessToken(token);

    // 2) API-only NextAuth warm (signin/google — not tools UI)
    const warm = await this.ensureLabsSession({ force: true }).catch((e) => ({
      ok: false,
      reason: e.message,
    }));
    if (!warm?.ok) {
      console.warn(`[${this.accountId}] aisandbox auth warm:`, warm?.reason || warm);
    }
    token = await this._fetchLabsTokenViaCdpCookies();
    if (token) return this._storeAccessToken(token);

    // 3) Nudge Flow to call aisandbox so CDP sniff can catch Bearer
    await this._nudgeAisandboxBearerSniff();
    const sniffed = this._cachedAccessToken(false);
    if (sniffed) return sniffed;

    return '';
  }

  async _nudgeAisandboxBearerSniff() {
    if (!this.page) return;
    try {
      const projectId =
        projectFromHref((await this.readContext()).href) || this.projectIds[0] || '';
      if (projectId && !/flow\.google\.com\/project\//i.test(this.page.url() || '')) {
        await this.navigate(`https://flow.google.com/project/${projectId}`);
        await sleep(1000);
      } else if (!/flow\.google\.com/i.test(this.page.url() || '')) {
        await this.navigate(START_URL);
        await sleep(1000);
      }
      // Lightweight credits probe — Flow may attach Bearer automatically
      await this.page
        .evaluate(async () => {
          try {
            await fetch(
              'https://aisandbox-pa.googleapis.com/v1/credits?key=AIzaSyBtrm0o5ab1c-Ec8ZuLcGt3oJAA5VWt3pA',
              { credentials: 'include', method: 'GET' }
            );
          } catch {
            /* ignore */
          }
        })
        .catch(() => {});
      await sleep(1500);
    } catch (e) {
      console.warn(`[${this.accountId}] aisandbox sniff nudge:`, e.message);
    }
  }

  async _fetchLabsTokenViaCdpCookies() {
    try {
      const { cookies } = await this.cdp.send('Network.getCookies', {
        urls: [
          'https://labs.google',
          'https://labs.google/fx/api/auth/session',
          'https://flow.google.com',
        ],
      });
      const cookie = (cookies || [])
        .map((c) => `${c.name}=${c.value}`)
        .join('; ');
      if (!cookie || cookie.length < 20) return '';
      const r = await fetch('https://labs.google/fx/api/auth/session', {
        headers: {
          Cookie: cookie,
          Origin: 'https://labs.google',
          Referer: 'https://labs.google/fx/api/auth/session',
          'User-Agent': UA,
          Accept: 'application/json',
        },
        redirect: 'follow',
      });
      const ct = r.headers.get('content-type') || '';
      if (!r.ok || !/json/i.test(ct)) return '';
      const j = await r.json().catch(() => ({}));
      const token = j.access_token || j.accessToken || '';
      if (token && j.expires) {
        this._storeAccessToken(token, j.expires);
      }
      if (j?.user?.email) this.email = j.user.email;
      return token;
    } catch (e) {
      console.warn(`[${this.accountId}] labs CDP session fetch:`, e.message);
      return '';
    }
  }

  async _clickLabsSignInIfNeeded() {
    if (!this.page) return false;
    try {
      const clicked = await this.page.evaluate(() => {
        const texts = [
          /^sign in$/i,
          /^log in$/i,
          /sign in with google/i,
          /continue with google/i,
          /^continue$/i,
          /use google account/i,
          /^next$/i,
          /^yes$/i,
          /^allow$/i,
        ];
        const nodes = [
          ...document.querySelectorAll('button, a, [role=button], div[tabindex], li, div[data-identifier]'),
        ];
        const account = nodes.find((el) => {
          const id = el.getAttribute('data-identifier') || '';
          const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          return /@/.test(id) || (/@gmail\.com|@googlemail\.com/i.test(t) && t.length < 80);
        });
        if (account) {
          (account.closest('[role=link]') || account.closest('li') || account).click();
          return 'account:' + ((account.getAttribute('data-identifier') || account.innerText || '').slice(0, 40));
        }
        for (const el of nodes) {
          const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          if (!t || t.length > 48) continue;
          if (!texts.some((re) => re.test(t))) continue;
          const target =
            el.closest('button') || el.closest('a') || el.closest('[role=button]') || el;
          target.click();
          return t;
        }
        return '';
      });
      if (clicked) {
        console.info(`[${this.accountId}] auth sign-in click:`, clicked);
        await sleep(2500);
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  async _hasLabsNextAuthCookie() {
    try {
      const { cookies } = await this.cdp.send('Network.getCookies', {
        urls: ['https://labs.google', 'https://labs.google/fx/api/auth/session'],
      });
      return (cookies || []).some((c) => /next-auth\.session-token/i.test(c.name));
    } catch {
      return false;
    }
  }

  /**
   * Mint reCAPTCHA on Flow, then POST aisandbox with Bearer (stay on flow.google.com).
   * Retries once on Execution context destroyed / navigation races.
   */
  async aisandboxPost(endpoint, payload, action = 'VIDEO_GENERATION') {
    if (!this.page) throw new Error('no page');

    const attemptOnce = async () => {
      const warmPid =
        projectFromHref((await this.readContext()).href) || this.projectIds[0] || '';
      const payloadPid = String(
        (payload && payload.clientContext && payload.clientContext.projectId) || ''
      ).trim();
      // Sticky/target project from payload wins; warm tab project only for parking mint.
      const projectId = payloadPid || warmPid;

      let accessToken = await this.fetchLabsAccessToken({ force: true });
      if (!accessToken) {
        await sleep(1500);
        accessToken = await this.fetchLabsAccessToken({ force: true });
      }
      if (!accessToken) {
        throw new Error(
          'No aisandbox access_token — open BiB viewer, sign into flow.google.com with the same Google account, then click Refresh aisandbox token'
        );
      }

      // Park on any project page for mint — do not hop to sticky target.
      await this.ensureOnAnyProjectPage(warmPid || projectId || this.projectIds[0]);

      const recaptcha = await this.mintRecaptcha(action);
      if (!recaptcha || recaptcha.length < 50) {
        throw new Error('reCAPTCHA mint failed for aisandbox');
      }

      const body = JSON.parse(JSON.stringify(payload || {}));
      const ctx = body.clientContext || (body.clientContext = {});
      if (projectId) ctx.projectId = projectId;
      ctx.recaptchaContext = {
        token: recaptcha,
        applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB',
      };

      const runPost = async (bearer) =>
        this.page.evaluate(
          async (ep, bodyJson, tok) => {
            try {
              const r = await fetch(ep, {
                method: 'POST',
                headers: {
                  'Content-Type': 'text/plain;charset=UTF-8',
                  Authorization: 'Bearer ' + tok,
                },
                body: bodyJson,
                credentials: 'include',
              });
              const text = await r.text();
              return { status: r.status, text };
            } catch (e) {
              return { status: 0, text: e && e.message ? e.message : String(e) };
            }
          },
          endpoint,
          JSON.stringify(body),
          bearer
        );

      let result;
      try {
        result = await runPost(accessToken);
      } catch (evalErr) {
        const msg = evalErr && evalErr.message ? evalErr.message : String(evalErr);
        if (/Execution context was destroyed|navigation|Target closed/i.test(msg)) {
          throw Object.assign(new Error(msg), { isContextDestroyed: true });
        }
        throw evalErr;
      }

      if (result.status === 401) {
        this._labsTokenCache = null;
        await this.ensureLabsSession({ force: true }).catch(() => null);
        await this._nudgeAisandboxBearerSniff();
        accessToken = await this.fetchLabsAccessToken({ force: true });
        if (accessToken) {
          try {
            result = await runPost(accessToken);
          } catch (evalErr) {
            const msg = evalErr && evalErr.message ? evalErr.message : String(evalErr);
            if (/Execution context was destroyed|navigation|Target closed/i.test(msg)) {
              throw Object.assign(new Error(msg), { isContextDestroyed: true });
            }
            throw evalErr;
          }
        }
      }

      let data = null;
      try {
        data = JSON.parse(result.text || '{}');
      } catch {
        data = { raw: String(result.text || '').slice(0, 400) };
      }
      if (!result.status || result.status >= 400) {
        if (result.status === 401) this._labsTokenCache = null;
        let msg =
          (data && (data.error || data.message || data.status)) ||
          String(result.text || '').slice(0, 240);
        if (msg && typeof msg === 'object') {
          try {
            msg = JSON.stringify(msg);
          } catch {
            msg = String(msg);
          }
        }
        throw new Error(`aisandbox ${result.status}: ${msg}`);
      }
      return data;
    };

    try {
      return await attemptOnce();
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      const isCtx =
        e?.isContextDestroyed ||
        /Execution context was destroyed|navigation|Target closed/i.test(msg);
      if (!isCtx) throw e;
      console.warn(`[${this.accountId}] aisandboxPost context destroyed — settle and retry once`);
      await sleep(1500);
      const pid = this.projectIds[0];
      if (pid) {
        await this.navigate(`https://flow.google.com/project/${pid}`).catch(() => {});
        await sleep(1000);
      }
      return await attemptOnce();
    }
  }

  /**
   * GET aisandbox (flowMedia detail) with Bearer — no reCAPTCHA.
   */
  async aisandboxGet(endpoint) {
    if (!this.page) throw new Error('no page');
    let accessToken = await this.fetchLabsAccessToken({ force: false });
    if (!accessToken) {
      accessToken = await this.fetchLabsAccessToken({ force: true });
    }
    if (!accessToken) {
      throw new Error(
        'No aisandbox access_token — open BiB viewer, sign into flow.google.com, then Refresh aisandbox token'
      );
    }
    const runGet = async (bearer) =>
      this.page.evaluate(
        async (ep, tok) => {
          try {
            const r = await fetch(ep, {
              method: 'GET',
              headers: {
                Authorization: 'Bearer ' + tok,
                Accept: 'application/json',
              },
              credentials: 'include',
            });
            const text = await r.text();
            return { status: r.status, text };
          } catch (e) {
            return { status: 0, text: e && e.message ? e.message : String(e) };
          }
        },
        endpoint,
        bearer
      );

    let result = await runGet(accessToken);
    if (result.status === 401) {
      this._labsTokenCache = null;
      accessToken = await this.fetchLabsAccessToken({ force: true });
      if (accessToken) result = await runGet(accessToken);
    }
    let data = null;
    try {
      data = JSON.parse(result.text || '{}');
    } catch {
      data = { raw: String(result.text || '').slice(0, 400) };
    }
    if (!result.status || result.status >= 400) {
      if (result.status === 401) this._labsTokenCache = null;
      let msg =
        (data && (data.error || data.message || data.status)) ||
        String(result.text || '').slice(0, 240);
      if (msg && typeof msg === 'object') {
        try {
          msg = JSON.stringify(msg);
        } catch {
          msg = String(msg);
        }
      }
      throw new Error(`aisandbox GET ${result.status}: ${msg}`);
    }
    return data;
  }

  async cookieHeaderFor(origin) {
    const urls = [
      origin,
      'https://flow.google.com',
      'https://labs.google',
      'https://labs.google/fx/api/auth/session',
      'https://www.google.com',
      'https://accounts.google.com',
    ].filter(Boolean);
    const { cookies } = await this.cdp.send('Network.getCookies', { urls });
    const seen = new Set();
    const kept = [];
    const names = new Set();
    for (const c of cookies) {
      names.add(c.name);
      if (!cookieAllowed(c.name) || seen.has(c.name)) continue;
      seen.add(c.name);
      kept.push(`${c.name}=${c.value}`);
    }
    return { cookie: kept.join('; '), names };
  }

  /**
   * Warm aisandbox auth without labs tools UI (308 → flow.google.com).
   * Uses NextAuth API endpoints only, then restores Flow project.
   */
  async ensureLabsSession(opts = {}) {
    if (!this.page) return { ok: false, reason: 'no page' };
    const force = opts.force === true;
    try {
      await this._installBearerSniff();
      if (!force && this._cachedAccessToken(false)) {
        return { ok: true, warmed: false, source: 'cache' };
      }
      if (!force && (await this._hasLabsNextAuthCookie())) {
        const t = await this._fetchLabsTokenViaCdpCookies();
        if (t) return { ok: true, warmed: false, source: 'session' };
      }

      const prev = this.page.url();
      const deadline = Date.now() + 24000;
      let attempt = 0;
      while (Date.now() < deadline) {
        attempt += 1;
        // API-only: never goto labs.google/fx/tools/flow
        await this.page
          .goto('https://labs.google/fx/api/auth/signin/google', {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
          })
          .catch(() => {});
        await sleep(2000);
        for (let i = 0; i < 12; i++) {
          const u = this.page.url() || '';
          if (/accounts\.google\.com/i.test(u)) {
            await this._clickLabsSignInIfNeeded();
          }
          // Callback landed or Flow redirect — stop waiting
          if (
            /labs\.google\/fx\/api\/auth\/callback/i.test(u) ||
            /flow\.google\.com/i.test(u) ||
            (/labs\.google/i.test(u) && !/signin|accounts\.google/i.test(u))
          ) {
            break;
          }
          await sleep(1000);
        }

        const token = await this._fetchLabsTokenViaCdpCookies();
        if (token) {
          const pid = this.projectIds[0];
          if (pid) {
            await this.navigate(`https://flow.google.com/project/${pid}`);
            await sleep(600);
          } else if (prev && /flow\.google\.com/i.test(prev)) {
            await this.navigate(prev);
            await sleep(600);
          }
          return { ok: true, warmed: true, attempts: attempt, source: 'nextauth-api' };
        }
        await sleep(800 * attempt);
      }

      await this._nudgeAisandboxBearerSniff();
      if (this._cachedAccessToken(false)) {
        return { ok: true, warmed: true, source: 'sniff' };
      }

      const pid = this.projectIds[0];
      if (pid) {
        await this.navigate(`https://flow.google.com/project/${pid}`).catch(() => {});
      } else if (prev && /flow\.google\.com/i.test(prev)) {
        await this.navigate(prev).catch(() => {});
      } else {
        await this.navigate(START_URL).catch(() => {});
      }

      return {
        ok: false,
        warmed: true,
        reason:
          'No aisandbox Bearer yet — sign into flow.google.com in BiB viewer, then Refresh aisandbox token',
      };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  async refreshAuthStatus() {
    if (!this.page) {
      this.status = 'STOPPED';
      return this.publicStatus();
    }
    try {
      const ctx = await this.readContext();
      const { cookie, names } = await this.cookieHeaderFor(ctx.origin || 'https://flow.google.com');
      const hasWeb = WEB_SESSION.every((n) => names.has(n));
      const signedOut =
        /\/about\b/i.test(ctx.href || '') ||
        (!ctx.at && !hasWeb) ||
        (cookie.length < 20 && !ctx.at);

      if (ctx.at && hasWeb) {
        this.status = 'READY';
        this.wasReady = true;
        this.authLostNotified = false;
        // Auto-refresh the aisandbox (labs) Bearer token while READY so the user never
        // has to click "Refresh aisandbox token" manually. Fire-and-forget so it never
        // blocks status refresh. Retries on each health cycle until a token is actually
        // obtained (an early attempt can fail before the labs session is warm), and is
        // not marked done until success — then it only re-runs after the cache expires.
        if (
          typeof this.fetchLabsAccessToken === 'function' &&
          !this._cachedAccessToken(false) &&
          !this._labsAutofetchInFlight
        ) {
          this._labsAutofetchInFlight = true;
          Promise.resolve(this.fetchLabsAccessToken({ force: true }))
            .catch(() => {})
            .finally(() => {
              this._labsAutofetchInFlight = false;
            });
        }
        // try read email from page
        try {
          this.email = await this.page.evaluate(() => {
            const t = document.body ? document.body.innerText : '';
            const m = t.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
            return m ? m[0] : null;
          });
        } catch {
          /* ignore */
        }
      } else if (hasWeb && !signedOut) {
        // Google cookies still present — WIZ `at` can be missing mid-navigation /
        // after proxy relaunch / on non-project pages. Do NOT flap to NEEDS_LOGIN.
        if (this.status !== 'STARTING') this.status = 'READY';
      } else if (this.browser && (!hasWeb || signedOut)) {
        this.status = 'NEEDS_LOGIN';
      }

      const projectId = projectFromHref(ctx.href);
      // "Logged in" for API gates = Google web session cookies, not only WIZ at.
      const sessionAlive = hasWeb && !signedOut;
      return {
        ...this.publicStatus(),
        url: ctx.href,
        origin: ctx.origin,
        authenticated: sessionAlive,
        hasProject: !!projectId,
        projectId,
        at: !!ctx.at,
        hasWebSession: hasWeb,
        cookieLength: cookie.length,
      };
    } catch (e) {
      this.status = 'ERROR';
      this.lastError = e.message;
      return this.publicStatus();
    }
  }

  publicStatus() {
    return {
      accountId: this.accountId,
      status: this.status,
      profileDir: this.profileDir,
      projectIds: this.projectIds,
      projectCount: this.projectIds.length,
      maxSlots: this.maxSlots,
      email: this.email,
      lastError: this.lastError,
      running: !!this.browser,
      allowMedia: !!this.allowMedia,
      viewers: this.wsClients.size,
      egress: {
        proxy: this.egressProxyUrl || null,
        ip: this.egressIp || null,
        country: this.egressCountry || null,
        countryCode: this.egressCountryCode || null,
        error: this.egressError || null,
      },
    };
  }

  /**
   * Probe exit IP/country via curl through the configured proxy (avoids page
   * "Execution context was destroyed" during navigation / rotate).
   */
  async refreshEgressIp() {
    let proxyUrl = null;
    try {
      proxyUrl = await resolveEgressProxyUrl({ accountId: this.accountId });
    } catch {
      proxyUrl = null;
    }
    this.egressProxyUrl = proxyUrl;
    this.egressError = null;

    const curlJson = async (url) => {
      const args = ['-sS', '--max-time', '12', '-H', 'Accept: application/json', url];
      if (proxyUrl) args.splice(1, 0, '-x', proxyUrl);
      try {
        const { stdout } = await execFileAsync('curl', args, {
          encoding: 'utf8',
          timeout: 15000,
          windowsHide: true,
          maxBuffer: 256 * 1024,
        });
        const text = String(stdout || '').trim();
        if (!text) return null;
        return JSON.parse(text);
      } catch {
        return null;
      }
    };

    try {
      // Prefer fast ipify first so the stream toolbar leaves "checking…" quickly
      let info = null;
      const second = await curlJson('https://api.ipify.org?format=json');
      if (second && second.ip) {
        info = { ip: String(second.ip), country: '', countryCode: '' };
      }
      const first = await curlJson('https://ipapi.co/json/');
      if (first && first.ip && !first.error) {
        info = {
          ip: String(first.ip),
          country: String(first.country_name || first.country || ''),
          countryCode: String(first.country_code || ''),
        };
      }

      if (info && info.ip) {
        this.egressIp = info.ip;
        this.egressCountry = info.country || null;
        this.egressCountryCode = info.countryCode || null;
        this.broadcast({
          type: 'egress',
          ip: this.egressIp,
          country: this.egressCountry,
          countryCode: this.egressCountryCode,
          proxy: !!this.egressProxyUrl,
        });
        return info;
      }
      this.egressError = proxyUrl ? 'Proxy exit IP probe failed' : 'Could not resolve exit IP';
      this.broadcast({
        type: 'egress',
        ip: null,
        error: this.egressError,
        proxy: !!this.egressProxyUrl,
      });
      return null;
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      // Never surface navigation destroy as a sticky proxy error
      if (/Execution context was destroyed|Target closed|navigation/i.test(msg)) {
        this.egressError = null;
        return null;
      }
      this.egressError = msg.slice(0, 160);
      return null;
    }
  }

  pickProjectId(preferred) {
    const pref = preferred ? String(preferred).trim() : '';
    if (pref) {
      const hit = this.projectIds.find((id) => String(id).toLowerCase() === pref.toLowerCase());
      // Prefer Next's sticky pin even if BiB's local list is stale — never round-robin away
      return hit || pref;
    }
    if (!this.projectIds.length) return null;
    const id = this.projectIds[this.rrIndex % this.projectIds.length];
    this.rrIndex += 1;
    return id;
  }

  async scrapeProjects() {
    if (!this.page) throw new Error('Browser not launched');
    // Always use flow.google.com home — project cards live there (not labs.google).
    await this.navigate('https://flow.google.com/');
    await sleep(2500);
    try {
      await this.page.waitForSelector('a[href*="/project/"], [href*="/project/"]', { timeout: 8000 });
    } catch {
      /* cards may still be in HTML without matching that wait */
    }
    // Scroll to load more project tiles
    await this.page.evaluate(async () => {
      for (let i = 0; i < 4; i++) {
        window.scrollBy(0, 900);
        await new Promise((r) => setTimeout(r, 350));
      }
      window.scrollTo(0, 0);
    });
    await sleep(500);

    const ids = await this.page.evaluate(() => {
      const seen = new Set();
      const add = (raw) => {
        if (!raw) return;
        const m = String(raw).match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
        if (m) seen.add(m[0].toLowerCase());
      };
      document.querySelectorAll('a[href], [href]').forEach((el) => add(el.getAttribute('href')));
      document.querySelectorAll('[data-project-id], [data-projectid], [data-id]').forEach((el) => {
        add(el.getAttribute('data-project-id'));
        add(el.getAttribute('data-projectid'));
        add(el.getAttribute('data-id'));
      });
      // Full HTML + any embedded JSON
      const html = document.documentElement.outerHTML || '';
      const re = /(?:project\/|projects\/|projectId["'\s:=]+)([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/gi;
      let m;
      while ((m = re.exec(html))) add(m[1]);
      return [...seen];
    });
    console.log(`[${this.accountId}] scraped ${ids.length} project(s) from flow.google.com`);
    return ids;
  }

  /** Create a project by clicking "+ New project" on flow.google.com (never labs.google). */
  async createProjectViaUi(name) {
    await this.navigate('https://flow.google.com/');
    await sleep(1500);
    const before = new Set(await this.scrapeProjects());

    const clicked = await this.page.evaluate(() => {
      const candidates = [...document.querySelectorAll('button, a, [role=button], div')];
      const el = candidates.find((e) => {
        const t = (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim();
        return /^\+?\s*New project$/i.test(t) || /new project/i.test(t) && t.length < 24;
      });
      if (!el) return false;
      const target = el.closest('button') || el.closest('a') || el.closest('[role=button]') || el;
      target.click();
      return true;
    });
    if (!clicked) {
      throw new Error('Could not find "+ New project" on flow.google.com — scrape existing projects instead');
    }
    await sleep(2500);
    // Dismiss name dialog if any by pressing Enter
    try {
      if (name) {
        await this.page.keyboard.type(String(name).slice(0, 40));
        await sleep(200);
      }
      await this.page.keyboard.press('Enter');
    } catch {
      /* ignore */
    }
    await sleep(2000);
    await this.navigate('https://flow.google.com/');
    await sleep(1500);
    const after = await this.scrapeProjects();
    const created = after.find((id) => !before.has(id));
    if (created) return created;
    // Sometimes still on new project page
    const ctx = await this.readContext();
    const fromUrl = projectFromHref(ctx.href);
    if (fromUrl && !before.has(fromUrl)) return fromUrl;
    throw new Error('New project click did not yield a new project id');
  }

  /**
   * Probe whether a project id still opens on Flow (not deleted / not redirected away).
   */
  async probeProjectAvailable(projectId) {
    const id = String(projectId || '').trim();
    if (!id || !this.page) return false;
    try {
      await this.navigate(`https://flow.google.com/project/${id}`);
      await sleep(900);
      const href = this.page.url() || '';
      if (/accounts\.google\.com|\/signin|\/about\b/i.test(href)) return false;
      const fromUrl = projectFromHref(href);
      if (fromUrl && fromUrl.toLowerCase() === id.toLowerCase()) return true;
      // Still on a project URL with this id in path
      if (new RegExp(`/project/${id}`, 'i').test(href)) return true;
      // Soft check: page shows project chrome rather than home grid only
      const ok = await this.page.evaluate((pid) => {
        const u = location.href || '';
        if (new RegExp(pid, 'i').test(u)) return true;
        const t = (document.body && document.body.innerText) || '';
        if (/project not found|couldn't find|does not exist|404/i.test(t)) return false;
        return /flow\.google\.com\/project\//i.test(u);
      }, id);
      return !!ok;
    } catch {
      return false;
    }
  }

  async ensureProjects(maxSlots) {
    const slots = Math.max(1, Number(maxSlots) || this.maxSlots || 5);
    this.maxSlots = slots;

    // 1) Live scrape from flow.google.com
    const scraped = await this.scrapeProjects();
    const scrapedSet = new Set(scraped.map((x) => String(x).toLowerCase()));
    console.log(`[${this.accountId}] ensure-projects: scraped ${scraped.length}, stored ${this.projectIds.length}, need ${slots}`);

    // 2) Re-check stored IDs missing from scrape (stale/deleted)
    const stored = [...new Set((this.projectIds || []).map((x) => String(x).trim()).filter(Boolean))];
    const missing = stored.filter((id) => !scrapedSet.has(id.toLowerCase()));
    const stillAlive = [];
    const probeCap = Math.min(20, missing.length);
    for (let i = 0; i < probeCap; i++) {
      const id = missing[i];
      const ok = await this.probeProjectAvailable(id);
      if (ok) stillAlive.push(id);
      else console.log(`[${this.accountId}] ensure-projects: dropped unavailable ${id}`);
    }
    // IDs beyond probe cap that weren't scraped are treated as dead when scrape returned a solid set
    if (missing.length > probeCap && scraped.length >= 3) {
      console.log(
        `[${this.accountId}] ensure-projects: skipping probe for ${missing.length - probeCap} extra stored id(s); scrape trusted`
      );
    }

    let ids = [...new Set([...scraped, ...stillAlive])];
    console.log(`[${this.accountId}] ensure-projects: alive ${ids.length} after validate`);

    // 3) Only create extras via Flow UI if short — never labs.google TRPC
    let guard = 0;
    while (ids.length < slots && guard < Math.min(5, slots - ids.length + 1)) {
      guard += 1;
      try {
        const created = await this.createProjectViaUi(`GF Slot ${ids.length + 1}`);
        if (created && !ids.includes(created)) ids.push(created);
      } catch (e) {
        console.warn(`[${this.accountId}] create via UI failed:`, e.message);
        break;
      }
      const again = await this.scrapeProjects();
      ids = [...new Set([...ids, ...again])];
    }

    if (!ids.length) {
      throw new Error(
        'No Flow projects found on flow.google.com. Open Flow home in the stream and confirm project cards are visible, then Ensure projects again.'
      );
    }

    this.projectIds = ids.slice(0, Math.max(slots, ids.length));
    if (this.projectIds[0]) {
      await this.navigate(`https://flow.google.com/project/${this.projectIds[0]}`);
      await sleep(1500);
    }
    await this.refreshAuthStatus();
    return this.publicStatus();
  }

  /**
   * Per-client inbound-input throttle: mouse-move is capped to ~1 per 16ms
   * (still feels smooth, avoids CDP flooding) and all input events combined
   * are capped at 200/s per client. Excess events are dropped silently.
   * State lives on the ws object itself — cheap, no extra bookkeeping.
   * Only gates inbound Input.* dispatch; screencast frame output is untouched.
   */
  _allowWsInput(ws, m) {
    if (!ws) return true;
    const now = Date.now();
    const rl = ws._inputRl || (ws._inputRl = { windowStart: now, count: 0, lastMove: 0 });
    if (now - rl.windowStart >= 1000) {
      rl.windowStart = now;
      rl.count = 0;
    }
    if (m.type === 'mouse' && m.event === 'mouseMoved') {
      if (now - rl.lastMove < 16) return false;
      rl.lastMove = now;
    }
    if (rl.count >= 200) return false;
    rl.count += 1;
    return true;
  }

  handleWsMessage(raw, ws) {
    if (!this.cdp) return;
    let m;
    try {
      m = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!this._allowWsInput(ws, m)) return;
    (async () => {
      try {
        if (m.type === 'mouse') {
          await this.cdp.send('Input.dispatchMouseEvent', {
            type: m.event,
            x: Math.round(m.x),
            y: Math.round(m.y),
            button: m.button || 'none',
            buttons: m.buttons || 0,
            clickCount: m.clickCount || 0,
          });
        } else if (m.type === 'wheel') {
          await this.cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            x: Math.round(m.x),
            y: Math.round(m.y),
            deltaX: m.deltaX || 0,
            deltaY: m.deltaY || 0,
          });
        } else if (m.type === 'text') {
          await this.cdp.send('Input.insertText', { text: String(m.text || '') });
        } else if (m.type === 'key') {
          const keyCode = Number(m.windowsVirtualKeyCode || m.nativeVirtualKeyCode || m.keyCode || 0);
          const text = typeof m.text === 'string' ? m.text : '';
          const eventType = m.event === 'keyUp' ? 'keyUp' : m.event === 'char' ? 'char' : 'keyDown';
          const common = {
            key: m.key || text || '',
            code: m.code || '',
            text: eventType === 'keyUp' ? '' : text,
            unmodifiedText: eventType === 'keyUp' ? '' : text || m.unmodifiedText || '',
            windowsVirtualKeyCode: keyCode,
            nativeVirtualKeyCode: keyCode,
          };

          // Printable chars: insertText is most reliable for Google login fields
          if (eventType === 'keyDown' && text && text.length === 1 && !m.code?.startsWith('Arrow')) {
            await this.cdp.send('Input.insertText', { text });
            return;
          }

          await this.cdp.send('Input.dispatchKeyEvent', { type: eventType, ...common });

          // If client only sent one "key" packet (legacy), also fire keyUp
          if (!m.event && eventType === 'keyDown') {
            await this.cdp.send('Input.dispatchKeyEvent', {
              type: 'keyUp',
              key: common.key,
              code: common.code,
              windowsVirtualKeyCode: keyCode,
              nativeVirtualKeyCode: keyCode,
            });
          }
        }
      } catch {
        /* ignore */
      }
    })();
  }

  _startHealthLoop() {
    this._stopHealthLoop();
    this._healthTimer = setInterval(() => {
      this.refreshAuthStatus()
        .then((st) => {
          // Only true cookie logout — missing WIZ `at` mid-nav is not auth-lost.
          if (
            st.hasWebSession === false &&
            this.wasReady &&
            !this.authLostNotified &&
            this.status !== 'STARTING'
          ) {
            this.authLostNotified = true;
            this.status = 'NEEDS_LOGIN';
            if (typeof AccountSession.onAuthLost === 'function') {
              AccountSession.onAuthLost(this.accountId, st);
            }
          }
        })
        .catch(() => {});

      // Every ~60s probe egress; if proxy tunnel is dead, rotate + relaunch
      this._proxyCheckTick = (this._proxyCheckTick || 0) + 1;
      if (this._proxyCheckTick % 4 === 0) {
        this._recoverDeadProxy().catch(() => {});
      }
    }, 15000);
  }

  /**
   * Detect mid-session proxy drop (tunnel dead / no exit IP) and self-heal:
   * assign a different unique proxy, then relaunch Chrome on the same profile.
   */
  async _recoverDeadProxy() {
    if (this._proxyRecovering || this.status === 'STARTING' || this.status === 'STOPPED') return;
    if (!this.browser) return;

    let assigned = null;
    try {
      assigned = await resolveEgressProxyUrl({ accountId: this.accountId, force: true });
    } catch {
      assigned = null;
    }
    if (!assigned) return;

    const info = await this.refreshEgressIp().catch(() => null);
    if (info && info.ip) {
      this._proxyFailStreak = 0;
      return;
    }

    this._proxyFailStreak = (this._proxyFailStreak || 0) + 1;
    console.warn(
      `[${this.accountId}] egress proxy looks dead (${this._proxyFailStreak}/2) — ${this.egressError || 'no exit IP'}`
    );
    if (this._proxyFailStreak < 2) return;

    this._proxyRecovering = true;
    try {
      clearEgressProxyCache();
      const next = rotateAccountProxy(this.accountId);
      console.warn(
        `[${this.accountId}] rotating dead proxy → ${next || 'none'} and relaunching (keep login)`
      );
      await this.disconnect({ clearProfile: false });
      await sleep(800);
      await this.launch();
      this._proxyFailStreak = 0;
    } catch (e) {
      console.warn(`[${this.accountId}] proxy recover failed:`, e.message || e);
    } finally {
      this._proxyRecovering = false;
    }
  }

  _stopHealthLoop() {
    if (this._healthTimer) {
      clearInterval(this._healthTimer);
      this._healthTimer = null;
    }
  }
}

AccountSession.onAuthLost = null;

module.exports = { AccountSession, PROFILES_ROOT };
