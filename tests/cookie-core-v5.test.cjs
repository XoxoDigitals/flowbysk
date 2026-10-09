const assert = require('assert');
const path = require('path');
const CookieCoreV5 = require(path.join(__dirname, '..', 'shared', 'cookie-core-v5.js'));

const now = Math.floor(Date.now() / 1000);

const sample = [
  {
    name: 'SID',
    value: 'abc123',
    domain: '.google.com',
    path: '/',
    secure: false,
    httpOnly: true,
    sameSite: 'unspecified',
    expirationDate: now + 86400 * 10,
  },
  {
    name: '__Secure-1PSID',
    value: 'secure-val',
    domain: '.google.com',
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'no_restriction',
    expirationDate: now + 86400 * 5,
  },
  {
    name: 'EXPIRED',
    value: 'nope',
    domain: '.google.com',
    path: '/',
    expirationDate: now - 100,
  },
];

const prepared = CookieCoreV5.prepareFromInput(sample);
assert.strictEqual(prepared.meta.count, 2);
assert.strictEqual(prepared.meta.skippedExpired, 1);
assert.ok(prepared.meta.earliestExpiry <= prepared.meta.latestExpiry);
const names = prepared.meta.sortedPreview.map((r) => r.name).sort();
assert.deepStrictEqual(names, ['SID', '__Secure-1PSID'].sort());
const sid = prepared.meta.sortedPreview.find((r) => r.name === 'SID');
assert.strictEqual(sid.valueHash, CookieCoreV5.sha256HexSync('abc123'));

assert.throws(() => CookieCoreV5.prepareFromInput([{ name: 'x', value: 'y', domain: 'evil.com' }]));

const wv = CookieCoreV5.toWebView2Cookies(prepared.prepared);
assert.strictEqual(wv.length, 2);
assert.ok(wv.every((c) => c.valueHash && c.url.startsWith('https://')));

console.log('cookie-core-v5.test.cjs OK');
