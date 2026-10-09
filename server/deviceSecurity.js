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

/** Billing window: 10th 00:00 UTC → next month 10th 00:00 UTC. */
function periodWindow10th(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-11
  const this10 = new Date(Date.UTC(y, m, 10, 0, 0, 0, 0));
  let from;
  let to;
  if (now >= this10) {
    from = this10;
    to = new Date(Date.UTC(y, m + 1, 10, 0, 0, 0, 0));
  } else {
    from = new Date(Date.UTC(y, m - 1, 10, 0, 0, 0, 0));
    to = this10;
  }
  return { from, to };
}

/** @deprecated use periodWindow10th */
const periodWindow20th = periodWindow10th;

module.exports = {
  parseFlowClient,
  isValidDeviceId,
  requireAppDeviceAttestation,
  periodWindow10th,
  periodWindow20th,
  APP_CLIENT_RE,
};
