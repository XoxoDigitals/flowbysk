/**
 * Flow Browser client API v11 — SHA-256 Authenticode / Keystore digital signature attestation
 * + traditional Google credential login + 60m post-login lock.
 * Mounted at /api/v11/client. All previous API versions (v2–v10) → 410 FORCE_UPDATE.
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const db = require('../db');
const { openFromStorage } = require('../secretsCrypto');
const credChannel = require('../credChannel');
const { allowExtensionStep } = credChannel;
const { requireAppDeviceAttestation, requireClientIntegrityMiddleware } = require('../deviceSecurity');
const { lookupCountry, clientIpFromReq } = require('../geoIp');

const GOOGLE_SESSION_LOCK_MS = 60 * 60 * 1000; // 60 minutes per server account after successful Google login

function googleLockState(user, serverId) {
  const now = Date.now();
  const rawMap =
    user && user.googleServerLocks && typeof user.googleServerLocks === 'object'
      ? user.googleServerLocks
      : {};
  const serverLocks = {};
  for (const [sid, iso] of Object.entries(rawMap)) {
    const ms = iso ? new Date(iso).getTime() : 0;
    if (Number.isFinite(ms) && ms > now) {
      serverLocks[sid] = {
        locked: true,
        lockedUntil: new Date(ms).toISOString(),
        retryAfterSeconds: Math.max(1, Math.ceil((ms - now) / 1000)),
      };
    }
  }
  const targetSrvId = String(serverId || user?.activeServerId || '').trim();
  const entry = targetSrvId ? serverLocks[targetSrvId] : null;
  if (!entry) {
    return {
      locked: false,
      lockedUntil: null,
      retryAfterSeconds: 0,
      serverId: targetSrvId || null,
      serverLocks,
    };
  }
  return {
    locked: true,
    lockedUntil: entry.lockedUntil,
    retryAfterSeconds: entry.retryAfterSeconds,
    serverId: targetSrvId,
    serverLocks,
  };
}

function googleLockResponse(state) {
  return {
    success: false,
    code: 'GOOGLE_SESSION_LOCKED',
    error: 'This account is locked for 1 hour after login. Switch to another server or wait for the timer.',
    serverId: state.serverId || null,
    lockedUntil: state.lockedUntil,
    retryAfterSeconds: state.retryAfterSeconds,
    googleServerLocks: state.serverLocks || {},
    serverTime: new Date().toISOString(),
  };
}

/** Keep admin "last IP / country / device / client" current on every app contact. */
async function touchDevice(user, req) {
  try {
    const client = parseFlowClientHeader(req);
    const deviceId = String(req?.body?.deviceId || req?.headers?.['x-flow-device-id'] || '').trim();
    const ip = clientIpFromReq(req) || '';
    const patch = {};
    if (client && client !== user.lastClient) patch.lastClient = client;
    if (ip && ip !== user.lastIp) {
      patch.lastIp = ip;
      const country = await lookupCountry(ip);
      if (country) patch.country = country;
    }
    if (deviceId && deviceId !== user.lastDeviceId) {
      patch.lastDeviceId = deviceId;
      const ids = Array.isArray(user.deviceIds) ? [...user.deviceIds] : [];
      if (!ids.includes(deviceId)) ids.push(deviceId);
      patch.deviceIds = ids.slice(-20);
    }
    if (Object.keys(patch).length) await db.updateUser(user.id, patch);
  } catch (err) {
    console.warn('[touchDevice]', err.message);
  }
}

function parseFlowClientHeader(req) {
  const h = String(req?.headers?.['x-flow-client'] || '').trim();
  return /^(windows-exe|android)\//i.test(h) ? h : '';
}

async function assertNotGoogleSessionLocked(user, res, serverId) {
  const state = googleLockState(user, serverId);
  if (!state.locked) return true;
  res.status(429).json(googleLockResponse(state));
  return false;
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
        error: 'Your subscription plan expired on ' + expiry.toLocaleDateString() + '. Please renew your plan.',
      });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Session expired or invalid. Please log in again.' });
  }
}

