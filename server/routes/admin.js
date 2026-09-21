const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const db = require('../db');
const downloads = require('../downloads');
const { hardcodedStdForPlanName, HARDCODED_STD_CREDITS } = require('../planCredits');

downloads.ensureDirs();

const uploadTemp = multer({
  dest: path.join(__dirname, '..', 'uploads', 'tmp'),
  limits: { fileSize: 1024 * 1024 * 1024 },
});

async function jwtSecret() {
  const admin = await db.getAdmin();
  return process.env.JWT_SECRET || admin.jwtSecret || 'flow_admin_secret_key';
}

function normalizeTotpSecret(value) {
  if (!value || typeof value !== 'string') return '';
  return value.replace(/\s+/g, '').toUpperCase();
}

function currentTotp(secret) {
  const normalized = normalizeTotpSecret(secret);
  if (!normalized) return { totpCode: null, totpExpiresInSeconds: null };
  try {
    return {
      totpCode: authenticator.generate(normalized),
      totpExpiresInSeconds: authenticator.timeRemaining(),
    };
  } catch (err) {
    return { totpCode: null, totpExpiresInSeconds: null };
  }
}

function sanitizeServerForAdmin(server, assignedUserCount = 0) {
  if (!server) return server;
  const { totpSecret, ...rest } = server;
  return {
    ...rest,
    hasTotp: !!(totpSecret && String(totpSecret).trim()),
    totpSecret: totpSecret || '',
    ...currentTotp(totpSecret),
    assignedUserCount,
  };
}

async function publicEndUser(user) {
  const reseller = user.resellerId ? await db.getResellerById(user.resellerId) : null;
  const server = user.activeServerId ? await db.getServerById(user.activeServerId) : null;
  const { passwordHash, ...safe } = user;
  return {
    ...safe,
    displayName: safe.displayName || '',
    maxParallel: safe.maxParallel || 1,
    plan: safe.planName || 'Standard',
    planId: safe.planId || null,
    resellerId: safe.resellerId || null,
    resellerUsername: reseller ? reseller.username : null,
    ownerLabel: safe.ownerLabel || null,
    ownerId: safe.ownerId || null,
    ownerAdminId: safe.ownerAdminId || null,
    acquiredVia: safe.acquiredVia || 'SIGNUP',
    banned: !!safe.banned,
    activeServerName: server ? server.name : null,
    activeServerEmail: server ? server.email || '' : '',
  };
}

function publicSystemUser(user, extra = {}) {
  return {
    id: user.id,
    username: user.username,
    email: user.email || '',
    displayName: user.displayName || '',
    role: user.role || 'ADMIN',
    isActive: user.isActive !== false,
    banned: !!user.banned,
    isPrimary: !!extra.isPrimary,
    isSuperAdmin: !!extra.isSuperAdmin,
    userCount: extra.userCount != null ? extra.userCount : 0,
    createdAt: user.createdAt || null,
  };
}

async function publicReseller(reseller) {
  const users = await db.getUsers();
  const count = users.filter(
    (u) => u.resellerId === reseller.id || u.resellerId === reseller.userId
  ).length;
  return {
    id: reseller.id,
    userId: reseller.userId,
    parentAdminId: reseller.parentAdminId,
    username: reseller.username,
    displayName: reseller.displayName || '',
    isActive: reseller.isActive !== false,
    banned: !!reseller.banned,
    notes: reseller.notes || '',
    createdAt: reseller.createdAt,
    userCount: count,
    seatGrants: reseller.seatGrants || [],
  };
}

function normalizeSocialLinks(input) {
  if (!input || typeof input !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string' && value.trim()) out[key] = value.trim();
  }
  return out;
}

function planPayload(body) {
  return {
    name: String(body.name || '').trim(),
    description: body.description || '',
    credits: Number(body.credits ?? body.standardCreditsCycle) || 0,
    standardCreditsCycle: Number(body.standardCreditsCycle ?? body.credits) || 0,
    proCreditsCycle: Number(body.proCreditsCycle) || 0,
    price: Number(body.price ?? body.priceMonthly) || 0,
    priceMonthly: Number(body.priceMonthly ?? body.price) || 0,
    durationDays: Number(body.durationDays) || 30,
    maxParallel: Number(body.maxParallel) || 1,
    contactSeller: body.contactSeller !== undefined ? !!body.contactSeller : true,
    features: body.features,
    isActive: body.isActive !== false,
  };
}

