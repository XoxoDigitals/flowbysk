/**
 * Bulk Visual Storyteller — Next /api/generate/* (credits + queue).
 * Persists to localStorage; resumes after refresh; server jobs keep running after logout.
 */
(function () {
  'use strict';

  if (typeof window !== 'undefined' && window.__GFLOW_STORYTELLER_INIT__) {
    return;
  }

  const API_BASE = '';
  const MAX_CHARS = 6;
  const STORAGE_KEY = 'gflow_bvs_state_v1';
  const STATE_TTL_MS = 24 * 60 * 60 * 1000;

  const bvs = {
    characters: [],
    scenes: [],
    running: false,
    chain: true,
    bound: false,
    runActive: false,
    runEpoch: 0,
    /** Set on Stop; cleared only by Generate All — blocks revive/resume races. */
    userStopped: false,
    pipelineBusy: false,
    fillingSlots: false,
    sessionJobIds: [],
    model: 'GEM_PIX_2',
    aspect: '16:9',
    globalPrompt: '',
    scriptText: '',
    pollTimer: null,
    _fillTimer: null,
  };

  /** Match Studio plan parallel slots (Pro default). Do not POST every idle scene at once. */
  const MAX_PARALLEL = 5;

  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
    else console.log('[Storyteller]', type || 'info', msg);
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
    if (/RECAPTCHA|UNUSUAL_ACTIVITY|Bearer rejected|MODEL_ACCESS_DENIED|QUOTA|WORKER RETURNED|INTERNAL SERVER|TIMEOUT|CDP|COOKIE|Insufficient/i.test(text)) {
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
    return !!bvs.runActive && !bvs.userStopped && Number(epoch) === Number(bvs.runEpoch);
  }

  function bumpRunEpoch() {
    bvs.runEpoch = (bvs.runEpoch || 0) + 1;
    return bvs.runEpoch;
  }

  function clearFillTimer() {
    if (bvs._fillTimer) {
      clearTimeout(bvs._fillTimer);
      bvs._fillTimer = null;
    }
  }

  /** Hard stop flags — call before cancelling scenes. */
  function armUserStop() {
    bvs.userStopped = true;
    bvs.runActive = false;
    bumpRunEpoch();
    bvs.pipelineBusy = false;
    bvs.fillingSlots = false;
    clearFillTimer();
  }

  async function withSystemErrorRetry(fn, label) {
    if (typeof window.withSystemErrorRetry === 'function') {
      return window.withSystemErrorRetry(fn, label);
    }
    try {
      return await fn();
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      if (toUserFacingGenerationError(msg) !== 'System Error') throw err;
      console.warn(`[Storyteller] system-retry ${label || ''}:`, msg);
      await new Promise((r) => setTimeout(r, 1600));
      return await fn();
    }
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
    return `bvs-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function extractFlowMediaId(urlOrId) {
    if (!urlOrId) return null;
    const s = String(urlOrId);
    const m = s.match(/flow-content\.google\/(?:image|video)\/([a-f0-9-]+)/i);
    if (m) return m[1];
    if (/^[a-f0-9-]{20,}$/i.test(s) && !s.startsWith('staged-')) return s;
    return null;
  }

  function parseStorytellerScript(text) {
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
      model: document.getElementById('bvs-model-select'),
      aspect: document.getElementById('bvs-aspect-select'),
      chain: document.getElementById('bvs-chain-toggle'),
      global: document.getElementById('bvs-global-prompt'),
      script: document.getElementById('bvs-script-editor'),
      charGrid: document.getElementById('bvs-char-grid'),
      genBtn: document.getElementById('bvs-generate-all-btn'),
      clearBtn: document.getElementById('bvs-clear-grid-btn'),
      stopBtn: document.getElementById('bvs-stop-btn'),
      dlAllBtn: document.getElementById('bvs-download-all-btn'),
      status: document.getElementById('bvs-sequence-status'),
      empty: document.getElementById('bvs-sequence-empty'),
      grid: document.getElementById('bvs-sequence-grid'),
    };
  }

  function readFormIntoState() {
    const { model, aspect, global, script, chain } = els();
    if (model) bvs.model = model.value || 'GEM_PIX_2';
    if (aspect) bvs.aspect = aspect.value || '16:9';
    if (global) bvs.globalPrompt = global.value || '';
    if (script) bvs.scriptText = script.value || '';
    if (chain) bvs.chain = chain.classList.contains('is-on');
  }

  function writeFormFromState() {
    const { model, aspect, global, script, chain } = els();
    if (model && bvs.model) model.value = bvs.model;
    if (aspect && bvs.aspect) aspect.value = bvs.aspect;
    if (global) global.value = bvs.globalPrompt || '';
    if (script && bvs.scriptText) script.value = bvs.scriptText;
    if (chain) {
      chain.classList.toggle('is-on', !!bvs.chain);
      chain.setAttribute('aria-pressed', bvs.chain ? 'true' : 'false');
    }
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
    if (bvs._formHydrated) readFormIntoState();
    const payload = {
      savedAt: Date.now(),
      expiresAt: Date.now() + STATE_TTL_MS,
      runActive: !!bvs.runActive,
      userStopped: !!bvs.userStopped,
      chain: !!bvs.chain,
      model: bvs.model,
      aspect: bvs.aspect,
      globalPrompt: bvs.globalPrompt,
      scriptText: bvs.scriptText,
      characters: bvs.characters,
      scenes: bvs.scenes,
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
      bvs.runActive = !!raw.runActive;
      bvs.userStopped = !!raw.userStopped;
      bvs.chain = raw.chain !== false;
      bvs.model = raw.model || 'GEM_PIX_2';
      bvs.aspect = raw.aspect || '16:9';
      bvs.globalPrompt = raw.globalPrompt || '';
      bvs.scriptText = raw.scriptText || '';
      bvs.characters = Array.isArray(raw.characters) ? raw.characters : [];
      bvs.scenes = Array.isArray(raw.scenes) ? raw.scenes : [];
      bvs.scenes.forEach((s, i) => {
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
      if (bvs.runActive || bvs.userStopped) {
        const canWork = bvs.scenes.some(
          (s) => s && (s.status === 'idle' || s.status === 'queued' || s.status === 'generating')
        );
        if (bvs.userStopped || !canWork) {
          bvs.runActive = false;
        }
      }
      return bvs.scenes.length > 0 || !!bvs.scriptText;
    } catch (_) {
      return false;
    }
  }

  function ensureDefaultCharacters() {
    if (bvs.characters.length) return;
    for (let i = 0; i < 3; i++) {
      bvs.characters.push({
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

    bvs.characters.forEach((c) => {
      const card = document.createElement('div');
      const busy = c.status === 'generating';
      const filled = !!c.imageUrl;
      card.className = `bvs-char-card${filled ? ' has-image' : ' is-empty'}${busy ? ' is-generating' : ''}`;

      if (filled) {
        card.innerHTML = `
          <div class="bvs-char-thumb">
            <img src="${escapeHtml(c.imageUrl)}" alt="" draggable="false" />
            <span class="bvs-char-dot" aria-hidden="true"></span>
            ${busy ? `<div class="bvs-char-busy"><div class="bvs-spinner"></div><span class="bvs-noselect">Queue</span></div>` : ''}
            <div class="bvs-char-overlay bvs-noselect">
              <div class="bvs-char-overlay-top">
                <button type="button" class="bvs-char-icon-btn" data-act="upload" title="Upload" ${busy ? 'disabled' : ''}>${ICON_UPLOAD}</button>
                <button type="button" class="bvs-char-icon-btn" data-act="aigen" title="AI Gen" ${busy ? 'disabled' : ''}>${ICON_SPARKLE}</button>
              </div>
              <div class="bvs-char-overlay-bottom">
                <button type="button" class="bvs-char-clear-btn" data-act="clear" title="Remove" ${busy ? 'disabled' : ''}>${ICON_X}</button>
              </div>
            </div>
          </div>
          <input class="bvs-char-name" type="text" placeholder="CHAR NAME" value="${escapeHtml(c.name)}" ${busy ? 'disabled' : ''} />
        `;
      } else {
        card.innerHTML = `
          <div class="bvs-char-split bvs-noselect">
            <button type="button" class="bvs-char-half" data-act="upload" ${busy ? 'disabled' : ''}>
              ${ICON_UPLOAD}
              <span>UPLOAD</span>
            </button>
            <button type="button" class="bvs-char-half" data-act="aigen" ${busy ? 'disabled' : ''}>
              ${ICON_SPARKLE}
              <span>AI GEN</span>
            </button>
          </div>
          ${busy ? `<div class="bvs-char-busy"><div class="bvs-spinner"></div><span class="bvs-noselect">Queue</span></div>` : ''}
          <input class="bvs-char-name" type="text" placeholder="CHAR NAME" value="${escapeHtml(c.name)}" ${busy ? 'disabled' : ''} />
        `;
      }

      const nameInput = card.querySelector('.bvs-char-name');
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
        const thumb = card.querySelector('.bvs-char-thumb');
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
        const open = charGrid.querySelectorAll('.bvs-char-card.is-controls-open');
        open.forEach((el) => {
          if (!el.contains(e.target)) el.classList.remove('is-controls-open');
        });
      });
    }

    if (bvs.characters.length < MAX_CHARS) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'bvs-char-add bvs-noselect';
      add.innerHTML = '<span class="bvs-char-add-plus">+</span><span>ADD NEW</span>';
      add.addEventListener('click', () => {
        bvs.characters.push({
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
    let modal = document.getElementById('bvs-modal-backdrop');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'bvs-modal-backdrop';
      modal.className = 'bvs-modal-backdrop';
      modal.innerHTML = '<div class="bvs-gen-modal" id="bvs-modal-card"></div>';
      document.body.appendChild(modal);
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeBvsModal();
      });
    }
    return modal;
  }

  function closeBvsModal() {
    const modal = document.getElementById('bvs-modal-backdrop');
    if (modal) modal.style.display = 'none';
  }

  function openAiGenCharacterModal(c, draft) {
    const stateDraft = draft || {
      name: c.name || '',
      prompt: c.lastPrompt || '',
    };

    const modal = getOrCreateBvsModal();
    const card = modal.querySelector('#bvs-modal-card');
    card.className = 'bvs-gen-modal';

    card.innerHTML = `
      <div class="bvs-gen-modal-head bvs-noselect">
        <div class="bvs-gen-modal-title">GENERATE CHARACTER</div>
        <div class="bvs-gen-modal-sub">Describe the character's appearance.</div>
      </div>
      <textarea class="bvs-gen-modal-textarea" id="bvs-modal-prompt" rows="6" placeholder="Describe your character...">${escapeHtml(stateDraft.prompt)}</textarea>
      <div class="bvs-gen-modal-actions bvs-noselect">
        <button type="button" class="bvs-gen-btn-cancel" id="bvs-modal-cancel">Cancel</button>
        <button type="button" class="bvs-gen-btn-create" id="bvs-modal-gen-action">
          <span class="bvs-gen-btn-label">Create Character</span>
        </button>
      </div>
    `;

    const promptEl = card.querySelector('#bvs-modal-prompt');
    const syncDraft = () => {
      stateDraft.prompt = (promptEl.value || '').trim();
      stateDraft.name = c.name || stateDraft.name || '';
    };

    card.querySelector('#bvs-modal-cancel').onclick = closeBvsModal;

    card.querySelector('#bvs-modal-gen-action').onclick = async () => {
      syncDraft();
      const name = (c.name || stateDraft.name || '').trim() || 'Character';
      const prompt = stateDraft.prompt || defaultCharPrompt(name);
      const genBtn = card.querySelector('#bvs-modal-gen-action');
      genBtn.disabled = true;
      genBtn.innerHTML =
        '<span class="bvs-btn-spinner"></span><span class="bvs-gen-btn-label">Create Character</span>';

      c.name = name;
      c.lastPrompt = prompt;
      c.status = 'generating';
      c.error = '';
      saveState();
      renderCharacters();
      closeBvsModal();

      try {
        const asset = await submitAndWaitImage({
          prompt,
          aspect_ratio: '1:1',
          model: bvs.model || 'GEM_PIX_2',
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
    return bvs.scenes
      .map((s) => `${s.id}|${s.status}|${s.url || ''}|${s.error || ''}|${s.queueMessage || ''}`)
      .join('||');
  }


  function isMobileToolViewport() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 900px)').matches;
  }

  function setMobileToolLayout(mode) {
    const ws = document.getElementById('bvs-workspace');
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
    const preferRun = !!(bvs.runActive || bvs._mobilePreferRun);
    setMobileToolLayout(preferRun ? 'run' : 'config');
  }

  function updateStatus(opts = {}) {
    const skipDomHeal = !!(opts && opts.skipDomHeal);
    const { status, empty, grid, dlAllBtn, genBtn, stopBtn } = els();

    // Ghost in-flight after Stop: clear so counts/buttons match the grid.
    if (!bvs.runActive) {
      let healed = false;
      bvs.scenes.forEach((s) => {
        if (s.status === 'generating' || s.status === 'queued') {
          markSceneCancelled(s);
          healed = true;
        }
      });
      if (healed) {
        bvs.pipelineBusy = false;
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
      bvs.scenes.length > 0 &&
      grid.childElementCount !== bvs.scenes.length
    ) {
      renderScenes({ force: true });
      return;
    }

    const ready = bvs.scenes.filter((s) => s.status === 'ready').length;
    const generating = bvs.scenes.filter((s) => s.status === 'generating').length;
    const queued = bvs.scenes.filter((s) => s.status === 'queued').length;
    const idle = bvs.scenes.filter((s) => s.status === 'idle').length;
    const busy = generating > 0 || queued > 0;

    // Stuck runActive with nothing in flight → unlock Generate All
    if (bvs.runActive && !busy && idle === 0) {
      bvs.runActive = false;
      saveState();
    }

    const parts = [`${bvs.scenes.length} scenes identified`, `${ready} ready`];
    if (generating) parts.push(`${generating} generating`);
    if (queued) parts.push(`${queued} queue`);
    const nextText = parts.join(' • ');
    if (status && status.textContent !== nextText) {
      status.textContent = nextText;
    }
    const has = bvs.scenes.length > 0;
    if (empty) empty.classList.toggle('hidden', has);
    if (grid) grid.classList.toggle('hidden', !has);
    if (dlAllBtn) dlAllBtn.disabled = ready === 0;

    // Generate: only lock while a run is actively submitting/waiting
    if (genBtn) genBtn.disabled = !!(bvs.runActive && busy);
    // Stop: only when there is something to cancel
    if (stopBtn) stopBtn.disabled = !(bvs.runActive || busy);
    syncMobileToolLayout();
  }

  function mediaInnerHtml(scene) {
    if (scene.status === 'ready' && scene.url) {
      return `
        <div class="bvs-queue-label" data-ph>Queue</div>
        <img class="bvs-scene-img" alt="" draggable="false" />
      `;
    }
    if (scene.status === 'failed' && isUserStopError(scene.error)) {
      return `<div class="bvs-queue-label is-stopped">Stop by user</div>`;
    }
    if (scene.status === 'generating') {
      return `<div class="bvs-gen-anim is-active"><div class="bvs-spinner"></div><span>Generating</span><div class="bvs-gen-pulse"></div></div>`;
    }
    if (scene.status === 'queued') {
      return `<div class="bvs-gen-anim is-queued"><div class="bvs-queue-dots" aria-hidden="true"><span></span><span></span><span></span></div><span>Queue</span></div>`;
    }
    if (scene.status === 'failed') {
      return `<div class="bvs-queue-label">Queue</div>`;
    }
    return `<div class="bvs-queue-label">Queue</div>`;
  }

  function bindSceneImage(card, scene) {
    if (!(scene.status === 'ready' && scene.url)) return;
    const img = card.querySelector('img.bvs-scene-img');
    const ph = card.querySelector('[data-ph]');
    if (!img) return;
    const probe = new Image();
    probe.onload = () => {
      img.src = scene.url;
      img.classList.add('is-ready');
      if (ph) ph.classList.add('hidden');
    };
    probe.onerror = () => {
      setTimeout(() => {
        const retry = new Image();
        retry.onload = () => {
          img.src = scene.url;
          img.classList.add('is-ready');
          if (ph) ph.classList.add('hidden');
        };
        retry.src = scene.url + (scene.url.includes('?') ? '&' : '?') + 'r=' + Date.now();
      }, 800);
    };
    probe.src = scene.url;
  }

  function renderScenes({ force = false } = {}) {
    const { grid } = els();
    if (!grid) return;
    const fp = scenesFingerprint();
    if (!force && bvs._scenesFp === fp && grid.childElementCount === bvs.scenes.length) {
      updateStatus({ skipDomHeal: true });
      return;
    }
    bvs._scenesFp = fp;
    grid.innerHTML = '';
    bvs.scenes.forEach((scene) => {
      const isGenerating = scene.status === 'generating';
      const isQueued = scene.status === 'queued';
      const busy = isGenerating || isQueued;
      const card = document.createElement('article');
      card.className = `bvs-scene-card${isGenerating ? ' is-generating' : ''}${isQueued ? ' is-queued' : ''}`;
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
        <div class="bvs-scene-media">${mediaInnerHtml(scene)}</div>
        <div class="bvs-scene-body">
          <div class="bvs-scene-title">${escapeHtml(scene.title)}</div>
          <div class="bvs-scene-prompt">${escapeHtml(scene.prompt || '(empty scene)')}</div>
          <div class="bvs-scene-status ${statusClass}">${escapeHtml(statusText)}</div>
          <div class="bvs-scene-actions">
            <button type="button" data-act="dl" ${scene.url ? '' : 'disabled'}>Download</button>
            ${
              scene.status === 'failed' || scene.status === 'ready'
                ? `<button type="button" data-act="retry" ${busy ? 'disabled' : ''}>Retry</button>`
                : ''
            }
          </div>
        </div>
      `;
      bindSceneImage(card, scene);
      const dl = card.querySelector('[data-act="dl"]');
      if (dl) {
        dl.addEventListener('click', () => {
          if (!scene.url) return;
          const a = document.createElement('a');
          a.href = scene.url;
          a.download = `${scene.title.replace(/\s+/g, '_').toLowerCase()}.png`;
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
    const index = bvs.scenes.findIndex((s) => s.id === scene.id);
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
    bvs.userStopped = false;
    bvs._mobilePreferRun = true;
    bvs.runActive = true;
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
    if (bvs.runActive && !force) return;
    const { script } = els();
    const text = script ? script.value : bvs.scriptText;
    const parsed = parseStorytellerScript(text);
    bvs.scenes = parsed.map((p, i) => {
      const prev = bvs.scenes.find(
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

  async function submitImageJob({ prompt, aspect_ratio, model, characters, image_id, image_ids, run_id, enqueue_only }) {
    const runId = run_id || uuid();
    const ids = Array.isArray(image_ids)
      ? image_ids.filter(Boolean)
      : image_id
        ? [image_id]
        : [];
    const useI2I = ids.length > 0;
    const endpoint = useI2I ? '/api/generate/image-to-image' : '/api/generate/image';
    const body = {
      prompt,
      aspect_ratio: aspect_ratio || '16:9',
      model: model || 'GEM_PIX_2',
      run_id: runId,
      source: 'storyteller',
      characters: characters && characters.length ? characters : undefined,
    };
    if (enqueue_only) body.enqueue_only = true;
    if (useI2I) {
      body.image_id = ids[0];
      if (ids.length > 1) body.image_ids = ids;
    }

    const res = await fetch(`${API_BASE}${endpoint}`, {
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

  async function submitAndWaitImage(opts) {
    const started = await submitImageJob(opts);
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
      const s = bvs.scenes[i];
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

  /** Cancel only Storyteller jobs (not Studio / other All Media requests). */
  async function cancelStorytellerPendingJobs(extraIds = []) {
    const jobIds = new Set((extraIds || []).filter(Boolean).map(String));
    const runIds = new Set();
    (bvs.sessionJobIds || []).forEach((id) => jobIds.add(String(id)));
    bvs.scenes.forEach((s) => {
      if (s.jobId) jobIds.add(String(s.jobId));
      if (s.runId) runIds.add(String(s.runId));
    });

    try {
      const res = await fetch(`${API_BASE}/api/generations/cancel-pending`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          source: 'storyteller',
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
    if (!Array.isArray(bvs.sessionJobIds)) bvs.sessionJobIds = [];
    if (!bvs.sessionJobIds.includes(jobId)) bvs.sessionJobIds.push(jobId);
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
    const scene = bvs.scenes[index];
    if (!scene || !scene.prompt) {
      if (scene) {
        scene.status = 'failed';
        scene.error = 'Empty scene prompt';
      }
      return;
    }
    if (!bvs.runActive || bvs.userStopped) return;
    if (scene.jobId && (scene.status === 'queued' || scene.status === 'generating' || scene.status === 'ready')) {
      return;
    }
    if (isUserStopError(scene.error) && scene.status === 'failed') return;

    const epoch = bvs.runEpoch;
    if (!isRunCurrent(epoch)) return;

    const matched = matchCharactersForScene(scene.prompt, bvs.characters);
    const superPrompt = buildSuperPrompt(bvs.globalPrompt, scene.prompt, matched);
    const useChain = bvs.chain && index > 0;
    const chainIds = useChain ? prevReadyMediaIds(index, 2) : [];

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
      const result = await submitImageJob({
        prompt: superPrompt,
        aspect_ratio: bvs.aspect || '16:9',
        model: bvs.model || 'GEM_PIX_2',
        characters: matched,
        image_ids: useChain && chainIds.length ? chainIds : undefined,
        image_id: useChain && chainIds.length === 1 ? chainIds[0] : undefined,
        run_id: scene.runId,
      });

      // Stop pressed while this request was in flight — abandon + cancel server job.
      if (!isRunCurrent(epoch) || isUserStopError(scene.error)) {
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
      if (!isRunCurrent(epoch) || isUserStopError(scene.error)) {
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
        bvs.runActive = false;
        for (let j = index + 1; j < bvs.scenes.length; j++) {
          if (bvs.scenes[j].status === 'idle') {
            bvs.scenes[j].status = 'failed';
            bvs.scenes[j].error = 'Cancelled — insufficient credits';
          }
        }
        toast('System Error', 'error');
        saveState();
        renderScenes();
        return;
      }

      // Client timeout / network blip: server job often still completes (your Scene 1 case).
      if (!isRunCurrent(epoch)) {
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
    if (!bvs.runActive || bvs.userStopped) return;

    const pending = bvs.scenes.filter(
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
    if (!bvs.runActive || bvs.userStopped) return;

    let changed = false;
    for (const scene of pending) {
      if (!bvs.runActive || bvs.userStopped) break;
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
    if (changed && bvs.runActive && !bvs.userStopped) {
      saveState();
      renderScenes({ force: true });
      await refreshCredits();
    }
  }

  async function advancePipeline() {
    if (!bvs.runActive || bvs.userStopped) return;

    const allDone = bvs.scenes.every(
      (s) => s.status === 'ready' || s.status === 'failed' || !s.prompt
    );
    if (allDone && bvs.scenes.length) {
      bvs.runActive = false;
      saveState();
      updateStatus();
      return;
    }

    if (bvs.chain) {
      if (bvs.pipelineBusy) return;
      bvs.pipelineBusy = true;
      try {
        if (!bvs.runActive || bvs.userStopped) return;
        const inFlight = bvs.scenes.some((s) => s.status === 'queued' || s.status === 'generating');
        if (inFlight) return;
        const nextIdx = bvs.scenes.findIndex((s) => s.status === 'idle');
        if (nextIdx >= 0) {
          await submitSceneAt(nextIdx);
          if (bvs.runActive && !bvs.userStopped) scheduleFillSlots();
        }
      } finally {
        bvs.pipelineBusy = false;
      }
      return;
    }

    // Non-chain: keep up to MAX_PARALLEL hot; refill as soon as a slot frees.
    await fillParallelSlots();
  }

  function scheduleFillSlots() {
    if (!bvs.runActive || bvs.userStopped) return;
    if (bvs._fillTimer) return;
    bvs._fillTimer = setTimeout(() => {
      bvs._fillTimer = null;
      if (bvs.runActive && !bvs.userStopped) fillParallelSlots().catch(() => {});
    }, 40);
  }

  async function fillParallelSlots() {
    if (!bvs.runActive || bvs.userStopped || bvs.chain) return;
    if (bvs.fillingSlots) return;
    bvs.fillingSlots = true;
    try {
      while (bvs.runActive && !bvs.userStopped) {
        const inFlight = bvs.scenes.filter(
          (s) => s.status === 'queued' || s.status === 'generating'
        ).length;
        const slots = Math.max(0, MAX_PARALLEL - inFlight);
        if (!slots) break;
        const nextIdx = bvs.scenes.findIndex((s) => s.status === 'idle');
        if (nextIdx < 0) break;

        // Fire without awaiting full HTTP — when one finishes, scheduleFillSlots starts the next.
        const idx = nextIdx;
        submitSceneAt(idx)
          .catch(() => {})
          .finally(() => {
            if (bvs.runActive && !bvs.userStopped) scheduleFillSlots();
            updateStatus();
          });

        // Let status flip to generating before counting the next free slot
        await new Promise((r) => setTimeout(r, 60));
      }
    } finally {
      bvs.fillingSlots = false;
      updateStatus();
    }
  }

  /** When the tab closes/hides, enqueue remaining idle scenes so the server keeps going. */
  async function enqueueRemainingForBackground() {
    if (!bvs.runActive || bvs.userStopped || bvs.chain) return;
    const idle = bvs.scenes
      .map((s, i) => (s.status === 'idle' ? i : -1))
      .filter((i) => i >= 0);
    if (!idle.length) return;

    for (const index of idle) {
      if (!bvs.runActive) break;
      const scene = bvs.scenes[index];
      if (!scene || scene.jobId) continue;
      const matched = matchCharactersForScene(scene.prompt, bvs.characters);
      const superPrompt = buildSuperPrompt(bvs.globalPrompt, scene.prompt, matched);
      scene.runId = scene.runId || uuid();
      scene.submitPrompt = superPrompt;
      try {
        const result = await submitImageJob({
          prompt: superPrompt,
          aspect_ratio: bvs.aspect || '16:9',
          model: bvs.model || 'GEM_PIX_2',
          characters: matched,
          run_id: scene.runId,
          enqueue_only: true,
        });
        scene.jobId = result.jobId;
        scene.runId = result.runId || scene.runId;
        trackSessionJob(result.jobId);
        scene.status = 'queued';
        scene.queueMessage = result.queueMessage || 'In Queue: Storyteller background';
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
    if (bvs.userStopped && !bvs.runActive) return false;
    return (
      bvs.runActive ||
      bvs.scenes.some(
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
      if (bvs.userStopped && !bvs.runActive) {
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
      console.warn('[Storyteller] background tick', e);
    }
  }

  function startBackgroundWorker() {
    if (bvs.pollTimer) clearInterval(bvs.pollTimer);
    // Faster tick while running so free slots + ready cards update quickly
    bvs.pollTimer = setInterval(backgroundTick, bvs.runActive ? 1500 : 3000);
    backgroundTick();
  }

  async function generateAll() {
    readFormIntoState();
    syncScenesFromScript({ force: true });
    if (!bvs.scenes.length) {
      toast('Add Scene / Prompt headers to your script first', 'warning');
      return;
    }

    // Wipe leftover Storyteller queue only (leave Studio / other tools alone).
    armUserStop(); // kill any prior run races first
    const cleared = await cancelStorytellerPendingJobs(
      bvs.scenes.map((s) => s.jobId).filter(Boolean)
    );
    if (cleared) toast(`Cleared ${cleared} leftover Storyteller job(s)`, 'info');
    bvs.sessionJobIds = [];

    // Always start fresh jobs — do not keep prior ready URLs when reusing the same script.
    bvs.scenes.forEach((s) => {
      s.status = 'idle';
      s.error = '';
      s.jobId = null;
      s.runId = null;
      s.url = '';
      s.mediaId = null;
      s.queueMessage = '';
      s.submitPrompt = '';
    });

    bvs.userStopped = false;
    bvs.runActive = true;
    bumpRunEpoch();
    saveState();
    renderScenes({ force: true });
    toast(
      bvs.chain
        ? 'Storyteller started (chain) — keep tab open for best results'
        : 'Storyteller started — 5 at a time; safe to leave (remaining queue continues on server)',
      'info'
    );
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
    if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
    if (t.includes('webp')) return 'webp';
    if (t.includes('gif')) return 'gif';
    return 'png';
  }

  async function downloadAll() {
    const ready = bvs.scenes.filter((s) => s.url);
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
      a.download = 'storyteller-scenes.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 2000);
      toast(`Downloaded 1 ZIP with ${added} images`, 'success');
    } catch (err) {
      console.warn(err);
      toast(toUserFacingGenerationError(err.message || err) || 'ZIP download failed', 'error');
    } finally {
      if (dlAllBtn) dlAllBtn.disabled = ready.length === 0;
      updateStatus();
    }
  }

  async function stopGeneration() {
    const pending = bvs.scenes.filter(
      (s) => s.status === 'idle' || s.status === 'queued' || s.status === 'generating'
    );

    armUserStop();

    pending.forEach((s) => markSceneCancelled(s));
    // Also clear any ghost generating/queued left by in-flight races
    bvs.scenes.forEach((s) => {
      if (s.status === 'generating' || s.status === 'queued' || s.status === 'idle') {
        markSceneCancelled(s);
      }
    });

    saveState();
    renderScenes({ force: true });
    updateStatus({ skipDomHeal: true });
    toast('Stopping Storyteller generations…', 'info');

    // Only Storyteller-tagged / this-run jobs — never cancel Studio or other tools.
    const refunded = await cancelStorytellerPendingJobs();
    bvs.sessionJobIds = [];
    // Keep stop lock armed until the user clicks Generate All again
    armUserStop();
    bvs.scenes.forEach((s) => {
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
        ? `Stopped — ${pending.length} scene(s) Stop by user, ${refunded} Storyteller job(s) cancelled`
        : pending.length
          ? `Stopped — ${pending.length} scene(s) Stop by user`
          : 'No pending Storyteller jobs to cancel',
      refunded ? 'success' : 'info'
    );
  }

  async function clearAll(opts) {
    const silent = !!(opts && opts.silent);
    armUserStop();
    bvs._mobilePreferRun = false;
    setMobileToolLayout('config');
    const n = await cancelStorytellerPendingJobs(bvs.scenes.map((s) => s.jobId).filter(Boolean));
    bvs.sessionJobIds = [];
    bvs.scenes = [];
    bvs.scriptText = '';
    bvs.globalPrompt = '';
    bvs.characters = [];
    clearPersistedState();
    writeFormFromState();
    renderCharacters();
    renderScenes({ force: true });
    updateStatus({ skipDomHeal: true });
    if (n) await refreshCredits();
    if (!silent) {
      await refreshStudioGallery();
      toast(n ? `Grid cleared — ${n} Storyteller job(s) cancelled` : 'Storyteller grid cleared', 'info');
    }
  }

  function bindUi() {
    if (bvs.bound) return;
    const { chain, script, genBtn, clearBtn, stopBtn, dlAllBtn, global, model, aspect } = els();
    if (!script || !genBtn) return;
    bvs.bound = true;

    if (chain) {
      chain.addEventListener('click', () => {
        const on = !chain.classList.contains('is-on');
        chain.classList.toggle('is-on', on);
        chain.setAttribute('aria-pressed', on ? 'true' : 'false');
        bvs.chain = on;
        saveState();
      });
    }

    let t = null;
    script.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        bvs.scriptText = script.value;
        syncScenesFromScript();
      }, 250);
    });
    [global, model, aspect].forEach((el) => {
      if (!el) return;
      el.addEventListener('change', () => {
        readFormIntoState();
        saveState();
      });
    });

    const editBtn = document.getElementById('bvs-mobile-edit-btn');
    if (editBtn && editBtn.dataset.bound !== '1') {
      editBtn.dataset.bound = '1';
      editBtn.addEventListener('click', () => {
        bvs._mobilePreferRun = false;
        setMobileToolLayout('config');
      });
    }
    if (!window.__GFLOW_BVS_MOBILE_RESIZE__) {
      window.__GFLOW_BVS_MOBILE_RESIZE__ = true;
      window.addEventListener('resize', () => syncMobileToolLayout());
    }
    genBtn.addEventListener('click', () => generateAll());
    if (stopBtn) stopBtn.addEventListener('click', () => stopGeneration());
    if (clearBtn) clearBtn.addEventListener('click', () => clearAll());
    if (dlAllBtn) dlAllBtn.addEventListener('click', () => downloadAll());

    window.addEventListener('beforeunload', () => {
      saveState();
      // Best-effort: kick remaining idle scenes onto the server queue (non-chain).
      if (bvs.runActive && !bvs.userStopped && !bvs.chain) {
        try {
          enqueueRemainingForBackground();
        } catch (_) {}
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && bvs.runActive && !bvs.userStopped && !bvs.chain) {
        enqueueRemainingForBackground().catch(() => {});
      }
      if (document.visibilityState === 'visible') backgroundTick();
    });
    window.addEventListener('pagehide', () => {
      if (bvs.runActive && !bvs.userStopped && !bvs.chain) {
        enqueueRemainingForBackground().catch(() => {});
      }
    });
  }

  function initStoryteller() {
    const restored = loadState();
    bindUi();
    writeFormFromState();
    bvs._formHydrated = true;
    renderCharacters();
    if (restored) {
      renderScenes({ force: true });
      // Only resume if still a live run (Stop clears this)
      if (bvs.runActive && !bvs.userStopped) {
        toast('Resuming Storyteller queue…', 'info');
      } else {
        bvs.runActive = false;
      }
    } else if (!bvs.scenes.length) {
      syncScenesFromScript({ force: true });
    } else {
      renderScenes({ force: true });
    }
    updateStatus();
    bvs._mobilePreferRun = !!(bvs.runActive && !bvs.userStopped);
    syncMobileToolLayout();
    startBackgroundWorker();
  }

  window.initStoryteller = initStoryteller;
  window.parseStorytellerScript = parseStorytellerScript;
  window.wipeStorytellerState = clearAll;
  window.__GFLOW_STORYTELLER_INIT__ = true;

  // Start background poller even before opening the pane (after scripts load)
  try {
    if (loadState() && bvs.runActive && !bvs.userStopped) {
      startBackgroundWorker();
    }
  } catch (_) {}
})();