/** Combined middleware for v11 app routes: requires both cryptographic binary signature AND valid user JWT */
const requireSignedAppUser = [requireClientIntegrityMiddleware, requireUserAuth];

function effectiveCredits(user) {
  return Math.max(0, Number(user?.credits) || 0);
}

function publicUser(user, serverId) {
  const lock = googleLockState(user, serverId);
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
    googleSessionLockUntil: lock.locked ? lock.lockedUntil : null,
    googleSessionLocked: !!lock.locked,
    googleSessionRetryAfterSeconds: lock.retryAfterSeconds || 0,
    googleServerLocks: lock.serverLocks || {},
    serverTime: new Date().toISOString(),
  };
}

async function getUserServers(user) {
  const allServers = (await db.getServers()).filter((s) => s.isActive);
  if (!user.allowedServerIds || user.allowedServerIds.includes('all')) {
    return allServers;
  }
  return allServers.filter((s) => s.imageOnly || user.allowedServerIds.includes(s.id));
}

async function resolveActiveServer(user) {
  const availableServers = await getUserServers(user);
  if (!availableServers.length) return null;
  if (user.activeServerId) {
    const selected = availableServers.find((s) => s.id === user.activeServerId);
    if (selected) return selected;
  }
  const standardServers = availableServers.filter((s) => !s.imageOnly);
  return db.pickLeastLoadedServer(standardServers.length ? standardServers : availableServers);
}

function publicServerPayload(server) {
  if (!server) return null;
  // Never send Google password/TOTP or full email — email only via sealed extension-step
  return {
    id: server.id,
    name: server.name,
    targetUrl: server.targetUrl,
    emailMasked: credChannel.maskEmail(server.email || ''),
    hasTotp: !!(server.totpSecret && String(server.totpSecret).trim()),
    imageOnly: !!server.imageOnly,
    accountType: server.imageOnly ? 'image' : 'all',
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
    clientApiVersion: 'v11',
    authMode: 'credentials',
  };
}

function generateTotpCode(secret) {
  const normalized = String(secret || '').replace(/\s+/g, '').toUpperCase();
  if (!normalized) return null;
  const code = authenticator.generate(normalized);
  const remaining = authenticator.timeRemaining();
  const expiresAt = new Date(Date.now() + remaining * 1000).toISOString();
  return { value: code, expiresAt, expiresInSeconds: remaining };
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.requireDeviceAttestation=true] — EXE/APK only. Web portal must pass false.
 */
