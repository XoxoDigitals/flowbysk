const express = require('express');
const cors = require('cors');
const path = require('path');
const adminRoutes = require('./routes/admin');
const sessionRoutes = require('./routes/session');
const resellerRoutes = require('./routes/reseller');
const downloads = require('./downloads');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 8000;

downloads.ensureDirs();

// Trust reverse proxy so req.ip / geo lookup see real client IPs
app.set('trust proxy', true);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.redirect(302, 'https://flowcreatorai.site/admin');
});

app.use('/api/admin', adminRoutes);

const forceUpdatePayload = {
  success: false,
  code: 'FORCE_UPDATE',
  error: 'Please download the latest Flow Browser.',
};

/**
 * v16 is the live generation. By default v2–v15 → 410 FORCE_UPDATE (hard cutover) — this kills
 * every prior build, including the v15 test builds. During rollout set FLOW_V15_TRANSITION=1 to
 * ALSO keep v14 live, so the new v16 EXE can be tested while existing v8 users keep working.
 * Remove the flag + restart to perform the full hard cutover (v16-only).
 */
const TRANSITION = String(process.env.FLOW_V15_TRANSITION || '') === '1';
const clientV16Routes = require('./routes/client-v16');
const legacyDead = ['v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v15'];
for (const legacyVer of legacyDead) {
  app.use(`/api/${legacyVer}/client`, (req, res) => {
    res.status(410).json(forceUpdatePayload);
  });
}
if (TRANSITION) {
  const clientV14Routes = require('./routes/client-v14');
  app.use('/api/v14/client', clientV14Routes);
  console.log('[v16] TRANSITION mode: v14 kept live alongside v16 (v15 is dead)');
} else {
  app.use('/api/v14/client', (req, res) => res.status(410).json(forceUpdatePayload));
}
app.use('/api/v16/client', clientV16Routes);
app.use('/api/client', (req, res) => {
  res.status(410).json(forceUpdatePayload);
});
app.use('/api/session', sessionRoutes);
app.use('/api/reseller', resellerRoutes);

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.get('/download/status', async (req, res) => {
  try {
    res.json({ success: true, downloads: await downloads.getPublicAvailability() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/public/branding', async (req, res) => {
  try {
    const settings = (await db.getSettings()) || {};
    res.json({
      success: true,
      settings: {
        siteName: settings.siteName || settings.appName || 'Flow Creator Ai',
        appName: settings.appName || settings.siteName || 'Flow Creator Ai',
        logoUrl: settings.logoUrl || null,
        contactEmail: settings.contactEmail || '',
        allowSignups: settings.allowSignups !== false,
        ticketSystemEnabled: settings.ticketSystemEnabled !== false,
        contactPageEnabled: settings.contactPageEnabled !== false,
        maintenanceMode: !!settings.maintenanceMode,
        socialLinks: settings.socialLinks || {},
        // Always advertise the LIVE version (never a stale DB value that may point at a dead route).
        // Transition: v14 (legacy v8 clients). Cutover: v16. v9+ EXE ignores this anyway (pinned).
        clientApiVersion: (TRANSITION ? 'v14' : 'v16'),
      },
      serverTime: Date.now(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/public/notices', async (req, res) => {
  try {
    res.json({ success: true, notices: await db.getActiveNotices() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Public marketing plans (Next rewrites /api/* → Express). */
app.get('/api/plans', async (req, res) => {
  try {
    const plans = (await db.getPlans()).filter((p) => p.isActive !== false);
    res.json({
      success: true,
      plans: plans.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description || null,
        priceMonthly: p.priceMonthly,
        contactSeller: !!p.contactSeller,
        maxParallel: p.maxParallel,
        standardCreditsCycle: p.standardCreditsCycle,
        proCreditsCycle: p.proCreditsCycle,
        features: Array.isArray(p.features) ? p.features : [],
        isActive: p.isActive !== false,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Navbar auth probe — browser session is JWT in localStorage, not cookies. */
app.get('/api/auth/me', (req, res) => {
  res.json({ authenticated: false, user: null });
});

app.get('/download/flow-browser', async (req, res) => {
  await downloads.streamPackage('windows', res);
});

app.get('/download/flow-android', async (req, res) => {
  await downloads.streamPackage('android', res);
});

app.get('/demo-flow', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'demo-flow.html'));
});

app.get('/legacy-admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('*', (req, res) => {
  if (String(req.path || '').startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'Not found' });
  }
  res.status(200).type('html').send(
    '<!doctype html><meta charset="utf-8"><title>Flow Creator Ai API</title>' +
      '<body style="font-family:system-ui;padding:2rem;background:#0b0f14;color:#e2e8f0">' +
      '<p>Admin UI: <a href="https://flowcreatorai.site/admin" style="color:#38bdf8">https://flowcreatorai.site/admin</a></p>' +
      '<p>This port (:8000) is the Express API for Flow Browser.</p></body>'
  );
});

db.ready()
  .then(async () => {
    // Lock client API version. Transition: v14 (legacy clients keep working). Cutover: v16.
    try {
      const target = TRANSITION ? 'v14' : 'v16';
      const cur = await db.getSettings();
      if (String(cur?.clientApiVersion || '').toLowerCase() !== target) {
        await db.updateSettings({ clientApiVersion: target });
        console.log('[boot] Locked clientApiVersion →', target);
      }
    } catch (err) {
      console.warn('[boot] could not lock clientApiVersion:', err.message);
    }
    // Ensure the v15 server static keypair exists (its public key is embedded in EXE/APK).
    try {
      const sk = await db.getServerStaticKeys();
      console.log('[boot] v15 server static public key:', sk.publicRawB64url);
    } catch (err) {
      console.warn('[boot] could not init v15 server static key:', err.message);
    }
    app.listen(PORT, () => {
      console.log(`====================================================`);
      console.log(`Flow Creator Ai API server on port ${PORT}`);
      console.log(`Admin UI:   http://localhost:3100/admin`);
      console.log(`Demo Flow:  http://localhost:${PORT}/demo-flow`);
      console.log(`Client API: /api/v16/client only (per-device Ed25519 + encrypted bodies); v2–v15 → 410 FORCE_UPDATE`);
      console.log(`Data store: PostgreSQL (Prisma) — data.json is not live`);
      console.log(`====================================================`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
