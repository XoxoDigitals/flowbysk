import { readSiteRuntime, writeSiteRuntimePatch } from './siteRuntime';
import { performEgressProxyRotateAndRelaunch } from './unusualActivityProxyRotate';
import { readEgressProxyMirror } from './egressProxy';

let timer: ReturnType<typeof setInterval> | null = null;
let started = false;

async function tick() {
  const rt = readSiteRuntime();
  if (!rt.proxyAutoRotateEnabled) return;
  const enabledCount = readEgressProxyMirror().proxies.filter((p) => p.enabled && p.url).length;
  if (enabledCount < 2) return;

  const minutes = Math.max(1, rt.proxyAutoRotateMinutes || 60);
  const last = rt.lastProxyRotateAt ? Date.parse(rt.lastProxyRotateAt) : 0;
  const due = !last || Date.now() - last >= minutes * 60 * 1000;
  if (!due) return;

  try {
    await performEgressProxyRotateAndRelaunch({
      reason: `auto (${minutes}m)`,
    });
  } catch (e) {
    console.warn('[proxy-auto-rotate]', e);
  }
}

/** Start background auto-rotate checker (idempotent). */
export function startProxyAutoRotateLoop() {
  if (started) return;
  started = true;
  // Ensure runtime file exists
  writeSiteRuntimePatch({});
  void tick();
  timer = setInterval(() => {
    void tick();
  }, 60 * 1000);
  if (typeof timer === 'object' && timer && 'unref' in timer) {
    try {
      (timer as NodeJS.Timeout).unref();
    } catch {
      /* ignore */
    }
  }
  console.log('[proxy-auto-rotate] loop started');
}
