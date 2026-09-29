/**
 * Copies www → www-packed and obfuscates critical shell/inject scripts.
 * Source www/ stays readable for development.
 *
 * Usage: node obfuscate-www.mjs
 */
const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const root = path.join(__dirname, '..');
const srcWww = path.join(root, 'www');
const outWww = path.join(root, 'www-packed');

/** Critical app logic — obfuscate these. Skip already-minified vendor extension bundles. */
const OBFUSCATE_REL = [
  'ui/app-shell.js',
  'scripts/flow-inject.js',
  'scripts/shell-bridge.js',
];

const obfuscatorOptions = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
  target: 'browser',
};

function rimraf(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function obfuscateFile(rel) {
  const full = path.join(outWww, rel);
  if (!fs.existsSync(full)) {
    console.warn('[obfuscate] skip missing', rel);
    return;
  }
  const code = fs.readFileSync(full, 'utf8');
  const result = JavaScriptObfuscator.obfuscate(code, obfuscatorOptions);
  fs.writeFileSync(full, result.getObfuscatedCode(), 'utf8');
  const before = Buffer.byteLength(code, 'utf8');
  const after = Buffer.byteLength(result.getObfuscatedCode(), 'utf8');
  console.log(`[obfuscate] ${rel}  ${before} → ${after} bytes`);
}

function main() {
  if (!fs.existsSync(srcWww)) {
    console.error('[obfuscate] www folder missing:', srcWww);
    process.exit(1);
  }
  rimraf(outWww);
  copyDir(srcWww, outWww);
  for (const rel of OBFUSCATE_REL) obfuscateFile(rel.replace(/\//g, path.sep));
  console.log('[obfuscate] packed →', outWww);
}

main();
