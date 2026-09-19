import fs from 'fs';
import path from 'path';
import { createHash, randomBytes } from 'crypto';
import {
  readEgressProxyMirror,
  writeEgressProxyMirror,
  type EgressProxyEntry,
  probeProxyEgress,
} from './egressProxy';

export const DATAIMPULSE_CONFIG_PATH = path.join(process.cwd(), 'data', 'dataimpulse.json');
export const PROXY_METRICS_PATH = path.join(process.cwd(), 'data', 'proxy-metrics.jsonl');

export type DataImpulseAccountMeta = {
  country: string;
  sessId: string;
  port: number;
  gen: number;
  updatedAt?: string;
};

export type DataImpulseConfig = {
  enabled: boolean;
  proxyLogin: string;
  proxyPassword: string;
  apiToken: string;
  countries: string[];
  stickyPortBase: number;
  sessttlMinutes: number;
  autoAssignOnLaunch: boolean;
  accountMeta: Record<string, DataImpulseAccountMeta>;
  updatedAt: string | null;
};

export type ProxyOutcomeEventType =
  | 'job_ok'
  | 'job_fail'
  | 'unusual'
  | 'throttle'
  | 'tunnel_fail'
  | 'rotate';

export type ProxyOutcomeKind = 'image' | 'video';

export type ProxyOutcomeEvent = {
  at: string;
  accountId?: string;
  country?: string;
  sessId?: string;
  port?: number;
  event: ProxyOutcomeEventType;
  jobId?: string;
  /** image vs video generation (for job_ok / job_fail) */
  kind?: ProxyOutcomeKind;
};

const DEFAULTS: DataImpulseConfig = {
  enabled: false,
  proxyLogin: '',
  proxyPassword: '',
  apiToken: '',
  countries: ['us', 'gb', 'de'],
  stickyPortBase: 10000,
  sessttlMinutes: 60,
  autoAssignOnLaunch: true,
  accountMeta: {},
  updatedAt: null,
};

/**
 * Unique sticky port per account: 10000, 10001, 10002… (DataImpulse sticky range).
 * Keeps an account’s existing port; otherwise takes the lowest free port from base.
 */
function allocateUniqueStickyPort(
  cfg: DataImpulseConfig,
  accountId: string
): number {
  const base = Math.max(10000, Math.min(19999, Math.floor(cfg.stickyPortBase) || 10000));
  const existing = cfg.accountMeta[accountId];
  if (existing?.port && existing.port >= 10000 && existing.port <= 20000) {
    return existing.port;
  }
  const used = new Set<number>();
  for (const [id, m] of Object.entries(cfg.accountMeta)) {
    if (id === accountId) continue;
    const p = Number(m.port);
    if (p >= 10000 && p <= 20000) used.add(p);
  }
  for (let p = base; p <= 20000; p++) {
    if (!used.has(p)) return p;
  }
  for (let p = 10000; p < base; p++) {
    if (!used.has(p)) return p;
  }
  return base;
}

function newSessId(accountId: string, gen: number): string {
  const h = createHash('sha256')
    .update(`${accountId}:${gen}:${randomBytes(8).toString('hex')}`)
    .digest('hex')
    .slice(0, 16);
  return h;
}

export function normalizeCountryCode(raw: string): string | null {
  const c = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  return c.length === 2 ? c : null;
}

