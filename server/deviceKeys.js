'use strict';
/**
 * Flow v15 per-device key layer.
 *
 * Each device generates, on first run:
 *   - an X25519 keypair  (ENV)  → stable per-device body-envelope key via static ECDH
 *   - an Ed25519 keypair (SIGN) → signs every request; server verifies with the stored pubkey
 * Only the PUBLIC keys are sent to the server (encrypted to the server's static X25519 key).
 * Private keys never leave the device.
 *
 * Server holds one static X25519 keypair (generated once, stored in SystemSetting). Its PUBLIC
 * key is embedded in the EXE/APK. Registration bodies are ECIES-sealed to it so nobody but the
 * server can read what a device registers.
 *
 * Envelope key (stable, no per-request handshake):
 *   envKey = SHA256( X25519(serverStaticPriv, deviceEnvPub) || "flow-env-v15" )
 * The device computes the identical secret as X25519(deviceEnvPriv, serverStaticPub).
 */
const crypto = require('crypto');
const { sealBody, openBody, b64urlEncode, b64urlDecode } = require('./cryptoEnvelope');

const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex'); // DER prefix for raw 32B X25519 pub
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex'); // DER prefix for raw 32B Ed25519 pub
const ENV_LABEL = 'flow-env-v15';

function rawToX25519Pub(raw32) {
  return crypto.createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, raw32]), format: 'der', type: 'spki' });
}
function rawToEd25519Pub(raw32) {
  return crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw32]), format: 'der', type: 'spki' });
}
function pubRaw(keyObject) {
  // last 32 bytes of the SPKI DER are the raw public key for X25519/Ed25519
  const der = keyObject.export({ type: 'spki', format: 'der' });
  return der.subarray(der.length - 32);
}

/** Generate the server's static X25519 keypair (call once; persist the result). */
function generateServerStatic() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicRawB64url: b64urlEncode(pubRaw(publicKey)),
  };
}

/** Stable per-device envelope AES key (server side: static priv + device env pub). */
function deriveEnvelopeKey(serverStaticPrivPem, deviceEnvPubRawB64url) {
  const serverPriv = crypto.createPrivateKey({ key: serverStaticPrivPem, format: 'pem', type: 'pkcs8' });
  const devicePub = rawToX25519Pub(b64urlDecode(deviceEnvPubRawB64url));
  const shared = crypto.diffieHellman({ privateKey: serverPriv, publicKey: devicePub });
  return crypto.createHash('sha256').update(shared).update(ENV_LABEL).digest();
}

/** Client-side equivalent (used only by the test harness here; real clients implement it natively). */
function deriveEnvelopeKeyClient(deviceEnvPrivPem, serverStaticPubRawB64url) {
  const devicePriv = crypto.createPrivateKey({ key: deviceEnvPrivPem, format: 'pem', type: 'pkcs8' });
  const serverPub = rawToX25519Pub(b64urlDecode(serverStaticPubRawB64url));
  const shared = crypto.diffieHellman({ privateKey: devicePriv, publicKey: serverPub });
  return crypto.createHash('sha256').update(shared).update(ENV_LABEL).digest();
}

/**
 * Registration ECIES: the device seals its public keys to the server's static X25519 key.
 * Request (cleartext envelope wrapper): { eph: <device ephemeral X25519 pub b64url>, body: <sealBody(...)> }
 * where the sealBody AES key = SHA256( X25519(ephPriv, serverStaticPub) || "flow-env-v15" ).
 */
function openRegistration(serverStaticPrivPem, ephPubRawB64url, envelope) {
  const serverPriv = crypto.createPrivateKey({ key: serverStaticPrivPem, format: 'pem', type: 'pkcs8' });
  const ephPub = rawToX25519Pub(b64urlDecode(ephPubRawB64url));
  const shared = crypto.diffieHellman({ privateKey: serverPriv, publicKey: ephPub });
  const key = crypto.createHash('sha256').update(shared).update(ENV_LABEL).digest();
  return openBody(envelope, key);
}

/** Verify an Ed25519 request signature against a device's stored public key. */
function verifyDeviceSignature(deviceSignPubRawB64url, message, signatureB64url) {
  try {
    const pub = rawToEd25519Pub(b64urlDecode(deviceSignPubRawB64url));
    return crypto.verify(null, Buffer.from(message, 'utf8'), pub, b64urlDecode(signatureB64url));
  } catch {
    return false;
  }
}

module.exports = {
  generateServerStatic,
  deriveEnvelopeKey,
  deriveEnvelopeKeyClient,
  openRegistration,
  verifyDeviceSignature,
  pubRaw,
};

/* ---------- self-test: simulate the full device↔server handshake ---------- */
if (require.main === module) {
  let fails = 0;
  const ok = (name, cond) => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); };

  // Server static key
  const srv = generateServerStatic();

  // Device generates its keypairs
  const devEnv = crypto.generateKeyPairSync('x25519');
  const devSign = crypto.generateKeyPairSync('ed25519');
  const devEnvPrivPem = devEnv.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const devEnvPubB64 = b64urlEncode(pubRaw(devEnv.publicKey));
  const devSignPubB64 = b64urlEncode(pubRaw(devSign.publicKey));

  // 1) Registration: device ECIES-seals its public keys to server static pub
  const eph = crypto.generateKeyPairSync('x25519');
  const ephPrivPem = eph.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const ephPubB64 = b64urlEncode(pubRaw(eph.publicKey));
  const regKey = deriveEnvelopeKeyClient(ephPrivPem, srv.publicRawB64url);
  const regEnvelope = sealBody({ envPub: devEnvPubB64, signPub: devSignPubB64, deviceId: 'win-test-123' }, regKey);
  const opened = openRegistration(srv.privatePem, ephPubB64, regEnvelope);
  ok('registration ECIES decrypts public keys', opened.envPub === devEnvPubB64 && opened.signPub === devSignPubB64);

  // 2) Stable envelope key matches on both sides
  const kServer = deriveEnvelopeKey(srv.privatePem, devEnvPubB64);
  const kClient = deriveEnvelopeKeyClient(devEnvPrivPem, srv.publicRawB64url);
  ok('envelope key matches (static ECDH)', kServer.equals(kClient));

  // 3) A body sealed by the device opens on the server with the derived key
  const env = sealBody({ stage: 'password', ts: Date.now() }, kClient);
  const dec = openBody(env, kServer);
  ok('body sealed by device opens on server', dec.stage === 'password');

  // 4) Ed25519 request signature
  const msg = `v15|win-test-123|ch_abc|password|${Date.now()}`;
  const sig = b64urlEncode(crypto.sign(null, Buffer.from(msg, 'utf8'), devSign.privateKey));
  ok('valid device signature verifies', verifyDeviceSignature(devSignPubB64, msg, sig));
  ok('tampered message rejected', !verifyDeviceSignature(devSignPubB64, msg + 'x', sig));
  const other = crypto.generateKeyPairSync('ed25519');
  const sig2 = b64urlEncode(crypto.sign(null, Buffer.from(msg, 'utf8'), other.privateKey));
  ok('wrong-key signature rejected', !verifyDeviceSignature(devSignPubB64, msg, sig2));

  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
}
