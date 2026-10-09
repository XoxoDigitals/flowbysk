const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { prisma } = require('./prisma');
const { hardcodedStdForPlanName } = require('./planCredits');
const { sealForStorage, openFromStorage, isEncrypted } = require('./secretsCrypto');

const RUNTIME_KEY = 'flow_browser_runtime';
const USER_META_KEY = 'flow_browser_user_meta';
const DATA_JSON = path.join(__dirname, 'data.json');
const DATA_BAK = path.join(__dirname, 'data.json.bak');

const BRAND = 'Flow Creator Ai';

function normalizeTotpSecret(value) {
  if (!value || typeof value !== 'string') return '';
  return value.replace(/\s+/g, '').toUpperCase();
}

function clampParallel(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(20, Math.round(n));
}

function emailFromUsername(username) {
  const u = String(username || '').trim();
  if (!u) return '';
  if (u.includes('@')) return u.toLowerCase();
  return `${u.toLowerCase()}@flowcreator.local`;
}

function usernameFromEmail(email) {
  return String(email || '').trim();
}

function monthKey(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

async function getJsonSetting(key, fallback) {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  if (!row || row.value == null) return fallback;
  return row.value;
}

async function setJsonSetting(key, value) {
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
  return value;
}

function normalizeClientApiVersion(value) {
  // Only v6 is live (traditional login). Older clients FORCE_UPDATE.
  void value;
  return 'v6';
}

async function getRuntime() {
  const base = {
    appName: BRAND,
    defaultTargetUrl: 'https://flow.google.com',
    enableCreditTracking: true,
    modelRenames: [],
    cssSelectorsToHide: [],
    customCss: '',
    downloads: { windows: null, android: null },
    clientApiVersion: 'v6',
    jwtSecret: process.env.JWT_SECRET || 'flow_super_secret_jwt_key_2026',
  };
  const stored = (await getJsonSetting(RUNTIME_KEY, {})) || {};
  const merged = { ...base, ...stored, downloads: { ...base.downloads, ...(stored.downloads || {}) } };
  merged.clientApiVersion = normalizeClientApiVersion(merged.clientApiVersion);
  return merged;
}

async function patchRuntime(patch) {
  const current = await getRuntime();
  const next = { ...current, ...patch };
  if (patch.downloads) {
    next.downloads = { ...(current.downloads || {}), ...patch.downloads };
  }
  await setJsonSetting(RUNTIME_KEY, next);
  return next;
}

async function getUserMetaMap() {
  return (await getJsonSetting(USER_META_KEY, {})) || {};
}

async function patchUserMeta(userId, patch) {
  const map = await getUserMetaMap();
  map[userId] = { ...(map[userId] || {}), ...patch };
  await setJsonSetting(USER_META_KEY, map);
  return map[userId];
}

async function getStdBalance(userId) {
  const w = await prisma.wallet.findUnique({
    where: { userId_walletType: { userId, walletType: 'STANDARD' } },
  });
  return w ? w.balance : 0;
}

async function setStdBalance(userId, balance, opts = {}) {
  const bal = Math.round(Number(balance) || 0);
  const prev = await getStdBalance(userId);
  await prisma.wallet.upsert({
    where: { userId_walletType: { userId, walletType: 'STANDARD' } },
    create: { userId, walletType: 'STANDARD', balance: bal, reserved: 0 },
    update: { balance: bal },
  });
  const delta = bal - prev;
  if (delta !== 0 || opts.forceLedger) {
    try {
      await prisma.creditLedger.create({
        data: {
          userId,
          walletType: 'STANDARD',
          amount: delta,
          balanceAfter: bal,
          type: opts.type || (prev === 0 && bal > 0 ? 'GRANT' : 'ADMIN_ADJUSTMENT'),
          adminId: opts.adminId || null,
          reason: opts.reason || null,
          jobId: opts.jobId || null,
        },
      });
    } catch (err) {
      console.error('creditLedger write failed', err.message);
    }
  }
  return bal;
}

async function ensureWallets(userId) {
  await prisma.wallet.upsert({
    where: { userId_walletType: { userId, walletType: 'STANDARD' } },
    create: { userId, walletType: 'STANDARD', balance: 0, reserved: 0 },
    update: {},
  });
  await prisma.wallet.upsert({
    where: { userId_walletType: { userId, walletType: 'PRO' } },
    create: { userId, walletType: 'PRO', balance: 0, reserved: 0 },
    update: {},
  });
}

async function activeSubscription(userId) {
  return prisma.subscription.findFirst({
    where: { userId, status: 'ACTIVE' },
    include: { plan: true },
    orderBy: { currentPeriodEnd: 'desc' },
  });
}

async function mapCustomer(user, metaMap, ownerLookup) {
  const meta = (metaMap && metaMap[user.id]) || {};
  const sub = await activeSubscription(user.id);
  const credits = await getStdBalance(user.id);
  const plan = sub?.plan || null;
  const maxParallel =
    sub?.maxParallelOverride != null
      ? clampParallel(sub.maxParallelOverride)
      : plan
        ? clampParallel(plan.maxParallel)
        : clampParallel(meta.maxParallel || 1);

  const ownerAdminId = user.ownedByAdminId || user.createdByAdminId || null;
  const ownerResellerId = user.createdByResellerId || null;
  let ownerLabel = '';
  let ownerId = ownerAdminId;
  if (ownerResellerId && ownerLookup?.resellers?.[ownerResellerId]) {
    ownerLabel = `Reseller: ${ownerLookup.resellers[ownerResellerId]}`;
    ownerId = ownerResellerId;
  } else if (ownerAdminId && ownerLookup?.admins?.[ownerAdminId]) {
    ownerLabel = `Admin: ${ownerLookup.admins[ownerAdminId]}`;
  } else if (ownerResellerId) {
    ownerLabel = `Reseller: ${ownerResellerId.slice(0, 8)}`;
    ownerId = ownerResellerId;
  } else if (ownerAdminId) {
    ownerLabel = `Admin: ${ownerAdminId.slice(0, 8)}`;
  }

  const acquiredVia = user.acquiredVia || (ownerResellerId ? 'RESELLER' : ownerAdminId ? 'ADMIN_MANUAL' : 'SIGNUP');

  return {
    id: user.id,
    username: usernameFromEmail(user.email),
    email: user.email,
    passwordHash: user.passwordHash,
    displayName: user.name || '',
    credits,
    planExpiry: sub?.currentPeriodEnd
      ? new Date(sub.currentPeriodEnd).toISOString()
      : new Date(Date.now() + 365 * 86400000).toISOString(),
    isActive: user.status !== 'BANNED' && !user.isLocked,
    banned: user.status === 'BANNED',
    banReason: meta.banReason || '',
    allowedServerIds: Array.isArray(meta.allowedServerIds) ? meta.allowedServerIds : ['all'],
    notes: meta.notes || '',
    createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : null,
    lastLoginAt: user.lastSeenAt ? new Date(user.lastSeenAt).toISOString() : null,
    lastIp: user.lastIp || meta.lastIp || null,
    lastCountry: meta.lastCountry || null,
    lastDeviceId: meta.lastDeviceId || null,
    deviceIds: Array.isArray(meta.deviceIds) ? meta.deviceIds : [],
    lastClient: meta.lastClient || null,
    activeServerId: meta.activeServerId || null,
    maxParallel,
    sessionVersion: Number(meta.sessionVersion) || 0,
    pendingGoogleWipe: !!meta.pendingGoogleWipe,
    resellerId: ownerResellerId,
    ownerId,
    ownerAdminId,
    ownerResellerId,
    createdByAdminId: user.createdByAdminId || null,
    createdByResellerId: user.createdByResellerId || null,
    ownerLabel: ownerLabel || null,
    acquiredVia,
    planId: plan?.id || null,
    planName: plan?.name || 'Standard',
    displayPrice: sub?.displayPrice != null ? Number(sub.displayPrice) : Number(meta.displayPrice) || 0,
    role: user.role,
  };
}

async function buildOwnerLookup() {
  const admins = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
    select: { id: true, email: true, name: true },
  });
  const resellers = await prisma.resellerProfile.findMany({
    include: { user: { select: { email: true, name: true } } },
  });
  const adminMap = {};
  for (const a of admins) {
    adminMap[a.id] = a.name || usernameFromEmail(a.email) || a.email;
  }
  const resellerMap = {};
  for (const r of resellers) {
    const label =
      r.label ||
      r.user?.name ||
      usernameFromEmail(r.user?.email) ||
      r.user?.email ||
      r.id;
    resellerMap[r.id] = label;
    // also map by userId for createdByResellerId which stores user id in Flow9 schema
    resellerMap[r.userId] = label;
  }
  return { admins: adminMap, resellers: resellerMap };
}

