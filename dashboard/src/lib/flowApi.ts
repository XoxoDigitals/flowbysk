// Same-origin by default so Next rewrites /api + /download → Express :8000
export const FLOW_API = process.env.NEXT_PUBLIC_FLOW_API_URL || '';

const STORAGE_KEY = 'flowbro_session';

export type FlowRole = 'admin' | 'reseller' | 'user';

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

export async function flowFetch(path: string, init: RequestInit = {}) {
  const session = readSession();
  const headers = new Headers(init.headers || {});
  if (session?.token) headers.set('Authorization', `Bearer ${session.token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(`${FLOW_API}${path}`, { ...init, headers });
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