async function requireAdminAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized. Admin token required.' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, await jwtSecret());
    if (decoded.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid or expired admin token.' });
  }
}

async function actingStaff(req) {
  const username = String(req.admin?.username || '');
  const adminRow = await db.getAdmin();
  if (
    username.toLowerCase() === String(adminRow.username || '').toLowerCase() ||
    username.toLowerCase() === String(adminRow.email || '').toLowerCase() ||
    req.admin?.isSuperAdmin === true
  ) {
    return {
      id: adminRow.id,
      username: adminRow.username,
      isSuperAdmin: true,
    };
  }
  const systemUser = await db.getSystemUserByUsername(username);
  if (!systemUser) return null;
  return { id: systemUser.id, username: systemUser.username, isSuperAdmin: false };
}

async function usersVisibleTo(actor) {
  const users = await db.getUsers();
  if (!actor || actor.isSuperAdmin) return users;

  const myResellers = (await db.getResellers()).filter((r) => r.parentAdminId === actor.id);
  const resellerUserIds = new Set(myResellers.map((r) => r.userId));
  const resellerProfileIds = new Set(myResellers.map((r) => r.id));

  return users.filter((user) => {
    if (user.ownerAdminId === actor.id || user.ownerId === actor.id) return true;
    if (user.createdByAdminId === actor.id) return true;
    if (user.resellerId && (resellerUserIds.has(user.resellerId) || resellerProfileIds.has(user.resellerId))) {
      return true;
    }
    return false;
  });
}

async function ownedUserOr404(req, res) {
  const actor = await actingStaff(req);
  if (!actor) {
    res.status(403).json({ success: false, error: 'Forbidden' });
    return null;
  }
  const user = await db.getUserById(req.params.id);
  if (!user) {
    res.status(404).json({ success: false, error: 'User not found' });
    return null;
  }
  if (!actor.isSuperAdmin) {
    const visible = await usersVisibleTo(actor);
    if (!visible.some((u) => u.id === user.id)) {
      res.status(404).json({ success: false, error: 'User not found' });
      return null;
    }
  }
  return { actor, user };
}

/** Block deleting yourself or the primary super admin if they ever appear in the end-user list. */
async function endUserDeleteBlockReason(actor, user) {
  if (!user) return 'User not found';
  const admin = await db.getAdmin();
  const actorId = String(actor?.id || '');
  const actorName = String(actor?.username || '').toLowerCase();
  const userId = String(user.id || '');
  const userName = String(user.username || '').toLowerCase();
  const adminNames = new Set(
    [admin.username, admin.email, 'admin']
      .filter(Boolean)
      .map((s) => String(s).toLowerCase())
  );

  if (userId && actorId && userId === actorId) {
    return 'Cannot delete your own account';
  }
  if (userName && actorName && userName === actorName) {
    return 'Cannot delete your own account';
  }
  if (userId && userId === String(admin.id || '')) {
    return 'Cannot delete the super admin account';
  }
  if (userName && adminNames.has(userName)) {
    return 'Cannot delete the super admin account';
  }
  if (user.role && user.role !== 'CUSTOMER') {
    return 'Cannot delete staff accounts from the users list';
  }
  return null;
}

