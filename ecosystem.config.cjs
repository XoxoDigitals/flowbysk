/**
 * PM2 process file for Flowbysk.
 * Ports: web 3100, api 8000, bib 8010 (avoids existing :3000).
 *
 *   cd /opt/flowbysk
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup
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
    /* .env optional at parse time */
  }
  return env;
}

const root = __dirname;
const shared = loadEnv(path.join(root, '.env'));

module.exports = {
  apps: [
    {
      name: 'flowbysk-web',
      cwd: root,
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
        NEXT_PUBLIC_APP_URL:
          shared.NEXT_PUBLIC_APP_URL || 'https://flow.jkdigitalmy.shop',
      },
    },
    {
      name: 'flowbysk-api',
      cwd: root,
      script: path.join(root, '.venv/bin/uvicorn'),
      args: 'backend.app:app --host 127.0.0.1 --port 8000',
      interpreter: 'none',
      autorestart: true,
      max_restarts: 30,
      env: {
        ...shared,
        PYTHONUNBUFFERED: '1',
      },
    },
    {
      name: 'flowbysk-bib',
      cwd: path.join(root, 'flow-bib'),
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 30,
      min_uptime: '10s',
      kill_timeout: 15000,
      exp_backoff_restart_delay: 2000,
      env: {
        ...shared,
        NODE_ENV: 'production',
        BIB_PORT: '8010',
        HEADLESS: 'true',
        PUPPETEER_EXECUTABLE_PATH:
          shared.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
        NEXT_PUBLIC_APP_URL:
          shared.NEXT_PUBLIC_APP_URL || 'https://flow.jkdigitalmy.shop',
      },
    },
  ],
};
