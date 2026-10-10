const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { loginClientUser } = require('./client-v6');

const router = express.Router();

async function jwtSecret() {
  const admin = await db.getAdmin();
  return process.env.JWT_SECRET || admin.jwtSecret || 'flow_admin_secret_key';
}

async function signAdmin(username, extra = {}) {
  return jwt.sign({ role: 'admin', username, ...extra }, await jwtSecret(), { expiresIn: '7d' });
}

async function signReseller(reseller) {
  return jwt.sign(
    { role: 'reseller', resellerId: reseller.id, username: reseller.username },
    await jwtSecret(),
    { expiresIn: '30d' }
  );
}

router.post('/login', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = req.body?.password || '';
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Please enter both username and password' });
    }

    const admin = await db.getAdmin();
    const adminUsernames = new Set(
      [admin.username, admin.email, 'admin']
        .filter(Boolean)
        .map((s) => String(s).toLowerCase())
    );
    if (adminUsernames.has(username.toLowerCase())) {
      if (!bcrypt.compareSync(password, admin.passwordHash)) {
        return res.status(401).json({ success: false, error: 'Invalid username or password' });
      }
      if (admin.isActive === false) {
        return res.status(403).json({ success: false, error: 'This admin account is deactivated.' });
      }
      return res.json({
        success: true,
        role: 'admin',
        token: await signAdmin(admin.username, { userId: admin.id, isSuperAdmin: true }),
        user: {
          id: admin.id,
          username: admin.username,
          displayName: 'Administrator',
          role: 'SUPER_ADMIN',
        },
      });
    }

    const systemUser = await db.getSystemUserByUsername(username);
    if (systemUser) {
      if (!bcrypt.compareSync(password, systemUser.passwordHash)) {
        return res.status(401).json({ success: false, error: 'Invalid username or password' });
      }
      if (systemUser.isActive === false || systemUser.banned) {
        return res.status(403).json({ success: false, error: 'This admin account is deactivated.' });
      }
      return res.json({
        success: true,
        role: 'admin',
        token: await signAdmin(systemUser.username, { userId: systemUser.id, isSuperAdmin: false }),
        user: {
          id: systemUser.id,
          username: systemUser.username,
          displayName: systemUser.displayName || systemUser.username,
          role: 'ADMIN',
        },
      });
    }

    const reseller = await db.getResellerByUsername(username);
    if (reseller) {
      if (!bcrypt.compareSync(password, reseller.passwordHash)) {
        return res.status(401).json({ success: false, error: 'Invalid username or password' });
      }
      if (reseller.isActive === false || reseller.banned) {
        return res.status(403).json({ success: false, error: 'This reseller account is deactivated.' });
      }
      return res.json({
        success: true,
        role: 'reseller',
        token: await signReseller(reseller),
        user: {
          id: reseller.id,
          username: reseller.username,
          displayName: reseller.displayName || reseller.username,
        },
      });
    }

    // Website login — never require EXE/APK Device ID (that auto-banned portal users).
    const result = await loginClientUser(username, password, req.ip, req, {
      requireDeviceAttestation: false,
    });
    if (!result.body?.success) {
      return res.status(result.status).json(result.body);
    }
    return res.json({ ...result.body, role: 'user' });
  } catch (err) {
    console.error('session login', err);
    return res.status(500).json({ success: false, error: err.message || 'Login failed' });
  }
});

module.exports = router;
