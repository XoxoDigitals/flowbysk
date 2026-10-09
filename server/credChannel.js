/**
 * Phase 1+2: short-lived login attempts + ECDH (X25519) sealed credential delivery.
 * Plaintext Google secrets never leave the server unencrypted over the API.
 */
const crypto = require('crypto');

const ATTEMPT_TTL_MS = 5 * 60 * 1000;
const CHANNEL_TTL_MS = 12 * 60 * 60 * 1000;
const attempts = new Map(); // attemptId -> record
const channels = new Map(); // channelId -> record

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}
function fromB64url(s) {
  return Buffer.from(String(s || ''), 'base64url');
}

function maskEmail(email) {
  const s = String(email || '').trim();
  const at = s.indexOf('@');
  if (at < 1) return s ? '***' : '';
  const user = s.slice(0, at);
  const domain = s.slice(at);
  if (user.length <= 1) return `*${domain}`;
  return `${user[0]}***${domain}`;
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || '';
}

function uaHash(req) {
  return crypto.createHash('sha256').update(String(req.headers['user-agent'] || '')).digest('hex').slice(0, 16);
}

function prune() {
  const now = Date.now();
  for (const [id, a] of attempts) {
    if (a.expiresAt <= now) attempts.delete(id);
  }
  for (const [id, c] of channels) {
    if (c.expiresAt <= now) channels.delete(id);
  }
}

/** Create ECDH channel from client X25519 public key (SPKI or raw 32-byte b64url). */
function createChannel(userId, clientPublicKeyB64, req) {
  prune();
  if (!clientPublicKeyB64 || typeof clientPublicKeyB64 !== 'string') {
    throw Object.assign(new Error('clientPublicKey required'), { status: 400 });
  }
  let clientPub;
  try {
    const raw = fromB64url(clientPublicKeyB64);
    if (raw.length === 32) {
      clientPub = crypto.createPublicKey({
        key: Buffer.concat([
          Buffer.from('302a300506032b656e032100', 'hex'), // X25519 SPKI prefix
          raw,
        ]),
        format: 'der',
        type: 'spki',
      });
    } else {
      clientPub = crypto.createPublicKey({ key: raw, format: 'der', type: 'spki' });
    }
  } catch {
    throw Object.assign(new Error('Invalid clientPublicKey'), { status: 400 });
  }

  const { publicKey: serverPub, privateKey: serverPriv } = crypto.generateKeyPairSync('x25519');
  const shared = crypto.diffieHellman({ privateKey: serverPriv, publicKey: clientPub });
  const aesKey = crypto.createHash('sha256').update(shared).update('flow-cred-v1').digest();
  const channelId = 'ch_' + crypto.randomBytes(16).toString('hex');
  const serverPublicKey = b64url(serverPub.export({ type: 'spki', format: 'der' }));

  channels.set(channelId, {
    channelId,
    userId,
    aesKey,
    ip: clientIp(req),
    ua: uaHash(req),
    expiresAt: Date.now() + CHANNEL_TTL_MS,
    createdAt: Date.now(),
  });

  return { channelId, serverPublicKey, expiresInSeconds: Math.floor(CHANNEL_TTL_MS / 1000) };
}

function getChannel(channelId, userId, req) {
  prune();
  const c = channels.get(channelId);
  if (!c || c.userId !== userId) return null;
  if (c.expiresAt <= Date.now()) {
    channels.delete(channelId);
    return null;
  }
  // Soft bind: allow IP change but log mismatch via caller
  c._ipMatch = c.ip === clientIp(req);
  c._uaMatch = c.ua === uaHash(req);
  return c;
}

function sealValue(aesKey, plain) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, nonce);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    alg: 'AES-256-GCM',
    nonce: b64url(nonce),
    ciphertext: b64url(Buffer.concat([enc, tag])),
  };
}

function verifyRequestMac(aesKey, payload) {
  const { channelId, attemptId, stage, ts, mac } = payload || {};
  if (!mac || !ts || !channelId || !attemptId || !stage) return false;
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(Date.now() - t) > 2 * 60 * 1000) return false;
  const msg = `${channelId}|${attemptId}|${stage}|${t}`;
  const expected = crypto.createHmac('sha256', aesKey).update(msg).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(mac));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function createAttempt(userId, serverId, channelId, req) {
  prune();
  const attemptId = 'atm_' + Date.now() + '_' + crypto.randomBytes(6).toString('hex');
  attempts.set(attemptId, {
    attemptId,
    userId,
    serverId,
    channelId,
    ip: clientIp(req),
    ua: uaHash(req),
    usedStages: new Set(),
    expiresAt: Date.now() + ATTEMPT_TTL_MS,
  });
  return {
    attemptId,
    expiresAt: new Date(Date.now() + ATTEMPT_TTL_MS).toISOString(),
  };
}

function takeAttemptStage(attemptId, userId, stage, channelId) {
  prune();
  const a = attempts.get(attemptId);
  if (!a || a.userId !== userId) return { ok: false, error: 'Invalid or expired attempt. Call extension-start again.' };
  if (a.expiresAt <= Date.now()) {
    attempts.delete(attemptId);
    return { ok: false, error: 'Attempt expired. Call extension-start again.' };
  }
  if (a.channelId && channelId && a.channelId !== channelId) {
    return { ok: false, error: 'Attempt/channel mismatch.' };
  }
  if (a.usedStages.has(stage)) {
    return { ok: false, error: `Stage "${stage}" already consumed for this attempt.` };
  }
  a.usedStages.add(stage);
  return { ok: true, attempt: a };
}

const stepHits = new Map();
function allowExtensionStep(userId, stage) {
  const key = `${userId}:${stage}`;
  const now = Date.now();
  let bucket = stepHits.get(key);
  if (!bucket || now - bucket.windowStart > 60_000) {
    bucket = { windowStart: now, count: 0 };
  }
  bucket.count += 1;
  stepHits.set(key, bucket);
  const max = stage === 'otp' ? 8 : stage === 'password' ? 4 : 10;
  return bucket.count <= max;
}

module.exports = {
  maskEmail,
  createChannel,
  getChannel,
  sealValue,
  verifyRequestMac,
  createAttempt,
  takeAttemptStage,
  allowExtensionStep,
  clientIp,
  uaHash,
};
