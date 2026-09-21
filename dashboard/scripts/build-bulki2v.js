/**
 * Build public/static/bulki2v.js from bulkt2v.js + I2V patches.
 * Run: node scripts/build-bulki2v.js
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
let js = fs.readFileSync(path.join(root, 'public/static/bulkt2v.js'), 'utf8');

const renames = [
  ['__GFLOW_BULKT2V_INIT__', '__GFLOW_BULKI2V_INIT__'],
  ['gflow_btv_state_v1', 'gflow_biv_state_v1'],
  ['initBulkT2V', 'initBulkI2V'],
  ['__gflowBulkT2VOnModelLock', '__gflowBulkI2VOnModelLock'],
  ['applyBulkT2VModelLockSync', 'applyBulkI2VModelLockSync'],
  ['cancelBulkT2VPendingJobs', 'cancelBulkI2VPendingJobs'],
  ['parseBulkT2VScript', 'parseBulkI2VScript'],
  ['Bulk T2V', 'Bulk I2V'],
  ['BulkT2V', 'BulkI2V'],
  ['[BulkT2V]', '[BulkI2V]'],
  ['bulkt2v', 'bulki2v'],
  ['btv-', 'biv-'],
];
for (const [a, b] of renames) js = js.split(a).join(b);

// Rename state object carefully
js = js.replace(/\bconst btv =/, 'const biv =');
js = js.replace(/\bbtv\./g, 'biv.');
js = js.replace(/\bbtv\b/g, 'biv');

js = js.replace(/\/api\/generate\/video/g, '/api/generate/image-to-video');
js = js.replace(/submitVideoJob/g, 'submitI2VJob');
js = js.replace(/submitAndWaitVideo/g, 'submitAndWaitI2V');
js = js.replace(/source: 'bulki2v'/g, "source: 'bulki2v'");

fs.writeFileSync(path.join(root, 'public/static/bulki2v.js'), js);
console.log('Wrote base bulki2v.js — apply patches next');
