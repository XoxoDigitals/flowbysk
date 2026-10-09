/**
 * Cookie-core v5 — shared parse/sort/allowlist/SHA-256 prep for Flow Browser v5.
 * Works in Node (crypto) and browsers (Web Crypto / sync fallback).
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.CookieCoreV5 = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DAY_SECONDS = 24 * 60 * 60;
  const MAX_EXTENSION_DAYS = 400;
  const SAME_SITE_VALUES = new Set([
    'no_restriction',
    'lax',
    'strict',
    'unspecified',
  ]);

  function parseCookieInput(textOrValue) {
    let parsed = textOrValue;
    if (typeof textOrValue === 'string') {
      if (!textOrValue.trim()) {
        throw new Error('Paste a JSON cookie array first.');
      }
      try {
        parsed = JSON.parse(textOrValue);
      } catch (error) {
        throw new Error(`The pasted text is not valid JSON: ${error.message}`);
      }
    }

    const cookies = Array.isArray(parsed) ? parsed : parsed && parsed.cookies;
    if (!Array.isArray(cookies)) {
      throw new Error('Expected a JSON array, or an object with a cookies array.');
    }
    if (cookies.length === 0) {
      throw new Error('The cookie list is empty.');
    }
    if (cookies.length > 500) {
      throw new Error('For safety, import no more than 500 cookies at once.');
    }
    return cookies;
  }

  function normalizeDomain(value) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('Cookie domain is missing.');
    }
    const original = value.trim().toLowerCase();
    const clean = original.replace(/^\.+/, '');
    if (!clean || clean.includes(':') || clean.includes('/') || /\s/.test(clean)) {
      throw new Error(`Invalid cookie domain: ${value}`);
    }
    return { original, clean };
  }

  function isAllowedDomain(domain) {
    return (
      domain === 'labs.google' ||
      domain.endsWith('.labs.google') ||
      domain === 'google.com' ||
      domain.endsWith('.google.com')
    );
  }

  function normalizeSameSite(value) {
    if (value === null || value === undefined || value === '') return undefined;
    const normalized = String(value).toLowerCase().replaceAll('-', '_');
    const mapped = normalized === 'none' ? 'no_restriction' : normalized;
    if (!SAME_SITE_VALUES.has(mapped)) {
      throw new Error(`Unsupported SameSite value: ${value}`);
    }
    return mapped;
  }

  function normalizePath(value) {
    if (value === null || value === undefined || value === '') return '/';
    if (typeof value !== 'string' || !value.startsWith('/')) {
      throw new Error('Cookie path must start with /.');
    }
    return value;
  }

  function normalizePartitionKey(value) {
    if (value === null || value === undefined) return undefined;
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('partitionKey must be an object.');
    }
    const output = {};
    if (value.topLevelSite !== undefined) {
      try {
        const site = new URL(value.topLevelSite);
        if (site.protocol !== 'https:' && site.protocol !== 'http:') throw new Error();
        output.topLevelSite = site.origin;
      } catch (_error) {
        throw new Error('partitionKey.topLevelSite must be an HTTP(S) origin.');
      }
    }
    if (value.hasCrossSiteAncestor !== undefined) {
      output.hasCrossSiteAncestor = Boolean(value.hasCrossSiteAncestor);
    }
    return Object.keys(output).length ? output : undefined;
  }

  function resolveExpiration(cookie, minimumDays, nowSeconds) {
    if (cookie.session === true) return undefined;
    const original = Number(cookie.expirationDate);
    const hasOriginal = Number.isFinite(original) && original > 0;
    const days = Number(minimumDays);
    const chromeMaximum = nowSeconds + MAX_EXTENSION_DAYS * DAY_SECONDS;

    if (!Number.isFinite(days) || days <= 0) {
      if (hasOriginal) {
        if (original <= nowSeconds) {
          throw new Error('Cookie has expired. Upload a fresh browser cookie export.');
        }
        return Math.min(original, chromeMaximum);
      }
      return undefined;
    }

    const boundedDays = Math.min(days, MAX_EXTENSION_DAYS);
    const minimum = nowSeconds + boundedDays * DAY_SECONDS;
    return hasOriginal ? Math.min(Math.max(original, minimum), chromeMaximum) : minimum;
  }

  function buildSetDetails(cookie, options = {}) {
    if (!cookie || typeof cookie !== 'object' || Array.isArray(cookie)) {
      throw new Error('Each cookie must be a JSON object.');
    }
    if (typeof cookie.name !== 'string') {
      throw new Error('Cookie name must be a string.');
    }
    if (typeof cookie.value !== 'string') {
      throw new Error(`Cookie ${cookie.name || '(unnamed)'} has a non-string value.`);
    }

    const domain = normalizeDomain(cookie.domain);
    if (!isAllowedDomain(domain.clean)) {
      throw new Error(`Domain ${domain.clean} is outside the allowed Google hosts.`);
    }

    const isHostPrefix = cookie.name.startsWith('__Host-');
    const isSecurePrefix = cookie.name.startsWith('__Secure-');
    const inferredHostOnly = !domain.original.startsWith('.');
    const hostOnly =
      isHostPrefix || (typeof cookie.hostOnly === 'boolean' ? cookie.hostOnly : inferredHostOnly);
    const path = isHostPrefix ? '/' : normalizePath(cookie.path);
    const sameSite = normalizeSameSite(cookie.sameSite);
    const secure =
      Boolean(cookie.secure) || isHostPrefix || isSecurePrefix || sameSite === 'no_restriction';
    const nowSeconds = Number.isFinite(options.nowSeconds) ? options.nowSeconds : Date.now() / 1000;

    const details = {
      url: `https://${domain.clean}${path}`,
      name: cookie.name,
      value: cookie.value,
      path,
      secure,
      httpOnly: Boolean(cookie.httpOnly),
    };

    if (!hostOnly) {
      details.domain = domain.original.startsWith('.') ? domain.original : `.${domain.clean}`;
    }
    if (sameSite !== undefined) details.sameSite = sameSite;

    const expirationDate = resolveExpiration(cookie, options.minimumDays, nowSeconds);
    if (expirationDate !== undefined) details.expirationDate = expirationDate;

    const partitionKey = normalizePartitionKey(cookie.partitionKey);
    if (partitionKey !== undefined) details.partitionKey = partitionKey;

    return {
      details,
      expected: {
        domain: domain.clean,
        hostOnly,
        path,
        secure,
        httpOnly: Boolean(cookie.httpOnly),
        expirationDate,
        sameSite: sameSite || 'unspecified',
        partitionKey,
      },
    };
  }

  function prepareImport(cookies, options = {}) {
    const nowSeconds = Number.isFinite(options.nowSeconds) ? options.nowSeconds : Date.now() / 1000;
    const unique = new Map();
    let skippedExpired = 0;
    let skippedDuplicates = 0;
    for (const cookie of cookies) {
      const expiration = Number(cookie?.expirationDate);
      if (
        cookie?.session !== true &&
        Number.isFinite(expiration) &&
        expiration > 0 &&
        expiration <= nowSeconds
      ) {
        skippedExpired++;
        continue;
      }
      const item = buildSetDetails(cookie, { ...options, nowSeconds });
      const key = JSON.stringify([
        item.details.name,
        item.expected.domain,
        item.expected.hostOnly,
        item.expected.path,
        item.expected.partitionKey?.topLevelSite || '',
        item.expected.partitionKey?.hasCrossSiteAncestor || false,
      ]);
      if (unique.has(key)) skippedDuplicates++;
      unique.set(key, item);
    }
    if (!unique.size) {
      throw new Error('No unexpired cookies are available. Upload a fresh browser cookie export.');
    }
    return { prepared: [...unique.values()], skippedExpired, skippedDuplicates };
  }

  function verifyCookie(actual, expected) {
    const problems = [];
    if (!actual) return ['Chrome returned no cookie after writing it.'];
    const actualDomain = String(actual.domain || '').replace(/^\./, '');
    if (actualDomain !== expected.domain) problems.push('domain does not match');
    if (actual.hostOnly !== expected.hostOnly) problems.push('host-only scope does not match');
    if (actual.path !== expected.path) problems.push('path does not match');
    if (actual.secure !== expected.secure) problems.push('Secure flag does not match');
    if (actual.httpOnly !== expected.httpOnly) problems.push('HttpOnly flag does not match');
    if (actual.sameSite !== expected.sameSite) problems.push('SameSite flag does not match');
    if (
      Boolean(actual.partitionKey) !== Boolean(expected.partitionKey) ||
      (expected.partitionKey?.topLevelSite &&
        actual.partitionKey?.topLevelSite !== expected.partitionKey.topLevelSite) ||
      (expected.partitionKey?.hasCrossSiteAncestor !== undefined &&
        actual.partitionKey?.hasCrossSiteAncestor !==
          expected.partitionKey.hasCrossSiteAncestor)
    ) {
      problems.push('partition key does not match');
    }
    if (expected.expirationDate !== undefined) {
      if (
        !Number.isFinite(actual.expirationDate) ||
        Math.abs(actual.expirationDate - expected.expirationDate) > 2
      ) {
        problems.push('expiration does not match');
      }
    } else if (!actual.session) {
      problems.push('expected a session cookie');
    }
    return problems;
  }

  /** Pure JS SHA-256 so Node crypto and browser hashes always match. */
  function sha256HexPure(message) {
    const K = new Uint32Array([
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]);
    function rotr(n, x) {
      return (x >>> n) | (x << (32 - n));
    }
    const bytes = unescape(encodeURIComponent(String(message)));
    const len = bytes.length;
    const bitLen = len * 8;
    const withPad = new Uint8Array(((len + 9 + 63) >> 6) << 6);
    for (let i = 0; i < len; i++) withPad[i] = bytes.charCodeAt(i);
    withPad[len] = 0x80;
    const view = new DataView(withPad.buffer);
    view.setUint32(withPad.length - 4, bitLen >>> 0, false);
    view.setUint32(withPad.length - 8, Math.floor(bitLen / 0x100000000), false);
    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;
    const w = new Uint32Array(64);
    for (let i = 0; i < withPad.length; i += 64) {
      for (let t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4, false);
      for (let t = 16; t < 64; t++) {
        const s0 = rotr(7, w[t - 15]) ^ rotr(18, w[t - 15]) ^ (w[t - 15] >>> 3);
        const s1 = rotr(17, w[t - 2]) ^ rotr(19, w[t - 2]) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      let a = h0;
      let b = h1;
      let c = h2;
      let d = h3;
      let e = h4;
      let f = h5;
      let g = h6;
      let h = h7;
      for (let t = 0; t < 64; t++) {
        const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
        const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + temp1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) >>> 0;
      }
      h0 = (h0 + a) >>> 0;
      h1 = (h1 + b) >>> 0;
      h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0;
      h5 = (h5 + f) >>> 0;
      h6 = (h6 + g) >>> 0;
      h7 = (h7 + h) >>> 0;
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7]
      .map((x) => x.toString(16).padStart(8, '0'))
      .join('');
  }

  function sha256HexSync(value) {
    if (typeof require === 'function') {
      try {
        const nodeCrypto = require('crypto');
        return nodeCrypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
      } catch (_e) {
        /* fall through */
      }
    }
    return sha256HexPure(value);
  }

  async function sha256Hex(value) {
    if (typeof require === 'function') {
      try {
        const crypto = require('crypto');
        return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
      } catch (_e) {
        /* fall through */
      }
    }
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    }
    return sha256HexSync(value);
  }

  function sortPrepared(prepared) {
    return [...prepared].sort((a, b) => {
      const da = a.expected.domain.localeCompare(b.expected.domain);
      if (da) return da;
      const pa = a.expected.path.localeCompare(b.expected.path);
      if (pa) return pa;
      return a.details.name.localeCompare(b.details.name);
    });
  }

  function buildMeta(prepared, extras = {}) {
    const sorted = sortPrepared(prepared);
    let earliestExpiry = null;
    let latestExpiry = null;
    let sessionCount = 0;
    const sortedPreview = sorted.map((item) => {
      const exp = item.details.expirationDate;
      if (exp === undefined) {
        sessionCount++;
      } else {
        if (earliestExpiry === null || exp < earliestExpiry) earliestExpiry = exp;
        if (latestExpiry === null || exp > latestExpiry) latestExpiry = exp;
      }
      return {
        name: item.details.name,
        domain: item.expected.domain,
        path: item.expected.path,
        hostOnly: item.expected.hostOnly,
        secure: item.expected.secure,
        httpOnly: item.expected.httpOnly,
        sameSite: item.expected.sameSite,
        expirationDate: exp ?? null,
        session: exp === undefined,
        valueHash: sha256HexSync(item.details.value),
        expiresAtIso: exp ? new Date(exp * 1000).toISOString() : null,
      };
    });
    return {
      count: sorted.length,
      earliestExpiry,
      latestExpiry,
      earliestExpiryIso: earliestExpiry ? new Date(earliestExpiry * 1000).toISOString() : null,
      latestExpiryIso: latestExpiry ? new Date(latestExpiry * 1000).toISOString() : null,
      sessionCount,
      skippedExpired: extras.skippedExpired || 0,
      skippedDuplicates: extras.skippedDuplicates || 0,
      sortedPreview,
    };
  }

  function prepareFromInput(textOrValue, options = {}) {
    const cookies = parseCookieInput(textOrValue);
    const importResult = prepareImport(cookies, options);
    const prepared = sortPrepared(importResult.prepared);
    const meta = buildMeta(prepared, importResult);
    return {
      prepared,
      meta,
      cookies: prepared.map((item) => ({
        ...item.details,
        hostOnly: item.expected.hostOnly,
        valueHash: sha256HexSync(item.details.value),
        expected: item.expected,
      })),
      skippedExpired: importResult.skippedExpired,
      skippedDuplicates: importResult.skippedDuplicates,
    };
  }

  /** WebView2-friendly set list (SameSite mapped to None/Lax/Strict). */
  function toWebView2Cookies(preparedOrCookies) {
    const list = Array.isArray(preparedOrCookies)
      ? preparedOrCookies
      : preparedOrCookies.prepared || [];
    return list.map((item) => {
      const d = item.details || item;
      const expected = item.expected || {};
      let sameSite = d.sameSite || expected.sameSite || 'Lax';
      if (sameSite === 'no_restriction') sameSite = 'None';
      else if (sameSite === 'lax') sameSite = 'Lax';
      else if (sameSite === 'strict') sameSite = 'Strict';
      else if (sameSite === 'unspecified') sameSite = 'Lax';
      return {
        url: d.url,
        name: d.name,
        value: d.value,
        domain: d.domain || undefined,
        path: d.path || '/',
        secure: Boolean(d.secure),
        httpOnly: Boolean(d.httpOnly),
        sameSite,
        expires: d.expirationDate !== undefined ? d.expirationDate : null,
        hostOnly: expected.hostOnly !== undefined ? expected.hostOnly : !d.domain,
        valueHash: item.valueHash || sha256HexSync(d.value),
      };
    });
  }

  return {
    parseCookieInput,
    buildSetDetails,
    prepareImport,
    prepareFromInput,
    verifyCookie,
    sha256Hex,
    sha256HexSync,
    sortPrepared,
    buildMeta,
    toWebView2Cookies,
    isAllowedDomain,
  };
});
