'use strict';
// Generates cross-language interop vectors for the v15 crypto contract.
// The C# (EXE) and Kotlin (APK) ports must reproduce/accept every one of these.
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const env = require('../cryptoEnvelope');
const dk = require('../deviceKeys');

function rawPriv(keyObj) {
  // raw 32-byte seed/scalar is the last 32 bytes of the PKCS8 DER for x25519/ed25519
  const der = keyObj.export({ type: 'pkcs8', format: 'der' });
  return der.subarray(der.length - 32);
}

// Deterministic-ish: use fixed seeds so the vectors are stable across runs.
const aesKey = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');

// Codec vectors (deterministic)
const codecInputs = ['', 'A', 'Hello, Flow!', '{"email":"x@y.com","pw":"P@ss!","n":7}', 'café ñ 🔐'];
const codec = codecInputs.map((s) => {
  const buf = Buffer.from(s, 'utf8');
  return { inputUtf8: s, base91: env.base91Encode(buf), base122: env.base122Encode(buf) };
});

// AES-GCM envelope: a Node-sealed body the C#/Kotlin side must OPEN (nonce random, so open-only).
const sampleObj = { stage: 'password', attemptId: 'att_123', ts: 1700000000000, note: 'café 🔐' };
const sealed = env.sealBody(sampleObj, aesKey);

// X25519 static ECDH -> envelope key (must match)
const srvStatic = crypto.generateKeyPairSync('x25519');
const srvStaticPrivPem = srvStatic.privateKey.export({ type: 'pkcs8', format: 'pem' });
const srvStaticPubRaw = dk.pubRaw(srvStatic.publicKey);

const dev = crypto.generateKeyPairSync('x25519');
const devPrivRaw = rawPriv(dev.privateKey);
const devPubRaw = dk.pubRaw(dev.publicKey);

const envKey = dk.deriveEnvelopeKey(srvStaticPrivPem, env.b64urlEncode(devPubRaw)); // server side
// (C# will compute from devPriv + srvStaticPub and must get the same key)

// Ed25519 (deterministic signatures)
const signSeed = Buffer.from('a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 'hex');
// build an ed25519 key from a fixed seed via PKCS8 wrapper
const ED_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const edPriv = crypto.createPrivateKey({ key: Buffer.concat([ED_PKCS8_PREFIX, signSeed]), format: 'der', type: 'pkcs8' });
const edPub = crypto.createPublicKey(edPriv);
const edPubRaw = dk.pubRaw(edPub);
const sigMessage = 'v15|win-abc123|POST|/api/v15/client/extension-step|1700000000000|deadbeef';
const signature = env.b64urlEncode(crypto.sign(null, Buffer.from(sigMessage, 'utf8'), edPriv));

const out = {
  note: 'v15 interop vectors. C#/Kotlin must reproduce base91/base122 encode, open the AES envelope, derive the same envelope key, and produce the same Ed25519 signature.',
  aesKeyHex: aesKey.toString('hex'),
  codec,
  envelope: { sealed, expectedJson: JSON.stringify(sampleObj) },
  x25519: {
    serverStaticPubRawB64url: env.b64urlEncode(srvStaticPubRaw),
    devicePrivRawHex: devPrivRaw.toString('hex'),
    devicePubRawB64url: env.b64urlEncode(devPubRaw),
    expectedEnvKeyHex: envKey.toString('hex'),
  },
  ed25519: {
    seedHex: signSeed.toString('hex'),
    pubRawB64url: env.b64urlEncode(edPubRaw),
    message: sigMessage,
    expectedSignatureB64url: signature,
  },
};

const dest = path.join(__dirname, 'v15-vectors.json');
fs.writeFileSync(dest, JSON.stringify(out, null, 2));
console.log('wrote', dest);
// sanity: open our own sealed body
console.log('self-open:', JSON.stringify(env.openBody(sealed, aesKey)) === out.envelope.expectedJson ? 'OK' : 'FAIL');
