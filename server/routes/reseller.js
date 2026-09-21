const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { hardcodedStdForPlanName, HARDCODED_STD_CREDITS } = require('../planCredits');

const router = express.Router();

async function jwtSecret() {
  const admin = await db.getAdmin();
  return process.env.JWT_SECRET || admin.jwtSecret || 'flow_admin_secret_key';
}

async function requireResellerAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], await jwtSecret());
    if (decoded.role !== 'reseller' || !decoded.resellerId) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const reseller = await db.getResellerById(decoded.resellerId);
    if (!reseller || reseller.isActive === false || reseller.banned) {
      return res.status(403).json({ success: false, error: 'Reseller account is not active' });
    }
    req.reseller = reseller;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Session expired or invalid. Please log in again.' });
  }
}

function publicCustomer(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || '',
    credits: user.credits || 0,
    planExpiry: user.planExpiry,
    isActive: user.isActive !== false,
    banned: !!user.banned,
    maxParallel: user.maxParallel || 1,
    plan: user.planName || 'Standard',
    planId: user.planId || null,
    ownerLabel: user.ownerLabel || null,
    acquiredVia: user.acquiredVia || 'RESELLER',
    notes: user.notes || '',
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
  };
}

function resellerUsers(reseller) {
  return db.getUsers().then((users) =>
    users.filter((u) => u.resellerId === reseller.userId || u.resellerId === reseller.id)
  );
}

function applyFilters(users, query) {
  const now = new Date();
  let out = users;
  const q = String(query.q || query.search || '').trim().toLowerCase();
  if (q) {
    out = out.filter(
      (u) =>
        (u.username || '').toLowerCase().includes(q) ||
        (u.displayName || '').toLowerCase().includes(q) ||
        (u.notes || '').toLowerCase().includes(q)
    );
  }
  const status = String(query.status || 'all').toLowerCase();
  if (status === 'active') {
    out = out.filter((u) => u.isActive && !u.banned && new Date(u.planExpiry) > now);
  } else if (status === 'banned') {
    out = out.filter((u) => u.banned);
  } else if (status === 'expired') {
    out = out.filter((u) => !u.banned && new Date(u.planExpiry) <= now);
  }
  const plan = String(query.plan || query.planId || 'all');
  if (plan && plan !== 'all') {
    out = out.filter(
      (u) => u.planId === plan || String(u.planName || '').toLowerCase() === plan.toLowerCase()
    );
  }
  return out;
}

router.get('/me', requireResellerAuth, async (req, res) => {
  const reseller = req.reseller;
  res.json({
    success: true,
    reseller: {
      id: reseller.id,
      username: reseller.username,
      displayName: reseller.displayName || '',
      notes: reseller.notes || '',
      seatGrants: reseller.seatGrants || [],
    },
  });
});

router.put('/profile', requireResellerAuth, async (req, res) => {
  const reseller = req.reseller;
  const { displayName, currentPassword, newPassword } = req.body || {};
  if (newPassword && String(newPassword).trim()) {
    if (!currentPassword || !bcrypt.compareSync(currentPassword, reseller.passwordHash)) {
      return res.status(400).json({ success: false, error: 'Current password is incorrect' });
    }
    await db.updateReseller(reseller.id, { password: newPassword });
  }
  if (displayName !== undefined) await db.updateReseller(reseller.id, { displayName });
  const fresh = await db.getResellerById(reseller.id);
  res.json({
    success: true,
    reseller: {
      id: fresh.id,
      username: fresh.username,
      displayName: fresh.displayName || '',
      seatGrants: fresh.seatGrants || [],
    },
  });
});

