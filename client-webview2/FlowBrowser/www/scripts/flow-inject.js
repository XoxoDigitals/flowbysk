/* WebView2 bridge — replaces Electron ipcRenderer (TOP FRAME ONLY — never touch subframes) */
(function () {
  try {
    if (window !== window.top) return;
  } catch (e) {
    return;
  }
  if (
    window.__flowInjectBootstrapped ||
    location.hostname === 'app.flowbrowser.localhost' ||
    location.hostname === 'flowbrowser.local'
  ) {
    return;
  }
  window.__flowInjectBootstrapped = true;

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

// =========================================================================
// MASKING RULES & CREDENTIALS STATE
// =========================================================================

const TARGET_MODEL_DISPLAY = "Lower Priority";
const TARGET_MODEL_SHORT = "Priority";

/** Strip Material icon ligatures / chrome from model label text. */
function normalizeModelLabel(text) {
  return String(text || '')
    .replace(/volume_up|arrow_drop_down|check|done|chevron_right|expand_more|radio_button_checked|radio_button_unchecked/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Blocked model picker labels — hide ONLY these four so other options stay.
 * Keep "lower priority" / alternate variants and image models visible.
 */
function isBlockedModelLabel(_text) {
  // PakFlow mode: keep all standard models visible in dropdown; [Lower Priority] is hidden via data-hide-lp="true"
  return false;
}

let fakeModelName = '';
const creditMap = {
  'Omni 1.1 Flash': '12',
  'Veo 3.1 - Lite': '5',
  'Veo 3.1 - Fast': '10',
  'Veo 3.1 - Quality': '100'
};

let fakeBalance = 0;
let serverDatabaseCredits = 0;
let hasDatabaseCredits = false;
const activeGenerationJobs = [];

function recalcDisplayedBalance() {
  fakeBalance = Math.max(0, serverDatabaseCredits);
  try { localStorage.setItem('pakflow_db_credits', String(fakeBalance)); } catch (e) {}
  try {
    if (document.documentElement) {
      document.documentElement.style.setProperty('--flow-fake-credits-str', JSON.stringify(String(fakeBalance) + ' Google Flow credits'));
    }
    const totalCreditsLink = document.querySelector("a[href*='flow_ai_credits_page'], flow-account-panel .credits-count");
    if (totalCreditsLink) {
      totalCreditsLink.setAttribute('data-fake-total-credits', String(fakeBalance));
    }
  } catch (e) {}
}

function loadFakeBalance() {
  try {
    const raw = localStorage.getItem('pakflow_db_credits');
    if (raw !== null && !isNaN(parseInt(raw, 10))) {
      serverDatabaseCredits = Math.max(0, parseInt(raw, 10));
      fakeBalance = serverDatabaseCredits;
    }
  } catch (e) {}
  recalcDisplayedBalance();
  try {
    ipcRenderer.sendToHost('request-credits');
  } catch (e) {}
}

function saveFakeBalance(val) {
  serverDatabaseCredits = Math.max(0, parseInt(val, 10) || 0);
  recalcDisplayedBalance();
}

window.__flowSetDatabaseCredits = function (val) {
  if (val !== undefined && val !== null && !isNaN(Number(val))) {
    hasDatabaseCredits = true;
    serverDatabaseCredits = Math.max(0, Math.floor(Number(val)));
    recalcDisplayedBalance();
  }
};
ipcRenderer.on('apply-user-credits', (event, data) => {
  if (data && data.credits !== undefined) {
    window.__flowSetDatabaseCredits(data.credits);
  }
});
loadFakeBalance();

let maskingRules = {
  modelRenames: [],
  cssSelectorsToHide: [],
  customCss: ''
};

let credentials = {
  email: '',
  password: '',
  targetUrl: 'https://flow.google.com',
  imageOnly: false,
  serverId: ''
};
try {
  if (sessionStorage.getItem('__flow_image_only') === '1') {
    credentials.imageOnly = true;
  }
  const savedSrvId = sessionStorage.getItem('__flow_active_server_id');
  if (savedSrvId) {
    credentials.serverId = savedSrvId;
  }
} catch (e) {}

function isImageOnlyAccount() {
  return !!credentials.imageOnly;
}

function syncFlowPromptBoxLocalStorage() {
  try {
    const h = (window.location.hostname || '').toLowerCase();
    if (!h.includes('flow.google.com') && !h.includes('labs.google')) return;
    let curPromptState = {};
    try {
      const existingRaw = localStorage.getItem('FLOW_MAIN_PROMPT_BOX_STATE');
      if (existingRaw) curPromptState = JSON.parse(existingRaw) || {};
    } catch (e) {
      curPromptState = {};
    }
    curPromptState.aspectRatio = curPromptState.aspectRatio || 'LANDSCAPE';
    curPromptState.selectedImageModelFamily = curPromptState.selectedImageModelFamily || 'narwhal_display';
    curPromptState.selectedVideoModelFamily = 'veo_3_1_lite_low_priority';
    if (isImageOnlyAccount()) {
      curPromptState.imageOrVideoMode = 'IMAGE';
    } else {
      curPromptState.imageOrVideoMode = curPromptState.imageOrVideoMode || 'VIDEO';
    }
    curPromptState.outputsPerPrompt = 1;
    localStorage.setItem('FLOW_MAIN_PROMPT_BOX_STATE', JSON.stringify(curPromptState));

    const lsKeys = Object.keys(localStorage);
    for (const key of lsKeys) {
      if (key.includes('FLOW_') || key.includes('model') || key.includes('video') || key.includes('prompt')) {
        try {
          const val = localStorage.getItem(key);
          if (val && val.includes('"abra"')) {
            localStorage.setItem(key, val.replace(/"abra"/g, '"veo_3_1_lite_low_priority"'));
          }
        } catch (e) {}
      }
    }
  } catch (e) {}
}

syncFlowPromptBoxLocalStorage();

window.__flowSetImageOnlyMode = function (flag, serverId) {
  credentials.imageOnly = !!flag;
  if (serverId !== undefined && serverId !== null && String(serverId).trim() !== '') {
    const nextSrvId = String(serverId).trim();
    const changedSrv = credentials.serverId !== nextSrvId;
    credentials.serverId = nextSrvId;
    try {
      sessionStorage.setItem('__flow_active_server_id', credentials.serverId);
    } catch (e) {}
    if (changedSrv && typeof loadSavedProjectsFromDevice === 'function') {
      loadSavedProjectsFromDevice();
    }
  }
  try {
    sessionStorage.setItem('__flow_image_only', credentials.imageOnly ? '1' : '0');
  } catch (e) {}
  syncFlowPromptBoxLocalStorage();
  if (document.body) {
    if (credentials.imageOnly) {
      document.body.setAttribute('data-flow-image-only', 'true');
    } else {
      document.body.removeAttribute('data-flow-image-only');
      document.querySelectorAll('[data-hide-image-only="true"]').forEach((el) => {
        el.removeAttribute('data-hide-image-only');
        el.style.removeProperty('display');
      });
    }
  }
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
  selectionUiReloadTried: false,
  otpRequested: false,
  otpFilled: false,
  captchaPaused: false,
  captchaHits: 0,
  captchaMisses: 0,
  overlayDismissed: false,
  lastHostNotify: '',
};

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
  if (isImageOnlyAccount()) return 'image';
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
    let detectedModel = fakeModelName;
    if (!detectedModel) {
      const rawDom = getActiveDomModelText();
      if (rawDom.includes('Quality')) detectedModel = 'Veo 3.1 - Quality';
      else if (rawDom.includes('Fast')) detectedModel = 'Veo 3.1 - Fast';
      else if (rawDom.includes('Omni')) detectedModel = 'Omni 1.1 Flash';
      else if (rawDom.includes('Lite')) detectedModel = 'Veo 3.1 - Lite';
    }
    const mName = detectedModel && creditMap[detectedModel] ? detectedModel : 'Veo 3.1 - Fast';
    const mRate = parseInt(creditMap[mName] || '5', 10) || 5;
    return { type: 'video', modelName: mName, rate: mRate };
  }

  // Active mode is IMAGE (0 credit cost — free image generation):
  const imageSearchStr = reqStr + ' ' + domModelStr;
  if (imageSearchStr.includes('banana pro') || imageSearchStr.includes('nano banana pro') || imageSearchStr.includes('banana-pro') || imageSearchStr.includes('pro')) {
    return { type: 'image', modelName: 'Nano Banana Pro', rate: 0 };
  }
  if (imageSearchStr.includes('banana lite') || imageSearchStr.includes('banana 2 lite') || imageSearchStr.includes('nano banana lite') || imageSearchStr.includes('nano banana 2 lite') || imageSearchStr.includes('banana-lite') || imageSearchStr.includes('lite')) {
    return { type: 'image', modelName: 'Nano Banana Lite', rate: 0 };
  }
  return { type: 'image', modelName: 'Nano Banana 2', rate: 0 };
}

function showGenerationToast(type, modelName, amount, count, isRefund = false) {
  try {
    let toast = document.getElementById('flow-generation-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'flow-generation-toast';
      toast.style.cssText = `
        position: fixed;
        bottom: 68px;
        right: 22px;
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
    if (isRefund) {
      toast.style.borderColor = 'rgba(16, 185, 129, 0.55)';
      toast.innerHTML = `
        <span style="color:#10b981;font-size:15px;">⚡</span>
        <span>${modelName || label} (Failed)</span>
        <span style="background:rgba(16, 185, 129, 0.2); color:#34d399; padding:2px 8px; border-radius:4px; font-size:12px; margin-left:4px;">+${amount} Credits Refunded</span>
      `;
    } else {
      toast.style.borderColor = 'rgba(56, 189, 248, 0.4)';
      toast.innerHTML = `
        <span style="color:#38bdf8;font-size:15px;">⚡</span>
        <span>${modelName || label}</span>
        <span style="background:rgba(239, 68, 68, 0.2); color:#f87171; padding:2px 8px; border-radius:4px; font-size:12px; margin-left:4px;">-${amount} Credits</span>
      `;
    }
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';

    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
    }, 3800);
  } catch (err) {
    console.error('[Flow Toast Error]', err);
  }
}

// Immediate direct deduction (used only for 4K Upscale)
function deductCredits(modelDetails, count = 1, uniqueId = '') {
  if (uniqueId && processedGenerationIds.has(uniqueId)) return;
  if (uniqueId) processedGenerationIds.add(uniqueId);

  const effectiveCount = Math.max(1, count || 1);
  const { type, modelName, rate } = modelDetails;
  const totalAmount = rate * effectiveCount;
  const reason = `${modelName}: ${effectiveCount} ${type}(s) (${rate} cr/ea)`;

  serverDatabaseCredits = Math.max(0, serverDatabaseCredits - totalAmount);
  recalcDisplayedBalance();

  ipcRenderer.sendToHost('credit:deduct', {
    amount: totalAmount,
    count: effectiveCount,
    type,
    modelName,
    reason
  });

  showGenerationToast(type, modelName, totalAmount, effectiveCount, false);
}

// Start a tracked generation job: deducts ONCE on start (UI + DB) for every prompt (1st, 2nd, 3rd concurrent) and refunds if that job fails
let lastJobStartTime = 0;
let lastTypedPromptText = '';
let lastTypedPromptAt = 0;
const seenPendingTiles = new WeakSet();
const seenGridTiles = new WeakSet();
const seenErrorElements = new WeakSet();

function markExistingErrorsAsSeen() {
  try {
    const errCandidates = document.querySelectorAll('[role="alert"], [role="status"], mat-snack-bar-container, .mat-mdc-snack-bar-label, .mdc-snackbar__label, flow-grid-tile-container, [data-tile-id]');
    errCandidates.forEach((el) => {
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt && /\b(failed|unusual activity|couldn'?t generate|could not generate|generation failed|unable to generate|error generating|violates our|blocked by|something went wrong|try again later|prompt was blocked)\b/i.test(txt)) {
        seenErrorElements.add(el);
      }
      const state = inspectFlowGridTileState(el);
      if (state.hasErrorIcon) {
        seenErrorElements.add(el);
      }
    });
  } catch (e) {}
}

function getPromptTextboxContent() {
  try {
    const editors = document.querySelectorAll('div[role="textbox"], flow-rich-text-editor, textarea, [contenteditable="true"]');
    for (const ed of editors) {
      if (ed.closest('#flow-saved-projects-backdrop, #flow-my-projects-dock, header')) continue;
      const t = (ed.innerText || ed.value || ed.textContent || '').trim();
      if (t) return t;
    }
  } catch (e) {}
  return '';
}

function startGenerationJob(source = '', boundPendingTile = null) {
  const now = Date.now();
  // Short 250ms debounce only to prevent Enter + synthetic click on the exact same millisecond from double-firing
  if (!boundPendingTile && (now - lastJobStartTime < 250)) return null;
  lastJobStartTime = now;

  const mode = pendingGeneration ? pendingGeneration.modelDetails.type : getActivePromptMode();
  const multiplier = pendingGeneration ? (pendingGeneration.multiplier || 1) : getActiveBatchMultiplier();
  const details = pendingGeneration ? pendingGeneration.modelDetails : getGenerationModelDetails(mode);
  if (isImageOnlyAccount() || mode === 'image' || details.type === 'image' || !details.rate || details.rate <= 0) {
    pendingGeneration = null;
    isWaitingForPercentage = false;
    lastTypedPromptText = '';
    markInitialMediaAsSeen();
    return null;
  }
  const totalAmount = Math.max(1, details.rate * multiplier);

  pendingGeneration = null;
  isWaitingForPercentage = false;
  lastTypedPromptText = '';

  // Snapshot existing completed media and existing error cards before this job starts
  markInitialMediaAsSeen();
  markExistingErrorsAsSeen();

  const tileContainer = boundPendingTile ? boundPendingTile.closest('flow-grid-tile-container') : null;

  const job = {
    id: 'job_' + now + '_' + Math.random().toString(36).slice(2, 6),
    modelDetails: details,
    multiplier: multiplier,
    amount: totalAmount,
    startedAt: now,
    status: 'running',
    dbCommitted: true,
    refunded: false,
    sawProgress: !!boundPendingTile,
    lastProgressAt: boundPendingTile ? now : 0,
    pendingTileEl: boundPendingTile || null,
    tileContainerEl: tileContainer || null,
    projectPath: window.location.pathname,
    source: source
  };

  activeGenerationJobs.push(job);

  // Deduct ONCE immediately on start (both UI and DB stay 100% synced)
  serverDatabaseCredits = Math.max(0, serverDatabaseCredits - totalAmount);
  recalcDisplayedBalance();

  const { type, modelName, rate } = details;
  const reason = `${modelName}: Generated ${multiplier} ${type}(s) (${rate} cr/ea)`;
  ipcRenderer.sendToHost('credit:deduct', {
    amount: totalAmount,
    count: multiplier,
    type,
    modelName,
    reason,
    jobId: job.id
  });

  showGenerationToast(type, modelName, totalAmount, multiplier, false);
  console.log('[Flow Credit Engine] Started generation job (1x deduction):', job.id, modelName, '-' + totalAmount, 'Source:', source);
  return job;
}

function completeSpecificJob(job, triggerReason = '') {
  if (!job || job.status !== 'running') return false;
  job.status = 'completed';
  job.completedAt = Date.now();
  console.log('[Flow Credit Engine] Generation job completed (no 2nd deduction):', job.id, triggerReason);
  return true;
}

// Complete the oldest running job -> mark completed WITHOUT deducting a second time!
function completeOldestRunningJob(triggerReason = '') {
  const job = activeGenerationJobs.find((j) => j && j.status === 'running');
  return completeSpecificJob(job, triggerReason);
}

function failSpecificJob(job, failReason = '') {
  if (!job || job.refunded || job.status === 'failed') return false;

  job.status = 'failed';
  job.refunded = true;

  serverDatabaseCredits += job.amount;
  recalcDisplayedBalance();

  ipcRenderer.sendToHost('credit:refund', {
    amount: job.amount,
    count: job.multiplier,
    type: job.modelDetails.type,
    modelName: job.modelDetails.modelName,
    reason: 'Refund: ' + (failReason || 'generation failed'),
    jobId: job.id
  });

  console.log('[Flow Credit Engine] Generation job FAILED — refunded +' + job.amount + ' credits:', job.id, failReason);
  showGenerationToast(job.modelDetails.type, job.modelDetails.modelName, job.amount, job.multiplier, true);
  return true;
}

// Fail & refund the oldest running job (or most recently started running job if an immediate API error occurred)
function failOldestRunningJob(failReason = '') {
  let job = activeGenerationJobs.find((j) => j && j.status === 'running' && !j.refunded);
  return failSpecificJob(job, failReason);
}

// Helper to inspect a flow-grid-tile-container's live state (matches veo-content-bundle.js V() logic)
function inspectFlowGridTileState(tileEl) {
  if (!tileEl) return { hasResource: false, hasPending: false, hasErrorIcon: false };
  const videos = tileEl.querySelectorAll('video');
  let hasVideo = false;
  videos.forEach((v) => {
    if (v.src || v.currentSrc || v.querySelector('source[src]')) hasVideo = true;
  });
  const imgs = tileEl.querySelectorAll('img');
  let hasImage = false;
  imgs.forEach((im) => {
    const s = im.src || im.getAttribute('src') || '';
    if (s && !s.includes('avatar') && !s.includes('icon')) hasImage = true;
  });
  const hasResource = hasVideo || hasImage;

  const hasPendingTile = tileEl.querySelector('flow-pending-tile') !== null;
  let hasPercentage = false;
  const divs = tileEl.querySelectorAll('div, span');
  for (const d of divs) {
    if (d.children.length === 0 && /^\d+%$/.test((d.textContent || '').trim())) {
      hasPercentage = true;
      break;
    }
  }
  const hasPending = hasPendingTile || hasPercentage;

  let hasErrorIcon = false;
  const icons = tileEl.querySelectorAll('mat-icon, i.google-symbols, .material-icons, i');
  for (const ic of icons) {
    const it = (ic.textContent || '').trim().toLowerCase();
    if (it === 'warning' || it === 'warning_amber' || it === 'error' || it === 'error_outline' || it === 'report' || it === 'block') {
      hasErrorIcon = true;
      break;
    }
  }
  if (!hasErrorIcon && !hasResource && !hasPending) {
    const tileTxt = (tileEl.textContent || '').replace(/\s+/g, ' ').trim();
    if (/\b(failed|unusual activity|couldn'?t generate|could not generate|generation failed|unable to generate|error generating|violates our|blocked by|something went wrong|try again later|prompt was blocked)\b/i.test(tileTxt)) {
      hasErrorIcon = true;
    }
  }

  return { hasResource, hasPending, hasErrorIcon };
}

function isUploadOrAssetPendingTile(pt) {
  if (!pt) return false;
  if (pt.closest('flow-add-menu-popover-content, flow-add-menu-asset-list, flow-ingredient-bar, [role="dialog"], [role="menu"]')) {
    return true;
  }
  const txt = (pt.textContent || '').toLowerCase();
  if (txt.includes('upload') || txt.includes('importing')) return true;
  // Check if user uploaded a file very recently and no prompt was submitted
  if (window.__flowLastUploadActionAt && (Date.now() - window.__flowLastUploadActionAt < 25000)) {
    return true;
  }
  return false;
}

// Track file input selections & upload clicks so file uploads are never mistaken for video/image generations
document.addEventListener('change', (e) => {
  if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'file') {
    window.__flowLastUploadActionAt = Date.now();
  }
}, true);

document.addEventListener('drop', (e) => {
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    window.__flowLastUploadActionAt = Date.now();
  }
}, true);

// Scan all flow-pending-tile and flow-grid-tile-container elements to bind concurrent jobs & detect per-tile completion or failure
function updateConcurrentTileJobs() {
  const now = Date.now();

  // During initial 3.5s after page load or navigation, mark existing tiles as pre-existing
  if (!pageInitialLoadDone || now - lastNavigationTime < 3500) {
    document.querySelectorAll('flow-pending-tile').forEach((pt) => seenPendingTiles.add(pt));
    document.querySelectorAll('flow-grid-tile-container').forEach((gt) => seenGridTiles.add(gt));
    return;
  }

  // 1. Bind any newly mounted <flow-pending-tile> to an unlinked running job
  const pendingTiles = document.querySelectorAll('flow-pending-tile');
  for (const pt of pendingTiles) {
    if (seenPendingTiles.has(pt)) continue;
    seenPendingTiles.add(pt);

    const container = pt.closest('flow-grid-tile-container');
    if (container) seenGridTiles.add(container);

    if (isUploadOrAssetPendingTile(pt)) {
      continue;
    }

    // Look for an unlinked running job started recently by prompt submit
    const unlinkedJob = activeGenerationJobs.find(
      (j) => j && j.status === 'running' && !j.pendingTileEl && (now - j.startedAt < 15000)
    );
    if (unlinkedJob) {
      unlinkedJob.pendingTileEl = pt;
      unlinkedJob.tileContainerEl = container || null;
      unlinkedJob.sawProgress = true;
      unlinkedJob.lastProgressAt = now;
      console.log('[Flow Credit Engine] Linked pending tile to running job:', unlinkedJob.id);
    }
  }

  // 2. Check if any brand-new <flow-grid-tile-container> mounted with an EXPLICIT error/warning state
  const gridTiles = document.querySelectorAll('flow-grid-tile-container, [data-tile-id]');
  for (const gt of gridTiles) {
    if (seenGridTiles.has(gt) || seenErrorElements.has(gt)) continue;
    const state = inspectFlowGridTileState(gt);
    if (state.hasPending || state.hasResource) {
      seenGridTiles.add(gt);
      continue;
    }
    if (state.hasErrorIcon) {
      seenGridTiles.add(gt);
      seenErrorElements.add(gt);
      const unlinkedOrRunning = activeGenerationJobs.find((j) => j && j.status === 'running' && !j.refunded);
      if (unlinkedOrRunning) {
        failSpecificJob(unlinkedOrRunning, 'Tile mounted with explicit error/unusual activity');
      }
    }
  }

  // 3. Check each active running job's bound tile state — ONLY refund on explicit error!
  for (const job of activeGenerationJobs) {
    if (!job || job.status !== 'running' || job.refunded) continue;

    if (job.projectPath && window.location.pathname !== job.projectPath && !job.projectPath.endsWith('/')) {
      continue;
    }

    if (job.tileContainerEl || job.pendingTileEl) {
      const container = (job.tileContainerEl && job.tileContainerEl.isConnected)
        ? job.tileContainerEl
        : (job.pendingTileEl && job.pendingTileEl.isConnected ? job.pendingTileEl.closest('flow-grid-tile-container, [data-tile-id]') : null);

      const pendingStillConnected = !!(job.pendingTileEl && job.pendingTileEl.isConnected);

      if (container) {
        const state = inspectFlowGridTileState(container);
        if (state.hasResource) {
          completeSpecificJob(job, 'Bound tile media mounted');
          continue;
        }
        if (state.hasPending || pendingStillConnected) {
          job.sawProgress = true;
          job.lastProgressAt = now;
          job.pendingDisconnectedAt = 0;
          continue;
        }
        // Only refund when an explicit error icon or error message is present on the tile
        if (state.hasErrorIcon && !seenErrorElements.has(container)) {
          seenErrorElements.add(container);
          failSpecificJob(job, 'Bound tile showed explicit error');
          continue;
        }
      }
    }
  }
}

// Inspect JSON response data from Google Flow to detect generation completion or explicit API failure
function inspectDataForGenerations(url, data, requestBodyText = '') {
  if (!data || typeof data !== 'object') return;
  const urlLower = (url || '').toLowerCase();

  if (
    urlLower.includes('listprojects') ||
    urlLower.includes('listmedia') ||
    urlLower.includes('/projects?') ||
    urlLower.includes('userinfo') ||
    urlLower.includes('session') ||
    urlLower.includes('credits')
  ) {
    return;
  }

  // 1. Check for explicit API failure / RAI safety filter in generation response
  const resp = data.response || {};
  const hasExplicitError =
    !!data.error ||
    !!resp.error ||
    data.status === 'FAILED' ||
    data.state === 'FAILED' ||
    (Number(data.raiMediaFilteredCount) || 0) > 0 ||
    (Number(resp.raiMediaFilteredCount) || 0) > 0 ||
    (Array.isArray(data.raiMediaFilteredReasons) && data.raiMediaFilteredReasons.length > 0) ||
    (Array.isArray(resp.raiMediaFilteredReasons) && resp.raiMediaFilteredReasons.length > 0);

  if (hasExplicitError) {
    failOldestRunningJob('API generation error or safety filter');
    return;
  }

  // 2. Check for explicit media completion
  const hasVideos =
    (Array.isArray(data.generatedVideos) && data.generatedVideos.length > 0) ||
    (Array.isArray(data.videos) && data.videos.length > 0) ||
    (Array.isArray(resp.generatedVideos) && resp.generatedVideos.length > 0) ||
    (Array.isArray(resp.videos) && resp.videos.length > 0) ||
    !!(data.mediaUri || data.videoUri || data.videoUrl);

  const hasImages =
    (Array.isArray(data.generatedImages) && data.generatedImages.length > 0) ||
    (Array.isArray(data.images) && data.images.length > 0) ||
    (Array.isArray(resp.generatedImages) && resp.generatedImages.length > 0) ||
    (Array.isArray(resp.images) && resp.images.length > 0) ||
    !!(data.imageUri || data.imageUrl || data.encodedImage);

  if (hasVideos || hasImages) {
    completeOldestRunningJob('API media payload');
  }
}

// Hook generate button click and Enter key to immediately start a tracked generation job
function setupGenerateActionHook() {
  function isFlowGenerationHost() {
    const h = (window.location.hostname || '').toLowerCase();
    return h.includes('flow.google.com') || h.includes('labs.google');
  }

  function onGenerateTriggered(source = '') {
    if (!isFlowGenerationHost()) return;
    if (window.location.pathname.includes('/about')) {
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

    // Start the job and deduct immediately so 1st, 2nd, 3rd concurrent prompts always deduct!
    startGenerationJob(source);
  }

  document.addEventListener('click', (e) => {
    if (!isFlowGenerationHost()) return;
    const btn = e.target && e.target.closest && e.target.closest('button, [role="button"], a[role="button"]');
    if (!btn) return;
    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;
    
    const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();

    if (
      txt.includes('16:9') || txt.includes('9:16') || txt.includes('1:1') ||
      txt.includes('720p') || txt.includes('1080p') ||
      txt.includes('8s') || txt.includes('4s') ||
      /^x[1-4]$/.test(txt) ||
      txt === 'image' || txt === 'video' ||
      txt === 'frames' || txt === 'ingredients' ||
      txt === 'add' || txt.includes('upload') || txt.includes('drive_folder_upload') ||
      btn.getAttribute('aria-label') === 'Select model family' ||
      btn.closest('.prompt-settings-pill, flow-model-picker, flow-prompt-box-settings, flow-add-menu-popover-content, flow-ingredient-bar, #flow-my-projects-dock, #flow-saved-projects-backdrop, [role="menu"], [role="dialog"], .mat-mdc-menu-panel')
    ) {
      return;
    }

    const hasArrowForward = txt.includes('arrow_forward');
    const isGenerateIconBtn = btn.closest('flow-generate-icon-button') !== null;
    const isRedoTileBtn = btn.closest('flow-grid-tile-container') !== null && (txt === 'replay' || txt === 'refresh' || txt === 'undo');

    if (hasArrowForward || isGenerateIconBtn || isRedoTileBtn) {
      onGenerateTriggered('click-submit-btn');
    }
  }, true);

  document.addEventListener('keydown', (e) => {
    if (!isFlowGenerationHost()) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      const active = document.activeElement;
      const inPromptEditor =
        active &&
        (active.tagName === 'TEXTAREA' ||
         active.tagName === 'INPUT' ||
         active.getAttribute('role') === 'textbox' ||
         active.getAttribute('contenteditable') === 'true' ||
         active.closest('flow-rich-text-editor, form, [class*="prompt"], flow-prompt-box'));

      if (inPromptEditor) {
        const currentTxt = getPromptTextboxContent();
        const hadRecentTxt = lastTypedPromptText.length > 0 && (Date.now() - lastTypedPromptAt < 5000);
        if (currentTxt.length > 0 || hadRecentTxt) {
          onGenerateTriggered('enter-key');
        }
      }
    }
  }, true);
}

// Network hooks: watch generation & operation endpoints for completion or explicit error
(function installNetworkCreditHooks() {
  try {
    const isGenOrOpUrl = (url) => {
      const u = String(url || '').toLowerCase();
      if (u.includes('listprojects') || u.includes('listmedia') || u.includes('userinfo') || u.includes('log') || u.includes('telemetry')) {
        return false;
      }
      return (
        u.includes('batchgenerate') ||
        u.includes('batch_generate') ||
        u.includes('batchasyncgeneratevideo') ||
        u.includes('batchgenerateimages') ||
        u.includes('upsamplevideo') ||
        u.includes('yhhmef') ||
        u.includes('eb1hjf') ||
        u.includes('ogiz0b') ||
        u.includes('generatevideo') ||
        u.includes('generateimage') ||
        u.includes('checkoperations') ||
        u.includes('/operations/') ||
        (u.includes('aisandbox') && (u.includes('generate') || u.includes('flow') || u.includes('video') || u.includes('image') || u.includes('batch')))
      );
    };

    if (window.fetch) {
      const origFetch = window.fetch.bind(window);
      window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        return origFetch(input, init).then((res) => {
          try {
            if (isGenOrOpUrl(url)) {
              if (!res.ok && res.status >= 400) {
                failOldestRunningJob('Generation HTTP ' + res.status);
              } else if (res.ok && typeof res.clone === 'function') {
                res.clone().text().then((rawTxt) => {
                  if (!rawTxt) return;
                  if (rawTxt.includes('PUBLIC_ERROR_UNUSUAL_ACTIVITY') || rawTxt.includes('reCAPTCHA evaluation failed')) {
                    failOldestRunningJob('API unusual activity / reCAPTCHA error');
                    return;
                  }
                  try {
                    const data = JSON.parse(rawTxt);
                    inspectDataForGenerations(url, data);
                  } catch (e) {}
                }).catch(() => {});
              }
            }
          } catch (e) {}
          return res;
        });
      };
    }

    const XO = window.XMLHttpRequest;
    if (XO && XO.prototype) {
      const open = XO.prototype.open;
      const send = XO.prototype.send;
      XO.prototype.open = function (method, url) {
        this.__flowMethod = method;
        this.__flowUrl = url;
        return open.apply(this, arguments);
      };
      XO.prototype.send = function () {
        this.addEventListener('load', () => {
          try {
            if (!isGenOrOpUrl(this.__flowUrl)) return;
            if (this.status >= 400) {
              failOldestRunningJob('Generation XHR HTTP ' + this.status);
            } else if (this.status >= 200 && this.status < 300 && this.responseText) {
              if (this.responseText.includes('PUBLIC_ERROR_UNUSUAL_ACTIVITY') || this.responseText.includes('reCAPTCHA evaluation failed')) {
                failOldestRunningJob('API unusual activity / reCAPTCHA error');
                return;
              }
              try {
                const data = JSON.parse(this.responseText);
                inspectDataForGenerations(this.__flowUrl, data);
              } catch (e) {}
            }
          } catch (e) {}
        });
        return send.apply(this, arguments);
      };
    }
  } catch (e) {
    console.warn('[Flow Credit Engine] network hooks failed', e);
  }
})();

// DOM Canvas Card & Explicit Failure Alert Watcher Engine
const seenMediaElements = new Set();
const seenErrorSignATURES = new Set();
let pageInitialLoadDone = false;
let lastKnownPathname = window.location.pathname;
let lastNavigationTime = Date.now();

function markInitialMediaAsSeen() {
  try {
    const items = document.querySelectorAll(`
      video,
      img[src*="blob:"],
      img[src*="googleusercontent"],
      [data-testid*="media"],
      [class*="media-card"],
      flow-grid-tile-container,
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
  const vid = el.tagName === 'VIDEO' ? el : el.querySelector('video');
  const img = el.tagName === 'IMG' ? el : el.querySelector('img[src*="googleusercontent"], img[src*="blob:"]');
  return (vid && (vid.currentSrc || vid.src)) ||
         (img && img.src) ||
         el.getAttribute('data-id') ||
         el.getAttribute('data-media-id') ||
         el.id ||
         '';
}

function scanDomForFailedGenerations() {
  const hasRunningJob = activeGenerationJobs.some((j) => j && j.status === 'running' && !j.refunded);
  if (!hasRunningJob) return;

  // Match explicit generation failure messages in snackbars/alerts/tiles — never match "Privacy Policy" or account dialogs!
  const explicitFailRegex = /\b(couldn'?t generate|could not generate|failed to generate|generation failed|unable to generate|error generating|can'?t generate|violates our|blocked by|safety polic|something went wrong|try again later|prompt was blocked|we noticed some unusual activity|unusual activity)\b/i;
  const candidates = document.querySelectorAll('[role="alert"], [role="status"], mat-snack-bar-container, .mat-mdc-snack-bar-label, .mdc-snackbar__label, flow-grid-tile-container, [data-tile-id]');
  for (const el of candidates) {
    if (!el || seenErrorElements.has(el) || el.id === 'flow-generation-toast' || el.closest('#flow-generation-toast')) continue;
    if (el.closest('[role="menu"], .mat-mdc-menu-panel, header, footer, #flow-saved-projects-backdrop')) continue;
    const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!txt || txt.length > 320) continue;
    if (!explicitFailRegex.test(txt)) continue;

    seenErrorElements.add(el);
    const sig = txt.slice(0, 100);
    if (seenErrorSignATURES.has(sig)) continue;
    seenErrorSignATURES.add(sig);
    setTimeout(() => seenErrorSignATURES.delete(sig), 4000);

    failOldestRunningJob(txt.slice(0, 60));
    return;
  }
}

function checkForNewGeneratedMedia() {
  // If user navigated to a different project or page, mark all existing media as seen and NEVER bill for opening a project!
  if (window.location.pathname !== lastKnownPathname) {
    lastKnownPathname = window.location.pathname;
    lastNavigationTime = Date.now();
    pageInitialLoadDone = false;
    markInitialMediaAsSeen();
    markExistingErrorsAsSeen();
    document.querySelectorAll('flow-pending-tile').forEach((pt) => seenPendingTiles.add(pt));
    document.querySelectorAll('flow-grid-tile-container, [data-tile-id]').forEach((gt) => seenGridTiles.add(gt));
    setTimeout(() => {
      markInitialMediaAsSeen();
      markExistingErrorsAsSeen();
      document.querySelectorAll('flow-pending-tile').forEach((pt) => seenPendingTiles.add(pt));
      document.querySelectorAll('flow-grid-tile-container, [data-tile-id]').forEach((gt) => seenGridTiles.add(gt));
      pageInitialLoadDone = true;
    }, 3000);
    return;
  }

  // Always keep marking initial media during the first 3.5 seconds after navigation
  if (!pageInitialLoadDone || Date.now() - lastNavigationTime < 3500) {
    markInitialMediaAsSeen();
    markExistingErrorsAsSeen();
    return;
  }

  scanDomForFailedGenerations();

  const allMedia = document.querySelectorAll(`
    flow-grid-tile-container video,
    flow-grid-tile-container img[src*="googleusercontent"],
    flow-grid-tile-container img[src*="storage.googleapis"],
    flow-grid-tile-container img[src*="blob:"],
    [data-tile-id] video,
    [data-tile-id] img[src*="googleusercontent"],
    [data-tile-id] img[src*="storage.googleapis"],
    [data-tile-id] img[src*="blob:"],
    video[src],
    img[src*="blob:"]
  `);

  let newMediaCount = 0;
  for (const mediaEl of allMedia) {
    if (mediaEl.closest('header, [role="dialog"], [role="menu"], #flow-saved-projects-backdrop')) continue;
    const id = getMediaCardIdentifier(mediaEl);
    if (!id || seenMediaElements.has(id)) continue;
    seenMediaElements.add(id);
    newMediaCount++;
  }

  for (let i = 0; i < newMediaCount; i++) {
    completeOldestRunningJob('DOM media mounted');
  }
}

setTimeout(() => {
  markInitialMediaAsSeen();
  markExistingErrorsAsSeen();
  document.querySelectorAll('flow-pending-tile').forEach((pt) => seenPendingTiles.add(pt));
  document.querySelectorAll('flow-grid-tile-container, [data-tile-id]').forEach((gt) => seenGridTiles.add(gt));
  pageInitialLoadDone = true;
}, 3000);

// Initialize hooks immediately
setupGenerateActionHook();

// =========================================================================
// =========================================================================
// PAKFLOW v1.0.2 DOM MODEL RELABELING, AUTO-SETUP & CREDIT ENGINE
// =========================================================================

function cleanText(str) {
  return String(str || '')
    .replace(/volume_up|arrow_drop_down|check|done/gi, '')
    .replace(/leaving\s+[a-z]+\s+\d+/gi, '')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isHiddenNewModelText(rawText) {
  const t = cleanText(rawText || '').toLowerCase();
  return t.includes('omni') && !t.includes('1.1');
}

function getButtonCleanLabel(btn) {
  if (!btn) return '';
  try {
    let out = '';
    const walker = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const p = n.parentElement;
      if (p && p.closest && p.closest('mat-icon, i.google-symbols, .material-icons, .google-material-icons, svg')) continue;
      out += ' ' + (n.nodeValue || '');
    }
    return out.replace(/\s+/g, ' ').trim();
  } catch (e) {
    return String(btn.textContent || '').trim();
  }
}

function simulateClick(el) {
  if (!el) return;
  try { el.focus(); } catch (e) {}
  const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
  const cx = rect ? rect.left + rect.width / 2 : 0;
  const cy = rect ? rect.top + rect.height / 2 : 0;
  const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0, buttons: 1 };
  ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
    try {
      if (type.startsWith('pointer') && typeof PointerEvent !== 'undefined') {
        el.dispatchEvent(new PointerEvent(type, { ...opts, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
      } else {
        el.dispatchEvent(new MouseEvent(type, opts));
      }
    } catch (e) {}
  });
}

function purgeSignoutElements() {
  try {
    document.querySelectorAll('button, a, span, div, p').forEach((el) => {
      const txt = (el.textContent || '').toLowerCase();
      if (txt.includes('sign out of all accounts') || txt.includes('sign out')) {
        const target =
          el.closest('button') ||
          el.closest('a') ||
          (el.tagName === 'BUTTON' || el.tagName === 'A' ? el : null);
        if (target) {
          target.setAttribute('data-hide-signout', 'true');
          target.style.setProperty('display', 'none', 'important');
          target.style.setProperty('visibility', 'hidden', 'important');
          target.style.setProperty('pointer-events', 'none', 'important');
          target.style.setProperty('opacity', '0', 'important');
          target.style.setProperty('height', '0', 'important');
        }
      }
    });
  } catch (e) {}
}

let pendingCost = 0;
let isWaitingForPercentage = false;
let isLockedBySubmission = false;
let waitStartTime = 0;
let isGenerating = false;
let lastDeductTime = 0;
let setupState = 6;
let isImageModeActive = false;
let lastActionTime = 0;
let setupStartTime = 0;
let lastPakflowPathname = '';

function queueDeduction() {
  const mode = getActivePromptMode();
  const multiplier = getActiveBatchMultiplier();
  const details = getGenerationModelDetails(mode);
  pendingGeneration = {
    modelDetails: details,
    multiplier: multiplier,
    timestamp: Date.now(),
    billed: false,
    source: 'pakflow-submit'
  };
  startGenerationJob('pakflow-submit');
}

// Spoof Google Account Email -> flowcreator@gmail.com and Name -> Flow Creator
function spoofAccountIdentityInDom() {
  try {
    if (document.documentElement) {
      document.documentElement.style.setProperty('--flow-fake-credits-str', JSON.stringify(String(fakeBalance) + ' Google Flow credits'));
    }
    const emailRegex = /[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/g;
    // 1. Spoof aria-label / title on header profile buttons
    document.querySelectorAll('header button, header a, .header-user-button, flow-header-user-icon, [aria-label*="@"]').forEach((el) => {
      ['aria-label', 'title'].forEach((attr) => {
        const val = el.getAttribute(attr);
        if (val && emailRegex.test(val) && !val.includes('flowcreator@gmail.com')) {
          el.setAttribute(attr, 'Google Account: Flow Creator (flowcreator@gmail.com)');
        }
      });
    });

    // 2. Spoof visible email text nodes & adjacent display name in the account popup
    const nodes = document.querySelectorAll('div, span, p, a, h1, h2, h3, h4');
    for (const el of nodes) {
      if (el.children.length > 0) continue;
      const txt = (el.textContent || '').trim();
      if (!txt || txt.length > 120) continue;
      if (emailRegex.test(txt)) {
        if (txt !== 'flowcreator@gmail.com') {
          el.textContent = txt.replace(emailRegex, 'flowcreator@gmail.com');
        }
        // Check sibling above email (account holder's display name, e.g. "Jitendar Kumawat")
        const prev = el.previousElementSibling;
        if (prev && prev.children.length === 0) {
          const prevTxt = (prev.textContent || '').trim();
          if (prevTxt && prevTxt !== 'Flow Creator' && prevTxt !== 'Google' && !prevTxt.includes('@')) {
            prev.textContent = 'Flow Creator';
          }
        }
        // Also check parent container for single-letter avatar circle (e.g. "J")
        const card = el.closest('flow-account-panel, [aria-label="Account details"]') || (el.parentElement && el.parentElement.parentElement);
        if (card) {
          card.querySelectorAll('div, span').forEach((av) => {
            if (av.children.length === 0 && /^[A-Z]$/.test((av.textContent || '').trim())) {
              if (av.textContent.trim() !== 'F') av.textContent = 'F';
            }
          });
        }
      }
    }

    // 3. Mark Account details popup / flow-account-panel as spoofed once real email/name are replaced (or CSS ::after is active)
    document.querySelectorAll('flow-account-panel, [aria-label="Account details"]:not(button):not(.header-user-button):not(.account-switcher-placeholder)').forEach((popup) => {
      if (popup.querySelector('.header-user-button, flow-header-user-icon')) return;
      if (popup.tagName === 'FLOW-ACCOUNT-PANEL' || popup.querySelector('flow-account-panel')) {
        if (popup.getAttribute('data-flow-spoofed') !== '1') {
          popup.setAttribute('data-flow-spoofed', '1');
        }
        return;
      }
      const rawTxt = popup.textContent || '';
      const emailsInPopup = rawTxt.match(emailRegex) || [];
      const hasUnspoofedEmail = emailsInPopup.some((em) => em.toLowerCase() !== 'flowcreator@gmail.com');
      if (!hasUnspoofedEmail && emailsInPopup.length > 0) {
        if (popup.getAttribute('data-flow-spoofed') !== '1') {
          popup.setAttribute('data-flow-spoofed', '1');
        }
      }
    });
  } catch (e) {}
}

// Ensure top-right profile icon / ULTRA tier pill is NEVER hidden, while keeping Account details popup closed until profile avatar is clicked
function ensureProfileIconVisible() {
  try {
    const targets = document.querySelectorAll(
      'header button, header a, header img, .header-user-button, .header-user-button *, ' +
      'flow-header-user-icon, flow-header-user-icon *, ' +
      'flow-user-tier-chip, flow-user-tier-chip *, .tier-chip, [aria-label="ULTRA tier"], ' +
      '[aria-label*="Google Account" i], .account-switcher-placeholder, .account-switcher-placeholder *'
    );
    targets.forEach((el) => {
      if (!el || (el.tagName === 'A' && (el.classList.contains('switch-account-link') || (el.getAttribute('href') || '').includes('myaccount.google.com')))) {
        return;
      }
      if (el.getAttribute('aria-label') === 'Account details' && el.tagName !== 'BUTTON' && !el.classList.contains('header-user-button')) {
        return;
      }
      if (el.closest('flow-account-panel, [aria-label="Account details"]:not(button):not(.header-user-button):not(.account-switcher-placeholder):not(:has(.header-user-button))')) {
        return;
      }
      if ((el.textContent || '').toLowerCase().includes('sign out')) return;
      if (el.getAttribute('data-flow-hidden') === '1') {
        el.removeAttribute('data-flow-hidden');
        el.removeAttribute('aria-hidden');
      }
      el.style.removeProperty('display');
      el.style.removeProperty('visibility');
      el.style.removeProperty('opacity');
      el.style.removeProperty('pointer-events');
      el.style.removeProperty('width');
      el.style.removeProperty('height');
      el.style.removeProperty('max-height');
    });
  } catch (e) {}
}

// Strict click-gate so the Google Account Details popup ONLY appears when clicking the top-right profile avatar icon (J)
(function initProfilePopupClickGate() {
  if (window.__flowProfilePopupGateInstalled) return;
  window.__flowProfilePopupGateInstalled = true;

  function setPopupAllowed(allowed) {
    try {
      if (document.documentElement) {
        if (allowed) {
          spoofAccountIdentityInDom();
          if (document.documentElement.getAttribute('data-flow-profile-popup-open') !== '1') {
            document.documentElement.setAttribute('data-flow-profile-popup-open', '1');
          }
        } else if (document.documentElement.hasAttribute('data-flow-profile-popup-open')) {
          document.documentElement.removeAttribute('data-flow-profile-popup-open');
        }
      }
    } catch (e) {}
  }

  function isTierChipTarget(target) {
    if (!target || !target.closest) return false;
    return !!target.closest('flow-user-tier-chip, .tier-chip, [aria-label="ULTRA tier"]');
  }

  function isProfileAvatarClick(target, clientX, clientY) {
    if (!target || !target.closest) return false;
    if (isTierChipTarget(target)) return false;
    const userBtn = target.closest(
      '.header-user-button, flow-header-user-icon, .account-switcher-placeholder, header button[aria-label*="Google Account" i], header button[aria-label*="Account" i], header [aria-label*="Google Account" i], button[aria-label="Account details"]'
    );
    if (!userBtn) return false;
    // Must be in the top header area (top 90px of viewport)
    const rect = userBtn.getBoundingClientRect();
    if (rect.top > 90 || rect.height > 90) return false;
    // If .header-user-button contains both [ULTRA] and (J), only allow clicks on the right avatar side (not the ULTRA badge)
    const tierEl = userBtn.querySelector('flow-user-tier-chip, .tier-chip, [aria-label="ULTRA tier"]');
    if (tierEl && typeof clientX === 'number' && clientX > 0) {
      const tierRect = tierEl.getBoundingClientRect();
      if (tierRect.width > 0 && clientX >= tierRect.left && clientX <= tierRect.right + 2 && clientY >= tierRect.top && clientY <= tierRect.bottom) {
        return false;
      }
    }
    return true;
  }

  document.addEventListener('click', (e) => {
    try {
      const t = e.target;
      if (!t || !t.closest) return;

      // Clicking ULTRA chip itself should never open the account popup
      if (isTierChipTarget(t) && t.closest('.header-user-button, flow-header-user-icon, header')) {
        e.stopPropagation();
        e.preventDefault();
        setPopupAllowed(false);
        return;
      }

      // Clicking the profile avatar icon (J) in top-right header
      if (isProfileAvatarClick(t, e.clientX, e.clientY)) {
        const currentlyOpen = document.documentElement?.getAttribute('data-flow-profile-popup-open') === '1';
        const popupEl = document.querySelector('flow-account-panel, [aria-label="Account details"]');
        const popupVisible = popupEl && popupEl.getBoundingClientRect().width > 10;
        if (currentlyOpen && popupVisible) {
          setPopupAllowed(false);
        } else {
          setPopupAllowed(true);
        }
        return;
      }

      // Clicking close button inside Account details popup
      const inPopup = t.closest('flow-account-panel, [aria-label="Account details"]');
      if (inPopup) {
        const closeBtn = t.closest('button[aria-label*="Close" i], button[aria-label*="close" i], [role="button"][aria-label*="Close" i]');
        if (closeBtn) {
          setPopupAllowed(false);
        }
        return;
      }

      // Clicking anywhere else on screen closes / keeps closed the Account details popup
      setPopupAllowed(false);
    } catch (err) {}
  }, true);
})();

// =========================================================================
// SAVED PROJECTS HISTORY ENGINE (Auto-Save & "My Projects" Modal on Device — Scoped Per Account)
// =========================================================================
let savedProjectsList = [];
let lastAutoSavedProjectId = '';
let lastAutoSaveCheckAt = 0;

function getPerAccountProjectsKey() {
  const srvId = String(credentials.serverId || '').trim() || 'default_srv';
  return 'flow_saved_projects_v2_' + srvId;
}

function loadSavedProjectsFromDevice() {
  savedProjectsList = [];
  const key = getPerAccountProjectsKey();
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) savedProjectsList = parsed;
    }
  } catch (e) {}
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([key], (res) => {
        if (res && Array.isArray(res[key]) && res[key].length > 0) {
          mergeSavedProjects(res[key], false, true);
        }
      });
    }
  } catch (e) {}
  try {
    ipcRenderer.sendToHost('saved-projects:load');
  } catch (e) {}
  if (typeof updateMyProjectsUI === 'function') updateMyProjectsUI();
}

