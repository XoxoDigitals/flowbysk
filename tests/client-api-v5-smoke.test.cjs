/**
 * Smoke-test that client-v5 module loads and refuses extension-step routes.
 * Full HTTP tests require a running server + DB.
 */
const assert = require('assert');
const path = require('path');

const router = require(path.join(__dirname, '..', 'server', 'routes', 'client-v5.js'));
assert.ok(router);
assert.strictEqual(typeof router, 'function');

const stack = router.stack || [];
const paths = stack
  .filter((l) => l.route)
  .map((l) => `${Object.keys(l.route.methods).join(',').toUpperCase()} ${l.route.path}`);

assert.ok(paths.some((p) => p.includes('/session-cookies')), 'session-cookies route missing');
assert.ok(paths.some((p) => p.includes('/extension-step')), 'extension-step refusal route missing');
assert.ok(paths.some((p) => p.includes('/login')), 'login route missing');
assert.ok(!paths.some((p) => p.includes('otp') && p.includes('GET')), 'unexpected otp GET');

console.log('client-api-v5-smoke.test.cjs OK');
console.log(paths.filter((p) => p.includes('session') || p.includes('extension')).join('\n'));
