/* Minimal chrome.* polyfill so Veo Auto side-panel can mount inside Flow Browser iframe */
(function () {
  if (window.chrome && window.chrome.runtime && window.chrome.runtime.id) return;

  const EXT_ID = 'flowbrowser-veo-auto-local';
  const EXT_BASE = 'http://flowbrowser.local/extensions/veo-auto/';
  const listeners = [];
  const portListeners = new Map();
  let portSeq = 1;

  function storageArea(prefix) {
    const keyOf = (k) => prefix + k;
    return {
      get(keys, cb) {
        const out = {};
        if (keys == null) {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(prefix)) {
              try { out[k.slice(prefix.length)] = JSON.parse(localStorage.getItem(k)); } catch (e) {}
            }
          }
        } else {
          const list = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
          const defaults = (!Array.isArray(keys) && keys && typeof keys === 'object') ? keys : {};
          for (const k of list) {
            const raw = localStorage.getItem(keyOf(k));
            if (raw != null) {
              try { out[k] = JSON.parse(raw); } catch (e) { out[k] = raw; }
            } else if (defaults[k] !== undefined) {
              out[k] = defaults[k];
            }
          }
        }
        if (cb) cb(out);
        return Promise.resolve(out);
      },
      set(items, cb) {
        for (const [k, v] of Object.entries(items || {})) {
          localStorage.setItem(keyOf(k), JSON.stringify(v));
        }
        if (cb) cb();
        return Promise.resolve();
      },
      remove(keys, cb) {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) localStorage.removeItem(keyOf(k));
        if (cb) cb();
        return Promise.resolve();
      },
      clear(cb) {
        const toRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(prefix)) toRemove.push(k);
        }
        toRemove.forEach((k) => localStorage.removeItem(k));
        if (cb) cb();
        return Promise.resolve();
      }
    };
  }

  function makePort(name) {
    const id = portSeq++;
    const onMessage = { addListener(fn) { (portListeners.get(id) || portListeners.set(id, []).get(id)).push(fn); }, removeListener() {} };
    const onDisconnect = { addListener() {}, removeListener() {} };
    return {
      name: name || '',
      sender: { id: EXT_ID },
      onMessage,
      onDisconnect,
      postMessage(msg) {
        try {
          window.parent.postMessage({ source: 'veo-auto-port', name, msg }, '*');
        } catch (e) {}
      },
      disconnect() {}
    };
  }

  const runtime = {
    id: EXT_ID,
    lastError: null,
    getManifest() {
      return { name: 'Flow Automation', version: '3.3.0', manifest_version: 3 };
    },
    getURL(path) {
      const p = String(path || '').replace(/^\//, '');
      return EXT_BASE + p;
    },
    connect(extensionIdOrOpts, maybeOpts) {
      const opts = typeof extensionIdOrOpts === 'object' ? extensionIdOrOpts : (maybeOpts || {});
      return makePort(opts.name || 'side-panel');
    },
    sendMessage(extensionIdOrMsg, maybeMsg, maybeCb) {
      let msg = extensionIdOrMsg;
      let cb = maybeCb;
      if (typeof extensionIdOrMsg === 'string') {
        msg = maybeMsg;
        cb = typeof maybeCb === 'function' ? maybeCb : (typeof maybeMsg === 'function' ? maybeMsg : null);
      } else if (typeof maybeMsg === 'function') {
        cb = maybeMsg;
      }
      try {
        window.parent.postMessage({ source: 'veo-auto-runtime', msg }, '*');
      } catch (e) {}
      const result = Promise.resolve(undefined);
      if (cb) {
        result.then((v) => cb(v));
        return undefined;
      }
      return result;
    },
    onMessage: {
      addListener(fn) { listeners.push(fn); },
      removeListener(fn) {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      }
    },
    onConnect: { addListener() {}, removeListener() {} },
    onInstalled: { addListener() {}, removeListener() {} },
    onStartup: { addListener() {}, removeListener() {} }
  };

  const tabs = {
    query(queryInfo, cb) {
      const tab = { id: 1, active: true, url: 'https://flow.google.com/', title: 'Flow', windowId: 1 };
      const list = [tab];
      if (cb) cb(list);
      return Promise.resolve(list);
    },
    sendMessage(tabId, msg, cb) {
      try { window.parent.postMessage({ source: 'veo-auto-tabs', tabId, msg }, '*'); } catch (e) {}
      if (cb) cb();
      return Promise.resolve();
    },
    create(createProperties, cb) {
      const tab = { id: 2, url: createProperties && createProperties.url };
      if (cb) cb(tab);
      return Promise.resolve(tab);
    },
    update() { return Promise.resolve({}); },
    getCurrent(cb) {
      const tab = { id: 1, url: 'https://flow.google.com/' };
      if (cb) cb(tab);
      return Promise.resolve(tab);
    }
  };

  const storage = {
    local: storageArea('veo_local_'),
    sync: storageArea('veo_sync_'),
    session: storageArea('veo_session_'),
    onChanged: { addListener() {}, removeListener() {} }
  };

  window.chrome = {
    runtime,
    tabs,
    storage,
    cookies: {
      get() { return Promise.resolve(null); },
      getAll() { return Promise.resolve([]); },
      set() { return Promise.resolve(null); },
      remove() { return Promise.resolve(null); }
    },
    downloads: {
      download() { return Promise.resolve(1); },
      search() { return Promise.resolve([]); },
      onChanged: { addListener() {}, removeListener() {} }
    },
    debugger: {
      attach() { return Promise.resolve(); },
      detach() { return Promise.resolve(); },
      sendCommand() { return Promise.resolve({}); },
      onEvent: { addListener() {}, removeListener() {} }
    },
    sidePanel: {
      setOptions() { return Promise.resolve(); },
      open() { return Promise.resolve(); }
    },
    action: {
      setBadgeText() {},
      setTitle() {}
    }
  };

  window.addEventListener('message', (ev) => {
    const data = ev.data;
    if (!data || data.source !== 'veo-auto-host') return;
    for (const fn of listeners.slice()) {
      try { fn(data.msg, { id: EXT_ID }, () => {}); } catch (e) {}
    }
  });

  console.log('[Veo Auto] chrome polyfill ready');
})();
