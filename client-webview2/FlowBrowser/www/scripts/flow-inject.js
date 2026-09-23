/* WebView2 bridge — replaces Electron ipcRenderer */
(function () {
  if (typeof window.chrome === 'undefined' || !window.chrome.webview) {
    console.warn('[Flow Inject] chrome.webview missing');
  }
  const handlers = Object.create(null);
  function post(msg) {
    try { window.chrome.webview.postMessage(JSON.stringify(msg)); } catch (e) {}
  }
  try {
    window.chrome.webview.addEventListener('message', (ev) => {
      let msg = ev.data;
      try { if (typeof msg === 'string') msg = JSON.parse(msg); } catch (e) { return; }
      if (!msg || msg.type !== 'toGuest') return;
      const fn = handlers[msg.channel];
      if (typeof fn === 'function') {
        try { fn(null, msg.data); } catch (e) { console.error(e); }
      }
    });
  } catch (e) {}
  window.ipcRenderer = {
    sendToHost(channel, data) {
      post({ type: 'toHost', channel: channel, data: data === undefined ? null : data });
    },
    on(channel, listener) {
      handlers[channel] = listener;
    },
    send() {},
    invoke() { return Promise.resolve(null); }
  };
})();
const { ipcRenderer } = window;

if (window.__flowInjectBootstrapped) {
  console.warn('[Flow Inject] duplicate inject skipped');
} else {
  window.__flowInjectBootstrapped = true;

// =========================================================================
// MASKING RULES & CREDENTIALS STATE
// =========================================================================

const TARGET_MODEL_DISPLAY = "Veo 3.1 - Fast";
const TARGET_MODEL_SHORT = "Fast";

let maskingRules = {
  modelRenames: [],
  cssSelectorsToHide: [],
  customCss: ''
};

let credentials = {
  email: '',
  password: '',
  targetUrl: 'https://flow.google.com'
};

let autoLoginState = {
  emailFilled: false,
  emailSubmitted: false,
  passwordFilled: false,
  passwordSubmitted: false,
  lastActionTime: 0,
  actionCooldownMs: 800,
  attempts: 0,
  flowLandingSeenAt: 0,
  done: false,
  submittedKeys: new Set(),
  pathSeenAt: {},
  lastPath: '',
  pwdUiReloadTried: false,
  otpRequested: false,
  otpFilled: false,
  captchaPaused: false,
  captchaHits: 0,
  captchaMisses: 0,
  overlayDismissed: false,
  lastHostNotify: '',
};

/** DEBUG: fill email/password/OTP only — never auto-click Next / 2FA rows. */
const DEBUG_FILL_ONLY = false;

// =========================================================================
// IMMEDIATE SAFETY & PROTECTION STYLES
// =========================================================================

// Kill any fatal lock or cleanup overlays from third-party extensions
const killOverlayStyle = document.createElement('style');
killOverlayStyle.textContent = `
  #__flow_fatal_lock__, #__flow_cleanup_overlay__ {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
    z-index: -999999 !important;
  }
`;
if (document.head) document.head.appendChild(killOverlayStyle);
else document.addEventListener('DOMContentLoaded', () => document.head && document.head.appendChild(killOverlayStyle));

const lockKillerObserver = new MutationObserver(() => {
  const f = document.getElementById('__flow_fatal_lock__');
  if (f) f.remove();
  const c = document.getElementById('__flow_cleanup_overlay__');
  if (c) c.remove();
});
if (document.documentElement) {
  lockKillerObserver.observe(document.documentElement, { childList: true, subtree: true });
} else {
  document.addEventListener('DOMContentLoaded', () => {
    lockKillerObserver.observe(document.documentElement, { childList: true, subtree: true });
  });
}

// Disable context menu
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
}, true);

