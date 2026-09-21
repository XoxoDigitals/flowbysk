package com.flowbrowser.app

/**
 * Polyfill for window.chrome.webview used by shell-bridge.js and flow-inject.js.
 * Host methods: FlowHost.postMessage(json) / ShellHost.postMessage(json)
 */
object BridgePolyfill {
    fun script(interfaceName: String): String = """
(function(){
  if (window.chrome && window.chrome.webview && window.chrome.webview.__flowNative) return;
  var listeners = [];
  var host = window.$interfaceName;
  function deliver(data) {
    var ev = { data: data };
    listeners.slice().forEach(function(fn){
      try { fn(ev); } catch (e) { console.error(e); }
    });
  }
  window.chrome = window.chrome || {};
  window.chrome.webview = {
    __flowNative: true,
    postMessage: function(msg) {
      try {
        var s = (typeof msg === 'string') ? msg : JSON.stringify(msg);
        if (host && host.postMessage) host.postMessage(s);
      } catch (e) { console.error('[Bridge] post failed', e); }
    },
    addEventListener: function(type, fn) {
      if (type === 'message' && typeof fn === 'function') listeners.push(fn);
    },
    removeEventListener: function(type, fn) {
      if (type !== 'message') return;
      listeners = listeners.filter(function(x){ return x !== fn; });
    }
  };
  window.__flowDeliverHostMessage = deliver;
})();
""".trimIndent()
}
