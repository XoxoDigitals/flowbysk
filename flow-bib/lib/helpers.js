'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SITE_KEY = process.env.RECAPTCHA_SITE_KEY || '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';
const START_URL = process.env.FLOW_URL || 'https://flow.google.com/';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const VIEW_W = 1280;
const VIEW_H = 800;

const COOKIE_ALLOW = new Set([
  'SID', 'HSID', 'SSID', 'APISID', 'SAPISID',
  '__Secure-1PSID', '__Secure-3PSID',
  '__Secure-1PAPISID', '__Secure-3PAPISID',
  '__Secure-1PSIDTS', '__Secure-3PSIDTS',
  '__Secure-1PSIDCC', '__Secure-3PSIDCC',
  'OSID', '__Secure-OSID',
  'LSID', '__Host-1PLSID', '__Host-3PLSID',
  'NID',
  // labs.google NextAuth — required for Python worker OAuth / aisandbox fallback
  '__Secure-next-auth.session-token',
  '__Host-next-auth.csrf-token',
  '__Secure-next-auth.callback-url',
  '__Host-next-auth.callback-url',
  'next-auth.session-token',
  'next-auth.csrf-token',
  'next-auth.callback-url',
]);

function cookieAllowed(name) {
  if (!name) return false;
  if (COOKIE_ALLOW.has(name)) return true;
  return /next-auth/i.test(name);
}

const WEB_SESSION = ['SID', 'HSID', 'APISID'];

function _exists(p) {
  try {
    return !!(p && fs.existsSync(p));
  } catch {
    return false;
  }
}

/** Walk Puppeteer cache for a downloaded chrome binary. */
function findCachedPuppeteerChrome() {
  const cacheRoot =
    process.env.PUPPETEER_CACHE_DIR ||
    path.join(process.env.HOME || '/root', '.cache', 'puppeteer');
  if (!_exists(cacheRoot)) return null;
  const chromeRoot = path.join(cacheRoot, 'chrome');
  if (!_exists(chromeRoot)) return null;
  let versions = [];
  try {
    versions = fs.readdirSync(chromeRoot);
  } catch {
    return null;
  }
  // Prefer newest folder name
  versions.sort().reverse();
  for (const ver of versions) {
    const candidates = [
      path.join(chromeRoot, ver, 'chrome-linux64', 'chrome'),
      path.join(chromeRoot, ver, 'chrome-linux', 'chrome'),
      path.join(chromeRoot, ver, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
      path.join(chromeRoot, ver, 'chrome-win64', 'chrome.exe'),
    ];
    for (const c of candidates) {
      if (_exists(c)) return c;
    }
  }
  return null;
}

function findChrome() {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (_exists(fromEnv)) return fromEnv;

  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ];
  const system = candidates.find((p) => _exists(p));
  if (system) return system;

  try {
    // eslint-disable-next-line global-require
    const puppeteer = require('puppeteer');
    if (typeof puppeteer.executablePath === 'function') {
      const bundled = puppeteer.executablePath();
      if (_exists(bundled)) return bundled;
    }
  } catch {
    /* ignore */
  }

  return findCachedPuppeteerChrome() || null;
}

const uid = () => crypto.randomUUID().toUpperCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function projectFromHref(href) {
  const m = (href || '').match(/project\/([a-f0-9-]{36})/i);
  return m ? m[1] : '';
}