async function requireSuperAdmin(req, res) {
  const actor = await actingStaff(req);
  if (!actor?.isSuperAdmin) {
    res.status(403).json({ success: false, error: 'Super admin only' });
    return null;
  }
  return actor;
}

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = await db.getAdmin();
    const names = new Set(
      [admin.username, admin.email, 'admin'].filter(Boolean).map((s) => String(s).toLowerCase())
    );
    if (!names.has(String(username || '').toLowerCase()) || !bcrypt.compareSync(password, admin.passwordHash)) {
      // Also allow system admins via /api/admin/login
      const systemUser = await db.getSystemUserByUsername(username);
      if (systemUser && bcrypt.compareSync(password, systemUser.passwordHash) && systemUser.isActive !== false) {
        const token = jwt.sign(
          { role: 'admin', username: systemUser.username, userId: systemUser.id, isSuperAdmin: false },
          await jwtSecret(),
          { expiresIn: '7d' }
        );
        return res.json({ success: true, token, username: systemUser.username });
      }
      return res.status(401).json({ success: false, error: 'Invalid admin username or password' });
    }

    const token = jwt.sign(
      { role: 'admin', username: admin.username, userId: admin.id, isSuperAdmin: true },
      await jwtSecret(),
      { expiresIn: '7d' }
    );
    res.json({ success: true, token, username: admin.username });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/metrics', requireAdminAuth, async (req, res) => {
  const actor = await actingStaff(req);
  const users = await usersVisibleTo(actor);
  const servers = await db.getServers();
  const now = new Date();

  const totalUsers = users.length;
  const activeUsers = users.filter((u) => u.isActive && !u.banned && new Date(u.planExpiry) > now).length;
  const expiredUsers = users.filter((u) => new Date(u.planExpiry) <= now).length;
  const totalCredits = users.reduce((acc, u) => acc + (u.credits || 0), 0);
  const activeServers = servers.filter((s) => s.isActive).length;
  const counts = await db.assignmentCounts();
  const resellers = actor?.isSuperAdmin
    ? await db.getResellers()
    : (await db.getResellers()).filter((r) => r.parentAdminId === actor.id);

  let adminUserCounts = [];
  if (actor?.isSuperAdmin) {
    const systemUsers = await db.getSystemUsers();
    const admin = await db.getAdmin();
    const allAdmins = [
      { id: admin.id, username: admin.username, displayName: 'Administrator' },
      ...systemUsers.map((u) => ({ id: u.id, username: u.username, displayName: u.displayName })),
    ];
    for (const a of allAdmins) {
      adminUserCounts.push({
        id: a.id,
        username: a.username,
        displayName: a.displayName || '',
        userCount: await db.countOwnedUsersForAdmin(a.id),
      });
    }
  } else if (actor) {
    adminUserCounts = [
      {
        id: actor.id,
        username: actor.username,
        displayName: '',
        userCount: await db.countOwnedUsersForAdmin(actor.id),
      },
    ];
  }

  res.json({
    success: true,
    metrics: {
      totalUsers,
      activeUsers,
      expiredUsers,
      totalCredits,
      totalServers: servers.length,
      activeServers,
      resellers: resellers.length,
      systemUsers: (await db.getSystemUsers()).length + 1,
      adminUserCounts,
      servers: servers.map((s) => ({
        id: s.id,
        name: s.name,
        email: s.email || '',
        isActive: s.isActive !== false,
        hasTotp: !!(s.totpSecret && String(s.totpSecret).trim()),
        assignedUserCount: counts[s.id] || 0,
      })),
    },
  });
});

function applyUserFilters(users, query) {
  const now = new Date();
  let out = users;
  const q = String(query.q || query.search || '').trim().toLowerCase();
  if (q) {
    out = out.filter(
      (u) =>
        (u.username || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.displayName || '').toLowerCase().includes(q) ||
        (u.notes || '').toLowerCase().includes(q) ||
        (u.ownerLabel || '').toLowerCase().includes(q)
    );
  }
  const status = String(query.status || 'all').toLowerCase();
  if (status === 'active') {
    out = out.filter((u) => u.isActive && !u.banned && new Date(u.planExpiry) > now);
  } else if (status === 'banned') {
    out = out.filter((u) => u.banned);
  } else if (status === 'expired') {
    out = out.filter((u) => !u.banned && new Date(u.planExpiry) <= now);
  } else if (status === 'inactive') {
    out = out.filter((u) => !u.isActive && !u.banned);
  }

  const owner = String(query.owner || 'all');
  if (owner === 'unclaimed') {
    out = out.filter((u) => !u.ownerAdminId && !u.ownerResellerId && !u.createdByResellerId);
  } else if (owner && owner !== 'all') {
    out = out.filter(
      (u) =>
        u.ownerAdminId === owner ||
        u.ownerId === owner ||
        u.createdByAdminId === owner ||
        u.ownerResellerId === owner ||
        u.createdByResellerId === owner ||
        u.resellerId === owner
    );
  }

  const plan = String(query.plan || query.planId || 'all');
  if (plan && plan !== 'all') {
    if (plan.toLowerCase() === 'custom' || plan.toLowerCase() === 'none') {
      out = out.filter((u) => !u.planId || !u.planName || /^custom$/i.test(u.planName));
    } else {
      out = out.filter(
        (u) => u.planId === plan || String(u.planName || '').toLowerCase() === plan.toLowerCase()
      );
    }
  }

  const source = String(query.source || 'all').toUpperCase();
  if (source === 'ADMIN' || source === 'ADMIN_MANUAL') {
    out = out.filter((u) => u.acquiredVia === 'ADMIN_MANUAL' || (!u.createdByResellerId && u.createdByAdminId));
  } else if (source === 'RESELLER') {
    out = out.filter((u) => u.acquiredVia === 'RESELLER' || !!u.createdByResellerId);
  } else if (source === 'SIGNUP') {
    out = out.filter((u) => u.acquiredVia === 'SIGNUP' || (!u.createdByAdminId && !u.createdByResellerId));
  }

  return out;
}

