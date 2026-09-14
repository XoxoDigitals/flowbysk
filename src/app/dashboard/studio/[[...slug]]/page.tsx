'use client';

import { useEffect } from 'react';
import StudioShell from '@/components/studio/StudioShell';

const WHISK_SRC = '/static/whisk.js?v=model-remap-1';
const BULKT2V_SRC = '/static/bulkt2v.js?v=btv-8';
const BULKT2I_SRC = '/static/bulkt2i.js?v=bti-7';
const BULKI2V_SRC = '/static/bulki2v.js?v=biv-8';
// Bump when app.js boot/reveal logic changes.
const APP_SRC = '/static/app.js?v=studio-skel-2';
const STORYTELLER_SRC = '/static/storyteller.js?v=bvs-28';

function waitForStudioShell(timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (
        document.getElementById('trigger-generate-btn') &&
        document.getElementById('prompt-input')
      ) {
        resolve(true);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        resolve(false);
        return;
      }
      window.setTimeout(tick, 50);
    };
    tick();
  });
}

function loadScriptOnce(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-gflow-studio="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.dataset.gflowStudio = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(s);
  });
}

function forceStudioBooting() {
  try {
    const d = document.documentElement;
    d.classList.add('studio-booting');
    d.classList.remove('studio-ready');
    d.classList.add('theme-flow-dark');
    document.body.classList.add('theme-flow-dark');
    const skel = document.getElementById('studio-boot-skeleton');
    if (skel) {
      skel.style.display = 'flex';
      skel.style.opacity = '1';
      skel.setAttribute('aria-hidden', 'true');
    }
  } catch {
    /* ignore */
  }
}

function forceStudioReady() {
  try {
    document.documentElement.classList.remove('studio-booting');
    document.documentElement.classList.add('studio-ready');
    document.body.classList.add('theme-flow-dark');
    const skel = document.getElementById('studio-boot-skeleton');
    if (skel) {
      skel.style.opacity = '0';
      window.setTimeout(() => {
        skel.style.display = 'none';
      }, 240);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Catch-all Studio route: /dashboard/studio and /dashboard/studio/<view>
 * (storyteller, whisk, characters, images, …) so refresh keeps the active page.
 */
export default function StudioPage() {
  useEffect(() => {
    // Client navigations don't re-run layout <script> — force boot overlay here
    forceStudioBooting();
    document.body.classList.add('theme-flow-dark');
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    let cancelled = false;

    (async () => {
      const ready = await waitForStudioShell();
      if (cancelled) return;
      if (!ready) {
        console.error('[Studio] Shell DOM not ready; scripts not loaded');
        forceStudioReady();
        return;
      }
      try {
        if (typeof window !== 'undefined') {
          (window as any).__GFLOW_STUDIO_INIT__ = false;
          (window as any).__GFLOW_STORYTELLER_INIT__ = false;
          (window as any).__GFLOW_BULKT2V_INIT__ = false;
          (window as any).__GFLOW_BULKT2I_INIT__ = false;
          (window as any).__GFLOW_BULKI2V_INIT__ = false;
        }
        document
          .querySelectorAll('script[data-gflow-studio]')
          .forEach((el) => el.parentNode?.removeChild(el));
        await loadScriptOnce(WHISK_SRC);
        if (cancelled) return;
        await loadScriptOnce(STORYTELLER_SRC);
        if (cancelled) return;
        await loadScriptOnce(BULKT2V_SRC);
        if (cancelled) return;
        await loadScriptOnce(BULKT2I_SRC);
        if (cancelled) return;
        await loadScriptOnce(BULKI2V_SRC);
        if (cancelled) return;
        await loadScriptOnce(APP_SRC);
        // Failsafe: reveal if app.js never marks ready (hung init)
        window.setTimeout(() => {
          try {
            if (document.documentElement.classList.contains('studio-booting')) {
              forceStudioReady();
            }
          } catch (_) {}
        }, 8000);
      } catch (e) {
        console.error('[Studio] Script load failed', e);
        forceStudioReady();
      }
    })();

    return () => {
      cancelled = true;
      if (typeof window !== 'undefined') {
        (window as any).__GFLOW_STUDIO_INIT__ = false;
        (window as any).__GFLOW_STORYTELLER_INIT__ = false;
        (window as any).__GFLOW_BULKT2V_INIT__ = false;
        (window as any).__GFLOW_BULKT2I_INIT__ = false;
        (window as any).__GFLOW_BULKI2V_INIT__ = false;
      }
      document
        .querySelectorAll('script[data-gflow-studio]')
        .forEach((el) => el.parentNode?.removeChild(el));
      document.body.classList.remove('theme-flow-dark');
      document.body.style.overflow = prevOverflow;
      document.documentElement.classList.remove('studio-booting', 'studio-ready');
    };
  }, []);

  return (
    <div className="h-full w-full overflow-hidden bg-[#090b10] relative">
      <div id="studio-boot-skeleton" aria-hidden="true">
        <div className="studio-skel-header" />
        <div className="studio-skel-body">
          <div className="studio-skel-side" />
          <div className="studio-skel-main">
            <div className="studio-skel-grid">
              <div className="studio-skel-card" />
              <div className="studio-skel-card" />
              <div className="studio-skel-card" />
              <div className="studio-skel-card" />
              <div className="studio-skel-card" />
              <div className="studio-skel-card" />
              <div className="studio-skel-card" />
              <div className="studio-skel-card" />
            </div>
            <div className="studio-skel-footer" />
          </div>
        </div>
        <div className="studio-skel-label">Loading Studio…</div>
      </div>
      <StudioShell />
    </div>
  );
}