export function readDataImpulseConfig(): DataImpulseConfig {
  try {
    if (!fs.existsSync(DATAIMPULSE_CONFIG_PATH)) return { ...DEFAULTS, accountMeta: {} };
    const raw = JSON.parse(fs.readFileSync(DATAIMPULSE_CONFIG_PATH, 'utf8'));
    const countries = Array.isArray(raw?.countries)
      ? raw.countries.map((c: string) => normalizeCountryCode(c)).filter(Boolean)
      : [...DEFAULTS.countries];
    const accountMeta: Record<string, DataImpulseAccountMeta> = {};
    if (raw?.accountMeta && typeof raw.accountMeta === 'object') {
      for (const [k, v] of Object.entries(raw.accountMeta as Record<string, any>)) {
        if (!k || !v || typeof v !== 'object') continue;
        const country = normalizeCountryCode(String(v.country || ''));
        if (!country || typeof v.sessId !== 'string') continue;
        accountMeta[k] = {
          country,
          sessId: v.sessId,
          port: Number(v.port) || 10000,
          gen: Math.max(0, Number(v.gen) || 0),
          updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : undefined,
        };
      }
    }
    return {
      enabled: !!raw?.enabled,
      proxyLogin: typeof raw?.proxyLogin === 'string' ? raw.proxyLogin : '',
      proxyPassword: typeof raw?.proxyPassword === 'string' ? raw.proxyPassword : '',
      apiToken: typeof raw?.apiToken === 'string' ? raw.apiToken : '',
      countries: countries.length ? (countries as string[]) : [...DEFAULTS.countries],
      stickyPortBase: Math.max(10000, Math.min(19999, Number(raw?.stickyPortBase) || 10000)),
      sessttlMinutes: Math.max(1, Math.min(120, Number(raw?.sessttlMinutes) || 60)),
      autoAssignOnLaunch: raw?.autoAssignOnLaunch !== false,
      accountMeta,
      updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : null,
    };
  } catch {
    return { ...DEFAULTS, accountMeta: {} };
  }
}

