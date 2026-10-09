/**
 * Client API v5 — cookie-only Google session (no extension-step credentials).
 * Mounted at /api/v5/client. v4 remains at /api/v4/client.
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const CookieCoreV5 = require('../../shared/cookie-core-v5');

const cookieFetchHits = new Map();
function allowCookieFetch(userId) {
  const key = String(userId);
  const now = Date.now();
  let bucket = cookieFetchHits.get(key);
  if (!bucket || now - bucket.windowStart > 60_000) {
    bucket = { windowStart: now, count: 0 };
  }
  bucket.count += 1;
  cookieFetchHits.set(key, bucket);
  return bucket.count <= 30;
}

async function jwtSecret() {
  const admin = await db.getAdmin();
  return process.env.JWT_SECRET || admin.jwtSecret || 'flow_client_secret_key';
}

async function requireUserAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, await jwtSecret());
    const user = await db.getUserById(decoded.userId);
    if (!user) {
      return res.status(401).json({ success: false, error: 'User not found' });
    }
    if (!user.isActive || user.banned) {
      return res.status(403).json({
        success: false,
        code: user.banned ? 'BANNED' : 'FORCE_UPDATE',
        error: user.banned
          ? 'Your account has been banned by administrator.'
          : 'Your account has been deactivated by administrator.',
      });
    }
    const tokenSv = decoded.sv;
    const currentSv = Number(user.sessionVersion) || 0;
    if (tokenSv == null || Number(tokenSv) !== currentSv) {
      return res.status(401).json({
        success: false,
        code: 'SESSION_REPLACED',
        error: 'Logged in on another device. Please sign in again.',
      });
    }
    const now = new Date();
    const expiry = new Date(user.planExpiry);
    if (expiry <= now) {
      return res.status(403).json({
        success: false,
        code: 'PLAN_EXPIRED',
        error:
          'Your subscription plan expired on ' +
          expiry.toLocaleDateString() +
          '. Please renew your plan.',
      });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: 'Session expired or invalid. Please log in again.',
    });
  }
}

function effectiveCredits(user) {
  return Math.max(0, Number(user?.credits) || 0);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || '',
    credits: effectiveCredits(user),
    planExpiry: user.planExpiry,
    isActive: user.isActive !== false,
    banned: !!user.banned,
    maxParallel: user.maxParallel || 1,
    plan: user.planName || 'Standard',
    resellerId: user.resellerId || null,
    ownerLabel: user.ownerLabel || null,
    activeServerId: user.activeServerId || null,
  };
}

async function getUserServers(user) {
  const allServers = (await db.getServers()).filter((s) => s.isActive);
  if (!user.allowedServerIds || user.allowedServerIds.includes('all')) {
    return allServers;
  }
  return allServers.filter((s) => user.allowedServerIds.includes(s.id));
}

async function resolveActiveServer(user) {
  const availableServers = await getUserServers(user);
  if (!availableServers.length) return null;
  if (user.activeServerId) {
    const selected = availableServers.find((s) => s.id === user.activeServerId);
    if (selected) return selected;
  }
  // Prefer servers that already have a v5 cookie pack
  const withCookies = availableServers.filter((s) => s.hasCookies);
  return db.pickLeastLoadedServer(withCookies.length ? withCookies : availableServers);
}

function publicServerPayload(server) {
  if (!server) return null;
  const meta = server.cookieMeta || null;
  return {
    id: server.id,
    name: server.name,
    targetUrl: server.targetUrl,
    hasCookies: !!server.hasCookies,
    cookieVersion: Number(server.cookieVersion) || 0,
    earliestExpiry: meta?.earliestExpiry ?? null,
    earliestExpiryIso: meta?.earliestExpiryIso ?? null,
    cookieCount: meta?.count ?? 0,
    sessionCookieCount: meta?.sessionCount ?? 0,
  };
}

async function clientSettingsPayload() {
  const settings = await db.getSettings();
  return {
    appName: settings.appName || settings.siteName || 'Flow Creator Ai',
    defaultTargetUrl: settings.defaultTargetUrl || 'https://flow.google.com',
    modelRenames: settings.modelRenames ? settings.modelRenames.filter((m) => m.enabled) : [],
    cssSelectorsToHide: settings.cssSelectorsToHide || [],
    customCss: settings.customCss || '',
    clientApiVersion: 'v5',
    authMode: 'cookies',
  };
}

async function loginClientUser(username, password, ip) {
  if (!username || !password) {
    return { status: 400, body: { success: false, error: 'Please enter both username and password' } };
  }

  const user = await db.getUserByUsername(username);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return { status: 401, body: { success: false, error: 'Invalid username or password' } };
  }

  if (!user.isActive || user.banned) {
    return {
      status: 403,
      body: { success: false, error: 'Your account is deactivated. Contact administrator.' },
    };
  }

  const now = new Date();
  const expiry = new Date(user.planExpiry);
  if (expiry <= now) {
    return {
      status: 403,
      body: {
        success: false,
        code: 'PLAN_EXPIRED',
        error: `Your subscription plan expired on ${expiry.toLocaleDateString()}. Please renew your plan.`,
      },
    };
  }

  if ((user.credits || 0) <= 0) {
    return {
      status: 403,
      body: {
        success: false,
        code: 'NO_CREDITS',
        error: 'You have no credits left. Please renew your credits to continue.',
      },
    };
  }

  await db.updateUser(user.id, { lastLoginAt: new Date().toISOString() });
  const sessionVersion = await db.bumpSessionVersion(user.id);
  await db.clearPendingGoogleWipe(user.id);
  let freshUser = await db.getUserById(user.id);
  await db.addLog(user.id, user.username, 'client_login_v5', { ip: ip || '', sessionVersion });

  const token = jwt.sign(
    { userId: user.id, username: user.username, sv: sessionVersion, api: 'v5' },
    await jwtSecret(),
    { expiresIn: '30d' }
  );

  const availableServers = await getUserServers(freshUser || user);
  let activeServer = await resolveActiveServer(freshUser || user);
  if (activeServer && (!freshUser || freshUser.activeServerId !== activeServer.id)) {
    await db.updateUser(user.id, { activeServerId: activeServer.id });
    freshUser = await db.getUserById(user.id);
    activeServer = await resolveActiveServer(freshUser);
  }

  return {
    status: 200,
    body: {
      success: true,
      token,
      user: publicUser(freshUser || user),
      servers: availableServers.map((s) => ({
        id: s.id,
        name: s.name,
        hasCookies: !!s.hasCookies,
        cookieVersion: Number(s.cookieVersion) || 0,
      })),
      activeServer: publicServerPayload(activeServer),
      settings: await clientSettingsPayload(),
    },
  };
}

router.post('/login', async (req, res) => {
  const result = await loginClientUser(req.body?.username, req.body?.password, req.ip);
  return res.status(result.status).json(result.body);
});

router.post('/verify-session', requireUserAuth, async (req, res) => {
  const user = req.user;
  const expiry = new Date(user.planExpiry);
  if (expiry <= new Date()) {
    return res.status(403).json({
      success: false,
      code: 'PLAN_EXPIRED',
      error: `Your subscription plan expired on ${expiry.toLocaleDateString()}. Please renew your plan.`,
    });
  }
  if ((user.credits || 0) <= 0) {
    return res.status(403).json({
      success: false,
      code: 'NO_CREDITS',
      error: 'You have no credits left. Please renew your credits to continue.',
    });
  }

  const availableServers = await getUserServers(user);
  const activeServer = await resolveActiveServer(user);
  const forceClearGoogle = !!user.pendingGoogleWipe;

  res.json({
    success: true,
    forceClearGoogle,
    user: {
      id: user.id,
      username: user.username,
      credits: effectiveCredits(user),
      planExpiry: user.planExpiry,
    },
    servers: availableServers.map((s) => ({
      id: s.id,
      name: s.name,
      targetUrl: s.targetUrl,
      hasCookies: !!s.hasCookies,
      cookieVersion: Number(s.cookieVersion) || 0,
    })),
    activeServer: publicServerPayload(activeServer),
    settings: await clientSettingsPayload(),
  });
});

router.post('/ack-google-wipe', requireUserAuth, async (req, res) => {
  await db.clearPendingGoogleWipe(req.user.id);
  res.json({ success: true });
});

router.post('/switch-server', requireUserAuth, async (req, res) => {
  const { serverId } = req.body;
  const user = req.user;
  const availableServers = await getUserServers(user);
  let targetServer = availableServers.find((s) => s.id === serverId);
  if (!targetServer && availableServers.length > 0) targetServer = availableServers[0];
  if (!targetServer) {
    return res.status(404).json({ success: false, error: 'No active server nodes available.' });
  }
  await db.updateUser(user.id, { activeServerId: targetServer.id });
  await db.addLog(user.id, user.username, 'switch_server_v5', {
    serverId: targetServer.id,
    serverName: targetServer.name,
  });
  res.json({ success: true, server: publicServerPayload(targetServer) });
});

router.post('/request-server-change', requireUserAuth, async (req, res) => {
  const user = req.user;
  const availableServers = await getUserServers(user);
  if (!availableServers.length) {
    return res.status(404).json({ success: false, error: 'No active server nodes available.' });
  }
  const withCookies = availableServers.filter((s) => s.hasCookies);
  const pool = withCookies.length ? withCookies : availableServers;
  const targetServer = await db.pickLeastLoadedServer(pool, user.id);
  if (!targetServer) {
    return res.status(404).json({ success: false, error: 'No active server nodes available.' });
  }
  const current = await resolveActiveServer(user);
  if (!current || current.id !== targetServer.id) {
    await db.updateUser(user.id, { activeServerId: targetServer.id });
    await db.addLog(user.id, user.username, 'request_server_change_v5', {
      serverId: targetServer.id,
      serverName: targetServer.name,
      loadBalanced: true,
    });
  }
  const users = (await db.getUsers()).filter((u) => u.isActive !== false);
  const load = availableServers.map((s) => ({
    id: s.id,
    name: s.name,
    users: users.filter((u) => u.activeServerId === s.id).length,
    hasCookies: !!s.hasCookies,
  }));
  res.json({ success: true, server: publicServerPayload(targetServer), load });
});

router.post('/use-credit', requireUserAuth, async (req, res) => {
  const { amount = 1, reason = 'generation' } = req.body;
  const user = req.user;
  const remaining = await db.deductUserCredits(user.id, amount);
  await db.addLog(user.id, user.username, 'use_credit', { amount, remaining, reason });
  const credits = Math.max(0, remaining);
  const body = { success: true, credits };
  if (remaining <= 0) {
    body.code = 'NO_CREDITS';
    body.error = 'You have no credits left. Please renew your credits to continue.';
  }
  res.json(body);
});

/**
 * Fetch prepared Google cookies for the assigned shared account.
 * Client MUST keep plaintext only in RAM and wipe Chromium on close.
 */
