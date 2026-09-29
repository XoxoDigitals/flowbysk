/**
 * AES-256-GCM helpers for Google account password + TOTP secrets at rest.
 * Key: FLOW_SECRETS_KEY (32+ char secret) or derived from JWT_SECRET.
 * Ciphertext format: enc:v1:<iv_b64>:<tag_b64>:<data_b64>
 */
const crypto = require('crypto');

const PREFIX = 'enc:v1:';
const _decryptFailLogged = new Set();

function masterKeyBytes() {
  const raw =
    process.env.FLOW_SECRETS_KEY ||
    process.env.JWT_SECRET ||
    'flow_secrets_dev_key_change_me_32b!!';
  return crypto.createHash('sha256').update(String(raw), 'utf8').digest();
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function encryptSecret(plain) {
  const text = String(plain ?? '');
  if (!text) return '';
  if (isEncrypted(text)) return text;
  const iv = crypto.randomBytes(12);
  const key = masterKeyBytes();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (
    PREFIX +
    iv.toString('base64url') +
    ':' +
    tag.toString('base64url') +
    ':' +
    enc.toString('base64url')
  );
}

function decryptSecret(value) {
  const text = String(value ?? '');
  if (!text) return '';
  if (!isEncrypted(text)) return text; // legacy plaintext
  const parts = text.slice(PREFIX.length).split(':');
  if (parts.length !== 3) return '';
  try {
    const [ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    const data = Buffer.from(dataB64, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKeyBytes(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (err) {
    const tip = text.slice(0, 24);
    if (!_decryptFailLogged.has(tip)) {
      _decryptFailLogged.add(tip);
      console.warn(
        '[secretsCrypto] decrypt failed (wrong FLOW_SECRETS_KEY or corrupt ciphertext). Re-save Google password/TOTP in Admin. Once:',
        err.message
      );
    }
    return '';
  }
}

/** Encrypt for storage; leave empty as empty. */
function sealForStorage(plain) {
  const t = String(plain ?? '');
  if (!t) return '';
  return encryptSecret(t);
}

/** Decrypt for use; supports legacy plaintext. */
function openFromStorage(stored) {
  return decryptSecret(stored);
}

module.exports = {
  isEncrypted,
  encryptSecret,
  decryptSecret,
  sealForStorage,
  openFromStorage,
};
