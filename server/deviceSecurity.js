/**
 * Device fingerprint + v11 Cryptographic Binary & Certificate Attestation
 * Verifies that requests originate from an untampered, Authenticode/Keystore-signed
 * Flow Browser v11 Windows EXE (v8.0.15+) or Android APK (v2.6.0+).
 */
const crypto = require('crypto');

const APP_CLIENT_RE = /^(windows-exe|android)\//i;

// Reconstruct 32-byte master seed via XOR mask
const SEED_MASK = Buffer.from([
  0x93, 0x4A, 0xE7, 0x12, 0xC8, 0x55, 0x3B, 0xF0,
  0x6D, 0xA1, 0x29, 0x84, 0x7E, 0xDF, 0x16, 0x43,
  0xB2, 0x0C, 0x89, 0xE5, 0x31, 0x74, 0xFA, 0x68,
  0x9C, 0x5E, 0xD0, 0x27, 0x4B, 0xA6, 0x1F, 0x82,
]);
const SEED_XORED = Buffer.from([
  0xF5, 0x26, 0x88, 0x65, 0x97, 0x16, 0x49, 0x95,
  0x0C, 0xD5, 0x46, 0xF6, 0x53, 0xBE, 0x7F, 0x6E,
  0xC4, 0x3D, 0xB8, 0xBA, 0x52, 0x1B, 0x9E, 0x0D,
  0xEB, 0x37, 0xBA, 0x49, 0x38, 0xC9, 0x71, 0xF1,
]);
const MASTER_SEED = Buffer.alloc(32);
for (let i = 0; i < 32; i++) {
  MASTER_SEED[i] = SEED_MASK[i] ^ SEED_XORED[i];
}

// Official Windows Authenticode SHA-256 certificate & public key digests
const WIN_CERT_SHA256 = '6103eb912192c3cf0302d302fd4a36ee35fc71c066eebd80620806610264d2de';
const WIN_PUBKEY_SHA256 = '2df97068899b17a9abf82263f141e6f4beae4708265feb9a160e9fa83ff24720';
const WIN_BIN_HASH_RE = /^win:6103eb912192c3cf:2df97068899b17a9:[0-9a-f]{16}$/;

// Official Android Release Keystore SHA-256 certificate digest
const ANDROID_CERT_SHA256 = '40bfe6b4a46fb01f570fbd33a028d5b0c24d2b5959b33d46978faeccef83208e';
const ANDROID_BIN_HASH = 'and:40bfe6b4a46fb01f570fbd33a028d5b0';

const WIN_SIGNING_KEY = crypto
  .createHash('sha256')
  .update(Buffer.concat([MASTER_SEED, Buffer.from(`|win|${WIN_CERT_SHA256}|${WIN_PUBKEY_SHA256}`, 'utf8')]))
  .digest();

const ANDROID_SIGNING_KEY = crypto
  .createHash('sha256')
  .update(Buffer.concat([MASTER_SEED, Buffer.from(`|and|${ANDROID_CERT_SHA256}`, 'utf8')]))
  .digest();

const MAX_CLOCK_SKEW_MS = 15 * 60 * 1000; // ±15 minutes

function parseFlowClient(header) {
  const h = String(header || '').trim();
  if (!APP_CLIENT_RE.test(h)) return null;
  return h;
}

function isValidDeviceId(deviceId) {
  const s = String(deviceId || '').trim();
  if (s.length < 16 || s.length > 128) return false;
  if (!/^[A-Za-z0-9._:-]+$/.test(s)) return false;
  return true;
}

function compareSemver(vA, vB) {
  const a = String(vA || '0.0.0').split('.').map((n) => parseInt(n, 10) || 0);
  const b = String(vB || '0.0.0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return 1;
    if ((a[i] || 0) < (b[i] || 0)) return -1;
  }
  return 0;
}

/**
 * Verifies v11 Device ID + Cryptographic Digital Signature bound to the live binary's
 * Authenticode / Android Keystore certificate.
 */
