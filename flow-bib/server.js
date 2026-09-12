'use strict';

/**
 * Multi-account Flow BiB manager.
 * One Puppeteer Chrome per accountId — login + reCAPTCHA only.
 * Generation = server-side batchexecute POSTs (parallel across projects).
 */
const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const { AccountSession, PROFILES_ROOT } = require('./lib/AccountSession');
const {
  START_URL,
  projectFromHref,
  extractImageUrl,
  extractVideoUrl,
  extractPollId,
  extractCharacterEntityId,
  buildOgiRequest,
  buildBatch,
  payloadC4BZMd,
  payloadT2V,
  payloadI2V,
  normalizeCharacters,
  buildReferenceImagesPayload,
  buildStartImagePayload,
  extractSandboxMediaId,
  ogiHeaders,
  sleep,
  uid,
} = require('./lib/helpers');

const PORT = Number(process.env.BIB_PORT || process.env.PORT || 8010);
const NEXT_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_URL || 'http://127.0.0.1:3000';
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || process.env.JWT_SECRET || 'google-flow-saas-super-secret-jwt-key-2026-production-ready';
const STATE_FILE =
  process.env.BIB_STATE_FILE ||
  path.resolve(__dirname, '..', 'data', 'bib-autolaunch.json');
const AUTO_RESTORE = process.env.BIB_AUTO_RESTORE !== 'false';

const pool = new Map(); // accountId -> AccountSession

function getOrCreate(accountId, opts = {}) {
  if (!accountId) throw new Error('accountId required');
  let s = pool.get(accountId);
  if (!s) {
    s = new AccountSession(accountId, opts);
    pool.set(accountId, s);
  } else {
    if (opts.maxSlots) s.maxSlots = opts.maxSlots;
    if (Array.isArray(opts.projectIds)) s.projectIds = opts.projectIds;
    if (opts.profileDir) s.profileDir = opts.profileDir;
  }
  return s;
}

function readAutolaunchState() {
  try {
    const fs = require('fs');
    if (!fs.existsSync(STATE_FILE)) return { accounts: [] };
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return {
      accounts: Array.isArray(raw?.accounts) ? raw.accounts : [],
    };
  } catch {
    return { accounts: [] };
  }
}

function writeAutolaunchState() {
  try {
    const fs = require('fs');
    const pathMod = require('path');
    fs.mkdirSync(pathMod.dirname(STATE_FILE), { recursive: true });
    const accounts = [...pool.values()]
      .filter((s) => s.browser || s.status === 'READY' || s.status === 'NEEDS_LOGIN' || s.status === 'STARTING')
      .map((s) => ({
        id: s.accountId,
        maxSlots: s.maxSlots,
        projectIds: s.projectIds,
        profileDir: s.profileDir,
      }));
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({ updatedAt: new Date().toISOString(), accounts }, null, 2)
    );
  } catch (e) {
    console.warn('[state] write failed:', e.message);
  }
}

function rememberAccount(accountId, opts = {}) {
  const state = readAutolaunchState();
  const next = state.accounts.filter((a) => a.id !== accountId);
  next.push({
    id: accountId,
    maxSlots: opts.maxSlots,
    projectIds: opts.projectIds || [],
    profileDir: opts.profileDir,
  });
  try {
    const fs = require('fs');
    const pathMod = require('path');
    fs.mkdirSync(pathMod.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({ updatedAt: new Date().toISOString(), accounts: next }, null, 2)
    );
  } catch (e) {
    console.warn('[state] remember failed:', e.message);
  }
}

function forgetAccount(accountId) {
  const state = readAutolaunchState();
  const next = state.accounts.filter((a) => a.id !== accountId);
  try {
    const fs = require('fs');
    const pathMod = require('path');
    fs.mkdirSync(pathMod.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({ updatedAt: new Date().toISOString(), accounts: next }, null, 2)
    );
  } catch {
    /* ignore */
  }
}

async function launchAccountEntry(a) {
  const s = getOrCreate(a.id, {
    maxSlots: a.maxSlots,
    projectIds: a.projectIds,
    profileDir: a.profileDir,
  });
  const st = await s.launch();
  rememberAccount(a.id, {
    maxSlots: s.maxSlots,
    projectIds: s.projectIds,
    profileDir: s.profileDir,
  });
  return { id: a.id, ok: true, ...st };
}

/** Restore browsers after BiB process restart. */
async function autoRestoreAccounts() {
  if (!AUTO_RESTORE) {
    console.log('[auto-restore] skipped (BIB_AUTO_RESTORE=false)');
    return;
  }
  const fs = require('fs');
  const pathMod = require('path');
  const wanted = new Map();

  for (const a of readAutolaunchState().accounts) {
    if (a?.id) wanted.set(a.id, a);
  }

  // First boot / empty state: adopt every existing Chrome profile once
  if (!wanted.size) {
    try {
      const fs = require('fs');
      const pathMod = require('path');
      if (fs.existsSync(PROFILES_ROOT)) {
        for (const name of fs.readdirSync(PROFILES_ROOT)) {
          const full = pathMod.join(PROFILES_ROOT, name);
          if (!fs.statSync(full).isDirectory()) continue;
          wanted.set(name, { id: name, profileDir: full, maxSlots: 5, projectIds: [] });
        }
      }
    } catch (e) {
      console.warn('[auto-restore] profile scan failed:', e.message);
    }
  }

  if (!wanted.size) {
    console.log('[auto-restore] no saved accounts / profiles');
    return;
  }

  console.log(`[auto-restore] launching ${wanted.size} account browser(s)…`);
  for (const a of wanted.values()) {
    try {
      const r = await launchAccountEntry(a);
      console.log(`[auto-restore] ${a.id} → ${r.status || (r.ok ? 'ok' : 'fail')}`);
    } catch (e) {
      console.warn(`[auto-restore] ${a.id} failed:`, e.message);
    }
  }
  writeAutolaunchState();
}

