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

    // Native Android Clipboard Bridge + Gemini/Flow Long-Press Paste & Focus Stabilizer
    try {
      var lastNativeCopyAt = 0;
      function pushClipboardToNative(text) {
        var str = String(text == null ? '' : text);
        if (!str) return;
        lastNativeCopyAt = Date.now();
        try {
          if (window.FlowHost && window.FlowHost.setClipboardText) {
            window.FlowHost.setClipboardText(str);
          }
        } catch (e) {}
      }
      function readClipboardFromNative() {
        try {
          if (window.FlowHost && window.FlowHost.getClipboardText) {
            return String(window.FlowHost.getClipboardText() || '');
          }
        } catch (e) {}
        return '';
      }

      if (navigator.clipboard) {
        var origWriteText = navigator.clipboard.writeText ? navigator.clipboard.writeText.bind(navigator.clipboard) : null;
        navigator.clipboard.writeText = function(text) {
          var str = String(text == null ? '' : text);
          pushClipboardToNative(str);
          if (origWriteText) {
            return origWriteText(str).catch(function() { return undefined; });
          }
          return Promise.resolve();
        };
        var origWrite = navigator.clipboard.write ? navigator.clipboard.write.bind(navigator.clipboard) : null;
        navigator.clipboard.write = function(items) {
          try {
            if (Array.isArray(items) && items.length > 0) {
              var item = items[0];
              if (item && typeof item.getType === 'function') {
                item.getType('text/plain').then(function(b) { return b.text(); }).then(function(txt) {
                  if (txt) pushClipboardToNative(txt);
                }).catch(function() {
                  if (item.types && item.types.indexOf('text/html') >= 0) {
                    item.getType('text/html').then(function(b) { return b.text(); }).then(function(html) {
                      var tmp = document.createElement('div');
                      tmp.innerHTML = html || '';
                      var plain = (tmp.innerText || tmp.textContent || '').trim();
                      if (plain) pushClipboardToNative(plain);
                    }).catch(function(){});
                  }
                });
              }
            }
          } catch (e) {}
          if (origWrite) {
            return origWrite(items).catch(function() { return undefined; });
          }
          return Promise.resolve();
        };
        var origReadText = navigator.clipboard.readText ? navigator.clipboard.readText.bind(navigator.clipboard) : null;
        navigator.clipboard.readText = function() {
          var nativeTxt = readClipboardFromNative();
          if (nativeTxt) return Promise.resolve(nativeTxt);
          if (origReadText) {
            return origReadText().catch(function() { return readClipboardFromNative(); });
          }
          return Promise.resolve('');
        };
      }

      var origExecCommand = document.execCommand ? document.execCommand.bind(document) : null;
      if (origExecCommand) {
        document.execCommand = function(cmd) {
          var res = false;
          try { res = origExecCommand.apply(document, arguments); } catch (e) {}
          try {
            var c = String(cmd || '').toLowerCase();
            if (c === 'copy' || c === 'cut') {
              var sel = window.getSelection ? String(window.getSelection().toString() || '') : '';
              if (!sel && document.activeElement && typeof document.activeElement.value === 'string') {
                var ae = document.activeElement;
                sel = ae.value.substring(ae.selectionStart || 0, ae.selectionEnd || ae.value.length);
              }
              if (sel) pushClipboardToNative(sel);
            }
          } catch (e) {}
          return res;
        };
      }

      document.addEventListener('copy', function(ev) {
        try {
          var clipData = ev.clipboardData && ev.clipboardData.getData ? ev.clipboardData.getData('text/plain') : '';
          var sel = clipData || (window.getSelection ? String(window.getSelection().toString() || '') : '');
          if (sel) pushClipboardToNative(sel);
        } catch (e) {}
      }, true);

      // Fallback for Gemini Copy buttons (code blocks, full responses, and user query copy buttons)
      document.addEventListener('click', function(ev) {
        try {
          var t = ev.target;
          if (!t || !t.closest) return;
          var btn = t.closest('button, [role="button"], copy-button');
          if (!btn) return;
          var aria = String(btn.getAttribute('aria-label') || btn.getAttribute('mattooltip') || btn.getAttribute('data-test-id') || btn.title || '').toLowerCase();
          var iconTxt = '';
          var ic = btn.querySelector('mat-icon, .google-symbols, .material-icons, i');
          if (ic) iconTxt = String(ic.textContent || ic.getAttribute('fonticon') || '').trim().toLowerCase();
          var isCopyBtn = aria.indexOf('copy') >= 0 || iconTxt === 'content_copy' || iconTxt === 'copy' || btn.tagName === 'COPY-BUTTON';
          if (!isCopyBtn) return;
          var clickedAt = Date.now();
          setTimeout(function() {
            if (lastNativeCopyAt >= clickedAt) return;
            var codeContainer = btn.closest('code-block, .code-block, pre') ||
              (btn.parentElement && btn.parentElement.parentElement && btn.parentElement.parentElement.querySelector('pre, code'));
            if (codeContainer) {
              var codeEl = codeContainer.querySelector('code, pre') || codeContainer;
              var cTxt = (codeEl.innerText || codeEl.textContent || '').trim();
              if (cTxt) { pushClipboardToNative(cTxt); return; }
            }
            var msgContainer = btn.closest('model-response, response-container, .response-container, user-query, .user-query-container, [data-message-author-role]');
            if (msgContainer) {
              var contentEl = msgContainer.querySelector('message-content, .markdown, .model-response-text, .query-text, .user-query-text') || msgContainer;
              var mTxt = (contentEl.innerText || contentEl.textContent || '').trim();
              if (mTxt) pushClipboardToNative(mTxt);
            }
          }, 70);
        } catch (e) {}
      }, true);

      // Find inner editable element for any touch inside Gemini "Ask Gemini" / Flow prompt box
      function findEditableTarget(node) {
        if (!node || !node.closest) return null;
        if (node.closest('#__flow_paste_bubble__, #flow-my-projects-dock, #flow-saved-projects-backdrop')) return null;
        var direct = node.closest('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="button"]):not([type="submit"]), textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], .ql-editor');
        if (direct) return direct;
        var wrapper = node.closest('rich-textarea, .text-input-field, .input-area, flow-prompt-box, flow-rich-text-editor, [role="textbox"]');
        if (wrapper) {
          var inner = wrapper.querySelector('.ql-editor, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], textarea, input');
          return inner || (wrapper.isContentEditable ? wrapper : null);
        }
        return null;
      }

      function placeCaretAtEnd(ed) {
        try {
          if (!ed || ed.tagName === 'INPUT' || ed.tagName === 'TEXTAREA') return;
          var sel = window.getSelection && window.getSelection();
          if (!sel) return;
          if (sel.rangeCount > 0 && ed.contains(sel.anchorNode)) return;
          var range = document.createRange();
          var targetNode = ed.querySelector('p:last-of-type') || ed;
          range.selectNodeContents(targetNode);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        } catch (e) {}
      }

      function insertTextIntoEditable(ed, rawText) {
        var text = String(rawText == null ? '' : rawText);
        if (!ed || !text) return false;
        try { ed.focus(); } catch (e) {}
        if (ed.tagName === 'INPUT' || ed.tagName === 'TEXTAREA') {
          try {
            var start = typeof ed.selectionStart === 'number' ? ed.selectionStart : (ed.value || '').length;
            var end = typeof ed.selectionEnd === 'number' ? ed.selectionEnd : start;
            var curVal = ed.value || '';
            var nextVal = curVal.slice(0, start) + text + curVal.slice(end);
            var proto = ed.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            var setter = proto && Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
            if (setter) setter.call(ed, nextVal);
            else ed.value = nextVal;
            var nextPos = start + text.length;
            try { ed.setSelectionRange(nextPos, nextPos); } catch (e2) {}
            try { ed.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: text, inputType: 'insertFromPaste' })); }
            catch (e3) { ed.dispatchEvent(new Event('input', { bubbles: true })); }
            ed.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          } catch (e) {}
        }

        placeCaretAtEnd(ed);
        var beforeTxt = (ed.innerText || ed.textContent || '').trim();
        var inserted = false;
        try {
          if (origExecCommand) {
            inserted = origExecCommand('insertText', false, text);
          } else {
            inserted = document.execCommand('insertText', false, text);
          }
        } catch (e) {}
        var afterTxt = (ed.innerText || ed.textContent || '').trim();
        if (!inserted && afterTxt === beforeTxt) {
          try {
            try {
              ed.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: text, inputType: 'insertFromPaste' }));
            } catch (e0) {}
            var p = ed.querySelector('p:last-of-type') || ed;
            if (p !== ed && (p.innerHTML === '<br>' || (p.textContent || '') === '')) {
              p.textContent = text;
            } else {
              p.appendChild(document.createTextNode(text));
            }
            ed.classList.remove('ql-blank');
            placeCaretAtEnd(ed);
            try {
              ed.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: text, inputType: 'insertFromPaste' }));
            } catch (e1) {
              ed.dispatchEvent(new Event('input', { bubbles: true }));
            }
            ed.dispatchEvent(new Event('change', { bubbles: true }));
          } catch (e2) {}
        }
        return true;
      }

      var activePasteBubble = null;
      var activePasteTarget = null;
      var activePasteTouchX = 0;
      var pasteHideTimer = null;

      function hidePasteBubble() {
        if (pasteHideTimer) { clearTimeout(pasteHideTimer); pasteHideTimer = null; }
        if (activePasteBubble) {
          try { activePasteBubble.remove(); } catch (e) {}
          activePasteBubble = null;
        }
        activePasteTarget = null;
      }

      function positionPasteBubble() {
        if (!activePasteBubble || !activePasteTarget || !activePasteTarget.isConnected) return;
        try {
          var box = (activePasteTarget.closest && activePasteTarget.closest('rich-textarea, .text-input-field, .input-area, flow-prompt-box')) || activePasteTarget;
          var r = box.getBoundingClientRect();
          if (r.width < 4 && r.height < 4) r = activePasteTarget.getBoundingClientRect();
          var bubbleW = activePasteBubble.offsetWidth || 96;
          var bubbleH = activePasteBubble.offsetHeight || 40;
          var left = (activePasteTouchX > 0 ? activePasteTouchX : (r.left + r.width / 2)) - bubbleW / 2;
          var maxLeft = Math.max(12, window.innerWidth - bubbleW - 12);
          left = Math.max(12, Math.min(maxLeft, left));
          var top = r.top - bubbleH - 10;
          if (top < 8) top = Math.min(window.innerHeight - bubbleH - 12, r.bottom + 8);
          activePasteBubble.style.left = Math.round(left) + 'px';
          activePasteBubble.style.top = Math.round(top) + 'px';
        } catch (e) {}
      }

      function showPasteBubbleFor(ed, touchX) {
        if (!ed) return;
        var clipTxt = readClipboardFromNative();
        hidePasteBubble();
        activePasteTarget = ed;
        activePasteTouchX = touchX || 0;

        var bubble = document.createElement('div');
        bubble.id = '__flow_paste_bubble__';
        bubble.style.cssText =
          'position:fixed!important;z-index:2147483647!important;display:flex!important;align-items:center!important;gap:2px!important;' +
          'background:#282a2e!important;border:1px solid rgba(255,255,255,0.18)!important;border-radius:999px!important;' +
          'padding:4px 6px!important;box-shadow:0 8px 24px rgba(0,0,0,0.65)!important;font-family:Roboto,system-ui,-apple-system,sans-serif!important;' +
          'user-select:none!important;-webkit-user-select:none!important;';

        var pasteBtn = document.createElement('button');
        pasteBtn.type = 'button';
        pasteBtn.textContent = 'Paste';
        pasteBtn.style.cssText =
          'background:transparent!important;border:none!important;color:#f3f4f6!important;font-size:14px!important;font-weight:500!important;' +
          'padding:6px 14px!important;border-radius:999px!important;cursor:pointer!important;line-height:1.2!important;white-space:nowrap!important;';

        function onPasteAction(ev) {
          ev.preventDefault();
          ev.stopPropagation();
          ev.stopImmediatePropagation();
          var target = activePasteTarget || ed;
          hidePasteBubble();
          var txt = readClipboardFromNative();
          if (txt) {
            insertTextIntoEditable(target, txt);
          } else if (navigator.clipboard && navigator.clipboard.readText) {
            navigator.clipboard.readText().then(function(t) {
              if (t) insertTextIntoEditable(target, t);
            }).catch(function(){});
          }
        }

        pasteBtn.addEventListener('touchstart', function(ev) {
          ev.stopPropagation();
        }, { passive: true });
        pasteBtn.addEventListener('touchend', onPasteAction, false);
        pasteBtn.addEventListener('mousedown', function(ev) {
          ev.preventDefault();
          ev.stopPropagation();
        }, true);
        pasteBtn.addEventListener('click', onPasteAction, true);

        bubble.appendChild(pasteBtn);
        (document.body || document.documentElement).appendChild(bubble);
        activePasteBubble = bubble;
        positionPasteBubble();
        setTimeout(positionPasteBubble, 110);
        setTimeout(positionPasteBubble, 240);
        setTimeout(positionPasteBubble, 420);
        pasteHideTimer = setTimeout(hidePasteBubble, 7500);
      }

      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', positionPasteBubble);
        window.visualViewport.addEventListener('scroll', positionPasteBubble);
      }
      window.addEventListener('resize', positionPasteBubble);
      document.addEventListener('keydown', function() {
        if (activePasteBubble) hidePasteBubble();
      }, true);

      var touchStartInfo = null;
      var longPressTimer = null;

      document.addEventListener('touchstart', function(ev) {
        try {
          var t = ev.target;
          if (activePasteBubble && t && t.closest && t.closest('#__flow_paste_bubble__')) {
            return;
          }
          if (activePasteBubble) {
            hidePasteBubble();
          }
          var ed = findEditableTarget(t);
          if (!ed) {
            touchStartInfo = null;
            if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
            return;
          }
          var touch = ev.touches && ev.touches[0];
          var tx = touch ? touch.clientX : 0;
          var ty = touch ? touch.clientY : 0;
          touchStartInfo = { ed: ed, x: tx, y: ty, time: Date.now(), longPressed: false };
          if (longPressTimer) clearTimeout(longPressTimer);
          longPressTimer = setTimeout(function() {
            if (!touchStartInfo) return;
            touchStartInfo.longPressed = true;
            try { touchStartInfo.ed.focus(); } catch (e) {}
            showPasteBubbleFor(touchStartInfo.ed, touchStartInfo.x);
          }, 380);
        } catch (e) {}
      }, { capture: true, passive: true });

      document.addEventListener('touchmove', function(ev) {
        if (!touchStartInfo || !longPressTimer) return;
        var touch = ev.touches && ev.touches[0];
        if (!touch) return;
        if (Math.abs(touch.clientX - touchStartInfo.x) > 18 || Math.abs(touch.clientY - touchStartInfo.y) > 18) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      }, { capture: true, passive: true });

      document.addEventListener('touchend', function(ev) {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
        if (!touchStartInfo) return;
        var info = touchStartInfo;
        touchStartInfo = null;
        var elapsed = Date.now() - info.time;
        if (info.longPressed || elapsed < 380) {
          // Ensure editable field keeps focus across the 95ms deferred Android IME inset resize
          var ed = info.ed;
          try { if (document.activeElement !== ed) ed.focus(); } catch (e) {}
          setTimeout(function() {
            try { if (ed && ed.isConnected && document.activeElement !== ed) ed.focus(); } catch (e) {}
            if (info.longPressed) positionPasteBubble();
          }, 115);
          setTimeout(function() {
            try { if (ed && ed.isConnected && document.activeElement !== ed) ed.focus(); } catch (e) {}
            if (info.longPressed) positionPasteBubble();
          }, 230);
        }
      }, { capture: true, passive: true });

      document.addEventListener('touchcancel', function() {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
        touchStartInfo = null;
      }, { capture: true, passive: true });

      document.addEventListener('contextmenu', function(ev) {
        try {
          var ed = findEditableTarget(ev.target);
          if (!ed) return;
          try { ed.focus(); } catch (e) {}
          showPasteBubbleFor(ed, ev.clientX || 0);
        } catch (e) {}
      }, true);
    } catch (e) {}
  }
})();
""".trimIndent()
}
