'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const { findChrome } = require('./helpers');

/**
 * Ensure a Chrome binary exists for Puppeteer.
 * If missing, runs `npx puppeteer browsers install chrome` once.
 */
async function ensureChrome() {
  let chrome = findChrome();
  if (chrome) {
    console.log(`[chrome] using ${chrome}`);
    return chrome;
  }

  console.warn('[chrome] not found — installing Puppeteer Chrome (one-time)…');
  const bibRoot = path.resolve(__dirname, '..');
  const result = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['puppeteer', 'browsers', 'install', 'chrome'],
    {
      cwd: bibRoot,
      env: process.env,
      encoding: 'utf8',
      timeout: 10 * 60 * 1000,
      shell: process.platform === 'win32',
    }
  );

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  chrome = findChrome();
  if (chrome) {
    console.log(`[chrome] installed → ${chrome}`);
    return chrome;
  }

  const tip =
    'Chrome still missing after install. On the server run:\n' +
    '  cd /opt/flowbysk/flow-bib && npm run install:chrome\n' +
    '  # or install Google Chrome:\n' +
    '  wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && apt install -y ./google-chrome-stable_current_amd64.deb\n' +
    '  echo PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable >> /opt/flowbysk/.env';
  console.error(`[chrome] ${tip}`);
  throw new Error(tip);
}

module.exports = { ensureChrome };
