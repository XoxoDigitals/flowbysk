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
        if (msg.url) currentUrl = msg.url;
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

  function syncChromeMode() {
    const login = document.getElementById('login-screen');
    const loading = document.getElementById('full-loading-overlay');
    const drawers = [
      document.getElementById('download-drawer'),
      document.getElementById('extension-drawer'),
      document.getElementById('veo-auto-drawer')
    ];
    const loginVisible = !!(login && !login.classList.contains('hidden'));
    const drawerOpen = drawers.some((d) => d && !d.classList.contains('hidden'));
    // Loading overlay must NOT hide Flow WebView2 (collapsing it aborts Google navigation)
    const mode = (loginVisible || drawerOpen) ? 'full' : 'chrome';
    post({ type: 'cmd', cmd: 'shellMode', mode });
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
    setInterval(syncChromeMode, 500);
  });
})();
