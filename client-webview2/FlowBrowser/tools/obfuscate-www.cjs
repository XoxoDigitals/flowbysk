/**
 * Copies www → www-packed and obfuscates every .js file.
 * Source www/ stays readable for development.
 *
 * Large already-bundled assets use lighter options (speed + less breakage).
 */
const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const root = path.join(__dirname, '..');
const srcWww = path.join(root, 'www');
const outWww = path.join(root, 'www-packed');

const HEAVY_OPTS = {
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

/** Lighter pass for big Vite/vendor bundles */
const LIGHT_OPTS = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.5,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
  target: 'browser',
};

const LIGHT_BYTES = 200 * 1024; // 200 KB
const SKIP_BYTES = 2 * 1024 * 1024; // 2 MB — already opaque minified; re-obfuscating OOMs / breaks

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

function listJsFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(full, base));
    else if (entry.name.toLowerCase().endsWith('.js')) {
      out.push(path.relative(base, full));
    }
  }
  return out;
}

function obfuscateFile(rel) {
  const full = path.join(outWww, rel);
  if (!fs.existsSync(full)) {
    console.warn('[obfuscate] skip missing', rel);
    return;
  }
  const code = fs.readFileSync(full, 'utf8');
  const before = Buffer.byteLength(code, 'utf8');
  if (before >= SKIP_BYTES) {
    console.log(`[obfuscate] SKIP huge (already minified) ${rel}  ${before} bytes`);
    return;
  }
  const opts = before >= LIGHT_BYTES ? LIGHT_OPTS : HEAVY_OPTS;
  const mode = before >= LIGHT_BYTES ? 'light' : 'heavy';
  const result = JavaScriptObfuscator.obfuscate(code, opts);
  const out = result.getObfuscatedCode();
  fs.writeFileSync(full, out, 'utf8');
  const after = Buffer.byteLength(out, 'utf8');
  console.log(`[obfuscate] ${mode} ${rel}  ${before} → ${after} bytes`);
}

function main() {
  if (!fs.existsSync(srcWww)) {
    console.error('[obfuscate] www folder missing:', srcWww);
    process.exit(1);
  }
  rimraf(outWww);
  copyDir(srcWww, outWww);
  const files = listJsFiles(outWww).sort();
  console.log(`[obfuscate] ${files.length} JS files`);
  for (const rel of files) obfuscateFile(rel);
  console.log('[obfuscate] packed →', outWww);
}

main();