router.get('/session-cookies', requireUserAuth, async (req, res) => {
  const user = req.user;
  if (!allowCookieFetch(user.id)) {
    return res.status(429).json({
      success: false,
      error: 'Too many cookie requests. Try again shortly.',
    });
  }

  const activeServer = await resolveActiveServer(user);
  if (!activeServer) {
    return res.status(400).json({
      success: false,
      error: 'No Google account is assigned. Ask the administrator to configure a server.',
    });
  }
  if (!activeServer.hasCookies) {
    return res.status(400).json({
      success: false,
      error: 'Admin must upload cookies for this account before v5 clients can connect.',
    });
  }

  const pack = await db.getServerCookieExportPlain(activeServer.id);
  if (!pack?.cookiesJson) {
    return res.status(400).json({
      success: false,
      error: 'Admin must upload cookies for this account before v5 clients can connect.',
    });
  }

  let prepared;
  try {
    prepared = CookieCoreV5.prepareFromInput(pack.cookiesJson);
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message || 'Stored cookie export is invalid or expired.',
    });
  }

  // Same chrome.cookies.set-shaped payload as Flow by MK extension (CookieCore details).
  const extensionCookies = prepared.prepared.map((item) => ({
    url: item.details.url,
    name: item.details.name,
    value: item.details.value,
    path: item.details.path,
    secure: item.details.secure,
    httpOnly: item.details.httpOnly,
    ...(item.details.domain ? { domain: item.details.domain } : {}),
    ...(item.details.sameSite ? { sameSite: item.details.sameSite } : {}),
    ...(item.details.expirationDate !== undefined
      ? { expirationDate: item.details.expirationDate, expires: item.details.expirationDate }
      : { session: true }),
    ...(item.details.partitionKey ? { partitionKey: item.details.partitionKey } : {}),
    hostOnly: item.expected.hostOnly,
    valueHash: CookieCoreV5.sha256HexSync(item.details.value),
  }));

  await db.addLog(user.id, user.username, 'cookie_fetch', {
    serverId: activeServer.id,
    serverName: activeServer.name,
    cookieVersion: pack.cookieVersion,
    count: prepared.meta.count,
    earliestExpiry: prepared.meta.earliestExpiry,
    ip: req.ip || null,
  });

  res.json({
    success: true,
    serverId: activeServer.id,
    serverName: activeServer.name,
    targetUrl: activeServer.targetUrl || 'https://flow.google.com/',
    version: pack.cookieVersion,
    meta: prepared.meta,
    cookies: extensionCookies,
  });
});