async function notifyAuthLost(accountId, detail) {
  try {
    await fetch(`${NEXT_URL}/api/internal/provider-auth-lost`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': INTERNAL_SECRET,
      },
      body: JSON.stringify({ accountId, detail }),
    });
    console.log(`[auth-lost] notified Next for ${accountId}`);
  } catch (e) {
    console.warn(`[auth-lost] webhook failed:`, e.message);
  }
}

AccountSession.onAuthLost = (accountId, detail) => {
  notifyAuthLost(accountId, detail);
};

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    accounts: [...pool.keys()].map((id) => pool.get(id).publicStatus()),
    profilesRoot: PROFILES_ROOT,
  });
});

app.get('/accounts', (_req, res) => {
  res.json({ accounts: [...pool.values()].map((s) => s.publicStatus()) });
});

app.post('/accounts/:id/launch', async (req, res) => {
  try {
    const id = req.params.id;
    const st = await launchAccountEntry({
      id,
      maxSlots: req.body?.maxSlots,
      projectIds: req.body?.projectIds,
      profileDir: req.body?.profileDir,
    });
    res.json({ success: true, ...st });
  } catch (e) {
    console.error('launch', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/accounts/:id/disconnect', async (req, res) => {
  try {
    const s = pool.get(req.params.id);
    if (!s) {
      forgetAccount(req.params.id);
      return res.json({ success: true, status: 'STOPPED' });
    }
    const st = await s.disconnect({ clearProfile: !!req.body?.clearProfile });
    forgetAccount(req.params.id);
    writeAutolaunchState();
    res.json({ success: true, ...st });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/accounts/:id/status', async (req, res) => {
  try {
    const s = pool.get(req.params.id) || getOrCreate(req.params.id);
    if (s.browser) {
      const st = await s.refreshAuthStatus();
      return res.json(st);
    }
    res.json(s.publicStatus());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/accounts/:id/navigate', async (req, res) => {
  try {
    const s = pool.get(req.params.id);
    if (!s?.browser) return res.status(409).json({ error: 'Account browser not launched' });
    const out = await s.navigate(req.body?.url || START_URL);
    res.json({ success: true, ...out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/accounts/:id/ensure-projects', async (req, res) => {
  try {
    const s = pool.get(req.params.id);
    if (!s?.browser) return res.status(409).json({ error: 'Account browser not launched' });
    const auth = await s.refreshAuthStatus();
    if (!auth.authenticated && s.status !== 'READY') {
      return res.status(401).json({ error: 'Not logged in — complete BiB login first' });
    }
    const maxSlots = Number(req.body?.maxSlots) || s.maxSlots || 5;
    const st = await s.ensureProjects(maxSlots);
    res.json({ success: true, ...st });
  } catch (e) {
    console.error('ensure-projects', e);
    res.status(500).json({ error: e.message });
  }
});

/** Scrape existing flow.google.com project IDs only (no create). */
app.post('/accounts/:id/scrape-projects', async (req, res) => {
  try {
    const s = pool.get(req.params.id);
    if (!s?.browser) return res.status(409).json({ error: 'Account browser not launched' });
    const ids = await s.scrapeProjects();
    s.projectIds = [...new Set([...ids, ...s.projectIds])];
    if (s.projectIds[0]) {
      await s.navigate(`https://flow.google.com/project/${s.projectIds[0]}`);
    }
    await s.refreshAuthStatus();
    res.json({ success: true, ...s.publicStatus() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/accounts/:id/set-projects', (req, res) => {
  const s = getOrCreate(req.params.id);
  if (Array.isArray(req.body?.projectIds)) s.projectIds = req.body.projectIds.filter(Boolean);
  if (req.body?.maxSlots) s.maxSlots = Number(req.body.maxSlots);
  res.json({ success: true, ...s.publicStatus() });
});

app.get('/accounts/:id/export-cookies', async (req, res) => {
  try {
    const s = pool.get(req.params.id);
    if (!s?.browser) return res.status(409).json({ error: 'not launched' });
    // Warm aisandbox auth (API/sniff — never labs tools UI)
    if (req.query.warmLabs !== '0') {
      await s.ensureLabsSession({ force: true }).catch(() => null);
    }
    const ctx = await s.readContext();
    const { cookie, names } = await s.cookieHeaderFor(ctx.origin || 'https://flow.google.com');
    res.json({
      origin: ctx.origin,
      authenticated: !!ctx.at,
      cookieLength: cookie.length,
      cookie,
      at: ctx.at || '',
      bl: ctx.bl || '',
      sid: ctx.sid || '',
      hasLabsSession:
        names.has('__Secure-next-auth.session-token') || names.has('next-auth.session-token'),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Create a Google Flow character entity (C4BZMd) using the live BiB Flow page WIZ `at`.
 * Optional imageMediaId attaches an already-uploaded Flow image (no AI portrait gen).
 */
app.post('/create-character', async (req, res) => {
  const t0 = Date.now();
  try {
    const {
      accountId,
      name,
      displayName,
      projectId: preferredProject,
      imageMediaId,
      imageMediaIds,
    } = req.body || {};
    const charName = String(displayName || name || '').trim() || 'Untitled character';
    if (!accountId) return res.status(400).json({ error: 'accountId required' });

    const s = pool.get(accountId);
    if (!s?.browser) return res.status(409).json({ error: 'Account browser not launched' });
    if (s.status !== 'READY') {
      const auth = await s.refreshAuthStatus();
      if (!auth.authenticated) return res.status(401).json({ error: 'Account not logged in' });
    }

    let ctx = await s.readContext();
    if (!ctx.at) return res.status(401).json({ error: 'No WIZ at token — open a Flow project' });
    const projectId = s.pickProjectId(preferredProject) || projectFromHref(ctx.href);
    if (!projectId) return res.status(400).json({ error: 'No projectId available' });

    if (!projectFromHref(ctx.href) || projectFromHref(ctx.href) !== projectId) {
      await s.navigate(`https://flow.google.com/project/${projectId}`);
      await sleep(800);
      ctx = await s.readContext();
      if (!ctx.at) return res.status(401).json({ error: 'No WIZ at after project navigate' });
    }

    const mediaIds = [
      ...(Array.isArray(imageMediaIds) ? imageMediaIds : []),
      ...(imageMediaId ? [imageMediaId] : []),
    ]
      .map((x) => String(x || '').trim())
      .filter(Boolean);

    const { cookie } = await s.cookieHeaderFor(ctx.origin);
    const payload = payloadC4BZMd(projectId, charName, mediaIds);
    const sub = buildBatch(ctx, projectId, 'C4BZMd', payload);
    const sr = await fetch(sub.url, { method: 'POST', headers: ogiHeaders(ctx, cookie), body: sub.body });
    const stext = await sr.text();
    let flowEntityId = extractCharacterEntityId(stext, projectId);

    // Retry bare create if create-with-media failed to parse
    if (!flowEntityId && mediaIds.length) {
      const sub2 = buildBatch(ctx, projectId, 'C4BZMd', payloadC4BZMd(projectId, charName, []));
      const sr2 = await fetch(sub2.url, {
        method: 'POST',
        headers: ogiHeaders(ctx, cookie),
        body: sub2.body,
      });
      const text2 = await sr2.text();
      flowEntityId = extractCharacterEntityId(text2, projectId);
      if (!flowEntityId) {
        console.warn(`[${accountId}] create-character bare retry failed`, {
          http: sr2.status,
          preview: text2.slice(0, 400),
        });
      }
    }

    if (!flowEntityId) {
      console.warn(`[${accountId}] create-character no entity`, {
        http: sr.status,
        preview: stext.slice(0, 500),
      });
      return res.status(502).json({
        success: false,
        error: 'Character submitted but Flow entity id could not be parsed',
        httpStatus: sr.status,
        projectId,
        accountId,
        rawPreview: stext.slice(0, 500),
        ms: Date.now() - t0,
      });
    }

    console.log(
      `[${accountId}] create-character OK ${charName} → ${flowEntityId.slice(0, 8)}… media=${mediaIds[0] || 'none'}`
    );
    res.json({
      success: true,
      flowEntityId,
      characterId: flowEntityId,
      entity_id: flowEntityId,
      displayName: charName,
      imageMediaId: mediaIds[0] || null,
      projectId,
      accountId,
      httpStatus: sr.status,
      ms: Date.now() - t0,
    });
  } catch (e) {
    console.error('create-character', e);
    res.status(500).json({ error: e.message, ms: Date.now() - t0 });
  }
});

/** Force aisandbox Bearer mint (Flow sniff + labs NextAuth API — multi-ref / first+last). */
app.post('/accounts/:id/ensure-labs', async (req, res) => {
  try {
    const s = pool.get(req.params.id);
    if (!s?.browser) return res.status(409).json({ error: 'Account browser not launched' });
    const token = await s.fetchLabsAccessToken({ force: true });
    if (token) {
      const pid = s.projectIds[0];
      if (pid) {
        await s.navigate(`https://flow.google.com/project/${pid}`).catch(() => {});
      }
    }
    res.json({
      success: !!token,
      hasAccessToken: !!token,
      tokenPreview: token ? `${token.slice(0, 12)}…` : '',
      hint: token
        ? undefined
        : 'Open BiB viewer → Sign into Flow → Refresh aisandbox token until it turns green',
      ...s.publicStatus(),
    });
  } catch (e) {
    console.error('ensure-labs', e);
    res.status(500).json({ error: e.message });
  }
});

/** Single image generation via BiB (no CDP fetch). */
app.post('/generate', async (req, res) => {
  const t0 = Date.now();
  try {
    const {
      accountId,
      prompt,
      aspectRatio = '16:9',
      model = 'GEM_PIX_2',
      projectId: preferredProject,
      imageId,
      imageIds,
      characters,
      destinationCharacterId,
      destination_character_id,
    } = req.body || {};
    if (!accountId) return res.status(400).json({ error: 'accountId required' });
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    const s = pool.get(accountId);
    if (!s?.browser) return res.status(409).json({ error: 'Account browser not launched' });
    if (s.status !== 'READY') {
      const auth = await s.refreshAuthStatus();
      if (!auth.authenticated) return res.status(401).json({ error: 'Account not logged in' });
    }

    const ctx = await s.readContext();
    if (!ctx.at) return res.status(401).json({ error: 'No WIZ at token — open a Flow project' });
    const projectId = s.pickProjectId(preferredProject) || projectFromHref(ctx.href);
    if (!projectId) return res.status(400).json({ error: 'No projectId available' });

    // Ensure parked on a project page for mint
    if (!projectFromHref(ctx.href)) {
      await s.navigate(`https://flow.google.com/project/${projectId}`);
      await sleep(800);
    }

    const recaptcha = await s.mintRecaptcha('IMAGE_GENERATION');
    if (!recaptcha || recaptcha.length < 50) {
      return res.status(502).json({ error: 'reCAPTCHA mint failed' });
    }
    const freshCtx = await s.readContext();
    const { cookie } = await s.cookieHeaderFor(freshCtx.origin);
    const charRefs = normalizeCharacters(characters);
    const destCharId = String(
      destinationCharacterId || destination_character_id || ''
    ).trim();
    // T2I + character entities: structured prompt refs ONLY.
    // Do NOT inject character portrait mediaIds into imageSlot — that turns the
    // request into a broken I2I+character hybrid and Flow returns no image URL.
    const refIds = [
      ...(Array.isArray(imageIds) ? imageIds : []),
      ...(imageId ? [imageId] : []),
    ]
      .map((x) => String(x || '').trim())
      .filter(Boolean);
    const uniqueRefs = [...new Set(refIds)];
    if (charRefs.length) {
      console.log(
        `[${accountId}] T2I characters=${charRefs.map((c) => `${c.name}:${String(c.entity_id).slice(0, 8)}`).join(',')} refs=${uniqueRefs.length}`
      );
    }
    const { url, body, seed } = buildOgiRequest(
      freshCtx,
      projectId,
      prompt,
      String(model || 'GEM_PIX_2').toUpperCase(),
      aspectRatio,
      recaptcha,
      uniqueRefs,
      destCharId ? [] : charRefs,
      destCharId || undefined
    );
    const r = await fetch(url, { method: 'POST', headers: ogiHeaders(freshCtx, cookie), body });
    const text = await r.text();
    const imageUrl = extractImageUrl(text);
    const mediaId =
      (imageUrl && (imageUrl.match(/image\/([0-9a-f-]{36})/i) || [])[1]) ||
      extractPollId(text, projectId);
    if (!imageUrl && !mediaId) {
      // Surface Flow/WIZ errors instead of opaque "No image URL"
      const quota =
        /PER_MODEL_DAILY_QUOTA|QUOTA_REACHED|RESOURCE_EXHAUSTED/i.test(text) &&
        'Google daily quota reached for this image model';
      const wrbErr = /\[\[\"e\",\s*(\d+)/.exec(text);
      const emptyChar =
        charRefs.length > 0 && /wrb\.fr","ogiZ0b",null/.test(text)
          ? 'Flow rejected character image request — check character is synced in this project'
          : null;
      const errMsg =
        quota ||
        emptyChar ||
        (wrbErr ? `Flow batchexecute error e=${wrbErr[1]}` : null) ||
        'No image URL in response';
      console.warn(
        `[${accountId}] image generate: ${errMsg} chars=${charRefs.length} refs=${uniqueRefs.length} http=${r.status}`,
        text.slice(0, 400)
      );
      return res.status(502).json({
        success: false,
        httpStatus: r.status,
        error: errMsg,
        raw: text.slice(0, 600),
        durationMs: Date.now() - t0,
        projectId,
        characterCount: charRefs.length,
        characterIds: charRefs.map((c) => c.entity_id),
      });
    }
    res.json({
      success: true,
      status: imageUrl ? 'COMPLETED' : 'PROCESSING',
      imageUrl: imageUrl || null,
      url: imageUrl || null,
      mediaId: mediaId || null,
      seed,
      projectId,
      accountId,
      httpStatus: r.status,
      durationMs: Date.now() - t0,
      assets: imageUrl
        ? [{ url: imageUrl, id: mediaId, status: 'COMPLETED' }]
        : [{ id: mediaId, status: 'PROCESSING' }],
    });
  } catch (e) {
    console.error('generate', e);
    res.status(500).json({ error: e.message, durationMs: Date.now() - t0 });
  }
});

/** Parallel batch across projects (pre-mint serial, POST parallel). */
app.post('/batch-run', async (req, res) => {
  const t0 = Date.now();
  try {
    const {
      accountId,
      projects,
      prompts,
      model = 'GEM_PIX_2',
      aspectRatio = '16:9',
      staggerMs = 8,
      tasks: bodyTasks,
    } = req.body || {};
    if (!accountId) return res.status(400).json({ error: 'accountId required' });
    const s = pool.get(accountId);
    if (!s?.browser) return res.status(409).json({ error: 'Account browser not launched' });

    const ctx = await s.readContext();
    if (!ctx.at) return res.status(401).json({ error: 'not logged in' });
    const { cookie } = await s.cookieHeaderFor(ctx.origin);

    let tasks = [];
    if (Array.isArray(bodyTasks) && bodyTasks.length) {
      tasks = bodyTasks.map((t) => ({ pid: t.pid || t.projectId, prompt: t.prompt }));
    } else {
      const pids = Array.isArray(projects) && projects.length ? projects : s.projectIds;
      const prs = Array.isArray(prompts) ? prompts : [];
      if (!pids.length || !prs.length) {
        return res.status(400).json({ error: 'projects[]+prompts[] or tasks[] required' });
      }
      for (const pid of pids) for (const prompt of prs) tasks.push({ pid, prompt });
    }

    console.log(`[${accountId}] batch: minting ${tasks.length} tokens…`);
    for (const t of tasks) t.token = await s.mintRecaptcha('IMAGE_GENERATION');
    const minted = tasks.filter((t) => t.token && t.token.length > 50).length;

    const results = await Promise.all(
      tasks.map((t, i) =>
        (async () => {
          await sleep(i * staggerMs);
          const start = Date.now();
          try {
            if (!t.token || t.token.length < 50) {
              return { pid: t.pid, prompt: t.prompt, ok: false, error: 'empty recaptcha', ms: 0 };
            }
            const { url, body, seed } = buildOgiRequest(ctx, t.pid, t.prompt, model, aspectRatio, t.token);
            const r = await fetch(url, { method: 'POST', headers: ogiHeaders(ctx, cookie), body });
            const text = await r.text();
            const imageUrl = extractImageUrl(text);
            return {
              pid: t.pid,
              prompt: t.prompt,
              ok: !!imageUrl,
              imageUrl,
              httpStatus: r.status,
              seed,
              ms: Date.now() - start,
            };
          } catch (e) {
            return { pid: t.pid, prompt: t.prompt, ok: false, error: e.message, ms: Date.now() - start };
          }
        })()
      )
    );
    const ok = results.filter((r) => r.ok).length;
    res.json({
      model,
      aspectRatio,
      totalMs: Date.now() - t0,
      tokensMinted: minted,
      ok,
      count: results.length,
      results,
    });
  } catch (e) {
    console.error('batch', e);
    res.status(500).json({ error: e.message, totalMs: Date.now() - t0 });
  }
});

app.post('/generate-video', async (req, res) => {
  const t0 = Date.now();
  try {
    const {
      accountId,
      mode = 't2v',
      prompt,
      imagePrompt,
      imageId: bodyImageId,
      startImageId,
      endImageId,
      lastImageId,
      imageIds,
      characters,
      videoModel,
      aspect = 2,
      aspectRatio,
      // Keep initial wait short — Next.js polls /video-status while Flow finishes
      pollMs = 4000,
      maxPolls = 3,
      projectId: preferredProject,
      waitForCompletion = false,
    } = req.body || {};
    if (!accountId) return res.status(400).json({ error: 'accountId required' });
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    const s = pool.get(accountId);
    if (!s?.browser) return res.status(409).json({ error: 'Account browser not launched' });

    let ctx = await s.readContext();
    if (!ctx.at) return res.status(401).json({ error: 'not logged in' });
    const projectId = s.pickProjectId(preferredProject) || projectFromHref(ctx.href);
    if (!projectId) return res.status(400).json({ error: 'no projectId' });

    // reCAPTCHA mint requires a project page
    if (!projectFromHref(ctx.href) || projectFromHref(ctx.href) !== projectId) {
      await s.navigate(`https://flow.google.com/project/${projectId}`);
      await sleep(800);
      ctx = await s.readContext();
    }

    let { cookie } = await s.cookieHeaderFor(ctx.origin);
    let hdr = ogiHeaders(ctx, cookie);
    const stages = {};
    let imageUrl = null;
    const charRefs = normalizeCharacters(characters);
    const endId = String(endImageId || lastImageId || '').trim() || null;
    const extraIds = (Array.isArray(imageIds) ? imageIds : [])
      .map((x) => String(x || '').trim())
      .filter(Boolean);
    const portraitIds = charRefs.map((c) => c.image_media_id).filter(Boolean);
    // Prefer an existing Flow media id (ingredients / frames / I2V) — never invent via T2I
    let imageId = String(bodyImageId || startImageId || '').trim() || null;

    if ((mode === 'i2v' || mode === 'r2v') && !imageId && !endId && !extraIds.length && !portraitIds.length && !charRefs.length) {
      // Legacy path: no ref provided — generate a starter still, then animate
      const rc = await s.mintRecaptcha('IMAGE_GENERATION');
      if (!rc || rc.length < 50) return res.status(502).json({ error: 'reCAPTCHA mint failed' });
      const { url, body } = buildOgiRequest(
        ctx,
        projectId,
        imagePrompt || prompt,
        'GEM_PIX_2',
        '16:9',
        rc,
        [],
        []
      );
      const r = await fetch(url, { method: 'POST', headers: hdr, body });
      const text = await r.text();
      imageUrl = extractImageUrl(text);
      imageId = imageUrl && (imageUrl.match(/image\/([0-9a-f-]{36})/i) || [])[1];
      stages.image = { ok: !!imageUrl, ms: Date.now() - t0 };
      if (!imageId) {
        return res.status(502).json({
          success: false,
          stage: 'image',
          error: 'I2V source image failed',
          raw: text.slice(0, 500),
        });
      }
    } else if (imageId || endId || extraIds.length) {
      stages.image = {
        ok: true,
        reused: true,
        imageId,
        endId,
        extra: extraIds.length,
        ms: Date.now() - t0,
      };
    }

    const model = videoModel || (mode === 'i2v' || mode === 'r2v' ? 'veo_3_1_r2v_lite' : 'veo_3_1_t2v_lite');
    const aspectLabel =
      aspectRatio || (aspect === 1 ? '9:16' : aspect === 3 ? '1:1' : '16:9');

    // Multi-ref / first+last → aisandbox. Do NOT merge character portraits into
    // refMedia (they stay on charRefs / MZZa6b entity slots). Silent MZZa6b
    // single-frame fallback is forbidden for multi-ref — that drops images.
    const refMedia = [
      ...(imageId ? [imageId] : []),
      ...(endId && endId !== imageId ? [endId] : []),
      ...extraIds,
    ].filter(Boolean);
    const uniqueRefMedia = [...new Set(refMedia)];
    const hasFirstLast = Boolean(imageId && endId && imageId !== endId);
    const needsSandbox = uniqueRefMedia.length > 1 || hasFirstLast;

    let mediaId = null;
    let videoUrl = null;

    if (needsSandbox) {
      const sandboxModel = String(model).includes('r2v')
        ? model
        : String(model).replace(/t2v_/g, 'r2v_').replace(/i2v_/g, 'r2v_');
      const payload = buildReferenceImagesPayload(
        projectId,
        prompt,
        sandboxModel,
        aspectLabel,
        uniqueRefMedia,
        '' // token filled inside aisandboxPost
      );
      try {
        const data = await s.aisandboxPost(
          'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoReferenceImages',
          payload,
          'VIDEO_GENERATION'
        );
        mediaId = extractSandboxMediaId(data);
        stages.submit = {
          rpcid: 'aisandbox_ReferenceImages',
          model: sandboxModel,
          mediaId,
          refs: uniqueRefMedia.length,
          ms: Date.now() - t0,
        };
      } catch (sandboxErr) {
        const sandboxMsg = String(sandboxErr.message || sandboxErr);
        // First+last: try StartImage+endImage once (still multi-frame, not single MZZa6b)
        if (imageId && endId && imageId !== endId) {
          try {
            const startPayload = buildStartImagePayload(
              projectId,
              prompt,
              sandboxModel,
              aspectLabel,
              imageId,
              endId,
              ''
            );
            const data = await s.aisandboxPost(
              'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoStartImage',
              startPayload,
              'VIDEO_GENERATION'
            );
            mediaId = extractSandboxMediaId(data);
            stages.submit = {
              rpcid: 'aisandbox_StartImage',
              model: sandboxModel,
              mediaId,
              ms: Date.now() - t0,
              fallbackFrom: sandboxMsg.slice(0, 120),
            };
          } catch (e2) {
            stages.sandboxError = String(e2.message || e2).slice(0, 160);
            throw e2;
          }
        }
        // Multi-ref must fail closed — never silently animate only the first image
        if (!mediaId) {
          stages.sandboxError = sandboxMsg.slice(0, 160);
          throw sandboxErr;
        }
      }
    } else {
      const rc2 = await s.mintRecaptcha('VIDEO_GENERATION');
      if (!rc2 || rc2.length < 50) return res.status(502).json({ error: 'reCAPTCHA mint failed (video)' });
      const rpcid = mode === 'i2v' ? 'MZZa6b' : 'YhhmEf';
      const payload =
        mode === 'i2v'
          ? payloadI2V(projectId, prompt, imageId, model, aspect, rc2, charRefs)
          : payloadT2V(projectId, prompt, model, aspect, rc2, charRefs);
      const sub = buildBatch(ctx, projectId, rpcid, payload);
      const sr = await fetch(sub.url, { method: 'POST', headers: hdr, body: sub.body });
      const stext = await sr.text();
      mediaId = extractPollId(stext, projectId);
      videoUrl = extractVideoUrl(stext);
      stages.submit = {
        rpcid,
        model,
        httpStatus: sr.status,
        mediaId,
        hasUrl: !!videoUrl,
        chars: charRefs.length,
        ms: Date.now() - t0,
        rawPreview: mediaId || videoUrl ? undefined : stext.slice(0, 500),
      };
    }

    if (!mediaId && !videoUrl) {
      console.warn(`[${accountId}] video submit: no mediaId`, stages);
      return res.status(502).json({
        success: false,
        stage: 'submit',
        error: 'Video submitted but mediaId could not be parsed — check Flow project',
        imageUrl,
        stages,
        ms: Date.now() - t0,
        projectId,
        accountId,
      });
    }

    const pollsAllowed = waitForCompletion ? Math.max(maxPolls, 45) : maxPolls;
    let polls = 0;
    for (; polls < pollsAllowed && !videoUrl && mediaId; polls++) {
      await sleep(pollMs);
      if (polls > 0 && polls % 5 === 0) {
        ctx = await s.readContext();
        ({ cookie } = await s.cookieHeaderFor(ctx.origin));
        hdr = ogiHeaders(ctx, cookie);
      }
      // jwpduf job poll
      const p = buildBatch(ctx, projectId, 'jwpduf', [null, null, [[mediaId]]]);
      const pr = await fetch(p.url, { method: 'POST', headers: hdr, body: p.body });
      const pt = await pr.text();
      videoUrl = extractVideoUrl(pt);
      if (videoUrl) break;
      // as29s media status (Python also uses this)
      const a = buildBatch(ctx, projectId, 'as29s', [mediaId]);
      const ar = await fetch(a.url, { method: 'POST', headers: hdr, body: a.body });
      const at = await ar.text();
      videoUrl = extractVideoUrl(at);
    }

    if (videoUrl) {
      return res.json({
        success: true,
        status: 'COMPLETED',
        mode,
        model,
        imageUrl,
        mediaId,
        videoUrl,
        url: videoUrl,
        polls,
        stages,
        ms: Date.now() - t0,
        projectId,
        accountId,
      });
    }

    // Return PROCESSING so Next can keep polling — Flow may still be rendering
    console.log(`[${accountId}] video PROCESSING mediaId=${mediaId} polls=${polls}`);
    return res.json({
      success: true,
      status: 'PROCESSING',
      mode,
      model,
      imageUrl,
      mediaId,
      videoUrl: null,
      url: null,
      polls,
      stages,
      ms: Date.now() - t0,
      projectId,
      accountId,
    });
  } catch (e) {
    console.error('video', e);
    res.status(500).json({ error: e.message, ms: Date.now() - t0 });
  }
});

/** Native Flow 1080p upsample via aisandbox (BiB page mint — no Python CDP). */
app.post('/upsample-video', async (req, res) => {
  const t0 = Date.now();
  try {
    const {
      accountId,
      mediaId,
      projectId: preferredProject,
      aspectRatio = '16:9',
      videoModel,
    } = req.body || {};
    if (!accountId || !mediaId) {
      return res.status(400).json({ error: 'accountId and mediaId required' });
    }
    const s = pool.get(accountId);
    if (!s?.browser) return res.status(409).json({ error: 'Account browser not launched' });

    let ctx = await s.readContext();
    if (!ctx.at) return res.status(401).json({ error: 'not logged in' });
    const projectId = s.pickProjectId(preferredProject) || projectFromHref(ctx.href);
    if (!projectId) return res.status(400).json({ error: 'no projectId' });
    if (!projectFromHref(ctx.href) || projectFromHref(ctx.href) !== projectId) {
      await s.navigate(`https://flow.google.com/project/${projectId}`);
      await sleep(800);
    }

    const aspectEnum =
      aspectRatio === '9:16'
        ? 'VIDEO_ASPECT_RATIO_PORTRAIT'
        : aspectRatio === '1:1'
          ? 'VIDEO_ASPECT_RATIO_SQUARE'
          : 'VIDEO_ASPECT_RATIO_LANDSCAPE';
    const reqItem = {
      videoInput: { mediaId },
      resolution: 'VIDEO_RESOLUTION_1080P',
      aspectRatio: aspectEnum,
      seed: Math.floor(Math.random() * 900000) + 10000,
      metadata: { sceneId: uid() },
    };
    if (videoModel) reqItem.videoModelKey = videoModel;
    const payload = {
      mediaGenerationContext: { batchId: `bib-upsample-${Date.now()}` },
      clientContext: {
        projectId,
        tool: 'PINHOLE',
        recaptchaContext: {
          token: '',
          applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB',
        },
      },
      requests: [reqItem],
      useV2ModelConfig: true,
    };

    const data = await s.aisandboxPost(
      'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoUpsampleVideo',
      payload,
      'VIDEO_GENERATION'
    );
    let outMediaId = extractSandboxMediaId(data);
    if (!outMediaId && Array.isArray(data.media) && data.media[0]) {
      outMediaId = data.media[0].name || data.media[0].mediaId;
    }

    let videoUrl = null;
    if (outMediaId) {
      ctx = await s.readContext();
      const { cookie } = await s.cookieHeaderFor(ctx.origin);
      const hdr = ogiHeaders(ctx, cookie);
      for (let i = 0; i < 12 && !videoUrl; i++) {
        await sleep(2500);
        const p = buildBatch(ctx, projectId, 'jwpduf', [null, null, [[outMediaId]]]);
        const pr = await fetch(p.url, { method: 'POST', headers: hdr, body: p.body });
        videoUrl = extractVideoUrl(await pr.text());
        if (videoUrl) break;
        const a = buildBatch(ctx, projectId, 'as29s', [outMediaId]);
        const ar = await fetch(a.url, { method: 'POST', headers: hdr, body: a.body });
        videoUrl = extractVideoUrl(await ar.text());
      }
    }

    res.json({
      success: true,
      status: videoUrl ? 'COMPLETED' : 'PROCESSING',
      mediaId: outMediaId,
      videoUrl,
      url: videoUrl,
      projectId,
      accountId,
      ms: Date.now() - t0,
      raw: videoUrl ? undefined : data,
    });
  } catch (e) {
    console.error('upsample', e);
    res.status(502).json({ error: e.message, ms: Date.now() - t0 });
  }
});

/** One-shot poll for a submitted video mediaId (jwpduf + as29s). */
app.post('/video-status', async (req, res) => {
  try {
    const { accountId, mediaId, projectId: preferredProject } = req.body || {};
    if (!accountId || !mediaId) {
      return res.status(400).json({ error: 'accountId and mediaId required' });
    }
    const s = pool.get(accountId);
    if (!s?.browser) return res.status(409).json({ error: 'Account browser not launched' });
    const ctx = await s.readContext();
    if (!ctx.at) return res.status(401).json({ error: 'not logged in' });
    const projectId =
      preferredProject || s.pickProjectId(preferredProject) || projectFromHref(ctx.href);
    if (!projectId) return res.status(400).json({ error: 'no projectId' });
    const { cookie } = await s.cookieHeaderFor(ctx.origin);
    const hdr = ogiHeaders(ctx, cookie);

    const p = buildBatch(ctx, projectId, 'jwpduf', [null, null, [[mediaId]]]);
    const pr = await fetch(p.url, { method: 'POST', headers: hdr, body: p.body });
    const pt = await pr.text();
    let videoUrl = extractVideoUrl(pt);
    let imageUrl = extractImageUrl(pt);
    if (!videoUrl && !imageUrl) {
      const a = buildBatch(ctx, projectId, 'as29s', [mediaId]);
      const ar = await fetch(a.url, { method: 'POST', headers: hdr, body: a.body });
      const at = await ar.text();
      videoUrl = extractVideoUrl(at);
      imageUrl = extractImageUrl(at);
    }

    const mediaUrl = videoUrl || imageUrl;
    if (mediaUrl) {
      return res.json({
        success: true,
        status: 'COMPLETED',
        videoUrl: videoUrl || null,
        imageUrl: imageUrl || null,
        url: mediaUrl,
        mediaId,
        projectId,
        accountId,
      });
    }
    return res.json({
      success: true,
      status: 'PROCESSING',
      videoUrl: null,
      imageUrl: null,
      mediaId,
      projectId,
      accountId,
    });
  } catch (e) {
    console.error('video-status', e);
    res.status(500).json({ error: e.message });
  }
});

/** Auto-launch many accounts on boot (called by startup script). */
app.post('/bootstrap', async (req, res) => {
  const list = Array.isArray(req.body?.accounts) ? req.body.accounts : [];
  const results = [];
  for (const a of list) {
    try {
      results.push(await launchAccountEntry(a));
    } catch (e) {
      results.push({ id: a.id, ok: false, error: e.message });
    }
  }
  writeAutolaunchState();
  res.json({ success: true, results });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const m = url.pathname.match(/^\/ws\/([^/]+)$/);
  if (!m) {
    socket.destroy();
    return;
  }
  const accountId = decodeURIComponent(m[1]);
  wss.handleUpgrade(req, socket, head, (ws) => {
    const s = pool.get(accountId) || getOrCreate(accountId);
    s.wsClients.add(ws);
    if (s.latestFrame) {
      try {
        ws.send(JSON.stringify({ type: 'frame', data: s.latestFrame }));
      } catch {
        /* ignore */
      }
    }
    ws.on('message', (raw) => s.handleWsMessage(raw));
    ws.on('close', () => s.wsClients.delete(ws));
  });
});

let closing = false;
async function gracefulClose(code = 0) {
  if (closing) return;
  closing = true;
  console.log('[*] Closing all BiB browsers…');
  for (const s of pool.values()) {
    try {
      await s.disconnect({ clearProfile: false });
    } catch {
      /* ignore */
    }
  }
  process.exit(code);
}
process.on('SIGINT', () => gracefulClose(0));
process.on('SIGTERM', () => gracefulClose(0));
app.post('/shutdown', async (_req, res) => {
  res.json({ ok: true });
  gracefulClose(0);
});

server.listen(PORT, () => {
  console.log(`[✓] Flow BiB multi-account manager on http://127.0.0.1:${PORT}`);
  console.log(`    profiles: ${PROFILES_ROOT}`);
  console.log(`    state: ${STATE_FILE}`);
  // Ensure Chrome exists, then restore sessions
  setTimeout(() => {
    const { ensureChrome } = require('./lib/ensureChrome');
    ensureChrome()
      .then(() => autoRestoreAccounts())
      .catch((e) => {
        console.warn('[chrome/auto-restore]', e.message);
      });
  }, 500);
});
