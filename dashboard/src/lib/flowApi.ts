// Same-origin by default so Next rewrites /api + /download → Express :8000
export const FLOW_API = process.env.NEXT_PUBLIC_FLOW_API_URL || '';

const STORAGE_KEY = 'flowbro_session';
const CLIENT_API_VERSION_KEY = 'flowbro_client_api_version';

export type FlowRole = 'admin' | 'reseller' | 'user';
export type ClientApiVersion = 'v2' | 'v3' | 'v4';

export type FlowSession = {
  token: string;
  role: FlowRole;
  username: string;
};

export function readSession(): FlowSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FlowSession;
    if (!parsed?.token || !parsed?.role) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSession(session: FlowSession) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

export function downloadFlowUrl() {
  return `${FLOW_API}/download/flow-browser`;
}

export function downloadFlowAndroidUrl() {
  return `${FLOW_API}/download/flow-android`;
}

function normalizeClientApiVersion(value: unknown): ClientApiVersion {
  const v = String(value || '').toLowerCase();
  if (v === 'v4') return 'v4';
  if (v === 'v3') return 'v3';
  return 'v2';
}

function readCachedClientApiVersion(): ClientApiVersion {
  if (typeof window === 'undefined') return 'v4';
  try {
    return normalizeClientApiVersion(localStorage.getItem(CLIENT_API_VERSION_KEY) || 'v4');
  } catch {
    return 'v4';
  }
}

function writeCachedClientApiVersion(version: ClientApiVersion) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CLIENT_API_VERSION_KEY, version);
  } catch {
    /* ignore */
  }
}

/** Resolve active client API version from public branding (and cache it). */
export async function resolveClientApiVersion(force = false): Promise<ClientApiVersion> {
  if (!force) {
    const cached = readCachedClientApiVersion();
    if (typeof window !== 'undefined' && (window as unknown as { __flowClientApiResolved?: boolean }).__flowClientApiResolved) {
      return cached;
    }
  }
  try {
    const res = await fetch(`${FLOW_API}/api/public/branding`, { cache: 'no-store' });
    const data = await res.json();
    const version = normalizeClientApiVersion(data?.settings?.clientApiVersion);
    writeCachedClientApiVersion(version);
    if (typeof window !== 'undefined') {
      (window as unknown as { __flowClientApiResolved?: boolean }).__flowClientApiResolved = true;
    }
    return version;
  } catch {
    return readCachedClientApiVersion();
  }
}

/** Build `/api/v2|v3|v4/client/...` from a suffix like `/me`. */
export function clientApiPath(suffix = '', version?: ClientApiVersion) {
  const ver = version || readCachedClientApiVersion();
  const path = String(suffix || '');
  const normalized = path.startsWith('/') ? path : path ? `/${path}` : '';
  return `/api/${ver}/client${normalized}`;
}

export async function flowFetch(path: string, init: RequestInit = {}) {
  const session = readSession();
  const headers = new Headers(init.headers || {});
  if (session?.token) headers.set('Authorization', `Bearer ${session.token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const isClientApi = /^\/api\/v[234]\/client(?:\/|$)/i.test(path);
  let urlPath = path;
  if (isClientApi) {
    await resolveClientApiVersion(false);
    urlPath = path.replace(/^\/api\/v[234]\/client/i, `/api/${readCachedClientApiVersion()}/client`);
  }

  let res = await fetch(`${FLOW_API}${urlPath}`, { ...init, headers });

  if (isClientApi && (res.status === 410 || res.status === 403)) {
    try {
      const clone = res.clone();
      const data = await clone.json();
      if (data?.code === 'FORCE_UPDATE') {
        const next = await resolveClientApiVersion(true);
        const retryPath = path.replace(/^\/api\/v[234]\/client/i, `/api/${next}/client`);
        if (retryPath !== urlPath) {
          res = await fetch(`${FLOW_API}${retryPath}`, { ...init, headers });
        }
      }
    } catch {
      /* keep original response */
    }
  }

  return res;
}

export async function loginFlow(username: string, password: string) {
  const res = await fetch(`${FLOW_API}/api/session/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    const err = new Error(data.error || 'Login failed') as Error & { code?: string };
    err.code = data.code;
    throw err;
  }
  writeSession({
    token: data.token,
    role: data.role,
    username: data.user?.username || username,
  });
  return data as { role: FlowRole; token: string; user: { username: string } };
}
