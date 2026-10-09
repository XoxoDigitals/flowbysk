/* WebView2 host bridge — replaces Electron preload-app + <webview> */
(function () {
  const pending = new Map();
  let reqId = 1;
  const flowListeners = Object.create(null);
  let currentUrl = 'about:blank';
  let zoomFactor = 1;

  function post(msg) {
    try {
      window.chrome.webview.postMessage(JSON.stringify(msg));
    } catch (e) {
      console.error('[ShellBridge] post failed', e);
    }
  }

  function invoke(cmd, payload) {
    const id = reqId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      post({ type: 'invoke', id, cmd, payload: payload || {} });
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error('Host invoke timeout: ' + cmd));
        }
      }, 30000);
    });
  }

  function emitFlow(eventName, detail) {
    const list = flowListeners[eventName];
    if (!list) return;
    list.forEach((fn) => {
      try { fn(detail); } catch (e) { console.error(e); }
    });
  }

  window.chrome.webview.addEventListener('message', (ev) => {
    let msg = ev.data;
    try {
      if (typeof msg === 'string') msg = JSON.parse(msg);
    } catch (e) {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'invoke-result' && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.result);
      return;
    }

    if (msg.type === 'flow-event') {
      if (msg.event === 'did-navigate' || msg.event === 'did-navigate-in-page' ||
          msg.event === 'did-finish-load' || msg.event === 'dom-ready' ||
          msg.event === 'did-start-loading' || msg.event === 'page-title-updated') {
        if (msg.url && msg.url !== 'about:blank') currentUrl = msg.url;
      }
      if (msg.event === 'ipc-message') {
        emitFlow('ipc-message', { channel: msg.channel, args: msg.args || [] });
        return;
      }
      const detail = Object.assign({ url: msg.url || currentUrl }, msg.detail || {});
      if (msg.event === 'did-fail-load') {
        detail.errorCode = msg.errorCode;
        detail.errorDescription = msg.errorDescription;
        detail.validatedURL = msg.url;
      }
      if (msg.event === 'new-window') {
        detail.url = msg.url;
      }
      if (msg.event === 'console-message') {
        detail.message = msg.message;
      }
      emitFlow(msg.event, detail);
      return;
    }

    if (msg.type === 'download') {
      const map = {
        started: 'download:started',
        progress: 'download:progress',
        completed: 'download:completed',
        failed: 'download:failed',
        interrupted: 'download:interrupted',
        paused: 'download:paused'
      };
      const name = map[msg.phase];
      if (name && window.__downloadHandlers && window.__downloadHandlers[name]) {
        window.__downloadHandlers[name](msg.data || {});
      }
    }
  });

  window.__downloadHandlers = Object.create(null);

  window.electronAPI = {
    getConfig: () => invoke('getConfig'),
    getWebviewPreloadPath: async () => null,
    getExtensionId: async () => null,
    saveServerUrl: (url) => invoke('saveServerUrl', { url }),
    saveSession: (sessionData) => invoke('saveSession', sessionData),
    clearSession: () => invoke('clearSession'),
    clearPartitionSession: () => invoke('clearPartitionSession'),
    /** v5: inject prepared Google cookies (SHA-256 verified in host). */
    injectCookies: (payload) => invoke('injectCookies', payload || {}),
    minimizeWindow: () => invoke('minimize'),
    maximizeWindow: () => invoke('maximize'),
    closeWindow: () => invoke('close'),
    showInFolder: (filePath) => invoke('showInFolder', { filePath }),
    setShellMode: (mode) => {
      post({ type: 'cmd', cmd: 'shellMode', mode: mode === 'full' ? 'full' : 'chrome' });
    },
    onDownloadStarted: (cb) => { window.__downloadHandlers['download:started'] = cb; },
    onDownloadProgress: (cb) => { window.__downloadHandlers['download:progress'] = cb; },
    onDownloadCompleted: (cb) => { window.__downloadHandlers['download:completed'] = cb; },
    onDownloadFailed: (cb) => { window.__downloadHandlers['download:failed'] = cb; }
  };

  const flowProxy = {
    get src() { return currentUrl; },
    set src(url) {
      currentUrl = url || 'about:blank';
      post({ type: 'cmd', cmd: 'navigate', url: currentUrl });
    },
    loadURL(url) {
      currentUrl = url || 'about:blank';
      post({ type: 'cmd', cmd: 'navigate', url: currentUrl });
    },
    getURL() { return currentUrl; },
    reload() { post({ type: 'cmd', cmd: 'reload', ignoreCache: false }); },
    reloadIgnoringCache() { post({ type: 'cmd', cmd: 'reload', ignoreCache: true }); },
    stop() { post({ type: 'cmd', cmd: 'stop' }); },
    setZoomFactor(z) {
      zoomFactor = z;
      post({ type: 'cmd', cmd: 'zoom', factor: z });
    },
    setAttribute() {},
    send(channel, data) {
      post({ type: 'cmd', cmd: 'sendToFlow', channel, data });
    },
    executeJavaScript(code) {
      return invoke('executeFlow', { code: String(code || '') });
    },
    addEventListener(eventName, handler) {
      if (!flowListeners[eventName]) flowListeners[eventName] = [];
      flowListeners[eventName].push(handler);
    },
    removeEventListener(eventName, handler) {
      const list = flowListeners[eventName];
      if (!list) return;
      const i = list.indexOf(handler);
      if (i >= 0) list.splice(i, 1);
    }
  };

  // Provide a stand-in for the Flow content surface (native WebView2)
  Object.defineProperty(document, 'getElementById', {
    configurable: true,
    value: (function (orig) {
      return function (id) {
        if (id === 'flow-webview') return flowProxy;
        return orig.call(document, id);
      };
    })(document.getElementById.bind(document))
  });

  let lastShellMode = '';
  let lastChromeHeightSent = 0;

  function syncChromeMode() {
    const login = document.getElementById('login-screen');
    const drawers = [
      document.getElementById('download-drawer'),
      document.getElementById('extension-drawer'),
      document.getElementById('veo-auto-drawer'),
      document.getElementById('android-settings-sheet'),
      document.getElementById('app-confirm-modal')
    ];
    // Treat login as visible unless explicitly hidden (display:none or .hidden)
    let loginVisible = false;
    if (login) {
      const hiddenClass = login.classList.contains('hidden');
      const style = window.getComputedStyle(login);
      loginVisible = !hiddenClass && style.display !== 'none' && style.visibility !== 'hidden';
    }
    document.documentElement.classList.toggle('login-active', !!loginVisible);
    document.body && document.body.classList.toggle('login-active', !!loginVisible);
    const drawerOpen = drawers.some((d) => {
      if (!d || d.classList.contains('hidden')) return false;
      try {
        const style = window.getComputedStyle(d);
        return style.display !== 'none' && style.visibility !== 'hidden';
      } catch (e) {
        return true;
      }
    });
    // Loading overlay must NOT hide Flow WebView2 (collapsing it aborts Google navigation)
    const mode = (loginVisible || drawerOpen) ? 'full' : 'chrome';
    if (mode !== lastShellMode) {
      lastShellMode = mode;
      post({ type: 'cmd', cmd: 'shellMode', mode });
    }
    if (mode === 'chrome') reportChromeHeight();
  }

  function reportChromeHeight() {
    try {
      const toolbar = document.getElementById('top-toolbar');
      const urlBar = document.getElementById('debug-url-bar');
      const banner = document.getElementById('google-auth-banner');
      let h = 0;
      if (toolbar) h += toolbar.getBoundingClientRect().height;
      if (urlBar && !urlBar.classList.contains('hidden')) h += urlBar.getBoundingClientRect().height;
      if (banner && !banner.classList.contains('hidden')) h += banner.getBoundingClientRect().height;
      if (h < 40) h = 72;
      const height = Math.ceil(h);
      if (height === lastChromeHeightSent) return;
      lastChromeHeightSent = height;
      post({ type: 'cmd', cmd: 'chromeHeight', height });
    } catch (e) {}
  }

  document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('webview-container');
    if (container) {
      container.innerHTML = '';
      container.style.background = 'transparent';
      container.style.pointerEvents = 'none';
    }

    // Start full-screen so the login overlay is never clipped to the 80px chrome strip
    post({ type: 'cmd', cmd: 'shellMode', mode: 'full' });

    const obs = new MutationObserver(() => syncChromeMode());
    obs.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class', 'style'] });
    syncChromeMode();
    setInterval(syncChromeMode, 2500);
    window.addEventListener('resize', reportChromeHeight);
    setTimeout(reportChromeHeight, 100);
    setTimeout(reportChromeHeight, 600);

    // Keep focused login fields above the Android keyboard
    document.addEventListener('focusin', (e) => {
      const t = e.target;
      if (!t || !t.closest || !t.closest('#login-screen')) return;
      if (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA' && t.tagName !== 'BUTTON') return;
      const screen = document.getElementById('login-screen');
      const box = document.querySelector('#login-screen .auth-box');
      if (screen) screen.scrollTop = 0;
      if (box) {
        box.style.marginTop = '4px';
        box.style.transform = 'translateY(0)';
      }
      setTimeout(() => {
        try {
          t.scrollIntoView({ block: 'center', behavior: 'smooth' });
        } catch (err) {
          try { t.scrollIntoView(true); } catch (e2) {}
        }
        // If keyboard still covers button, nudge the whole card up
        try {
          const btn = document.getElementById('btn-login-submit');
          if (!btn || !window.visualViewport) return;
          const br = btn.getBoundingClientRect();
          const vv = window.visualViewport;
          const overlap = br.bottom - (vv.offsetTop + vv.height) + 16;
          if (overlap > 0 && box) {
            box.style.transform = 'translateY(-' + Math.min(overlap + 24, 180) + 'px)';
          }
        } catch (e3) {}
      }, 320);
    }, true);

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        const login = document.getElementById('login-screen');
        if (!login || login.classList.contains('hidden')) return;
        const box = login.querySelector('.auth-box');
        if (!box) return;
        const vv = window.visualViewport;
        const shrink = Math.max(0, window.innerHeight - vv.height);
        if (shrink > 80) {
          box.style.transform = 'translateY(-' + Math.min(Math.round(shrink * 0.35), 160) + 'px)';
        } else {
          box.style.transform = '';
        }
      });
    }
  });
})();
