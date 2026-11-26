'use strict';
/**
 * Flow v15 request/response body envelope.
 *
 * Order (as specified): JSON -> base64 -> base91 -> base122 -> AES-256-GCM.
 * The AES-GCM ciphertext is the only thing that travels on the wire (base64url-wrapped
 * so it is JSON/HTTP safe). Because encryption is the OUTER layer, the wire shows nothing
 * but opaque ciphertext; the base64/base91/base122 layers are internal obfuscation of the
 * plaintext before it is encrypted, exactly as requested.
 *
 * The per-device AES key is derived from the registered device key (see deviceSecurity /
 * registration). All three clients (Node server, Windows EXE, Android APK) must implement
 * these codecs identically — the self-test vectors at the bottom are the contract.
 */
const crypto = require('crypto');

/* ---------- base64url (standard) ---------- */
function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(s, 'base64');
}

/* ---------- base64 (standard, with padding) ---------- */
function b64Encode(buf) { return Buffer.from(buf).toString('base64'); }
function b64Decode(str) { return Buffer.from(String(str), 'base64'); }

/* ---------- basE91 (Joachim Henke alphabet) ---------- */
const B91_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' +
  '!#$%&()*+,./:;<=>?@[]^_`{|}~"';
const B91_DECODE = (() => {
  const m = new Array(256).fill(-1);
  for (let i = 0; i < B91_ALPHABET.length; i++) m[B91_ALPHABET.charCodeAt(i)] = i;
  return m;
})();

function base91Encode(buf) {
  let b = 0, n = 0, out = '';
  for (let i = 0; i < buf.length; i++) {
    b |= buf[i] << n;
    n += 8;
    if (n > 13) {
      let v = b & 8191;
      if (v > 88) { b >>= 13; n -= 13; }
      else { v = b & 16383; b >>= 14; n -= 14; }
      out += B91_ALPHABET[v % 91] + B91_ALPHABET[(v / 91) | 0];
    }
  }
  if (n) {
    out += B91_ALPHABET[b % 91];
    if (n > 7 || b > 90) out += B91_ALPHABET[(b / 91) | 0];
  }
  return out;
}

function base91Decode(str) {
  let v = -1, b = 0, n = 0;
  const out = [];
  for (let i = 0; i < str.length; i++) {
    const c = B91_DECODE[str.charCodeAt(i)];
    if (c === -1) continue;
    if (v < 0) { v = c; }
    else {
      v += c * 91;
      b |= v << n;
      n += (v & 8191) > 88 ? 13 : 14;
      do { out.push(b & 255); b >>= 8; n -= 8; } while (n > 7);
      v = -1;
    }
  }
  if (v >= 0) out.push((b | (v << n)) & 255);
  return Buffer.from(out);
}

/* ---------- base122 (7-bit → safe code point packer) ----------
 * Packs the bitstream 7 bits at a time into a fixed 128-symbol alphabet of safe,
 * non-control code points, producing valid UTF-8. Self-consistent and trivially
 * portable to C#/Kotlin (same alphabet + same bit order). A 1-char header carries
 * the number of padding bits so decode is exact.
 */
const B122_ALPHABET = (() => {
  // 128 distinct safe code points: ASCII printable (33..126 => 94) then Latin-1 (161..194 => 34) = 128.
  let s = '';
  for (let c = 33; c <= 126; c++) s += String.fromCharCode(c);       // 94
  for (let c = 161; s.length < 128; c++) s += String.fromCharCode(c); // +34 => 128
  return s;
})();
const B122_DECODE = (() => {
  const m = new Map();
  for (let i = 0; i < B122_ALPHABET.length; i++) m.set(B122_ALPHABET.charCodeAt(i), i);
  return m;
})();