async function findUserByLogin(username) {
  const raw = String(username || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  // Convenience: "admin" → SUPER_ADMIN
  if (lower === 'admin') {
    const superAdmin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
    if (superAdmin) return superAdmin;
  }

  const byEmail = await prisma.user.findFirst({
    where: { email: { equals: lower, mode: 'insensitive' } },
  });
  if (byEmail) return byEmail;

  const synthetic = emailFromUsername(raw);
  if (synthetic !== lower) {
    const bySynthetic = await prisma.user.findFirst({
      where: { email: { equals: synthetic, mode: 'insensitive' } },
    });
    if (bySynthetic) return bySynthetic;
  }

  // Match local-part uniquely
  const candidates = await prisma.user.findMany({
    where: { email: { startsWith: `${lower}@`, mode: 'insensitive' } },
    take: 2,
  });
  if (candidates.length === 1) return candidates[0];
  return null;
}

class Database {
  constructor() {
    this._ready = this.init();
  }

  async ready() {
    await this._ready;
  }

  async init() {
    // Branding
    await prisma.siteSettings.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        siteName: BRAND,
        contactEmail: 'support@flowcreator.ai',
      },
      update: {
        siteName: BRAND,
        contactEmail: 'support@flowcreator.ai',
      },
    });

    // Seed runtime from data.json.bak once if empty
    const runtime = await getJsonSetting(RUNTIME_KEY, null);
    if (!runtime) {
      let legacy = null;
      const src = fs.existsSync(DATA_BAK) ? DATA_BAK : DATA_JSON;
      try {
        if (fs.existsSync(src)) legacy = JSON.parse(fs.readFileSync(src, 'utf8'));
      } catch {
        legacy = null;
      }
      const settings = legacy?.settings || {};
      await setJsonSetting(RUNTIME_KEY, {
        appName: BRAND,
        siteName: BRAND,
        defaultTargetUrl: settings.defaultTargetUrl || 'https://flow.google.com',
        enableCreditTracking: settings.enableCreditTracking !== false,
        modelRenames: settings.modelRenames || [],
        cssSelectorsToHide: settings.cssSelectorsToHide || [],
        customCss: settings.customCss || '',
        downloads: settings.downloads || { windows: null, android: null },
        jwtSecret: process.env.JWT_SECRET || legacy?.admin?.jwtSecret || 'flow_super_secret_jwt_key_2026',
      });

      // Import Google shared accounts if table empty (table may not exist yet on older DBs)
      try {
        const count = await prisma.sharedGoogleAccount.count();
        if (count === 0 && Array.isArray(legacy?.servers)) {
          for (const s of legacy.servers) {
            await prisma.sharedGoogleAccount.create({
              data: {
                name: s.name || 'Google Account',
                targetUrl: s.targetUrl || 'https://flow.google.com',
                email: s.email || null,
                password: s.password || null,
                totpSecret: normalizeTotpSecret(s.totpSecret || ''),
                isActive: s.isActive !== false,
              },
            });
          }
        }
      } catch (err) {
        console.warn('[db] SharedGoogleAccount not ready yet:', err?.code || err?.message || err);
      }
    }

    // Ensure catalog plans exist (do not overwrite existing credit fields in DB for ops —
    // marketing UI hardcodes STD; admin plan fill uses hardcoded map).
    const planNames = ['Free', 'Starter', 'Pro', 'Business'];
    for (const name of planNames) {
      const existing = await prisma.plan.findFirst({ where: { name } });
      if (!existing) {
        const std = hardcodedStdForPlanName(name) || 0;
        await prisma.plan.create({
          data: {
            name,
            maxParallel: name === 'Free' ? 1 : name === 'Starter' ? 3 : name === 'Pro' ? 5 : 10,
            priceMonthly: name === 'Free' ? 0 : name === 'Starter' ? 29 : name === 'Pro' ? 79 : 199,
            standardCreditsCycle: std,
            proCreditsCycle: 0,
            contactSeller: true,
            isActive: true,
            description: `${name} plan for ${BRAND}`,
          },
        });
      }
    }
  }

  // ── Admin identity ─────────────────────────────────────────────
  async getAdmin() {
    await this.ready();
    const runtime = await getRuntime();
    const superAdmin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
    return {
      id: superAdmin?.id || 'admin',
      username: superAdmin ? usernameFromEmail(superAdmin.email) : 'admin',
      email: superAdmin?.email || 'admin@googleflow.saas',
      passwordHash: superAdmin?.passwordHash || bcrypt.hashSync('Admin@123456', 10),
      jwtSecret: process.env.JWT_SECRET || runtime.jwtSecret,
      role: 'SUPER_ADMIN',
      isActive: superAdmin ? superAdmin.status !== 'BANNED' && !superAdmin.isLocked : true,
    };
  }

  async updateAdminPassword(newPassword) {
    await this.ready();
    const superAdmin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
    if (!superAdmin) throw new Error('Super admin not found');
    await prisma.user.update({
      where: { id: superAdmin.id },
      data: { passwordHash: bcrypt.hashSync(newPassword, 10) },
    });
    return true;
  }

  // ── Settings ───────────────────────────────────────────────────
  async getSettings() {
    await this.ready();
    const site = await prisma.siteSettings.findUnique({ where: { id: 'default' } });
    const runtime = await getRuntime();
    return {
      ...runtime,
      siteName: site?.siteName || BRAND,
      appName: site?.siteName || BRAND,
      logoUrl: site?.logoUrl || '',
      contactEmail: site?.contactEmail || 'support@flowcreator.ai',
      allowSignups: site?.allowSignups !== false,
      ticketSystemEnabled: site?.ticketSystemEnabled !== false,
      contactPageEnabled: site?.contactPageEnabled !== false,
      maintenanceMode: !!site?.maintenanceMode,
      socialLinks: site?.socialLinks || {},
      downloads: runtime.downloads || { windows: null, android: null },
      clientApiVersion: normalizeClientApiVersion(runtime.clientApiVersion),
    };
  }

  async updateSettings(newSettings) {
    await this.ready();
    const body = { ...(newSettings || {}) };
    const sitePatch = {};
    if (body.siteName !== undefined || body.appName !== undefined) {
      const name = String(body.siteName || body.appName || BRAND).trim() || BRAND;
      sitePatch.siteName = name;
      body.appName = name;
      body.siteName = name;
    }
    if (body.logoUrl !== undefined) sitePatch.logoUrl = body.logoUrl || null;
    if (body.contactEmail !== undefined) sitePatch.contactEmail = String(body.contactEmail || '');
    if (body.allowSignups !== undefined) sitePatch.allowSignups = !!body.allowSignups;
    if (body.ticketSystemEnabled !== undefined) sitePatch.ticketSystemEnabled = !!body.ticketSystemEnabled;
    if (body.contactPageEnabled !== undefined) sitePatch.contactPageEnabled = !!body.contactPageEnabled;
    if (body.maintenanceMode !== undefined) sitePatch.maintenanceMode = !!body.maintenanceMode;
    if (body.socialLinks !== undefined) sitePatch.socialLinks = body.socialLinks;

    if (Object.keys(sitePatch).length) {
      await prisma.siteSettings.upsert({
        where: { id: 'default' },
        create: { id: 'default', siteName: BRAND, ...sitePatch },
        update: sitePatch,
      });
    }

    const runtimeKeys = [
      'defaultTargetUrl',
      'enableCreditTracking',
      'modelRenames',
      'cssSelectorsToHide',
      'customCss',
      'downloads',
      'appName',
      'jwtSecret',
      'clientApiVersion',
    ];
    const runtimePatch = {};
    for (const k of runtimeKeys) {
      if (body[k] !== undefined) runtimePatch[k] = body[k];
    }
    if (runtimePatch.clientApiVersion !== undefined) {
      runtimePatch.clientApiVersion = normalizeClientApiVersion(runtimePatch.clientApiVersion);
    }
    if (Object.keys(runtimePatch).length) await patchRuntime(runtimePatch);
    return this.getSettings();
  }

  // ── Users (CUSTOMER) ───────────────────────────────────────────
  async getUsers() {
    await this.ready();
    const rows = await prisma.user.findMany({
      where: { role: 'CUSTOMER' },
      orderBy: { createdAt: 'desc' },
    });
    const meta = await getUserMetaMap();
    const owners = await buildOwnerLookup();
    const out = [];
    for (const row of rows) out.push(await mapCustomer(row, meta, owners));
    return out;
  }

  async getUserById(id) {
    await this.ready();
    const row = await prisma.user.findFirst({ where: { id, role: 'CUSTOMER' } });
    if (!row) return null;
    const meta = await getUserMetaMap();
    const owners = await buildOwnerLookup();
    return mapCustomer(row, meta, owners);
  }

  async getUserByUsername(username) {
    await this.ready();
    const row = await findUserByLogin(username);
    if (!row || row.role !== 'CUSTOMER') return null;
    const meta = await getUserMetaMap();
    const owners = await buildOwnerLookup();
    return mapCustomer(row, meta, owners);
  }

  async usernameTaken(username, except = {}) {
    await this.ready();
    const email = emailFromUsername(username);
    const row = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (!row) return false;
    if (except.userId && row.id === except.userId) return false;
    if (except.systemUserId && row.id === except.systemUserId) return false;
    if (except.resellerId && row.id === except.resellerId) return false;
    if (except.kind === 'admin' && row.role === 'SUPER_ADMIN') return false;
    return true;
  }

  async createUser(userData) {
    await this.ready();
    const username = String(userData.username || '').trim();
    if (!username || !userData.password) throw new Error('Username and password are required');
    if (await this.usernameTaken(username)) throw new Error('Username already exists');

    const email = emailFromUsername(username);
    let credits = Number(userData.credits);
    if (!Number.isFinite(credits)) credits = 0;

    let planId = userData.planId || null;
    if (planId) {
      const plan = await prisma.plan.findUnique({ where: { id: planId } });
      if (!plan) throw new Error('Plan not found');
      const hard = hardcodedStdForPlanName(plan.name);
      if (hard != null && (userData.credits === undefined || userData.credits === null || userData.credits === '')) {
        credits = hard;
      }
    }

    const resellerProfileId = userData.resellerId || null;
    let resellerProfile = null;
    if (resellerProfileId) {
      resellerProfile = await prisma.resellerProfile.findUnique({ where: { id: resellerProfileId } });
      if (!resellerProfile) {
        // maybe they passed userId
        resellerProfile = await prisma.resellerProfile.findFirst({ where: { userId: resellerProfileId } });
      }
      if (!resellerProfile) throw new Error('Reseller not found');
    }

    const ownedByAdminId = userData.ownerId || userData.ownedByAdminId || null;
    const createdByAdminId = userData.createdByAdminId || ownedByAdminId || null;
    const createdByResellerId = resellerProfile?.userId || userData.createdByResellerId || null;

    const planExpiry = userData.planExpiry
      ? new Date(userData.planExpiry)
      : new Date(Date.now() + 30 * 86400000);

    const banned = userData.banned === true;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: bcrypt.hashSync(userData.password, 10),
        name: userData.displayName ? String(userData.displayName).trim() : username,
        role: 'CUSTOMER',
        status: banned || userData.isActive === false ? 'BANNED' : 'ACTIVE',
        isLocked: userData.isActive === false && !banned ? true : false,
        ownedByAdminId: ownedByAdminId || resellerProfile?.parentAdminId || null,
        createdByAdminId,
        createdByResellerId,
        acquiredVia: createdByResellerId ? 'RESELLER' : createdByAdminId ? 'ADMIN_MANUAL' : 'SIGNUP',
      },
    });

    await ensureWallets(user.id);
    await setStdBalance(user.id, credits, {
      type: 'GRANT',
      adminId: createdByAdminId || null,
      reason: createdByResellerId ? 'reseller_create_user' : 'admin_create_user',
    });

    if (planId) {
      await prisma.subscription.create({
        data: {
          userId: user.id,
          planId,
          status: 'ACTIVE',
          currentPeriodStart: new Date(),
          currentPeriodEnd: planExpiry,
          displayPrice: userData.displayPrice != null ? Number(userData.displayPrice) : null,
          maxParallelOverride:
            userData.maxParallel != null ? clampParallel(userData.maxParallel) : null,
          isCustomDeal: true,
        },
      });
    } else if (userData.maxParallel != null || userData.planExpiry) {
      const free = await prisma.plan.findFirst({ where: { name: 'Free' } });
      if (free) {
        await prisma.subscription.create({
          data: {
            userId: user.id,
            planId: free.id,
            status: 'ACTIVE',
            currentPeriodStart: new Date(),
            currentPeriodEnd: planExpiry,
            maxParallelOverride:
              userData.maxParallel != null ? clampParallel(userData.maxParallel) : null,
            isCustomDeal: true,
          },
        });
        planId = free.id;
      }
    }

    if (resellerProfile) {
      try {
        const planForSeat = planId
          ? await prisma.plan.findUnique({ where: { id: planId } })
          : null;
        if (!planForSeat) {
          throw new Error('A plan is required when a reseller adds a user');
        }
        const mk = monthKey();
        const grant = await prisma.resellerSeatGrant.findUnique({
          where: {
            resellerProfileId_planId_monthKey: {
              resellerProfileId: resellerProfile.id,
              planId: planForSeat.id,
              monthKey: mk,
            },
          },
        });
        if (!grant) {
          throw new Error(
            `No seat quota for plan "${planForSeat.name}". Ask your admin to allocate seats for this plan.`
          );
        }
        if (grant.seatsUsed >= grant.seatsAllocated) {
          throw new Error(
            `Reseller seat quota exceeded for ${planForSeat.name} (${grant.seatsUsed}/${grant.seatsAllocated})`
          );
        }
        await prisma.resellerSeatGrant.update({
          where: { id: grant.id },
          data: { seatsUsed: { increment: 1 } },
        });
        await prisma.resellerUserAssignment.create({
          data: {
            resellerProfileId: resellerProfile.id,
            customerId: user.id,
            planId: planForSeat.id,
            displayPrice: Number(userData.displayPrice) || 0,
          },
        });
      } catch (err) {
        await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
        throw err;
      }
    }

    await patchUserMeta(user.id, {
      notes: userData.notes || '',
      allowedServerIds: Array.isArray(userData.allowedServerIds) ? userData.allowedServerIds : ['all'],
      activeServerId: null,
      maxParallel: clampParallel(userData.maxParallel),
      displayPrice: Number(userData.displayPrice) || 0,
      banReason: '',
    });

    return this.getUserById(user.id);
  }

  async updateUser(id, updates) {
    await this.ready();
    const existing = await prisma.user.findFirst({ where: { id, role: 'CUSTOMER' } });
    if (!existing) return null;

    const data = {};
    if (updates.password && String(updates.password).trim()) {
      data.passwordHash = bcrypt.hashSync(updates.password, 10);
    }
    if (updates.displayName !== undefined) data.name = String(updates.displayName || '').trim();
    if (updates.username && updates.username !== existing.email) {
      const email = emailFromUsername(updates.username);
      if (await this.usernameTaken(updates.username, { userId: id })) {
        throw new Error('Username already taken by another user');
      }
      data.email = email;
    }
    if (updates.banned !== undefined) {
      data.status = updates.banned ? 'BANNED' : 'ACTIVE';
      if (!updates.banned) data.isLocked = false;
    } else if (updates.isActive !== undefined) {
      if (updates.isActive) {
        data.status = 'ACTIVE';
        data.isLocked = false;
      } else {
        data.isLocked = true;
      }
    }
    if (updates.lastLoginAt !== undefined) {
      data.lastSeenAt = updates.lastLoginAt ? new Date(updates.lastLoginAt) : null;
    }
    if (updates.lastIp !== undefined) {
      data.lastIp = updates.lastIp ? String(updates.lastIp) : null;
    }
    if (updates.ownerId !== undefined || updates.ownedByAdminId !== undefined) {
      data.ownedByAdminId = updates.ownedByAdminId || updates.ownerId || null;
    }
    if (updates.resellerId !== undefined) {
      if (!updates.resellerId) {
        data.createdByResellerId = null;
      } else {
        const rp =
          (await prisma.resellerProfile.findUnique({ where: { id: updates.resellerId } })) ||
          (await prisma.resellerProfile.findFirst({ where: { userId: updates.resellerId } }));
        data.createdByResellerId = rp ? rp.userId : null;
        if (rp) data.ownedByAdminId = rp.parentAdminId;
      }
    }

    if (Object.keys(data).length) {
      await prisma.user.update({ where: { id }, data });
    }

    if (updates.credits !== undefined) {
      await setStdBalance(id, updates.credits, {
        type: 'ADMIN_ADJUSTMENT',
        adminId: updates.adminId || updates.actorId || null,
        reason: updates.creditReason || 'admin_set_credits',
      });
    }

    const metaPatch = {};
    if (updates.notes !== undefined) metaPatch.notes = updates.notes;
    if (updates.allowedServerIds !== undefined) metaPatch.allowedServerIds = updates.allowedServerIds;
    if (updates.activeServerId !== undefined) metaPatch.activeServerId = updates.activeServerId || null;
    if (updates.maxParallel !== undefined) metaPatch.maxParallel = clampParallel(updates.maxParallel);
    if (updates.displayPrice !== undefined) metaPatch.displayPrice = Number(updates.displayPrice) || 0;
    if (updates.banReason !== undefined) metaPatch.banReason = updates.banReason || '';
    if (updates.lastCountry !== undefined) metaPatch.lastCountry = updates.lastCountry || '';
    if (updates.lastDeviceId !== undefined) metaPatch.lastDeviceId = updates.lastDeviceId || '';
    if (updates.lastClient !== undefined) metaPatch.lastClient = updates.lastClient || '';
    if (updates.lastIp !== undefined) metaPatch.lastIp = updates.lastIp || '';
    if (updates.deviceIds !== undefined) metaPatch.deviceIds = Array.isArray(updates.deviceIds) ? updates.deviceIds : [];
    if (Object.keys(metaPatch).length) await patchUserMeta(id, metaPatch);

    if (
      updates.planId !== undefined ||
      updates.planExpiry !== undefined ||
      updates.maxParallel !== undefined ||
      updates.displayPrice !== undefined
    ) {
      const sub = await activeSubscription(id);
      const planId = updates.planId || sub?.planId;
      if (planId) {
        const plan = await prisma.plan.findUnique({ where: { id: planId } });
        if (!plan) throw new Error('Plan not found');
        if (updates.planId && updates.credits === undefined) {
          const hard = hardcodedStdForPlanName(plan.name);
          if (hard != null) {
            await setStdBalance(id, hard, {
              type: 'ADMIN_ADJUSTMENT',
              adminId: updates.adminId || updates.actorId || null,
              reason: `plan_change:${plan.name}`,
            });
          }
        }
        const periodEnd = updates.planExpiry
          ? new Date(updates.planExpiry)
          : sub?.currentPeriodEnd || new Date(Date.now() + 30 * 86400000);
        if (sub) {
          await prisma.subscription.update({
            where: { id: sub.id },
            data: {
              planId,
              currentPeriodEnd: periodEnd,
              maxParallelOverride:
                updates.maxParallel !== undefined
                  ? clampParallel(updates.maxParallel)
                  : sub.maxParallelOverride,
              displayPrice:
                updates.displayPrice !== undefined
                  ? Number(updates.displayPrice)
                  : sub.displayPrice,
            },
          });
        } else {
          await prisma.subscription.create({
            data: {
              userId: id,
              planId,
              status: 'ACTIVE',
              currentPeriodStart: new Date(),
              currentPeriodEnd: periodEnd,
              maxParallelOverride:
                updates.maxParallel !== undefined ? clampParallel(updates.maxParallel) : null,
              displayPrice:
                updates.displayPrice !== undefined ? Number(updates.displayPrice) : null,
              isCustomDeal: true,
            },
          });
        }
      }
    }

    return this.getUserById(id);
  }

  async deductUserCredits(id, amount) {
    await this.ready();
    const current = await getStdBalance(id);
    const next = current - Math.abs(Number(amount) || 0);
    await setStdBalance(id, next, { type: 'SPEND', reason: 'use_credit' });
    return next;
  }

  async bumpSessionVersion(userId) {
    await this.ready();
    const map = await getUserMetaMap();
    const cur = Number(map[userId]?.sessionVersion) || 0;
    const next = cur + 1;
    await patchUserMeta(userId, { sessionVersion: next });
    return next;
  }

  async setPendingGoogleWipe(userId, value = true) {
    await this.ready();
    await patchUserMeta(userId, { pendingGoogleWipe: !!value });
    return !!value;
  }

  async clearPendingGoogleWipe(userId) {
    await this.ready();
    await patchUserMeta(userId, { pendingGoogleWipe: false });
    return true;
  }

  /** Invalidate JWT session and flag Google cookie wipe for the next client poll. */
  async forceLogoutAndWipe(userId) {
    await this.ready();
    const sv = await this.bumpSessionVersion(userId);
    await this.setPendingGoogleWipe(userId, true);
    return { sessionVersion: sv, pendingGoogleWipe: true };
  }

  async deleteUser(id) {
    await this.ready();
    try {
      await prisma.user.delete({ where: { id } });
      const meta = await getUserMetaMap();
      if (meta[id]) {
        delete meta[id];
        await setJsonSetting(USER_META_KEY, meta);
      }
      return true;
    } catch {
      return false;
    }
  }

  // ── Shared Google accounts (servers) ───────────────────────────
  async getServers() {
    await this.ready();
    try {
      const rows = await prisma.sharedGoogleAccount.findMany({ orderBy: { createdAt: 'asc' } });
      return rows.map((s) => {
        const passwordPlain = openFromStorage(s.password || '');
        const totpPlain = openFromStorage(s.totpSecret || '');
        const totpNorm = normalizeTotpSecret(totpPlain) || totpPlain;
        // Lazy migrate legacy plaintext → AES-GCM at rest
        if (
          (s.password && !isEncrypted(s.password)) ||
          (s.totpSecret && !isEncrypted(s.totpSecret))
        ) {
          prisma.sharedGoogleAccount
            .update({
              where: { id: s.id },
              data: {
                password: sealForStorage(passwordPlain),
                totpSecret: sealForStorage(totpNorm),
              },
            })
            .catch((err) => console.warn('[db] secret migrate failed', s.id, err.message));
        }
        return {
          id: s.id,
          name: s.name,
          targetUrl: s.targetUrl,
          email: s.email || '',
          password: passwordPlain,
          totpSecret: totpNorm,
          isActive: s.isActive !== false,
          createdAt: s.createdAt.toISOString(),
        };
      });
    } catch (err) {
      if (err?.code === 'P2021') {
        console.warn('[db] SharedGoogleAccount table missing — run: cd dashboard && npx prisma db push');
        return [];
      }
      throw err;
    }
  }

  async getServerById(id) {
    const rows = await this.getServers();
    return rows.find((s) => s.id === id) || null;
  }

  async createServer(serverData) {
    await this.ready();
    const totp = normalizeTotpSecret(serverData.totpSecret);
    const row = await prisma.sharedGoogleAccount.create({
      data: {
        name: String(serverData.name || '').trim(),
        targetUrl: serverData.targetUrl || 'https://flow.google.com',
        email: serverData.email ? String(serverData.email).trim() : null,
        password: sealForStorage(serverData.password || ''),
        totpSecret: sealForStorage(totp),
        isActive: serverData.isActive !== undefined ? !!serverData.isActive : true,
      },
    });
    return this.getServerById(row.id);
  }

  async updateServer(id, updates) {
    await this.ready();
    const data = {};
    if (updates.name !== undefined) data.name = String(updates.name).trim();
    if (updates.targetUrl !== undefined) data.targetUrl = String(updates.targetUrl).trim();
    if (updates.email !== undefined) data.email = String(updates.email || '').trim();
    if (updates.password !== undefined) data.password = sealForStorage(updates.password);
    if (updates.totpSecret !== undefined) data.totpSecret = sealForStorage(normalizeTotpSecret(updates.totpSecret));
    if (updates.isActive !== undefined) data.isActive = !!updates.isActive;
    try {
      await prisma.sharedGoogleAccount.update({ where: { id }, data });
    } catch {
      return null;
    }
    return this.getServerById(id);
  }

  async deleteServer(id) {
    await this.ready();
    try {
      await prisma.sharedGoogleAccount.delete({ where: { id } });
    } catch {
      return false;
    }
    // Clear assignments so clients drop this Google account on next check/login
    try {
      const meta = await getUserMetaMap();
      for (const [uid, m] of Object.entries(meta || {})) {
        if (m?.activeServerId === id) {
          await this.updateUser(uid, { activeServerId: null });
        }
      }
    } catch (err) {
      console.warn('[db] clear assignments after deleteServer:', err.message);
    }
    return true;
  }

  async assignmentCounts() {
    const meta = await getUserMetaMap();
    const counts = Object.create(null);
    for (const m of Object.values(meta)) {
      if (!m?.activeServerId) continue;
      counts[m.activeServerId] = (counts[m.activeServerId] || 0) + 1;
    }
    return counts;
  }

  async pickLeastLoadedServer(availableServers, excludeUserId = null) {
    if (!availableServers.length) return null;
    const withTotp = availableServers.filter((s) => s.totpSecret && String(s.totpSecret).trim());
    const pool = withTotp.length ? withTotp : availableServers;
    const meta = await getUserMetaMap();
    const counts = Object.create(null);
    for (const server of pool) counts[server.id] = 0;
    for (const [uid, m] of Object.entries(meta)) {
      if (excludeUserId && uid === excludeUserId) continue;
      if (m?.activeServerId && counts[m.activeServerId] !== undefined) {
        counts[m.activeServerId] += 1;
      }
    }
    return pool.slice().sort((a, b) => {
      const ca = counts[a.id] || 0;
      const cb = counts[b.id] || 0;
      if (ca !== cb) return ca - cb;
      return String(a.name || '').localeCompare(String(b.name || ''));
    })[0];
  }

  // ── System users (ADMIN) ───────────────────────────────────────
  async getSystemUsers() {
    await this.ready();
    const rows = await prisma.user.findMany({
      where: { role: 'ADMIN' },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((u) => ({
      id: u.id,
      username: usernameFromEmail(u.email),
      email: u.email,
      displayName: u.name || '',
      passwordHash: u.passwordHash,
      role: 'ADMIN',
      isActive: u.status !== 'BANNED' && !u.isLocked,
      banned: u.status === 'BANNED',
      createdAt: u.createdAt.toISOString(),
    }));
  }

  async getSystemUserById(id) {
    const rows = await this.getSystemUsers();
    return rows.find((u) => u.id === id) || null;
  }

  async getSystemUserByUsername(username) {
    await this.ready();
    const row = await findUserByLogin(username);
    if (!row || row.role !== 'ADMIN') return null;
    return {
      id: row.id,
      username: usernameFromEmail(row.email),
      email: row.email,
      displayName: row.name || '',
      passwordHash: row.passwordHash,
      role: 'ADMIN',
      isActive: row.status !== 'BANNED' && !row.isLocked,
      banned: row.status === 'BANNED',
      createdAt: row.createdAt.toISOString(),
    };
  }

  async createSystemUser(userData) {
    await this.ready();
    const username = String(userData.username || '').trim();
    if (!username || !userData.password) throw new Error('Username and password are required');
    if (await this.usernameTaken(username)) throw new Error('Username already exists');
    const email = emailFromUsername(username);
    const banned = userData.banned === true || userData.isActive === false;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: bcrypt.hashSync(userData.password, 10),
        name: userData.displayName ? String(userData.displayName).trim() : username,
        role: 'ADMIN',
        status: banned ? 'BANNED' : 'ACTIVE',
        isLocked: userData.isActive === false && !userData.banned ? true : false,
      },
    });
    return this.getSystemUserById(user.id);
  }

  async updateSystemUser(id, updates) {
    await this.ready();
    const existing = await prisma.user.findFirst({ where: { id, role: 'ADMIN' } });
    if (!existing) return null;
    const data = {};
    if (updates.username && updates.username.trim().toLowerCase() !== existing.email.toLowerCase()) {
      if (await this.usernameTaken(updates.username, { systemUserId: id })) {
        throw new Error('Username already exists');
      }
      data.email = emailFromUsername(updates.username);
    }
    if (updates.displayName !== undefined) data.name = String(updates.displayName || '').trim();
    if (updates.password && String(updates.password).trim()) {
      data.passwordHash = bcrypt.hashSync(updates.password, 10);
    }
    if (updates.banned !== undefined) {
      data.status = updates.banned ? 'BANNED' : 'ACTIVE';
      if (!updates.banned) data.isLocked = false;
    } else if (updates.isActive !== undefined) {
      if (updates.isActive) {
        data.status = 'ACTIVE';
        data.isLocked = false;
      } else {
        data.isLocked = true;
      }
    }
    await prisma.user.update({ where: { id }, data });
    return this.getSystemUserById(id);
  }

  async deleteSystemUser(id) {
    await this.ready();
    try {
      await prisma.user.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  // ── Resellers ──────────────────────────────────────────────────
  async getResellers() {
    await this.ready();
    const rows = await prisma.resellerProfile.findMany({
      include: {
        user: true,
        seatGrants: { include: { plan: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      parentAdminId: r.parentAdminId,
      username: usernameFromEmail(r.user.email),
      email: r.user.email,
      displayName: r.label || r.user.name || '',
      passwordHash: r.user.passwordHash,
      isActive: r.isActive && r.user.status !== 'BANNED' && !r.user.isLocked,
      banned: r.user.status === 'BANNED',
      notes: r.deactivationMessage || '',
      createdAt: r.createdAt.toISOString(),
      seatGrants: (r.seatGrants || [])
        .filter((g) => g.monthKey === monthKey())
        .map((g) => ({
          id: g.id,
          planId: g.planId,
          planName: g.plan?.name || '',
          monthKey: g.monthKey,
          seatsAllocated: g.seatsAllocated,
          seatsUsed: g.seatsUsed,
          wholesalePrice: g.wholesalePrice,
        })),
    }));
  }

  async getResellerById(id) {
    const rows = await this.getResellers();
    return rows.find((r) => r.id === id || r.userId === id) || null;
  }

  async getResellerByUsername(username) {
    await this.ready();
    const row = await findUserByLogin(username);
    if (!row || row.role !== 'RESELLER') return null;
    return this.getResellerById(row.id);
  }

  async createReseller(resellerData) {
    await this.ready();
    const username = String(resellerData.username || '').trim();
    if (!username || !resellerData.password) throw new Error('Username and password are required');
    if (await this.usernameTaken(username)) throw new Error('Username already exists');
    const parentAdminId = resellerData.parentAdminId || (await this.getAdmin()).id;
    const email = emailFromUsername(username);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: bcrypt.hashSync(resellerData.password, 10),
        name: resellerData.displayName ? String(resellerData.displayName).trim() : username,
        role: 'RESELLER',
        status: 'ACTIVE',
      },
    });
    const profile = await prisma.resellerProfile.create({
      data: {
        userId: user.id,
        parentAdminId,
        label: resellerData.displayName || username,
        isActive: resellerData.isActive !== false,
        deactivationMessage: resellerData.notes || null,
      },
    });

    // Optional seat grants: [{ planId, seatsAllocated, wholesalePrice }]
    if (Array.isArray(resellerData.seatGrants)) {
      const mk = monthKey();
      for (const g of resellerData.seatGrants) {
        if (!g.planId) continue;
        await prisma.resellerSeatGrant.create({
          data: {
            resellerProfileId: profile.id,
            planId: g.planId,
            monthKey: mk,
            seatsAllocated: Math.max(0, Number(g.seatsAllocated) || 0),
            seatsUsed: 0,
            wholesalePrice: Number(g.wholesalePrice) || 0,
          },
        });
      }
    }

    return this.getResellerById(profile.id);
  }

  async updateReseller(id, updates) {
    await this.ready();
    const profile =
      (await prisma.resellerProfile.findUnique({ where: { id }, include: { user: true } })) ||
      (await prisma.resellerProfile.findFirst({ where: { userId: id }, include: { user: true } }));
    if (!profile) return null;

    const userData = {};
    if (updates.username && updates.username.trim().toLowerCase() !== profile.user.email.toLowerCase()) {
      if (await this.usernameTaken(updates.username, { resellerId: profile.userId })) {
        throw new Error('Username already exists');
      }
      userData.email = emailFromUsername(updates.username);
    }
    if (updates.displayName !== undefined) userData.name = String(updates.displayName || '').trim();
    if (updates.password && String(updates.password).trim()) {
      userData.passwordHash = bcrypt.hashSync(updates.password, 10);
    }
    if (updates.banned !== undefined) {
      userData.status = updates.banned ? 'BANNED' : 'ACTIVE';
      if (!updates.banned) userData.isLocked = false;
    } else if (updates.isActive !== undefined) {
      if (updates.isActive) {
        userData.status = 'ACTIVE';
        userData.isLocked = false;
      } else {
        userData.isLocked = true;
      }
    }
    if (Object.keys(userData).length) {
      await prisma.user.update({ where: { id: profile.userId }, data: userData });
    }

    const profileData = {};
    if (updates.displayName !== undefined) profileData.label = String(updates.displayName || '').trim();
    if (updates.isActive !== undefined) profileData.isActive = !!updates.isActive;
    if (updates.banned === true) profileData.isActive = false;
    if (updates.banned === false) profileData.isActive = true;
    if (updates.notes !== undefined) profileData.deactivationMessage = updates.notes || null;
    if (Object.keys(profileData).length) {
      await prisma.resellerProfile.update({ where: { id: profile.id }, data: profileData });
    }

    // Replace/update seat grants for current month when provided
    if (Array.isArray(updates.seatGrants)) {
      const mk = monthKey();
      const keepPlanIds = new Set();
      for (const g of updates.seatGrants) {
        if (!g.planId) continue;
        keepPlanIds.add(g.planId);
        await prisma.resellerSeatGrant.upsert({
          where: {
            resellerProfileId_planId_monthKey: {
              resellerProfileId: profile.id,
              planId: g.planId,
              monthKey: mk,
            },
          },
          create: {
            resellerProfileId: profile.id,
            planId: g.planId,
            monthKey: mk,
            seatsAllocated: Math.max(0, Number(g.seatsAllocated) || 0),
            seatsUsed: 0,
            wholesalePrice: Number(g.wholesalePrice) || 0,
          },
          update: {
            seatsAllocated: Math.max(0, Number(g.seatsAllocated) || 0),
            wholesalePrice:
              g.wholesalePrice !== undefined ? Number(g.wholesalePrice) || 0 : undefined,
          },
        });
      }
      // Remove current-month grants not in the submitted list
      const existing = await prisma.resellerSeatGrant.findMany({
        where: { resellerProfileId: profile.id, monthKey: mk },
      });
      for (const g of existing) {
        if (!keepPlanIds.has(g.planId)) {
          await prisma.resellerSeatGrant.delete({ where: { id: g.id } });
        }
      }
    }

    return this.getResellerById(profile.id);
  }

  async deleteReseller(id) {
    await this.ready();
    const profile =
      (await prisma.resellerProfile.findUnique({ where: { id } })) ||
      (await prisma.resellerProfile.findFirst({ where: { userId: id } }));
    if (!profile) return false;
    const userId = profile.userId;
    await prisma.resellerProfile.delete({ where: { id: profile.id } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    return true;
  }

  // ── Plans ──────────────────────────────────────────────────────
  async getPlans() {
    await this.ready();
    const rows = await prisma.plan.findMany({ orderBy: { priceMonthly: 'asc' } });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description || '',
      priceMonthly: p.priceMonthly,
      contactSeller: !!p.contactSeller,
      maxParallel: p.maxParallel,
      standardCreditsCycle: p.standardCreditsCycle,
      proCreditsCycle: p.proCreditsCycle,
      features: Array.isArray(p.features) ? p.features : [],
      isActive: p.isActive !== false,
      createdAt: p.createdAt.toISOString(),
    }));
  }

  async getPlanById(id) {
    const plans = await this.getPlans();
    return plans.find((p) => p.id === id) || null;
  }

  async createPlan(plan) {
    await this.ready();
    const name = String(plan.name || '').trim();
    if (!name) throw new Error('Plan name is required');
    const hard = hardcodedStdForPlanName(name);
    const row = await prisma.plan.create({
      data: {
        name,
        description: plan.description || '',
        priceMonthly: Number(plan.priceMonthly ?? plan.price) || 0,
        contactSeller: plan.contactSeller !== undefined ? !!plan.contactSeller : true,
        maxParallel: clampParallel(plan.maxParallel),
        standardCreditsCycle:
          hard != null
            ? hard
            : Math.max(0, Number(plan.standardCreditsCycle ?? plan.credits) || 0),
        proCreditsCycle: Math.max(0, Number(plan.proCreditsCycle) || 0),
        features: Array.isArray(plan.features) ? plan.features.map(String) : [],
        isActive: plan.isActive !== undefined ? !!plan.isActive : true,
      },
    });
    return this.getPlanById(row.id);
  }

  async updatePlan(id, updates) {
    await this.ready();
    const data = {};
    if (updates.name !== undefined) {
      const name = String(updates.name || '').trim();
      if (!name) throw new Error('Plan name is required');
      data.name = name;
    }
    if (updates.description !== undefined) data.description = updates.description || '';
    if (updates.priceMonthly !== undefined || updates.price !== undefined) {
      data.priceMonthly = Number(updates.priceMonthly ?? updates.price) || 0;
    }
    if (updates.contactSeller !== undefined) data.contactSeller = !!updates.contactSeller;
    if (updates.maxParallel !== undefined) data.maxParallel = clampParallel(updates.maxParallel);
    if (updates.standardCreditsCycle !== undefined || updates.credits !== undefined) {
      data.standardCreditsCycle = Math.max(
        0,
        Number(updates.standardCreditsCycle ?? updates.credits) || 0
      );
    }
    if (updates.proCreditsCycle !== undefined) {
      data.proCreditsCycle = Math.max(0, Number(updates.proCreditsCycle) || 0);
    }
    if (updates.features !== undefined) {
      data.features = Array.isArray(updates.features) ? updates.features.map(String) : [];
    }
    if (updates.isActive !== undefined) data.isActive = !!updates.isActive;
    try {
      await prisma.plan.update({ where: { id }, data });
    } catch {
      return null;
    }
    return this.getPlanById(id);
  }

  async deletePlan(id) {
    await this.ready();
    try {
      await prisma.plan.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  // ── Notices ────────────────────────────────────────────────────
  async getNotices() {
    await this.ready();
    const rows = await prisma.notice.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      severity: n.severity,
      isActive: n.isActive,
      createdAt: n.createdAt.toISOString(),
    }));
  }

  async getActiveNotices() {
    await this.ready();
    const rows = await prisma.notice.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      severity: n.severity,
      isActive: n.isActive,
      createdAt: n.createdAt.toISOString(),
    }));
  }

  async createNotice(notice) {
    await this.ready();
    const title = String(notice.title || '').trim();
    const body = String(notice.body || '').trim();
    if (!title || !body) throw new Error('Title and body are required');
    const severity = ['INFO', 'WARNING', 'SUCCESS'].includes(notice.severity) ? notice.severity : 'INFO';
    const row = await prisma.notice.create({
      data: {
        title,
        body,
        severity,
        isActive: notice.isActive !== false,
      },
    });
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      severity: row.severity,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async updateNotice(id, updates) {
    await this.ready();
    const data = {};
    if (updates.title !== undefined) data.title = String(updates.title || '').trim();
    if (updates.body !== undefined) data.body = String(updates.body || '').trim();
    if (updates.isActive !== undefined) data.isActive = !!updates.isActive;
    if (updates.severity && ['INFO', 'WARNING', 'SUCCESS'].includes(updates.severity)) {
      data.severity = updates.severity;
    }
    try {
      const row = await prisma.notice.update({ where: { id }, data });
      return {
        id: row.id,
        title: row.title,
        body: row.body,
        severity: row.severity,
        isActive: row.isActive,
        createdAt: row.createdAt.toISOString(),
      };
    } catch {
      return null;
    }
  }

  async deleteNotice(id) {
    await this.ready();
    try {
      await prisma.notice.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  // ── Logs ───────────────────────────────────────────────────────
  async addLog(userId, username, action, details = {}) {
    await this.ready();
    try {
      await prisma.systemLog.create({
        data: {
          category: 'SYSTEM',
          level: 'INFO',
          message: `${action}${username ? ` by ${username}` : ''}`,
          userId: typeof userId === 'string' && userId.length > 20 ? userId : null,
          details: { action, username, ...(details || {}) },
        },
      });
    } catch (err) {
      console.error('addLog failed', err.message);
    }
    return { action, username, details, timestamp: new Date().toISOString() };
  }

  async getLogs(limit = 100) {
    await this.ready();
    const rows = await prisma.systemLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, Number(limit) || 100),
    });
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      username: r.details?.username || null,
      action: r.details?.action || r.message,
      details: r.details || {},
      timestamp: r.createdAt.toISOString(),
    }));
  }

  async getUserCreditHistory(userId, limit = 50) {
    await this.ready();
    const rows = await prisma.creditLedger.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, Number(limit) || 50),
    });
    return rows.map((r) => ({
      id: r.id,
      walletType: r.walletType,
      amount: r.amount,
      balanceAfter: r.balanceAfter,
      type: r.type,
      reason: r.reason || null,
      adminId: r.adminId || null,
      jobId: r.jobId || null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async getUserActivity(userId, username, limit = 50) {
    await this.ready();
    const take = Math.min(200, Number(limit) || 50);
    const rows = await prisma.systemLog.findMany({
      where: {
        OR: [
          { userId },
          {
            details: {
              path: ['targetUserId'],
              equals: userId,
            },
          },
          ...(username
            ? [
                {
                  details: {
                    path: ['targetUsername'],
                    equals: username,
                  },
                },
              ]
            : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return rows.map((r) => ({
      id: r.id,
      action: r.details?.action || r.message,
      details: r.details || {},
      username: r.details?.username || null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * Users owned by an admin: directly added + users added by their resellers.
   */
  async countOwnedUsersForAdmin(adminId) {
    await this.ready();
    if (!adminId) return 0;
    const resellerProfiles = await prisma.resellerProfile.findMany({
      where: { parentAdminId: adminId },
      select: { id: true, userId: true },
    });
    const resellerUserIds = resellerProfiles.map((r) => r.userId);
    const count = await prisma.user.count({
      where: {
        role: 'CUSTOMER',
        OR: [
          { ownedByAdminId: adminId },
          { createdByAdminId: adminId },
          ...(resellerUserIds.length
            ? [{ createdByResellerId: { in: resellerUserIds } }]
            : []),
        ],
      },
    });
    return count;
  }

  async ownedUserCountsByAdmin() {
    await this.ready();
    const admins = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
      select: { id: true },
    });
    const out = {};
    for (const a of admins) {
      out[a.id] = await this.countOwnedUsersForAdmin(a.id);
    }
    return out;
  }

  async findUsersByDeviceId(deviceId) {
    await this.ready();
    const needle = String(deviceId || '').trim();
    if (!needle) return [];
    try {
      const users = await prisma.user.findMany({
        where: {
          role: 'CUSTOMER',
          OR: [
            { meta: { path: ['lastDeviceId'], equals: needle } },
            { meta: { path: ['deviceIds'], array_contains: needle } },
          ],
        },
      });
      return users.map(toEndUser);
    } catch (err) {
      console.warn('findUsersByDeviceId JSON filter failed, scanning:', err.message);
      const all = await this.getUsers();
      return all.filter((u) => {
        if (u.lastDeviceId === needle) return true;
        return Array.isArray(u.deviceIds) && u.deviceIds.includes(needle);
      });
    }
  }

  async adminPeriodStats() {
    await this.ready();
    const { periodWindow20th } = require('./deviceSecurity');
    const { from, to } = periodWindow20th(new Date());
    const createGrants = await prisma.creditLedger.findMany({
      where: {
        OR: [
          { reason: 'admin_create_user' },
          { reason: 'reseller_create_user' },
          { reason: 'create_user' },
        ],
        createdAt: { gte: from, lt: to },
      },
      select: { userId: true },
    });
    const createUserIds = new Set(createGrants.map((g) => g.userId).filter(Boolean));
    // Also count CUSTOMER end-users created in-window (covers rows without ledger create reason).
    const createdUsers = await prisma.user.findMany({
      where: {
        role: 'CUSTOMER',
        createdAt: { gte: from, lt: to },
      },
      select: { id: true },
    });
    for (const u of createdUsers) createUserIds.add(u.id);
    const createdInPeriod = createUserIds.size;

    // Renewals: admin credit/plan adjustments in-window for users not created this period.
    const renewRows = await prisma.creditLedger.findMany({
      where: {
        createdAt: { gte: from, lt: to },
        type: 'ADMIN_ADJUSTMENT',
        AND: [
          {
            NOT: {
              OR: [
                { reason: 'admin_create_user' },
                { reason: 'reseller_create_user' },
                { reason: 'create_user' },
              ],
            },
          },
          ...(createUserIds.size
            ? [{ NOT: { userId: { in: [...createUserIds] } } }]
            : []),
        ],
      },
      select: { userId: true },
    });
    const renewalUserIds = new Set(renewRows.map((r) => r.userId).filter(Boolean));
    const renewals = renewalUserIds.size;
    return {
      periodStart: from.toISOString(),
      periodEnd: to.toISOString(),
      newUsers: createdInPeriod,
      renewals,
      total: createdInPeriod + renewals,
    };
  }

  async recordDeviceTouch(userId, { deviceId, ip, country, client } = {}) {
    await this.ready();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return null;
    const meta = { ...(user.meta && typeof user.meta === 'object' ? user.meta : {}) };
    const deviceIds = Array.isArray(meta.deviceIds) ? [...meta.deviceIds] : [];
    if (deviceId && !deviceIds.includes(deviceId)) deviceIds.push(deviceId);
    const patch = {
      lastLoginAt: new Date().toISOString(),
    };
    if (ip) patch.lastIp = ip;
    if (country) patch.lastCountry = country;
    if (deviceId) {
      patch.lastDeviceId = deviceId;
      patch.deviceIds = deviceIds.slice(-20);
    }
    if (client) patch.lastClient = client;
    return this.updateUser(userId, patch);
  }
}

const db = new Database();
module.exports = db;
