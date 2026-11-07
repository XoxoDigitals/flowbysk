/**
 * Copies www → www-packed and obfuscates every .js file + inline HTML scripts + minifies CSS/HTML.
 * Source www/ stays readable for development.
 *
 * Large already-bundled assets / ES module chunks use LIGHT_OPTS (100% base64 string array + hex identifiers).
 */
const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const root = path.join(__dirname, '..');
const srcWww = path.join(root, 'www');
const outWww = path.join(root, 'www-packed');

const HEAVY_OPTS = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 10,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 0.75,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 4,
  stringArrayWrappersType: 'function',
  stringArrayThreshold: 1,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
  target: 'browser',
};

/** Safe pass for pre-minified ES module / Rollup / Vite bundles — 100% string array encoding */
const LIGHT_OPTS = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: false,
  simplify: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 1,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
  target: 'browser',
};

const LIGHT_BYTES = 100 * 1024; // 100 KB — large scripts (flow-inject, app-shell, veo-content-bundle) use LIGHT_OPTS (100% base64 string array + hex identifiers)
const SKIP_BYTES = 2 * 1024 * 1024; // 2 MB — third-party UI vendor library (primevue)

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

function listFilesByExt(dir, ext, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesByExt(full, ext, base));
    else if (entry.name.toLowerCase().endsWith(ext)) {
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
  const normRel = rel.replace(/\\/g, '/');
  const code = fs.readFileSync(full, 'utf8');
  const before = Buffer.byteLength(code, 'utf8');
  if (before >= SKIP_BYTES) {
    console.log(`[obfuscate] SKIP vendor library (>${SKIP_BYTES}B) ${rel}  ${before} bytes`);
    return;
  }
  const isEsModuleOrBundle =
    before >= LIGHT_BYTES ||
    normRel.endsWith('veo-content-bundle.js') ||
    normRel.startsWith('extensions/veo-auto/assets/') ||
    normRel.endsWith('service-worker-loader.js');
  const opts = isEsModuleOrBundle ? LIGHT_OPTS : HEAVY_OPTS;
  const mode = isEsModuleOrBundle ? 'light' : 'heavy';
  const result = JavaScriptObfuscator.obfuscate(code, opts);
  const out = result.getObfuscatedCode();
  fs.writeFileSync(full, out, 'utf8');
  const after = Buffer.byteLength(out, 'utf8');
  console.log(`[obfuscate] ${mode} ${rel}  ${before} → ${after} bytes`);
}

function minifyCssFile(rel) {
  const full = path.join(outWww, rel);
  if (!fs.existsSync(full)) return;
  const css = fs.readFileSync(full, 'utf8');
  const min = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>~])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
  fs.writeFileSync(full, min, 'utf8');
}

function obfuscateHtmlFile(rel) {
  const full = path.join(outWww, rel);
  if (!fs.existsSync(full)) return;
  let html = fs.readFileSync(full, 'utf8');
  // Remove HTML comments
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  // Obfuscate inline <script> blocks (without src attribute)
  html = html.replace(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi, (match, attrs, body) => {
    const trimmed = (body || '').trim();
    if (!trimmed) return match;
    try {
      const obf = JavaScriptObfuscator.obfuscate(trimmed, HEAVY_OPTS).getObfuscatedCode();
      return `<script${attrs}>${obf}</script>`;
    } catch (e) {
      return match;
    }
  });
  // Minify inline <style> blocks
  html = html.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (match, attrs, css) => {
    const minCss = (css || '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .replace(/\s*([{}:;,>~])\s*/g, '$1')
      .replace(/;}/g, '}')
      .trim();
    return `<style${attrs}>${minCss}</style>`;
  });
  // Collapse inter-tag whitespace
  html = html.replace(/>\s+</g, '><').trim();
  fs.writeFileSync(full, html, 'utf8');
}

function main() {
  if (!fs.existsSync(srcWww)) {
    console.error('[obfuscate] www folder missing:', srcWww);
    process.exit(1);
  }
  rimraf(outWww);
  copyDir(srcWww, outWww);
  // Remove unused legacy extension and metadata folders from packed output
  rimraf(path.join(outWww, 'extensions', 'veo-shio-auto-login'));
  rimraf(path.join(outWww, 'extensions', 'veo-auto', '_metadata'));

  const jsFiles = listFilesByExt(outWww, '.js').sort();
  console.log(`[obfuscate] ${jsFiles.length} JS files`);
  for (const rel of jsFiles) obfuscateFile(rel);

  const cssFiles = listFilesByExt(outWww, '.css').sort();
  for (const rel of cssFiles) minifyCssFile(rel);

  const htmlFiles = listFilesByExt(outWww, '.html').sort();
  for (const rel of htmlFiles) obfuscateHtmlFile(rel);

  console.log('[obfuscate] packed →', outWww);
}

main();