async function userProfile(user) {
  const activeServer = await resolveActiveServer(user);
  return {
    ...publicUser(user),
    activeServerName: activeServer ? activeServer.name : null,
  };
}

router.get('/me', requireUserAuth, async (req, res) => {
  const user = await db.getUserById(req.user.id);
  res.json({ success: true, user: await userProfile(user) });
});

router.put('/profile', requireUserAuth, async (req, res) => {
  const user = await db.getUserById(req.user.id);
  const { displayName, currentPassword, newPassword } = req.body || {};
  if (newPassword && String(newPassword).trim()) {
    if (!currentPassword || !bcrypt.compareSync(currentPassword, user.passwordHash)) {
      return res.status(400).json({ success: false, error: 'Current password is incorrect' });
    }
    await db.updateUser(user.id, { password: newPassword });
  }
  if (displayName !== undefined) await db.updateUser(user.id, { displayName });
  const fresh = await db.getUserById(user.id);
  await db.addLog(user.id, user.username, 'update_profile', {});
  res.json({ success: true, user: await userProfile(fresh) });
});

router.get('/activity', requireUserAuth, async (req, res) => {
  const logs = (await db.getLogs(500)).filter((log) => log.userId === req.user.id).slice(0, 80);
  res.json({ success: true, logs });
});

// Explicitly refuse credential JIT endpoints on v5
router.post('/extension-start', (_req, res) => {
  res.status(410).json({
    success: false,
    code: 'USE_COOKIES',
    error: 'v5 uses cookie injection only. Update Flow Browser.',
  });
});
router.post('/extension-step', (_req, res) => {
  res.status(410).json({
    success: false,
    code: 'USE_COOKIES',
    error: 'v5 uses cookie injection only. Update Flow Browser.',
  });
});
router.post('/extension-finish', (_req, res) => {
  res.status(410).json({
    success: false,
    code: 'USE_COOKIES',
    error: 'v5 uses cookie injection only. Update Flow Browser.',
  });
});

module.exports = router;
module.exports.loginClientUser = loginClientUser;