router.get('/users', requireResellerAuth, async (req, res) => {
  const users = await resellerUsers(req.reseller);
  const filtered = applyFilters(users, req.query || {});
  const grants = req.reseller.seatGrants || [];
  res.json({
    success: true,
    users: filtered.map(publicCustomer),
    seatGrants: grants,
    filters: {
      statuses: [
        { id: 'all', label: 'All' },
        { id: 'active', label: 'Active' },
        { id: 'banned', label: 'Banned' },
        { id: 'expired', label: 'Expired' },
      ],
      plans: [
        { id: 'all', label: 'All' },
        ...grants.map((g) => ({ id: g.planId, label: g.planName || g.planId })),
      ],
    },
  });
});

router.get('/users/:id', requireResellerAuth, async (req, res) => {
  const existing = await db.getUserById(req.params.id);
  if (
    !existing ||
    (existing.resellerId !== req.reseller.userId && existing.resellerId !== req.reseller.id)
  ) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }
  const [creditHistory, activity] = await Promise.all([
    db.getUserCreditHistory(existing.id, 100),
    db.getUserActivity(existing.id, existing.username, 100),
  ]);
  res.json({
    success: true,
    user: publicCustomer(existing),
    creditHistory,
    activity,
    hardcodedStd: HARDCODED_STD_CREDITS,
  });
});

router.get('/plans', requireResellerAuth, async (req, res) => {
  const allPlans = await db.getPlans();
  const grants = req.reseller.seatGrants || [];
  const grantByPlan = new Map(grants.map((g) => [g.planId, g]));
  const plans = allPlans
    .filter((p) => grantByPlan.has(p.id))
    .map((p) => {
      const g = grantByPlan.get(p.id);
      return {
        ...p,
        seatsAllocated: g.seatsAllocated,
        seatsUsed: g.seatsUsed,
        seatsRemaining: Math.max(0, (g.seatsAllocated || 0) - (g.seatsUsed || 0)),
      };
    });
  res.json({ success: true, plans, seatGrants: grants, hardcodedStd: HARDCODED_STD_CREDITS });
});

