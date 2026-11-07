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
})();
""".trimIndent()
}