async function loginClientUser(username, password, ip, req, opts = {}) {
  if (!username || !password) {
    return { status: 400, body: { success: false, error: 'Please enter both username and password' } };
  }

  const requireDevice = opts.requireDeviceAttestation !== false;
  const clientIp = clientIpFromReq(req) || String(ip || '').trim();
  const country = await lookupCountry(clientIp);
  const attestation = requireDevice
    ? requireAppDeviceAttestation(req || { headers: {}, body: {} })
    : { ok: true, skipped: true, deviceId: null, client: null };

  if (!attestation.ok) {
    return {
      status: 403,
      body: {
        success: false,
        code: attestation.code || 'TAMPERED_CLIENT',
        error: attestation.error || 'Official untampered Flow Browser v11 client required.',
        autoBanned: false,
      },
    };
  }

  const user = await db.getUserByUsername(username);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return { status: 401, body: { success: false, error: 'Invalid username or password' } };
  }

  if (!user.isActive || user.banned) {
    return { status: 403, body: { success: false, error: 'Your account is deactivated. Contact administrator.' } };
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

  // EXE (attested) must open a sealed credential channel. Web portal may omit.
  let channel = null;
  if (req?.body?.clientPublicKey) {
    try {
      channel = credChannel.createChannel(user.id, req.body.clientPublicKey, req || { headers: {}, ip });
    } catch (err) {
      return {
        status: err.status || 400,
        body: {
          success: false,
          code: 'CHANNEL_REQUIRED',
          error: err.message || 'Invalid clientPublicKey.',
        },
      };
    }
  } else if (requireDevice) {
    return {
      status: 400,
      body: {
        success: false,
        code: 'CHANNEL_REQUIRED',
        error: 'Secure channel required. Update Flow Browser.',
      },
    };
  }

  const knownDevices = Array.isArray(user.deviceIds) ? [...user.deviceIds] : [];
  if (attestation.deviceId && !knownDevices.includes(attestation.deviceId)) {
    knownDevices.push(attestation.deviceId);
  }
  await db.updateUser(user.id, {
    lastLoginAt: new Date().toISOString(),
    lastIp: clientIp || null,
    country: country || null,
    ...(attestation.deviceId
      ? { lastDeviceId: attestation.deviceId, deviceIds: knownDevices.slice(-20) }
      : {}),
    ...(attestation.client ? { lastClient: attestation.client } : {}),
  });
  const sessionVersion = await db.bumpSessionVersion(user.id);
  await db.clearPendingGoogleWipe(user.id);
  let freshUser = await db.getUserById(user.id);
  await db.addLog(user.id, user.username, 'client_login', {
    ip: clientIp || '',
    country: country || null,
    sessionVersion,
    channelId: channel?.channelId || null,
    deviceId: attestation.deviceId || null,
    client: attestation.client || null,
    binHash: attestation.binHash || null,
  });

  const token = jwt.sign(
    {
      userId: user.id,
      username: user.username,
      sv: sessionVersion,
      ...(channel ? { ch: channel.channelId } : {}),
    },
    await jwtSecret(),
    { expiresIn: '12h' }
  );

  const availableServers = await getUserServers(freshUser || user);
  const standardServers = availableServers.filter((s) => !s.imageOnly);
  let activeServer = await resolveActiveServer(freshUser || user);
  if (activeServer && activeServer.imageOnly && standardServers.length > 0) {
    activeServer = await db.pickLeastLoadedServer(standardServers, user.id);
  }
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
        targetUrl: s.targetUrl,
        imageOnly: !!s.imageOnly,
        accountType: s.imageOnly ? 'image' : 'all',
      })),
      activeServer: publicServerPayload(activeServer),
      settings: await clientSettingsPayload(),
      serverTime: Date.now(),
      ...(channel
        ? {
            channel: {
              channelId: channel.channelId,
              serverPublicKey: channel.serverPublicKey,
              expiresInSeconds: channel.expiresInSeconds,
            },
          }
        : {}),
    },
  };
}

