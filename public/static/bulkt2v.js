/**
 * Bulk Text to Video — Next /api/generate/* (credits + queue).
 * Persists to localStorage; resumes after refresh; server jobs keep running after logout.
 */
(function () {
  'use strict';

  if (typeof window !== 'undefined' && window.__GFLOW_BULKT2V_INIT__) {
    return;
  }

  const API_BASE = '';
  const MAX_CHARS = 6;
  const STORAGE_KEY = 'gflow_btv_state_v1';
  const STATE_TTL_MS = 24 * 60 * 60 * 1000;

  const btv = {
    characters: [],
    scenes: [],
    running: false,
    chain: false,
    duration: 8,
    bound: false,
    runActive: false,
    runEpoch: 0,
    /** Set on Stop; cleared only by Generate All — blocks revive/resume races. */
    userStopped: false,
    pipelineBusy: false,
    fillingSlots: false,
    sessionJobIds: [],
    model: 'VEO_3_1_LITE',
    aspect: '16:9',
    globalPrompt: '',
    scriptText: '',
    pollTimer: null,
    _fillTimer: null,
  };

  /** Match Studio plan parallel slots at 50% for bulk (user parallel 4 → 2). */
  function getMaxParallel() {
    if (typeof window.getBulkMaxParallel === 'function') {
      return window.getBulkMaxParallel();
    }
    const plan = Math.max(1, Number(window.__GFLOW_MAX_PARALLEL__) || 5);
    return Math.max(1, Math.floor(plan / 2));
  }

  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
    else console.log('[BulkT2V]', type || 'info', msg);
  }

  function toUserFacingGenerationError(raw) {
    const text = String(raw == null ? '' : raw).trim();
    if (/^(stop(ped)?\s*by\s*user|cancelled( by user)?|canceled( by user)?)$/i.test(text)) {
      return 'Stop by user';
    }
    if (typeof window.toUserFacingGenerationError === 'function') {
      return window.toUserFacingGenerationError(raw);
    }
    if (!text) return 'System Error';
    if (/UNUSUAL_ACTIVITY|RECAPTCHA|unusual\s*activity/i.test(text)) {
      return 'Unusual activity';
    }
    if (/Bearer rejected|MODEL_ACCESS_DENIED|QUOTA|WORKER RETURNED|INTERNAL SERVER|TIMEOUT|CDP|COOKIE|Insufficient/i.test(text)) {
      return 'System Error';
    }
    const isPolicy =
      /POLICY\s*VIOLAT/i.test(text) ||
      /CONTENT[_\s-]?POLICY/i.test(text) ||
      /SAFETY[_\s-]?(FILTER|VIOLAT|BLOCK|CHECK)/i.test(text) ||
      /PUBLIC_ERROR_[A-Z0-9_]*?(UNSAFE|SAFETY|FILTER|BLOCKED|POLICY)/i.test(text) ||
      /PROHIBITED[_\s-]?CONTENT/i.test(text) ||
      /unsafe\s+content/i.test(text) ||
      /Rejected by Google due to policy violation/i.test(text);
    return isPolicy ? 'Rejected by Google due to policy violation' : 'System Error';
  }

  function isUserStopError(raw) {
    return toUserFacingGenerationError(raw) === 'Stop by user';
  }

  function isRunCurrent(epoch) {
    return !!btv.runActive && !btv.userStopped && Number(epoch) === Number(btv.runEpoch);
  }

  function bumpRunEpoch() {
    btv.runEpoch = (btv.runEpoch || 0) + 1;
    return btv.runEpoch;
  }

  function clearFillTimer() {
    if (btv._fillTimer) {
      clearTimeout(btv._fillTimer);
      btv._fillTimer = null;
    }
  }

  /** Hard stop flags — call before cancelling scenes. */
  function armUserStop() {
    btv.userStopped = true;
    btv.runActive = false;
    bumpRunEpoch();
    btv.pipelineBusy = false;
    btv.fillingSlots = false;
    clearFillTimer();
  }

  async function withSystemErrorRetry(fn, label) {
    if (typeof window.withSystemErrorRetry === 'function') {
      return window.withSystemErrorRetry(fn, label);
    }
    const maxAttempts = 5;
    const delayMs = 2500;
    const throttleDelayMs = 10000;
    const isThrottle = (raw) =>
      /USER_REQUESTS_THROTTLED|REQUESTS_THROTTLED|THROTTLED|batchexecute error e=4|\be\s*=\s*4\b/i.test(
        String(raw == null ? '' : raw)
      );
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const msg = err && err.message ? err.message : String(err);
        const labelText = toUserFacingGenerationError(msg);
        if (labelText !== 'System Error' && labelText !== 'Unusual activity') throw err;
        if (attempt >= maxAttempts) break;
        const waitMs = isThrottle(msg) ? Math.max(delayMs, throttleDelayMs) : delayMs;
        console.warn(`[BulkT2V] system-retry ${label || ''} attempt ${attempt}/${maxAttempts}:`, msg, `(${waitMs}ms)`);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
    throw lastErr;
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return `btv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function extractFlowMediaId(urlOrId) {
    if (!urlOrId) return null;
    const s = String(urlOrId);
    const m = s.match(/flow-content\.google\/(?:image|video)\/([a-f0-9-]+)/i);
    if (m) return m[1];
    if (/^[a-f0-9-]{20,}$/i.test(s) && !s.startsWith('staged-')) return s;
    return null;
  }

  function parseBulkT2VScript(text) {
    const raw = String(text || '').replace(/\r\n/g, '\n');
    const markerRe =
      /\b(Scene|Script|Prompt)\s+(\d+)\s*(?:[:.\-·–—]\s*|(?=\s+(?:Scene|Script|Prompt)\s+\d+\b)|\s*\n\s*)/gi;
    const matches = [];
    let m;
    while ((m = markerRe.exec(raw)) !== null) {
      matches.push({
        index: m.index,
        kind: m[1],
        num: m[2],
        endHeader: markerRe.lastIndex,
      });
    }
    if (!matches.length) {
      const trimmed = raw.trim();
      if (!trimmed) return [];
      return [{ id: uuid(), index: 1, title: 'Scene 1 :', prompt: trimmed }];
    }
    const scenes = [];
    for (let i = 0; i < matches.length; i++) {
      const cur = matches[i];
      const next = matches[i + 1];
      const body = raw.slice(cur.endHeader, next ? next.index : raw.length).trim();
      const num = Number(cur.num) || i + 1;
      scenes.push({
        id: uuid(),
        index: num,
        title: `Scene ${num} :`,
        prompt: body,
        status: 'idle',
        url: '',
        mediaId: null,
        error: '',
        jobId: null,
        queueMessage: '',
      });
    }
    return scenes.filter((s) => s.prompt.length > 0 || scenes.length === 1);
  }

  function matchCharactersForScene(prompt, characters) {
    const text = String(prompt || '');
    return (characters || [])
      .filter((c) => c && c.name && (c.mediaId || c.stagedId || c.imageUrl))
      .filter((c) => {
        const name = String(c.name).trim();
        if (name.length < 2) return false;
        const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        return re.test(text);
      })
      .map((c) => ({
        entity_id: c.entityId || c.id,
        character_id: c.entityId || c.id,
        name: c.name,
        image_media_id: c.mediaId || null,
        image_url: c.imageUrl || null,
        local_image_path: null,
      }));
  }

  function buildSuperPrompt(globalPrompt, scenePrompt, matchedChars) {
    const parts = [];
    const g = String(globalPrompt || '').trim();
    if (g) parts.push(`Style / setting: ${g}`);
    if (matchedChars && matchedChars.length) {
      parts.push(
        'Characters in this scene (keep likeness): ' + matchedChars.map((c) => c.name).join(', ')
      );
    }
    parts.push(String(scenePrompt || '').trim());
    return parts.filter(Boolean).join('\n\n');
  }

  function els() {
    return {
      model: document.getElementById('btv-model-select'),
      aspect: document.getElementById('btv-aspect-select'),
      duration: document.getElementById('btv-duration-select'),
      global: document.getElementById('btv-global-prompt'),
      script: document.getElementById('btv-script-editor'),
      genBtn: document.getElementById('btv-generate-all-btn'),
      clearBtn: document.getElementById('btv-clear-grid-btn'),
      stopBtn: document.getElementById('btv-stop-btn'),
      dlAllBtn: document.getElementById('btv-download-all-btn'),
      status: document.getElementById('btv-sequence-status'),
      empty: document.getElementById('btv-sequence-empty'),
      grid: document.getElementById('btv-sequence-grid'),
    };
  }

  function readFormIntoState() {
    const { model, aspect, duration, script } = els();
    if (model) btv.model = model.value || 'VEO_3_1_LITE';
    if (aspect) {
      const ar = aspect.value || '16:9';
      btv.aspect = ar === '1:1' ? '16:9' : ar;
    }
    if (duration) btv.duration = Number(duration.value) || 8;
    btv.globalPrompt = '';
    if (script) btv.scriptText = script.value || '';
    btv.chain = false; // V1 pure T2V — never chain
  }

  function writeFormFromState() {
    const { model, aspect, duration, script } = els();
    if (model && btv.model) model.value = btv.model;
    if (aspect) {
      if (btv.aspect === '1:1') btv.aspect = '16:9';
      aspect.value = btv.aspect || '16:9';
    }
    updateDurationOptionsForModel(btv.model);
    if (duration) duration.value = String(btv.duration || 8);
    if (script && btv.scriptText) script.value = btv.scriptText;
  }

  function updateDurationOptionsForModel(model) {
    const isOmni = String(model || btv.model || '') === 'OMNI_1_1_FLASH';
    const opt10 = document.getElementById('btv-dur-10s-opt');
    if (opt10) {
      opt10.hidden = !isOmni;
      opt10.disabled = !isOmni;
    }
    if (!isOmni && Number(btv.duration) === 10) {
      btv.duration = 8;
      const duration = document.getElementById('btv-duration-select');
      if (duration) duration.value = '8';
    }
  }

  function applyBulkT2VModelLockSync() {
    const model = document.getElementById('btv-model-select');
    if (!model) return;
    readFormIntoState();
    updateDurationOptionsForModel(btv.model);
    saveState();
  }

  
  function mediaUrlExpired(url) {
    if (!url || typeof url !== 'string') return false;
    try {
      if (typeof window.parseExpiresFromMediaUrl === 'function') {
        const d = window.parseExpiresFromMediaUrl(url);
        return !!(d && d.getTime() <= Date.now());
      }
    } catch (_) {}
    const match = url.match(/[?&]Expires=(\d+)/i);
    if (!match) return false;
    const raw = Number(match[1]);
    if (!Number.isFinite(raw) || raw <= 0) return false;
    const ms = raw > 1e12 ? raw : raw * 1000;
    return ms <= Date.now();
  }

  function saveState() {
    if (btv._formHydrated) readFormIntoState();
    const payload = {
      savedAt: Date.now(),
      expiresAt: Date.now() + STATE_TTL_MS,
      runActive: !!btv.runActive,
      userStopped: !!btv.userStopped,
      chain: !!btv.chain,
      model: btv.model,
      aspect: btv.aspect,
      duration: btv.duration || 8,
      globalPrompt: btv.globalPrompt,
      scriptText: btv.scriptText,
      characters: btv.characters,
      scenes: btv.scenes,
    };
    try {
      // Drop blob previews from scenes before persist
      if (Array.isArray(payload.scenes)) {
        payload.scenes = payload.scenes.map((s) => {
          if (!s) return s;
          const copy = { ...s };
          delete copy.file;
          if (copy.previewUrl && String(copy.previewUrl).startsWith('blob:')) delete copy.previewUrl;
          if (copy.url && mediaUrlExpired(copy.url)) {
            copy.url = '';
            if (copy.status === 'ready') {
              copy.status = 'failed';
              copy.error = 'Media expired';
            }
          }
          return copy;
        });
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (_) {
      try {
        if (Array.isArray(payload.scenes)) {
          payload.scenes = payload.scenes.map((s) => ({
            ...s,
            url: s && s.url && String(s.url).startsWith('http') ? '' : (s && s.url) || '',
          }));
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch (__) {}
    }
  }

  function clearPersistedState() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
  }

  function loadState() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!raw) return false;
      // Soft expiry: never wipe whole tool on logout/TTL — only drop CDN-expired media urls below.
      btv.runActive = !!raw.runActive;
      btv.userStopped = !!raw.userStopped;
      btv.chain = false;
      btv.duration = Number(raw.duration) || 8;
      btv.model = raw.model || 'VEO_3_1_LITE';
      btv.aspect = raw.aspect === '1:1' ? '16:9' : (raw.aspect || '16:9');
      btv.globalPrompt = '';
      btv.scriptText = raw.scriptText || '';
      btv.characters = Array.isArray(raw.characters) ? raw.characters : [];
      btv.scenes = Array.isArray(raw.scenes) ? raw.scenes : [];
      btv.scenes.forEach((s, i) => {
        if (s) {
          s.index = Number(s.index) || i + 1;
          s.title = normalizeSceneTitle(s, i + 1);

          if (s.url && mediaUrlExpired(s.url)) {
            s.url = '';
            if (s.status === 'ready') {
              s.status = 'failed';
              s.error = 'Media expired';
            }
          }
        }
      });
      // Never resume a dead run (Stop left only failed/ready cards)
      if (btv.runActive || btv.userStopped) {
        const canWork = btv.scenes.some(
          (s) => s && (s.status === 'idle' || s.status === 'queued' || s.status === 'generating')
        );
        if (btv.userStopped || !canWork) {
          btv.runActive = false;
        }
      }
      return btv.scenes.length > 0 || !!btv.scriptText;
    } catch (_) {
      return false;
    }
  }

  function ensureDefaultCharacters() {
    if (btv.characters.length) return;
    for (let i = 0; i < 3; i++) {
      btv.characters.push({
        id: uuid(),
        name: '',
        imageUrl: '',
        mediaId: null,
        stagedId: null,
        entityId: null,
        status: 'idle',
        lastPrompt: '',
      });
    }
  }

  const ICON_UPLOAD =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';
  const ICON_SPARKLE =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.2 3.8L17 7l-3.8 1.2L12 12l-1.2-3.8L7 7l3.8-1.2L12 2zm6 8l.8 2.4L21 14l-2.2.8L18 17l-.8-2.2L15 14l2.2-.8L18 10zM6 14l.7 2.1L9 17l-2.3.7L6 20l-.7-2.3L3 17l2.3-.7L6 14z"/></svg>';
  const ICON_X =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  function clearCharacterMedia(c) {
    c.imageUrl = '';
    c.mediaId = null;
    c.stagedId = null;
    c.status = 'idle';
    c.error = '';
  }

  function renderCharacters() {
    const { charGrid } = els();
    if (!charGrid) return;
    ensureDefaultCharacters();
    charGrid.innerHTML = '';

    btv.characters.forEach((c) => {
      const card = document.createElement('div');
      const busy = c.status === 'generating';
      const filled = !!c.imageUrl;
      card.className = `btv-char-card${filled ? ' has-image' : ' is-empty'}${busy ? ' is-generating' : ''}`;

      if (filled) {
        card.innerHTML = `
          <div class="btv-char-thumb">
            <img src="${escapeHtml(c.imageUrl)}" alt="" draggable="false" />
            <span class="btv-char-dot" aria-hidden="true"></span>
            ${busy ? `<div class="btv-char-busy"><div class="btv-spinner"></div><span class="btv-noselect">Queue</span></div>` : ''}
            <div class="btv-char-overlay btv-noselect">
              <div class="btv-char-overlay-top">
                <button type="button" class="btv-char-icon-btn" data-act="upload" title="Upload" ${busy ? 'disabled' : ''}>${ICON_UPLOAD}</button>
                <button type="button" class="btv-char-icon-btn" data-act="aigen" title="AI Gen" ${busy ? 'disabled' : ''}>${ICON_SPARKLE}</button>
              </div>
              <div class="btv-char-overlay-bottom">
                <button type="button" class="btv-char-clear-btn" data-act="clear" title="Remove" ${busy ? 'disabled' : ''}>${ICON_X}</button>
              </div>
            </div>
          </div>
          <input class="btv-char-name" type="text" placeholder="CHAR NAME" value="${escapeHtml(c.name)}" ${busy ? 'disabled' : ''} />
        `;
      } else {
        card.innerHTML = `
          <div class="btv-char-split btv-noselect">
            <button type="button" class="btv-char-half" data-act="upload" ${busy ? 'disabled' : ''}>
              ${ICON_UPLOAD}
              <span>UPLOAD</span>
            </button>
            <button type="button" class="btv-char-half" data-act="aigen" ${busy ? 'disabled' : ''}>
              ${ICON_SPARKLE}
              <span>AI GEN</span>
            </button>
          </div>
          ${busy ? `<div class="btv-char-busy"><div class="btv-spinner"></div><span class="btv-noselect">Queue</span></div>` : ''}
          <input class="btv-char-name" type="text" placeholder="CHAR NAME" value="${escapeHtml(c.name)}" ${busy ? 'disabled' : ''} />
        `;
      }

      const nameInput = card.querySelector('.btv-char-name');
      nameInput.addEventListener('input', () => {
        c.name = nameInput.value.trim();
        saveState();
      });
      card.querySelectorAll('[data-act="upload"]').forEach((btn) => {
        btn.addEventListener('click', () => openCharacterUploadPicker(c));
      });
      card.querySelectorAll('[data-act="aigen"]').forEach((btn) => {
        btn.addEventListener('click', () => openAiGenCharacterModal(c));
      });
      const clearBtn = card.querySelector('[data-act="clear"]');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          clearCharacterMedia(c);
          renderCharacters();
          saveState();
        });
      }
      charGrid.appendChild(card);

      if (filled) {
        const thumb = card.querySelector('.btv-char-thumb');
        if (thumb) {
          thumb.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            // Touch: toggle controls; mouse users rely on hover
            if (window.matchMedia && window.matchMedia('(hover: none)').matches) {
              card.classList.toggle('is-controls-open');
            }
          });
        }
      }
    });

    // close open touch overlays when clicking another card
    if (!charGrid.dataset.bvsOverlayBound) {
      charGrid.dataset.bvsOverlayBound = '1';
      charGrid.addEventListener('click', (e) => {
        if (!window.matchMedia || !window.matchMedia('(hover: none)').matches) return;
        const open = charGrid.querySelectorAll('.btv-char-card.is-controls-open');
        open.forEach((el) => {
          if (!el.contains(e.target)) el.classList.remove('is-controls-open');
        });
      });
    }

    if (btv.characters.length < MAX_CHARS) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'btv-char-add btv-noselect';
      add.innerHTML = '<span class="btv-char-add-plus">+</span><span>ADD NEW</span>';
      add.addEventListener('click', () => {
        btv.characters.push({
          id: uuid(),
          name: '',
          imageUrl: '',
          mediaId: null,
          stagedId: null,
          entityId: null,
          status: 'idle',
          lastPrompt: '',
        });
        renderCharacters();
        saveState();
      });
      charGrid.appendChild(add);
    }
  }

  function defaultCharPrompt(name) {
    const n = String(name || '').trim() || 'Character';
    return `Portrait of ${n}, full body standing character design, isolated on a plain white background, clean studio lighting, detailed face, consistent character look`;
  }

  function openStudioAssetPicker(onPick, title) {
    if (typeof window.openRefPickerModal !== 'function') {
      toast('Asset picker unavailable — reload Studio', 'error');
      return;
    }
    window.openRefPickerModal((item) => {
      if (item) onPick(item);
    }, title || 'Select an asset');
  }

  function applyPickerItemToCharacter(c, item) {
    if (!c || !item) return;
    c.imageUrl = item.url || c.imageUrl;
    c.mediaId =
      extractFlowMediaId(item.upstreamAssetId || item.mediaId || item.id || item.url) ||
      c.mediaId;
    c.stagedId = item.staged_id || (String(item.id || '').startsWith('staged-') ? item.id : c.stagedId);
    c.entityId = item.character_id || item.entity_id || c.entityId || c.id;
    if (!c.name) {
      c.name = String(item.name || item.prompt || 'Character')
        .replace(/^Portrait of\s+/i, '')
        .slice(0, 24);
    }
    c.status = 'ready';
    c.error = '';
  }

  function openCharacterUploadPicker(c) {
    openStudioAssetPicker((item) => {
      applyPickerItemToCharacter(c, item);
      renderCharacters();
      saveState();
      toast(`Linked ${c.name || 'character'}`, 'success');
    }, 'Select a character');
  }

  function getOrCreateBvsModal() {
    let modal = document.getElementById('btv-modal-backdrop');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'btv-modal-backdrop';
      modal.className = 'btv-modal-backdrop';
      modal.innerHTML = '<div class="btv-gen-modal" id="btv-modal-card"></div>';
      document.body.appendChild(modal);
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeBvsModal();
      });
    }
    return modal;
  }

  function closeBvsModal() {
    const modal = document.getElementById('btv-modal-backdrop');
    if (modal) modal.style.display = 'none';
  }

  function openAiGenCharacterModal(c, draft) {
    const stateDraft = draft || {
      name: c.name || '',
      prompt: c.lastPrompt || '',
    };

    const modal = getOrCreateBvsModal();
    const card = modal.querySelector('#btv-modal-card');
    card.className = 'btv-gen-modal';

    card.innerHTML = `
      <div class="btv-gen-modal-head btv-noselect">
        <div class="btv-gen-modal-title">GENERATE CHARACTER</div>
        <div class="btv-gen-modal-sub">Describe the character's appearance.</div>
      </div>
      <textarea class="btv-gen-modal-textarea" id="btv-modal-prompt" rows="6" placeholder="Describe your character...">${escapeHtml(stateDraft.prompt)}</textarea>
      <div class="btv-gen-modal-actions btv-noselect">
        <button type="button" class="btv-gen-btn-cancel" id="btv-modal-cancel">Cancel</button>
        <button type="button" class="btv-gen-btn-create" id="btv-modal-gen-action">
          <span class="btv-gen-btn-label">Create Character</span>
        </button>
      </div>
    `;

    const promptEl = card.querySelector('#btv-modal-prompt');
    const syncDraft = () => {
      stateDraft.prompt = (promptEl.value || '').trim();
      stateDraft.name = c.name || stateDraft.name || '';
    };

    card.querySelector('#btv-modal-cancel').onclick = closeBvsModal;

    card.querySelector('#btv-modal-gen-action').onclick = async () => {
      syncDraft();
      const name = (c.name || stateDraft.name || '').trim() || 'Character';
      const prompt = stateDraft.prompt || defaultCharPrompt(name);
      const genBtn = card.querySelector('#btv-modal-gen-action');
      genBtn.disabled = true;
      genBtn.innerHTML =
        '<span class="btv-btn-spinner"></span><span class="btv-gen-btn-label">Create Character</span>';

      c.name = name;
      c.lastPrompt = prompt;
      c.status = 'generating';
      c.error = '';
      saveState();
      renderCharacters();
      closeBvsModal();

      try {
        const asset = await submitAndWaitVideo({
          prompt,
          aspect_ratio: '1:1',
          model: btv.model || 'VEO_3_1_LITE',
          characters: [],
        });
        c.imageUrl = asset.url;
        c.mediaId = extractFlowMediaId(asset.mediaId || asset.url) || asset.mediaId;
        c.entityId = c.entityId || c.id;
        c.status = 'ready';
        saveState();
        renderCharacters();
        await refreshCredits();
        toast(`Portrait ready for ${c.name}`, 'success');
      } catch (err) {
        c.status = 'failed';
        c.error = err && err.message ? err.message : String(err);
        saveState();
        renderCharacters();
        toast(toUserFacingGenerationError(c.error), 'error');
      }
    };

    modal.style.display = 'flex';
    promptEl.focus();
  }

  async function uploadCharacter(c, file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_BASE}/api/assets/stage`, { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.error || 'Upload failed');
    c.stagedId = data.staged_id || data.id || null;
    c.imageUrl = data.url || data.preview_url || (file ? URL.createObjectURL(file) : c.imageUrl);
    c.mediaId = extractFlowMediaId(data.media_id || data.upstreamAssetId || data.url) || c.mediaId;
    if (!c.name) c.name = (file.name || 'Character').replace(/\.[^.]+$/, '').slice(0, 24);
    c.status = 'ready';
  }

  function scenesFingerprint() {
    return btv.scenes
      .map((s) => `${s.id}|${s.status}|${s.url || ''}|${s.error || ''}|${s.queueMessage || ''}`)
      .join('||');
  }


  function isMobileToolViewport() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 900px)').matches;
  }

  function setMobileToolLayout(mode) {
    const ws = document.getElementById('btv-workspace');
    if (!ws) return;
    if (!isMobileToolViewport() || !mode) {
      ws.classList.remove('is-mobile-config', 'is-mobile-run');
      return;
    }
    ws.classList.toggle('is-mobile-run', mode === 'run');
    ws.classList.toggle('is-mobile-config', mode === 'config'); // unused visually; :not(.is-mobile-run) is default
  }

  function syncMobileToolLayout() {
    if (!isMobileToolViewport()) {
      setMobileToolLayout(null);
      return;
    }
    const preferRun = !!(btv.runActive || btv._mobilePreferRun);
    setMobileToolLayout(preferRun ? 'run' : 'config');
  }

  function updateStatus(opts = {}) {
    const skipDomHeal = !!(opts && opts.skipDomHeal);
    const { status, empty, grid, dlAllBtn, genBtn, stopBtn } = els();

    // Ghost in-flight after Stop: clear so counts/buttons match the grid.
    // Must key off userStopped too — retry/races can leave runActive true while stopped.
    if (!btv.runActive || btv.userStopped) {
      let healed = false;
      btv.scenes.forEach((s) => {
        if (
          s.status === 'generating' ||
          s.status === 'queued' ||
          false /* idle kept until Clear — Stop already cancelled pending */
        ) {
          markSceneCancelled(s);
          healed = true;
        }
      });
      if (healed) {
        btv.pipelineBusy = false;
        btv.fillingSlots = false;
        clearFillTimer();
        if (btv.userStopped) btv.runActive = false;
        saveState();
        renderScenes({ force: true });
        return;
      }
    }

    // Critical heal: JS state has scenes but the grid DOM was wiped (React remount,
    // view switch race, etc). Status alone would say "N scenes" over a blank pane.
    if (
      !skipDomHeal &&
      grid &&
      btv.scenes.length > 0 &&
      grid.childElementCount !== btv.scenes.length
    ) {
      renderScenes({ force: true });
      return;
    }

    const ready = btv.scenes.filter((s) => s.status === 'ready').length;
    const generating = btv.scenes.filter((s) => s.status === 'generating').length;
    const queued = btv.scenes.filter((s) => s.status === 'queued').length;
    const idle = btv.scenes.filter((s) => s.status === 'idle').length;
    const busy = generating > 0 || queued > 0;

    // Stuck runActive with nothing in flight → unlock Generate All (never while userStopped)
    if (btv.runActive && !btv.userStopped && !busy && idle === 0) {
      btv.runActive = false;
      saveState();
    }

    const parts = [`${btv.scenes.length} scenes identified`, `${ready} ready`];
    if (generating) parts.push(`${generating} generating`);
    if (queued) parts.push(`${queued} queue`);
    const nextText = parts.join(' • ');
    if (status && status.textContent !== nextText) {
      status.textContent = nextText;
    }
    const has = btv.scenes.length > 0;
    if (empty) empty.classList.toggle('hidden', has);
    if (grid) grid.classList.toggle('hidden', !has);
    if (dlAllBtn) dlAllBtn.disabled = ready === 0;

    // Generate: only lock while a run is actively submitting/waiting
    if (genBtn) genBtn.disabled = !!(btv.runActive && busy && !btv.userStopped);
    // Stop: only when there is something to cancel
    if (stopBtn) stopBtn.disabled = !((btv.runActive && !btv.userStopped) || busy);
    syncMobileToolLayout();
  }

  function mediaInnerHtml(scene) {
    if (scene.status === 'ready' && scene.url) {
      return `
        <div class="btv-queue-label" data-ph>Queue</div>
        <video class="btv-scene-video" muted loop playsinline preload="metadata"></video>
      `;
    }
    if (scene.status === 'failed' && isUserStopError(scene.error)) {
      return `<div class="btv-queue-label is-stopped">Stop by user</div>`;
    }
    if (scene.status === 'generating') {
      return `<div class="btv-gen-anim is-active"><div class="btv-spinner"></div><span>Generating</span><div class="btv-gen-pulse"></div></div>`;
    }
    if (scene.status === 'queued') {
      return `<div class="btv-gen-anim is-queued"><div class="btv-queue-dots" aria-hidden="true"><span></span><span></span><span></span></div><span>Queue</span></div>`;
    }
    if (scene.status === 'failed') {
      return `<div class="btv-queue-label">Queue</div>`;
    }
    return `<div class="btv-queue-label">Queue</div>`;
  }

  function bindSceneMedia(card, scene) {
    if (!(scene.status === 'ready' && scene.url)) return;
    const vid = card.querySelector('video.btv-scene-video');
    const ph = card.querySelector('[data-ph]');
    if (!vid) return;
    vid.src = scene.url;
    vid.classList.add('is-ready');
    if (ph) ph.classList.add('hidden');
    vid.addEventListener('error', () => {
      if (ph) {
        ph.classList.remove('hidden');
        ph.textContent = 'Expired';
      }
      vid.remove();
    });
  }

  function renderScenes({ force = false } = {}) {
    const { grid } = els();
    if (!grid) return;
    const fp = scenesFingerprint();
    if (!force && btv._scenesFp === fp && grid.childElementCount === btv.scenes.length) {
      updateStatus({ skipDomHeal: true });
      return;
    }
    btv._scenesFp = fp;
    grid.innerHTML = '';
    btv.scenes.forEach((scene) => {
      const isGenerating = scene.status === 'generating';
      const isQueued = scene.status === 'queued';
      const busy = isGenerating || isQueued;
      const card = document.createElement('article');
      card.className = `btv-scene-card${isGenerating ? ' is-generating' : ''}${isQueued ? ' is-queued' : ''}`;
      card.dataset.sceneId = scene.id;

      let statusClass = '';
      let statusText = 'Queue';
      if (scene.status === 'ready') {
        statusClass = 'is-ready';
        statusText = 'Ready';
      } else if (scene.status === 'failed' && isUserStopError(scene.error)) {
        statusClass = 'is-stopped';
        statusText = 'Stop by user';
      } else if (scene.status === 'failed') {
        statusClass = 'is-failed';
        statusText = toUserFacingGenerationError(scene.error || 'Failed');
      } else if (isGenerating) {
        statusClass = 'is-generating';
        statusText = 'Generating…';
      } else if (isQueued) {
        statusClass = 'is-queue';
        statusText = 'Queue';
      } else {
        statusClass = '';
        statusText = 'Queue';
      }

      card.innerHTML = `
        <div class="btv-scene-media">${mediaInnerHtml(scene)}</div>
        <div class="btv-scene-body">
          <div class="btv-scene-title">${escapeHtml(scene.title)}</div>
          <div class="btv-scene-prompt">${escapeHtml(scene.prompt || '(empty scene)')}</div>
          <div class="btv-scene-status ${statusClass}">${escapeHtml(statusText)}</div>
          <div class="btv-scene-actions">
            <button type="button" data-act="dl" ${scene.url ? '' : 'disabled'}>Download</button>
            ${
              scene.status === 'failed' || scene.status === 'ready'
                ? `<button type="button" data-act="retry" ${busy ? 'disabled' : ''}>Retry</button>`
                : ''
            }
          </div>
        </div>
      `;
      bindSceneMedia(card, scene);
      const dl = card.querySelector('[data-act="dl"]');
      if (dl) {
        dl.addEventListener('click', () => {
          if (!scene.url) return;
          const a = document.createElement('a');
          a.href = scene.url;
          a.download = `${scene.title.replace(/\s+/g, '_').toLowerCase()}.mp4`;
          a.target = '_blank';
          a.rel = 'noopener';
          document.body.appendChild(a);
          a.click();
          a.remove();
        });
      }
      const retry = card.querySelector('[data-act="retry"]');
      if (retry) {
        retry.addEventListener('click', () => retryScene(scene));
      }
      grid.appendChild(card);
    });
    updateStatus({ skipDomHeal: true });
  }

  async function retryScene(scene) {
    if (!scene) return;
    const index = btv.scenes.findIndex((s) => s.id === scene.id);
    if (index < 0) return;
    scene.status = 'idle';
    scene.error = '';
    scene.jobId = null;
    scene.runId = null;
    scene.url = '';
    scene.mediaId = null;
    scene.queueMessage = '';
    scene.submitPrompt = '';
    // Retry must clear the Stop lock or submitSceneAt no-ops / Stop flickers forever
    btv.userStopped = false;
    btv._mobilePreferRun = true;
    btv.runActive = true;
    setMobileToolLayout('run');
    bumpRunEpoch();
    saveState();
    renderScenes();
    toast('Retrying scene…', 'info');
    startBackgroundWorker();
    await submitSceneAt(index);
  }

  function normalizeSceneTitle(scene, fallbackIndex) {
    const n = Number(scene && scene.index) || fallbackIndex || 1;
    return `Scene ${n} :`;
  }

  function syncScenesFromScript({ force = false } = {}) {
    if (btv.runActive && !force) return;
    const { script } = els();
    const text = script ? script.value : btv.scriptText;
    const parsed = parseBulkT2VScript(text);
    btv.scenes = parsed.map((p, i) => {
      const prev = btv.scenes.find(
        (s) => (s.title === p.title && s.prompt === p.prompt) || (s.jobId && s.prompt === p.prompt)
      );
      if (prev) {
        return {
          ...prev,
          id: prev.id || p.id,
          index: p.index,
          title: normalizeSceneTitle(p, i + 1),
          prompt: p.prompt,
        };
      }
      return { ...p, title: normalizeSceneTitle(p, i + 1) };
    });
    renderScenes();
    saveState();
  }

  async function fetchAssetsList() {
    const res = await fetch(`${API_BASE}/api/assets`, { credentials: 'include' });
    if (res.status === 401 || res.status === 403) return null; // logged out — jobs still run server-side
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    return data.assets || data.items || [];
  }

  /**
   * Match gallery/job rows to a scene by jobId / runId only.
   * Never match by prompt — reused scripts would steal older COMPLETED assets
   * (instant old image + real new job still running = "glitch").
   */
  function findAssetForScene(list, scene) {
    if (!list || !list.length || !scene) return null;

    if (scene.jobId) {
      const jid = String(scene.jobId);
      const byId = list.find(
        (a) =>
          a &&
          (a.id === jid ||
            a.jobId === jid ||
            a.assetId === jid ||
            a.upstreamAssetId === jid)
      );
      if (byId) return byId;
    }

    if (scene.runId) {
      const rid = String(scene.runId);
      const byRun = list.find(
        (a) => a && (a.runId === rid || a.run_id === rid)
      );
      if (byRun) return byRun;
    }

    return null;
  }

  function applyCompletedAssetToScene(scene, asset) {
    scene.status = 'ready';
    scene.url = asset.url;
    scene.mediaId = extractFlowMediaId(asset.upstreamAssetId || asset.mediaId || asset.url);
    scene.queueMessage = '';
    scene.error = '';
    if (asset.id && !scene.jobId) scene.jobId = asset.id;
  }

  async function submitVideoJob({ prompt, aspect_ratio, duration, model, run_id, enqueue_only }) {
    const runId = run_id || uuid();
    const body = {
      prompt,
      aspect_ratio: aspect_ratio || '16:9',
      duration: duration || btv.duration || 8,
      model: model || 'VEO_3_1_LITE',
      run_id: runId,
      source: 'bulkt2v',
    };
    if (enqueue_only) body.enqueue_only = true;

    const res = await fetch(`${API_BASE}/api/generate/video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 402) throw new Error(data.detail || data.error || 'Insufficient credits');
    if (!res.ok) {
      const err = new Error(data.detail || data.error || `Generation failed (${res.status})`);
      err.jobId = data.jobId || (data.asset && data.asset.id) || null;
      err.runId = runId;
      throw err;
    }

    const asset = data.asset || (data.assets && data.assets[0]) || null;
    if (!asset) throw new Error('No asset returned');

    if (asset.status === 'COMPLETED' && asset.url) {
      return {
        jobId: asset.id || asset.assetId,
        status: 'ready',
        url: asset.url,
        mediaId: extractFlowMediaId(asset.upstreamAssetId || asset.url),
        queueMessage: '',
        runId,
      };
    }

    return {
      jobId: asset.id,
      status: asset.inQueue || asset.status === 'IN_QUEUE' ? 'queued' : 'generating',
      url: asset.url || '',
      mediaId: null,
      queueMessage: asset.queueMessage || '',
      runId,
    };
  }

  async function submitAndWaitVideo(opts) {
    const started = await submitVideoJob(opts);
    if (started.status === 'ready') return started;
    const done = await pollJobUntilDone(started.jobId, opts.prompt);
    return done;
  }

  async function pollJobUntilDone(jobId, promptHint) {
    const started = Date.now();
    const fakeScene = { jobId, prompt: promptHint || '', submitPrompt: promptHint || '', id: '__poll__' };
    while (Date.now() - started < 8 * 60 * 1000) {
      await new Promise((r) => setTimeout(r, 2500));
      const list = await fetchAssetsList();
      if (!list) continue;
      const asset = findAssetForScene(list, fakeScene);
      if (!asset) continue;
      if (asset.status === 'COMPLETED' && asset.url) {
        return {
          jobId: asset.id,
          status: 'ready',
          url: asset.url,
          mediaId: extractFlowMediaId(asset.upstreamAssetId || asset.url),
        };
      }
      if (asset.status === 'FAILED') {
        throw new Error(asset.error || asset.errorMessage || asset.queueMessage || 'Generation failed');
      }
    }
    throw new Error('Timed out waiting for queued generation');
  }

  async function refreshCredits() {
    try {
      if (typeof window.updateHeaderCredits === 'function') await window.updateHeaderCredits();
      else if (typeof window.fetchAuthStatus === 'function') await window.fetchAuthStatus();
    } catch (_) {}
  }

  function prevReadyMediaIds(beforeIndex, limit = 2) {
    const ids = [];
    for (let i = beforeIndex - 1; i >= 0 && ids.length < limit; i--) {
      const s = btv.scenes[i];
      if (s && s.status === 'ready' && (s.mediaId || s.url)) {
        const id = s.mediaId || extractFlowMediaId(s.url);
        if (id) ids.push(id);
      }
    }
    return ids.reverse(); // chronological: older → newer (last frames in order)
  }

  function prevReadyMediaId(beforeIndex) {
    const ids = prevReadyMediaIds(beforeIndex, 1);
    return ids[0] || null;
  }

  async function cancelJobApi(jobId) {
    if (!jobId) return { ok: false };
    try {
      const res = await fetch(`${API_BASE}/api/generations/${encodeURIComponent(jobId)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok && data && data.success !== false, data };
    } catch (_) {
      return { ok: false };
    }
  }

  /** Cancel only Bulk T2V jobs (not Studio / other All Media requests). */
  async function cancelBulkT2VPendingJobs(extraIds = [], extraRunIds = []) {
    const jobIds = new Set((extraIds || []).filter(Boolean).map(String));
    const runIds = new Set((extraRunIds || []).filter(Boolean).map(String));
    (btv.sessionJobIds || []).forEach((id) => jobIds.add(String(id)));
    btv.scenes.forEach((s) => {
      if (s.jobId) jobIds.add(String(s.jobId));
      if (s.runId) runIds.add(String(s.runId));
    });

    try {
      const res = await fetch(`${API_BASE}/api/generations/cancel-pending`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          source: 'bulkt2v',
          jobIds: [...jobIds],
          runIds: [...runIds],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return 0;
      return Number(data.cancelled) || 0;
    } catch (_) {
      // Fallback: cancel known ids only (never scan whole gallery).
      if (!jobIds.size) return 0;
      const results = await Promise.all([...jobIds].map((id) => cancelJobApi(id)));
      return results.filter((r) => r.ok).length;
    }
  }

  async function refreshStudioGallery() {
    try {
      if (typeof window.loadAssets === 'function') await window.loadAssets({ silent: true });
    } catch (_) {}
  }

  function trackSessionJob(jobId) {
    if (!jobId) return;
    if (!Array.isArray(btv.sessionJobIds)) btv.sessionJobIds = [];
    if (!btv.sessionJobIds.includes(jobId)) btv.sessionJobIds.push(jobId);
  }

  function markSceneCancelled(scene) {
    if (!scene) return;
    scene.status = 'failed';
    scene.error = 'Stop by user';
    scene.jobId = null;
    scene.runId = null;
    scene.url = '';
    scene.mediaId = null;
    scene.queueMessage = '';
  }

  async function submitSceneAt(index) {
    const scene = btv.scenes[index];
    if (!scene || !scene.prompt) {
      if (scene) {
        scene.status = 'failed';
        scene.error = 'Empty scene prompt';
      }
      return;
    }
    if (!btv.runActive || btv.userStopped) return;
    if (scene.jobId && (scene.status === 'queued' || scene.status === 'generating' || scene.status === 'ready')) {
      return;
    }
    if (isUserStopError(scene.error) && scene.status === 'failed') return;

    const epoch = btv.runEpoch;
    if (!isRunCurrent(epoch)) return;

    const matched = [];
    const superPrompt = buildSuperPrompt(btv.globalPrompt, scene.prompt, matched);

    if (!isRunCurrent(epoch)) return;

    scene.status = 'generating';
    scene.error = '';
    scene.submitPrompt = superPrompt;
    scene.runId = scene.runId || uuid();
    renderScenes();
    saveState();
    updateStatus({ skipDomHeal: true });

    // Re-check after paint — Stop may have landed between assign and fetch
    if (!isRunCurrent(epoch)) {
      markSceneCancelled(scene);
      saveState();
      renderScenes({ force: true });
      return;
    }

    try {
      const result = await submitVideoJob({
        prompt: superPrompt,
        aspect_ratio: btv.aspect || '16:9',
        duration: btv.duration || 8,
        model: btv.model || 'VEO_3_1_LITE',
        run_id: scene.runId,
      });

      // Stop pressed while this request was in flight — abandon + cancel server job.
      if (btv.userStopped || !isRunCurrent(epoch) || isUserStopError(scene.error)) {
        if (result.jobId) await cancelJobApi(result.jobId);
        markSceneCancelled(scene);
        saveState();
        renderScenes({ force: true });
        return;
      }

      scene.jobId = result.jobId;
      scene.runId = result.runId || scene.runId;
      trackSessionJob(result.jobId);
      scene.status = result.status === 'ready' ? 'ready' : result.status;
      scene.url = result.url || '';
      scene.mediaId = result.mediaId || null;
      scene.queueMessage = result.queueMessage || '';
      scene.error = '';
      saveState();
      renderScenes();
      await refreshCredits();
      if (isRunCurrent(epoch)) scheduleFillSlots();
    } catch (err) {
      if (btv.userStopped || !isRunCurrent(epoch) || isUserStopError(scene.error)) {
        if (err && err.jobId) await cancelJobApi(err.jobId);
        markSceneCancelled(scene);
        saveState();
        renderScenes({ force: true });
        return;
      }

      const msg = err && err.message ? err.message : String(err);
      if (/Insufficient|402/i.test(msg)) {
        scene.status = 'failed';
        scene.error = msg;
        btv.runActive = false;
        for (let j = index + 1; j < btv.scenes.length; j++) {
          if (btv.scenes[j].status === 'idle') {
            btv.scenes[j].status = 'failed';
            btv.scenes[j].error = 'Cancelled — insufficient credits';
          }
        }
        toast('System Error', 'error');
        saveState();
        renderScenes();
        return;
      }

      // Client timeout / network blip: server job often still completes (your Scene 1 case).
      if (btv.userStopped || !isRunCurrent(epoch)) {
        if (err && err.jobId) await cancelJobApi(err.jobId);
        markSceneCancelled(scene);
        saveState();
        renderScenes({ force: true });
        return;
      }
      if (err && err.jobId) {
        scene.jobId = err.jobId;
        trackSessionJob(err.jobId);
      }
      if (err && err.runId) scene.runId = err.runId;
      scene.status = 'queued';
      scene.error = '';
      scene.queueMessage = 'Waiting for server result…';
      saveState();
      renderScenes();
      if (isRunCurrent(epoch)) scheduleFillSlots();
      toast('Still finishing on server — will update when ready', 'info');
    }
  }

  async function reconcileJobsFromServer() {
    // After Stop, never revive cards into generating/queued from server status
    if (!btv.runActive || btv.userStopped) return;

    const pending = btv.scenes.filter(
      (s) =>
        s.status !== 'ready' &&
        !s.url &&
        s.error !== 'Cancelled' &&
        !isUserStopError(s.error) &&
        (s.status === 'queued' ||
          s.status === 'generating' ||
          s.status === 'failed' ||
          !!s.jobId)
    );
    if (!pending.length) return;
    const list = await fetchAssetsList();
    if (!list) return;
    if (!btv.runActive || btv.userStopped) return;

    let changed = false;
    for (const scene of pending) {
      if (!btv.runActive || btv.userStopped) break;
      if (isUserStopError(scene.error)) continue;
      if (scene.status === 'ready' && scene.url) continue;
      const asset = findAssetForScene(list, scene);
      if (!asset) continue;
      if (asset.status === 'COMPLETED' && asset.url) {
        const before = `${scene.status}|${scene.url || ''}`;
        applyCompletedAssetToScene(scene, asset);
        if (`${scene.status}|${scene.url || ''}` !== before) changed = true;
      } else if (asset.status === 'FAILED' && scene.jobId && asset.id === scene.jobId) {
        const err = asset.error || asset.errorMessage || 'Generation failed';
        if (scene.status !== 'failed' || scene.error !== err) {
          scene.status = 'failed';
          scene.error = err;
          changed = true;
        }
      } else if (asset.status === 'IN_QUEUE') {
        const msg = asset.queueMessage || '';
        if (scene.status !== 'queued' || scene.queueMessage !== msg) {
          scene.status = 'queued';
          scene.queueMessage = msg;
          changed = true;
        }
      } else if (asset.status === 'PROCESSING' || asset.status === 'GENERATING') {
        if (scene.status !== 'generating') {
          scene.status = 'generating';
          changed = true;
        }
      }
    }
    if (changed && btv.runActive && !btv.userStopped) {
      saveState();
      renderScenes({ force: true });
      await refreshCredits();
    }
  }

  async function advancePipeline() {
    if (!btv.runActive || btv.userStopped) return;

    const allDone = btv.scenes.every(
      (s) => s.status === 'ready' || s.status === 'failed' || !s.prompt
    );
    if (allDone && btv.scenes.length) {
      btv.runActive = false;
      saveState();
      updateStatus();
      return;
    }

    if (btv.chain) {
      if (btv.pipelineBusy) return;
      btv.pipelineBusy = true;
      try {
        if (!btv.runActive || btv.userStopped) return;
        const inFlight = btv.scenes.some((s) => s.status === 'queued' || s.status === 'generating');
        if (inFlight) return;
        const nextIdx = btv.scenes.findIndex((s) => s.status === 'idle');
        if (nextIdx >= 0) {
          await submitSceneAt(nextIdx);
          if (btv.runActive && !btv.userStopped) scheduleFillSlots();
        }
      } finally {
        btv.pipelineBusy = false;
      }
      return;
    }

    // Non-chain: keep up to MAX_PARALLEL hot; refill as soon as a slot frees.
    await fillParallelSlots();
  }

  function scheduleFillSlots() {
    if (!btv.runActive || btv.userStopped) return;
    if (btv._fillTimer) return;
    btv._fillTimer = setTimeout(() => {
      btv._fillTimer = null;
      if (btv.runActive && !btv.userStopped) fillParallelSlots().catch(() => {});
    }, 40);
  }

  async function fillParallelSlots() {
    if (!btv.runActive || btv.userStopped || btv.chain) return;
    if (btv.fillingSlots) return;
    btv.fillingSlots = true;
    try {
      while (btv.runActive && !btv.userStopped) {
        const inFlight = btv.scenes.filter(
          (s) => s.status === 'queued' || s.status === 'generating'
        ).length;
        const slots = Math.max(0, getMaxParallel() - inFlight);
        if (!slots) break;
        const nextIdx = btv.scenes.findIndex((s) => s.status === 'idle');
        if (nextIdx < 0) break;

        // Fire without awaiting full HTTP — when one finishes, scheduleFillSlots starts the next.
        const idx = nextIdx;
        submitSceneAt(idx)
          .catch(() => {})
          .finally(() => {
            if (btv.userStopped) {
              markSceneCancelled(btv.scenes[idx]);
              updateStatus({ skipDomHeal: true });
              return;
            }
            if (btv.runActive && !btv.userStopped) scheduleFillSlots();
            updateStatus();
          });

        // Let status flip to generating before counting the next free slot
        await new Promise((r) => setTimeout(r, 60));
      }
    } finally {
      btv.fillingSlots = false;
      updateStatus();
    }
  }

  /** When the tab closes/hides, enqueue remaining idle scenes so the server keeps going. */
  async function enqueueRemainingForBackground() {
    if (!btv.runActive || btv.userStopped || btv.chain) return;
    const idle = btv.scenes
      .map((s, i) => (s.status === 'idle' ? i : -1))
      .filter((i) => i >= 0);
    if (!idle.length) return;

    for (const index of idle) {
      if (!btv.runActive) break;
      const scene = btv.scenes[index];
      if (!scene || scene.jobId) continue;
      const matched = [];
      const superPrompt = buildSuperPrompt(btv.globalPrompt, scene.prompt, matched);
      scene.runId = scene.runId || uuid();
      scene.submitPrompt = superPrompt;
      try {
        const result = await submitVideoJob({
          prompt: superPrompt,
          aspect_ratio: btv.aspect || '16:9',
          duration: btv.duration || 8,
          model: btv.model || 'VEO_3_1_LITE',
          run_id: scene.runId,
          enqueue_only: true,
        });
        scene.jobId = result.jobId;
        scene.runId = result.runId || scene.runId;
        trackSessionJob(result.jobId);
        scene.status = 'queued';
        scene.queueMessage = result.queueMessage || 'In Queue: Bulk T2V background';
        scene.error = '';
      } catch (err) {
        scene.status = 'failed';
        scene.error = err && err.message ? err.message : String(err);
      }
    }
    saveState();
    renderScenes({ force: true });
    updateStatus();
  }

  function hasPendingWork() {
    if (btv.userStopped && !btv.runActive) return false;
    return (
      btv.runActive ||
      btv.scenes.some(
        (s) =>
          s.status === 'queued' ||
          s.status === 'generating' ||
          s.status === 'idle' ||
          (s.status === 'failed' && !s.url && !isUserStopError(s.error))
      )
    );
  }

  async function backgroundTick() {
    try {
      if (btv.userStopped && !btv.runActive) {
        updateStatus();
        return;
      }
      if (!hasPendingWork()) {
        updateStatus();
        return;
      }
      await reconcileJobsFromServer();
      await advancePipeline();
      updateStatus();
    } catch (e) {
      console.warn('[BulkT2V] background tick', e);
    }
  }

  function startBackgroundWorker() {
    if (btv.pollTimer) clearInterval(btv.pollTimer);
    // Faster tick while running so free slots + ready cards update quickly
    btv.pollTimer = setInterval(backgroundTick, btv.runActive ? 1500 : 3000);
    backgroundTick();
  }

  async function generateAll() {
    readFormIntoState();
    syncScenesFromScript({ force: true });
    if (!btv.scenes.length) {
      toast('Add Scene / Prompt headers to your script first', 'warning');
      return;
    }

    // Wipe leftover BulkT2V queue only (leave Studio / other tools alone).
    armUserStop(); // kill any prior run races first
    const cleared = await cancelBulkT2VPendingJobs(
      btv.scenes.map((s) => s.jobId).filter(Boolean)
    );
    if (cleared) toast(`Cleared ${cleared} leftover Bulk T2V job(s)`, 'info');
    btv.sessionJobIds = [];

    // Always start fresh jobs — do not keep prior ready URLs when reusing the same script.
    btv.scenes.forEach((s) => {
      s.status = 'idle';
      s.error = '';
      s.jobId = null;
      s.runId = null;
      s.url = '';
      s.mediaId = null;
      s.queueMessage = '';
      s.submitPrompt = '';
    });

    btv.userStopped = false;
    btv.runActive = true;
    bumpRunEpoch();
    saveState();
    renderScenes({ force: true });
    toast('Bulk T2V started — parallel slots; Stop cancels this tool only', 'info');
    await advancePipeline();
    startBackgroundWorker();
  }

  async function fetchSceneBlob(scene) {
    const direct = await fetch(scene.url, { mode: 'cors' }).catch(() => null);
    if (direct && direct.ok) return direct.blob();

    const proxied = await fetch(
      `${API_BASE}/api/assets/proxy?url=${encodeURIComponent(scene.url)}`,
      { credentials: 'include' }
    );
    if (!proxied.ok) {
      const err = await proxied.json().catch(() => ({}));
      throw new Error(err.error || `Failed to fetch ${scene.title || 'image'}`);
    }
    return proxied.blob();
  }

  function extFromBlob(blob) {
    const t = String(blob.type || '').toLowerCase();
    if (t.includes('mp4') || t.includes('video')) return 'mp4';
    if (t.includes('webm')) return 'webm';
    if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
    if (t.includes('webp')) return 'webp';
    return 'mp4';
  }

  async function downloadAll() {
    const ready = btv.scenes.filter((s) => s.url);
    if (!ready.length) return;
    const { dlAllBtn } = els();
    if (dlAllBtn) dlAllBtn.disabled = true;
    try {
      if (!window.JSZip) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      const zip = new window.JSZip();
      let added = 0;
      for (let i = 0; i < ready.length; i++) {
        const scene = ready[i];
        const blob = await fetchSceneBlob(scene);
        const ext = extFromBlob(blob);
        const safeTitle = String(scene.title || `scene_${i + 1}`)
          .replace(/[^\w\-]+/g, '_')
          .replace(/_+/g, '_');
        zip.file(`${String(i + 1).padStart(2, '0')}_${safeTitle}.${ext}`, blob);
        added += 1;
      }
      if (!added) throw new Error('No images could be added to ZIP');

      const out = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const zipBlob = new Blob([out], { type: 'application/zip' });
      const a = document.createElement('a');
      const href = URL.createObjectURL(zipBlob);
      a.href = href;
      a.download = 'bulkt2v-scenes.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 2000);
      toast(`Downloaded 1 ZIP with ${added} videos`, 'success');
    } catch (err) {
      console.warn(err);
      toast(toUserFacingGenerationError(err.message || err) || 'ZIP download failed', 'error');
    } finally {
      if (dlAllBtn) dlAllBtn.disabled = ready.length === 0;
      updateStatus();
    }
  }

  async function stopGeneration() {
    const pending = btv.scenes.filter(
      (s) => s.status === 'idle' || s.status === 'queued' || s.status === 'generating'
    );

    // Snapshot ids BEFORE markSceneCancelled clears them
    const snapJobIds = btv.scenes.map((s) => s.jobId).filter(Boolean);
    const snapRunIds = btv.scenes.map((s) => s.runId).filter(Boolean);
    (btv.sessionJobIds || []).forEach((id) => snapJobIds.push(id));

    armUserStop();

    pending.forEach((s) => markSceneCancelled(s));
    // Also clear any ghost generating/queued left by in-flight races
    btv.scenes.forEach((s) => {
      if (s.status === 'generating' || s.status === 'queued' || s.status === 'idle') {
        markSceneCancelled(s);
      }
    });

    saveState();
    renderScenes({ force: true });
    updateStatus({ skipDomHeal: true });
    toast('Stopping Bulk T2V generations…', 'info');

    // Only BulkT2V-tagged / this-run jobs — never cancel Studio or other tools.
    const refunded = await cancelBulkT2VPendingJobs(snapJobIds, snapRunIds);
    btv.sessionJobIds = [];
    // Keep stop lock armed until the user clicks Generate All again
    armUserStop();
    btv.scenes.forEach((s) => {
      if (s.status === 'generating' || s.status === 'queued' || s.status === 'idle') {
        markSceneCancelled(s);
      }
    });
    saveState();
    renderScenes({ force: true });
    updateStatus({ skipDomHeal: true });
    await refreshCredits();
    await refreshStudioGallery();
    toast(
      refunded
        ? `Stopped — ${pending.length} scene(s) Stop by user, ${refunded} Bulk T2V job(s) cancelled`
        : pending.length
          ? `Stopped — ${pending.length} scene(s) Stop by user`
          : 'No pending Bulk T2V jobs to cancel',
      refunded ? 'success' : 'info'
    );
  }

  async function clearAll(opts) {
    const silent = !!(opts && opts.silent);
    armUserStop();
    btv._mobilePreferRun = false;
    setMobileToolLayout('config');
    const n = await cancelBulkT2VPendingJobs(btv.scenes.map((s) => s.jobId).filter(Boolean));
    btv.sessionJobIds = [];
    btv.scenes = [];
    btv.scriptText = '';
    btv.globalPrompt = '';
    clearPersistedState();
    writeFormFromState();
    renderScenes({ force: true });
    updateStatus({ skipDomHeal: true });
    if (n) await refreshCredits();
    if (!silent) {
      await refreshStudioGallery();
      toast(n ? `Grid cleared — ${n} Bulk T2V job(s) cancelled` : 'Bulk T2V grid cleared', 'info');
    }
  }

  function bindUi() {
    if (btv.bound) return;
    const { script, genBtn, clearBtn, stopBtn, dlAllBtn, model, aspect, duration } = els();
    if (!script || !genBtn) return;
    btv.bound = true;

    

    let t = null;
    script.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        btv.scriptText = script.value;
        syncScenesFromScript();
      }, 250);
    });
    [model, aspect, duration].forEach((el) => {
      if (!el) return;
      el.addEventListener('change', () => {
        readFormIntoState();
        if (el === model) updateDurationOptionsForModel(btv.model);
        saveState();
      });
    });

    const editBtn = document.getElementById('btv-mobile-edit-btn');
    if (editBtn && editBtn.dataset.bound !== '1') {
      editBtn.dataset.bound = '1';
      editBtn.addEventListener('click', () => {
        btv._mobilePreferRun = false;
        setMobileToolLayout('config');
      });
    }
    if (!window.__GFLOW_BTV_MOBILE_RESIZE__) {
      window.__GFLOW_BTV_MOBILE_RESIZE__ = true;
      window.addEventListener('resize', () => syncMobileToolLayout());
    }
    genBtn.addEventListener('click', () => generateAll());
    if (stopBtn) stopBtn.addEventListener('click', () => stopGeneration());
    if (clearBtn) clearBtn.addEventListener('click', () => clearAll());
    if (dlAllBtn) dlAllBtn.addEventListener('click', () => downloadAll());

    window.addEventListener('beforeunload', () => {
      saveState();
      // Best-effort: kick remaining idle scenes onto the server queue (non-chain).
      if (btv.runActive && !btv.userStopped && !btv.chain) {
        try {
          enqueueRemainingForBackground();
        } catch (_) {}
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && btv.runActive && !btv.userStopped && !btv.chain) {
        enqueueRemainingForBackground().catch(() => {});
      }
      if (document.visibilityState === 'visible') backgroundTick();
    });
    window.addEventListener('pagehide', () => {
      if (btv.runActive && !btv.userStopped && !btv.chain) {
        enqueueRemainingForBackground().catch(() => {});
      }
    });
  }

  function initBulkT2V() {
    const restored = loadState();
    bindUi();
    writeFormFromState();
    btv._formHydrated = true;
    renderCharacters();
    if (restored) {
      renderScenes({ force: true });
      // Only resume if still a live run (Stop clears this)
      if (btv.runActive && !btv.userStopped) {
        toast('Resuming Bulk T2V queue…', 'info');
      } else {
        btv.runActive = false;
      }
    } else if (!btv.scenes.length) {
      syncScenesFromScript({ force: true });
    } else {
      renderScenes({ force: true });
    }
    updateStatus();
    btv._mobilePreferRun = !!(btv.runActive && !btv.userStopped);
    syncMobileToolLayout();
    startBackgroundWorker();
  }

  window.initBulkT2V = initBulkT2V;
  window.wipeBulkT2VState = clearAll;
  window.__gflowBulkT2VOnModelLock = applyBulkT2VModelLockSync;
  window.parseBulkT2VScript = parseBulkT2VScript;
  window.__GFLOW_BULKT2V_INIT__ = true;

  // Start background poller even before opening the pane (after scripts load)
  try {
    if (loadState() && btv.runActive && !btv.userStopped) {
      startBackgroundWorker();
    }
  } catch (_) {}
})();