async function buildFilterOptions(actor) {
  const plans = await db.getPlans();
  const owners = [{ id: 'unclaimed', label: 'Unclaimed' }];
  if (actor?.isSuperAdmin) {
    const admin = await db.getAdmin();
    owners.push({ id: admin.id, label: `Admin: ${admin.username}` });
    for (const u of await db.getSystemUsers()) {
      owners.push({ id: u.id, label: `Admin: ${u.displayName || u.username}` });
    }
    for (const r of await db.getResellers()) {
      owners.push({ id: r.userId || r.id, label: `Reseller: ${r.displayName || r.username}` });
    }
  } else if (actor) {
    owners.push({ id: actor.id, label: `Admin: ${actor.username}` });
    const myResellers = (await db.getResellers()).filter((r) => r.parentAdminId === actor.id);
    for (const r of myResellers) {
      owners.push({ id: r.userId || r.id, label: `Reseller: ${r.displayName || r.username}` });
    }
  }
  return {
    statuses: [
      { id: 'all', label: 'All' },
      { id: 'active', label: 'Active' },
      { id: 'banned', label: 'Banned' },
      { id: 'expired', label: 'Expired' },
    ],
    owners: [{ id: 'all', label: 'All' }, ...owners],
    plans: [
      { id: 'all', label: 'All' },
      ...plans.map((p) => ({ id: p.id, label: p.name, name: p.name })),
      { id: 'custom', label: 'Custom' },
    ],
    sources: [
      { id: 'all', label: 'All' },
      { id: 'ADMIN_MANUAL', label: 'Admin added' },
      { id: 'RESELLER', label: 'Reseller added' },
      { id: 'SIGNUP', label: 'Signup' },
    ],
  };
}

router.get('/users', requireAdminAuth, async (req, res) => {
  const actor = await actingStaff(req);
  const users = await usersVisibleTo(actor);
  const filtered = applyUserFilters(users, req.query || {});
  const mapped = [];
  for (const u of filtered) mapped.push(await publicEndUser(u));
  res.json({
    success: true,
    users: mapped,
    hardcodedStd: HARDCODED_STD_CREDITS,
    filters: await buildFilterOptions(actor),
  });
});

router.get('/users/:id', requireAdminAuth, async (req, res) => {
  const owned = await ownedUserOr404(req, res);
  if (!owned) return;
  const user = await publicEndUser(owned.user);
  const [creditHistory, activity] = await Promise.all([
    db.getUserCreditHistory(owned.user.id, 100),
    db.getUserActivity(owned.user.id, owned.user.username, 100),
  ]);
  res.json({
    success: true,
    user,
    creditHistory,
    activity,
    hardcodedStd: HARDCODED_STD_CREDITS,
  });
});