function extractImageUrl(text) {
  const m = text.match(/https:\/\/flow-content\.google\/image\/(?:\\+u[0-9a-fA-F]{4}|[^\s"\\,])+/);
  return m
    ? m[0]
        .replace(/\\+u003d/gi, '=')
        .replace(/\\+u0026/gi, '&')
        .replace(/\\+u002f/gi, '/')
    : null;
}

function extractVideoUrl(text) {
  if (!text) return null;
  const m = text.match(/https:\/\/flow-content\.google\/video\/(?:\\+u[0-9a-fA-F]{4}|[^\s"\\,])+/);
  return m
    ? m[0]
        .replace(/\\+u003d/gi, '=')
        .replace(/\\+u0026/gi, '&')
        .replace(/\\+u002f/gi, '/')
    : null;
}

/**
 * mediaId sits immediately before projectId in submit responses.
 * batchexecute escapes quotes as \\" so match quote/backslash/comma loosely.
 * Gotcha from DETAIL.md — without this, Flow still renders but we never poll.
 */
function extractPollId(text, projectId) {
  if (!text || !projectId) return null;
  const pid = String(projectId);
  const pidLower = pid.toLowerCase();

  const patterns = [
    // UUID then escaped/"/,/space then projectId
    new RegExp(
      `([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\\\\["']|["'\\\\]|[,\\s])+${pid}`,
      'i'
    ),
    // Very loose: UUID within 20 chars before projectId
    new RegExp(
      `([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}).{0,20}${pid}`,
      'i'
    ),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1].toLowerCase() !== pidLower) return m[1];
  }

  // Near VIDEO_GENERATION marker
  const near =
    text.match(
      /VIDEO_GENERATION[\s\S]{0,240}?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
    ) ||
    text.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[\s\S]{0,240}?VIDEO_GENERATION/i
    );
  if (near && near[1].toLowerCase() !== pidLower) return near[1];

  return null;
}

function normalizeCharacters(characters) {
  const out = [];
  for (const c of characters || []) {
    if (!c || typeof c !== 'object') continue;
    // Prefer Google Flow entity id only — never fall back to studio-local character_id/id
    // (local UUIDs make Flow treat the prompt as plain "@Name …" text instead of chips).
    const entityId = String(
      c.flow_entity_id || c.flowEntityId || c.entity_id || c.entityId || ''
    ).trim();
    const name = String(c.name || c.display_name || c.displayName || 'Character').trim();
    if (!entityId) continue;
    const row = { entity_id: entityId, name: name || 'Character' };
    const mid = c.image_media_id || c.imageMediaId || c.portrait_media_id;
    if (mid) row.image_media_id = String(mid).trim();
    out.push(row);
    if (out.length >= 4) break;
  }
  return out;
}

/** Match Python build_structured_prompt_parts — character @mentions for ogiZ0b / MZZa6b. */
function buildStructuredPromptParts(prompt, characters) {
  const refs = normalizeCharacters(characters);
  const text = prompt == null ? '' : String(prompt);
  if (!refs.length) return [[[text]]];

  const parts = [];
  for (const ref of refs) {
    parts.push([null, [null, null, [ref.entity_id, ref.name || 'Character']]]);
  }
  let remainder = text;
  for (const ref of refs) {
    const name = ref.name || '';
    if (!name) continue;
    let stripped = remainder.replace(/^\s+/, '');
    for (const prefix of [`@${name}`, name]) {
      if (stripped.startsWith(prefix)) {
        stripped = stripped.slice(prefix.length).replace(/^\s+/, '');
        remainder = stripped;
        break;
      }
    }
  }
  if (remainder && !/^[\s\n\t]/.test(remainder)) {
    remainder = ` ${remainder}`;
  }
  parts.push([remainder || '']);
  return [parts];
}

function buildOgiRequest(ctx, projectId, prompt, model, aspectRatio, recaptcha, imageIds, characters, destinationCharacterId) {
  const aspectEnum = aspectRatio === '16:9' ? 3 : aspectRatio === '9:16' ? 2 : 1;
  const seed = Math.floor(Math.random() * 900000000) + 100000000;
  const cctx = [null, 22, null, null, null, projectId, null, null, null, null, [recaptcha, 1]];
  const imgs = Array.isArray(imageIds) ? imageIds.filter(Boolean).slice(0, 7) : [];
  const refs = normalizeCharacters(characters);
  // I2I remix: [[mediaId, null, null, null, 1], ...] — T2I leaves this null
  const imageSlot = imgs.length ? imgs.map((mid) => [mid, null, null, null, 1]) : null;
  const promptParts = buildStructuredPromptParts(prompt, refs);
  // Match Python build_ogiZ0b_payload: [[entityId, ...]] — NOT [[[...]]]
  const refIdsSlot = refs.length ? [refs.map((r) => r.entity_id)] : null;
  const reqBlock = [
    null,
    null,
    imageSlot,
    seed,
    aspectEnum,
    model,
    null,
    cctx,
    promptParts,
    null,
    refIdsSlot,
    null,
    uid(),
    uid(),
  ];
  // Portrait bind: destination_character_id → [batchUuid, null, [entityId, [0]]]
  const dest = String(destinationCharacterId || '').trim();
  const batchTail = dest ? [uid(), null, [dest, [0]]] : [uid()];
  const inner = [null, [reqBlock], 1, cctx, batchTail];
  const freq = JSON.stringify([[['ogiZ0b', JSON.stringify(inner), null, 'generic']]]);
  const body = 'f.req=' + encodeURIComponent(freq) + '&at=' + encodeURIComponent(ctx.at) + '&';
  const reqid = Math.floor(Math.random() * 900000) + 100000;
  const url =
    `${ctx.origin}/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=ogiZ0b` +
    `&source-path=${encodeURIComponent('/project/' + projectId)}` +
    `&bl=${encodeURIComponent(ctx.bl)}&f.sid=${encodeURIComponent(ctx.sid)}&hl=en-US&_reqid=${reqid}&rt=c`;
  return { url, body, seed };
}

function buildBatch(ctx, projectId, rpcid, innerPayload) {
  const freq = JSON.stringify([[[rpcid, JSON.stringify(innerPayload), null, 'generic']]]);
  const body = 'f.req=' + encodeURIComponent(freq) + '&at=' + encodeURIComponent(ctx.at) + '&';
  const reqid = Math.floor(Math.random() * 900000) + 100000;
  const url =
    `${ctx.origin}/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=${rpcid}` +
    `&source-path=${encodeURIComponent('/project/' + projectId)}` +
    `&bl=${encodeURIComponent(ctx.bl)}&f.sid=${encodeURIComponent(ctx.sid)}&hl=en-US&_reqid=${reqid}&rt=c`;
  return { url, body };
}

function payloadT2V(projectId, prompt, model, aspect, recaptcha, characters) {
  const cctx = [null, 22, null, null, null, projectId, null, null, null, null, [recaptcha, 1]];
  const refs = normalizeCharacters(characters);
  const promptParts = buildStructuredPromptParts(prompt, refs);
  const reqBlock = [
    [null, null, promptParts],
    model,
    aspect,
    null,
    [null, null, null, null, uid(), uid()],
  ];
  if (refs.length) {
    reqBlock.push(null, null, null, [refs.map((r) => r.entity_id)]);
  }
  // Capture T2V tail uses [batchUuid, 2]
  return [[reqBlock], cctx, [uid(), 2]];
}

/**
 * Single-image animate (MZZa6b). Characters use structured prompt + entity slot.
 * For first+last / multi-ref, use aisandbox ReferenceImages instead.
 */
function payloadI2V(projectId, prompt, imageId, model, aspect, recaptcha, characters) {
  const cctx = [null, 22, null, null, null, projectId, null, null, null, null, [recaptcha, 1]];
  const refs = normalizeCharacters(characters);
  const promptParts = buildStructuredPromptParts(prompt, refs);
  const imageSlot = imageId ? [[null, imageId]] : null;
  const reqBlock = [
    [null, null, promptParts],
    imageSlot,
    model,
    aspect,
    null,
    [null, null, null, null, uid(), uid()],
  ];
  if (refs.length) {
    reqBlock.push(null, null, null, [refs.map((r) => r.entity_id)]);
  }
  // Capture I2V tail is [batchUuid, 1]
  return [[reqBlock], cctx, [uid(), 1]];
}

function aspectToSandboxEnum(aspectRatio) {
  if (aspectRatio === '9:16' || aspectRatio === 1) return 'VIDEO_ASPECT_RATIO_PORTRAIT';
  if (aspectRatio === '1:1' || aspectRatio === 3) return 'VIDEO_ASPECT_RATIO_SQUARE';
  return 'VIDEO_ASPECT_RATIO_LANDSCAPE';
}

/** Multi-ref / first+last / character-portrait R2V via aisandbox (no Python CDP). */
function buildReferenceImagesPayload(projectId, prompt, model, aspectRatio, mediaIds, recaptcha) {
  const refs = [...new Set((mediaIds || []).filter(Boolean))].slice(0, 3).map((mediaId) => ({
    mediaId,
  }));
  const seed = Math.floor(Math.random() * 900000) + 10000;
  return {
    mediaGenerationContext: { batchId: `bib-r2v-${Date.now()}` },
    clientContext: {
      projectId,
      tool: 'PINHOLE',
      recaptchaContext: {
        token: recaptcha || '',
        applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB',
      },
    },
    requests: [
      {
        aspectRatio: aspectToSandboxEnum(aspectRatio),
        seed,
        textInput: {
          prompt,
          structuredPrompt: { parts: [{ text: prompt }] },
        },
        videoModelKey: model,
        referenceImages: refs,
        metadata: { sceneId: uid() },
      },
    ],
    useV2ModelConfig: true,
  };
}

function buildStartImagePayload(projectId, prompt, model, aspectRatio, startImageId, endImageId, recaptcha) {
  const seed = Math.floor(Math.random() * 900000) + 10000;
  const req = {
    aspectRatio: aspectToSandboxEnum(aspectRatio),
    seed,
    textInput: {
      prompt,
      structuredPrompt: { parts: [{ text: prompt }] },
    },
    videoModelKey: model,
    metadata: { sceneId: uid() },
  };
  if (startImageId) req.startImage = { mediaId: startImageId };
  if (endImageId) req.endImage = { mediaId: endImageId };
  return {
    mediaGenerationContext: { batchId: `bib-i2v-${Date.now()}` },
    clientContext: {
      projectId,
      tool: 'PINHOLE',
      recaptchaContext: {
        token: recaptcha || '',
        applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB',
      },
    },
    requests: [req],
    useV2ModelConfig: true,
  };
}

function extractSandboxMediaId(data) {
  if (!data || typeof data !== 'object') return null;
  const workflows = data.workflows;
  if (Array.isArray(workflows) && workflows[0]) {
    const wf = workflows[0];
    const primary = (wf.metadata || {}).primaryMediaId || '';
    if (primary) return primary;
    if (wf.name && /^[a-f0-9-]{36}$/i.test(wf.name)) return wf.name;
  }
  const media = data.media;
  if (Array.isArray(media) && media[0] && typeof media[0] === 'object') {
    return media[0].name || media[0].mediaId || null;
  }
  return null;
}

function ogiHeaders(ctx, cookie) {
  return {
    'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
    'X-Same-Domain': '1',
    Origin: ctx.origin,
    Referer: ctx.href,
    'User-Agent': UA,
    Cookie: cookie,
  };
}

/** C4BZMd — create Flow character entity (optional media ids = use-my-own-image). */
function payloadC4BZMd(projectId, displayName, mediaIds) {
  const mediaSlot = (Array.isArray(mediaIds) ? mediaIds : [])
    .map((m) => String(m || '').trim())
    .filter(Boolean);
  return [[projectId, null, null, [1, displayName || 'Untitled character', mediaSlot]]];
}

/**
 * Parse C4BZMd batchexecute body for the new character entity UUID.
 * Response shape: [[projectId, characterEntityId, null, [1, name, mediaIds], ...]]
 */
function extractCharacterEntityId(text, projectId) {
  if (!text) return null;
  const pid = String(projectId || '').toLowerCase();
  const uuidRe =
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

  // Prefer structured wrb.fr parse
  for (const rawLine of String(text).split(/\n+/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith(")]}'")) continue;
    if (/^\d+\s*\[/.test(line)) line = line.replace(/^\d+\s*/, '');
    if (!line.includes('C4BZMd') && !line.includes('wrb.fr')) continue;
    try {
      const outer = JSON.parse(line);
      const row = Array.isArray(outer) ? outer[0] : null;
      if (!Array.isArray(row) || row[0] !== 'wrb.fr') continue;
      if (row[1] !== 'C4BZMd') continue;
      if (row[2] == null) continue;
      const payload = typeof row[2] === 'string' ? JSON.parse(row[2]) : row[2];
      const first = Array.isArray(payload) ? payload[0] : null;
      if (Array.isArray(first) && first.length > 1 && first[1]) {
        const eid = String(first[1]);
        if (/^[0-9a-f-]{36}$/i.test(eid) && eid.toLowerCase() !== pid) return eid;
      }
    } catch {
      /* keep scanning */
    }
  }

  // Fallback: first UUID in response that is not the project id
  const all = String(text).match(uuidRe) || [];
  for (const u of all) {
    if (u.toLowerCase() !== pid) return u;
  }
  return null;
}

module.exports = {
  SITE_KEY,
  START_URL,
  UA,
  VIEW_W,
  VIEW_H,
  COOKIE_ALLOW,
  cookieAllowed,
  WEB_SESSION,
  findChrome,
  uid,
  sleep,
  projectFromHref,
  extractImageUrl,
  extractVideoUrl,
  extractPollId,
  extractCharacterEntityId,
  normalizeCharacters,
  buildStructuredPromptParts,
  buildOgiRequest,
  buildBatch,
  payloadC4BZMd,
  payloadT2V,
  payloadI2V,
  buildReferenceImagesPayload,
  buildStartImagePayload,
  extractSandboxMediaId,
  aspectToSandboxEnum,
  ogiHeaders,
};