function requireAppDeviceAttestation(req) {
  const enabled = String(process.env.REQUIRE_DEVICE_ID || '1') !== '0';
  if (!enabled) return { ok: true, skipped: true };

  const client = parseFlowClient(req?.headers?.['x-flow-client']);
  const deviceId = String(req?.body?.deviceId || req?.headers?.['x-flow-device-id'] || '').trim();

  if (!client) {
    return {
      ok: false,
      code: 'SUSPICIOUS_CLIENT',
      error: 'Official Flow Browser v11 app client required.',
      deviceId: null,
      client: null,
    };
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

  const [platform, versionRaw] = client.split('/');
  const isWindows = /^windows-exe$/i.test(platform);
  const isAndroid = /^android$/i.test(platform);

  if (isWindows && compareSemver(versionRaw, '8.0.15') < 0) {
    return {
      ok: false,
      code: 'FORCE_UPDATE',
      error: 'Please download the latest Flow Browser (v8.0.15+).',
      deviceId,
      client,
    };
  }

  if (isAndroid && compareSemver(versionRaw, '2.0.0') < 0) {
    return {
      ok: false,
      code: 'FORCE_UPDATE',
      error: 'Please download the latest Flow Browser Android APK (v2.0+).',
      deviceId,
      client,
    };
  }

  const enforceSig = String(process.env.REQUIRE_BINARY_SIGNATURE || '1') !== '0';
  if (!enforceSig) {
    return { ok: true, deviceId, client };
  }

  const binHash = String(req?.headers?.['x-flow-bin-hash'] || req?.body?.binHash || '').trim();
  const tsRaw = req?.headers?.['x-flow-ts'] ?? req?.body?.attestTs;
  const ts = Number(tsRaw);
  const nonce = String(req?.headers?.['x-flow-nonce'] || req?.body?.attestNonce || '').trim();
  const signature = String(req?.headers?.['x-flow-signature'] || req?.body?.signature || '').trim();

  if (!binHash || !signature || !nonce || !Number.isFinite(ts) || ts <= 0) {
    return {
      ok: false,
      code: 'TAMPERED_CLIENT',
      error: 'Missing client digital signature. Please install the official untampered Flow Browser.',
      deviceId,
      client,
    };
  }

  if (binHash.startsWith('TAMPERED:')) {
    return {
      ok: false,
      code: 'TAMPERED_CLIENT',
      error: 'Client integrity or anti-debug check failed. Modified binaries and debuggers are not permitted.',
      deviceId,
      client,
    };
  }

  if (isWindows && !WIN_BIN_HASH_RE.test(binHash)) {
    return {
      ok: false,
      code: 'TAMPERED_CLIENT',
      error: 'Invalid Windows Authenticode binary digest. Modified EXE is blocked.',
      deviceId,
      client,
    };
  }

  if (isAndroid && binHash !== ANDROID_BIN_HASH) {
    return {
      ok: false,
      code: 'TAMPERED_CLIENT',
      error: 'Invalid Android APK signing certificate digest. Modified APK is blocked.',
      deviceId,
      client,
    };
  }

  if (Math.abs(Date.now() - ts) > MAX_CLOCK_SKEW_MS) {
    return {
      ok: false,
      code: 'TAMPERED_CLIENT',
      error: 'Client signature timestamp expired or system clock out of sync.',
      deviceId,
      client,
    };
  }

  if (!/^[A-Za-z0-9_-]{12,64}$/.test(nonce)) {
    return {
      ok: false,
      code: 'TAMPERED_CLIENT',
      error: 'Invalid client attestation nonce.',
      deviceId,
      client,
    };
  }

  const signingKey = isWindows ? WIN_SIGNING_KEY : ANDROID_SIGNING_KEY;
  const payload = `v11|${client}|${deviceId}|${binHash}|${ts}|${nonce}`;
  const expectedSig = crypto.createHmac('sha256', signingKey).update(payload, 'utf8').digest('base64url');

  const sigBuf = Buffer.from(signature, 'utf8');
  const expBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return {
      ok: false,
      code: 'TAMPERED_CLIENT',
      error: 'Client digital signature verification failed. Modified or unofficial binary rejected.',
      deviceId,
      client,
    };
  }

  return { ok: true, deviceId, client, binHash };
}

/** Express middleware for authenticated /api/v11/client/* routes */
function requireClientIntegrityMiddleware(req, res, next) {
  const att = requireAppDeviceAttestation(req);
  if (!att.ok) {
    return res.status(403).json({
      success: false,
      code: att.code || 'TAMPERED_CLIENT',
      error: att.error || 'Official untampered Flow Browser v11 client required.',
    });
  }
  req.clientAttestation = att;
  next();
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
  requireClientIntegrityMiddleware,
  periodWindow10th,
  periodWindow20th,
  APP_CLIENT_RE,
  WIN_CERT_SHA256,
  WIN_PUBKEY_SHA256,
  ANDROID_CERT_SHA256,
};
