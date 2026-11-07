package com.flowbrowser.app

object BridgePolyfill {
    fun script(interfaceName: String): String = """
(function(){
  var listeners = (window.__flowBridgeListeners = window.__flowBridgeListeners || []);
  if ("$interfaceName" === "ShellHost") {
    try { document.documentElement.classList.add("platform-android"); } catch (e) {}
  }
  function host() {
    return window.$interfaceName || window.ShellHost || window.FlowHost || null;
  }
  function deliver(data) {
    listeners.slice().forEach(function(fn){
      try { fn({ data: data }); } catch (e) { console.error(e); }
    });
  }
  window.chrome = window.chrome || {};
  window.chrome.webview = {
    __flowNative: true,
    postMessage: function(msg) {
      try {
        var s = (typeof msg === 'string') ? msg : JSON.stringify(msg);
        var h = host();
        if (h && h.postMessage) h.postMessage(s);
      } catch (e) { console.error('[Bridge] post failed', e); }
    },
    addEventListener: function(type, fn) {
      if (type === 'message' && typeof fn === 'function' && listeners.indexOf(fn) < 0) listeners.push(fn);
    },
    removeEventListener: function(type, fn) {
      if (type !== 'message') return;
      var i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    }
  };
  window.__flowDeliverHostMessage = deliver;

  // On FlowHost (Flow / Gemini / ZexTTS), intercept blob: and data: downloads BEFORE the page revokes them
  if ("$interfaceName" === "FlowHost" && !window.__flowBlobHookInstalled) {
    window.__flowBlobHookInstalled = true;
    var blobStore = (window.__flowBlobStore = window.__flowBlobStore || new Map());
    try {
      var origCreate = URL.createObjectURL.bind(URL);
      var origRevoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = function(obj) {
        var u = origCreate(obj);
        try {
          if (obj && (obj instanceof Blob || typeof obj.arrayBuffer === 'function')) {
            blobStore.set(u, obj);
          }
        } catch (e) {}
        return u;
      };
      URL.revokeObjectURL = function(u) {
        // Delay revocation by 60s so native/JS download reader can finish reading the Blob
        setTimeout(function() {
          try { blobStore.delete(u); } catch (e) {}
          try { origRevoke(u); } catch (e) {}
        }, 60000);
      };
    } catch (e) {}

    window.__flowStreamBlobToHost = async function(url, fallbackName, mimeHint) {
      var id = 'dl_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
      var filename = fallbackName || '';
      try {
        var blob = blobStore.get(url);
        if (!blob) {
          var res = await fetch(url);
          blob = await res.blob();
        }
        var mime = (blob && blob.type) || mimeHint || 'application/octet-stream';
        var name = filename;
        if (!name || /^download(\.bin)?$/i.test(name) || /\.bin$/i.test(name)) {
          var ext = 'bin';
          if (/mp4|mpeg4/i.test(mime)) ext = 'mp4';
          else if (/webm/i.test(mime)) ext = 'webm';
          else if (/quicktime/i.test(mime)) ext = 'mov';
          else if (/audio\/mpeg|mp3/i.test(mime)) ext = 'mp3';
          else if (/audio\/wav|wave/i.test(mime)) ext = 'wav';
          else if (/audio\/ogg/i.test(mime)) ext = 'ogg';
          else if (/audio\/mp4|audio\/x-m4a/i.test(mime)) ext = 'm4a';
          else if (/png/i.test(mime)) ext = 'png';
          else if (/jpe?g/i.test(mime)) ext = 'jpg';
          else if (/webp/i.test(mime)) ext = 'webp';
          else if (/gif/i.test(mime)) ext = 'gif';
          else if (/^video\//i.test(mime)) ext = 'mp4';
          else if (/^image\//i.test(mime)) ext = 'png';
          else if (/^audio\//i.test(mime)) ext = 'mp3';
          name = (name ? name.replace(/\.bin$/i, '') : ('flow_' + Date.now())) + '.' + ext;
        }
        var buf = await blob.arrayBuffer();
        var bytes = new Uint8Array(buf);
        if (!window.FlowHost || !window.FlowHost.downloadBegin) throw new Error('FlowHost missing');
        window.FlowHost.downloadBegin(id, name, mime, bytes.length);
        var CHUNK = 196608; // 192 KB (divisible by 3 for clean base64)
        for (var offset = 0; offset < bytes.length; offset += CHUNK) {
          var slice = bytes.subarray(offset, Math.min(offset + CHUNK, bytes.length));
          var binary = '';
          var step = 8192;
          for (var j = 0; j < slice.length; j += step) {
            binary += String.fromCharCode.apply(null, slice.subarray(j, Math.min(j + step, slice.length)));
          }
          window.FlowHost.downloadChunk(id, btoa(binary));
        }
        window.FlowHost.downloadEnd(id);
        return true;
      } catch (err) {
        try {
          if (window.FlowHost && window.FlowHost.downloadFail) {
            window.FlowHost.downloadFail(id, filename || 'download', String((err && err.message) || err));
          }
        } catch (e2) {}
        return false;
      }
    };

    // Intercept <a download href="blob:..."> and <a download href="data:..."> clicks before WebView drops them
    try {
      var origClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function() {
        try {
          var href = this.href || this.getAttribute('href') || '';
          var dl = this.getAttribute('download');
          if ((href.indexOf('blob:') === 0 || href.indexOf('data:') === 0) && (dl !== null || !this.target || this.target === '_self' || this.target === '_blank')) {
            if (this.__flowHandledClick) return;
            this.__flowHandledClick = true;
            setTimeout(function(el){ try { delete el.__flowHandledClick; } catch(e){} }, 1000, this);
            window.__flowStreamBlobToHost(href, dl || 'flow_' + Date.now(), '');
            return;
          }
        } catch (e) {}
        return origClick.apply(this, arguments);
      };
      document.addEventListener('click', function(ev) {
        try {
          var a = ev.target && ev.target.closest ? ev.target.closest('a[download], a[href^="blob:"], a[href^="data:"]') : null;
          if (!a) return;
          var href = a.href || a.getAttribute('href') || '';
          var dl = a.getAttribute('download');
          if (href.indexOf('blob:') === 0 || (href.indexOf('data:') === 0 && dl !== null)) {
            if (a.__flowHandledClick) return;
            a.__flowHandledClick = true;
            setTimeout(function(el){ try { delete el.__flowHandledClick; } catch(e){} }, 1000, a);
            ev.preventDefault();
            ev.stopPropagation();
            window.__flowStreamBlobToHost(href, dl || 'flow_' + Date.now(), '');
          }
        } catch (e) {}
      }, true);
    } catch (e) {}
  }
})();
""".trimIndent()
}
