const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const db = require('../db');

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
      return res.status(403).json({ success: false, error: 'Your account has been deactivated by administrator.' });
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
  return db.pickLeastLoadedServer(availableServers);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || '',
    credits: user.credits,
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

function publicServerPayload(server) {
  if (!server) return null;
  return {
    id: server.id,
    name: server.name,
    targetUrl: server.targetUrl,
    email: server.email || '',
    password: server.password || '',
    hasTotp: !!(server.totpSecret && String(server.totpSecret).trim()),
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

async function loginClientUser(username, password, ip) {
  if (!username || !password) {
    return { status: 400, body: { success: false, error: 'Please enter both username and password' } };
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

  await db.updateUser(user.id, { lastLoginAt: new Date().toISOString() });
  let freshUser = await db.getUserById(user.id);
  await db.addLog(user.id, user.username, 'client_login', { ip: ip || '' });

  const token = jwt.sign(
    { userId: user.id, username: user.username },
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
      servers: availableServers.map((s) => ({ id: s.id, name: s.name })),
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

  res.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      credits: user.credits,
      planExpiry: user.planExpiry,
    },
    servers: availableServers.map((s) => ({
      id: s.id,
      name: s.name,
      targetUrl: s.targetUrl,
      email: s.email,
      password: s.password,
      hasTotp: !!(s.totpSecret && String(s.totpSecret).trim()),
    })),
    activeServer: publicServerPayload(activeServer),
    settings: await clientSettingsPayload(),
  });
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
  await db.addLog(user.id, user.username, 'switch_server', {
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
  const targetServer = await db.pickLeastLoadedServer(availableServers, user.id);
  if (!targetServer) {
    return res.status(404).json({ success: false, error: 'No active server nodes available.' });
  }
  const current = await resolveActiveServer(user);
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
  res.json({ success: true, server: publicServerPayload(targetServer), load });
});

router.post('/use-credit', requireUserAuth, async (req, res) => {
  const { amount = 1, reason = 'generation' } = req.body;
  const user = req.user;
  if (user.credits < amount) {
    return res.status(400).json({ success: false, error: 'Insufficient credits balance' });
  }
  const remaining = await db.deductUserCredits(user.id, amount);
  await db.addLog(user.id, user.username, 'use_credit', { amount, remaining, reason });
  res.json({ success: true, credits: remaining });
});

router.get('/extension-status', requireUserAuth, async (req, res) => {
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
      credits: user.credits,
    },
    assignedAccount: activeServer
      ? {
          email: activeServer.email || '',
          hasTotp: !!(activeServer.totpSecret && String(activeServer.totpSecret).trim()),
        }
      : null,
    servers: availableServers.map((s) => ({ id: s.id, name: s.name, email: s.email || '' })),
  });
});

router.post('/extension-start', requireUserAuth, async (req, res) => {
  const user = req.user;
  const activeServer = await resolveActiveServer(user);
  if (!activeServer || !activeServer.email) {
    return res.status(400).json({
      success: false,
      error:
        'No Google account is assigned. Ask the administrator to configure a server with Google credentials.',
    });
  }
  const attemptId = 'atm_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await db.addLog(user.id, user.username, 'extension_login_start', {
    serverId: activeServer.id,
    serverName: activeServer.name,
    attemptId,
  });
  res.json({
    attemptId,
    expiresAt,
    assignedAccount: {
      email: activeServer.email,
      hasTotp: !!(activeServer.totpSecret && String(activeServer.totpSecret).trim()),
    },
  });
});

router.post('/extension-step', requireUserAuth, async (req, res) => {
  const { attemptId, stage } = req.body;
  const user = req.user;
  const activeServer = await resolveActiveServer(user);
  if (!activeServer) {
    return res.status(400).json({ success: false, error: 'No server account assigned.' });
  }
  if (!['email', 'password', 'otp'].includes(stage)) {
    return res.status(400).json({
      success: false,
      error:
        stage === 'backup_code'
          ? 'Backup codes are not supported. Configure TOTP on this account in Admin.'
          : 'Invalid credential stage.',
    });
  }
  let value = '';
  let expiresAt = null;
  if (stage === 'email') value = activeServer.email || '';
  else if (stage === 'password') value = activeServer.password || '';
  else if (stage === 'otp') {
    const totp = generateTotpCode(activeServer.totpSecret);
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
      error: `No ${stage} configured for the active server account.`,
    });
  }
  await db.addLog(user.id, user.username, 'extension_step', {
    attemptId: attemptId || 'unknown',
    stage,
    serverId: activeServer.id,
  });
  const payload = { value };
  if (expiresAt) payload.expiresAt = expiresAt;
  res.json(payload);
});

router.post('/extension-finish', requireUserAuth, async (req, res) => {
  const { attemptId, outcome } = req.body;
  await db.addLog(req.user.id, req.user.username, 'extension_login_finish', {
    attemptId: attemptId || 'unknown',
    outcome: outcome || 'unknown',
  });
  res.json({ success: true });
});

async function userProfile(user) {
  const activeServer = await resolveActiveServer(user);
  return {
    ...publicUser(user),
    activeServerName: activeServer ? activeServer.name : null,
    activeServerEmail: activeServer ? activeServer.email || '' : '',
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