function mergeSavedProjects(incoming, persistBack = true, replaceAll = false) {
  if (!Array.isArray(incoming)) return;
  const currentSrvId = String(credentials.serverId || '').trim();
  const map = new Map();
  if (!replaceAll) {
    savedProjectsList.forEach((p) => {
      if (!p || !p.id) return;
      if (currentSrvId && p.serverId && p.serverId !== currentSrvId) return;
      map.set(p.id, p);
    });
  }
  incoming.forEach((p) => {
    if (!p || !p.id) return;
    if (currentSrvId && p.serverId && p.serverId !== currentSrvId) return;
    const existing = map.get(p.id);
    if (!existing || (p.updatedAt || 0) >= (existing.updatedAt || 0)) {
      map.set(p.id, { ...existing, ...p, serverId: p.serverId || currentSrvId || '' });
    }
  });
  savedProjectsList = Array.from(map.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const key = getPerAccountProjectsKey();
  try {
    localStorage.setItem(key, JSON.stringify(savedProjectsList));
  } catch (e) {}
  if (persistBack) {
    try {
      ipcRenderer.sendToHost('saved-projects:save', { projects: savedProjectsList, serverId: currentSrvId });
    } catch (e) {}
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [key]: savedProjectsList });
      }
    } catch (e) {}
  }
  updateMyProjectsUI();
}

