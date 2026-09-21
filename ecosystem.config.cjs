/**
 * PM2 — Flow Creator Ai only (no Python API, no BiB)
 * Web:  dashboard/  → :3100
 * API:  server/     → :8000  (desktop exe + dashboard API)
 *
 *   cd /opt/flowbysk
 *   pm2 delete all
 *   pm2 start ecosystem.config.cjs && pm2 save
 */
const fs = require('fs');
const path = require('path');

function loadEnv(file) {
  const env = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const i = trimmed.indexOf('=');
      if (i < 1) continue;
      const key = trimmed.slice(0, i).trim();
      let val = trimmed.slice(i + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  } catch {
    /* optional */
  }
  return env;
}

const root = __dirname;
const shared = loadEnv(path.join(root, '.env'));
const siteUrl = shared.NEXT_PUBLIC_APP_URL || 'https://flowcreatorai.site';

module.exports = {
  apps: [
    {
      name: 'flowbysk-web',
      cwd: path.join(root, 'dashboard'),
      script: 'node_modules/next/dist/bin/next',
      args: 'start -H 127.0.0.1 -p 3100',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 30,
      env: {
        ...shared,
        NODE_ENV: 'production',
        PORT: '3100',
        NEXT_PUBLIC_APP_URL: siteUrl,
        NEXT_PUBLIC_FLOW_API_URL: shared.NEXT_PUBLIC_FLOW_API_URL || siteUrl,
      },
    },
    {
      name: 'flowbysk-server',
      cwd: path.join(root, 'server'),
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 30,
      env: {
        ...shared,
        NODE_ENV: 'production',
        PORT: '8000',
      },
    },
  ],
};