router.post('/users', requireAdminAuth, async (req, res) => {
  try {
    const actor = await actingStaff(req);
    if (!actor) return res.status(403).json({ success: false, error: 'Forbidden' });
    const {
      username,
      password,
      credits,
      planExpiry,
      isActive,
      allowedServerIds,
      notes,
      displayName,
      maxParallel,
      resellerId,
      planId,
    } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password are required' });
    }
    if (resellerId && !(await db.getResellerById(resellerId))) {
      return res.status(400).json({ success: false, error: 'Reseller not found' });
    }
    let creditValue = credits;
    if (planId) {
      const plan = await db.getPlanById(planId);
      if (!plan) return res.status(400).json({ success: false, error: 'Plan not found' });
      const hard = hardcodedStdForPlanName(plan.name);
      if (hard != null && (credits === undefined || credits === null || credits === '')) {
        creditValue = hard;
      }
    }
    const newUser = await db.createUser({
      username,
      password,
      credits: Number(creditValue) || 0,
      planExpiry,
      isActive: isActive !== undefined ? isActive : true,
      allowedServerIds: allowedServerIds || ['all'],
      notes: notes || '',
      displayName: displayName || '',
      maxParallel,
      resellerId: resellerId || null,
      planId: planId || null,
      ownerId: actor.id,
      ownedByAdminId: actor.id,
      createdByAdminId: actor.id,
    });
    await db.addLog(actor.id, actor.username, 'create_user', {
      targetUsername: username,
      credits: creditValue,
      planExpiry,
    });
    res.json({ success: true, user: await publicEndUser(newUser) });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.put('/users/:id', requireAdminAuth, async (req, res) => {
  try {
    const owned = await ownedUserOr404(req, res);
    if (!owned) return;
    const updates = { ...(req.body || {}) };
    if (!owned.actor.isSuperAdmin) {
      delete updates.ownerId;
      delete updates.ownedByAdminId;
    }
    if (updates.planId) {
      const plan = await db.getPlanById(updates.planId);
      if (!plan) return res.status(400).json({ success: false, error: 'Plan not found' });
      const hard = hardcodedStdForPlanName(plan.name);
      if (hard != null && updates.credits === undefined) updates.credits = hard;
    }
    const updated = await db.updateUser(req.params.id, {
      ...updates,
      adminId: owned.actor.id,
      actorId: owned.actor.id,
    });
    if (!updated) return res.status(404).json({ success: false, error: 'User not found' });
    await db.addLog(owned.actor.id, owned.actor.username, 'update_user', {
      targetUserId: req.params.id,
      targetUsername: updated.username,
    });
    res.json({ success: true, user: await publicEndUser(updated) });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.put('/users/:id/ban', requireAdminAuth, async (req, res) => {
  const owned = await ownedUserOr404(req, res);
  if (!owned) return;
  const banned = !!req.body?.banned;
  const updated = await db.updateUser(req.params.id, {
    banned,
    banReason: req.body?.reason || '',
  });
  if (!updated) return res.status(404).json({ success: false, error: 'User not found' });
  await db.addLog(owned.actor.id, req.admin.username, banned ? 'ban_user' : 'unban_user', {
    targetUserId: updated.id,
    targetUsername: updated.username,
  });
  res.json({ success: true, user: await publicEndUser(updated) });
});

router.post('/users/bulk-delete', requireAdminAuth, async (req, res) => {
  const actor = await actingStaff(req);
  if (!actor) return res.status(403).json({ success: false, error: 'Forbidden' });

  const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const ids = [...new Set(rawIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) {
    return res.status(400).json({ success: false, error: 'No user ids provided' });
  }

  const visible = actor.isSuperAdmin ? null : await usersVisibleTo(actor);
  const deleted = [];
  const skipped = [];

  for (const id of ids) {
    const user = await db.getUserById(id);
    if (!user || (visible && !visible.some((u) => u.id === id))) {
      skipped.push({ id, reason: 'not_found' });
      continue;
    }
    const block = await endUserDeleteBlockReason(actor, user);
    if (block) {
      skipped.push({ id, username: user.username, reason: block });
      continue;
    }
    const ok = await db.deleteUser(id);
    if (!ok) {
      skipped.push({ id, username: user.username, reason: 'delete_failed' });
      continue;
    }
    deleted.push({ id, username: user.username });
    await db.addLog(actor.id, actor.username, 'delete_user', {
      targetUserId: id,
      targetUsername: user.username,
      bulk: true,
    });
  }

  res.json({
    success: true,
    deleted,
    skipped,
    deletedCount: deleted.length,
    skippedCount: skipped.length,
  });
});

router.delete('/users/:id', requireAdminAuth, async (req, res) => {
  const owned = await ownedUserOr404(req, res);
  if (!owned) return;
  const block = await endUserDeleteBlockReason(owned.actor, owned.user);
  if (block) return res.status(400).json({ success: false, error: block });
  const ok = await db.deleteUser(req.params.id);
  if (!ok) return res.status(404).json({ success: false, error: 'User not found' });
  await db.addLog(owned.actor.id, owned.actor.username, 'delete_user', {
    targetUserId: req.params.id,
    targetUsername: owned.user?.username,
  });
  res.json({ success: true, message: 'User deleted' });
});

router.get('/servers', requireAdminAuth, async (req, res) => {
  const counts = await db.assignmentCounts();
  const servers = (await db.getServers()).map((server) =>
    sanitizeServerForAdmin(server, counts[server.id] || 0)
  );
  res.json({
    success: true,
    assignment: 'least-loaded',
    note: 'New logins and account changes go to the least-loaded Google account. Accounts with an authenticator secret are preferred for auto-login.',
    servers,
  });
});

router.post('/servers/totp-preview', requireAdminAuth, async (req, res) => {
  const secret = normalizeTotpSecret(req.body?.secret || req.body?.totpSecret || '');
  if (!secret) {
    return res.status(400).json({ success: false, error: 'Authenticator secret is required' });
  }
  try {
    const code = authenticator.generate(secret);
    const remaining = authenticator.timeRemaining();
    res.json({ success: true, code, expiresInSeconds: remaining });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: 'Invalid authenticator secret. Paste the base32 secret from Google Authenticator setup.',
    });
  }
});

router.post('/servers', requireAdminAuth, async (req, res) => {
  try {
    const { name, targetUrl, email, password, totpSecret, isActive } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Server name is required' });
    const newServer = await db.createServer({
      name,
      targetUrl: targetUrl || 'https://flow.google.com',
      email: email || '',
      password: password || '',
      totpSecret: totpSecret || '',
      isActive: isActive !== undefined ? isActive : true,
    });
    await db.addLog('admin', 'admin', 'create_server', {
      serverName: name,
      targetUrl,
      email,
      hasTotp: !!newServer.totpSecret,
    });
    res.json({ success: true, server: sanitizeServerForAdmin(newServer) });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.put('/servers/:id', requireAdminAuth, async (req, res) => {
  try {
    const updated = await db.updateServer(req.params.id, req.body);
    if (!updated) return res.status(404).json({ success: false, error: 'Server not found' });
    await db.addLog('admin', 'admin', 'update_server', {
      serverId: req.params.id,
      serverName: updated.name,
      hasTotp: !!updated.totpSecret,
    });
    res.json({ success: true, server: sanitizeServerForAdmin(updated) });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/servers/:id', requireAdminAuth, async (req, res) => {
  const srv = await db.getServerById(req.params.id);
  const ok = await db.deleteServer(req.params.id);
  if (!ok) return res.status(404).json({ success: false, error: 'Server not found' });
  await db.addLog('admin', 'admin', 'delete_server', {
    serverId: req.params.id,
    serverName: srv?.name,
  });
  res.json({ success: true, message: 'Server deleted' });
});

router.get('/settings', requireAdminAuth, async (req, res) => {
  res.json({ success: true, settings: await db.getSettings() });
});

router.put('/settings', requireAdminAuth, async (req, res) => {
  try {
    const body = { ...(req.body || {}) };
    delete body.users;
    delete body.servers;
    delete body.admin;
    delete body.passwordHash;
    delete body.downloads;
    if (body.socialLinks !== undefined) body.socialLinks = normalizeSocialLinks(body.socialLinks);
    if (typeof body.siteName === 'string' && body.siteName.trim()) body.appName = body.siteName.trim();
    const updated = await db.updateSettings(body);
    await db.addLog('admin', 'admin', 'update_settings', {});
    res.json({ success: true, settings: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/downloads', requireAdminAuth, async (req, res) => {
  res.json({ success: true, downloads: await downloads.getPublicAvailability() });
});

router.post('/downloads/:platform', requireAdminAuth, uploadTemp.single('file'), async (req, res) => {
  try {
    const platform = String(req.params.platform || '').toLowerCase();
    if (platform !== 'windows' && platform !== 'android') {
      return res.status(400).json({ success: false, error: 'Platform must be windows or android' });
    }
    const entry = await downloads.saveUploadedFile(platform, req.file);
    await db.addLog('admin', 'admin', 'upload_download', {
      platform,
      originalName: entry.originalName,
      size: entry.size,
    });
    res.json({
      success: true,
      platform,
      package: entry,
      downloads: await downloads.getPublicAvailability(),
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message || 'Upload failed' });
  }
});

router.delete('/downloads/:platform', requireAdminAuth, async (req, res) => {
  try {
    const platform = String(req.params.platform || '').toLowerCase();
    if (platform !== 'windows' && platform !== 'android') {
      return res.status(400).json({ success: false, error: 'Platform must be windows or android' });
    }
    await downloads.removePackage(platform);
    await db.addLog('admin', 'admin', 'delete_download', { platform });
    res.json({ success: true, downloads: await downloads.getPublicAvailability() });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message || 'Delete failed' });
  }
});

router.get('/logs', requireAdminAuth, async (req, res) => {
  res.json({ success: true, logs: await db.getLogs(200) });
});

router.put('/password', requireAdminAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).trim().length < 4) {
    return res.status(400).json({ success: false, error: 'New password must be at least 4 characters' });
  }
  const username = req.admin.username;
  const systemUser = await db.getSystemUserByUsername(username);
  if (systemUser) {
    if (!currentPassword || !bcrypt.compareSync(currentPassword, systemUser.passwordHash)) {
      return res.status(400).json({ success: false, error: 'Current password is incorrect' });
    }
    await db.updateSystemUser(systemUser.id, { password: newPassword });
  } else {
    const admin = await db.getAdmin();
    if (!bcrypt.compareSync(currentPassword || '', admin.passwordHash)) {
      return res.status(400).json({ success: false, error: 'Current password is incorrect' });
    }
    await db.updateAdminPassword(newPassword);
  }
  await db.addLog('admin', username, 'update_admin_password', {});
  res.json({ success: true });
});

router.get('/system-users', requireAdminAuth, async (req, res) => {
  const admin = await db.getAdmin();
  const primaryCount = await db.countOwnedUsersForAdmin(admin.id);
  const primary = publicSystemUser(
    {
      id: admin.id,
      username: admin.username,
      email: admin.email,
      displayName: 'Administrator',
      role: 'SUPER_ADMIN',
      isActive: true,
      banned: false,
      createdAt: null,
    },
    { isPrimary: true, isSuperAdmin: true, userCount: primaryCount }
  );
  const extras = [];
  for (const user of await db.getSystemUsers()) {
    extras.push(
      publicSystemUser(user, {
        userCount: await db.countOwnedUsersForAdmin(user.id),
      })
    );
  }
  res.json({ success: true, users: [primary, ...extras] });
});

router.post('/system-users', requireAdminAuth, async (req, res) => {
  const actor = await requireSuperAdmin(req, res);
  if (!actor) return;
  try {
    const created = await db.createSystemUser(req.body || {});
    await db.addLog(actor.id, req.admin.username, 'create_system_user', { username: created.username });
    res.json({ success: true, user: publicSystemUser(created) });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.put('/system-users/:id', requireAdminAuth, async (req, res) => {
  const actor = await requireSuperAdmin(req, res);
  if (!actor) return;
  const admin = await db.getAdmin();
  if (req.params.id === admin.id || req.params.id === 'admin') {
    // Super admin can change own password via settings; allow ban? no
    if (req.body?.password) {
      await db.updateAdminPassword(req.body.password);
      return res.json({
        success: true,
        user: publicSystemUser(
          { id: admin.id, username: admin.username, displayName: 'Administrator', role: 'SUPER_ADMIN', isActive: true },
          { isPrimary: true, isSuperAdmin: true }
        ),
      });
    }
    return res.status(400).json({ success: false, error: 'The primary admin is managed from Settings' });
  }
  try {
    const updated = await db.updateSystemUser(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ success: false, error: 'System user not found' });
    await db.addLog(actor.id, req.admin.username, 'update_system_user', { username: updated.username });
    res.json({ success: true, user: publicSystemUser(updated) });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/system-users/:id', requireAdminAuth, async (req, res) => {
  const actor = await requireSuperAdmin(req, res);
  if (!actor) return;
  const admin = await db.getAdmin();
  if (req.params.id === admin.id || req.params.id === 'admin') {
    return res.status(400).json({ success: false, error: 'The primary admin cannot be deleted' });
  }
  const existing = await db.getSystemUserById(req.params.id);
  const ok = await db.deleteSystemUser(req.params.id);
  if (!ok) return res.status(404).json({ success: false, error: 'System user not found' });
  await db.addLog(actor.id, req.admin.username, 'delete_system_user', { username: existing?.username });
  res.json({ success: true });
});

router.get('/resellers', requireAdminAuth, async (req, res) => {
  const actor = await actingStaff(req);
  let rows = await db.getResellers();
  if (!actor?.isSuperAdmin) rows = rows.filter((r) => r.parentAdminId === actor.id);
  const mapped = [];
  for (const r of rows) mapped.push(await publicReseller(r));
  res.json({ success: true, resellers: mapped });
});

router.post('/resellers', requireAdminAuth, async (req, res) => {
  try {
    const actor = await actingStaff(req);
    if (!actor) return res.status(403).json({ success: false, error: 'Forbidden' });
    const body = { ...(req.body || {}), parentAdminId: actor.id };
    const created = await db.createReseller(body);
    await db.addLog(actor.id, req.admin.username, 'create_reseller', { username: created.username });
    res.json({ success: true, reseller: await publicReseller(created) });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.put('/resellers/:id', requireAdminAuth, async (req, res) => {
  try {
    const actor = await actingStaff(req);
    const existing = await db.getResellerById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: 'Reseller not found' });
    if (!actor?.isSuperAdmin && existing.parentAdminId !== actor.id) {
      return res.status(404).json({ success: false, error: 'Reseller not found' });
    }
    // Password / ban for resellers: super admin always; owning admin can edit own sellers
    if ((req.body?.password || req.body?.banned !== undefined) && !actor.isSuperAdmin && existing.parentAdminId !== actor.id) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const updated = await db.updateReseller(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ success: false, error: 'Reseller not found' });
    await db.addLog(actor.id, req.admin.username, 'update_reseller', { username: updated.username });
    res.json({ success: true, reseller: await publicReseller(updated) });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/resellers/:id', requireAdminAuth, async (req, res) => {
  const actor = await actingStaff(req);
  const existing = await db.getResellerById(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: 'Reseller not found' });
  if (!actor?.isSuperAdmin && existing.parentAdminId !== actor.id) {
    return res.status(404).json({ success: false, error: 'Reseller not found' });
  }
  const ok = await db.deleteReseller(req.params.id);
  if (!ok) return res.status(404).json({ success: false, error: 'Reseller not found' });
  await db.addLog(actor.id, req.admin.username, 'delete_reseller', { username: existing?.username });
  res.json({ success: true });
});

async function handleNoticeUpdate(req, res) {
  const updated = await db.updateNotice(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ success: false, error: 'Notice not found' });
  res.json({ success: true, notice: updated });
}

async function handlePlanUpdate(req, res) {
  try {
    const updated = await db.updatePlan(req.params.id, planPayload(req.body || {}));
    if (!updated) return res.status(404).json({ success: false, error: 'Plan not found' });
    res.json({ success: true, plan: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

router.get('/notices', requireAdminAuth, async (req, res) => {
  res.json({ success: true, notices: await db.getNotices() });
});

router.post('/notices', requireAdminAuth, async (req, res) => {
  try {
    const notice = await db.createNotice(req.body || {});
    await db.addLog('admin', req.admin.username, 'create_notice', { title: notice.title });
    res.json({ success: true, notice });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.patch('/notices/:id', requireAdminAuth, handleNoticeUpdate);
router.put('/notices/:id', requireAdminAuth, handleNoticeUpdate);

router.delete('/notices/:id', requireAdminAuth, async (req, res) => {
  const ok = await db.deleteNotice(req.params.id);
  if (!ok) return res.status(404).json({ success: false, error: 'Notice not found' });
  res.json({ success: true });
});

router.get('/plans', requireAdminAuth, async (req, res) => {
  res.json({
    success: true,
    plans: await db.getPlans(),
    hardcodedStd: HARDCODED_STD_CREDITS,
  });
});

router.post('/plans', requireAdminAuth, async (req, res) => {
  try {
    const plan = await db.createPlan(planPayload(req.body || {}));
    await db.addLog('admin', req.admin.username, 'create_plan', { name: plan.name });
    res.json({ success: true, plan });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.patch('/plans/:id', requireAdminAuth, handlePlanUpdate);
router.put('/plans/:id', requireAdminAuth, handlePlanUpdate);

router.delete('/plans/:id', requireAdminAuth, async (req, res) => {
  const ok = await db.deletePlan(req.params.id);
  if (!ok) return res.status(404).json({ success: false, error: 'Plan not found' });
  res.json({ success: true });
});

module.exports = router;
