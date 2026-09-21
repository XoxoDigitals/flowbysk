/**
 * Start BiB (8010) + Next (3000). Optionally auto-launch READY accounts.
 * Usage: node scripts/dev-all.mjs
 */
const { spawn } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';
const kids = [];

function run(cmd, args, cwd, name) {
  const child = spawn(cmd, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env },
    shell: isWin,
  });
  child.on('exit', (code) => {
    console.log(`[${name}] exited ${code}`);
  });
  kids.push(child);
  return child;
}

function shutdown() {
  for (const c of kids) {
    try {
      c.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('[dev-all] Starting BiB on 8010…');
run(npm, ['run', 'start'], path.join(root, 'flow-bib'), 'bib');

setTimeout(() => {
  console.log('[dev-all] Starting Next on 3000…');
  run(npm, ['run', 'dev'], root, 'next');
}, 2000);

setTimeout(() => {
  console.log('[dev-all] Auto-launching BiB accounts…');
  const launch = spawn(process.execPath, [path.join(root, 'scripts', 'bib-autolaunch.cjs')], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env },
  });
  kids.push(launch);
}, 8000);