export function writeDataImpulseConfig(patch: Partial<DataImpulseConfig>): DataImpulseConfig {
  const prev = readDataImpulseConfig();
  const next: DataImpulseConfig = {
    ...prev,
    ...patch,
    countries:
      patch.countries !== undefined
        ? patch.countries.map(normalizeCountryCode).filter(Boolean) as string[]
        : prev.countries,
    accountMeta: patch.accountMeta !== undefined ? patch.accountMeta : prev.accountMeta,
    updatedAt: new Date().toISOString(),
  };
  if (!next.countries.length) next.countries = [...DEFAULTS.countries];
  fs.mkdirSync(path.dirname(DATAIMPULSE_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(DATAIMPULSE_CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

/** Public/admin-safe view (secrets masked). */
export function publicDataImpulseConfig(cfg?: DataImpulseConfig) {
  const c = cfg || readDataImpulseConfig();
  return {
    enabled: c.enabled,
    proxyLogin: c.proxyLogin,
    proxyPasswordSet: !!c.proxyPassword,
    proxyPasswordMasked: c.proxyPassword ? '••••••••' : '',
    apiTokenSet: !!c.apiToken,
    apiTokenMasked: c.apiToken ? '••••••••' : '',
    countries: c.countries,
    stickyPortBase: c.stickyPortBase,
    sessttlMinutes: c.sessttlMinutes,
    autoAssignOnLaunch: c.autoAssignOnLaunch,
    accountCount: Object.keys(c.accountMeta).length,
    updatedAt: c.updatedAt,
  };
}

/**
 * Build residential sticky gateway URL.
 * Format: http://login__cr.us;sessid.xxx;sessttl.60:pass@gw.dataimpulse.com:10000
 */
export function buildResidentialProxyUrl(opts: {
  login: string;
  password: string;
  country: string;
  sessId: string;
  port: number;
  sessttlMinutes?: number;
}): string {
  const login = String(opts.login || '').trim();
  const password = String(opts.password || '');
  const country = normalizeCountryCode(opts.country) || 'us';
  const sessId = String(opts.sessId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 32) || 'sess';
  const ttl = Math.max(1, Math.min(120, opts.sessttlMinutes ?? 60));
  const port = Math.max(10000, Math.min(20000, Math.floor(opts.port) || 10000));
  const user = `${login}__cr.${country};sessid.${sessId};sessttl.${ttl}`;
  return `http://${encodeURIComponent(user)}:${encodeURIComponent(password)}@gw.dataimpulse.com:${port}`;
}

function diProxyId(accountId: string): string {
  return `di-${accountId}`;
}

/** Country scores from recent metrics (higher = better). */
export function countryScores(days = 7): Record<string, { ok: number; fail: number; unusual: number; score: number }> {
  const since = Date.now() - days * 86400000;
  const events = readProxyMetrics(20000).filter((e) => Date.parse(e.at) >= since);
  const map: Record<string, { ok: number; fail: number; unusual: number; score: number }> = {};
  for (const e of events) {
    const c = normalizeCountryCode(e.country || '') || 'xx';
    if (!map[c]) map[c] = { ok: 0, fail: 0, unusual: 0, score: 0 };
    if (e.event === 'job_ok') map[c].ok += 1;
    else if (e.event === 'unusual' || e.event === 'throttle') map[c].unusual += 1;
    else if (e.event === 'job_fail' || e.event === 'tunnel_fail') map[c].fail += 1;
  }
  for (const row of Object.values(map)) {
    const total = row.ok + row.fail + row.unusual || 1;
    const successRate = row.ok / total;
    const unusualRate = row.unusual / total;
    row.score = successRate * 100 - unusualRate * 80 + Math.min(20, row.ok);
  }
  return map;
}

function pickCountry(cfg: DataImpulseConfig, preferDifferentFrom?: string): string {
  const list = cfg.countries.length ? cfg.countries : ['us'];
  const scores = countryScores(7);
  const ranked = [...list].sort((a, b) => (scores[b]?.score || 0) - (scores[a]?.score || 0));
  if (preferDifferentFrom && ranked.length > 1) {
    const alt = ranked.find((c) => c !== preferDifferentFrom);
    if (alt) return alt;
  }
  return ranked[0] || list[0];
}

function upsertMirrorEntry(
  accountId: string,
  url: string,
  country: string
): { proxyId: string; url: string } {
  const proxyId = diProxyId(accountId);
  const { proxies, assignments, cycleUsed } = readEgressProxyMirror();
  const entry: EgressProxyEntry = {
    id: proxyId,
    url,
    enabled: true,
    countryCode: country.toUpperCase(),
    country: country.toUpperCase(),
    lastCheckedAt: new Date().toISOString(),
  };
  const nextProxies = [...proxies.filter((p) => p.id !== proxyId), entry];
  const nextAssignments = { ...assignments, [accountId]: proxyId };
  writeEgressProxyMirror(nextProxies, nextAssignments, cycleUsed);
  return { proxyId, url };
}

export function isDataImpulseReady(cfg?: DataImpulseConfig): boolean {
  const c = cfg || readDataImpulseConfig();
  return !!(c.enabled && c.proxyLogin.trim() && c.proxyPassword);
}

/**
 * Drop sticky meta + mirror entries for provider accounts that no longer exist.
 * Assignments can linger after an account is deleted from Admin → Accounts.
 */
export function pruneOrphanDataImpulseAssignments(liveAccountIds: string[]): {
  removed: string[];
  kept: number;
} {
  const live = new Set(liveAccountIds.filter(Boolean));
  const cfg = readDataImpulseConfig();
  const removed: string[] = [];
  const nextMeta: Record<string, DataImpulseAccountMeta> = {};

  for (const [id, meta] of Object.entries(cfg.accountMeta || {})) {
    if (live.has(id)) {
      nextMeta[id] = meta;
    } else {
      removed.push(id);
    }
  }

  if (removed.length) {
    writeDataImpulseConfig({ accountMeta: nextMeta });
    try {
      const { proxies, assignments, cycleUsed } = readEgressProxyMirror();
      const dropProxyIds = new Set(removed.map((id) => diProxyId(id)));
      const nextAssignments = { ...assignments };
      for (const id of removed) delete nextAssignments[id];
      // Also drop assignment keys that aren't live accounts
      for (const acc of Object.keys(nextAssignments)) {
        if (!live.has(acc)) {
          delete nextAssignments[acc];
          if (!removed.includes(acc)) removed.push(acc);
        }
      }
      const nextProxies = proxies.filter((p) => !dropProxyIds.has(p.id));
      writeEgressProxyMirror(nextProxies, nextAssignments, cycleUsed);
    } catch (e) {
      console.warn('[dataimpulse] prune mirror failed:', e);
    }
    console.warn(
      `[dataimpulse] pruned ${removed.length} orphan assignment(s): ${removed
        .map((id) => id.slice(0, 8))
        .join(', ')}`
    );
  }

  return { removed, kept: Object.keys(nextMeta).length };
}

/**
 * Ensure account has a DataImpulse sticky residential assignment.
 * Returns null if DI disabled / incomplete.
 */
export function allocateDataImpulseForAccount(
  accountId: string,
  opts?: { forceNew?: boolean }
): {
  url: string;
  proxyId: string;
  country: string;
  sessId: string;
  port: number;
} | null {
  if (!accountId) return null;
  const cfg = readDataImpulseConfig();
  if (!isDataImpulseReady(cfg)) return null;

  const existing = cfg.accountMeta[accountId];
  if (existing && !opts?.forceNew) {
    const url = buildResidentialProxyUrl({
      login: cfg.proxyLogin,
      password: cfg.proxyPassword,
      country: existing.country,
      sessId: existing.sessId,
      port: existing.port,
      sessttlMinutes: cfg.sessttlMinutes,
    });
    upsertMirrorEntry(accountId, url, existing.country);
    return {
      url,
      proxyId: diProxyId(accountId),
      country: existing.country,
      sessId: existing.sessId,
      port: existing.port,
    };
  }

  const gen = (existing?.gen || 0) + (opts?.forceNew || !existing ? 1 : 0);
  const country = pickCountry(cfg, opts?.forceNew ? existing?.country : undefined);
  const sessId = newSessId(accountId, gen || 1);
  // Unique sticky port per account (10000, 10001, …). Rotate keeps the port; new sessid → new IP.
  const port = allocateUniqueStickyPort(cfg, accountId);
  const url = buildResidentialProxyUrl({
    login: cfg.proxyLogin,
    password: cfg.proxyPassword,
    country,
    sessId,
    port,
    sessttlMinutes: cfg.sessttlMinutes,
  });

  const meta: DataImpulseAccountMeta = {
    country,
    sessId,
    port,
    gen: gen || 1,
    updatedAt: new Date().toISOString(),
  };
  writeDataImpulseConfig({
    accountMeta: { ...cfg.accountMeta, [accountId]: meta },
  });
  upsertMirrorEntry(accountId, url, country);
  return { url, proxyId: diProxyId(accountId), country, sessId, port };
}

export function rotateDataImpulseAccount(accountId: string) {
  return allocateDataImpulseForAccount(accountId, { forceNew: true });
}

export function reassignAllDataImpulse(accountIds: string[]) {
  const out: Record<string, string> = {};
  for (const id of accountIds) {
    const r = allocateDataImpulseForAccount(id, { forceNew: true });
    if (r) {
      out[id] = r.url;
      recordProxyOutcome({
        event: 'rotate',
        accountId: id,
        country: r.country,
        sessId: r.sessId,
        port: r.port,
      });
    }
  }
  return out;
}

export function getAccountDataImpulseMeta(accountId: string): DataImpulseAccountMeta | null {
  return readDataImpulseConfig().accountMeta[accountId] || null;
}

/* ---------- metrics ---------- */

export function recordProxyOutcome(ev: Omit<ProxyOutcomeEvent, 'at'> & { at?: string }): void {
  try {
    const cfg = readDataImpulseConfig();
    const meta = ev.accountId ? cfg.accountMeta[ev.accountId] : null;
    const row: ProxyOutcomeEvent = {
      at: ev.at || new Date().toISOString(),
      accountId: ev.accountId,
      country: ev.country || meta?.country,
      sessId: ev.sessId || meta?.sessId,
      port: ev.port ?? meta?.port,
      event: ev.event,
      jobId: ev.jobId,
      kind: ev.kind,
    };
    fs.mkdirSync(path.dirname(PROXY_METRICS_PATH), { recursive: true });
    fs.appendFileSync(PROXY_METRICS_PATH, JSON.stringify(row) + '\n', 'utf8');
  } catch {
    /* ignore */
  }
}

export function jobKindFromModelKey(modelKey?: string | null): ProxyOutcomeKind {
  const k = String(modelKey || '').toLowerCase();
  if (/veo|omni|video|i2v|t2v|r2v/.test(k)) return 'video';
  return 'image';
}

/** Record ok/fail for country quality — call from EVERY job completion path (queue + status poll + sync API). */
export function recordJobProxyOutcome(
  job: {
    id?: string | null;
    providerAccountId?: string | null;
    modelKey?: string | null;
  },
  outcome: 'ok' | 'fail' | 'unusual' | 'throttle'
): void {
  const event =
    outcome === 'ok'
      ? 'job_ok'
      : outcome === 'fail'
        ? 'job_fail'
        : outcome;
  recordProxyOutcome({
    event,
    accountId: job.providerAccountId || undefined,
    jobId: job.id || undefined,
    kind: jobKindFromModelKey(job.modelKey),
  });
}

export function readProxyMetrics(limit = 5000): ProxyOutcomeEvent[] {
  try {
    if (!fs.existsSync(PROXY_METRICS_PATH)) return [];
    const text = fs.readFileSync(PROXY_METRICS_PATH, 'utf8');
    const lines = text.split('\n').filter(Boolean);
    const slice = lines.slice(-Math.max(1, limit));
    const out: ProxyOutcomeEvent[] = [];
    for (const line of slice) {
      try {
        const j = JSON.parse(line);
        if (j && j.event && j.at) out.push(j as ProxyOutcomeEvent);
      } catch {
        /* skip */
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function aggregateProxyStats(days = 7) {
  const since = Date.now() - days * 86400000;
  const events = readProxyMetrics(20000).filter((e) => Date.parse(e.at) >= since);

  type CountryAgg = {
    ok: number;
    fail: number;
    unusual: number;
    throttle: number;
    tunnel: number;
    rotates: number;
    imageOk: number;
    imageFail: number;
    videoOk: number;
    videoFail: number;
    total: number;
    /** sessId|port → job outcomes for avg success per proxy */
    proxyJobs: Record<string, { ok: number; fail: number }>;
  };

  const byCountry: Record<string, CountryAgg> = {};
  const ensure = (c: string): CountryAgg => {
    if (!byCountry[c]) {
      byCountry[c] = {
        ok: 0,
        fail: 0,
        unusual: 0,
        throttle: 0,
        tunnel: 0,
        rotates: 0,
        imageOk: 0,
        imageFail: 0,
        videoOk: 0,
        videoFail: 0,
        total: 0,
        proxyJobs: {},
      };
    }
    return byCountry[c];
  };

  for (const e of events) {
    const c = normalizeCountryCode(e.country || '') || 'unknown';
    const row = ensure(c);
    row.total += 1;
    const proxyKey = e.sessId || (e.port != null ? `p${e.port}` : e.accountId || 'unknown');

    if (e.event === 'job_ok') {
      row.ok += 1;
      if (e.kind === 'video') row.videoOk += 1;
      else row.imageOk += 1;
      if (!row.proxyJobs[proxyKey]) row.proxyJobs[proxyKey] = { ok: 0, fail: 0 };
      row.proxyJobs[proxyKey].ok += 1;
    } else if (e.event === 'job_fail') {
      row.fail += 1;
      if (e.kind === 'video') row.videoFail += 1;
      else row.imageFail += 1;
      if (!row.proxyJobs[proxyKey]) row.proxyJobs[proxyKey] = { ok: 0, fail: 0 };
      row.proxyJobs[proxyKey].fail += 1;
    } else if (e.event === 'unusual') row.unusual += 1;
    else if (e.event === 'throttle') row.throttle += 1;
    else if (e.event === 'tunnel_fail') row.tunnel += 1;
    else if (e.event === 'rotate') row.rotates += 1;
  }

  const leaderboard = Object.entries(byCountry)
    .map(([country, r]) => {
      const jobTotal = r.ok + r.fail || 0;
      const successRate = jobTotal ? r.ok / jobTotal : 0;
      const unusualDenom = r.ok + r.fail + r.unusual + r.throttle || 1;
      const unusualRate = (r.unusual + r.throttle) / unusualDenom;
      const proxyEntries = Object.values(r.proxyJobs);
      const avgSuccessPerProxy =
        proxyEntries.length === 0
          ? 0
          : proxyEntries.reduce((sum, p) => {
              const t = p.ok + p.fail;
              return sum + (t ? p.ok / t : 0);
            }, 0) / proxyEntries.length;
      const { proxyJobs: _pj, ...rest } = r;
      return {
        country,
        ...rest,
        uniqueProxies: proxyEntries.length,
        avgSuccessPerProxy,
        successRate,
        unusualRate,
        score: successRate * 100 - unusualRate * 80 + Math.min(20, r.ok),
      };
    })
    .sort((a, b) => b.score - a.score);

  const recent = events.slice(-40).reverse();
  const totals = {
    rotates: leaderboard.reduce((s, r) => s + r.rotates, 0),
    imageOk: leaderboard.reduce((s, r) => s + r.imageOk, 0),
    imageFail: leaderboard.reduce((s, r) => s + r.imageFail, 0),
    videoOk: leaderboard.reduce((s, r) => s + r.videoOk, 0),
    videoFail: leaderboard.reduce((s, r) => s + r.videoFail, 0),
    ok: leaderboard.reduce((s, r) => s + r.ok, 0),
    fail: leaderboard.reduce((s, r) => s + r.fail, 0),
  };
  return { days, leaderboard, recent, totalEvents: events.length, totals };
}

/* ---------- Gateway API (plan usage) — Basic Auth = proxy login/password ---------- */

let _usageCache: { at: number; data: Record<string, unknown> } | null = null;

/** DataImpulse traffic ints are usually bytes; if already small (< 1e6) treat as GB. */
function toGb(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (Math.abs(n) >= 1_000_000) return n / (1024 * 1024 * 1024);
  return n;
}

export async function fetchDataImpulseUsage(): Promise<{
  ok: boolean;
  balance?: number;
  trafficLeftGb?: number;
  trafficUsedGb?: number;
  totalTrafficGb?: number;
  usedThreads?: number;
  raw?: unknown;
  error?: string;
  fetchedAt: string;
}> {
  const cfg = readDataImpulseConfig();
  const fetchedAt = new Date().toISOString();
  if (!cfg.proxyLogin?.trim() || !cfg.proxyPassword) {
    return { ok: false, error: 'Proxy login/password required for plan stats', fetchedAt };
  }
  if (_usageCache && Date.now() - _usageCache.at < 60_000) {
    return { ok: true, ...(_usageCache.data as any), fetchedAt };
  }

  const basic = Buffer.from(`${cfg.proxyLogin.trim()}:${cfg.proxyPassword}`, 'utf8').toString(
    'base64'
  );

  try {
    const res = await fetch('https://gw.dataimpulse.com:777/api/stats', {
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    if (!res.ok) {
      return {
        ok: false,
        error: data?.message || `Gateway stats HTTP ${res.status}`,
        fetchedAt,
      };
    }
    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'Invalid stats response', fetchedAt };
    }

    const leftRaw = Number(data.traffic_left);
    const usedRaw = Number(data.traffic_used);
    const totalRaw = Number(data.total_traffic);
    const trafficLeftGb = Number.isFinite(leftRaw) ? toGb(leftRaw) : undefined;
    const trafficUsedGb = Number.isFinite(usedRaw) ? toGb(usedRaw) : undefined;
    const totalTrafficGb = Number.isFinite(totalRaw) ? toGb(totalRaw) : undefined;

    const out = {
      balance: trafficLeftGb,
      trafficLeftGb,
      trafficUsedGb,
      totalTrafficGb,
      usedThreads:
        typeof data.used_threads === 'number' ? data.used_threads : undefined,
      raw: data,
    };
    _usageCache = { at: Date.now(), data: out };
    return { ok: true, ...out, fetchedAt };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e), fetchedAt };
  }
}

export async function testDataImpulseConnection(country?: string): Promise<{
  ok: boolean;
  ip?: string;
  country?: string;
  countryCode?: string;
  error?: string;
  urlMasked?: string;
}> {
  const cfg = readDataImpulseConfig();
  if (!cfg.proxyLogin || !cfg.proxyPassword) {
    return { ok: false, error: 'Proxy login/password required' };
  }
  const cr = normalizeCountryCode(country || cfg.countries[0] || 'us') || 'us';
  const url = buildResidentialProxyUrl({
    login: cfg.proxyLogin,
    password: cfg.proxyPassword,
    country: cr,
    sessId: `test${Date.now().toString(36)}`,
    port: cfg.stickyPortBase,
    sessttlMinutes: cfg.sessttlMinutes,
  });
  const { maskProxyUrl } = await import('./egressProxy');
  const result = await probeProxyEgress(url);
  return {
    ...result,
    urlMasked: maskProxyUrl(url),
  };
}