router.get('/config', requireClientIntegrityMiddleware, async (req, res) => {
  try {
    res.json({
      success: true,
      settings: await clientSettingsPayload(),
      serverTime: Date.now(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/login', async (req, res) => {
  const result = await loginClientUser(req.body?.username, req.body?.password, req.ip, req, {
    requireDeviceAttestation: true,
  });
  return res.status(result.status).json(result.body);
});

/** Re-key secure channel for an existing session (after EXE restart with saved JWT). */
router.post('/channel-open', ...requireSignedAppUser, async (req, res) => {
  try {
    await touchDevice(req.user, req);
    const channel = credChannel.createChannel(req.user.id, req.body?.clientPublicKey, req);
    res.json({
      success: true,
      serverTime: Date.now(),
      channel: {
        channelId: channel.channelId,
        serverPublicKey: channel.serverPublicKey,
        expiresInSeconds: channel.expiresInSeconds,
      },
    });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

router.post('/verify-session', ...requireSignedAppUser, async (req, res) => {
  const user = req.user;
  await touchDevice(user, req);
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
  const lock = googleLockState(user, activeServer?.id);

  res.json({
    success: true,
    forceClearGoogle,
    user: {
      id: user.id,
      username: user.username,
      credits: effectiveCredits(user),
      planExpiry: user.planExpiry,
      googleSessionLocked: lock.locked,
      googleSessionRetryAfterSeconds: lock.retryAfterSeconds || 0,
      googleServerLocks: lock.serverLocks || {},
      serverTime: new Date().toISOString(),
    },
    servers: availableServers.map((s) => ({
      id: s.id,
      name: s.name,
      targetUrl: s.targetUrl,
      emailMasked: credChannel.maskEmail(s.email),
      hasTotp: !!(s.totpSecret && String(s.totpSecret).trim()),
      imageOnly: !!s.imageOnly,
      accountType: s.imageOnly ? 'image' : 'all',
    })),
    activeServer: publicServerPayload(activeServer),
    settings: await clientSettingsPayload(),
  });
});

router.post('/ack-google-wipe', ...requireSignedAppUser, async (req, res) => {
  await db.clearPendingGoogleWipe(req.user.id);
  res.json({ success: true });
});

router.post('/switch-server', ...requireSignedAppUser, async (req, res) => {
  const { serverId } = req.body;
  const user = req.user;
  const availableServers = await getUserServers(user);
  let targetServer = availableServers.find((s) => s.id === serverId);
  if (!targetServer && availableServers.length > 0) targetServer = availableServers[0];
  if (!targetServer) {
    return res.status(404).json({ success: false, error: 'No active server nodes available.' });
  }
  await db.updateUser(user.id, { activeServerId: targetServer.id });
  await db.addLog(user.id, user.username, 'switch_server', {
    serverId: targetServer.id,
    serverName: targetServer.name,
  });
  const freshUser = await db.getUserById(user.id);
  res.json({
    success: true,
    server: publicServerPayload(targetServer),
    user: publicUser(freshUser || user, targetServer.id),
  });
});

router.post('/request-server-change', ...requireSignedAppUser, async (req, res) => {
  const user = req.user;
  const availableServers = await getUserServers(user);
  if (!availableServers.length) {
    return res.status(404).json({ success: false, error: 'No active server nodes available.' });
  }
  const standardServers = availableServers.filter((s) => !s.imageOnly);
  const basePool = standardServers.length ? standardServers : availableServers;
  const current = await resolveActiveServer(user);
  const unlockedOtherServers = basePool.filter(
    (s) => (!current || s.id !== current.id) && !googleLockState(user, s.id).locked
  );
  const unlockedAnyServers = basePool.filter((s) => !googleLockState(user, s.id).locked);
  const candidatePool = unlockedOtherServers.length
    ? unlockedOtherServers
    : unlockedAnyServers.length
      ? unlockedAnyServers
      : basePool;
  const targetServer = await db.pickLeastLoadedServer(candidatePool, user.id);
  if (!targetServer) {
    return res.status(404).json({ success: false, error: 'No active server nodes available.' });
  }
  if (!current || current.id !== targetServer.id) {
    await db.updateUser(user.id, { activeServerId: targetServer.id });
    await db.addLog(user.id, user.username, 'request_server_change', {
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
    hasTotp: !!(s.totpSecret && String(s.totpSecret).trim()),
  }));
  const freshUser = await db.getUserById(user.id);
  res.json({
    success: true,
    server: publicServerPayload(targetServer),
    user: publicUser(freshUser || user, targetServer.id),
    load,
  });
});

router.post('/refund-credit', ...requireSignedAppUser, async (req, res) => {
  const { amount = 1, reason = 'refund_failed_generation' } = req.body;
  const user = req.user;
  const remaining = typeof db.refundUserCredits === 'function'
    ? await db.refundUserCredits(user.id, amount)
    : (Number(user.credits) || 0) + Math.abs(Number(amount) || 0);
  await db.addLog(user.id, user.username, 'refund_credit', { amount, remaining, reason });
  const credits = Math.max(0, remaining);
  res.json({ success: true, credits });
});

router.post('/use-credit', ...requireSignedAppUser, async (req, res) => {
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

router.get('/extension-status', ...requireSignedAppUser, async (req, res) => {
  const user = req.user;
  const availableServers = await getUserServers(user);
  const activeServer = await resolveActiveServer(user);
  const now = Date.now();
  const expiry = new Date(user.planExpiry).getTime();
  const daysRemaining = Math.max(0, Math.ceil((expiry - now) / (1000 * 60 * 60 * 24)));
  res.json({
    connected: true,
    user: {
      name: user.username,
      username: user.username,
      plan: daysRemaining > 0 ? 'Active' : 'Expired',
      planExpiresAt: user.planExpiry,
      daysRemaining,
      credits: effectiveCredits(user),
    },
    assignedAccount: activeServer
      ? {
          emailMasked: credChannel.maskEmail(activeServer.email || ''),
          hasTotp: !!(activeServer.totpSecret && String(activeServer.totpSecret).trim()),
        }
      : null,
    servers: availableServers.map((s) => ({
      id: s.id,
      name: s.name,
      emailMasked: credChannel.maskEmail(s.email || ''),
      imageOnly: !!s.imageOnly,
      accountType: s.imageOnly ? 'image' : 'all',
    })),
  });
});

router.post('/extension-start', ...requireSignedAppUser, async (req, res) => {
  const user = req.user;
  const requestedServerId = String(req.body?.serverId || '').trim();
  const availableServers = await getUserServers(user);
  let activeServer = requestedServerId
    ? availableServers.find((s) => s.id === requestedServerId) || null
    : null;
  if (!activeServer) {
    activeServer = await resolveActiveServer(user);
  } else if (user.activeServerId !== activeServer.id) {
    await db.updateUser(user.id, { activeServerId: activeServer.id });
    user.activeServerId = activeServer.id;
  }
  if (!activeServer || !activeServer.email) {
    return res.status(400).json({
      success: false,
      error:
        'No Google account is assigned. Ask the administrator to configure a server with Google credentials.',
    });
  }
  const channelId = String(req.body?.channelId || '').trim();
  const channel = credChannel.getChannel(channelId, user.id, req);
  if (!channel) {
    return res.status(401).json({
      success: false,
      code: 'CHANNEL_REQUIRED',
      error: 'Open a secure channel first (login or /channel-open).',
    });
  }
  const attempt = credChannel.createAttempt(user.id, activeServer.id, channelId, req);
  await db.addLog(user.id, user.username, 'extension_login_start', {
    serverId: activeServer.id,
    serverName: activeServer.name,
    attemptId: attempt.attemptId,
    channelId,
  });
  res.json({
    attemptId: attempt.attemptId,
    expiresAt: attempt.expiresAt,
    serverTime: Date.now(),
    assignedAccount: {
      emailMasked: credChannel.maskEmail(activeServer.email),
      hasTotp: !!(activeServer.totpSecret && String(activeServer.totpSecret).trim()),
    },
  });
});

router.post('/extension-step', ...requireSignedAppUser, async (req, res) => {
  const { attemptId, stage, channelId, ts, mac } = req.body || {};
  const user = req.user;
  const activeServer = await resolveActiveServer(user);
  const stageKey = String(stage || '');
  if (!allowExtensionStep(user.id, stageKey)) {
    return res.status(429).json({ success: false, error: 'Too many credential requests. Try again shortly.' });
  }
  if (!['email', 'password', 'otp'].includes(stageKey)) {
    return res.status(400).json({
      success: false,
      error:
        stageKey === 'backup_code'
          ? 'Backup codes are not supported. Configure TOTP on this account in Admin.'
          : 'Invalid credential stage.',
    });
  }
  const channel = credChannel.getChannel(String(channelId || ''), user.id, req);
  if (!channel) {
    return res.status(401).json({
      success: false,
      code: 'CHANNEL_REQUIRED',
      error: 'Valid secure channel required.',
    });
  }
  if (!credChannel.verifyRequestMac(channel.aesKey, { channelId, attemptId, stage: stageKey, ts, mac })) {
    return res.status(403).json({
      success: false,
      code: 'BAD_MAC',
      serverTime: Date.now(),
      error: 'Request signature invalid or expired.',
    });
  }
  const taken = credChannel.takeAttemptStage(String(attemptId || ''), user.id, stageKey, String(channelId || ''));
  if (!taken.ok) {
    return res.status(400).json({ success: false, error: taken.error });
  }
  if (!activeServer || activeServer.id !== taken.attempt.serverId) {
    return res.status(400).json({ success: false, error: 'No server account assigned.' });
  }
  const googlePassword = openFromStorage(activeServer.password);
  const totpSecret = openFromStorage(activeServer.totpSecret);
  let value = '';
  let expiresAt = null;
  if (stageKey === 'email') value = activeServer.email || '';
  else if (stageKey === 'password') value = googlePassword || '';
  else if (stageKey === 'otp') {
    const totp = generateTotpCode(totpSecret);
    if (!totp) {
      return res.status(400).json({
        success: false,
        error: 'TOTP is not configured for this Google account. Add the authenticator secret in Admin.',
      });
    }
    value = totp.value;
    expiresAt = totp.expiresAt;
  }
  if (!value) {
    return res.status(400).json({
      success: false,
      error: `No ${stageKey} configured for the active server account.`,
    });
  }
  await db.addLog(user.id, user.username, 'extension_step', {
    attemptId,
    stage: stageKey,
    serverId: activeServer.id,
    serverName: activeServer.name,
    channelId,
    sealed: true,
    ip: req.ip || null,
  });
  const sealed = credChannel.sealValue(channel.aesKey, value);
  const payload = {
    sealed: true,
    alg: sealed.alg,
    nonce: sealed.nonce,
    ciphertext: sealed.ciphertext,
  };
  if (expiresAt) payload.expiresAt = expiresAt;
  res.json(payload);
});

router.post('/extension-finish', ...requireSignedAppUser, async (req, res) => {
  const { attemptId, outcome, serverId } = req.body || {};
  const normalizedOutcome = String(outcome || 'unknown').toLowerCase();
  const targetSrvId = String(serverId || req.user.activeServerId || '').trim();
  const targetServer = targetSrvId ? await db.getServerById(targetSrvId).catch(() => null) : null;
  const details = {
    attemptId: attemptId || 'unknown',
    outcome: normalizedOutcome,
    serverId: targetSrvId || null,
    serverName: targetServer ? targetServer.name : null,
  };

  const isRestoredSession = String(attemptId || '') === 'restored-session';
  const isImageOnlyTarget = !!(targetServer && targetServer.imageOnly);
  if (normalizedOutcome === 'success' && targetSrvId && !isRestoredSession && !isImageOnlyTarget) {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const existingIso =
      req.user.googleServerLocks && typeof req.user.googleServerLocks === 'object'
        ? req.user.googleServerLocks[targetSrvId]
        : null;
    const existingMs = existingIso ? new Date(existingIso).getTime() : 0;
    const lockedUntil =
      Number.isFinite(existingMs) && existingMs > nowMs
        ? new Date(existingMs).toISOString()
        : new Date(nowMs + GOOGLE_SESSION_LOCK_MS).toISOString();
    const nextServerLocks = {
      ...(req.user.googleServerLocks && typeof req.user.googleServerLocks === 'object'
        ? req.user.googleServerLocks
        : {}),
      [targetSrvId]: lockedUntil,
    };
    const nextAttemptsByServer = {
      ...(req.user.lastGoogleAttemptsByServer && typeof req.user.lastGoogleAttemptsByServer === 'object'
        ? req.user.lastGoogleAttemptsByServer
        : {}),
      [targetSrvId]: { attemptId: attemptId || null, at: nowIso },
    };
    await db.updateUser(req.user.id, {
      googleSessionLockUntil: lockedUntil,
      googleServerLocks: nextServerLocks,
      lastGoogleAttemptsByServer: nextAttemptsByServer,
      lastGoogleLoginAt: nowIso,
      lastGoogleAttemptId: attemptId || null,
    });
    details.lockedUntil = lockedUntil;
    details.lockMinutes = Math.round(GOOGLE_SESSION_LOCK_MS / 60000);
  }

  await db.addLog(req.user.id, req.user.username, 'extension_login_finish', details);
  const fresh = await db.getUserById(req.user.id);
  res.json({
    success: true,
    user: publicUser(fresh || req.user, targetSrvId),
  });
});

async function userProfile(user) {
  const activeServer = await resolveActiveServer(user);
  return {
    ...publicUser(user),
    activeServerName: activeServer ? activeServer.name : null,
    activeServerEmailMasked: activeServer ? credChannel.maskEmail(activeServer.email || '') : '',
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

module.exports = router;
module.exports.loginClientUser = loginClientUser;

