/* Runs inside the Flow page. Gives Veo Auto a chrome.runtime and bridges it to the host. */
(function () {
  function hostOk() {
    const host = location.hostname || '';
    return /flow\.google\.com$/i.test(host) || /(^|\.)labs\.google$/i.test(host);
  }
  if (!hostOk()) return;

  const listeners = [];
  const waiters = new Map();
  let seq = 1;

  function post(msg) {
    try {
      window.chrome.webview.postMessage(JSON.stringify(msg));
    } catch (e) {}
  }

  function finish(id, result) {
    const waiter = waiters.get(id);
    if (!waiter) return;
    waiters.delete(id);
    waiter(result);
  }

  try {
    window.chrome.webview.addEventListener('message', (ev) => {
      let msg = ev.data;
      try { if (typeof msg === 'string') msg = JSON.parse(msg); } catch (e) { return; }
      if (!msg || msg.type !== 'toGuest' || msg.channel !== 'veo-bg-result') return;
      const data = msg.data || {};
      finish(data.id, data.result);
    });
  } catch (e) {}

  function askHost(msg) {
    const id = seq++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiters.delete(id);
        resolve({ success: false, error: 'Host timed out' });
      }, 20000);
      waiters.set(id, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
      post({ type: 'toHost', channel: 'veo-bg', data: { id, msg } });
    });
  }

  function triggerDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || '';
    a.rel = 'noopener';
    (document.documentElement || document.body).appendChild(a);
    a.click();
    a.remove();
    return { success: true, downloadId: Date.now() };
  }

  const runtime = {
    id: 'flowbrowser-veo-auto-local',
    lastError: null,
    getURL(path) {
      return 'http://flowbrowser.local/extensions/veo-auto/' + String(path || '').replace(/^\//, '');
    },
    getManifest() {
      return { name: 'Flow Automation', version: '3.3.0', manifest_version: 3 };
    },
    connect() {
      return {
        name: 'content',
        onMessage: { addListener() {}, removeListener() {} },
        onDisconnect: { addListener() {}, removeListener() {} },
        postMessage() {},
        disconnect() {}
      };
    },
    sendMessage(a, b, c) {
      let msg = a;
      let cb = null;
      if (typeof a === 'string') {
        msg = b;
        cb = typeof c === 'function' ? c : null;
      } else if (typeof b === 'function') {
        cb = b;
      }
      const type = msg && msg.type;
      let pending;
      if (type === 'DOWNLOAD_RESOURCE' || type === 'DOWNLOAD_VIDEO') {
        pending = Promise.resolve(triggerDownload(msg.url, msg.filename));
      } else if (type === 'SET_FOLDER_NAME' || type === 'PROMPT_GROUP_STATUS' || type === 'VIDEO_GENERATION_PROGRESS' || type === 'CONTENT_SCRIPT_RESET') {
        post({ type: 'toHost', channel: 'veo-status', data: { msg } });
        pending = Promise.resolve({ success: true });
      } else {
        pending = askHost(msg || {});
      }
      if (cb) {
        pending.then((value) => { try { cb(value); } catch (e) {} });
        return undefined;
      }
      return pending;
    },
    onMessage: {
      addListener(fn) { listeners.push(fn); },
      removeListener(fn) {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      }
    },
    onConnect: { addListener() {}, removeListener() {} },
    onInstalled: { addListener() {}, removeListener() {} }
  };

  function install() {
    const existing = window.chrome;
    if (!existing) {
      window.chrome = { runtime };
      return;
    }
    try {
      if (existing.runtime == null) existing.runtime = runtime;
    } catch (e) {
      try {
        const next = { runtime };
        if (existing.webview) next.webview = existing.webview;
        window.chrome = next;
      } catch (err) {
        console.warn('[Veo Auto] could not install page bridge', err);
      }
    }
  }
  install();

  window.__veoDispatch = function (msg, reqId) {
    let replied = false;
    const sendResponse = (result) => {
      if (replied) return;
      replied = true;
      window.__veoLast = result;
      post({
        type: 'toHost',
        channel: 'veo-tabs-result',
        data: { reqId, result: result === undefined ? null : result }
      });
    };
    if (!listeners.length) {
      sendResponse({ success: false, error: 'Flow Automation is not running on this page' });
      return;
    }
    let async = false;
    for (const fn of listeners.slice()) {
      try {
        const ret = fn(msg, { id: runtime.id, tab: { id: 1, url: location.href } }, sendResponse);
        if (ret === true) async = true;
      } catch (e) {
        sendResponse({ success: false, error: String(e && e.message || e) });
        return;
      }
    }
    if (!async && !replied) sendResponse(null);
  };
  window.__veoListenerCount = function () { return listeners.length; };
  window.__veoStartContent = true;
})();
