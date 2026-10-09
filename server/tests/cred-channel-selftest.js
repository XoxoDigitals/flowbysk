/**
 * Self-test Phase 1+2 credential channel (no DB).
 * Run: node server/tests/cred-channel-selftest.js
 */
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const cred = require(path.join(__dirname, '..', 'credChannel'));

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

const { publicKey: clientPub, privateKey: clientPriv } = crypto.generateKeyPairSync('x25519');
const clientRaw = clientPub.export({ type: 'spki', format: 'der' }).subarray(-32);

const fakeReq = { headers: { 'user-agent': 'FlowBrowser-Test/1.0' }, ip: '127.0.0.1' };
const channel = cred.createChannel('user-1', b64url(clientRaw), fakeReq);
assert.ok(channel.channelId.startsWith('ch_'));
assert.ok(channel.serverPublicKey);

const serverPub = crypto.createPublicKey({
  key: Buffer.from(channel.serverPublicKey, 'base64url'),
  format: 'der',
  type: 'spki',
});
const shared = crypto.diffieHellman({ privateKey: clientPriv, publicKey: serverPub });
const aesKey = crypto.createHash('sha256').update(shared).update('flow-cred-v1').digest();

const ch = cred.getChannel(channel.channelId, 'user-1', fakeReq);
assert.ok(ch);
assert.strictEqual(Buffer.compare(ch.aesKey, aesKey), 0, 'shared AES key mismatch');

const attempt = cred.createAttempt('user-1', 'srv-1', channel.channelId, fakeReq);
const stage = 'password';
const ts = Date.now();
const msg = `${channel.channelId}|${attempt.attemptId}|${stage}|${ts}`;
const mac = crypto.createHmac('sha256', aesKey).update(msg).digest('base64url');
assert.ok(cred.verifyRequestMac(aesKey, { channelId: channel.channelId, attemptId: attempt.attemptId, stage, ts, mac }));

const taken = cred.takeAttemptStage(attempt.attemptId, 'user-1', stage, channel.channelId);
assert.ok(taken.ok);
const again = cred.takeAttemptStage(attempt.attemptId, 'user-1', stage, channel.channelId);
assert.ok(!again.ok, 'stage must be one-use');

const sealed = cred.sealValue(aesKey, 'SecretGooglePass!');
assert.strictEqual(sealed.alg, 'AES-256-GCM');
assert.ok(!JSON.stringify(sealed).includes('SecretGooglePass!'));

const nonce = Buffer.from(sealed.nonce, 'base64url');
const packed = Buffer.from(sealed.ciphertext, 'base64url');
const tag = packed.subarray(packed.length - 16);
const data = packed.subarray(0, packed.length - 16);
const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, nonce);
decipher.setAuthTag(tag);
const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
assert.strictEqual(plain, 'SecretGooglePass!');

assert.strictEqual(cred.maskEmail('alice@gmail.com'), 'a***@gmail.com');
assert.ok(!cred.maskEmail('alice@gmail.com').includes('alice@'));

// curl-style: JWT alone without MAC must fail verify
assert.ok(!cred.verifyRequestMac(aesKey, { channelId: channel.channelId, attemptId: attempt.attemptId, stage: 'email', ts, mac: 'deadbeef' }));

console.log('cred-channel-selftest: PASS');