ipcRenderer.on('apply-saved-projects', (event, data) => {
  if (!data) return;
  if (data.serverId && String(data.serverId).trim() !== '') {
    credentials.serverId = String(data.serverId).trim();
    try {
      sessionStorage.setItem('__flow_active_server_id', credentials.serverId);
    } catch (e) {}
  }
  if (Array.isArray(data.projects)) {
    mergeSavedProjects(data.projects, false, !!data.replace);
  }
});

function isGeminiHostUrl() {
  const h = (window.location.hostname || '').toLowerCase();
  return h.includes('gemini.google.com') || h.includes('bard.google.com');
}

function getCurrentProjectIdFromUrl() {
  if (isGeminiHostUrl()) {
    const m = (window.location.pathname || '').match(/\/app\/([0-9a-zA-Z_-]{6,})/);
    return m ? 'gemini_' + m[1] : '';
  }
  const m = (window.location.pathname || '').match(/\/project\/([0-9a-fA-F-]{8,})/);
  return m ? m[1] : '';
}

function detectCurrentProjectTitle() {
  if (isGeminiHostUrl()) {
    try {
      const queries = document.querySelectorAll('user-query, [data-test-id*="user-query"], .query-text, .user-query-container');
      for (const q of queries) {
        const qt = (q.textContent || '').replace(/\s+/g, ' ').trim();
        if (qt && qt.length >= 3) {
          return qt.length > 48 ? qt.slice(0, 48) + '…' : qt;
        }
      }
      const docTitle = (document.title || '').replace(/\s*[-–|]\s*Google Gemini$/i, '').replace(/^Google Gemini$/i, '').replace(/^Gemini$/i, '').trim();
      if (docTitle && docTitle.length >= 3) {
        return docTitle.length > 48 ? docTitle.slice(0, 48) + '…' : docTitle;
      }
    } catch (e) {}
    const now = new Date();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `Gemini Chat - ${months[now.getMonth()]} ${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }
  try {
    // Check top-left Flow project header date/title (e.g. "Nov 03 - 14:31")
    const dateRe = /^\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+\d{1,2}\s*[-–]\s*\d{1,2}:\d{2}$/i;
    const nodes = document.querySelectorAll('header span, header div, nav span, div, span');
    for (const el of nodes) {
      if (el.children.length > 0) continue;
      const t = (el.textContent || '').trim();
      if (dateRe.test(t)) {
        return 'Google Flow - ' + t;
      }
    }
  } catch (e) {}
  const now = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mon = months[now.getMonth()];
  const day = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `Google Flow - ${mon} ${day} - ${hh}:${mm}`;
}

function getScopedSavedProjectsList() {
  const isGem = isGeminiHostUrl();
  const currentSrvId = String(credentials.serverId || '').trim();
  return savedProjectsList.filter((p) => {
    if (!p || !p.id) return false;
    const itemIsGem = p.kind === 'gemini' || String(p.id).startsWith('gemini_') || String(p.url || '').includes('gemini.google.com');
    if (isGem !== itemIsGem) return false;
    if (!isGem && currentSrvId && p.serverId && p.serverId !== currentSrvId) return false;
    return true;
  });
}

function detectCurrentProjectThumbnail() {
  try {
    const imgs = document.querySelectorAll('img[src*="googleusercontent.com"], img[src*="ggpht.com"]');
    for (const img of imgs) {
      if (img.closest('header')) continue;
      const r = img.getBoundingClientRect();
      if (r.width >= 80 && r.height >= 50 && img.src) {
        return img.src;
      }
    }
  } catch (e) {}
  return '';
}

function saveCurrentProjectToDevice(manual = false) {
  const projId = getCurrentProjectIdFromUrl();
  if (!projId) return false;
  const isGem = isGeminiHostUrl();
  const currentSrvId = String(credentials.serverId || '').trim();
  const rawGemId = isGem ? projId.replace(/^gemini_/, '') : '';
  const fullUrl = isGem
    ? window.location.origin + '/app/' + rawGemId
    : window.location.origin + '/project/' + projId;
  const existing = savedProjectsList.find((p) => p.id === projId);
  const detectedTitle = detectCurrentProjectTitle();
  const thumb = isGem ? '' : (detectCurrentProjectThumbnail() || (existing && existing.thumbnail) || '');
  const now = new Date();

  const entry = {
    id: projId,
    kind: isGem ? 'gemini' : 'flow',
    serverId: currentSrvId,
    url: fullUrl,
    title: (existing && existing.customTitle) || detectedTitle || (existing && existing.title) || (isGem ? 'Google Gemini Chat' : 'Google Flow Project'),
    savedAt: existing && existing.savedAt ? existing.savedAt : now.toLocaleString(),
    updatedAt: existing && !manual ? existing.updatedAt : Date.now(),
    thumbnail: thumb
  };

  const filtered = savedProjectsList.filter((p) => p && p.id !== projId);
  savedProjectsList = [entry, ...filtered];
  const key = getPerAccountProjectsKey();
  try {
    localStorage.setItem(key, JSON.stringify(savedProjectsList));
  } catch (e) {}
  try {
    ipcRenderer.sendToHost('saved-projects:save', { projects: savedProjectsList, serverId: currentSrvId });
  } catch (e) {}
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [key]: savedProjectsList });
    }
  } catch (e) {}
  updateMyProjectsUI();
  return true;
}

function deleteSavedProject(projId) {
  savedProjectsList = savedProjectsList.filter((p) => p && p.id !== projId);
  const key = getPerAccountProjectsKey();
  const currentSrvId = String(credentials.serverId || '').trim();
  try {
    localStorage.setItem(key, JSON.stringify(savedProjectsList));
  } catch (e) {}
  try {
    ipcRenderer.sendToHost('saved-projects:save', { projects: savedProjectsList, serverId: currentSrvId });
  } catch (e) {}
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [key]: savedProjectsList });
    }
  } catch (e) {}
  updateMyProjectsUI();
  renderSavedProjectsModalCards();
}

function renderSavedProjectsModalCards() {
  const grid = document.getElementById('flow-saved-projects-grid');
  const countBadge = document.getElementById('flow-saved-projects-modal-count');
  const hTitle = document.getElementById('flow-saved-projects-modal-title');
  const isGem = isGeminiHostUrl();
  const scopedList = getScopedSavedProjectsList();
  if (hTitle) {
    hTitle.textContent = isGem ? '💬 My Saved Gemini Chats' : '🎬 My Saved Projects History';
  }
  if (countBadge) countBadge.textContent = `${scopedList.length} Saved`;
  if (!grid) return;
  grid.textContent = '';

  if (scopedList.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'grid-column: 1 / -1; text-align: center; padding: 48px 20px; color: #9ca3af; font-size: 14px;';
    empty.textContent = isGem
      ? 'No saved chats yet. Start a conversation in Google Gemini (or click "📌 Save Chat") and your personal chats will be saved here on your device!'
      : 'No saved projects yet. Create or open a project in Google Flow and it will be automatically saved here!';
    grid.appendChild(empty);
    return;
  }

  scopedList.forEach((proj) => {
    const card = document.createElement('div');
    card.className = 'flow-saved-proj-card';

    const preview = document.createElement('div');
    preview.className = 'flow-saved-proj-preview';
    if (proj.thumbnail && !isGem) {
      preview.style.backgroundImage = `url("${proj.thumbnail}")`;
      preview.style.backgroundSize = 'cover';
      preview.style.backgroundPosition = 'center';
    } else {
      const playIcon = document.createElement('div');
      playIcon.className = 'flow-saved-proj-play';
      playIcon.textContent = isGem ? '✦' : '▶';
      const subLbl = document.createElement('div');
      subLbl.className = 'flow-saved-proj-sub';
      subLbl.textContent = isGem ? 'Gemini Conversation' : 'Flow Video Project';
      preview.appendChild(playIcon);
      preview.appendChild(subLbl);
    }

    const delBtn = document.createElement('button');
    delBtn.className = 'flow-saved-proj-del';
    delBtn.title = isGem ? 'Remove saved chat' : 'Remove saved project';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      deleteSavedProject(proj.id);
    });
    preview.appendChild(delBtn);

    const body = document.createElement('div');
    body.className = 'flow-saved-proj-body';

    const titleEl = document.createElement('div');
    titleEl.className = 'flow-saved-proj-title';
    titleEl.textContent = proj.title || (isGem ? 'Google Gemini Chat' : 'Google Flow Project');

    const dateEl = document.createElement('div');
    dateEl.className = 'flow-saved-proj-date';
    dateEl.textContent = '📅 ' + (proj.savedAt || '');

    const openBtn = document.createElement('button');
    openBtn.className = 'flow-saved-proj-open';
    openBtn.textContent = isGem ? '💬 Open This Chat' : '▶ Open This Project';
    openBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const modal = document.getElementById('flow-saved-projects-backdrop');
      if (modal) modal.style.display = 'none';
      window.location.href = proj.url;
    });

    body.appendChild(titleEl);
    body.appendChild(dateEl);
    body.appendChild(openBtn);

    card.appendChild(preview);
    card.appendChild(body);
    grid.appendChild(card);
  });
}

function toggleSavedProjectsModal(forceOpen) {
  let backdrop = document.getElementById('flow-saved-projects-backdrop');
  const isGem = isGeminiHostUrl();
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'flow-saved-projects-backdrop';
    backdrop.addEventListener('click', (ev) => {
      if (ev.target === backdrop) backdrop.style.display = 'none';
    });

    const modal = document.createElement('div');
    modal.id = 'flow-saved-projects-modal';

    const header = document.createElement('div');
    header.className = 'flow-saved-proj-header';

    const titleWrap = document.createElement('div');
    titleWrap.style.cssText = 'display:flex;align-items:center;gap:10px;';

    const hTitle = document.createElement('span');
    hTitle.id = 'flow-saved-projects-modal-title';
    hTitle.style.cssText = 'font-size:16px;font-weight:700;color:#fff;';
    hTitle.textContent = isGem ? '💬 My Saved Gemini Chats' : '🎬 My Saved Projects History';

    const hBadge = document.createElement('span');
    hBadge.id = 'flow-saved-projects-modal-count';
    hBadge.style.cssText = 'background:rgba(139,92,246,0.25);border:1px solid rgba(139,92,246,0.5);color:#ddd6fe;font-size:12px;font-weight:600;padding:2px 10px;border-radius:999px;';
    hBadge.textContent = `${getScopedSavedProjectsList().length} Saved`;

    titleWrap.appendChild(hTitle);
    titleWrap.appendChild(hBadge);

    const actionsWrap = document.createElement('div');
    actionsWrap.style.cssText = 'display:flex;align-items:center;gap:10px;';

    if (isGem) {
      const newChatBtn = document.createElement('button');
      newChatBtn.style.cssText = 'background:linear-gradient(90deg,#7c3aed 0%,#6d28d9 100%);border:none;color:#fff;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;';
      newChatBtn.textContent = '＋ New Chat';
      newChatBtn.addEventListener('click', () => {
        backdrop.style.display = 'none';
        window.location.href = 'https://gemini.google.com/app';
      });
      actionsWrap.appendChild(newChatBtn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.style.cssText = 'background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#e5e7eb;width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => {
      backdrop.style.display = 'none';
    });

    actionsWrap.appendChild(closeBtn);
    header.appendChild(titleWrap);
    header.appendChild(actionsWrap);

    const grid = document.createElement('div');
    grid.id = 'flow-saved-projects-grid';

    modal.appendChild(header);
    modal.appendChild(grid);
    backdrop.appendChild(modal);
    (document.body || document.documentElement).appendChild(backdrop);
  }

  const isCurrentlyOpen = backdrop.style.display === 'flex';
  const nextOpen = forceOpen !== undefined ? forceOpen : !isCurrentlyOpen;
  if (nextOpen) {
    if (getCurrentProjectIdFromUrl()) saveCurrentProjectToDevice(false);
    renderSavedProjectsModalCards();
    backdrop.style.display = 'flex';
  } else {
    backdrop.style.display = 'none';
  }
}

function updateMyProjectsUI() {
  const host = (window.location.hostname || '').toLowerCase();
  const isGem = host.includes('gemini.google.com') || host.includes('bard.google.com');
  const isFlow = host.includes('flow.google.com') || host.includes('labs.google');
  if (!isFlow && !isGem) return;
  if (!document.body) return;

  const scopedCount = getScopedSavedProjectsList().length;

  let container = document.getElementById('flow-my-projects-dock');
  if (!container) {
    container = document.createElement('div');
    container.id = 'flow-my-projects-dock';

    if (isGem) {
      const saveChatBtn = document.createElement('button');
      saveChatBtn.id = 'flow-save-current-project-btn';
      saveChatBtn.type = 'button';
      saveChatBtn.textContent = '📌 Save Chat';
      saveChatBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const saved = saveCurrentProjectToDevice(true);
        if (saved) {
          saveChatBtn.textContent = '✓ Chat Saved!';
          setTimeout(() => {
            if (saveChatBtn.isConnected) saveChatBtn.textContent = '📌 Save Chat';
          }, 1800);
        } else {
          saveChatBtn.textContent = 'Send a message first';
          setTimeout(() => {
            if (saveChatBtn.isConnected) saveChatBtn.textContent = '📌 Save Chat';
          }, 1800);
        }
      });
      container.appendChild(saveChatBtn);
    }

    const myProjBtn = document.createElement('button');
    myProjBtn.id = 'flow-my-projects-btn';
    myProjBtn.type = 'button';

    const iconSpan = document.createElement('span');
    iconSpan.id = 'flow-my-projects-label';
    iconSpan.textContent = isGem ? '💬 My Chats' : '🎬 My Projects';

    const countSpan = document.createElement('span');
    countSpan.id = 'flow-my-projects-count';
    countSpan.textContent = String(scopedCount);

    myProjBtn.appendChild(iconSpan);
    myProjBtn.appendChild(countSpan);
    myProjBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      toggleSavedProjectsModal();
    });

    container.appendChild(myProjBtn);
    document.body.appendChild(container);
  }

  if (!isGem) {
    const legacySaveBtn = document.getElementById('flow-save-current-project-btn');
    if (legacySaveBtn) legacySaveBtn.remove();
  }

  const labelEl = document.getElementById('flow-my-projects-label');
  if (labelEl) labelEl.textContent = isGem ? '💬 My Chats' : '🎬 My Projects';

  const countEl = document.getElementById('flow-my-projects-count');
  if (countEl) countEl.textContent = String(scopedCount);
}

loadSavedProjectsFromDevice();

(function initPakflowDomEngine() {
  const isFlowHost = () => {
    const h = (window.location.hostname || '').toLowerCase();
    return h.includes('flow.google.com') || h.includes('labs.google');
  };
  const isGeminiHost = () => {
    const h = (window.location.hostname || '').toLowerCase();
    return h.includes('gemini.google.com') || h.includes('bard.google.com');
  };
  const isProtectedWorkspaceHost = () => isFlowHost() || isGeminiHost();

  try {
    const savedFakeModel = sessionStorage.getItem('__pakflow_fake_model');
    if (savedFakeModel && creditMap[savedFakeModel]) {
      fakeModelName = savedFakeModel;
    } else {
      fakeModelName = 'Veo 3.1 - Lite';
    }
  } catch (e) {
    fakeModelName = 'Veo 3.1 - Lite';
  }

  function injectPakflowStyles() {
    if (!isProtectedWorkspaceHost()) return;
    if (!document.getElementById('pakflow-core-style')) {
      const style = document.createElement('style');
      style.id = 'pakflow-core-style';
      style.textContent =
        "button[data-fake-model],[role='combobox'][data-fake-model]{color:transparent!important;position:relative!important}" +
        "button[data-fake-model] *:not(i):not(.google-symbols):not(mat-icon):not(svg):not(path),[role='combobox'][data-fake-model] *:not(i):not(.google-symbols):not(mat-icon):not(svg):not(path){color:transparent!important}" +
        "button[data-fake-model]::after,[role='combobox'][data-fake-model]::after{content:attr(data-fake-model)!important;position:absolute!important;left:var(--fake-model-left,14px)!important;top:50%!important;transform:translateY(-50%)!important;color:#fff!important;font-family:'Google Sans Text','Google Sans',sans-serif!important;font-size:13px!important;font-weight:500!important;pointer-events:none!important;white-space:nowrap!important}" +
        "button[data-fake-model] i,button[data-fake-model] .google-symbols,button[data-fake-model] mat-icon,button[data-fake-model] svg,[role='combobox'][data-fake-model] i,[role='combobox'][data-fake-model] .google-symbols,[role='combobox'][data-fake-model] mat-icon,[role='combobox'][data-fake-model] svg{color:#fff!important;visibility:visible!important}" +
        "flow-menu-item[data-hide-lp='true'],[role='menuitem'][data-hide-lp='true'],[role='option'][data-hide-lp='true']{display:none!important;height:0!important;min-height:0!important;max-height:0!important;overflow:hidden!important;opacity:0!important;padding:0!important;margin:0!important;border:0!important;pointer-events:none!important}" +
        "flow-menu-item:has([data-hide-lp='true']){display:none!important;height:0!important;min-height:0!important;max-height:0!important;overflow:hidden!important;opacity:0!important;padding:0!important;margin:0!important;border:0!important;pointer-events:none!important}" +
        "flow-menu-item[data-fake-active='true'] button,[role='menuitem'][data-fake-active='true'],[role='option'][data-fake-active='true']{background-color:rgba(255,255,255,.12)!important;border-radius:12px!important}" +
        "flow-menu-item[data-fake-inactive='true'] button,[role='menuitem'][data-fake-inactive='true'],[role='option'][data-fake-inactive='true']{background-color:transparent!important}" +
        "[data-pakflow-autosetup-hide='true']{opacity:0!important;pointer-events:none!important;transition:none!important}" +
        "body[data-pakflow-boot-hide='true'] [role='dialog'],body[data-pakflow-boot-hide='true'] [data-radix-popper-content-wrapper],body[data-pakflow-boot-hide='true'] .cdk-overlay-pane,body[data-pakflow-boot-hide='true'] flow-prompt-box-settings,body[data-pakflow-boot-hide='true'] [role='menu'],body[data-pakflow-boot-hide='true'] [role='listbox']{opacity:0!important;pointer-events:none!important;transition:none!important}" +
        "a[data-fake-credits]{color:transparent!important;position:relative!important}" +
        "a[data-fake-credits] *{color:transparent!important}" +
        "a[data-fake-credits]::after{content:attr(data-fake-credits) ' credits'!important;position:absolute!important;left:0.25rem!important;top:0!important;color:#DADCE0!important;text-decoration:underline!important;white-space:nowrap!important}" +
        "button[data-hide-tab='true'],[data-hide-tab='true'],mat-button-toggle:has(button[data-hide-tab='true']),mat-button-toggle:has([data-hide-tab='true']){display:none!important}" +
        "mat-button-toggle{flex:1!important;}" +
        "button[data-hide-submit='true']{display:none!important;pointer-events:none!important;opacity:0!important}" +
        "button[data-hide-signout='true'],[data-hide-signout='true']{display:none!important;visibility:hidden!important;pointer-events:none!important;opacity:0!important;height:0!important;min-height:0!important;padding:0!important;margin:0!important;}" +
        "button[data-hide-agent='true'],flow-agent-mode-toggle-chip[data-hide-agent='true'],[data-pakflow-agent-hidden='true']{display:none!important;visibility:hidden!important;pointer-events:none!important;width:0!important;height:0!important;opacity:0!important;}" +
        "[data-hide-image-only='true'],mat-button-toggle:has([data-hide-image-only='true']){display:none!important;visibility:hidden!important;pointer-events:none!important;width:0!important;height:0!important;opacity:0!important;overflow:hidden!important;}" +
        "body[data-flow-image-only='true'] flow-agent-panel,body[data-flow-image-only='true'] flow-agent-mode-toggle-chip{display:none!important;visibility:hidden!important;pointer-events:none!important;}" +
        "a[href*='flow_ai_credits_page']{font-size:0!important;color:transparent!important;pointer-events:none!important;}" +
        "a[href*='flow_ai_credits_page']>*{display:none!important;}" +
        "a[href*='flow_ai_credits_page']::after{content:attr(data-fake-total-credits) ' Google Flow credits'!important;font-size:16px!important;color:#fff!important;visibility:visible!important;text-decoration:underline!important;white-space:nowrap!important;}" +
        "flow-account-panel .user-email{font-size:0!important;color:transparent!important;}" +
        "flow-account-panel .user-email::after{content:'flowcreator@gmail.com'!important;font-size:12px!important;color:#c4c7c5!important;visibility:visible!important;}" +
        "flow-account-panel .user-name{font-size:0!important;color:transparent!important;}" +
        "flow-account-panel .user-name::after{content:'Flow Creator'!important;font-size:14px!important;font-weight:500!important;color:#e3e3e3!important;visibility:visible!important;}" +
        "flow-account-panel .credits-count{font-size:0!important;color:transparent!important;pointer-events:none!important;text-decoration:none!important;}" +
        "flow-account-panel .credits-count>*{display:none!important;}" +
        "flow-account-panel .credits-count::after{content:var(--flow-fake-credits-str,'0 Google Flow credits')!important;font-size:16px!important;font-weight:500!important;color:#fff!important;visibility:visible!important;text-decoration:underline!important;white-space:nowrap!important;}" +
        "flow-account-panel .switch-account-link,flow-account-panel .sign-out-button,a.switch-account-link{display:none!important;visibility:hidden!important;pointer-events:none!important;}" +
        "flow-account-panel .upsell-link,a.upsell-link{pointer-events:none!important}" +
        "flow-account-panel .upsell-link .mdc-button__label,a.upsell-link span.mdc-button__label{font-size:0!important}" +
        "flow-account-panel .upsell-link .mdc-button__label::after,a.upsell-link span.mdc-button__label::after{content:'Google Ultra Plan 20x'!important;font-size:14px!important;color:#000!important}" +
        "#ct-blur-overlay { position: fixed !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important; backdrop-filter: blur(10px) !important; background: rgba(0,0,0,0.6) !important; z-index: 2147483640 !important; pointer-events: auto !important; }" +
        "button[data-elevate-btn='true'],[data-elevate-btn='true'] { z-index: 2147483641 !important; box-shadow: 0 0 0 2px rgba(255,255,255,0.1), 0 0 30px rgba(255,255,255,0.3) !important; }" +
        "flow-credit-banner,.credit-banner{display:none!important}" +
        ".mavatar-footer-row,.mavatar-footer-row.collapsed,mavatar-footer-row,expandable-section[storagekey='chats'],[data-test-id='chats-expandable-section'],#sidenav-section-content-chats,#sidenav-section-content-chats .chat-history,#sidenav-section-content-chats .chat-history-list,conversations-list[data-test-id='all-conversations'],[data-test-id='all-conversations'],gem-nav-list-item[data-test-id='conversation']{display:none!important;visibility:hidden!important;height:0!important;min-height:0!important;max-height:0!important;overflow:hidden!important;opacity:0!important;pointer-events:none!important;}" +
        "model-response a,model-response a[href],message-content a,message-content a[href],user-query a,user-query a[href],.response-container a,.query-content a,.user-query-container a,.markdown a,chat-window a,source-footnote,inline-source-citation,sources-carousel,sources-carousel-inline,fact-check-evaluator,[data-test-id*='source'],button[aria-label*='source' i],button[aria-label*='Google Help' i]{pointer-events:none!important;cursor:text!important;text-decoration:none!important;}" +
        "header button,header a,header img,.header-user-button,.header-user-button *,flow-header-user-icon,flow-header-user-icon *,flow-user-tier-chip,.tier-chip,[aria-label='ULTRA tier'],[aria-label*='Google Account' i],.account-switcher-placeholder{visibility:visible!important;opacity:1!important;pointer-events:auto!important}" +
        "html:not([data-flow-profile-popup-open='1']) [aria-label='Account details']:not(button):not(.header-user-button):not(.account-switcher-placeholder):not(:has(.header-user-button)){display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important;}" +
        "[aria-label='Account details']:not(button):not(.header-user-button):not(.account-switcher-placeholder):not(:has(.header-user-button)):not(:has(flow-account-panel)):not([data-flow-spoofed='1']){visibility:hidden!important;opacity:0!important;pointer-events:none!important;}" +
        "#flow-my-projects-dock{position:fixed!important;bottom:18px!important;right:22px!important;left:auto!important;z-index:2147483645!important;display:flex!important;align-items:center!important;gap:10px!important;font-family:'Plus Jakarta Sans','Google Sans Text',sans-serif!important;}" +
        "#flow-my-projects-btn,#flow-save-current-project-btn{display:inline-flex!important;align-items:center!important;gap:8px!important;background:rgba(22,19,36,0.94)!important;border:1px solid rgba(139,92,246,0.45)!important;color:#f3f4f6!important;padding:8px 16px!important;border-radius:999px!important;font-size:13px!important;font-weight:600!important;cursor:pointer!important;box-shadow:0 8px 24px rgba(0,0,0,0.6)!important;transition:all .18s ease!important;}" +
        "#flow-my-projects-btn:hover,#flow-save-current-project-btn:hover{background:rgba(38,31,64,0.98)!important;border-color:rgba(167,139,250,0.8)!important;transform:translateY(-1px)!important;}" +
        "#flow-my-projects-count{background:rgba(139,92,246,0.35)!important;color:#ddd6fe!important;padding:1px 8px!important;border-radius:999px!important;font-size:11px!important;font-weight:700!important;}" +
        "#flow-saved-projects-backdrop{position:fixed!important;inset:0!important;background:rgba(0,0,0,0.72)!important;backdrop-filter:blur(6px)!important;z-index:2147483646!important;display:none;align-items:center!important;justify-content:center!important;font-family:'Plus Jakarta Sans','Google Sans Text',sans-serif!important;}" +
        "#flow-saved-projects-modal{width:92vw!important;max-width:960px!important;max-height:82vh!important;background:rgba(19,17,28,0.97)!important;border:1px solid rgba(139,92,246,0.38)!important;border-radius:16px!important;padding:22px!important;display:flex!important;flex-direction:column!important;gap:18px!important;box-shadow:0 24px 64px rgba(0,0,0,0.85)!important;}" +
        ".flow-saved-proj-header{display:flex!important;align-items:center!important;justify-content:space-between!important;padding-bottom:12px!important;border-bottom:1px solid rgba(255,255,255,0.08)!important;}" +
        "#flow-saved-projects-grid{display:grid!important;grid-template-columns:repeat(auto-fill,minmax(210px,1fr))!important;gap:16px!important;overflow-y:auto!important;padding-right:4px!important;max-height:65vh!important;}" +
        ".flow-saved-proj-card{background:rgba(30,27,46,0.85)!important;border:1px solid rgba(139,92,246,0.22)!important;border-radius:12px!important;overflow:hidden!important;display:flex!important;flex-direction:column!important;transition:border-color .18s ease,transform .18s ease!important;}" +
        ".flow-saved-proj-card:hover{border-color:rgba(139,92,246,0.65)!important;transform:translateY(-2px)!important;}" +
        ".flow-saved-proj-preview{height:112px!important;background:linear-gradient(135deg,#201a3a 0%,#141124 100%)!important;position:relative!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;gap:6px!important;}" +
        ".flow-saved-proj-play{color:#a78bfa!important;font-size:20px!important;}" +
        ".flow-saved-proj-sub{color:#a78bfa!important;font-size:11px!important;font-weight:500!important;opacity:0.85!important;}" +
        ".flow-saved-proj-del{position:absolute!important;top:8px!important;right:8px!important;width:24px!important;height:24px!important;border-radius:999px!important;background:rgba(0,0,0,0.65)!important;border:1px solid rgba(255,255,255,0.18)!important;color:#d1d5db!important;font-size:11px!important;cursor:pointer!important;display:flex!important;align-items:center!important;justify-content:center!important;}" +
        ".flow-saved-proj-del:hover{background:#ef4444!important;color:#fff!important;border-color:#ef4444!important;}" +
        ".flow-saved-proj-body{padding:12px!important;display:flex!important;flex-direction:column!important;gap:6px!important;}" +
        ".flow-saved-proj-title{color:#fff!important;font-size:13px!important;font-weight:700!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;}" +
        ".flow-saved-proj-date{color:#9ca3af!important;font-size:11px!important;margin-bottom:4px!important;}" +
        ".flow-saved-proj-open{width:100%!important;background:linear-gradient(90deg,#7c3aed 0%,#6d28d9 100%)!important;border:none!important;color:#fff!important;padding:8px 12px!important;border-radius:8px!important;font-size:12px!important;font-weight:600!important;cursor:pointer!important;transition:opacity .15s ease!important;}" +
        ".flow-saved-proj-open:hover{opacity:0.92!important;}";
      (document.head || document.documentElement).appendChild(style);
    }
  }

  if (document.documentElement) injectPakflowStyles();
  else document.addEventListener('DOMContentLoaded', injectPakflowStyles);

  try {
    let lastSignoutObsAt = 0;
    const signoutObserver = new MutationObserver(() => {
      if (!isProtectedWorkspaceHost()) return;
      const now = Date.now();
      if (now - lastSignoutObsAt < 500) return;
      lastSignoutObsAt = now;
      purgeSignoutElements();
      spoofAccountIdentityInDom();
    });
    if (document.documentElement) {
      signoutObserver.observe(document.documentElement, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        if (document.documentElement) {
          signoutObserver.observe(document.documentElement, { childList: true, subtree: true });
        }
      });
    }
  } catch (e) {}

  // Block sign-out clicks and disable all links inside Gemini responses / user messages
  ['click', 'auxclick', 'mousedown', 'pointerdown'].forEach((evtName) => {
    document.addEventListener(evtName, (e) => {
      if (!isProtectedWorkspaceHost()) return;
      const t = e.target;
      if (!t || !t.closest) return;
      const btn = t.closest('button, a, [role="button"]');
      if (btn && (btn.textContent || '').toLowerCase().includes('sign out')) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        btn.style.setProperty('display', 'none', 'important');
        return false;
      }
      if (isGeminiHost()) {
        if (t.closest('#flow-my-projects-dock, #flow-saved-projects-backdrop')) return;
        const msgOrRespLink = t.closest(
          'model-response a, message-content a, user-query a, .markdown a, .response-container a, .query-content a, .user-query-container a, chat-window a, main a, [role="main"] a, source-footnote, inline-source-citation, sources-carousel, sources-carousel-inline, [data-test-id*="source"]'
        );
        if (msgOrRespLink) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          return false;
        }
        const anyLink = t.closest('a[href], [role="link"]');
        if (anyLink) {
          const rawHref = (anyLink.getAttribute('href') || '').trim();
          const isInternalGem = rawHref.startsWith('/app') || rawHref.startsWith('https://gemini.google.com/app');
          const isTopSignIn = rawHref.includes('ServiceLogin') && !rawHref.toLowerCase().includes('recovery');
          if (!isInternalGem && !isTopSignIn) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            return false;
          }
        }
      }
    }, true);
  });

  function matchKnownModelName(rawItemText) {
    const cleaned = cleanText(rawItemText || '').replace(/\s*\[Lower Priority\]/gi, '').trim();
    if (!cleaned) return '';
    if (creditMap[cleaned]) return cleaned;
    const lower = cleaned.toLowerCase();
    if (lower.includes('omni')) return 'Omni 1.1 Flash';
    if (lower.includes('quality')) return 'Veo 3.1 - Quality';
    if (lower.includes('fast')) return 'Veo 3.1 - Fast';
    if (lower.includes('lite')) return 'Veo 3.1 - Lite';
    for (const k of Object.keys(creditMap)) {
      if (cleaned.includes(k)) return k;
    }
    return '';
  }

  function findBestBackendModelItem(allMenuItems) {
    const items = Array.from(
      allMenuItems ||
      document.querySelectorAll('.cdk-overlay-container flow-menu-item, .cdk-overlay-container [role="menuitem"], flow-menu-item, [role="menuitem"], [role="option"]')
    );
    const lpTarget =
      items.find((mi) => {
        const t = cleanText(mi.textContent);
        return t.includes('Lower Priority') && t.includes('Fast');
      }) ||
      items.find((mi) => {
        const t = cleanText(mi.textContent);
        return t.includes('Lower Priority') && t.includes('Lite');
      }) ||
      items.find((mi) => cleanText(mi.textContent).includes('Lower Priority'));
    if (lpTarget) return { target: lpTarget, isLp: true };

    // Fallback when account has no [Lower Priority] option: use Veo 3.1 - Lite
    const liteTarget = items.find((mi) => {
      const t = cleanText(mi.textContent);
      return t.includes('Veo') && t.includes('Lite') && !t.includes('Lower Priority');
    });
    if (liteTarget) return { target: liteTarget, isLp: false };
    return { target: null, isLp: false };
  }

  function findModelDropdownButton() {
    const settingsBtns = Array.from(document.querySelectorAll('flow-prompt-box-settings button, flow-prompt-box-settings [role="combobox"]'));
    const inSettings = settingsBtns.find((b) => {
      const txt = (b.textContent || '').replace(/\s+/g, ' ').trim();
      if (!txt || txt.length > 80) return false;
      const cleanLbl = getButtonCleanLabel(b).toLowerCase();
      if (/^(image|video|videos|frames|ingredients|4s|6s|8s|10s|x[1-4]|[1-4]x|16:9|9:16|1:1|4:3|3:4|360p|720p|1080p)$/i.test(cleanLbl)) return false;
      return /Veo|Omni|Lower Priority|Fast|Quality|Lite|Abra/i.test(txt) || b.getAttribute('aria-haspopup') === 'menu';
    });
    if (inSettings) return inSettings;

    const allBtns = Array.from(document.querySelectorAll('button, [role="combobox"]'));
    return (
      allBtns.find((b) => {
        if (b.closest('#flow-my-projects-dock, #flow-saved-projects-backdrop, header')) return false;
        const txt = (b.textContent || '').replace(/\s+/g, ' ').trim();
        if (!txt || txt.length > 70) return false;
        if (txt.includes('Extend (') || txt.includes('pen_magic')) return false;
        if (/\b(Video|Image)\b/i.test(txt) && (/(4s|6s|8s|10s|x[1-4]|16:9|9:16)/i.test(txt) || txt.includes('·'))) return false;
        return txt.includes('Veo') || txt.includes('Omni') || txt.includes('Lower Priority');
      }) || null
    );
  }

  function syncCreditCostInDom(hideCompletely) {
    const creditLink = document.querySelector('a[href*="g1_ai_credit_menu"], a[href*="credit_menu"], a[href*="ai_credit"]');
    const containers = new Set();
    if (creditLink) {
      containers.add(creditLink.parentElement || creditLink);
    }
    document.querySelectorAll('div, p, span').forEach((el) => {
      if (el.children.length <= 3) {
        const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (txt.startsWith('Generating will use') && txt.length < 80) {
          containers.add(el);
        }
      }
    });
    if (hideCompletely) {
      containers.forEach((row) => {
        row.style.setProperty('display', 'none', 'important');
      });
      if (creditLink) creditLink.removeAttribute('data-fake-credits');
      return;
    }
    const targetCredits = creditMap[fakeModelName || 'Veo 3.1 - Lite'] || '5';
    containers.forEach((row) => {
      row.style.removeProperty('display');
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      let tn;
      while ((tn = walker.nextNode())) {
        const val = tn.nodeValue || '';
        if (/\b\d+\s*credits\b/i.test(val)) {
          const desired = val.replace(/\b\d+\s*credits\b/i, targetCredits + ' credits');
          if (tn.nodeValue !== desired) tn.nodeValue = desired;
        }
      }
    });
    if (creditLink) {
      creditLink.removeAttribute('data-fake-credits');
    }
  }

  function applyFakeModelToDomNow() {
    if (!fakeModelName) fakeModelName = 'Veo 3.1 - Lite';
    const modelMenuBtn = findModelDropdownButton();
    if (modelMenuBtn) {
      modelMenuBtn.setAttribute('data-fake-model', fakeModelName);
    }
    syncCreditCostInDom(false);
  }

  function closeOpenModelDropdownMenu() {
    setTimeout(() => {
      const openMenu = document.querySelector('.cdk-overlay-container [role="menu"], [role="menu"], [role="listbox"]');
      if (!openMenu) return;
      const escInit = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
      try { openMenu.dispatchEvent(new KeyboardEvent('keydown', escInit)); } catch (e) {}
      try { document.dispatchEvent(new KeyboardEvent('keydown', escInit)); } catch (e) {}
      try { document.dispatchEvent(new KeyboardEvent('keyup', escInit)); } catch (e) {}
      setTimeout(() => {
        const stillOpen = document.querySelector('.cdk-overlay-container [role="menu"], [role="menu"], [role="listbox"]');
        if (stillOpen) {
          const expandedTrigger = document.querySelector('button[aria-expanded="true"], [role="combobox"][aria-expanded="true"]');
          if (expandedTrigger) {
            try { expandedTrigger.click(); } catch (e) {}
          }
        }
      }, 35);
    }, 35);
  }

  function triggerLowerPrioritySelection(allMenuItems) {
    const { target } = findBestBackendModelItem(allMenuItems);
    if (target) {
      const clickEl = (target.querySelector && target.querySelector('button')) || target;
      const wasHidden = target.getAttribute('data-hide-lp') === 'true';
      if (wasHidden) target.removeAttribute('data-hide-lp');
      target.__pakflowInternalClick = true;
      clickEl.__pakflowInternalClick = true;
      try { clickEl.click(); } catch (err) {
        simulateClick(clickEl);
      }
      if (wasHidden) target.setAttribute('data-hide-lp', 'true');
      setTimeout(() => {
        try {
          delete target.__pakflowInternalClick;
          delete clickEl.__pakflowInternalClick;
        } catch (err) {}
      }, 250);
      closeOpenModelDropdownMenu();
      return true;
    }
    closeOpenModelDropdownMenu();
    return false;
  }

  // Click interception for 4K Upscaled -> 1080p (-50 cr) and redirecting model selection -> [Lower Priority] / Lite
  document.addEventListener('click', (e) => {
    if (!isFlowHost()) return;
    const target = e.target;
    if (!target || !target.closest) return;

    const menuItem = target.closest('flow-menu-item, [role="menuitem"], [role="option"]');
    if (!menuItem || menuItem.__pakflowInternalClick || target.__pakflowInternalClick) return;
    const itemText = cleanText(menuItem.textContent);

    // 4K Upscaled interception -> click 1080p and deduct 50 credits
    if (itemText.includes('4K') && itemText.includes('Upscaled')) {
      let has1080p = false;
      const allMenuItems = document.querySelectorAll('flow-menu-item, [role="menuitem"]');
      for (const mi of allMenuItems) {
        if ((mi.textContent || '').includes('1080p')) {
          has1080p = true;
          break;
        }
      }
      if (has1080p) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        for (const mi of allMenuItems) {
          if ((mi.textContent || '').includes('1080p')) {
            const clickEl = (mi.querySelector && mi.querySelector('button')) || mi;
            try { clickEl.click(); } catch (err) { simulateClick(clickEl); }
            break;
          }
        }
        deductCredits({ type: 'video', modelName: '4K Upscale', rate: 50 }, 1, 'upscale_' + Date.now());
        lastDeductTime = Date.now();
        return;
      }
    }

    // PakFlow Model Redirection: user selects ANY model -> display & charge user's selection, but select [Lower Priority] (or Lite) in Flow
    if (!isImageModeActive && !isImageOnlyAccount() && (itemText.includes('Veo') || itemText.includes('Omni'))) {
      if (!itemText.includes('Lower Priority')) {
        const matched = matchKnownModelName(itemText);
        if (matched) {
          fakeModelName = matched;
          initPakflowDomEngine._userExplicitlyPickedModel = true;
          try { sessionStorage.setItem('__pakflow_fake_model', fakeModelName); } catch (err) {}
          applyFakeModelToDomNow();
        }
        const allMenuItems = document.querySelectorAll('.cdk-overlay-container flow-menu-item, .cdk-overlay-container [role="menuitem"], flow-menu-item, [role="menuitem"], [role="option"]');
        const best = findBestBackendModelItem(allMenuItems);
        if (!best.target || best.target === menuItem || best.target.contains(menuItem) || menuItem.contains(best.target)) {
          // Allow native click on Veo 3.1 - Lite to select it & close the dropdown naturally
          closeOpenModelDropdownMenu();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        triggerLowerPrioritySelection(allMenuItems);
      }
    }
  }, true);

  // PakFlow Agent Mode Storage Sanitizer & Auto-Deactivator
  let lastAgentDeactivateAt = 0;

  function sanitizePakflowAgentStorage() {
    try {
      [sessionStorage, localStorage].forEach((st) => {
        if (!st) return;
        for (let i = 0; i < st.length; i++) {
          const key = st.key(i);
          if (!key) continue;
          const lower = key.toLowerCase();
          if ((lower.includes('agent') || lower.includes('agentmode')) && !key.startsWith('__pakflow')) {
            const val = String(st.getItem(key) || '').toLowerCase();
            if (val === 'true' || val === '1' || val === 'open' || val === 'active' || val === 'expanded') {
              st.setItem(key, 'false');
            }
          }
        }
      });
    } catch (e) {}
  }

  function cleanAgentUrlParams() {
    try {
      if (window.location.search && window.location.search.toLowerCase().includes('agent')) {
        const url = new URL(window.location.href);
        let changed = false;
        for (const p of ['mode', 'agent', 'tab', 'panel', 'view']) {
          if (url.searchParams.has(p) && (url.searchParams.get(p) || '').toLowerCase().includes('agent')) {
            url.searchParams.delete(p);
            changed = true;
          }
        }
        if (changed) {
          window.history.replaceState(null, '', url.pathname + (url.search ? url.search : '') + url.hash);
        }
      }
    } catch (e) {}
  }

  function isAgentToggleActive(el) {
    if (!el) return false;
    const checkNode = (node) => {
      if (!node || !(node instanceof Element)) return false;
      if (node.getAttribute('aria-pressed') === 'true') return true;
      if (node.getAttribute('aria-checked') === 'true') return true;
      if (node.getAttribute('aria-selected') === 'true') return true;
      if (node.getAttribute('data-state') === 'on' || node.getAttribute('data-state') === 'checked' || node.getAttribute('data-state') === 'active') return true;
      const cls = String(node.className || '').toLowerCase();
      if (/\b(active|selected|checked|enabled|is-active|on|mdc-evolution-chip--selected|mat-mdc-chip-selected)\b/.test(cls)) return true;
      return false;
    };
    if (checkNode(el)) return true;
    if (el.parentElement && checkNode(el.parentElement)) return true;
    const chip = el.closest && el.closest('flow-agent-mode-toggle-chip, mat-chip-option, mat-chip');
    if (chip && checkNode(chip)) return true;
    return false;
  }

  function fireToggleExitClick(target) {
    if (!target) return;
    try {
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      target.click();
    } catch (e) {
      try { target.click(); } catch (_) {}
    }
  }

  function ensureExitAgentModeAndHideToggle() {
    cleanAgentUrlParams();
    const now = Date.now();
    const canTriggerExit = now - lastAgentDeactivateAt > 550;

    // 1. Check if Google Flow's <flow-agent-panel> or Agent Mode toggle chip is open/checked
    const agentPanel = document.querySelector('flow-agent-panel, [data-testid*="agent-panel" i]');
    const checkedChip = document.querySelector('flow-agent-mode-toggle-chip.checked, flow-agent-mode-toggle-chip[aria-selected="true"], flow-agent-mode-toggle-chip[aria-pressed="true"]');

    if (canTriggerExit) {
      let triggered = false;

      // Click close button inside <flow-agent-panel> if present
      if (agentPanel) {
        const closeBtns = agentPanel.querySelectorAll('button');
        for (const b of closeBtns) {
          const txt = (b.textContent || '').trim().toLowerCase();
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          const title = (b.getAttribute('title') || '').toLowerCase();
          if (txt === 'close' || txt.includes('close') || aria.includes('close') || aria.includes('collapse') || title.includes('close')) {
            fireToggleExitClick(b);
            triggered = true;
            break;
          }
        }
      }

      // Click checked <flow-agent-mode-toggle-chip> or its inner button to exit Agent Mode
      if (checkedChip) {
        const innerBtn = checkedChip.querySelector('button, [role="button"], [role="switch"]') || checkedChip;
        fireToggleExitClick(innerBtn);
        if (innerBtn !== checkedChip) fireToggleExitClick(checkedChip);
        triggered = true;
      }

      // Also check any complementary/aside Agent panel with close button
      const sidePanels = document.querySelectorAll('[role="complementary"], aside, [aria-label*="Agent" i]');
      for (const panel of sidePanels) {
        const pText = (panel.textContent || '').toUpperCase();
        if (pText.includes('AGENT') && (pText.includes('SESSION') || pText.includes('CHAT') || pText.includes('HISTORY') || pText.includes('PLAN'))) {
          const cBtn = panel.querySelector('button[aria-label*="close" i], button[aria-label*="collapse" i], button[title*="close" i]');
          if (cBtn) {
            fireToggleExitClick(cBtn);
            triggered = true;
          }
        }
      }

      if (triggered) {
        lastAgentDeactivateAt = now;
        sanitizePakflowAgentStorage();
      }
    }

    // 2. Scan Agent toggle buttons: if active or if agentPanel is still in DOM, turn OFF first before hiding!
    const agentCandidates = [];
    document.querySelectorAll('flow-agent-mode-toggle-chip, button, a, [role="button"], [role="tab"], [role="switch"]').forEach((el) => {
      const rawTxt = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const aria = (el.getAttribute('aria-label') || '').trim();
      if (
        el.tagName.toLowerCase() === 'flow-agent-mode-toggle-chip' ||
        rawTxt === 'Agent' ||
        /^spark\s*Agent$/i.test(rawTxt) ||
        /^auto_awesome\s*Agent$/i.test(rawTxt) ||
        aria.toLowerCase() === 'agent' ||
        aria.toLowerCase() === 'agent mode'
      ) {
        const targetBtn = el.tagName.toLowerCase() === 'flow-agent-mode-toggle-chip' ? el : (el.closest('button') || el);
        if (!agentCandidates.includes(targetBtn)) agentCandidates.push(targetBtn);
      }
    });

    document.querySelectorAll('span.content').forEach((sp) => {
      if ((sp.textContent || '').trim() === 'Agent') {
        const btn = sp.closest('button') || sp.parentElement;
        if (btn && !agentCandidates.includes(btn)) agentCandidates.push(btn);
      }
    });

    const isAgentPanelStillOpen = Boolean(document.querySelector('flow-agent-panel'));

    agentCandidates.forEach((btn) => {
      const active = isAgentToggleActive(btn) || isAgentPanelStillOpen;
      if (active) {
        // Un-hide temporarily if needed and click to exit Agent Mode
        if (Date.now() - lastAgentDeactivateAt > 550) {
          lastAgentDeactivateAt = Date.now();
          const innerClickable = btn.querySelector('button') || btn;
          fireToggleExitClick(innerClickable);
          if (innerClickable !== btn) fireToggleExitClick(btn);
          sanitizePakflowAgentStorage();
        }
      }
      // Hide visually once processed
      if (btn.getAttribute('data-hide-agent') !== 'true') {
        btn.setAttribute('data-hide-agent', 'true');
      }
      const hostChip = btn.closest && btn.closest('flow-agent-mode-toggle-chip');
      if (hostChip && hostChip.getAttribute('data-hide-agent') !== 'true') {
        hostChip.setAttribute('data-hide-agent', 'true');
      }
    });
  }

  sanitizePakflowAgentStorage();
  cleanAgentUrlParams();

  // PakFlow Core Loop (fast for model menu spoofing, throttled for heavy DOM scans)
  setInterval(() => {
    const now = Date.now();
    if (isGeminiHost()) {
      injectPakflowStyles();
      if (now - (initPakflowDomEngine._lastGeminiPass || 0) < 500) return;
      initPakflowDomEngine._lastGeminiPass = now;
      purgeSignoutElements();
      spoofAccountIdentityInDom();
      ensureProfileIconVisible();
      updateMyProjectsUI();

      // Hide shared Gemini account sidebar chat history & mavatar footer row in DOM (never hide main <chat-window> .chat-history!)
      document.querySelectorAll(
        '.mavatar-footer-row, .mavatar-footer-row.collapsed, mavatar-footer-row, ' +
        'expandable-section[storagekey="chats"], [data-test-id="chats-expandable-section"], ' +
        '#sidenav-section-content-chats, conversations-list[data-test-id="all-conversations"], ' +
        '[data-test-id="all-conversations"], gem-nav-list-item[data-test-id="conversation"]'
      ).forEach((el) => {
        el.style.setProperty('display', 'none', 'important');
        el.style.setProperty('visibility', 'hidden', 'important');
        el.style.setProperty('height', '0', 'important');
        el.style.setProperty('overflow', 'hidden', 'important');
      });
      // Ensure main chat window conversation history is always visible
      document.querySelectorAll('chat-window, chat-window .chat-history, main [ role="listitem" ], chat-window [role="listitem"]').forEach((el) => {
        if (el.getAttribute('data-flow-hidden') === '1') {
          el.removeAttribute('data-flow-hidden');
          el.removeAttribute('aria-hidden');
          el.style.removeProperty('display');
          el.style.removeProperty('visibility');
          el.style.removeProperty('opacity');
          el.style.removeProperty('height');
          el.style.removeProperty('max-height');
          el.style.removeProperty('overflow');
          el.style.removeProperty('pointer-events');
        }
      });

      // Disable all links and citations inside Gemini responses and user messages
      document.querySelectorAll(
        'model-response a, message-content a, user-query a, .markdown a, .response-container a, .query-content a, .user-query-container a, chat-window a, main a, [role="main"] a'
      ).forEach((a) => {
        if (a.closest('#flow-my-projects-dock, #flow-saved-projects-backdrop')) return;
        if (a.hasAttribute('href')) a.removeAttribute('href');
        if (a.hasAttribute('target')) a.removeAttribute('target');
        a.style.setProperty('pointer-events', 'none', 'important');
        a.style.setProperty('cursor', 'text', 'important');
        a.style.setProperty('text-decoration', 'none', 'important');
      });

      // Auto-save active Gemini chat (/app/<chatId>) to user device
      const currGemId = getCurrentProjectIdFromUrl();
      if (currGemId) {
        if (currGemId !== lastAutoSavedProjectId || now - lastAutoSaveCheckAt > 6000) {
          lastAutoSavedProjectId = currGemId;
          lastAutoSaveCheckAt = now;
          saveCurrentProjectToDevice(false);
        }
      }

      // Auto-click Sign In on Gemini landing page if shared Google cookies are ready
      const signInLink = document.querySelector('a[href*="accounts.google.com/ServiceLogin"], a.gb_Ta, a[aria-label*="Sign in" i]');
      if (signInLink && !initPakflowDomEngine._geminiSignInClicked) {
        initPakflowDomEngine._geminiSignInClicked = true;
        try { signInLink.click(); } catch (e) {}
      }
      return;
    }
    if (!isFlowHost()) return;
    injectPakflowStyles();

    if (window.location.pathname !== lastPakflowPathname) {
      lastPakflowPathname = window.location.pathname;
      syncFlowPromptBoxLocalStorage();
      setupState = 6;
      setupStartTime = 0;
      if (!initPakflowDomEngine._userExplicitlyPickedModel) {
        fakeModelName = 'Veo 3.1 - Lite';
      }
    }

    const runHeavyDomPass = now - (initPakflowDomEngine._lastHeavyDomPass || 0) >= 600;
    if (runHeavyDomPass) {
      initPakflowDomEngine._lastHeavyDomPass = now;
      purgeSignoutElements();
      spoofAccountIdentityInDom();
      ensureProfileIconVisible();
      updateMyProjectsUI();
      ensureExitAgentModeAndHideToggle();

      // Request database credits periodically until synced
      if (!hasDatabaseCredits && now - (initPakflowDomEngine._lastCredReq || 0) > 2000) {
        initPakflowDomEngine._lastCredReq = now;
        try { ipcRenderer.sendToHost('request-credits'); } catch (e) {}
      }

      // Auto-save active project to user device
      const currProjId = getCurrentProjectIdFromUrl();
      if (currProjId) {
        if (currProjId !== lastAutoSavedProjectId || now - lastAutoSaveCheckAt > 6000) {
          lastAutoSavedProjectId = currProjId;
          lastAutoSaveCheckAt = now;
          saveCurrentProjectToDevice(false);
        }
      }

      document.querySelectorAll('button, a').forEach((el) => {
        const tc = el.textContent || '';
        if (tc.includes('Manage subscription')) el.style.pointerEvents = 'none';
        if (tc.trim() === 'Agent') el.setAttribute('data-hide-agent', 'true');
        if (tc.includes('Add AI credits')) el.style.display = 'none';
      });
    }

    // Hide video quality selector (360p / 720p / 1080p) inside settings popover
    document.querySelectorAll('flow-prompt-box-settings button, button').forEach((btn) => {
      const bt = (btn.textContent || '').trim();
      const lower = bt.toLowerCase();
      if (lower === '360p' || lower === '720p' || lower === '1080p') {
        const group = btn.closest('mat-button-toggle-group, [role="radiogroup"], [role="tablist"], [role="group"]') || btn.parentElement;
        if (group && !group.querySelector('button[aria-haspopup="menu"]')) {
          group.style.setProperty('display', 'none', 'important');
        } else {
          btn.style.setProperty('display', 'none', 'important');
        }
      }
    });

    if (runHeavyDomPass) {
      document.querySelectorAll('div, span, textarea, input').forEach((el) => {
        const textOrPh =
          el.placeholder ||
          (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3 ? el.textContent : '');
        if (textOrPh && textOrPh.includes('edit this video')) {
          let cur = el;
          for (let i = 0; i < 6; i++) {
            if (cur.parentElement && cur.parentElement.tagName !== 'BODY') {
              cur = cur.parentElement;
            }
          }
          cur.style.setProperty('display', 'none', 'important');
        }
      });

      // Elevate "New project" button with #ct-blur-overlay on home page (also allow Tools tab & Create tool on all servers)
      if (!initPakflowDomEngine._toolsTabListenerBound) {
        initPakflowDomEngine._toolsTabListenerBound = true;
        document.addEventListener('click', (ev) => {
          const tEl = ev.target && ev.target.closest ? ev.target.closest('button, [role="tab"], [role="button"], a, span') : null;
          if (!tEl) return;
          const raw = (tEl.textContent || '').trim().toLowerCase();
          if (raw === 'tools' || raw === 'apps' || raw.includes('create tool')) {
            initPakflowDomEngine._toolsTabClicked = true;
            const ov = document.getElementById('ct-blur-overlay');
            if (ov) ov.remove();
          } else if (raw === 'projects') {
            initPakflowDomEngine._toolsTabClicked = false;
          }
        }, true);
      }
      const newProjBtn = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent && b.textContent.includes('New project')
      );
      const hasCreateToolBtnOnPage = Array.from(document.querySelectorAll('button, a, [role="button"]')).some((el) => {
        if (!isElementVisible(el)) return false;
        const txt = (el.textContent || '').trim().toLowerCase();
        return txt.includes('create tool');
      });
      const toolsTabActive = (
        Boolean(initPakflowDomEngine._toolsTabClicked) ||
        hasCreateToolBtnOnPage ||
        /tools|apps/i.test(window.location.pathname + window.location.search + window.location.hash) ||
        Array.from(document.querySelectorAll('button, [role="tab"], [role="radio"], span')).some((el) => {
          const txt = (el.textContent || '').trim();
          if (txt !== 'Tools' && txt !== 'Apps') return false;
          const btn = el.closest('button, [role="tab"], [role="radio"]') || el.parentElement || el;
          return (
            btn.getAttribute('aria-selected') === 'true' ||
            btn.getAttribute('aria-pressed') === 'true' ||
            btn.getAttribute('data-state') === 'active' ||
            btn.classList.contains('active') ||
            btn.classList.contains('selected') ||
            btn.classList.contains('mat-button-toggle-checked')
          );
        })
      );
      if (newProjBtn && !toolsTabActive) {
        let overlay = document.getElementById('ct-blur-overlay');
        if (!overlay && newProjBtn.parentNode) {
          overlay = document.createElement('div');
          overlay.id = 'ct-blur-overlay';
          newProjBtn.parentNode.insertBefore(overlay, newProjBtn);
        }
        if (newProjBtn.getAttribute('data-elevate-btn') !== 'true') {
          newProjBtn.setAttribute('data-elevate-btn', 'true');
        }
        document.querySelectorAll('button, [role="tab"], [role="button"], span').forEach((el) => {
          const t = (el.textContent || '').trim().toLowerCase();
          if (t === 'tools' || t === 'apps' || t === 'projects' || t.includes('create tool')) {
            const btn = el.closest('button, [role="tab"], [role="button"]') || el.parentElement || el;
            if (btn) {
              if (btn.getAttribute('data-elevate-btn') !== 'true') {
                btn.setAttribute('data-elevate-btn', 'true');
              }
              btn.style.setProperty('position', 'relative', 'important');
              btn.style.setProperty('z-index', '2147483641', 'important');
              // Also elevate compact header/tablist ancestors so no parent stacking context traps Tools below #ct-blur-overlay
              let anc = btn.parentElement;
              for (let depth = 0; depth < 6 && anc && anc !== document.body; depth++) {
                const rect = anc.getBoundingClientRect ? anc.getBoundingClientRect() : null;
                if (rect && rect.height > 0 && rect.height < 140) {
                  if (window.getComputedStyle(anc).position === 'static') {
                    anc.style.setProperty('position', 'relative', 'important');
                  }
                  anc.style.setProperty('z-index', '2147483641', 'important');
                }
                anc = anc.parentElement;
              }
            }
          }
        });
      } else {
        const overlay = document.getElementById('ct-blur-overlay');
        if (overlay) overlay.remove();
      }

      // Hide Agent span.content buttons
      document.querySelectorAll('span.content').forEach((sp) => {
        if ((sp.textContent || '').trim() === 'Agent') {
          const btn = sp.closest('button');
          if (btn && btn.getAttribute('data-hide-agent') !== 'true') {
            btn.setAttribute('data-hide-agent', 'true');
          }
        }
      });

      // Keep Tools / Apps tab enabled on all servers (both Video and Image-Only)
      document.querySelectorAll('span').forEach((sp) => {
        const st = (sp.textContent || '').trim();
        if (st === 'Tools' || st === 'Apps') {
          const parent = sp.parentElement;
          const tabBtn = sp.closest('button, [role="tab"], [role="button"]');
          if (!parent) return;
          [parent, tabBtn].forEach((node) => {
            if (node && node.classList.contains('force-hide-radix')) {
              node.classList.remove('force-hide-radix');
              node.style.removeProperty('display');
              node.style.removeProperty('pointer-events');
            }
          });
        }
      });

      // Hide Extend (Veo / Omni), pen_magic Omni, keep Create tool enabled on all servers, and enable 4K Upscaled menuitem
      document.querySelectorAll('button, a, [role="button"], [role="menuitem"]').forEach((el) => {
        if (!el.textContent) return;
        const t = el.textContent.trim();
        const tl = t.toLowerCase();
        if (tl.includes('create tool')) {
          if (el.classList.contains('force-hide-radix')) {
            el.classList.remove('force-hide-radix');
            el.style.removeProperty('display');
            el.style.removeProperty('pointer-events');
            const prev = el.previousElementSibling;
            if (prev && (prev.tagName === 'HR' || prev.getAttribute('role') === 'separator' || (prev.textContent || '').trim() === '')) {
              prev.style.removeProperty('display');
            }
          }
          return;
        }
        if (t.includes('Extend (Veo') || t.includes('Extend (Omni')) {
          el.classList.add('force-hide-radix');
          el.style.setProperty('display', 'none', 'important');
        }
        if (t.includes('pen_magic') && (t.includes('Omni 1.1 Flash') || t.includes('Omni'))) {
          el.classList.add('force-hide-radix');
          el.style.setProperty('display', 'none', 'important');
        }
        if (el.getAttribute('role') === 'menuitem' && t.includes('4K') && t.includes('Upscaled')) {
          el.style.setProperty('pointer-events', 'auto', 'important');
          el.style.setProperty('opacity', '1', 'important');
          el.style.setProperty('cursor', 'pointer', 'important');
          el.removeAttribute('aria-disabled');
          el.removeAttribute('disabled');
          el.querySelectorAll('*').forEach((child) => {
            if (child.textContent && child.textContent.trim() === 'Get more AI credits') {
              child.style.setProperty('display', 'none', 'important');
            }
          });
        }
      });

      // Hide "Describe your edits"
      document.querySelectorAll('input, textarea, div, span').forEach((el) => {
        let match = false;
        if (el.placeholder && el.placeholder.includes('Describe your edits')) {
          match = true;
        } else if (
          el.childNodes.length === 1 &&
          el.childNodes[0].nodeType === 3 &&
          (el.textContent || '').trim() === 'Describe your edits'
        ) {
          match = true;
        }
        if (match) {
          let cur = el;
          for (let i = 0; i < 5; i++) {
            if (cur.parentElement && cur.parentElement.tagName !== 'BODY' && cur.parentElement.tagName !== 'HTML') {
              cur = cur.parentElement;
            }
          }
          if (cur && !cur.classList.contains('force-hide-radix')) {
            cur.classList.add('force-hide-radix');
            cur.style.setProperty('display', 'none', 'important');
          }
        }
      });

      // Hide stray model labels on canvas cards (outside buttons/menus)
      document.querySelectorAll('div, span, p').forEach((el) => {
        if (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) {
          const txt = el.textContent || '';
          if (txt.includes('Veo 3.1') || txt.includes('Omni') || txt.includes('[Lower Priority]')) {
            if (!el.closest('button') && !el.closest('flow-menu-item') && !el.closest('[role="menuitem"]') && !el.closest('[role="menu"]')) {
              el.style.setProperty('display', 'none', 'important');
            }
          }
        }
      });

      // Hide "Not enough AI credits to upscale" tooltip
      document.querySelectorAll('div[role="tooltip"], div, span').forEach((el) => {
        if (el.textContent && el.textContent.trim() === 'Not enough AI credits to upscale') {
          el.style.setProperty('display', 'none', 'important');
          el.style.setProperty('opacity', '0', 'important');
          el.style.setProperty('pointer-events', 'none', 'important');
        }
      });

      updateConcurrentTileJobs();
      checkForNewGeneratedMedia();
    }

    isLockedBySubmission = false;

    const isToggleBtnActive = (b) => {
      if (!b) return false;
      const toggleParent = b.closest ? b.closest('mat-button-toggle, .mat-button-toggle') : null;
      return (
        b.getAttribute('aria-selected') === 'true' ||
        b.getAttribute('aria-pressed') === 'true' ||
        b.getAttribute('aria-checked') === 'true' ||
        b.getAttribute('data-state') === 'active' ||
        b.getAttribute('data-state') === 'on' ||
        b.classList.contains('active') ||
        b.classList.contains('selected') ||
        b.classList.contains('mat-button-toggle-checked') ||
        !!(toggleParent && (toggleParent.classList.contains('mat-button-toggle-checked') || toggleParent.getAttribute('aria-checked') === 'true'))
      );
    };

    // Hide sign-out buttons & x2/x3/x4 batch multiplier tabs, and auto-select x1 ONLY if non-x1 is actually active
    const allButtons = document.querySelectorAll('button, [role="tab"], [role="radio"]');
    let x1Btn = null;
    let nonX1Selected = false;
    allButtons.forEach((b) => {
      if (runHeavyDomPass && (b.textContent || '').trim().toLowerCase().includes('sign out')) {
        if (b.getAttribute('data-hide-signout') !== 'true') {
          b.setAttribute('data-hide-signout', 'true');
        }
      }
      const cleanLbl = getButtonCleanLabel(b).toLowerCase();
      const rawLbl = (b.textContent || '').trim().toLowerCase();
      const t = cleanLbl || rawLbl;
      if (t === 'x1' || t === '1x') {
        x1Btn = b;
      } else if (['x2', 'x3', 'x4', '2x', '3x', '4x'].includes(t)) {
        if (b.getAttribute('data-hide-tab') !== 'true') {
          b.setAttribute('data-hide-tab', 'true');
        }
        if (isToggleBtnActive(b)) {
          nonX1Selected = true;
        }
      }
    });

    const promptPillBtn = Array.from(document.querySelectorAll('button')).find((b) => {
      const txt = (b.textContent || '').trim();
      return /\b(Video|Image)\b/i.test(txt) && (/(4s|6s|8s|10s|x[1-4]|16:9|9:16)/i.test(txt) || txt.includes('·'));
    });
    const pillShowsNonX1 = !!(promptPillBtn && /\bx[2-4]\b/i.test(promptPillBtn.textContent || ''));
    const anyMenuOpen = !!document.querySelector('.cdk-overlay-container [role="menu"], [role="menu"], [role="listbox"]');

    // Only click x1Btn if x2/x3/x4 is actually selected (never click-spam when x1 is already active or when a dropdown menu is open!)
    if (x1Btn && (nonX1Selected || pillShowsNonX1) && !anyMenuOpen) {
      if (now - (initPakflowDomEngine._lastX1ClickAt || 0) > 800) {
        initPakflowDomEngine._lastX1ClickAt = now;
        try { x1Btn.click(); } catch (e) { simulateClick(x1Btn); }
      }
    }

    // Update total credits link (a[href*='flow_ai_credits_page'] / flow-account-panel .credits-count) with database credits
    const totalCreditsLink = document.querySelector("a[href*='flow_ai_credits_page'], flow-account-panel .credits-count");
    if (totalCreditsLink) {
      const balStr = fakeBalance.toString();
      if (totalCreditsLink.getAttribute('data-fake-total-credits') !== balStr) {
        totalCreditsLink.setAttribute('data-fake-total-credits', balStr);
      }
    }

    // Enforce Image-Only Account rules if credentials.imageOnly is true
    if (isImageOnlyAccount()) {
      if (document.body && document.body.getAttribute('data-flow-image-only') !== 'true') {
        document.body.setAttribute('data-flow-image-only', 'true');
      }
      // Hide Video tab, Frames tab, Video models, Durations (4s/6s/8s/10s), Agent, and credit cost line (keep Tools / Apps / Create tool enabled!)
      document.querySelectorAll('button, [role="tab"], [role="radio"], [role="combobox"]').forEach((b) => {
        const cleanLbl = getButtonCleanLabel(b).toLowerCase();
        if (cleanLbl === 'tools' || cleanLbl === 'apps' || cleanLbl.includes('create tool')) {
          if (b.getAttribute('data-hide-image-only') === 'true') {
            b.removeAttribute('data-hide-image-only');
            b.style.removeProperty('display');
            b.style.removeProperty('pointer-events');
          }
          return;
        }
        if (
          cleanLbl === 'video' ||
          cleanLbl === 'videos' ||
          cleanLbl === 'frames' ||
          cleanLbl === '4s' ||
          cleanLbl === '6s' ||
          cleanLbl === '8s' ||
          cleanLbl === '10s' ||
          cleanLbl === 'agent'
        ) {
          if (b.getAttribute('data-hide-image-only') !== 'true') {
            b.setAttribute('data-hide-image-only', 'true');
          }
        }
        const bt = (b.textContent || '').trim();
        if (bt.length < 70 && !bt.includes('Extend (') && (bt.includes('Veo') || bt.includes('Omni') || bt.includes('Lower Priority'))) {
          if (b.getAttribute('data-hide-image-only') !== 'true') {
            b.setAttribute('data-hide-image-only', 'true');
          }
        }
      });

      // Hide "Generating will use X credits" in Image-Only mode (0 cost)
      syncCreditCostInDom(true);

      // Ensure Flow is switched to Image tab and x1
      const allModeBtns = Array.from(document.querySelectorAll('button, [role="tab"], [role="radio"]'));
      const imgTabBtn = allModeBtns.find((b) => getButtonCleanLabel(b).toLowerCase() === 'image');
      if (imgTabBtn) {
        const imgSelected = isToggleBtnActive(imgTabBtn);
        if (!imgSelected && now - (initPakflowDomEngine._lastImgTabClick || 0) > 500) {
          initPakflowDomEngine._lastImgTabClick = now;
          try { imgTabBtn.click(); } catch (e) { simulateClick(imgTabBtn); }
        }
        if (initPakflowDomEngine._autoOpenedForImageSwitch && (imgSelected || now - (initPakflowDomEngine._lastImageSwitchAttempt || 0) > 250)) {
          initPakflowDomEngine._autoOpenedForImageSwitch = false;
          setTimeout(() => {
            if (document.body) document.body.removeAttribute('data-pakflow-boot-hide');
            try {
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
            } catch (e) {}
          }, 120);
        }
      } else {
        // Settings popover is closed; check if the bottom prompt pill button still says "Video" or "x2/x3/x4"
        const needPillFix =
          promptPillBtn &&
          (/\bVideo\b/i.test(promptPillBtn.textContent || '') || /\bx[2-4]\b/i.test(promptPillBtn.textContent || ''));
        if (needPillFix && now - (initPakflowDomEngine._lastImageSwitchAttempt || 0) > 1500) {
          initPakflowDomEngine._lastImageSwitchAttempt = now;
          initPakflowDomEngine._autoOpenedForImageSwitch = true;
          if (document.body) document.body.setAttribute('data-pakflow-boot-hide', 'true');
          try { promptPillBtn.click(); } catch (e) { simulateClick(promptPillBtn); }
        }
      }

      isImageModeActive = true;
      document.querySelectorAll('[data-fake-model]').forEach((b) => b.removeAttribute('data-fake-model'));
      return;
    }

    if (document.body && document.body.getAttribute('data-flow-image-only') === 'true') {
      document.body.removeAttribute('data-flow-image-only');
    }
    document.querySelectorAll('[data-hide-image-only="true"]').forEach((el) => {
      el.removeAttribute('data-hide-image-only');
      el.style.removeProperty('display');
    });

    // Detect Image Mode vs Video Mode on normal (Video + Image) accounts
    const imgTabSelected = Array.from(document.querySelectorAll('button, [role="tab"], [role="radio"]')).find(
      (b) => isToggleBtnActive(b) && getButtonCleanLabel(b).toLowerCase() === 'image'
    );
    const nanoMenuTrigger = Array.from(document.querySelectorAll('button, [role="combobox"]')).find(
      (b) => b.textContent && b.textContent.length < 70 && b.textContent.includes('Nano')
    );
    const imagePillActive = promptPillBtn && /\bImage\b/i.test(promptPillBtn.textContent || '');
    isImageModeActive = !!(imgTabSelected || nanoMenuTrigger || imagePillActive);

    if (isImageModeActive) {
      setupState = 6;
      if (document.body && document.body.getAttribute('data-pakflow-boot-hide') === 'true') {
        document.body.removeAttribute('data-pakflow-boot-hide');
      }
      document.querySelectorAll('[data-fake-model]').forEach((b) => b.removeAttribute('data-fake-model'));
      // Hide credit cost line in Image mode since Image generation is 0 cost
      syncCreditCostInDom(true);
      const subBtn = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent && b.textContent.includes('arrow_forward')
      );
      if (subBtn) subBtn.removeAttribute('data-hide-submit');
      return;
    }

    let modelMenuBtn = findModelDropdownButton();
    const submitBtn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent && b.textContent.includes('arrow_forward')
    );

    if (submitBtn) {
      submitBtn.removeAttribute('data-hide-submit');
    }

    if (!fakeModelName) {
      fakeModelName = 'Veo 3.1 - Lite';
    }

    // Passive settings-popover model sync: if the user opens <flow-prompt-box-settings> and the backend model button still says Omni/Abra (not Lower Priority), silently switch it once
    const settingsPanelEl = document.querySelector('flow-prompt-box-settings');
    if (settingsPanelEl && modelMenuBtn && !anyMenuOpen && !settingsPanelEl.__pakflowModelSynced) {
      settingsPanelEl.__pakflowModelSynced = true;
      const rawModelBtnTxt = (modelMenuBtn.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/Lower Priority/i.test(rawModelBtnTxt) && /Omni|Abra/i.test(rawModelBtnTxt)) {
        try {
          modelMenuBtn.click();
          setTimeout(() => {
            const menuItems = document.querySelectorAll('.cdk-overlay-container flow-menu-item, .cdk-overlay-container [role="menuitem"], flow-menu-item, [role="menuitem"], [role="option"]');
            if (menuItems.length > 0) {
              triggerLowerPrioritySelection(menuItems);
            }
          }, 80);
        } catch (e) {}
      }
    }

    // Spoof modelMenuBtn with fakeModelName, hide [Lower Priority] & Omni 1.2 menu items, and spoof credits line
    if (modelMenuBtn) {
      try {
        const btnRect = modelMenuBtn.getBoundingClientRect();
        const iconEl = modelMenuBtn.querySelector('i, .google-symbols, mat-icon, svg');
        const hasLeftIcon = iconEl && btnRect.width > 0 && (iconEl.getBoundingClientRect().left - btnRect.left < 32);
        modelMenuBtn.style.setProperty('--fake-model-left', hasLeftIcon ? '34px' : '14px');
      } catch (e) {}
      if (modelMenuBtn.getAttribute('data-fake-model') !== fakeModelName) {
        modelMenuBtn.setAttribute('data-fake-model', fakeModelName);
      }
    }

    document.querySelectorAll('flow-menu-item, [role="menuitem"], [role="option"]').forEach((mi) => {
      const txt = cleanText(mi.textContent);
      if (txt.includes('Lower Priority') || isHiddenNewModelText(txt)) {
        mi.setAttribute('data-hide-lp', 'true');
        mi.removeAttribute('data-fake-active');
        mi.removeAttribute('data-fake-inactive');
      } else {
        const matchedName = matchKnownModelName(txt);
        if (matchedName && matchedName === fakeModelName) {
          mi.setAttribute('data-fake-active', 'true');
          mi.removeAttribute('data-fake-inactive');
        } else if (matchedName) {
          mi.removeAttribute('data-fake-active');
          mi.setAttribute('data-fake-inactive', 'true');
        } else {
          mi.removeAttribute('data-fake-active');
          mi.removeAttribute('data-fake-inactive');
        }
      }
    });

    syncCreditCostInDom(false);

    if (setupState >= 6 && document.body && document.body.getAttribute('data-pakflow-boot-hide') === 'true') {
      document.body.removeAttribute('data-pakflow-boot-hide');
    }
  }, 50);
})();

function enforceModelRestrictions() {
  // Handled by PakFlow 50ms loop (data-hide-lp="true" hides [Lower Priority] while keeping standard models visible)
}

function autoSelectLowerPriorityModel() {
  // Handled by PakFlow setupState (0 -> 6) state machine & click redirection
}

function renameLowerPriorityText(_element) {}
function dismissVideoModelMenus() {}

// =========================================================================
// GOOGLE AUTO-LOGIN
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
    if (!t || t.length > 220) return false;
    // Must look like THIS option alone — not a parent that lists every method
    if (/one-time security code|security key|tap yes|use your passkey|try another way|phone or tablet|eligible device|text message|voice call|backup code/.test(t) &&
        !/authenticator/.test(t)) return false;
    if (/one-time security code|tap yes on your phone|use your passkey|can.?t find an eligible/.test(t)) return false;
    return (
      /google authenticator/.test(t) ||
      /^authenticator$/.test(t) ||
      (/authenticator/.test(t) && /app|code|verification|google/.test(t)) ||
      (/verification code/.test(t) && /authenticator/.test(t)) ||
      (/get a verification code/.test(t) && /authenticator/.test(t)) ||
      (/code from/.test(t) && /authenticator/.test(t)) ||
      /authentication app/.test(t)
    );
  };

  const clickableSel =
    '[data-challengeid], [data-challengetype], [data-action="selectchallenge"], ' +
    'li[jsname], div[role="link"], div[role="button"], button, a[role="link"], a';

  // Challenge type 6 / TOTP / totp — Google's machine id for Authenticator
  const byType = Array.from(document.querySelectorAll('[data-challengetype], [data-challengeid]')).filter((el) => {
    if (!isElementVisible(el)) return false;
    const typ = String(el.getAttribute('data-challengetype') || el.getAttribute('data-challengeid') || '').toLowerCase();
    return typ === '6' || typ === 'totp' || /totp|authenticator/.test(typ);
  });
  if (byType[0]) {
    return byType[0].closest(clickableSel) || byType[0];
  }

  // Prefer dedicated challenge nodes (Google Glif)
  const preferred = Array.from(document.querySelectorAll(clickableSel));
  const rowHits = preferred.filter((el) => {
    if (!isElementVisible(el)) return false;
    const label = el.getAttribute?.('aria-label') || '';
    const own = (el.innerText || el.textContent || '');
    // Prefer elements whose own text is the authenticator line (not a huge list)
    const ownNorm = own.replace(/\s+/g, ' ').trim();
    if (ownNorm.length > 220) return false;
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
      if (!t || t.length > 140) continue;
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
  // Host CDP owns identifier/password Next
  if (window.__flowHostOwnsNext && (kind === 'password' || kind === 'identifier')) {
    return false;
  }
  const pathKey = `${kind}:${location.pathname}`;
  if (autoLoginState.submittedKeys.has(pathKey + ':submit')) return false;

  // Never Next while Glif top bar / busy spinner is running
  if (isGoogleProcessing()) {
    console.log('[Flow Preload] Next deferred — page still loading:', kind);
    return false;
  }

  const rootSel = kind === 'password' ? '#passwordNext' : (kind === 'totp' ? '#totpNext' : '#identifierNext');
  // Prefer real Next button — never form.submit()
  let next =
    document.querySelector(rootSel + ' button') ||
    document.querySelector(rootSel + ' [role="button"]') ||
    document.querySelector(rootSel);

  // Fallback: visible button whose label is exactly Next (ignore "Forgot email?")
  if (!next || !isElementVisible(next)) {
    next = Array.from(document.querySelectorAll('button')).find(b => {
      const t = (b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim();
      return /^next$/i.test(t) && isElementVisible(b);
    });
  }

  if (next && isElementVisible(next)) {
    // Disabled / aria-busy Next = still settling
    try {
      if (next.disabled || next.getAttribute('aria-disabled') === 'true' ||
          next.getAttribute('aria-busy') === 'true') {
        return false;
      }
    } catch (e) {}
    autoLoginState.submittedKeys.add(pathKey + ':submit');
    autoLoginState.lastActionTime = Date.now();
    try { next.focus(); } catch (e) {}
    try { next.click(); } catch (e) {}
    return true;
  }
  return false;
}

function isGoogleProcessing() {
  try {
    // Only the thin Glif top strip — generic [role=progressbar] false-positives blocked Next forever
    const nodes = document.querySelectorAll('.vxxSae, .XhSMyb, [role="progressbar"]');
    for (const progressBar of nodes) {
      const style = window.getComputedStyle(progressBar);
      const r = progressBar.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.05) continue;
      if (r.top >= 0 && r.top < 180 && r.height > 0 && r.height <= 6 && r.width > 40) return true;
    }
    if (document.body && document.body.getAttribute('aria-busy') === 'true') return true;
  } catch (e) {}
  return false;
}

/** Wait until Glif finishes loading, then click Next (retries; no reload). */
function submitGoogleNextWhenReady(kind, input, opts = {}) {
  if (DEBUG_FILL_ONLY) return;
  const maxMs = opts.maxMs || 12000;
  const started = Date.now();
  const tick = () => {
    if (Date.now() - started > maxMs) {
      console.warn('[Flow Preload] Next wait timed out:', kind);
      return;
    }
    if (isGoogleProcessing()) {
      setTimeout(tick, 350);
      return;
    }
    // Password must still be present
    if (kind === 'password' && input) {
      if (!input.isConnected || !(input.value || '').length) {
        setTimeout(tick, 350);
        return;
      }
    }
    // Settle briefly after bar disappears
    if (!pathSettled('next-ready:' + kind, 500)) {
      setTimeout(tick, 200);
      return;
    }
    const ok = submitGoogleNext(kind, input);
    if (!ok) setTimeout(tick, 400);
  };
  setTimeout(tick, opts.initialDelayMs || 800);
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
  autoLoginState.selectionUiReloadTried = false;
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
      return r.width >= 80 && r.height >= 40 && r.bottom > 0 && r.top < window.innerHeight;
    });
    if (frames.length) return true;

    // Identifier image captcha (#captchaimg) — often smaller than recaptcha widgets
    const captchaImgs = Array.from(document.querySelectorAll(
      '#captchaimg, img#captchaimg, img[src*="Captcha" i], img[src*="captcha" i], img[alt*="captcha" i]'
    )).filter((img) => {
      if (!isElementVisible(img)) return false;
      const r = img.getBoundingClientRect();
      return r.width >= 20 && r.height >= 12;
    });
    if (captchaImgs.length) return true;

    // Any captcha-named / "Type the text you hear or see" field = captcha (no copyHit required)
    const captchaInputs = Array.from(document.querySelectorAll(
      'input[name="ca"], input#ca, input[name="captcha"], input[id*="captcha" i], ' +
      'input[aria-label*="Type the text" i], input[aria-label*="hear or see" i], ' +
      'input[aria-label*="characters" i], input[placeholder*="Type the text" i], ' +
      'input[placeholder*="hear or see" i], input[placeholder*="characters" i]'
    )).filter(isElementVisible);
    if (captchaInputs.length) return true;

    // User rule: any ADDITIONAL visible text field beyond email/identifier = captcha
    const path = location.pathname || '';
    const onCredStep = /identifier|challenge\/pwd|signin\/v2\/sl\/pwd/i.test(path);
    if (onCredStep || /accounts\.google\.com/i.test(location.hostname || '')) {
      const textInputs = Array.from(document.querySelectorAll('input')).filter((el) => {
        if (!isElementVisible(el)) return false;
        const t = String(el.getAttribute('type') || 'text').toLowerCase();
        if (['hidden', 'password', 'submit', 'button', 'checkbox', 'radio', 'file', 'image', 'reset'].includes(t)) {
          return false;
        }
        // text / email / tel / search / no type
        return true;
      });
      const isPrimaryId = (el) => {
        const typ = String(el.getAttribute('type') || '').toLowerCase();
        const meta = [
          el.name, el.id, el.autocomplete, el.getAttribute('aria-label'), el.placeholder
        ].map((x) => String(x || '').toLowerCase()).join(' ');
        return typ === 'email' ||
          /^(email|identifier|username)$/i.test(String(el.name || el.id || '')) ||
          /identifierid|\bidentifier\b|\bemail\b|\busername\b|account name|phone number/i.test(meta);
      };
      const extras = textInputs.filter((el) => !isPrimaryId(el));
      // Extra text field (e.g. captcha) on identifier = captcha
      if (extras.length >= 1 && /identifier/i.test(path)) return true;
      if (onCredStep && textInputs.length >= 2) return true;
      // Placeholder / label copy alone
      if (textInputs.some((el) => {
        const meta = [
          el.placeholder, el.getAttribute('aria-label'), el.name, el.id
        ].map((x) => String(x || '')).join(' ');
        return /type the text|hear or see|enter the characters|captcha/i.test(meta);
      })) return true;
    }

    const widgets = Array.from(document.querySelectorAll(
      '.g-recaptcha, #recaptcha, [data-sitekey]'
    )).filter((w) => {
      const r = w.getBoundingClientRect();
      return r.width >= 80 && r.height >= 40 && isElementVisible(w);
    });
    if (widgets.length) return true;

    const text = ((document.body && document.body.innerText) || '').slice(0, 3000);
    const copyHit = /type the text you hear or see|type the text|enter the characters|unusual traffic from your computer|select all (?:images|squares)|i.?m not a robot|verify it.?s you|couldn.?t sign you in/i.test(text);
    if (copyHit && /captcha|hear or see|type the text/i.test(text)) return true;
    if (/unusual traffic|select all (?:images|squares)/i.test(text)) return true;
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

  // 1 hit is enough — identifier image captcha must lift cover immediately
  const captchaConfirmed = autoLoginState.captchaHits >= 1;
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
  if (hostname.includes('gemini.google.com') || hostname.includes('bard.google.com')) {
    removeAutoLoginOverlay();
    removeCaptchaBanner();
    const geminiSignIn = document.querySelector('a[href*="accounts.google.com/ServiceLogin"], a[aria-label*="Sign in" i]');
    if (geminiSignIn && isVisible(geminiSignIn) && !autoLoginState.geminiSignInClicked) {
      autoLoginState.geminiSignInClicked = true;
      autoLoginState.lastActionTime = now;
      simulateClick(geminiSignIn);
      return;
    }
    autoLoginState.done = true;
    notifyAuthHost('auth:auto-login', { overlay: false, captcha: false, done: true });
    return;
  }

  if (hostname.includes('flow.google.com') || hostname.includes('labs.google')) {
    removeAutoLoginOverlay();
    removeCaptchaBanner();
    const isAboutOrLanding = /^\/(about|landing)/i.test(pathname) || /\/fx\/.*\/tools\/flow\/about/i.test(pathname);
    const isWorkspace = !isAboutOrLanding && !!(
      document.querySelector('flow-app, flow-app-root, flow-projects-page, [data-testid*="project"]') ||
      (document.querySelector('header, flow-app-header, [role="banner"]') &&
        document.querySelector('[role="main"], [role="tablist"], textarea, [contenteditable="true"]'))
    );
    if (isWorkspace || autoLoginState.done) {
      autoLoginState.done = true;
      notifyAuthHost('auth:auto-login', { overlay: false, captcha: false, done: true });
      return;
    }
    if (isAboutOrLanding && credentials.email) {
      if (!autoLoginState.aboutPageEnteredAt) autoLoginState.aboutPageEnteredAt = now;
      if (now - autoLoginState.aboutPageEnteredAt > 1800 && (!autoLoginState.lastAboutClickAt || now - autoLoginState.lastAboutClickAt > 6000)) {
        const cta = Array.from(document.querySelectorAll('button, a[role="button"], a')).find(el => {
          if (!isVisible(el)) return false;
          const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
          return /^(sign in|create with flow|get started|launch flow|try flow)$/i.test(t);
        });
        if (cta) {
          autoLoginState.lastAboutClickAt = now;
          autoLoginState.lastActionTime = now;
          simulateClick(cta);
        }
      }
    }
    return;
  }

  if (!hostname.includes('accounts.google.com') && !hostname.includes('accounts.youtube.com')) return;

  // Final Google handoff — CheckCookie / LoginDone often stalls under our overlay.
  // Jump to continue= (Flow) once cookies are set.
  if (/CheckCookie|LoginDoneHtml|chtml=LoginDone/i.test(location.href + pathname)) {
    if (!autoLoginState.submittedKeys.has('checkcookie-continue')) {
      autoLoginState.submittedKeys.add('checkcookie-continue');
      let dest = credentials.targetUrl || 'https://flow.google.com/';
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

  // Progress bar on password/identifier — wait; do not reload, do not Next yet
  const onIdentifierPath = /signin\/identifier|\/identifier(?:\/|$)/i.test(pathname);
  const on2faPath = /\/challenge\/(totp|selection|sk|iap|dp|ootp|skotp)/i.test(pathname);
  if (isGoogleProcessing()) {
    // Allow fill while loading, but block submit paths further down via submitGoogleNext
    if ((onPwdChallenge || onIdentifierPath) && !pathSettled('processing-wait', 400)) return;
    if (!onPwdChallenge && !on2faPath && !onIdentifierPath && !pathSettled('processing-wait', 2000)) return;
  }

  // Google SPA: URL often updates before the new form paints
  if (autoLoginState.lastPath !== pathname) {
    const wasPwd = /\/challenge\/pwd/i.test(autoLoginState.lastPath || '');
    const nowPwd = /\/challenge\/pwd/i.test(pathname);
    const nowPostPwd = /\/challenge\/(selection|totp|skotp|sk|iap|dp|ootp)/i.test(pathname);
    const prev = autoLoginState.lastPath;
    autoLoginState.lastPath = pathname;
    // Staying on password — keep keys. Leaving pwd → selection/totp — KEEP passwordSubmitted
    // so we never re-fill/re-Next. Only clear on identifier bounce or forceReset.
    if (wasPwd && nowPwd) {
      // keep
    } else if (wasPwd && nowPostPwd) {
      autoLoginState.passwordSubmitted = true;
      autoLoginState.passwordFilled = true;
    } else if (!nowPwd && !nowPostPwd) {
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

  // Auto-click exact 'Try again' button on Google login interstitial error pages
  const tryAgainBtn = buttonByLabel(/^try again$/i);
  if (tryAgainBtn && isElementVisible(tryAgainBtn)) {
    const taBucket = Math.floor(now / 2500);
    autoLoginState.submittedKeys.delete('try-again:' + pathname + ':' + (taBucket - 1));
    clickOnce('try-again:' + pathname + ':' + taBucket, tryAgainBtn);
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

  const totpSelector =
    'input[name="totpPin"], input#totpPin, input[id*="totp" i], ' +
    'input[type="tel"][autocomplete="one-time-code"], ' +
    'input[aria-label*="Enter code" i], input[aria-label*="Enter the code" i], ' +
    'input[aria-label*="verification code" i]';
  const totpInput =
    Array.from(document.querySelectorAll(totpSelector)).find(isElementVisible) ||
    document.querySelector(totpSelector);
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

  // Host owns 2FA CDP — still allow inject fallback if host stalls (skotp / chooser)
  const host2faStalled = (() => {
    if (!window.__flowHostOwns2fa) return false;
    const key = 'host2fa-watch:' + pathname;
    if (!autoLoginState.submittedKeys.has(key)) {
      autoLoginState.submittedKeys.add(key);
      autoLoginState._host2faSince = now;
      return false;
    }
    return now - (autoLoginState._host2faSince || now) > 4500;
  })();
  if (window.__flowHostOwns2fa && (onSecurityCodeScreen || onChallengeChooser) && !host2faStalled) {
    return;
  }

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
  // Keep cover on — only auto-select; do not wait for user.
  if (!DEBUG_FILL_ONLY && !totpReady && (onChallengeChooser || /authenticator/i.test(pageText))) {
    const authTarget = findAuthenticatorOption();
    if (authTarget) {
      const retryBucket = Math.floor(now / 1400);
      console.log('[Flow Preload] Selecting Google Authenticator TOTP option');
      autoLoginState.submittedKeys.delete('auth-app:' + pathname + ':' + (retryBucket - 1));
      clickOnce('auth-app:' + pathname + ':' + retryBucket, authTarget);
      return;
    }
    // URL already /challenge/selection but SPA still shows password card — wait, do not reload
    if (/\/challenge\/selection/i.test(pathname)) {
      const pwdStill =
        document.querySelector('input[name="Passwd"], input[type="password"], input[autocomplete="current-password"]');
      const chooserReady =
        /choose how you want to sign in|choose a way/i.test(pageText) ||
        /authenticator/i.test(pageText);
      if (pwdStill && isElementVisible(pwdStill) && !chooserReady) {
        return; // host DriveAuthenticator waits; reloading bounced to password
      }
    }
    return;
  }

  // TOTP code field: request OTP from host, then fill + Next
  // Also runs on accounts.youtube.com/SetSID where the Authenticator UI is painted
  // without /challenge/totp in the URL.
  if (totpReady) {
    const hasTotpError =
      /wrong code|incorrect code|couldn't verify|could not verify|invalid code|enter a valid code/i.test(pageText) ||
      totpInput.getAttribute('aria-invalid') === 'true';
    if (hasTotpError && autoLoginState.otpFilled && now - (autoLoginState._lastTotpErrAt || 0) > 4000) {
      autoLoginState._lastTotpErrAt = now;
      autoLoginState._totpErrCount = (autoLoginState._totpErrCount || 0) + 1;
      credentials._otp = '';
      autoLoginState.otpFilled = false;
      autoLoginState.otpRequested = false;
      autoLoginState.submittedKeys.delete(`otp:${pathname}:fill`);
      autoLoginState.submittedKeys.delete(`otp:${pathname}:next`);
      try { fillInputValue(totpInput, ''); } catch (e) {}
      console.warn('[Flow Preload] Wrong/expired TOTP code detected — requesting fresh code');
      try { ipcRenderer.sendToHost('flow:totp-retry-needed', { path: pathname, href: location.href, count: autoLoginState._totpErrCount }); } catch (e) {}
      try { ipcRenderer.sendToHost('request-otp', { forceRefresh: true }); } catch (e) {}
      if (autoLoginState._totpErrCount >= 3) {
        autoLoginState._totpErrCount = 0;
        setTimeout(() => {
          try { location.reload(); } catch (e) {}
        }, 1800);
      }
      return;
    }
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
    const alreadyFilled =
      (totpInput.value || '').replace(/\s+/g, '') === String(credentials._otp).replace(/\s+/g, '');
    if (!autoLoginState.submittedKeys.has(fillKey) || !alreadyFilled) {
      fillInputValue(totpInput, String(credentials._otp));
      autoLoginState.submittedKeys.add(fillKey);
      autoLoginState.otpFilled = true;
      autoLoginState._otpFilledAt = now;
      autoLoginState.lastActionTime = now;
      console.log('[Flow Preload] TOTP filled — scheduling Next submit');
    }

    const triggerTotpNext = () => {
      if (DEBUG_FILL_ONLY) return;
      if (!totpInput.isConnected) return;
      const val = (totpInput.value || '').replace(/\s+/g, '');
      if (val.length < 6) return;
      const stillTotp =
        /\/challenge\/totp/i.test(location.pathname || '') ||
        /\/SetSID/i.test(location.pathname || '') ||
        !!(document.querySelector('input[name="totpPin"], input#totpPin'));
      if (!stillTotp || isGoogleProcessing()) return;
      const tNow = Date.now();
      if (tNow - (window.__flowLastTotpSubmitAt || 0) < 2400) return;
      window.__flowLastTotpSubmitAt = tNow;
      autoLoginState.lastActionTime = tNow;
      const next =
        document.querySelector('#totpNext button') ||
        document.querySelector('#totpNext [role="button"]') ||
        document.querySelector('#idvPreregisteredPhoneNext button') ||
        buttonByLabel(/^next$/i) ||
        document.querySelector('#totpNext');
      console.log('[Flow Preload] Submitting TOTP Next');
      if (next && isElementVisible(next)) {
        try {
          next.removeAttribute('disabled');
          next.setAttribute('aria-disabled', 'false');
        } catch (e) {}
        hardClick(next);
        try {
          const r = next.getBoundingClientRect();
          const x = r.left + r.width / 2;
          const y = r.top + r.height / 2;
          if (x > 2 && y > 2) {
            ipcRenderer.sendToHost('cdp-click', { x, y, kind: 'totp-next' });
          }
        } catch (e) {}
      } else {
        try {
          totpInput.focus();
          const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
          totpInput.dispatchEvent(new KeyboardEvent('keydown', opts));
          totpInput.dispatchEvent(new KeyboardEvent('keypress', opts));
          totpInput.dispatchEvent(new KeyboardEvent('keyup', opts));
          if (totpInput.form) totpInput.form.requestSubmit();
        } catch (e) {}
      }
    };

    if (now - (autoLoginState._otpFilledAt || now) >= 550) {
      triggerTotpNext();
    } else {
      setTimeout(triggerTotpNext, 600);
    }
    return;
  }

  const emailInput = document.querySelector(
    'input#identifierId, input[type="email"], input[name="identifier"], input[name="Email"], ' +
    'input[autocomplete="username"], input[aria-label*="Email" i], input[aria-label*="email or phone" i]'
  );
  const passwordInput = passwordInputEarly;

  // Password: only on /challenge/pwd — never while selection/totp paints Passwd (SPA lag)
  const onPostPwdPath = /\/challenge\/(selection|totp|skotp|sk|iap|dp|ootp)/i.test(pathname);
  if (onPostPwdPath) return;
  if (onPwdChallenge || (pwdFieldReady && !onChallengeChooser && !onSecurityCodeScreen)) {
    if (!onPwdChallenge && !pwdFieldReady) return;
    if (!pwdFieldReady) {
      pathSettled('challenge-form', 500);
      return;
    }
    if (!pathSettled('pwd-ready', 400)) return;
    if (!credentials.password) return;

    // Host already submitted / scheduled CDP Next
    try {
      const st = window.__flowHostAuto;
      const pwdKey = 'pwd:' + pathname.split('/').slice(0, 5).join('/');
      if (st && (st[pwdKey] === 'submitted' || st[pwdKey] === 'cdp-scheduled' || st[pwdKey] === 'filled')) {
        autoLoginState.passwordSubmitted = st[pwdKey] === 'submitted';
        autoLoginState.passwordFilled = true;
        // Host owns Next — fill only if empty
        if ((passwordInput.value || '') !== credentials.password) {
          fillInputValue(passwordInput, credentials.password);
        }
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
      // Host CDP owns Next when __flowHostOwnsNext — do not submitGoogleNextWhenReady
      if (window.__flowHostOwnsNext || DEBUG_FILL_ONLY) {
        console.log('[Flow Preload] Password filled — host owns Next');
        // If host CDP never advances, DOM-click Next after stall (password loop fix)
        const watchKey = `host-next-watch:password:${pathname}`;
        if (!autoLoginState.submittedKeys.has(watchKey)) {
          autoLoginState.submittedKeys.add(watchKey);
          setTimeout(() => {
            try {
              if (!/\/challenge\/pwd/i.test(location.pathname || '')) return;
              const pwd = document.querySelector('input[name="Passwd"], input[type="password"]');
              if (!pwd || !(pwd.value || '').length) return;
              console.warn('[Flow Preload] Host Next stalled on password — DOM fallback');
              const owned = window.__flowHostOwnsNext;
              window.__flowHostOwnsNext = false;
              submitGoogleNext('password', pwd);
              window.__flowHostOwnsNext = owned;
            } catch (e) {}
          }, 6000);
        }
      } else if (!autoLoginState.passwordSubmitted) {
        submitGoogleNextWhenReady('password', passwordInput, { initialDelayMs: 900, maxMs: 14000 });
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
      if (DEBUG_FILL_ONLY || window.__flowHostOwnsNext) {
        console.log('[Flow Preload] Email filled — host owns Next / fill-only');
        const watchKey = `host-next-watch:identifier:${pathname}`;
        if (window.__flowHostOwnsNext && !autoLoginState.submittedKeys.has(watchKey)) {
          autoLoginState.submittedKeys.add(watchKey);
          setTimeout(() => {
            try {
              if (/\/challenge\/pwd/i.test(location.pathname || '')) return;
              const em = document.querySelector('input#identifierId, input[type="email"]');
              if (!em || !(em.value || '').trim()) return;
              console.warn('[Flow Preload] Host Next stalled on identifier — DOM fallback');
              const owned = window.__flowHostOwnsNext;
              window.__flowHostOwnsNext = false;
              submitGoogleNext('identifier', em);
              window.__flowHostOwnsNext = owned;
            } catch (e) {}
          }, 6000);
        }
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
      !window.__flowHostOwnsNext &&
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
  const onFlow = host.includes('flow.google.com') || host.includes('labs.google') || host.includes('gemini.google.com');
  const onAccounts = host.includes('accounts.google.com') || host.includes('accounts.youtube.com');
  // Never interrupt password / TOTP / method chooser — but selfie / precollection IS skippable
  const onHardAuth =
    onAccounts &&
    (/\/identifier/i.test(path) ||
      /\/challenge\/(totp|pwd|selection|sk|iap|dp|ootp)/i.test(path) ||
      /CheckCookie|LoginDone/i.test(path) ||
      document.querySelector('input[name="totpPin"], input#totpPin, input[name="Passwd"], input#identifierId'));
  const onSkipInterstitial =
    /verification\/selfie|\/selfie\/|precollection|speedbump|idvreenable|phoneverification|confirmidentifier|privacyreminder|accountrecovery|homeaddress|passkeyenrollment|\/rejected/i.test(path) ||
    /take a selfie|confirm it.?s you|verify it.?s you|use your selfie|add a recovery phone|set a home address|home and work addresses|create a passkey|skip for now/i.test(bodySlice);

  if (onHardAuth && !onSkipInterstitial) return false;

  const pageLooksRecovery = /make sure you can always sign in|add a recovery phone|your recovery email|set a home address|home and work addresses|recovery options|confirm it.?s you|take a selfie/i.test(bodySlice);
  const pathLooksRecovery =
    /recovery|speedbump|interstitial|accountrecovery|home.?address|homeaddress|selfie|precollection|verification/i.test(path) ||
    path.includes('/web/recoveryoptions') ||
    path.includes('/web/homeaddress');
  const onHomeAddress =
    onGds &&
    (/\/web\/homeaddress/i.test(path) ||
      /homeaddress|home.?address/i.test(path) ||
      /set a home address|home and work addresses/i.test(bodySlice));

  // Dedicated home-address clip: Skip / Later / Cancel / Not now — retryable, then bounce to Flow
  if (onHomeAddress) {
    try {
      const now = Date.now();
      if (!window.__flowHomeAddrClickAt) window.__flowHomeAddrClickAt = 0;
      if (now - window.__flowHomeAddrClickAt > 900) {
        window.__flowHomeAddrClickAt = now;
        const homeDismissRe = /\b(skip|skip for now|not now|no thanks|later|remind me later|maybe later|cancel|close|dismiss|not interested)\b/i;
        const forbidRe = /^(save|next|continue|done|submit|add|confirm|verify|start|take photo|allow|ok)$/i;
        const cands = [];
        document.querySelectorAll(
          'button, a, [role="button"], div[role="link"], span[role="button"], ' +
          '[jsname], [data-id], [aria-label]'
        ).forEach((el) => {
          if (!isElementVisible(el)) return;
          const t = (el.innerText || el.textContent || el.getAttribute('aria-label') || '')
            .replace(/\s+/g, ' ')
            .trim();
          if (!t || t.length > 64) return;
          if (forbidRe.test(t)) return;
          if (!homeDismissRe.test(t)) return;
          cands.push(el);
        });
        // Also classic Google skip controls
        const skipBtn = document.querySelector(
          '#recoverySkip, button[jsname="j6LnO"], [data-id="skip"], ' +
          '[aria-label*="Skip" i], [aria-label*="Cancel" i], [aria-label*="Not now" i], ' +
          '[aria-label*="Later" i], [aria-label*="Remind" i]'
        );
        if (skipBtn && isElementVisible(skipBtn)) cands.unshift(skipBtn);
        if (cands.length) {
          cands.sort((a, b) => {
            const score = (el) => {
              const t = (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().toLowerCase();
              if (/not now|skip for now/.test(t)) return 0;
              if (/^skip$|no thanks|not interested/.test(t)) return 1;
              if (/later|remind/.test(t)) return 2;
              if (/cancel|close|dismiss/.test(t)) return 3;
              return 4;
            };
            return score(a) - score(b);
          });
          hardClick(cands[0]);
          console.log('[Flow Preload] homeaddress dismiss click:', (cands[0].innerText || '').slice(0, 40));
        }
      }
      if (!window.__flowHomeAddrBounceAt) window.__flowHomeAddrBounceAt = 0;
      // If still on homeaddress after ~1.8s, force Flow
      if (!window.__flowHomeAddrSeenAt) window.__flowHomeAddrSeenAt = now;
      if (now - window.__flowHomeAddrSeenAt > 1800 && now - window.__flowHomeAddrBounceAt > 2500) {
        window.__flowHomeAddrBounceAt = now;
        const bounceUrl = credentials.targetUrl || 'https://flow.google.com/';
        console.log('[Flow Preload] Bouncing off gds homeaddress →', bounceUrl);
        location.replace(bounceUrl);
        return true;
      }
    } catch (e) {}
    return true;
  } else {
    window.__flowHomeAddrSeenAt = 0;
  }

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

  if (!onGds && !pageLooksRecovery && !pathLooksRecovery && !onSkipInterstitial) {
    // Still try classic recoverySkip / Not now on accounts
    if (onAccounts) {
      const skipBtn = document.querySelector('#recoverySkip, button[jsname="j6LnO"]');
      if (skipBtn && isElementVisible(skipBtn)) {
        clickOnce('recovery-skip', skipBtn);
        return true;
      }
      const notNow = Array.from(document.querySelectorAll('button, a, [role="button"]')).find((el) =>
        isElementVisible(el) && /^(not now|skip for now|skip|no thanks)$/i.test((el.innerText || '').replace(/\s+/g, ' ').trim())
      );
      if (notNow) {
        clickOnce('not-now', notNow);
        return true;
      }
    }
    return false;
  }

  const skipBtn = document.querySelector(
    '#recoverySkip, button[jsname="j6LnO"], [data-id="skip"], [aria-label*="Skip" i], [aria-label*="Cancel" i], [aria-label*="Not now" i], [aria-label*="No thanks" i], [aria-label*="Later" i], [aria-label*="Remind" i]'
  );
  if (skipBtn && isElementVisible(skipBtn)) {
    clickOnce('recovery-skip', skipBtn);
    return true;
  }

  const dismissRe = /^(not now|skip for now|cancel|skip|no thanks|remind me later|maybe later|later|close|dismiss|not interested)$/i;
  const cands = [];
  document.querySelectorAll('button, a, [role="button"], div[role="link"], span[role="button"]').forEach((el) => {
    if (!isElementVisible(el)) return;
    const t = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 48) return;
    if (!dismissRe.test(t)) return;
    // Never click Save / Next / Continue / Verify on these screens
    if (/^(save|next|continue|done|submit|add|confirm|verify|start|take photo|allow)$/i.test(t)) return;
    cands.push(el);
  });
  if (cands.length) {
    cands.sort((a, b) => {
      const score = (el) => {
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (t === 'not now' || t === 'skip for now') return 0;
        if (t === 'skip' || t === 'no thanks' || t === 'not interested') return 1;
        if (t === 'later' || t === 'remind me later' || t === 'maybe later') return 2;
        if (t === 'cancel') return 3;
        return 4;
      };
      return score(a) - score(b);
    });
    clickOnce('recovery-dismiss:' + (cands[0].innerText || 'x').slice(0, 20), cands[0]);
    return true;
  }

  // gds / recovery stuck with no Cancel — NEVER bounce while still on accounts.google.com
  // (forced flow.google.com jump aborted OTP / CheckCookie and looked like logout)
  if (onAccounts) return false;
  if (onGds || (pageLooksRecovery && !onFlow && !onAccounts)) {
    try {
      if (!window.__flowRecoveryBounceAt) window.__flowRecoveryBounceAt = 0;
      const now = Date.now();
      if (now - window.__flowRecoveryBounceAt > 2500) {
        window.__flowRecoveryBounceAt = now;
        const bounceUrl = credentials.targetUrl || 'https://flow.google.com/';
        console.log('[Flow Preload] Bouncing off Google recovery interstitial (gds only) →', bounceUrl);
        location.replace(bounceUrl);
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
    // Never hide top-right profile button, avatar, or ULTRA tier chip
    if (
      el.closest(
        '.header-user-button, flow-user-tier-chip, .tier-chip, [aria-label="ULTRA tier"], ' +
        '[aria-label="Account details"], .account-switcher-placeholder, #flow-my-projects-dock, #flow-saved-projects-backdrop'
      )
    ) {
      return true;
    }
    // Always allow hiding known chrome targets (credits banner / projects grid / delete-button)
    if (
      el.closest(
        'flow-credit-banner, .credit-banner, .credit-banner-container, ' +
        '.projects-grid, flow-menu-item.delete-button, [data-flow-blocked-model="1"]'
      )
    ) {
      return false;
    }
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
        if (/ULTRA tier/i.test(t)) return false;
        if (el.getAttribute?.('role') === 'alert' || el.getAttribute?.('role') === 'status') return false;
        if (tag === 'button' || tag === 'a' || (tag === 'span' && el.childElementCount === 0)) {
          if (/^ultra$/i.test(t) || /Add AI credits/i.test(t) || /Delete all projects/i.test(t)) return false;
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

function hideFlowChromeTargets() {
  try {
    const sels = [
      '.projects-grid',
      'flow-menu-item.delete-button',
      'flow-credit-banner',
      '.credit-banner',
      '.credit-banner-container'
    ];
    sels.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => hideEl(el));
    });
    // Menu row by label
    document.querySelectorAll('flow-menu-item, button[mat-menu-item], [role="menuitem"]').forEach((el) => {
      const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (/delete all projects/i.test(t)) hideEl(el.closest('flow-menu-item') || el);
    });
  } catch (e) {}
}

function hideUltraControls() {
  try {
    hideFlowChromeTargets();
  } catch (e) {}
}

function killAccountPopupNow() {
  // PakFlow mode: keep the account/credits popup open so the user sees:
  // - "45000 Google Flow credits" (a[href*='flow_ai_credits_page']::after)
  // - "Google Ultra Plan 20x" (a.upsell-link span.mdc-button__label::after)
  // Only hide sign-out buttons and switch-account email links inside the popup.
  try {
    const host = (location.hostname || '').toLowerCase();
    if (host.includes('accounts.google.com') || host.includes('accounts.youtube.com')) return;
  } catch (e) {}
  purgeSignoutElements();
  document.querySelectorAll('a.switch-account-link, a[href*="myaccount.google.com"]').forEach((el) => hideEl(el));
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
    if (!host.includes('flow.google.com') && !host.includes('labs.google')) return;
  } catch (e) {}
  ensureNewProjectClickable();
  document.querySelectorAll('.projects-grid, flow-project-card').forEach((card) => {
    const t = (card.innerText || card.textContent || '').replace(/\s+/g, ' ').trim();
    if (/new project|create tool/i.test(t) || card.querySelector('[data-flow-new-project="1"]')) {
      ensureClickableTree(card);
      return;
    }
    hideEl(card);
  });
}

function maskFlowWorkspace() {
  const hostname = window.location.hostname;
  const isFlow = hostname.includes('flow.google.com') || hostname.includes('labs.google');
  if (!isFlow) return;

  const profileSelectors = [
    'a.switch-account-link'
  ];
  profileSelectors.forEach(sel => {
    try {
      document.querySelectorAll(sel).forEach(el => hideEl(el));
    } catch (e) {}
  });

  hideAccountPrivacyPanels();
  hideTransientAccountUi();
  hideFlowChromeTargets();
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
    document.querySelectorAll('flow-credit-banner, .credit-banner, .credit-banner-container').forEach((el) => hideEl(el));
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
      '[role="alert"], [role="status"], [role="alertdialog"], flow-credit-banner'
    );
    candidates.forEach((el) => {
      if (!el || el.tagName === 'BODY' || el.tagName === 'HTML') return;
      if (el.id === 'flow-generation-toast' || el.closest('#flow-generation-toast')) return;

      const txt = (el.innerText || el.textContent || '').trim();
      if (!txt || txt.length > 420) return;
      if (!isCreditsNag(txt) && el.tagName !== 'FLOW-CREDIT-BANNER') return;
      hideEl(el);
    });

    document.querySelectorAll('a.credit-banner-cta, button.credit-banner-dismiss').forEach((el) => {
      hideEl(el.closest('flow-credit-banner, .credit-banner-container') || el);
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
  if (target.closest('a[href*="myaccount.google.com"]')) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const label = ((target.innerText || target.getAttribute?.('aria-label')) || '').toLowerCase();
  if (label.includes('sign out of all accounts') || label.includes('sign out')) {
    e.preventDefault();
    e.stopPropagation();
    hideEl(target.closest('button, a, li') || target);
  }
  // If user clicked something that opens account UI, scrub it immediately
  setTimeout(killAccountPopupNow, 30);
}, true);

// Continuously scrub account popup as soon as it mounts
(function installAccountKillerObserver() {
  const isFlowPage = () => {
    try {
      const host = (location.hostname || '').toLowerCase();
      return host.includes('flow.google.com') || host.includes('labs.google');
    } catch (e) { return false; }
  };
  const run = () => {
    if (!isFlowPage()) return;
    try {
      // Inside a project, keep the killer light — heavy scans blanked All media
      if (/\/project\//i.test(location.pathname || '')) {
        hideFlowChromeTargets();
        hideUltraControls();
        hideGoogleCreditsWarningBanner();
        return;
      }
      killAccountPopupNow();
      hideExistingProjects();
      hideFlowChromeTargets();
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
    /* Home: hide existing projects grid */
    .projects-grid,
    .projects-grid * {
      display: none !important;
      visibility: hidden !important;
      pointer-events: none !important;
      height: 0 !important;
      max-height: 0 !important;
      overflow: hidden !important;
      opacity: 0 !important;
    }

    /* Delete all projects menu row + blocked model picker rows */
    flow-menu-item.delete-button,
    flow-menu-item.delete-button button,
    flow-menu-item[data-flow-blocked-model="1"],
    flow-menu-item[data-flow-blocked-model="1"] button,
    button[data-flow-blocked-model="1"],
    [role="menuitem"][data-flow-blocked-model="1"],
    .flow-internal-menu-item[data-flow-blocked-model="1"] {
      display: none !important;
      visibility: hidden !important;
      pointer-events: none !important;
      height: 0 !important;
      max-height: 0 !important;
      opacity: 0 !important;
      overflow: hidden !important;
    }
    flow-menu-item.delete-button {
      display: none !important;
      visibility: hidden !important;
      pointer-events: none !important;
      height: 0 !important;
      max-height: 0 !important;
      opacity: 0 !important;
    }

    /* Google Flow credits banner */
    flow-credit-banner,
    .credit-banner,
    .credit-banner-container,
    .credit-banner-error,
    .credit-banner-cta,
    a.credit-banner-cta {
      display: none !important;
      visibility: hidden !important;
      pointer-events: none !important;
      height: 0 !important;
      max-height: 0 !important;
      overflow: hidden !important;
      opacity: 0 !important;
    }

    /* Account switcher / Google bar (keep .header-user-button & tier-chip visible for PakFlow credits menu) */
    a.switch-account-link {
      display: none !important;
      visibility: hidden !important;
      pointer-events: none !important;
      width: 0 !important;
      height: 0 !important;
      overflow: hidden !important;
      opacity: 0 !important;
    }

    /* Hide ULTRA model picker chips */
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

  // Keep profile & header icons visible

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
  if (!creds) return;
  if (creds.imageOnly !== undefined || creds.serverId !== undefined) {
    window.__flowSetImageOnlyMode(
      creds.imageOnly !== undefined ? !!creds.imageOnly : !!credentials.imageOnly,
      creds.serverId !== undefined ? creds.serverId : credentials.serverId
    );
  }
  if (!creds.email) return;
  const prevEmail = (credentials.email || '').toLowerCase();
  const nextEmail = String(creds.email || '').toLowerCase();
  const savedOtp = credentials._otp || '';
  const onMidChallenge = /\/challenge\/(totp|selection|pwd|sk|iap|dp|ootp)|\/SetSID/i.test(location.pathname || '');
  const forceReset = !!creds.forceReset || (!onMidChallenge && prevEmail && nextEmail && prevEmail !== nextEmail);
  credentials = {
    ...credentials,
    ...creds,
    _otp: creds.forceReset ? '' : savedOtp,
    imageOnly: creds.imageOnly !== undefined ? !!creds.imageOnly : !!credentials.imageOnly
  };
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
  if ((forceReset || !prevEmail) && (!onMidChallenge || creds.forceReset)) {
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
  const nextOtp = String(otp);
  const changed = credentials._otp !== nextOtp;
  credentials._otp = nextOtp;
  autoLoginState.otpRequested = true;
  if (changed) {
    autoLoginState.submittedKeys.delete(`otp:${location.pathname}:fill`);
  }
  console.log('[Flow Preload] TOTP received from host');
  setTimeout(() => runGoogleAutoLogin(), 150);
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
  // SetSID / totp UI — request OTP if not yet received; Next click is owned by runGoogleAutoLogin
  const totpEl = document.querySelector('input[name="totpPin"], input#totpPin, input[autocomplete="one-time-code"]');
  if (/\/challenge\/totp/i.test(path) || /\/SetSID/i.test(path) || totpEl) {
    if (!credentials._otp && now - (driveGoogle2faClicks._otpAt || 0) > 2500) {
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

  // Host owns 2FA CDP — inject driveGoogle2faClicks is backup only
  if (window.__flowHostOwns2fa) return;

  // g.co/sc / skotp security-code prompt → Try another way
  const onSkotp =
    /\/challenge\/skotp/i.test(path) ||
    /\/challenge\/sk(?:\/|$)/i.test(path) ||
    (/g\.co\/sc|get a code to sign in|enter security code/i.test((document.body && document.body.innerText) || '') &&
      !/choose how you want to sign in|authenticator app/i.test((document.body && document.body.innerText) || ''));
  if (onSkotp) {
    const tryAnother = Array.from(document.querySelectorAll('button, a, [role="button"], [role="link"], span, div')).find((el) =>
      /^try another way$/i.test((el.innerText || '').replace(/\s+/g, ' ').trim()) && visible(el)
    );
    if (tryAnother) sendClick(tryAnother, 'try-another');
    return;
  }

  // Method list → Google Authenticator (reuse shared finder + CDP)
  if (/\/challenge\/selection/i.test(path)) {
    const el = typeof findAuthenticatorOption === 'function' ? findAuthenticatorOption() : null;
    if (el && visible(el)) sendClick(el, 'auth-app');
  }
}

// Periodic polling — keep Flow light to avoid black-screen freezes
setInterval(() => {
  const host = (location.hostname || '').toLowerCase();
  const onGoogleAuth = host.includes('accounts.google.com') || host.includes('accounts.youtube.com');
  const onGds = host.includes('gds.google.com');
  const onFlow = host.includes('flow.google.com') || host.includes('labs.google');
  const onGemini = host.includes('gemini.google.com') || host.includes('bard.google.com');
  if (onGoogleAuth) driveGoogle2faClicks();
  runGoogleAutoLogin();
  // gds homeaddress / recovery: dismiss every tick (also covered inside auto-login)
  if (onGds || (!onGoogleAuth && !onGemini)) dismissGoogleInterstitials();
  if (onGoogleAuth || onGds || onGemini) return;
  if (onFlow) {
    maskFlowWorkspace();
    enforceModelRestrictions();
    autoSelectLowerPriorityModel();
    forceRenameLiteEverywhere();
    hideTransientAccountUi();
    hideUltraControls();
    return;
  }
}, 700);

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

})(); // end __flowInjectBootstrapped

