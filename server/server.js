const express = require('express');
const cors = require('cors');
const path = require('path');
const adminRoutes = require('./routes/admin');
const clientRoutes = require('./routes/client');
const sessionRoutes = require('./routes/session');
const resellerRoutes = require('./routes/reseller');
const downloads = require('./downloads');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 8000;

downloads.ensureDirs();

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

async function getClientApiVersion() {
  try {
    const settings = (await db.getSettings()) || {};
    return normalizeClientApiVersionPublic(settings.clientApiVersion);
  } catch {
    return 'v4';
  }
}

function normalizeClientApiVersionPublic(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'v4') return 'v4';
  if (v === 'v3') return 'v3';
  return 'v2';
}

/** Kill older client APIs on hard cutover. */
function killIfOlderThan(activeVersion, routeVersion) {
  const order = { v2: 2, v3: 3, v4: 4 };
  return (order[activeVersion] || 2) > (order[routeVersion] || 2);
}

app.use('/api/v2/client', async (req, res, next) => {
  try {
    if (killIfOlderThan(await getClientApiVersion(), 'v2')) {
      return res.status(410).json(forceUpdatePayload);
    }
  } catch { /* live */ }
  return next();
});
app.use('/api/v2/client', clientRoutes);

app.use('/api/v3/client', async (req, res, next) => {
  try {
    if (killIfOlderThan(await getClientApiVersion(), 'v3')) {
      return res.status(410).json(forceUpdatePayload);
    }
  } catch { /* live */ }
  return next();
});
app.use('/api/v3/client', clientRoutes);

app.use('/api/v4/client', clientRoutes);
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
        clientApiVersion: (() => {
          const v = String(settings.clientApiVersion || 'v4').toLowerCase();
          if (v === 'v4' || v === 'v3' || v === 'v2') return v;
          return 'v4';
        })(),
      },
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
    // Hard cutover to v4 ASAP on boot (admin can still set back to v2/v3 if needed)
    try {
      const cur = await db.getSettings();
      if (normalizeClientApiVersionPublic(cur?.clientApiVersion) !== 'v4') {
        await db.updateSettings({ clientApiVersion: 'v4' });
        console.log('[boot] Forced clientApiVersion → v4 (kills /api/v2 and /api/v3)');
      }
    } catch (err) {
      console.warn('[boot] could not force clientApiVersion v4:', err.message);
    }
    app.listen(PORT, () => {
      console.log(`====================================================`);
      console.log(`Flow Creator Ai API server on port ${PORT}`);
      console.log(`Admin UI:   http://localhost:3100/admin`);
      console.log(`Demo Flow:  http://localhost:${PORT}/demo-flow`);
      console.log(`Client API: http://localhost:${PORT}/api/v4/client (v2/v3 killed when cutover=v4)`);
      console.log(`Data store: PostgreSQL (Prisma) — data.json is not live`);
      console.log(`====================================================`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
