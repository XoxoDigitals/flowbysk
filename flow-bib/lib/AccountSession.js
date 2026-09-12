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

const HEADLESS = process.env.HEADLESS === 'false' ? false : true;
const PROFILES_ROOT =
  process.env.BIB_PROFILES_DIR || path.resolve(__dirname, '..', '..', 'data', 'bib-profiles');

class AccountSession {
  constructor(accountId, opts = {}) {
    this.accountId = accountId;
    this.profileDir = opts.profileDir || path.join(PROFILES_ROOT, accountId);
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
    if (this.screencasting || !this.cdp) return;
    this.screencasting = true;
    this._lastFrameAt = 0;
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

    // Headless Chrome often sends no CDP screencast frames — fall back to screenshots
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

    const chromePath = findChrome();
    if (!chromePath) {
      const tip =
        'Chrome not found. On the server run: cd /opt/flowbysk/flow-bib && npm run install:chrome';
      this.status = 'ERROR';
      this.lastError = tip;
      throw new Error(tip);
    }

    try {
      this.browser = await puppeteer.launch({
        headless: HEADLESS,
        executablePath: chromePath,
        userDataDir: this.profileDir,
        defaultViewport: { width: VIEW_W, height: VIEW_H },
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-blink-features=AutomationControlled',
          `--window-size=${VIEW_W},${VIEW_H}`,
        ],
      });
      this.browser.on('disconnected', () => {
        console.warn(`[${this.accountId}] browser disconnected`);
        this.browser = null;
        this.page = null;
        this.cdp = null;
        this.screencasting = false;
        if (this.status !== 'STOPPED') this.status = 'STOPPED';
      });
    } catch (e) {
      this.status = 'ERROR';
      this.lastError = e.message || String(e);
      this.browser = null;
      throw e;
    }

    const pages = await this.browser.pages();
    this.page = pages[0] || (await this.browser.newPage());
    await this.page.setUserAgent(UA);
    this.cdp = await this.page.target().createCDPSession();
    await this._installBearerSniff();
    await this.page
      .goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
      .catch((e) => console.warn(`[${this.accountId}] nav:`, e.message));
    await this.startScreencast();

    const st = await this.refreshAuthStatus();
    this._startHealthLoop();
    return st;
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

