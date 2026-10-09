/**
 * Device fingerprint helpers for app login attestation + cascade ban.
 */
const APP_CLIENT_RE = /^(windows-exe|android)\//i;

function parseFlowClient(header) {
  const h = String(header || '').trim();
  if (!APP_CLIENT_RE.test(h)) return null;
  return h;
}

function isValidDeviceId(deviceId) {
  const s = String(deviceId || '').trim();
  // UUID-ish or stable fingerprint (16+ hex/alphanumeric)
  if (s.length < 16 || s.length > 128) return false;
  if (!/^[A-Za-z0-9._:-]+$/.test(s)) return false;
  return true;
}

/** App clients must send Device ID; web portal does not use /api/v6/client. */
function requireAppDeviceAttestation(req) {
  const enabled = String(process.env.REQUIRE_DEVICE_ID || '1') !== '0';
  if (!enabled) return { ok: true, skipped: true };
  const client = parseFlowClient(req.headers['x-flow-client']);
  const deviceId = String(req.body?.deviceId || '').trim();
  if (!client) {
    return { ok: false, code: 'SUSPICIOUS_CLIENT', error: 'Official app client required.', deviceId: null, client: null };
  }
  if (!isValidDeviceId(deviceId)) {
    return {
      ok: false,
      code: 'SUSPICIOUS_CLIENT',
      error: 'Device ID required for app login.',
      deviceId: deviceId || null,
      client,
    };
  }
  return { ok: true, deviceId, client };
}

function periodWindow20th(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-11
  const this20 = new Date(Date.UTC(y, m, 20, 0, 0, 0, 0));
  let from;
  let to;
  if (now >= this20) {
    // current open window: this month 20th → next month 20th
    from = this20;
    to = new Date(Date.UTC(y, m + 1, 20, 0, 0, 0, 0));
  } else {
    // before this month's 20th: last month 20th → this month 20th
    from = new Date(Date.UTC(y, m - 1, 20, 0, 0, 0, 0));
    to = this20;
  }
  return { from, to };
}

module.exports = {
  parseFlowClient,
  isValidDeviceId,
  requireAppDeviceAttestation,
  periodWindow20th,
  APP_CLIENT_RE,
};