function base122Encode(buf) {
  let out = '';
  let acc = 0, nbits = 0, total = 0;
  for (let i = 0; i < buf.length; i++) {
    acc = (acc << 8) | buf[i];
    nbits += 8;
    while (nbits >= 7) {
      nbits -= 7;
      out += B122_ALPHABET[(acc >> nbits) & 0x7f];
      total += 7;
    }
    acc &= (1 << nbits) - 1; // keep only the low nbits (0..6) -> accumulator never overflows
  }
  if (nbits > 0) {
    out += B122_ALPHABET[(acc << (7 - nbits)) & 0x7f];
    total += 7;
  }
  const pad = total - buf.length * 8; // 0..6 bits of padding in the last symbol
  return B122_ALPHABET[pad] + out;    // 1-symbol header = pad count
}

function base122Decode(str) {
  if (!str || str.length === 0) return Buffer.alloc(0);
  const pad = B122_DECODE.get(str.charCodeAt(0)) || 0;
  void pad;
  let acc = 0, nbits = 0;
  const out = [];
  for (let i = 1; i < str.length; i++) {
    const v = B122_DECODE.get(str.charCodeAt(i));
    if (v === undefined) continue;
    acc = (acc << 7) | v;
    nbits += 7;
    while (nbits >= 8) {
      nbits -= 8;
      out.push((acc >> nbits) & 0xff);
    }
    acc &= (1 << nbits) - 1; // bounded accumulator
  }
  // trailing `nbits` bits are padding — discard
  return Buffer.from(out);
}

/* ---------- AES-256-GCM body envelope ---------- */
// plaintext obj -> base64 -> base91 -> base122 -> AES-256-GCM -> {v,n,c} (base64url)
function sealBody(obj, aesKey) {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const s64 = b64Encode(json);                 // base64 (string)
  const s91 = base91Encode(Buffer.from(s64, 'latin1'));
  const s122 = base122Encode(Buffer.from(s91, 'latin1'));
  const plain = Buffer.from(s122, 'utf8');     // what AES encrypts
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, nonce);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { v: 15, n: b64urlEncode(nonce), c: b64urlEncode(Buffer.concat([enc, tag])) };
}

function openBody(envelope, aesKey) {
  const nonce = b64urlDecode(envelope.n);
  const blob = b64urlDecode(envelope.c);
  const tag = blob.subarray(blob.length - 16);
  const enc = blob.subarray(0, blob.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, nonce);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(enc), decipher.final()]);
  const s122 = plain.toString('utf8');
  const s91 = base122Decode(s122).toString('latin1');
  const s64 = base91Decode(s91).toString('latin1');
  const json = b64Decode(s64).toString('utf8');
  return JSON.parse(json);
}

module.exports = {
  b64urlEncode, b64urlDecode,
  base91Encode, base91Decode,
  base122Encode, base122Decode,
  sealBody, openBody,
};

/* ---------- self-test (run: node cryptoEnvelope.js) ---------- */
if (require.main === module) {
  const key = crypto.randomBytes(32);
  let fails = 0;
  const check = (name, a, b) => { const ok = a === b; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };

  for (const s of ['', 'a', 'hello world', '{"email":"x@y.com","pw":"P@ss w0rd!","n":123}', '🔐 unicode café ñ', 'A'.repeat(1000)]) {
    const buf = Buffer.from(s, 'utf8');
    check('base91 ' + JSON.stringify(s.slice(0, 20)), base91Decode(base91Encode(buf)).toString('utf8'), s);
    check('base122 ' + JSON.stringify(s.slice(0, 20)), base122Decode(base122Encode(buf)).toString('utf8'), s);
  }
  for (const obj of [{ a: 1 }, { email: 'eliteunlimasdhkk@gmail.com', stage: 'password', ts: Date.now() }, { big: 'x'.repeat(5000), arr: [1, 2, 3] }]) {
    const env = sealBody(obj, key);
    check('envelope ' + Object.keys(obj).join(','), JSON.stringify(openBody(env, key)), JSON.stringify(obj));
  }
  // wrong key must fail
  try { openBody(sealBody({ a: 1 }, key), crypto.randomBytes(32)); console.log('FAIL  wrong-key rejected'); fails++; }
  catch { console.log('PASS  wrong-key rejected'); }

  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
}