// Block developer shortcut keys
window.addEventListener('keydown', (e) => {
  if (
    e.key === 'F12' ||
    (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c')) ||
    (e.ctrlKey && (e.key === 'u' || e.key === 'U'))
  ) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

// =========================================================================
// CREDIT TRACKING & GENERATION INTERCEPTOR ENGINE
// Requirement:
// Deduct 5 credits for each successful image generated
// Deduct 10 credits for each successful video generated
// =========================================================================

const processedGenerationIds = new Set();
let pendingGeneration = null;

function getActivePromptMode() {
  try {
    const allButtons = Array.from(document.querySelectorAll('button, [role="tab"], [role="radio"]'));
    const imgBtn = allButtons.find(b => {
      const t = (b.innerText || b.textContent || '').trim().toLowerCase();
      return t === 'image' || t === 'images';
    });
    const vidBtn = allButtons.find(b => {
      const t = (b.innerText || b.textContent || '').trim().toLowerCase();
      return t === 'video' || t === 'videos';
    });

    if (imgBtn && vidBtn) {
      const imgStyle = window.getComputedStyle(imgBtn);
      const vidStyle = window.getComputedStyle(vidBtn);

      const imgIsActive = imgBtn.getAttribute('aria-selected') === 'true' ||
                          imgBtn.getAttribute('aria-pressed') === 'true' ||
                          imgBtn.classList.contains('active') ||
                          imgBtn.classList.contains('selected') ||
                          imgStyle.backgroundColor.includes('255, 255, 255') ||
                          imgStyle.color === 'rgb(0, 0, 0)' ||
                          imgStyle.color === '#000000';

      const vidIsActive = vidBtn.getAttribute('aria-selected') === 'true' ||
                          vidBtn.getAttribute('aria-pressed') === 'true' ||
                          vidBtn.classList.contains('active') ||
                          vidBtn.classList.contains('selected') ||
                          vidStyle.backgroundColor.includes('255, 255, 255') ||
                          vidStyle.color === 'rgb(0, 0, 0)' ||
                          vidStyle.color === '#000000';

      if (imgIsActive && !vidIsActive) return 'image';
      if (vidIsActive && !imgIsActive) return 'video';
    }

    // Video-specific controls in the settings overlay (Frames, Ingredients, 360p, duration)
    const hasVideoSpecificControls = allButtons.some(b => {
      const t = (b.innerText || b.textContent || '').trim().toLowerCase();
      return t === 'frames' || t === 'ingredients' || t === '360p' || t === '720p' || t === '4s' || t === '6s' || t === '8s' || t === '10s';
    });
    if (hasVideoSpecificControls) return 'video';

    // Image-specific controls in the settings overlay (4:3 or 3:4 aspect ratio)
    const hasImageSpecificControls = allButtons.some(b => {
      const t = (b.innerText || b.textContent || '').trim();
      return t === '4:3' || t === '3:4';
    });
    if (hasImageSpecificControls) return 'image';

  } catch (e) {}

  const domText = getActiveDomModelText().toLowerCase();
  if (domText.includes('banana') || domText.includes('nano')) return 'image';
  if (domText.includes('veo') || domText.includes('omni')) return 'video';

  return 'video';
}

function getActiveBatchMultiplier() {
  try {
    const multipliers = Array.from(document.querySelectorAll('button, [role="radio"], [role="tab"]')).filter(b => {
      const t = (b.innerText || b.textContent || '').trim().toLowerCase();
      return /^x[1-4]$/.test(t);
    });

    for (const b of multipliers) {
      const t = (b.innerText || b.textContent || '').trim().toLowerCase();
      const style = window.getComputedStyle(b);
      const isSelected = b.getAttribute('aria-checked') === 'true' ||
                         b.getAttribute('aria-selected') === 'true' ||
                         b.classList.contains('active') ||
                         b.classList.contains('selected') ||
                         (style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)' && !style.backgroundColor.includes('transparent'));
      if (isSelected) {
        const num = parseInt(t.replace('x', ''), 10);
        if (!isNaN(num) && num >= 1 && num <= 4) return num;
      }
    }
  } catch (e) {}
  return 1;
}

function getActiveDomModelText() {
  try {
    const candidates = document.querySelectorAll(`
      [data-testid*="model-picker"] button,
      [data-testid*="model-select"],
      flow-model-picker button,
      button[aria-haspopup="listbox"],
      button[aria-haspopup="menu"],
      .model-pill.active,
      [aria-label*="model" i]
    `);
    for (const el of candidates) {
      const txt = (el.innerText || el.textContent || '').trim();
      if (txt && (txt.includes('Banana') || txt.includes('Veo') || txt.includes('Nano') || txt.includes('Fast') || txt.includes('Pro') || txt.includes('Lite'))) {
        return txt;
      }
    }
  } catch (e) {}
  return '';
}

function getGenerationModelDetails(forceType = '', modelHint = '', requestBodyText = '', data = null) {
  const reqStr = (
    (modelHint || '') + ' ' + 
    (requestBodyText || '') + ' ' + 
    (data?.model || '') + ' ' + 
    (data?.metadata?.model || '') + ' ' +
    (data?.metadata?.modelName || '') + ' ' +
    (data?.response?.model || '')
  ).toLowerCase();

  const domModelStr = getActiveDomModelText().toLowerCase();
  let activeMode = forceType;
  if (!activeMode) {
    if (reqStr.includes('video') || reqStr.includes('veo')) {
      activeMode = 'video';
    } else if (reqStr.includes('image') || reqStr.includes('banana') || reqStr.includes('imagen')) {
      activeMode = 'image';
    } else {
      activeMode = getActivePromptMode();
    }
  }

  if (activeMode === 'video') {
    return { type: 'video', modelName: 'Veo 3.1 - Fast', rate: 10 };
  }

  // Active mode is IMAGE:
  const imageSearchStr = reqStr + ' ' + domModelStr;
  
  // 1. Nano Banana Pro -> 8 credits
  if (imageSearchStr.includes('banana pro') || imageSearchStr.includes('nano banana pro') || imageSearchStr.includes('banana-pro') || imageSearchStr.includes('pro')) {
    return { type: 'image', modelName: 'Nano Banana Pro', rate: 8 };
  }

  // 2. Nano Banana Lite / Nano Banana 2 Lite -> 3 credits
  if (imageSearchStr.includes('banana lite') || imageSearchStr.includes('banana 2 lite') || imageSearchStr.includes('nano banana lite') || imageSearchStr.includes('nano banana 2 lite') || imageSearchStr.includes('banana-lite') || imageSearchStr.includes('lite')) {
    return { type: 'image', modelName: 'Nano Banana Lite', rate: 3 };
  }

  // 3. Nano Banana 2 -> 5 credits
  return { type: 'image', modelName: 'Nano Banana 2', rate: 5 };
}

function showGenerationToast(type, modelName, amount, count) {
  try {
    let toast = document.getElementById('flow-generation-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'flow-generation-toast';
      toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: #111827;
        border: 1px solid rgba(56, 189, 248, 0.4);
        color: #f3f4f6;
        padding: 10px 16px;
        border-radius: 8px;
        font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
        z-index: 2147483647;
        box-shadow: 0 10px 25px rgba(0,0,0,0.5);
        transition: opacity 0.3s ease, transform 0.3s ease;
        pointer-events: none;
      `;
      (document.body || document.documentElement).appendChild(toast);
    }
    const label = type === 'video' ? `${count} Video(s)` : `${count} Image(s)`;
    toast.innerHTML = `
      <span style="color:#38bdf8;font-size:15px;">Ã¢Å¡Â¡</span>
      <span>${modelName || label}</span>
      <span style="background:rgba(239, 68, 68, 0.2); color:#f87171; padding:2px 8px; border-radius:4px; font-size:12px; margin-left:4px;">-${amount} Credits</span>
    `;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';

    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
    }, 3500);
  } catch (err) {
    console.error('[Flow Toast Error]', err);
  }
}

function deductCredits(modelDetails, count = 1, uniqueId = '') {
  if (uniqueId && processedGenerationIds.has(uniqueId)) {
    return; // Prevent duplicate billing for the same media item
  }
  if (uniqueId) {
    processedGenerationIds.add(uniqueId);
  }

  const effectiveCount = Math.max(1, count || 1);
  const { type, modelName, rate } = modelDetails;
  const totalAmount = rate * effectiveCount;
  const reason = `${modelName}: Generated ${effectiveCount} ${type}(s) (${rate} cr/ea)`;

  console.log(`[Flow Credit Engine] Deducting ${totalAmount} credits for ${effectiveCount} ${type}(s) using ${modelName}. Reason: ${reason}`);

  // Send IPC message to Flow Browser app-shell (which calls server /api/v2/client/use-credit)
  ipcRenderer.sendToHost('credit:deduct', {
    amount: totalAmount,
    count: effectiveCount,
    type,
    modelName,
    reason
  });

  // Display user HUD notification
  showGenerationToast(type, modelName, totalAmount, effectiveCount);
}

// Analyze response data from Google Flow to detect generation completion
function inspectDataForGenerations(url, data, requestBodyText = '') {
  if (!data) return;

  const urlLower = (url || '').toLowerCase();
  const reqLower = (requestBodyText || '').toLowerCase();

  // Check if this is a generation endpoint
  const isGenerationEndpoint =
    urlLower.includes('batchgenerate') ||
    urlLower.includes('batch_generate') ||
    urlLower.includes('generatevideo') ||
    urlLower.includes('generateimage') ||
    urlLower.includes('aisandbox') ||
    urlLower.includes('operations/') ||
    reqLower.includes('batchgenerate') ||
    reqLower.includes('generate');

  // If this is a project listing or account query, NEVER deduct credits
  const isListingEndpoint =
    urlLower.includes('listprojects') ||
    urlLower.includes('listmedia') ||
    urlLower.includes('/projects?') ||
    urlLower.includes('userinfo') ||
    urlLower.includes('session');

  if (isListingEndpoint) return;

  const isVideo = urlLower.includes('video') || urlLower.includes('veo') || reqLower.includes('video') || reqLower.includes('veo');
  const isImage = urlLower.includes('image') || urlLower.includes('imagen') || urlLower.includes('banana') || reqLower.includes('image') || reqLower.includes('imagen') || reqLower.includes('banana');

  const hasPending = pendingGeneration && !pendingGeneration.billed && (Date.now() - pendingGeneration.timestamp < 300000);

  // If no pending generation, only proceed if this is an explicit generation endpoint returning media
  if (!hasPending && !isGenerationEndpoint) {
    return;
  }

  const modelDetails = hasPending ? pendingGeneration.modelDetails : getGenerationModelDetails(isVideo ? 'video' : (isImage ? 'image' : ''));
  const multiplier = hasPending ? (pendingGeneration.multiplier || 1) : 1;

  // 1. Direct video array or object
  if (data.generatedVideos && Array.isArray(data.generatedVideos) && data.generatedVideos.length > 0) {
    const validVideos = data.generatedVideos.filter(v => v && (v.id || v.video || v.uri || v.url || v.encodedVideo));
    const count = validVideos.length || data.generatedVideos.length || multiplier;
    const uid = data.operationId || data.id || validVideos[0]?.id || validVideos[0]?.uri || (url + '_' + Date.now());
    if (hasPending) pendingGeneration.billed = true;
    deductCredits(modelDetails || getGenerationModelDetails('video', '', requestBodyText, data), count, uid);
    return;
  }
  if (data.videos && Array.isArray(data.videos) && data.videos.length > 0) {
    const validVideos = data.videos.filter(v => v && (v.id || v.video || v.uri || v.url || v.encodedVideo));
    const count = validVideos.length || data.videos.length || multiplier;
    const uid = data.operationId || data.id || validVideos[0]?.id || validVideos[0]?.uri || (url + '_' + Date.now());
    if (hasPending) pendingGeneration.billed = true;
    deductCredits(modelDetails || getGenerationModelDetails('video', '', requestBodyText, data), count, uid);
    return;
  }

  // 2. Direct image array or object
  if (data.generatedImages && Array.isArray(data.generatedImages) && data.generatedImages.length > 0) {
    const validImages = data.generatedImages.filter(img => img && (img.id || img.image || img.uri || img.url || img.encodedImage));
    const count = validImages.length || data.generatedImages.length || multiplier;
    const uid = data.operationId || data.id || validImages[0]?.id || validImages[0]?.uri || (url + '_' + Date.now());
    if (hasPending) pendingGeneration.billed = true;
    deductCredits(modelDetails || getGenerationModelDetails('image', '', requestBodyText, data), count, uid);
    return;
  }
  if (data.images && Array.isArray(data.images) && data.images.length > 0) {
    const validImages = data.images.filter(img => img && (img.id || img.image || img.uri || img.url || img.encodedImage));
    const count = validImages.length || data.images.length || multiplier;
    const uid = data.operationId || data.id || validImages[0]?.id || validImages[0]?.uri || (url + '_' + Date.now());
    if (hasPending) pendingGeneration.billed = true;
    deductCredits(modelDetails || getGenerationModelDetails('image', '', requestBodyText, data), count, uid);
    return;
  }

  // 3. Long running operations (LRO) checking: { done: true, response: { ... } }
  if (data.done === true && (data.response || data.metadata || data.name)) {
    const opName = data.name || data.id || (url + '_op');
    const resp = data.response || {};
    const meta = data.metadata || {};

    if (resp.generatedVideos || resp.videos || meta.videoMetadata || isVideo) {
      const vids = resp.generatedVideos || resp.videos || [1];
      const count = Array.isArray(vids) ? vids.length : multiplier;
      if (hasPending) pendingGeneration.billed = true;
      deductCredits(modelDetails || getGenerationModelDetails('video', '', requestBodyText, data), count, opName);
      return;
    }

    if (resp.generatedImages || resp.images || meta.imageMetadata || isImage) {
      const imgs = resp.generatedImages || resp.images || [1];
      const count = Array.isArray(imgs) ? imgs.length : multiplier;
      if (hasPending) pendingGeneration.billed = true;
      deductCredits(modelDetails || getGenerationModelDetails('image', '', requestBodyText, data), count, opName);
      return;
    }
  }

  // 4. Output media response
  if (data.mediaUri || data.videoUri || data.videoUrl) {
    const uid = data.id || data.mediaUri || data.videoUri || data.videoUrl;
    if (hasPending) pendingGeneration.billed = true;
    deductCredits(modelDetails || getGenerationModelDetails('video', '', requestBodyText, data), multiplier, uid);
    return;
  }

  if (data.imageUri || data.imageUrl || data.encodedImage) {
    const uid = data.id || data.imageUri || data.imageUrl;
    if (hasPending) pendingGeneration.billed = true;
    deductCredits(modelDetails || getGenerationModelDetails('image', '', requestBodyText, data), multiplier, uid);
    return;
  }
}

// Hook generate button click and Enter key to capture generation intent
function setupGenerateActionHook() {
  function onGenerateTriggered(source = '') {
    const hostname = window.location.hostname;
    if (hostname.includes('accounts.google.com') || window.location.pathname.includes('/about')) {
      return;
    }
    const mode = getActivePromptMode();
    const multiplier = getActiveBatchMultiplier();
    const details = getGenerationModelDetails(mode);

    pendingGeneration = {
      modelDetails: details,
      multiplier: multiplier,
      timestamp: Date.now(),
      billed: false,
      source: source
    };

    console.log('[Flow Credit Engine] Generation action initiated:', mode, details.modelName, 'Multiplier:', multiplier, 'Source:', source);
  }

  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest && e.target.closest('button, [role="button"], a[role="button"]');
    if (!btn) return;

    const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();

    // Ignore settings buttons (aspect ratio, duration, model selector, etc.)
    if (
      txt.includes('16:9') || txt.includes('9:16') || txt.includes('1:1') ||
      txt.includes('720p') || txt.includes('1080p') ||
      txt.includes('8s') || txt.includes('4s') ||
      /^x[1-4]$/.test(txt) ||
      txt === 'image' || txt === 'video' ||
      txt === 'frames' || txt === 'ingredients' ||
      btn.getAttribute('aria-label') === 'Select model family' ||
      btn.closest('.prompt-settings-pill, flow-model-picker')
    ) {
      return;
    }

    const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
    const title = (btn.getAttribute('title') || '').toLowerCase();
    const isSubmitType = btn.getAttribute('type') === 'submit';

    // Check if it's inside prompt area
    const inPromptArea = btn.closest('.prompt-box, form, [class*="prompt"], flow-prompt-box, [class*="action-bar"], .gen-actions, .input-container') !== null;

    // Check if it has send/arrow/generate icon or text
    const hasIcon = btn.querySelector('svg, polygon, mat-icon, [data-icon], [class*="send"], [class*="arrow"]') !== null;
    const matchesKeyword =
      txt.includes('generate') || txt.includes('create') || txt.includes('run') || txt.includes('send') || txt.includes('submit') ||
      aria.includes('generate') || aria.includes('create') || aria.includes('send') || aria.includes('submit') ||
      title.includes('generate') || title.includes('send') || title.includes('create') || title.includes('submit');

    if (matchesKeyword || isSubmitType || (inPromptArea && (hasIcon || !txt))) {
      onGenerateTriggered('click:' + (aria || txt || 'prompt-btn'));
    }
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      const active = document.activeElement;
      if (
        active &&
        (active.tagName === 'TEXTAREA' ||
         active.tagName === 'INPUT' ||
         active.getAttribute('contenteditable') === 'true' ||
         active.closest('form, [class*="prompt"], [class*="input"], flow-prompt-box'))
      ) {
        onGenerateTriggered('enter-key');
      }
    }
  }, true);
}

// Main World network hooks (WebView2 has no Electron webRequest bridge by default)
(function installNetworkCreditHooks() {
  try {
    const looksGen = (url) => {
      const u = String(url || '').toLowerCase();
      return (
        u.includes('batchgenerate') ||
        u.includes('batch_generate') ||
        u.includes('generatevideo') ||
        u.includes('generateimage') ||
        u.includes('aisandbox') ||
        u.includes('/operations/')
      );
    };

    const fireCompleted = (url) => {
      if (!looksGen(url)) return;
      try {
        if (pendingGeneration && !pendingGeneration.billed) {
          console.log('[Flow Credit Engine] Generation network (fetch/xhr):', url);
          const details = pendingGeneration.modelDetails;
          const count = pendingGeneration.multiplier || 1;
          pendingGeneration.billed = true;
          deductCredits(details, count, url + '_' + Date.now());
        }
      } catch (e) {}
    };

    if (window.fetch) {
      const origFetch = window.fetch.bind(window);
      window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        return origFetch(input, init).then((res) => {
          try { if (res && res.ok) fireCompleted(url); } catch (e) {}
          return res;
        });
      };
    }

    const XO = window.XMLHttpRequest;
    if (XO && XO.prototype) {
      const open = XO.prototype.open;
      const send = XO.prototype.send;
      XO.prototype.open = function (method, url) {
        this.__flowUrl = url;
        return open.apply(this, arguments);
      };
      XO.prototype.send = function () {
        this.addEventListener('load', () => {
          try {
            if (this.status >= 200 && this.status < 300) fireCompleted(this.__flowUrl);
          } catch (e) {}
        });
        return send.apply(this, arguments);
      };
    }
  } catch (e) {
    console.warn('[Flow Credit Engine] network hooks failed', e);
  }
})();

// IPC Listener from Electron / WebView2 host WebRequest Monitor
ipcRenderer.on('flow:generation-network-completed', (event, info) => {
  if (pendingGeneration && !pendingGeneration.billed) {
    console.log('[Flow Credit Engine] Generation network completion received from main process:', info && info.url);
    const details = pendingGeneration.modelDetails;
    const count = pendingGeneration.multiplier || 1;
    pendingGeneration.billed = true;
    deductCredits(details, count, (info && info.url ? info.url : 'net') + '_' + Date.now());
  }
});

// DOM Canvas Card & Video Watcher Engine
const seenMediaElements = new Set();
let pageInitialLoadDone = false;
let lastKnownPathname = window.location.pathname;

function markInitialMediaAsSeen() {
  try {
    const items = document.querySelectorAll(`
      video,
      img[src*="blob:"],
      img[src*="googleusercontent"],
      [data-testid*="media"],
      [class*="media-card"],
      flow-media-card,
      flow-video-card,
      .media-item
    `);
    items.forEach(el => {
      const k = getMediaCardIdentifier(el);
      if (k) seenMediaElements.add(k);
    });
  } catch (e) {}
}

function getMediaCardIdentifier(el) {
  if (!el) return '';
  return el.getAttribute('data-id') ||
         el.getAttribute('data-media-id') ||
         el.id ||
         el.currentSrc ||
         el.src ||
         el.querySelector('video')?.currentSrc ||
         el.querySelector('video')?.src ||
         el.querySelector('img')?.src ||
         (el.innerText && el.innerText.trim().slice(0, 50)) ||
         '';
}

function checkForNewGeneratedMedia() {
  // Check if user navigated to a different project or page
  if (window.location.pathname !== lastKnownPathname) {
    lastKnownPathname = window.location.pathname;
    pageInitialLoadDone = false;
    setTimeout(() => {
      markInitialMediaAsSeen();
      pageInitialLoadDone = true;
    }, 2500);
    return;
  }

  if (!pageInitialLoadDone) return;

  const currentMode = getActivePromptMode();

  // Find all cards or video elements
  const allCards = document.querySelectorAll(`
    flow-media-card,
    flow-video-card,
    [data-testid*="media-card"],
    [data-testid*="video-card"],
    [class*="media-card"],
    .media-item,
    video
  `);

  for (const card of allCards) {
    const id = getMediaCardIdentifier(card);
    if (!id || seenMediaElements.has(id)) continue;

    // Found an unseen media card in the DOM!
    seenMediaElements.add(id);

    // Is it a video or image?
    const hasVideo = card.tagName === 'VIDEO' ||
                     card.querySelector('video') !== null ||
                     card.querySelector('[data-icon*="play"], svg polygon, .play-button') !== null ||
                     (card.innerText || '').toLowerCase().includes('video');

    if (hasVideo) {
      console.log('[Flow Credit Engine] New video element detected on canvas:', id);
      const modelDetails = (pendingGeneration && pendingGeneration.modelDetails) || { type: 'video', modelName: 'Veo 3.1 - Fast', rate: 10 };
      const multiplier = (pendingGeneration && pendingGeneration.multiplier) || 1;
      if (pendingGeneration) pendingGeneration.billed = true;
      deductCredits(modelDetails, multiplier, id);
      return;
    } else if (currentMode === 'image' || (pendingGeneration && pendingGeneration.modelDetails?.type === 'image')) {
      console.log('[Flow Credit Engine] New image element detected on canvas:', id);
      const modelDetails = (pendingGeneration && pendingGeneration.modelDetails) || getGenerationModelDetails('image');
      const multiplier = (pendingGeneration && pendingGeneration.multiplier) || 1;
      if (pendingGeneration) pendingGeneration.billed = true;
      deductCredits(modelDetails, multiplier, id);
      return;
    }
  }
}

// Initial settle timer
setTimeout(() => {
  markInitialMediaAsSeen();
  pageInitialLoadDone = true;
}, 3000);

// Initialize hooks immediately
setupGenerateActionHook();

// =========================================================================
// MODEL ENGINE (locking/renaming disabled — show all Google Flow models)
// =========================================================================

function isLowerPriorityOption(text, el) {
  if (el && el.getAttribute && el.getAttribute('data-is-lower-priority') === 'true') {
    return true;
  }
  if (!text) return false;
  const t = text.toLowerCase();
  // NEVER treat Nano Banana or image models as Veo lower priority!
  if (t.includes("banana") || t.includes("nano") || t.includes("imagen")) {
    return false;
  }
  return (
    t.includes("lower priority") ||
    t.includes("[lower priority]") ||
    t.includes("(lower priority)") ||
    t.includes("lite [lower priority]") ||
    t.includes("fast [lower priority]") ||
    t.includes("veo 3.1 - fast") ||
    t.includes("veo 3.1 - lite") ||
    t.includes("veo 3.1 lite") ||
    t.includes("veo fast") ||
    (t.includes("fast") && t.includes("veo")) ||
    (t.trim() === 'fast' && (el?.getAttribute('data-is-veo-model') === 'true' || getActivePromptMode() === 'video')) ||
    (t.trim() === 'lite' && (el?.getAttribute('data-is-veo-model') === 'true' || getActivePromptMode() === 'video'))
  );
}

function isOtherModelOption(text, el) {
  if (!text) return false;
  const t = text.toLowerCase().trim();

  // If this element has been stamped as lower priority, keep it!
  if (el && el.getAttribute && el.getAttribute('data-is-lower-priority') === 'true') {
    return false;
  }

  if (isLowerPriorityOption(text, el)) {
    return false;
  }

  // ALL IMAGE MODELS MUST ALWAYS BE VISIBLE AND SELECTABLE!
  if (
    t.includes('banana') ||
    t.includes('nano') ||
    t.includes('imagen') ||
    t.includes('image')
  ) {
    return false; // NEVER HIDE IMAGE MODELS!
  }

  // Navigation, tools, settings, UI buttons must NEVER be hidden or treated as a model option!
  if (
    t.includes('all media') ||
    t.includes('videos') ||
    t.includes('characters') ||
    t.includes('scenes') ||
    t.includes('tools') ||
    t.includes('project') ||
    t.includes('new project') ||
    t.includes('library') ||
    t.includes('home') ||
    t.includes('settings') ||
    t.includes('share') ||
    t.includes('export') ||
    t.includes('download') ||
    t.includes('delete') ||
    t.includes('rename') ||
    t.includes('duplicate') ||
    t.includes('aspect') ||
    t.includes('duration') ||
    t.includes('resolution') ||
    t.includes('16:9') || t.includes('9:16') || t.includes('1:1') || t.includes('4:3') ||
    t.includes('720p') || t.includes('1080p') ||
    /^x[1-4]$/i.test(t) || /^[468]s$/i.test(t) ||
    t === 'frames' || t === 'ingredients'
  ) {
    return false;
  }

  // Strictly VIDEO models that should be hidden (so ONLY Veo 3.1 Lite Lower Priority remains):
  return (
    t.includes('omni') ||
    t.includes('quality') ||
    t.includes('flash') ||
    t.includes('veo 2') ||
    t.includes('veo 1') ||
    t.includes('gemini') ||
    t.includes('veo 3.1 - quality') ||
    t.includes('veo 3.1 quality') ||
    (t.includes('veo') && !t.includes('lite') && !t.includes('lower priority'))
  );
}

// Model renaming removed — show original Google Flow labels
function renameLowerPriorityText(_element) {}

function isSettingsOverlayPanel(el) {
  if (!el) return false;
  const txt = (el.innerText || el.textContent || '').trim();
  return (
    txt.includes('16:9') ||
    txt.includes('9:16') ||
    txt.includes('1:1') ||
    txt.includes('4:3') ||
    txt.includes('3:4') ||
    txt.includes('720p') ||
    txt.includes('1080p') ||
    txt.includes('Frames') ||
    txt.includes('Ingredients') ||
    txt.includes('Nano Banana') ||
    txt.includes('Veo') ||
    (txt.includes('8s') && (txt.includes('x1') || txt.includes('x2') || txt.includes('x4'))) ||
    el.querySelector('[aria-label*="16:9" i], [aria-label*="9:16" i], [aria-label*="1:1" i]') !== null
  );
}

function dismissVideoModelMenus() {
  // Model items are individually filtered via isOtherModelOption to avoid hiding navigation panels
}

function enforceModelRestrictions() {
  // Model locking disabled — leave Google Flow model picker alone
}

function autoSelectLowerPriorityModel() {
  // Auto-switch to Lite disabled — user can pick any model
}

// =========================================================================
// GOOGLE AUTO-LOGIN Ã¢â‚¬â€ fill/submit patterned on Veo Shio v1.5.15 automation.js
// =========================================================================

function fillInputValue(inputEl, value) {
  if (!inputEl || value == null) return false;
  const str = String(value);
  if (!str) return false;
  try { inputEl.removeAttribute('readonly'); inputEl.readOnly = false; } catch (e) {}
  try { inputEl.focus({ preventScroll: true }); } catch (e) { try { inputEl.focus(); } catch (e2) {} }
  try { inputEl.click(); } catch (e) {}
  try { inputEl.select?.(); } catch (e) {}

  const proto = window.HTMLInputElement && window.HTMLInputElement.prototype;
  const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(inputEl, str);
  else inputEl.value = str;

  try {
    inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: str, inputType: 'insertText' }));
  } catch (e) {
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  }
  inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  try {
    inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
  } catch (e) {}
  return (inputEl.value || '') === str || (inputEl.value || '').includes(str);
}

function isElementVisible(el) {
  if (!el || el.getClientRects?.().length === 0) return false;
  for (let cur = el; cur; cur = cur.parentElement) {
    if (cur !== el && (cur.hidden || cur.getAttribute?.('hidden') != null || cur.getAttribute?.('aria-hidden') === 'true')) return false;
    try {
      const style = window.getComputedStyle(cur);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
      // Don't treat opacity:0 ancestors as invisible forever (Google animates forms)
    } catch (e) {}
  }
  return el.hidden !== true && el.getAttribute?.('aria-disabled') !== 'true' && !el.disabled;
}

function buttonByLabel(pattern) {
  return Array.from(document.querySelectorAll('button, [role="button"], a[href], [role="link"]'))
    .filter(isElementVisible)
    .find(el => {
      const text = (el.getAttribute?.('aria-label') || el.innerText || el.textContent || '')
        .replace(/\b[a-z]+(?:_[a-z]+)+\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return pattern.test(text);
    });
}

function hardClick(el) {
  if (!el) return false;
  try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
  try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) {} }
  const rect = el.getBoundingClientRect?.();
  const cx = rect ? rect.left + Math.min(Math.max(rect.width / 2, 8), 40) : 0;
  const cy = rect ? rect.top + rect.height / 2 : 0;
  const base = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0, buttons: 1 };
  for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    try {
      if (type.startsWith('pointer')) el.dispatchEvent(new PointerEvent(type, { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
      else el.dispatchEvent(new MouseEvent(type, base));
    } catch (e) {}
  }
  try { el.click(); } catch (e) {}
  try {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  } catch (e) {}
  return true;
}

function clickOnce(key, el) {
  if (DEBUG_FILL_ONLY) return false;
  if (!el || !isElementVisible(el) || autoLoginState.submittedKeys.has(key)) return false;
  autoLoginState.submittedKeys.add(key);
  autoLoginState.lastActionTime = Date.now();
  // Prefer trusted CDP click for 2FA rows (Glif ignores synthetic events)
  try {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x > 0 && y > 0) {
      ipcRenderer.sendToHost('cdp-click', { x, y });
    }
  } catch (e) {}
  hardClick(el);
  return true;
}

function clickElement(el) {
  hardClick(el);
}

/** Google 2FA challenge row for Authenticator / TOTP */
function findAuthenticatorOption() {
  const isAuthText = (raw) => {
    const t = String(raw || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!t || t.length > 180) return false;
    // Must look like THIS option alone — not a parent that lists every method
    if (/one-time security code|security key|tap yes|use your passkey|try another way|phone or tablet|eligible device/.test(t) &&
        !/authenticator/.test(t)) return false;
    if (/one-time security code|tap yes on your phone|use your passkey|can.?t find an eligible/.test(t)) return false;
    return (
      /google authenticator/.test(t) ||
      (/authenticator app/.test(t) && /code|verification/.test(t)) ||
      (/verification code/.test(t) && /authenticator/.test(t)) ||
      (/code from/.test(t) && /authenticator/.test(t))
    );
  };

  // Prefer dedicated challenge nodes (Google Glif)
  const preferred = Array.from(document.querySelectorAll(
    '[data-challengeid], [data-challengetype], [data-action="selectchallenge"], ' +
    'li[jsname], div[role="link"], div[role="button"], button, a[role="link"], a'
  ));
  const rowHits = preferred.filter((el) => {
    if (!isElementVisible(el)) return false;
    const label = el.getAttribute?.('aria-label') || '';
    const own = (el.innerText || el.textContent || '');
    // Prefer elements whose own text is the authenticator line (not a huge list)
    const ownNorm = own.replace(/\s+/g, ' ').trim();
    if (ownNorm.length > 180) return false;
    return isAuthText(label) || isAuthText(ownNorm);
  });
  // Smallest matching row wins (avoids outer wrappers)
  rowHits.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
  if (rowHits[0]) {
    return (
      rowHits[0].closest('[data-challengeid], [data-challengetype], [data-action="selectchallenge"], li, div[role="link"], div[role="button"], button, a') ||
      rowHits[0]
    );
  }

  // Text-node walk: find the label, then climb to clickable ancestor
  try {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = (node.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 120) continue;
      if (!/authenticator/i.test(t)) continue;
      if (!isAuthText(t) && !/google authenticator/i.test(t)) continue;
      let el = node.parentElement;
      for (let i = 0; i < 8 && el; i++) {
        if (
          el.matches?.('[data-challengeid], [data-challengetype], [data-action], [role="link"], [role="button"], li, button, a') ||
          el.tabIndex >= 0
        ) {
          if (isElementVisible(el)) return el;
        }
        el = el.parentElement;
      }
    }
  } catch (e) {}

  return null;
}

function submitGoogleNext(kind, input) {
  if (DEBUG_FILL_ONLY) {
    console.log('[Flow Preload] DEBUG_FILL_ONLY — skip Next click:', kind);
    return false;
  }
  const pathKey = `${kind}:${location.pathname}`;
  if (autoLoginState.submittedKeys.has(pathKey + ':submit')) return false;

  const rootSel = kind === 'password' ? '#passwordNext' : '#identifierNext';
  // Prefer real Next button â€” never form.submit()
  let next =
    document.querySelector(rootSel + ' button') ||
    document.querySelector(rootSel);

  // Fallback: visible button whose label is exactly Next (ignore "Forgot email?")
  if (!next || !isElementVisible(next)) {
    next = Array.from(document.querySelectorAll('button')).find(b => {
      const t = (b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim();
      return /^next$/i.test(t) && isElementVisible(b);
    });
  }

  if (next && isElementVisible(next)) {
    autoLoginState.submittedKeys.add(pathKey + ':submit');
    autoLoginState.lastActionTime = Date.now();
    try {
      next.removeAttribute('disabled');
      next.setAttribute('aria-disabled', 'false');
    } catch (e) {}
    try { next.focus(); } catch (e) {}
    try { next.click(); } catch (e) {}
    return true;
  }
  return false;
}

function isGoogleProcessing() {
  try {
    const progressBar = document.querySelector('[role="progressbar"], .vxxSae, [aria-busy="true"]');
    if (progressBar) {
      const style = window.getComputedStyle(progressBar);
      if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && progressBar.offsetWidth > 0) {
        return true;
      }
    }
  } catch (e) {}
  return false;
}

function hasGoogleAuthError() {
  try {
    const nodes = Array.from(document.querySelectorAll('[role="alert"], [aria-live], .o6cuMc, .Ekjuhf, .dEOOtb'));
    return nodes.some(el => {
      const t = (el.innerText || el.textContent || '').toLowerCase();
      return /wrong password|incorrect password|couldn.?t sign|could not sign|enter a password|password is incorrect|try again/i.test(t);
    });
  } catch (e) {
    return false;
  }
}

function pathSettled(key, ms = 600) {
  const path = location.pathname || '';
  const fullKey = `${path}:${key}`;
  if (!autoLoginState.pathSeenAt[fullKey]) autoLoginState.pathSeenAt[fullKey] = Date.now();
  return Date.now() - autoLoginState.pathSeenAt[fullKey] >= ms;
}

function resetAutoLoginState() {
  autoLoginState.emailFilled = false;
  autoLoginState.emailSubmitted = false;
  autoLoginState.passwordFilled = false;
  autoLoginState.passwordSubmitted = false;
  autoLoginState.lastActionTime = 0;
  autoLoginState.attempts = 0;
  autoLoginState.flowLandingSeenAt = 0;
  autoLoginState.done = false;
  autoLoginState.submittedKeys = new Set();
  autoLoginState.pathSeenAt = {};
  autoLoginState.lastPath = '';
  autoLoginState.pwdUiReloadTried = false;
  autoLoginState.otpRequested = false;
  autoLoginState.otpFilled = false;
  autoLoginState.captchaPaused = false;
  autoLoginState.overlayDismissed = false;
  autoLoginState.lastHostNotify = '';
  removeAutoLoginOverlay();
  removeCaptchaBanner();
}

function notifyAuthHost(channel, data) {
  const key = channel + ':' + JSON.stringify(data || {});
  if (autoLoginState.lastHostNotify === key) return;
  autoLoginState.lastHostNotify = key;
  try { ipcRenderer.sendToHost(channel, data || null); } catch (e) {}
}

function detectGoogleCaptcha() {
  try {
    const frames = Array.from(document.querySelectorAll(
      'iframe[src*="recaptcha" i], iframe[src*="Recaptcha"], iframe[title*="reCAPTCHA" i], ' +
      'iframe[src*="challenges.cloudflare.com" i], iframe[src*="hcaptcha" i]'
    )).filter((f) => {
      const src = (f.getAttribute('src') || '').toLowerCase();
      if (src.includes('badge')) return false; // footer badge ≠ challenge
      const r = f.getBoundingClientRect();
      // Challenge / checkbox widgets are sizable; ignore tiny/hidden frames
      return r.width >= 100 && r.height >= 60 && r.bottom > 0 && r.top < window.innerHeight;
    });
    if (frames.length) return true;

    const widgets = document.querySelectorAll(
      '.g-recaptcha, #recaptcha, [data-sitekey], #captchaimg, img#captchaimg'
    );
    for (const w of widgets) {
      const r = w.getBoundingClientRect();
      if (r.width >= 100 && r.height >= 60 && isElementVisible(w)) return true;
    }

    const text = ((document.body && document.body.innerText) || '').slice(0, 2500);
    // Real challenge copy — not the footer "protected by reCAPTCHA"
    if (/unusual traffic from your computer|select all (?:images|squares)|i.?m not a robot|verify it.?s you|couldn.?t sign you in/i.test(text)) {
      if (frames.length || widgets.length || /unusual traffic|select all (?:images|squares)/i.test(text)) return true;
    }
  } catch (e) {}
  return false;
}

function removeAutoLoginOverlay() {
  try {
    document.getElementById('__flow_auto_login_overlay__')?.remove();
    document.getElementById('__flow_auto_login_overlay_style__')?.remove();
  } catch (e) {}
}

function removeCaptchaBanner() {
  try {
    document.getElementById('__flow_captcha_banner__')?.remove();
    document.getElementById('__flow_captcha_banner_style__')?.remove();
  } catch (e) {}
}

function ensureAutoLoginOverlay() {
  // Host owns the full-page mask (WPF AuthOverlay). Page DOM overlays cannot cover Google login reliably.
  if (autoLoginState.captchaPaused) {
    removeAutoLoginOverlay();
    return;
  }
  autoLoginState.overlayDismissed = false;
  removeAutoLoginOverlay();
  notifyAuthHost('auth:auto-login', { overlay: true, captcha: false });
}

function showCaptchaBanner() {
  removeAutoLoginOverlay();
  if (document.getElementById('__flow_captcha_banner__')) return;

  if (!document.getElementById('__flow_captcha_banner_style__')) {
    const style = document.createElement('style');
    style.id = '__flow_captcha_banner_style__';
    style.textContent = `
      #__flow_captcha_banner__ {
        position: fixed; top: 0; left: 0; right: 0; z-index: 2147483646;
        padding: 14px 20px; text-align: center;
        background: linear-gradient(180deg, #0f766e 0%, #115e59 100%);
        color: #ecfdf5; font-family: "Segoe UI", system-ui, sans-serif;
        font-size: 14px; font-weight: 600; line-height: 1.4;
        box-shadow: 0 8px 24px rgba(0,0,0,.25);
        pointer-events: none;
      }
      #__flow_captcha_banner__ small {
        display: block; margin-top: 4px; font-weight: 500; font-size: 12px; opacity: .9;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  const el = document.createElement('div');
  el.id = '__flow_captcha_banner__';
  el.setAttribute('role', 'alert');
  el.innerHTML = `<strong>Please solve the captcha</strong><small>Complete the challenge below — we will continue signing you in automatically</small>`;
  (document.body || document.documentElement).appendChild(el);
}

function syncGoogleAuthChrome() {
  const host = location.hostname || '';
  const path = location.pathname || '';
  if (!host.includes('accounts.google.com')) {
    // Do NOT send done:true here — intermediate redirects leave accounts.google.com briefly.
    // Host keeps the overlay sticky until flow.google.com / explicit workspace done.
    removeAutoLoginOverlay();
    removeCaptchaBanner();
    return { captcha: false };
  }

  // URL-level recaptcha challenge — lift cover immediately (no debounce)
  const urlIsRecaptcha = /challenge\/recaptcha|\/recaptcha/i.test(path + location.search);
  if (urlIsRecaptcha) {
    autoLoginState.captchaHits = 2;
    autoLoginState.captchaMisses = 0;
    if (!autoLoginState.captchaPaused) {
      console.log('[Flow Preload] reCAPTCHA URL — pausing auto-login');
      autoLoginState.captchaPaused = true;
      autoLoginState.overlayDismissed = false;
      showCaptchaBanner();
      notifyAuthHost('auth:captcha', { active: true });
      notifyAuthHost('auth:auto-login', { overlay: false, captcha: true });
    } else {
      showCaptchaBanner();
    }
    return { captcha: true };
  }

  // Debounced captcha detection — single-frame false positives were lifting the cover
  const captchaNow = detectGoogleCaptcha();
  if (captchaNow) {
    autoLoginState.captchaHits = (autoLoginState.captchaHits || 0) + 1;
    autoLoginState.captchaMisses = 0;
  } else {
    autoLoginState.captchaMisses = (autoLoginState.captchaMisses || 0) + 1;
    autoLoginState.captchaHits = 0;
  }

  const captchaConfirmed = autoLoginState.captchaHits >= 2;
  const captchaCleared = autoLoginState.captchaMisses >= 3;

  if (captchaConfirmed) {
    if (!autoLoginState.captchaPaused) {
      console.log('[Flow Preload] reCAPTCHA detected — pausing auto-login');
      autoLoginState.captchaPaused = true;
      autoLoginState.overlayDismissed = false;
      showCaptchaBanner();
      notifyAuthHost('auth:captcha', { active: true });
      notifyAuthHost('auth:auto-login', { overlay: false, captcha: true });
    } else {
      showCaptchaBanner();
    }
    return { captcha: true };
  }

  if (autoLoginState.captchaPaused) {
    if (!captchaCleared) {
      // Still waiting for captcha to fully clear — keep cover lifted
      showCaptchaBanner();
      return { captcha: true };
    }
    console.log('[Flow Preload] reCAPTCHA cleared — resuming auto-login');
    autoLoginState.captchaPaused = false;
    autoLoginState.overlayDismissed = false;
    removeCaptchaBanner();
    notifyAuthHost('auth:captcha', { active: false });
  }

  // Signal host to keep native overlay (page DOM overlay is a no-op)
  if (!autoLoginState.done) ensureAutoLoginOverlay();
  return { captcha: false };
}

function runGoogleAutoLogin() {
  // Overlay / captcha chrome first — even before credentials arrive
  const chrome = syncGoogleAuthChrome();
  if (chrome && chrome.captcha) return;

  if (!credentials.email) {
    try { ipcRenderer.sendToHost('request-credentials'); } catch (e) {}
    return;
  }

  const now = Date.now();
  if (now - autoLoginState.lastActionTime < autoLoginState.actionCooldownMs) return;

  const hostname = window.location.hostname;
  const pathname = window.location.pathname || '';

  // Flow / Labs: if already in workspace, stop. Never auto-click "Sign in" here —
  // that restarted Google OAuth while the SPA was still hydrating (login loop).
  // AppShell owns AddSession when a fresh Google login is required.
  if (hostname.includes('flow.google.com') || hostname.includes('labs.google')) {
    removeAutoLoginOverlay();
    removeCaptchaBanner();
    // Stay on /about or /landing — bouncing to root blinks and races AppShell login start.
    const isWorkspace = !!(
      document.querySelector('flow-app, flow-app-root, flow-projects-page, [data-testid*="project"]') ||
      (document.querySelector('header, flow-app-header, [role="banner"]') &&
        document.querySelector('[role="main"], [role="tablist"], textarea, [contenteditable="true"]'))
    );
    if (isWorkspace || autoLoginState.done) {
      autoLoginState.done = true;
      notifyAuthHost('auth:auto-login', { overlay: false, captcha: false, done: true });
      return;
    }
    // No guest CTAs — AppShell owns fresh Google login when needed
    return;
  }

  if (!hostname.includes('accounts.google.com') && !hostname.includes('accounts.youtube.com')) return;

  // Final Google handoff — CheckCookie / LoginDone often stalls under our overlay.
  // Jump to continue= (Flow) once cookies are set.
  if (/CheckCookie|LoginDoneHtml|chtml=LoginDone/i.test(location.href + pathname)) {
    if (!autoLoginState.submittedKeys.has('checkcookie-continue')) {
      autoLoginState.submittedKeys.add('checkcookie-continue');
      let dest = 'https://flow.google.com/';
      try {
        const cont = new URL(location.href).searchParams.get('continue');
        if (cont && /^https:\/\//i.test(cont)) dest = cont;
      } catch (e) {}
      console.log('[Flow Preload] CheckCookie/LoginDone →', dest);
      notifyAuthHost('auth:auto-login', { overlay: false, captcha: false, done: true });
      setTimeout(() => {
        try { location.replace(dest); } catch (e) {
          try { location.href = dest; } catch (e2) {}
        }
      }, 500);
    }
    return;
  }

  const onPwdChallenge = /\/challenge\/pwd(?:\/|$)/i.test(pathname);
  const passwordInputEarly = document.querySelector('input[type="password"], input[name="Passwd"], input[name="password"], input[autocomplete="current-password"]');
  const pwdFieldReady = passwordInputEarly && isElementVisible(passwordInputEarly);

  // Password URL but field not painted yet â€” Google's SPA often lags 1â€“3s.
  // Do NOT restart login during this window (that caused the stuck email card).
  if (onPwdChallenge && !pwdFieldReady) {
    if (!pathSettled('pwd-stuck', 5000)) return;
    if (!autoLoginState.pwdUiReloadTried) {
      autoLoginState.pwdUiReloadTried = true;
      autoLoginState.lastActionTime = now;
      console.warn('[Flow Preload] Password UI missing after 5s â€” cache reload only');
      try { ipcRenderer.sendToHost('auth:stuck-pwd'); } catch (e) {}
    }
    return;
  }

  // Progress bar can linger on Glif — never block identifier/email forever
  const onIdentifierPath = /signin\/identifier|\/identifier(?:\/|$)/i.test(pathname);
  const on2faPath = /\/challenge\/(totp|selection|sk|iap|dp|ootp)/i.test(pathname);
  if (isGoogleProcessing() && !onPwdChallenge && !on2faPath && !onIdentifierPath) {
    if (!pathSettled('processing-wait', 2000)) return;
  }

  // Google SPA: URL often updates before the new form paints
  if (autoLoginState.lastPath !== pathname) {
    const wasPwd = /\/challenge\/pwd/i.test(autoLoginState.lastPath || '');
    const nowPwd = /\/challenge\/pwd/i.test(pathname);
    const prev = autoLoginState.lastPath;
    autoLoginState.lastPath = pathname;
    // Staying on password challenge — do not reset fill/submit (path flicker caused loops)
    if (wasPwd && nowPwd) {
      // keep passwordSubmitted / keys
    } else {
      autoLoginState.emailSubmitted = false;
      autoLoginState.passwordSubmitted = false;
      autoLoginState.emailFilled = false;
      autoLoginState.passwordFilled = false;
      autoLoginState.otpRequested = false;
      autoLoginState.otpFilled = false;
      for (const k of Array.from(autoLoginState.submittedKeys)) {
        if (/^(email|password|identifier|otp|totp):/.test(k)) autoLoginState.submittedKeys.delete(k);
      }
    }
    if (prev && prev !== pathname) {
      console.log('[Flow Preload] Path change', prev, '→', pathname);
    }
  }

  // Account chooser
  const accountItems = document.querySelectorAll('[data-identifier], [data-email], [data-profileidentifier]');
  for (const item of accountItems) {
    const idVal = (item.getAttribute('data-identifier') || item.getAttribute('data-email') || item.getAttribute('data-profileidentifier') || '').trim().toLowerCase();
    if (idVal && idVal === credentials.email.toLowerCase() && isElementVisible(item)) {
      clickOnce('choose:' + idVal, item);
      return;
    }
  }
  const another = buttonByLabel(/^use another account$/i);
  if (another && /accountchooser|signin\/chooser|AddSession/i.test(location.href + pathname)) {
    clickOnce('another-account', another);
    return;
  }

  // ---- 2FA: prefer Authenticator app TOTP ----
  const pageText = ((document.body && document.body.innerText) || '').slice(0, 4500);
  const onChallengeChooser =
    /choose how you want to sign in/i.test(pageText) ||
    /\/challenge\/selection/i.test(pathname);
  const onSecurityCodeScreen =
    !onChallengeChooser &&
    (
      /g\.co\/sc/i.test(pageText) ||
      /get a code to sign in/i.test(pageText) ||
      (/enter security code/i.test(pageText) && !/authenticator/i.test(pageText)) ||
      /\/challenge\/sk(?:otp)?(?:\/|$)/i.test(pathname)
    );

  const totpInput = document.querySelector(
    'input[name="totpPin"], input#totpPin, input[id*="totp" i], ' +
    'input[type="tel"][autocomplete="one-time-code"], ' +
    'input[aria-label*="Enter code" i], input[aria-label*="Enter the code" i], ' +
    'input[aria-label*="verification code" i]'
  );
  // Do NOT treat the g.co/sc "Enter security code" box as TOTP
  const totpReady =
    totpInput &&
    isElementVisible(totpInput) &&
    !onSecurityCodeScreen &&
    !onChallengeChooser &&
    (
      /totp/i.test(totpInput.name || totpInput.id || '') ||
      totpInput.autocomplete === 'one-time-code' ||
      /\/challenge\/totp/i.test(pathname) ||
      (/enter code/i.test(pageText) && /authenticator/i.test(pageText))
    );

  // "Get a code to sign in" / g.co/sc / skotp → Try another way FIRST (before authenticator pick)
  if (!DEBUG_FILL_ONLY && onSecurityCodeScreen && !totpReady) {
    const tryAnother =
      buttonByLabel(/^try another way$/i) ||
      Array.from(document.querySelectorAll('button, a, div[role="button"], span[role="button"], div[role="link"]')).find(
        (el) => /^try another way$/i.test((el.innerText || '').replace(/\s+/g, ' ').trim()) && isElementVisible(el)
      );
    if (tryAnother) {
      console.log('[Flow Preload] Security code screen → Try another way');
      const retryBucket = Math.floor(now / 2000);
      // Allow hard re-click each bucket (Glif often ignores first click)
      autoLoginState.submittedKeys.delete('try-another-way:' + pathname + ':' + (retryBucket - 1));
      clickOnce('try-another-way:' + pathname + ':' + retryBucket, tryAnother);
      return;
    }
  }

  // Selection screen: click "Get a verification code from the Google Authenticator app"
  if (!DEBUG_FILL_ONLY && !totpReady && (onChallengeChooser || /authenticator/i.test(pageText))) {
    const authTarget = findAuthenticatorOption();
    if (authTarget) {
      const retryBucket = Math.floor(now / 2000);
      console.log('[Flow Preload] Selecting Google Authenticator TOTP option');
      autoLoginState.submittedKeys.delete('auth-app:' + pathname + ':' + (retryBucket - 1));
      clickOnce('auth-app:' + pathname + ':' + retryBucket, authTarget);
      return;
    }
  }

  // TOTP code field: request OTP from host, then fill + Next
  // Also runs on accounts.youtube.com/SetSID where the Authenticator UI is painted
  // without /challenge/totp in the URL.
  if (totpReady) {
    if (!credentials._otp) {
      if (!autoLoginState.otpRequested || now - autoLoginState.lastActionTime > 5000) {
        autoLoginState.otpRequested = true;
        autoLoginState.lastActionTime = now;
        console.log('[Flow Preload] Requesting TOTP from host');
        try { ipcRenderer.sendToHost('request-otp'); } catch (e) {}
      }
      return;
    }
    const fillKey = `otp:${pathname}:fill`;
    const nextKey = `otp:${pathname}:next`;
    const alreadyFilled =
      (totpInput.value || '').replace(/\s+/g, '') === String(credentials._otp).replace(/\s+/g, '');
    if (!autoLoginState.submittedKeys.has(fillKey) || !alreadyFilled) {
      fillInputValue(totpInput, String(credentials._otp));
      autoLoginState.submittedKeys.add(fillKey);
      autoLoginState.otpFilled = true;
      autoLoginState.lastActionTime = now;
    }
    if (!DEBUG_FILL_ONLY && !autoLoginState.submittedKeys.has(nextKey)) {
      autoLoginState.submittedKeys.add(nextKey);
      setTimeout(() => {
        if (!totpInput.isConnected) return;
        const val = (totpInput.value || '').replace(/\s+/g, '');
        if (!val) return;
        submitGoogleNext('totp', totpInput);
        const next =
          document.querySelector('#totpNext button, #totpNext, #idvPreregisteredPhoneNext button') ||
          buttonByLabel(/^next$/i);
        if (next && isElementVisible(next)) {
          console.log('[Flow Preload] Clicking TOTP Next on', location.hostname + pathname);
          hardClick(next);
        }
      }, 1500);
    }
    return;
  }

  const emailInput = document.querySelector(
    'input#identifierId, input[type="email"], input[name="identifier"], input[name="Email"], ' +
    'input[autocomplete="username"], input[aria-label*="Email" i], input[aria-label*="email or phone" i]'
  );
  const passwordInput = passwordInputEarly;

  // Password: only when field is actually painted — submit ONCE (no click loops)
  if (onPwdChallenge || pwdFieldReady) {
    if (!pwdFieldReady) {
      pathSettled('challenge-form', 500);
      return;
    }
    if (!pathSettled('pwd-ready', 400)) return;
    if (!credentials.password) return;

    // Host already submitted this password step
    try {
      const st = window.__flowHostAuto;
      const pwdKey = 'pwd:' + pathname.split('/').slice(0, 5).join('/');
      if (st && st[pwdKey] === 'submitted') {
        autoLoginState.passwordSubmitted = true;
        return;
      }
    } catch (e) {}

    if (autoLoginState.passwordSubmitted) {
      // Only retry on a clear wrong-password alert — not generic page text
      if (hasGoogleAuthError() && now - autoLoginState.lastActionTime > 8000 && autoLoginState.attempts < 1) {
        autoLoginState.attempts += 1;
        autoLoginState.passwordSubmitted = false;
        autoLoginState.submittedKeys.delete(`password:${pathname}:fill`);
        autoLoginState.submittedKeys.delete(`password:${pathname}:submit`);
        try {
          if (window.__flowHostAuto) {
            const pwdKey = 'pwd:' + pathname.split('/').slice(0, 5).join('/');
            delete window.__flowHostAuto[pwdKey];
          }
        } catch (e) {}
      } else {
        return;
      }
    }

    const fillKey = `password:${pathname}:fill`;
    if (!autoLoginState.submittedKeys.has(fillKey)) {
      const already = (passwordInput.value || '') === credentials.password;
      const ok = already || fillInputValue(passwordInput, credentials.password);
      if (!ok) {
        console.warn('[Flow Preload] Password fill did not stick — will retry');
        return;
      }
      autoLoginState.submittedKeys.add(fillKey);
      autoLoginState.passwordFilled = true;
      autoLoginState.lastActionTime = now;
      if (DEBUG_FILL_ONLY) {
        console.log('[Flow Preload] DEBUG_FILL_ONLY — password filled, wait for manual Next');
      } else {
        setTimeout(() => {
          if (!passwordInput.isConnected) return;
          if (autoLoginState.passwordSubmitted) return;
          autoLoginState.passwordSubmitted = true;
          try {
            window.__flowHostAuto = window.__flowHostAuto || {};
            window.__flowHostAuto['pwd:' + location.pathname.split('/').slice(0, 5).join('/')] = 'submitted';
          } catch (e) {}
          submitGoogleNext('password', passwordInput);
        }, 1600);
      }
    }
    return;
  }

  // Email / identifier — never fill email while URL is already /challenge/pwd
  if (emailInput && isElementVisible(emailInput) && (!passwordInput || !isElementVisible(passwordInput))) {
    if (onPwdChallenge) return; // SPA mid-transition — leave it alone
    if (!pathSettled('id-ready', 300)) return;

    const fillKey = `email:${pathname}:fill`;
    const submitKey = `email:${pathname}:submit`;
    const currentVal = (emailInput.value || '').trim();
    const want = String(credentials.email || '').trim();

    if (!want) {
      try { ipcRenderer.sendToHost('request-credentials'); } catch (e) {}
      return;
    }

    if (!autoLoginState.submittedKeys.has(fillKey) || currentVal.toLowerCase() !== want.toLowerCase()) {
      console.log('[Flow Preload] Filling Google email');
      const ok = fillInputValue(emailInput, want);
      if (!ok || (emailInput.value || '').trim().toLowerCase() !== want.toLowerCase()) {
        console.warn('[Flow Preload] Email fill did not stick — will retry');
        autoLoginState.submittedKeys.delete(fillKey);
        return;
      }
      autoLoginState.submittedKeys.add(fillKey);
      autoLoginState.emailFilled = true;
      autoLoginState.lastActionTime = now;
      if (DEBUG_FILL_ONLY) {
        console.log('[Flow Preload] DEBUG_FILL_ONLY — email filled, wait for manual Next');
      } else {
        setTimeout(() => {
          if (!emailInput.isConnected) return;
          if (/\/challenge\/pwd/i.test(location.pathname)) return;
          autoLoginState.emailSubmitted = true;
          submitGoogleNext('identifier', emailInput);
          const next = document.querySelector('#identifierNext button, #identifierNext') || buttonByLabel(/^next$/i);
          if (next && isElementVisible(next)) hardClick(next);
        }, 1600);
      }
      return;
    }

    // If still on identifier after fill+Next, retry Next once (first click often ignored)
    if (
      !DEBUG_FILL_ONLY &&
      autoLoginState.emailFilled &&
      now - autoLoginState.lastActionTime > 3500 &&
      autoLoginState.attempts < 3 &&
      (emailInput.value || '').trim()
    ) {
      autoLoginState.attempts += 1;
      autoLoginState.lastActionTime = now;
      autoLoginState.submittedKeys.delete(submitKey);
      autoLoginState.submittedKeys.delete(`identifier:${pathname}:submit`);
      console.log('[Flow Preload] Retrying email Next, attempt', autoLoginState.attempts);
      setTimeout(() => {
        if (!emailInput.isConnected) return;
        if (/\/challenge\/pwd/i.test(location.pathname)) return;
        submitGoogleNext('identifier', emailInput);
        const next = document.querySelector('#identifierNext button, #identifierNext') || buttonByLabel(/^next$/i);
        if (next && isElementVisible(next)) hardClick(next);
      }, 1500);
    }
    return;
  }

  // Recovery / home-address / interstitial skip — never on TOTP / password challenge
  if (!/\/challenge\/(totp|pwd|selection|sk|iap|dp|ootp)/i.test(pathname)) {
    if (dismissGoogleInterstitials()) return;
  }

  // Continue / I agree
  if (!emailInput && !passwordInput) {
    const cont = buttonByLabel(/^(continue|i agree|confirm)$/i);
    if (cont) clickOnce('continue:' + pathname, cont);
  }
}

/** Cancel recovery phone/email, home address (gds), and hide "Open in Google Flow app" banner. */
function dismissGoogleInterstitials() {
  const host = (location.hostname || '').toLowerCase();
  const path = (location.pathname || '').toLowerCase();
  const bodySlice = ((document.body && document.body.innerText) || '').slice(0, 2800);
  const onGds = host.includes('gds.google.com');
  const onFlow = host.includes('flow.google.com') || host.includes('labs.google');
  const onAccounts = host.includes('accounts.google.com') || host.includes('accounts.youtube.com');
  // Never interrupt active Google sign-in / TOTP — bouncing to Flow here aborts Next.
  const onActiveChallenge =
    onAccounts &&
    (/\/challenge\//i.test(path) ||
      /\/signin\//i.test(path) ||
      /\/v3\/signin\//i.test(path) ||
      /\/ServiceLogin/i.test(path) ||
      /\/AddSession/i.test(path) ||
      /\/accountchooser/i.test(path) ||
      document.querySelector('input[name="totpPin"], input#totpPin, input[name="Passwd"], input#identifierId'));
  if (onActiveChallenge) return false;

  const pageLooksRecovery = /make sure you can always sign in|add a recovery phone|your recovery email|set a home address|home and work addresses|recovery options/i.test(bodySlice);
  const pathLooksRecovery = /recovery|speedbump|interstitial|accountrecovery|home.?address/i.test(path) || path.includes('/web/recoveryoptions');

  // Smart-app / "Open in the Google Flow app" banner — hide + click X
  try {
    document.querySelectorAll('div, section, aside, [role="banner"], [class*="banner"], [class*="promo"], [class*="install"]').forEach((el) => {
      if (!el || el.getAttribute('data-flow-hidden') === '1') return;
      const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 140) return;
      const isAppBanner =
        /open in the google flow app/i.test(t) ||
        (/google flow/i.test(t) && /open in/i.test(t));
      if (!isAppBanner) return;
      let closer = null;
      el.querySelectorAll('button, a, [role="button"], [aria-label]').forEach((b) => {
        const bt = (b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim();
        const al = b.getAttribute('aria-label') || '';
        if (/^(×|✕|x|close|dismiss)$/i.test(bt) || /close|dismiss|cancel/i.test(al)) {
          closer = closer || b;
        }
      });
      if (closer && isElementVisible(closer)) {
        clickOnce('flow-app-banner-x:' + (closer.innerText || 'x').slice(0, 12), closer);
      }
      hideEl(el);
    });
  } catch (e) {}

  if (!onGds && !pageLooksRecovery && !pathLooksRecovery) {
    // Still try classic recoverySkip on accounts
    if (onAccounts) {
      const skipBtn = document.querySelector('#recoverySkip, button[jsname="j6LnO"]');
      if (skipBtn && isElementVisible(skipBtn)) {
        clickOnce('recovery-skip', skipBtn);
        return true;
      }
    }
    return false;
  }

  const skipBtn = document.querySelector(
    '#recoverySkip, button[jsname="j6LnO"], [data-id="skip"], [aria-label*="Skip" i], [aria-label*="Cancel" i], [aria-label*="Not now" i], [aria-label*="No thanks" i]'
  );
  if (skipBtn && isElementVisible(skipBtn)) {
    clickOnce('recovery-skip', skipBtn);
    return true;
  }

  const dismissRe = /^(cancel|skip|not now|no thanks|remind me later|maybe later|later|close|dismiss|not interested)$/i;
  const cands = [];
  document.querySelectorAll('button, a, [role="button"], div[role="link"], span[role="button"]').forEach((el) => {
    if (!isElementVisible(el)) return;
    const t = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 42) return;
    if (!dismissRe.test(t)) return;
    // Never click Save / Next / Continue on these screens
    if (/^(save|next|continue|done|submit|add)$/i.test(t)) return;
    cands.push(el);
  });
  if (cands.length) {
    cands.sort((a, b) => {
      const score = (el) => {
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (t === 'cancel') return 0;
        if (t === 'skip' || t === 'not now' || t === 'no thanks') return 1;
        return 2;
      };
      return score(a) - score(b);
    });
    clickOnce('recovery-dismiss:' + (cands[0].innerText || 'x').slice(0, 20), cands[0]);
    return true;
  }

  // gds / recovery stuck with no Cancel — never bounce while still on accounts.google.com
  if (onAccounts) return false;
  if (onGds || (pageLooksRecovery && !onFlow)) {
    try {
      if (!window.__flowRecoveryBounceAt) window.__flowRecoveryBounceAt = 0;
      const now = Date.now();
      if (now - window.__flowRecoveryBounceAt > 4500) {
        window.__flowRecoveryBounceAt = now;
        console.log('[Flow Preload] Bouncing off Google recovery interstitial');
        location.replace('https://flow.google.com/');
        return true;
      }
    } catch (e) {}
  }
  return false;
}


// Workspace privacy — keep LIGHT (heavy style forcing freezes Flow → black screen)
function isProtectedMediaNode(el) {
  if (!el || !el.closest) return false;
  try {
    // Never hide generated media / gallery canvas — that made All media blank until reload
    if (
      el.closest(
        'flow-media-card, flow-video-card, flow-image-card, flow-project-canvas, ' +
        '[data-testid*="media"], [data-testid*="gallery"], [class*="media-card"], ' +
        '[class*="MediaCard"], [class*="gallery"], video, canvas, img[src*="blob:"], ' +
        'img[src*="googleusercontent"], [role="grid"], [role="list"]'
      )
    ) {
      return true;
    }
    // Inside a project, protect the main content surface (where new gens paint)
    if (/\/project\//i.test(location.pathname || '')) {
      if (el.closest('main, [role="main"], flow-app, flow-project')) {
        // Still allow hiding tiny chrome chips (ULTRA) / alerts inside main
        const tag = (el.tagName || '').toLowerCase();
        const t = ((el.innerText || el.getAttribute?.('aria-label') || '') + '').replace(/\s+/g, ' ').trim();
        if (/^ultra$/i.test(t) && t.length <= 12) return false;
        if (el.getAttribute?.('role') === 'alert' || el.getAttribute?.('role') === 'status') return false;
        if (tag === 'button' || tag === 'a' || (tag === 'span' && el.childElementCount === 0)) {
          if (/^ultra$/i.test(t) || /Add AI credits/i.test(t)) return false;
        }
        // Protect sizable nodes in the media pane
        const r = el.getBoundingClientRect?.();
        if (r && r.width > 80 && r.height > 80) return true;
      }
    }
  } catch (e) {}
  return false;
}

function hideEl(el) {
  if (!el || el === document.body || el === document.documentElement || el === document.head) return;
  if (isProtectedMediaNode(el)) return;
  try {
    el.style.setProperty('display', 'none', 'important');
    el.style.setProperty('visibility', 'hidden', 'important');
    el.style.setProperty('pointer-events', 'none', 'important');
    el.style.setProperty('opacity', '0', 'important');
    el.style.setProperty('height', '0px', 'important');
    el.style.setProperty('max-height', '0px', 'important');
    el.style.setProperty('overflow', 'hidden', 'important');
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('data-flow-hidden', '1');
    if (el.tagName === 'A') {
      el.removeAttribute('href');
      el.onclick = function (e) { e.preventDefault(); e.stopPropagation(); return false; };
    }
    if (typeof el.disabled !== 'undefined') {
      try { el.disabled = true; } catch (e) {}
    }
  } catch (e) {}
}

function forceRenameLiteEverywhere() {
  // Model renaming disabled
}

function hideUltraControls() {
  try {
    // Only prompt/settings chips — never walk every div (that blanked All media)
    const roots = document.querySelectorAll(
      'flow-prompt, [class*="prompt"], [class*="model"], [class*="settings"], [role="listbox"], [role="menu"], header'
    );
    const scan = (root) => {
      root.querySelectorAll('button, [role="button"], [role="radio"], [role="tab"], [role="option"], label, span').forEach((el) => {
        if (!el || el.getAttribute('data-flow-hidden') === '1') return;
        if (el.childElementCount > 4) return;
        const t = (el.innerText || el.textContent || el.getAttribute('aria-label') || '')
          .replace(/\s+/g, ' ')
          .trim();
        if (!t || t.length > 16) return;
        if (!/^ultra$/i.test(t)) return;
        const target =
          el.closest('button, [role="button"], [role="radio"], [role="tab"], [role="option"], label') || el;
        hideEl(target);
      });
    };
    if (!roots.length) return;
    roots.forEach(scan);
  } catch (e) {}
}

function killAccountPopupNow() {
  // Never scrub Google sign-in / captcha pages — the needle "protected by recaptcha"
  // was matching the real challenge UI and hideEl()'d the whole page (0×0 blank).
  try {
    const host = (location.hostname || '').toLowerCase();
    if (host.includes('accounts.google.com') || host.includes('accounts.youtube.com')) return;
    const path = (location.pathname || '').toLowerCase();
    if (path.includes('recaptcha') || path.includes('captcha') || /\/challenge\//.test(path)) return;
  } catch (e) {}

  const needles = [
    'sign out of all accounts',
    'visible watermarking',
    'credits refresh daily',
    'create avatar',
  ];

  const all = document.querySelectorAll(
    'div, section, aside, dialog, [role="dialog"], [role="menu"], [role="presentation"], [role="listbox"], [role="alertdialog"]'
  );
  for (const el of all) {
    if (!el || el.getAttribute('data-flow-hidden') === '1') continue;
    if (el.childElementCount > 90) continue;
    const raw = el.innerText || el.textContent || '';
    if (!raw || raw.length > 1000) continue;
    const t = raw.toLowerCase().replace(/\s+/g, ' ');
    // Never treat reCAPTCHA footer copy as an account popup
    if (t.includes('recaptcha') || t.includes('captcha')) continue;
    const hit = needles.some((n) => t.includes(n));
    const hasEmail = /[\w.+-]+@[\w.-]+\.\w+/.test(t);
    if (!hit && !(hasEmail && (t.includes('google') || t.includes('sign out') || t.includes('watermark')))) continue;

    let panel =
      el.closest('[role="dialog"], [role="menu"], [role="presentation"], dialog, [data-menu], .mat-mdc-menu-panel') ||
      el;
    let p = panel;
    for (let i = 0; i < 6 && p && p !== document.body; i++) {
      const r = p.getBoundingClientRect();
      if (r.width > 180 && r.width < 560 && r.height > 160 && r.height < 780) {
        panel = p;
        break;
      }
      p = p.parentElement;
    }
    hideEl(panel);
    try {
      panel.querySelectorAll('button, a, li, label, input, div').forEach((row) => {
        const rt = (row.innerText || '').toLowerCase();
        if (needles.some((n) => rt.includes(n)) || /@/.test(rt)) hideEl(row);
      });
    } catch (e) {}
  }

  document.querySelectorAll('button, a, li, label, span, div, p').forEach((el) => {
    if (el.childElementCount > 8) return;
    const t = (el.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!t || t.length > 140) return;
    if (t.includes('recaptcha') || t.includes('captcha')) return;
    if (
      t === 'sign out of all accounts' ||
      t === 'visible watermarking' ||
      t === 'credits refresh daily' ||
      t === 'create avatar' ||
      needles.some((n) => t === n)
    ) {
      hideEl(el.closest('button, a, li, label, [role="menuitem"], div') || el);
    }
  });
}

function hideTransientAccountUi() {
  killAccountPopupNow();
}

function ensureClickableTree(el) {
  let p = el;
  for (let i = 0; i < 8 && p && p !== document.body; i++) {
    p.style.removeProperty('display');
    p.style.removeProperty('visibility');
    p.style.removeProperty('pointer-events');
    p.style.removeProperty('opacity');
    p.style.removeProperty('height');
    p.style.removeProperty('min-height');
    p.style.removeProperty('max-height');
    p.style.setProperty('pointer-events', 'auto', 'important');
    p.style.setProperty('visibility', 'visible', 'important');
    p.removeAttribute('data-flow-hidden');
    p = p.parentElement;
  }
  if (el && el.style) {
    el.style.setProperty('cursor', 'pointer', 'important');
    el.style.setProperty('pointer-events', 'auto', 'important');
  }
}

function ensureNewProjectClickable() {
  document.querySelectorAll('button, a, [role="button"], span, div, p').forEach((el) => {
    const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!/^(?:\+\s*)?new project$/i.test(t)) return;
    ensureClickableTree(el);
    el.setAttribute('data-flow-new-project', '1');
  });
}

function hideExistingProjects() {
  try {
    const host = (location.hostname || '').toLowerCase();
    if (host.includes('accounts.google.com') || host.includes('accounts.youtube.com')) return;
  } catch (e) {}
  if (/\/project\//i.test(window.location.pathname || '')) {
    ensureNewProjectClickable();
    return;
  }

  ensureNewProjectClickable();
  const dateRe = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s*[-–]\s*\d{1,2}:\d{2}/i;

  document.querySelectorAll(
    'flow-project-card, [data-testid*="project"], [data-testid*="recents"], a[href*="/project/"], [class*="project-card"], [class*="ProjectCard"], [class*="project-tile"], [role="listitem"]'
  ).forEach((card) => {
    const t = (card.innerText || card.textContent || '').replace(/\s+/g, ' ').trim();
    if (/new project/i.test(t) || card.querySelector('[data-flow-new-project="1"]')) {
      ensureClickableTree(card);
      return;
    }
    hideEl(card);
    card.querySelectorAll('a, button, [role="button"]').forEach((b) => hideEl(b));
  });

  document.querySelectorAll('a, article, li, div, section').forEach((el) => {
    if (el.getAttribute('data-flow-hidden') === '1') return;
    if (el.getAttribute('data-flow-new-project') === '1') return;
    if (el.querySelector && el.querySelector('[data-flow-new-project="1"]')) return;
    const slice = (el.innerText || '').slice(0, 100);
    if (/new project/i.test(slice)) {
      ensureClickableTree(el);
      return;
    }
    if (el.childElementCount > 25) return;
    const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
    if (!dateRe.test(t)) return;
    if (el.closest('header, nav, textarea, [contenteditable="true"], flow-prompt, [class*="prompt"]')) return;
    const r = el.getBoundingClientRect();
    if (r.width < 100 || r.height < 80 || r.width > 700 || r.height > 700) return;
    hideEl(el);
    el.querySelectorAll('a, button, [role="button"]').forEach((b) => hideEl(b));
  });

  document.querySelectorAll('img, video, canvas').forEach((media) => {
    if (media.closest('[data-flow-new-project="1"]')) return;
    if (media.closest('header, nav, flow-prompt, [class*="prompt"]')) return;
    const card = media.closest('a, article, li, [role="listitem"], div');
    if (!card || card.getAttribute('data-flow-hidden') === '1') return;
    const t = (card.innerText || '').replace(/\s+/g, ' ');
    if (/new project/i.test(t)) return;
    const r = card.getBoundingClientRect();
    if (r.width < 120 || r.height < 100 || r.width > 600) return;
    if (dateRe.test(t) || r.height > 140) hideEl(card);
  });

  ensureNewProjectClickable();
}

function maskFlowWorkspace() {
  const hostname = window.location.hostname;
  const isFlow = hostname.includes('flow.google.com') || hostname.includes('labs.google');
  if (!isFlow) return;

  const profileSelectors = [
    'header [aria-label*="Google Account" i]',
    'header [aria-label*="Account menu" i]',
    'header a[href*="myaccount.google.com"]',
    'header button[aria-label*="Manage your Google Account" i]',
    'header img[src*="googleusercontent.com"]'
  ];
  profileSelectors.forEach(sel => {
    try {
      document.querySelectorAll(sel).forEach(el => hideEl(el));
    } catch (e) {}
  });

  hideAccountPrivacyPanels();
  hideTransientAccountUi();
  hideUltraControls();
  hideGalleryEditControls();
  // Project canvas: never run project-card scrubbers / media date hide
  if (!/\/project\//i.test(window.location.pathname || '')) {
    hideExistingProjects();
  }
  forceRenameLiteEverywhere();
  hideGoogleCreditsWarningBanner();
}

function hideAccountPrivacyPanels() {
  killAccountPopupNow();
  const exactHide = [
    'sign out of all accounts',
    'visible watermarking',
    'credits refresh daily',
    'create avatar'
  ];
  const candidates = document.querySelectorAll(
    'button, a, li, label, [role="menuitem"], [role="menu"], [role="dialog"], div, span'
  );
  for (const el of candidates) {
    if (!el || el.childElementCount > 40) continue;
    const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!txt || txt.length > 320) continue;
    const lower = txt.toLowerCase();

    if (exactHide.some(n => lower === n || lower.includes(n))) {
      const row = el.closest('[role="menuitem"], button, li, label, div') || el;
      hideEl(row);
      if (lower.includes('sign out of all accounts') || lower.includes('credits refresh daily')) {
        const panel = el.closest('[role="menu"], [role="dialog"], [role="presentation"], .mat-mdc-menu-panel, div');
        if (panel) {
          const pt = (panel.innerText || '').toLowerCase();
          if (pt.includes('sign out') || pt.includes('watermark') || pt.includes('@')) hideEl(panel);
        }
      }
      continue;
    }

    if (
      /[\w.+-]+@[\w.-]+\.\w+/.test(txt) &&
      txt.length < 160
    ) {
      const panel = el.closest('[role="menu"], [role="dialog"], [role="presentation"], .mat-mdc-menu-panel');
      if (panel) hideEl(panel);
      else hideEl(el);
    }
  }
}

function hideGalleryEditControls() {
  if (/\/project\//i.test(window.location.pathname || '')) {
    // Inside project: only hide destructive icons on media cards, never prompt editors
  }
  const roots = document.querySelectorAll(
    'flow-media-card, flow-video-card, flow-image-card, flow-project-card, [data-testid*="media-card"]'
  );
  roots.forEach(root => {
    try {
      root.querySelectorAll(
        'button[aria-label*="Delete" i], button[aria-label*="Rename" i], button[aria-label*="Remove" i]'
      ).forEach(btn => hideEl(btn));
    } catch (e) {}
  });
}

// Hide Google Flow internal low credits warning banner (safely without touching parents/sidebar)
function hideGoogleCreditsWarningBanner() {
  try {
    const isCreditsNag = (txt) => {
      const t = String(txt || '');
      if (!t) return false;
      return (
        /out of Google Flow credits/i.test(t) ||
        /running low on Google Flow credits/i.test(t) ||
        /You're running low on/i.test(t) ||
        /top up to get more/i.test(t) ||
        (/Add AI credits/i.test(t) && /Google Flow credits|top up|refresh/i.test(t)) ||
        (/Google Flow credits/i.test(t) && /wait until they refresh|top up|get more/i.test(t))
      );
    };

    // Do NOT query every div — that walked the media gallery and blanked All media
    const candidates = document.querySelectorAll(
      '[role="alert"], [role="status"], [role="alertdialog"]'
    );
    candidates.forEach((el) => {
      if (!el || el.tagName === 'BODY' || el.tagName === 'HTML') return;
      if (el.id === 'flow-generation-toast' || el.closest('#flow-generation-toast')) return;
      if (isProtectedMediaNode(el)) return;

      const txt = (el.innerText || el.textContent || '').trim();
      if (!txt || txt.length > 420) return;
      if (!isCreditsNag(txt)) return;
      hideEl(el);
    });

    document.querySelectorAll('button, a, [role="button"]').forEach((el) => {
      if (isProtectedMediaNode(el)) return;
      const t = (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
      if (!/^Add AI credits$/i.test(t)) return;
      const banner = el.closest('[role="alert"], [role="status"], [role="alertdialog"]');
      if (banner) hideEl(banner);
      else hideEl(el);
    });
  } catch (e) {}
}

// Block Google Account management + kill popup on open
window.addEventListener('click', (e) => {
  const target = e.target;
  if (!target || !target.closest) return;
  if (target.closest('[data-flow-new-project="1"]') || /new project/i.test((target.innerText || '').trim())) {
    return;
  }
  if (target.closest(
    '[aria-label*="Google Account" i], [aria-label*="Account menu" i], [aria-label*="Manage your Google Account" i], a[href*="myaccount.google.com"]'
  )) {
    e.preventDefault();
    e.stopPropagation();
    setTimeout(killAccountPopupNow, 0);
    setTimeout(killAccountPopupNow, 50);
    setTimeout(killAccountPopupNow, 150);
    return;
  }
  const label = ((target.innerText || target.getAttribute?.('aria-label')) || '').toLowerCase();
  if (
    label.includes('sign out of all accounts') ||
    label.includes('visible watermarking') ||
    label.includes('credits refresh daily') ||
    label.includes('create avatar')
  ) {
    e.preventDefault();
    e.stopPropagation();
    hideEl(target.closest('button, a, li, div') || target);
  }
  // If user clicked something that opens account UI, scrub it immediately
  setTimeout(killAccountPopupNow, 30);
}, true);

// Continuously scrub account popup as soon as it mounts
(function installAccountKillerObserver() {
  const onGoogleAuth = () => {
    try {
      const host = (location.hostname || '').toLowerCase();
      return host.includes('accounts.google.com') || host.includes('accounts.youtube.com');
    } catch (e) { return false; }
  };
  const run = () => {
    if (onGoogleAuth()) return;
    try {
      // Inside a project, keep the killer light — heavy scans blanked All media
      if (/\/project\//i.test(location.pathname || '')) {
        hideUltraControls();
        hideGoogleCreditsWarningBanner();
        return;
      }
      killAccountPopupNow();
      hideExistingProjects();
      hideUltraControls();
      hideGoogleCreditsWarningBanner();
    } catch (e) {}
  };
  const obs = new MutationObserver(() => {
    if (installAccountKillerObserver._t) return;
    const delay = /\/project\//i.test(location.pathname || '') ? 600 : 120;
    installAccountKillerObserver._t = setTimeout(() => {
      installAccountKillerObserver._t = null;
      run();
    }, delay);
  });
  const start = () => {
    if (!document.documentElement) return;
    obs.observe(document.documentElement, { childList: true, subtree: true });
    run();
  };
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start);
})();


// CSS Injection
function applyCssRules() {
  // Never inject layout CSS on Google Sign-in â€” flex/centering breaks SPA
  // transitions (URL goes to /challenge/pwd while email card stays on screen).
  if (window.location.hostname.includes('accounts.google.com')) {
    const old = document.getElementById('flow-masking-style');
    if (old) old.remove();
    return;
  }
  let styleEl = document.getElementById('flow-stealth-styles');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'flow-stealth-styles';
    (document.head || document.documentElement).appendChild(styleEl);
  }

  let css = `
    /* Profile / account chrome */
    header [aria-label*="Google Account" i],
    header [aria-label*="Account menu" i],
    header a[href*="myaccount.google.com"],
    header button[aria-label*="Manage your Google Account" i],
    header button[aria-label*="Account" i],
    header img[src*="googleusercontent.com"] {
      display: none !important;
      visibility: hidden !important;
      pointer-events: none !important;
    }

    /* Google Flow credits nag + Add AI credits CTA */
    [role="alert"],
    [role="status"] {
      /* filtered in JS; keep selectors for common credit copy via attribute tricks below */
    }

    /* Hide ULTRA tier chips (exact-label match via JS; CSS backup for common patterns) */
    button[aria-label="Ultra" i],
    button[aria-label*="Ultra model" i],
    [role="radio"][aria-label="Ultra" i],
    [role="tab"][aria-label="Ultra" i] {
      display: none !important;
      visibility: hidden !important;
      pointer-events: none !important;
    }

    /* "Open in the Google Flow app" smart banner */
    [data-flow-hidden="1"] {
      display: none !important;
      visibility: hidden !important;
      pointer-events: none !important;
      height: 0 !important;
      max-height: 0 !important;
      overflow: hidden !important;
      opacity: 0 !important;
    }

    /* Gallery edit / delete affordances */
    flow-media-card button[aria-label*="Delete" i],
    flow-media-card button[aria-label*="Rename" i],
    flow-media-card button[aria-label*="Edit" i],
    flow-video-card button[aria-label*="Delete" i],
    flow-video-card button[aria-label*="Rename" i],
    flow-image-card button[aria-label*="Delete" i],
    flow-project-card button[aria-label*="Delete" i],
    flow-project-card button[aria-label*="Rename" i],
    [data-testid*="media"] button[aria-label*="Delete" i],
    [data-testid*="media"] button[aria-label*="Rename" i] {
      display: none !important;
      visibility: hidden !important;
      pointer-events: none !important;
    }
  `;

  if (maskingRules.cssSelectorsToHide && Array.isArray(maskingRules.cssSelectorsToHide)) {
    maskingRules.cssSelectorsToHide.forEach(sel => {
      if (sel && sel.trim()) {
        css += `
          ${sel} {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            pointer-events: none !important;
          }
        `;
      }
    });
  }

  if (maskingRules.customCss) {
    css += '\n' + maskingRules.customCss;
  }

  // Do NOT append Google Sign-in layout overrides here (breaks /challenge/pwd UI)

  styleEl.textContent = css;
}

// Model renaming disabled — leave Google Flow labels unchanged
function replaceModelNamesInNode(_node) {}

// DOM Observer â€” never thrash Google Sign-in; debounce heavily on Flow (black-screen freeze)
function initDomObserver() {
  let scheduled = null;
  const observer = new MutationObserver(() => {
    const host = location.hostname || '';
    if (host.includes('accounts.google.com')) return;
    if (scheduled) return;
    scheduled = setTimeout(() => {
      scheduled = null;
      maskFlowWorkspace();
      enforceModelRestrictions();
    }, /\/project\//i.test(location.pathname || '') ? 1600 : 800);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: false
  });

  if (!location.hostname.includes('accounts.google.com')) {
    replaceModelNamesInNode(document.body || document.documentElement);
    maskFlowWorkspace();
    enforceModelRestrictions();
  }
}

// Host IPC Listeners
ipcRenderer.on('apply-masking-rules', (event, rules) => {
  if (rules) {
    maskingRules = { ...maskingRules, ...rules, modelRenames: [] };
    applyCssRules();
    replaceModelNamesInNode(document.body || document.documentElement);
    maskFlowWorkspace();
    enforceModelRestrictions();
  }
});

ipcRenderer.on('apply-credentials', (event, creds) => {
  applyCredentialsFromHost(creds);
});

function applyCredentialsFromHost(creds) {
  if (!creds || !creds.email) return;
  const prevEmail = (credentials.email || '').toLowerCase();
  const nextEmail = String(creds.email || '').toLowerCase();
  const forceReset = !!creds.forceReset || (prevEmail && nextEmail && prevEmail !== nextEmail);
  credentials = { ...credentials, ...creds };
  console.log('[Flow Preload] Credentials applied for:', credentials.email, forceReset ? '(reset)' : '');
  const onFlow =
    (location.hostname || '').includes('flow.google.com') ||
    (location.hostname || '').includes('labs.google');
  // On Flow, never reset/re-run auto-login just because credentials arrived for
  // the first time in this document — that re-clicked Sign in after OAuth return.
  if (onFlow && !forceReset) {
    if (autoLoginState.done) return;
    setTimeout(() => runGoogleAutoLogin(), 200);
    return;
  }
  if (forceReset || !prevEmail) {
    resetAutoLoginState();
    credentials._otp = '';
  }
  setTimeout(() => runGoogleAutoLogin(), forceReset ? 500 : 200);
}

try {
  window.__flowApplyCreds = applyCredentialsFromHost;
  window.addEventListener('flow-apply-credentials', (ev) => {
    applyCredentialsFromHost(ev && ev.detail);
  });
} catch (e) {}

ipcRenderer.on('apply-otp', (event, data) => {
  const otp = data && (data.otp || data.value || data.code);
  if (!otp) return;
  credentials._otp = String(otp);
  autoLoginState.otpRequested = true;
  autoLoginState.submittedKeys.delete(`otp:${location.pathname}:fill`);
  console.log('[Flow Preload] TOTP received from host');
  setTimeout(() => runGoogleAutoLogin(), 250);
});

// Request credentials from host immediately
try {
  ipcRenderer.sendToHost('request-credentials');
} catch (e) {}

function driveGoogle2faClicks() {
  const host = location.hostname || '';
  if (!host.includes('accounts.google.com') && !host.includes('accounts.youtube.com')) return;
  const path = location.pathname || '';
  const now = Date.now();
  // SetSID / totp UI — request OTP; Next click is owned by runGoogleAutoLogin
  const totpEl = document.querySelector('input[name="totpPin"], input#totpPin, input[autocomplete="one-time-code"]');
  if (/\/challenge\/totp/i.test(path) || /\/SetSID/i.test(path) || totpEl) {
    if (now - (driveGoogle2faClicks._otpAt || 0) > 2000) {
      driveGoogle2faClicks._otpAt = now;
      try { ipcRenderer.sendToHost('request-otp'); } catch (e) {}
    }
    return;
  }
  if (now - (driveGoogle2faClicks._at || 0) < 1600) return;

  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  };
  const sendClick = (el, kind) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 2 || y < 2) return;
    driveGoogle2faClicks._at = Date.now();
    console.log('[Flow Preload] 2FA CDP click', kind, Math.round(x), Math.round(y));
    try { ipcRenderer.sendToHost('cdp-click', { x, y, kind }); } catch (e) {}
  };

  // g.co/sc / security-key prompt → Try another way
  if (/\/challenge\/sk/i.test(path)) {
    const tryAnother = Array.from(document.querySelectorAll('button, a, [role="button"], [role="link"], span')).find((el) =>
      /^try another way$/i.test((el.innerText || '').replace(/\s+/g, ' ').trim()) && visible(el)
    );
    if (tryAnother) sendClick(tryAnother, 'try-another');
    return;
  }

  // Method list → Google Authenticator
  if (/\/challenge\/selection/i.test(path)) {
    const isAuth = (raw) => {
      const t = String(raw || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!t || t.length > 180) return false;
      if (/one-time security code|tap yes|use your passkey|can.?t find an eligible/.test(t)) return false;
      return /google authenticator/.test(t) || (/authenticator/.test(t) && /code|verification|app/.test(t));
    };
    const cands = Array.from(document.querySelectorAll(
      '[data-challengeid], [data-challengetype], li, div[role="link"], div[role="button"], button, a'
    )).filter((el) => visible(el) && isAuth(el.getAttribute('aria-label') || el.innerText || ''));
    cands.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
    const el = cands[0] && (cands[0].closest('[data-challengeid], [data-challengetype], li, [role="link"], [role="button"], button, a') || cands[0]);
    if (el) sendClick(el, 'auth-app');
  }
}

// Periodic polling — keep Flow light to avoid black-screen freezes
setInterval(() => {
  const host = location.hostname || '';
  const onGoogleAuth = host.includes('accounts.google.com') || host.includes('accounts.youtube.com');
  const onGds = host.includes('gds.google.com');
  const onFlow = host.includes('flow.google.com') || host.includes('labs.google');
  if (onGoogleAuth) driveGoogle2faClicks();
  runGoogleAutoLogin();
  if (!onGoogleAuth) dismissGoogleInterstitials();
  if (onGoogleAuth || onGds) return;
  if (onFlow) {
    maskFlowWorkspace();
    enforceModelRestrictions();
    autoSelectLowerPriorityModel();
    forceRenameLiteEverywhere();
    hideTransientAccountUi();
    hideUltraControls();
    return;
  }
  maskFlowWorkspace();
  enforceModelRestrictions();
  autoSelectLowerPriorityModel();
  checkForNewGeneratedMedia();
}, 900);

document.addEventListener('DOMContentLoaded', () => {
  applyCssRules();
  initDomObserver();
  runGoogleAutoLogin();
  maskFlowWorkspace();
  enforceModelRestrictions();
  autoSelectLowerPriorityModel();
});

// React immediately when the user clicks mode tabs (Image / Video / Frames / Ingredients)
window.addEventListener('click', (e) => {
  const target = e.target;
  if (!target) return;
  const txt = (target.innerText || target.textContent || '').trim().toLowerCase();
  if (txt === 'image' || txt === 'video' || txt === 'frames' || txt === 'ingredients' || target.closest('[role="tab"], [role="radio"]')) {
    setTimeout(() => {
      enforceModelRestrictions();
      autoSelectLowerPriorityModel();
    }, 50);
  }
}, true);

} // end __flowInjectBootstrapped

