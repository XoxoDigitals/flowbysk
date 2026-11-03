/**
 * Chrome Extension API Polyfill for Flow Browser 8.0.6 Bulk Mode (v3.6.0)
 * Bridges Side Panel & Workflow windows to FlowView and WPF host via WebView2 postMessage.
 */
(function () {
  'use strict';
  if (window.__veoPolyfillLoaded) return;
  window.__veoPolyfillLoaded = true;

  var STORAGE_PREFIX = 'veo_ext_';
  var EXT_ID = 'fnmijgmnjpealnnadjpjilaanhhambeb';
  var EXT_BASE = 'https://app.flowbrowser.localhost/extensions/veo-auto/';

  function makeEvent(name) {
    var listeners = [];
    return {
      addListener: function (fn) { if (typeof fn === 'function' && listeners.indexOf(fn) === -1) listeners.push(fn); },
      removeListener: function (fn) { var i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); },
      hasListener: function (fn) { return listeners.indexOf(fn) !== -1; },
      hasListeners: function () { return listeners.length > 0; },
      _fire: function () {
        var args = Array.prototype.slice.call(arguments);
        var copy = listeners.slice();
        var results = [];
        for (var i = 0; i < copy.length; i++) {
          try { results.push(copy[i].apply(null, args)); } catch (e) { console.error('[veo-polyfill:' + name + ']', e); }
        }
        return results;
      }
    };
  }

  function postToHost(payload) {
    try {
      if (window.chrome && window.chrome.webview && typeof window.chrome.webview.postMessage === 'function') {
        window.chrome.webview.postMessage(JSON.stringify(payload));
        return true;
      }
    } catch (e) {}
    return false;
  }

  var globalStorageChanged = makeEvent('storage.onChanged');

  function makeStorageArea(areaName) {
    var areaPrefix = areaName === 'session' ? STORAGE_PREFIX + 'session_' : STORAGE_PREFIX;
    var areaChanged = makeEvent('storage.' + areaName + '.onChanged');

    function fireChanges(changes) {
      if (!changes || Object.keys(changes).length === 0) return;
      areaChanged._fire(changes, areaName);
      globalStorageChanged._fire(changes, areaName);
    }

    return {
      onChanged: areaChanged,
      get: function (keys, callback) {
        var result = {};
        try {
          if (keys === null || keys === undefined) {
            for (var i = 0; i < localStorage.length; i++) {
              var k = localStorage.key(i);
              if (k && k.indexOf(areaPrefix) === 0) {
                var shortKey = k.slice(areaPrefix.length);
                try { result[shortKey] = JSON.parse(localStorage.getItem(k)); } catch (_) { result[shortKey] = localStorage.getItem(k); }
              }
            }
          } else if (typeof keys === 'string') {
            var raw = localStorage.getItem(areaPrefix + keys);
            if (raw !== null) {
              try { result[keys] = JSON.parse(raw); } catch (_) { result[keys] = raw; }
            }
          } else if (Array.isArray(keys)) {
            keys.forEach(function (k) {
              var r = localStorage.getItem(areaPrefix + k);
              if (r !== null) {
                try { result[k] = JSON.parse(r); } catch (_) { result[k] = r; }
              }
            });
          } else if (typeof keys === 'object') {
            Object.keys(keys).forEach(function (k) {
              var r = localStorage.getItem(areaPrefix + k);
              if (r !== null) {
                try { result[k] = JSON.parse(r); } catch (_) { result[k] = r; }
              } else {
                result[k] = keys[k];
              }
            });
          }
        } catch (e) {}
        if (typeof callback === 'function') { setTimeout(function () { callback(result); }, 0); }
        return Promise.resolve(result);
      },
      set: function (items, callback) {
        var changes = {};
        try {
          Object.keys(items || {}).forEach(function (k) {
            var oldRaw = localStorage.getItem(areaPrefix + k);
            var oldVal = undefined;
            if (oldRaw !== null) { try { oldVal = JSON.parse(oldRaw); } catch (_) { oldVal = oldRaw; } }
            var newVal = items[k];
            localStorage.setItem(areaPrefix + k, JSON.stringify(newVal));
            changes[k] = { oldValue: oldVal, newValue: newVal };
          });
        } catch (e) {}
        fireChanges(changes);
        // Also broadcast storage change to other WebViews via host
        postToHost({ type: 'veo-storage-sync', area: areaName, changes: changes });
        if (typeof callback === 'function') { setTimeout(callback, 0); }
        return Promise.resolve();
      },
      remove: function (keys, callback) {
        var list = Array.isArray(keys) ? keys : [keys];
        var changes = {};
        try {
          list.forEach(function (k) {
            var oldRaw = localStorage.getItem(areaPrefix + k);
            if (oldRaw !== null) {
              var oldVal;
              try { oldVal = JSON.parse(oldRaw); } catch (_) { oldVal = oldRaw; }
              localStorage.removeItem(areaPrefix + k);
              changes[k] = { oldValue: oldVal };
            }
          });
        } catch (e) {}
        fireChanges(changes);
        postToHost({ type: 'veo-storage-sync', area: areaName, changes: changes });
        if (typeof callback === 'function') { setTimeout(callback, 0); }
        return Promise.resolve();
      },
      clear: function (callback) {
        var changes = {};
        try {
          var toRemove = [];
          for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (k && k.indexOf(areaPrefix) === 0) toRemove.push(k);
          }
          toRemove.forEach(function (k) {
            var shortKey = k.slice(areaPrefix.length);
            var oldVal;
            try { oldVal = JSON.parse(localStorage.getItem(k)); } catch (_) {}
            localStorage.removeItem(k);
            changes[shortKey] = { oldValue: oldVal };
          });
        } catch (e) {}
        fireChanges(changes);
        if (typeof callback === 'function') { setTimeout(callback, 0); }
        return Promise.resolve();
      }
    };
  }

  var localArea = makeStorageArea('local');
  var syncArea = makeStorageArea('sync');
  var sessionArea = makeStorageArea('session');

  window.addEventListener('storage', function (ev) {
    if (!ev.key || ev.key.indexOf(STORAGE_PREFIX) !== 0) return;
    var isSession = ev.key.indexOf(STORAGE_PREFIX + 'session_') === 0;
    var prefix = isSession ? STORAGE_PREFIX + 'session_' : STORAGE_PREFIX;
    var areaName = isSession ? 'session' : 'local';
    var shortKey = ev.key.slice(prefix.length);
    var oldVal = undefined, newVal = undefined;
    if (ev.oldValue !== null) { try { oldVal = JSON.parse(ev.oldValue); } catch (_) { oldVal = ev.oldValue; } }
    if (ev.newValue !== null) { try { newVal = JSON.parse(ev.newValue); } catch (_) { newVal = ev.newValue; } }
    var changes = {};
    changes[shortKey] = { oldValue: oldVal, newValue: newVal };
    if (isSession) sessionArea.onChanged._fire(changes, 'session');
    else localArea.onChanged._fire(changes, 'local');
    globalStorageChanged._fire(changes, areaName);
  });

  var runtimeOnMessage = makeEvent('runtime.onMessage');
  var runtimeOnConnect = makeEvent('runtime.onConnect');
  var runtimeOnInstalled = makeEvent('runtime.onInstalled');
  var runtimeOnUpdateAvailable = makeEvent('runtime.onUpdateAvailable');

  var _pendingTabCalls = {};
  var _callSeq = 1;
  var _flowTabInfo = {
    id: 1,
    windowId: 1,
    index: 0,
    url: 'https://labs.google/fx/tools/flow',
    title: 'Flow - Google Labs',
    active: true,
    highlighted: true,
    pinned: false,
    incognito: false,
    status: 'complete'
  };

  function handleHostPayload(d) {
    if (!d || typeof d !== 'object') return;
    if (d.type === 'veo-tabs-result' && d.reqId) {
      var cb = _pendingTabCalls[d.reqId];
      if (cb) {
        delete _pendingTabCalls[d.reqId];
        cb(d.result);
      }
      return;
    }
    if (d.type === 'veo-status' && d.payload) {
      runtimeOnMessage._fire(d.payload, { id: EXT_ID, tab: _flowTabInfo }, function () {});
      return;
    }
    if (d.type === 'veo-ui-broadcast' && d.payload) {
      var reqId = d.reqId;
      var responded = false;
      var sendResp = function (resp) {
        if (responded) return;
        responded = true;
        if (reqId) postToHost({ type: 'veo-ui-broadcast-reply', reqId: reqId, result: resp });
      };
      runtimeOnMessage._fire(d.payload, { id: EXT_ID, tab: _flowTabInfo }, sendResp);
      return;
    }
    if (d.type === 'veo-storage-sync' && d.changes) {
      var area = d.area || 'local';
      if (area === 'session') sessionArea.onChanged._fire(d.changes, 'session');
      else localArea.onChanged._fire(d.changes, 'local');
      globalStorageChanged._fire(d.changes, area);
      return;
    }
    if (d.type === 'veo-flow-url' && d.url) {
      _flowTabInfo.url = d.url;
      if (d.title) _flowTabInfo.title = d.title;
      tabsOnUpdated._fire(1, { status: 'complete', url: d.url }, _flowTabInfo);
      return;
    }
    if (d.type === 'veo-account-mode') {
      applyVeoImageOnlyMode(!!d.imageOnly);
      return;
    }
  }

  var _veoImageOnly = false;
  var _didInitialImageTabSwitch = false;
  try {
    _veoImageOnly = localStorage.getItem('__veo_image_only') === '1';
  } catch (e) {}

  function ensureVeoImageOnlyStyle() {
    if (document.getElementById('veo-image-only-style')) return;
    var st = document.createElement('style');
    st.id = 'veo-image-only-style';
    st.textContent =
      'html[data-veo-image-only="true"] .space-y-1.mt-2 > .grid.grid-cols-3:first-child,' +
      'html[data-veo-image-only="true"] button:has(.pi-file-edit),' +
      'html[data-veo-image-only="true"] button:has(.pi-th-large),' +
      'html[data-veo-image-only="true"] button:has(.pi-sparkles),' +
      'html[data-veo-image-only="true"] [data-veo-hide-mode="true"] {' +
      '  display: none !important;' +
      '}' +
      'html[data-veo-image-only="true"] .space-y-1.mt-2 > .grid.grid-cols-3:nth-child(2) {' +
      '  grid-template-columns: repeat(2, minmax(0, 1fr)) !important;' +
      '}';
    (document.head || document.documentElement).appendChild(st);
  }

  function enforceVeoImageOnlyDom() {
    ensureVeoImageOnlyStyle();
    if (!document.documentElement) return;
    if (_veoImageOnly) {
      if (document.documentElement.getAttribute('data-veo-image-only') !== 'true') {
        document.documentElement.setAttribute('data-veo-image-only', 'true');
      }
      if (!_didInitialImageTabSwitch) {
        var textToImgBtn = document.querySelector('.space-y-1.mt-2 button:has(.pi-star)') || document.querySelector('button:has(.pi-star)');
        if (textToImgBtn) {
          _didInitialImageTabSwitch = true;
          try { textToImgBtn.click(); } catch (e) {}
        }
      }
    } else {
      _didInitialImageTabSwitch = false;
      if (document.documentElement.getAttribute('data-veo-image-only') === 'true') {
        document.documentElement.removeAttribute('data-veo-image-only');
      }
    }
  }

  function applyVeoImageOnlyMode(imageOnly) {
    var nextMode = !!imageOnly;
    if (nextMode && !_veoImageOnly) {
      _didInitialImageTabSwitch = false;
    } else if (!nextMode) {
      _didInitialImageTabSwitch = false;
    }
    _veoImageOnly = nextMode;
    try {
      localStorage.setItem('__veo_image_only', _veoImageOnly ? '1' : '0');
    } catch (e) {}
    enforceVeoImageOnlyDom();
  }

  window.__applyVeoImageOnlyMode = applyVeoImageOnlyMode;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enforceVeoImageOnlyDom);
  } else {
    enforceVeoImageOnlyDom();
  }
  setInterval(enforceVeoImageOnlyDom, 450);

  if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener('message', function (ev) {
      var d = typeof ev.data === 'string' ? (function () { try { return JSON.parse(ev.data); } catch (_) { return null; } })() : ev.data;
      handleHostPayload(d);
    });
  }

  window.addEventListener('message', function (ev) {
    handleHostPayload(ev.data);
  });

  function sendToFlowTab(message, callback) {
    var reqId = 'req_' + (_callSeq++) + '_' + Date.now();
    return new Promise(function (resolve) {
      var timeoutMs = (message && (message.type === 'AUTO_FILL_FLOW' || message.type === 'WORKFLOW_EXECUTE_STEP')) ? 900000 : 30000;
      var timer = setTimeout(function () {
        if (_pendingTabCalls[reqId]) {
          delete _pendingTabCalls[reqId];
          var fallback = message && message.type === 'CHECK_FLOW_PAGE' ? { isFlowPage: true } : { success: false, error: 'Timed out waiting for Flow tab' };
          if (typeof callback === 'function') callback(fallback);
          resolve(fallback);
        }
      }, timeoutMs);

      _pendingTabCalls[reqId] = function (res) {
        clearTimeout(timer);
        if (typeof callback === 'function') callback(res);
        resolve(res);
      };

      if (!postToHost({ type: 'veo-tabs-send', reqId: reqId, message: message })) {
        clearTimeout(timer);
        delete _pendingTabCalls[reqId];
        var fallback = message && message.type === 'CHECK_FLOW_PAGE' ? { isFlowPage: true } : { success: true };
        if (typeof callback === 'function') callback(fallback);
        resolve(fallback);
      }
    });
  }

  var tabsOnCreated = makeEvent('tabs.onCreated');
  var tabsOnRemoved = makeEvent('tabs.onRemoved');
  var tabsOnUpdated = makeEvent('tabs.onUpdated');
  var tabsOnActivated = makeEvent('tabs.onActivated');

  var tabs = {
    query: function (queryInfo, callback) {
      var res = [_flowTabInfo];
      if (typeof callback === 'function') setTimeout(function () { callback(res); }, 0);
      return Promise.resolve(res);
    },
    get: function (tabId, callback) {
      if (typeof callback === 'function') setTimeout(function () { callback(_flowTabInfo); }, 0);
      return Promise.resolve(_flowTabInfo);
    },
    sendMessage: function (tabId, message, optionsOrCallback, maybeCallback) {
      var cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
      return sendToFlowTab(message, cb);
    },
    create: function (createProperties, callback) {
      var url = (createProperties && createProperties.url) || '';
      if (url.indexOf('workflow/index.html') !== -1) {
        postToHost({ type: 'veo-open-workflow', url: url });
      } else if (url.indexOf('flow.google.com') !== -1 || url.indexOf('labs.google') !== -1) {
        postToHost({ type: 'veo-navigate-flow', url: url });
      }
      var t = Object.assign({}, _flowTabInfo, { url: url || _flowTabInfo.url });
      if (typeof callback === 'function') setTimeout(function () { callback(t); }, 0);
      return Promise.resolve(t);
    },
    update: function (tabId, updateProperties, callback) {
      if (typeof updateProperties === 'function') { callback = updateProperties; updateProperties = tabId; tabId = 1; }
      if (updateProperties && updateProperties.url) {
        postToHost({ type: 'veo-navigate-flow', url: updateProperties.url });
      }
      if (typeof callback === 'function') setTimeout(function () { callback(_flowTabInfo); }, 0);
      return Promise.resolve(_flowTabInfo);
    },
    reload: function (tabId, reloadProperties, callback) {
      var cb = typeof reloadProperties === 'function' ? reloadProperties : callback;
      postToHost({ type: 'veo-reload-flow' });
      if (typeof cb === 'function') setTimeout(cb, 0);
      return Promise.resolve();
    },
    setZoom: function (tabId, zoomFactor, callback) {
      var cb = typeof zoomFactor === 'function' ? zoomFactor : callback;
      if (typeof cb === 'function') setTimeout(cb, 0);
      return Promise.resolve();
    },
    onCreated: tabsOnCreated,
    onRemoved: tabsOnRemoved,
    onUpdated: tabsOnUpdated,
    onActivated: tabsOnActivated
  };

  var windows = {
    create: function (createData, callback) {
      var url = createData && (Array.isArray(createData.url) ? createData.url[0] : createData.url) || '';
      postToHost({ type: 'veo-open-workflow', url: url });
      var win = { id: 2, focused: true, type: 'popup', state: 'normal', tabs: [{ id: 2, windowId: 2, url: url, active: true }] };
      if (typeof callback === 'function') setTimeout(function () { callback(win); }, 0);
      return Promise.resolve(win);
    },
    update: function (windowId, updateInfo, callback) {
      postToHost({ type: 'veo-focus-workflow', windowId: windowId });
      var win = { id: windowId || 2, focused: true };
      if (typeof callback === 'function') setTimeout(function () { callback(win); }, 0);
      return Promise.resolve(win);
    },
    getCurrent: function (getInfo, callback) {
      var cb = typeof getInfo === 'function' ? getInfo : callback;
      var win = { id: 1, focused: true, type: 'normal', state: 'normal' };
      if (typeof cb === 'function') setTimeout(function () { cb(win); }, 0);
      return Promise.resolve(win);
    }
  };

  var runtime = {
    id: EXT_ID,
    lastError: null,
    getManifest: function () {
      return {
        name: 'Flow Bulk Studio',
        version: '3.6.0',
        manifest_version: 3
      };
    },
    getURL: function (p) {
      var clean = String(p || '').replace(/^\/+/, '');
      return EXT_BASE + clean;
    },
    connect: function (extensionIdOrInfo, connectInfo) {
      var info = typeof extensionIdOrInfo === 'object' ? extensionIdOrInfo : (connectInfo || {});
      return {
        name: info.name || 'port',
        postMessage: function () {},
        disconnect: function () {},
        onMessage: makeEvent('port.onMessage'),
        onDisconnect: makeEvent('port.onDisconnect')
      };
    },
    sendMessage: function (extensionIdOrMessage, maybeMessage, maybeOptions, maybeCallback) {
      var msg = typeof extensionIdOrMessage === 'string' ? maybeMessage : extensionIdOrMessage;
      var cb = typeof maybeMessage === 'function' ? maybeMessage : (typeof maybeOptions === 'function' ? maybeOptions : maybeCallback);

      return new Promise(function (resolve) {
        var resolved = false;
        var finish = function (res) {
          if (resolved) return;
          resolved = true;
          if (typeof cb === 'function') { try { cb(res); } catch (_) {} }
          resolve(res);
        };

        // Fire local listeners first (e.g. WORKFLOW_IMPORT_REQUEST / WORKFLOW_IMPORT_READY)
        runtimeOnMessage._fire(msg, { id: EXT_ID, tab: _flowTabInfo }, finish);

        // Also broadcast to other UI views (Side Panel <-> Workflow Window) and host background
        var reqId = 'uib_' + (_callSeq++) + '_' + Date.now();
        _pendingTabCalls[reqId] = function (res) { finish(res); };
        postToHost({ type: 'veo-ui-message', reqId: reqId, message: msg });

        setTimeout(function () {
          delete _pendingTabCalls[reqId];
          finish({ success: true });
        }, 1500);
      });
    },
    reload: function () { window.location.reload(); },
    requestUpdateCheck: function (cb) {
      if (typeof cb === 'function') setTimeout(function () { cb('no_update', {}); }, 0);
      return Promise.resolve({ status: 'no_update' });
    },
    onMessage: runtimeOnMessage,
    onConnect: runtimeOnConnect,
    onInstalled: runtimeOnInstalled,
    onUpdateAvailable: runtimeOnUpdateAvailable
  };

  if (!window.chrome) window.chrome = {};
  Object.assign(window.chrome, {
    storage: {
      local: localArea,
      sync: syncArea,
      session: sessionArea,
      onChanged: globalStorageChanged
    },
    runtime: runtime,
    tabs: tabs,
    windows: windows,
    sidePanel: {
      setOptions: function () { return Promise.resolve(); },
      setPanelBehavior: function () { return Promise.resolve(); },
      open: function () { return Promise.resolve(); }
    },
    action: {
      onClicked: makeEvent('action.onClicked')
    },
    downloads: {
      download: function (opts, cb) {
        postToHost({ type: 'veo-bg', reqId: 'dl_' + Date.now(), message: { type: 'DOWNLOAD_RESOURCE', url: opts.url, filename: opts.filename, autoChangeFileName: !!opts.filename } });
        if (typeof cb === 'function') setTimeout(function () { cb(1); }, 0);
        return Promise.resolve(1);
      },
      onDeterminingFilename: makeEvent('downloads.onDeterminingFilename')
    },
    i18n: {
      getUILanguage: function () { return navigator.language || 'en'; },
      getMessage: function (k) { return k; }
    }
  });
})();