  async mintRecaptcha(action = 'IMAGE_GENERATION') {
    if (!this.page) throw new Error('Browser not launched');

    const ensureProjectPage = async () => {
      const ctx = await this.readContext();
      let pid = projectFromHref(ctx.href);
      if (!pid) {
        pid = this.projectIds[0] || null;
        if (pid) {
          await this.navigate(`https://flow.google.com/project/${pid}`);
          await sleep(1200);
        }
      }
      return pid;
    };

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
          // grecaptcha not ready — reload project page
          const ctx = await this.readContext();
          const pid = projectFromHref(ctx.href) || this.projectIds[0];
          if (pid) {
            await this.navigate(`https://flow.google.com/project/${pid}`);
          } else {
            await this.page.reload({ waitUntil: 'domcontentloaded' });
          }
          await sleep(1500);
        }

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
                // Some Flow builds accept the action without enterprise wrapper quirks on retry
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
        console.warn(`[${this.accountId}] reCAPTCHA mint error attempt ${attempt}:`, e.message);
      }
      await sleep(800 * attempt);
    }
    return '';
  }

  /**
   * Sniff Authorization Bearer from Flow → aisandbox-pa traffic.
   * labs.google/fx/tools/flow permanently redirects to flow.google.com — never warm via that UI.
   */
  async _installBearerSniff() {
    if (!this.cdp || this._bearerSniffInstalled) return;
    this._bearerSniffInstalled = true;
    try {
      await this.cdp.send('Network.enable');
    } catch {
      /* ignore */
    }
    this.cdp.on('Network.requestWillBeSent', (ev) => {
      try {
        const url = ev?.request?.url || '';
        if (!/aisandbox-pa\.googleapis\.com/i.test(url)) return;
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
      } catch {
        /* ignore */
      }
    });
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
   */
  async aisandboxPost(endpoint, payload, action = 'VIDEO_GENERATION') {
    if (!this.page) throw new Error('no page');
    const projectId =
      projectFromHref((await this.readContext()).href) || this.projectIds[0] || '';

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

    if (projectId && !/flow\.google\.com\/project\//i.test(this.page.url() || '')) {
      await this.navigate(`https://flow.google.com/project/${projectId}`);
      await sleep(800);
    } else if (!/flow\.google\.com/i.test(this.page.url() || '')) {
      await this.navigate(projectId ? `https://flow.google.com/project/${projectId}` : START_URL);
      await sleep(800);
    }

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

    const result = await this.page.evaluate(
      async (ep, bodyJson, bearer) => {
        try {
          const r = await fetch(ep, {
            method: 'POST',
            headers: {
              'Content-Type': 'text/plain;charset=UTF-8',
              Authorization: 'Bearer ' + bearer,
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
      accessToken
    );

    let data = null;
    try {
      data = JSON.parse(result.text || '{}');
    } catch {
      data = { raw: String(result.text || '').slice(0, 400) };
    }
    if (!result.status || result.status >= 400) {
      if (result.status === 401) this._labsTokenCache = null;
      const msg =
        (data && (data.error || data.message || data.status)) ||
        String(result.text || '').slice(0, 240);
      throw new Error(`aisandbox ${result.status}: ${msg}`);
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
      } else if (this.browser) {
        this.status = 'NEEDS_LOGIN';
      }

      const projectId = projectFromHref(ctx.href);
      return {
        ...this.publicStatus(),
        url: ctx.href,
        origin: ctx.origin,
        authenticated: !!ctx.at && hasWeb,
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
    };
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

  async ensureProjects(maxSlots) {
    const slots = Math.max(1, Number(maxSlots) || this.maxSlots || 5);
    this.maxSlots = slots;

    // 1) Fetch existing projects from flow.google.com (preferred)
    let ids = [...new Set([...(await this.scrapeProjects()), ...this.projectIds])];
    console.log(`[${this.accountId}] ensure-projects: found ${ids.length}, need ${slots}`);

    // 2) Only create extras via Flow UI if short — never labs.google TRPC
    let guard = 0;
    while (ids.length < slots && guard < Math.min(5, slots - ids.length + 1)) {
      guard += 1;
      try {
        const created = await this.createProjectViaUi(`GF Slot ${ids.length + 1}`);
        if (created && !ids.includes(created)) ids.push(created);
      } catch (e) {
        console.warn(`[${this.accountId}] create via UI failed:`, e.message);
        break; // keep whatever we scraped
      }
      const scraped = await this.scrapeProjects();
      ids = [...new Set([...ids, ...scraped])];
    }

    if (!ids.length) {
      throw new Error(
        'No Flow projects found on flow.google.com. Open Flow home in the stream and confirm project cards are visible, then Ensure projects again.'
      );
    }

    // Use all scraped projects (up to a generous cap); prefer filling slots
    this.projectIds = ids.slice(0, Math.max(slots, ids.length));
    // Park on first project so reCAPTCHA can mint
    if (this.projectIds[0]) {
      await this.navigate(`https://flow.google.com/project/${this.projectIds[0]}`);
      await sleep(1500);
    }
    await this.refreshAuthStatus();
    return this.publicStatus();
  }

  handleWsMessage(raw) {
    if (!this.cdp) return;
    let m;
    try {
      m = JSON.parse(raw.toString());
    } catch {
      return;
    }
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
          await this.cdp.send('Input.insertText', { text: m.text });
        } else if (m.type === 'key') {
          const common = {
            key: m.key,
            code: m.code,
            windowsVirtualKeyCode: m.keyCode,
            nativeVirtualKeyCode: m.keyCode,
          };
          await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...common });
          await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
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
          if (st.status === 'NEEDS_LOGIN' || (!st.authenticated && this.status !== 'STOPPED')) {
            if (this.wasReady && !this.authLostNotified && this.status !== 'STARTING') {
              this.authLostNotified = true;
              this.status = 'NEEDS_LOGIN';
              if (typeof AccountSession.onAuthLost === 'function') {
                AccountSession.onAuthLost(this.accountId, st);
              }
            }
          }
        })
        .catch(() => {});
    }, 15000);
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