router.post('/users', requireResellerAuth, async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.planId) {
      return res.status(400).json({ success: false, error: 'Plan is required' });
    }
    const grant = (req.reseller.seatGrants || []).find((g) => g.planId === body.planId);
    if (!grant) {
      return res.status(400).json({
        success: false,
        error: 'You do not have a seat quota for this plan',
      });
    }
    if ((grant.seatsUsed || 0) >= (grant.seatsAllocated || 0)) {
      return res.status(400).json({
        success: false,
        error: `No remaining seats for ${grant.planName || 'this plan'} (${grant.seatsUsed}/${grant.seatsAllocated})`,
      });
    }

    let credits = body.credits;
    const plan = await db.getPlanById(body.planId);
    const hard = plan ? hardcodedStdForPlanName(plan.name) : null;
    if (hard != null && (credits === undefined || credits === null || credits === '')) {
      credits = hard;
    }
    const created = await db.createUser({
      username: body.username,
      password: body.password,
      credits: Number(credits) || 0,
      planExpiry: body.planExpiry,
      isActive: body.isActive !== undefined ? body.isActive : true,
      allowedServerIds: ['all'],
      notes: body.notes || '',
      displayName: body.displayName || '',
      maxParallel: body.maxParallel,
      resellerId: req.reseller.id,
      planId: body.planId,
      ownedByAdminId: req.reseller.parentAdminId,
      createdByAdminId: req.reseller.parentAdminId,
    });
    await db.addLog(req.reseller.id, req.reseller.username, 'reseller_create_user', {
      targetUserId: created.id,
      targetUsername: created.username,
    });
    res.json({ success: true, user: publicCustomer(created) });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.put('/users/:id', requireResellerAuth, async (req, res) => {
  const existing = await db.getUserById(req.params.id);
  if (
    !existing ||
    (existing.resellerId !== req.reseller.userId && existing.resellerId !== req.reseller.id)
  ) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }
  try {
    const body = req.body || {};
    if (body.planId && body.planId !== existing.planId) {
      const grant = (req.reseller.seatGrants || []).find((g) => g.planId === body.planId);
      if (!grant) {
        return res.status(400).json({
          success: false,
          error: 'You do not have a seat quota for this plan',
        });
      }
      if ((grant.seatsUsed || 0) >= (grant.seatsAllocated || 0)) {
        return res.status(400).json({
          success: false,
          error: `No remaining seats for ${grant.planName || 'this plan'}`,
        });
      }
    }
    const updated = await db.updateUser(existing.id, {
      displayName: body.displayName,
      credits: body.credits,
      planExpiry: body.planExpiry,
      isActive: body.isActive,
      banned: body.banned,
      banReason: body.banReason,
      maxParallel: body.maxParallel,
      password: body.password,
      notes: body.notes,
      planId: body.planId,
      adminId: req.reseller.userId,
      actorId: req.reseller.userId,
      creditReason: 'reseller_update_user',
    });
    await db.addLog(req.reseller.id, req.reseller.username, 'reseller_update_user', {
      targetUserId: updated.id,
      targetUsername: updated.username,
    });
    res.json({ success: true, user: publicCustomer(updated) });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.put('/users/:id/ban', requireResellerAuth, async (req, res) => {
  const existing = await db.getUserById(req.params.id);
  if (
    !existing ||
    (existing.resellerId !== req.reseller.userId && existing.resellerId !== req.reseller.id)
  ) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }
  const banned = !!req.body?.banned;
  const updated = await db.updateUser(existing.id, {
    banned,
    banReason: req.body?.reason || '',
  });
  await db.addLog(req.reseller.id, req.reseller.username, banned ? 'ban_user' : 'unban_user', {
    targetUserId: updated.id,
    targetUsername: updated.username,
  });
  res.json({ success: true, user: publicCustomer(updated) });
});

function resellerOwnsUser(reseller, user) {
  if (!reseller || !user) return false;
  return user.resellerId === reseller.userId || user.resellerId === reseller.id;
}

function resellerDeleteBlockReason(reseller, user) {
  if (!user) return 'User not found';
  const resellerId = String(reseller?.userId || reseller?.id || '');
  const resellerName = String(reseller?.username || '').toLowerCase();
  const userId = String(user.id || '');
  const userName = String(user.username || '').toLowerCase();
  if (userId && resellerId && userId === resellerId) {
    return 'Cannot delete your own account';
  }
  if (userName && resellerName && userName === resellerName) {
    return 'Cannot delete your own account';
  }
  if (user.role && user.role !== 'CUSTOMER') {
    return 'Cannot delete staff accounts';
  }
  return null;
}

router.post('/users/bulk-delete', requireResellerAuth, async (req, res) => {
  const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const ids = [...new Set(rawIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) {
    return res.status(400).json({ success: false, error: 'No user ids provided' });
  }

  const deleted = [];
  const skipped = [];

  for (const id of ids) {
    const existing = await db.getUserById(id);
    if (!existing || !resellerOwnsUser(req.reseller, existing)) {
      skipped.push({ id, reason: 'not_found' });
      continue;
    }
    const block = resellerDeleteBlockReason(req.reseller, existing);
    if (block) {
      skipped.push({ id, username: existing.username, reason: block });
      continue;
    }
    await db.deleteUser(existing.id);
    deleted.push({ id, username: existing.username });
    await db.addLog(req.reseller.id, req.reseller.username, 'reseller_delete_user', {
      targetUsername: existing.username,
      targetUserId: existing.id,
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

router.delete('/users/:id', requireResellerAuth, async (req, res) => {
  const existing = await db.getUserById(req.params.id);
  if (!existing || !resellerOwnsUser(req.reseller, existing)) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }
  const block = resellerDeleteBlockReason(req.reseller, existing);
  if (block) return res.status(400).json({ success: false, error: block });
  await db.deleteUser(existing.id);
  await db.addLog(req.reseller.id, req.reseller.username, 'reseller_delete_user', {
    targetUsername: existing.username,
    targetUserId: existing.id,
  });
  res.json({ success: true });
});

module.exports = router;
