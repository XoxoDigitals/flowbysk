/**
 * Bulk Image to Video — Next /api/generate/image-to-video (credits + queue).
 * Upload sequenced stills, confirm 1:1 prompts, stage, then generate.
 * Persists to localStorage; resumes after refresh; server jobs keep running after logout.
 */
(function () {
  'use strict';

  if (typeof window !== 'undefined' && window.__GFLOW_BULKI2V_INIT__) {
    return;
  }

  const API_BASE = '';
  const MAX_CHARS = 6;
  const STORAGE_KEY = 'gflow_biv_state_v1';
  const STATE_TTL_MS = 24 * 60 * 60 * 1000;
  const DRAFT_API = '/api/studio/drafts/bulki2v';

  const biv = {
    characters: [],
    images: [],
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
    stagedLocalIds: [],
    model: 'VEO_3_1_LITE',
    aspect: '16:9',
    globalPrompt: '',
    scriptText: '',
    pollTimer: null,
    _fillTimer: null,
    _draftSaveTimer: null,
    _serverHydrated: false,
  };

  /** Match Studio plan parallel slots (Pro default). Do not POST every idle scene at once. */
  const MAX_PARALLEL = 5;

  function getActiveProjectId() {
    try {
      if (typeof window !== 'undefined' && window.__GFLOW_STATE__ && window.__GFLOW_STATE__.activeProjectId) {
        return window.__GFLOW_STATE__.activeProjectId;
      }
    } catch (_) {}
    try {
      const st = typeof window !== 'undefined' ? window.state : null;
      if (st && st.activeProjectId) return st.activeProjectId;
    } catch (_) {}
    return null;
  }

  function buildDraftPayload() {
    if (biv._formHydrated) readFormIntoState();
    return {
      savedAt: Date.now(),
      expiresAt: Date.now() + STATE_TTL_MS,
      runActive: !!biv.runActive,
      userStopped: !!biv.userStopped,
      chain: !!biv.chain,
      model: biv.model,
      aspect: biv.aspect,
      duration: biv.duration || 8,
      globalPrompt: biv.globalPrompt,
      scriptText: biv.scriptText,
      stagedLocalIds: Array.isArray(biv.stagedLocalIds) ? biv.stagedLocalIds : [],
      images: (biv.images || []).map((img) => ({
        id: img.id,
        assetId: img.assetId || null,
        stagedId: img.stagedId || null,
        name: img.name,
        seq: img.seq,
        previewUrl:
          img.previewUrl && !String(img.previewUrl).startsWith('blob:')
            ? img.previewUrl
            : '',
      })),
      characters: biv.characters,
      scenes: (biv.scenes || []).map((s) => {
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
      }),
    };
  }

  function scheduleServerDraftSave() {
    if (biv._draftSaveTimer) clearTimeout(biv._draftSaveTimer);
    biv._draftSaveTimer = setTimeout(() => {
      biv._draftSaveTimer = null;
      pushServerDraft().catch(() => {});
    }, 600);
  }

  async function pushServerDraft() {
    const payload = buildDraftPayload();
    const body = { payload };
    const pid = getActiveProjectId();
    if (pid) body.projectId = pid;
    const res = await fetch(DRAFT_API, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Draft save failed (${res.status})`);
    }
    return res.json().catch(() => ({}));
  }

  async function fetchServerDraft() {
    const pid = getActiveProjectId();
    const q = pid ? `?projectId=${encodeURIComponent(pid)}` : '';
    const res = await fetch(`${DRAFT_API}${q}`, { credentials: 'include' });
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data.draft || null;
  }

  async function deleteServerDraft() {
    const pid = getActiveProjectId();
    const q = pid ? `?projectId=${encodeURIComponent(pid)}` : '';
    try {
      await fetch(`${DRAFT_API}${q}`, { method: 'DELETE', credentials: 'include' });
    } catch (_) {}
  }

  function applyDraftPayload(raw, { keepLiveFiles = false } = {}) {
    if (!raw || typeof raw !== 'object') return false;
    biv.runActive = !!raw.runActive;
    biv.userStopped = !!raw.userStopped;
    biv.chain = false;
    biv.duration = Number(raw.duration) || 8;
    biv.model = raw.model || 'VEO_3_1_LITE';
    biv.aspect = raw.aspect === '1:1' ? '16:9' : raw.aspect || '16:9';
    biv.globalPrompt = '';
    biv.scriptText = raw.scriptText || '';
    biv.stagedLocalIds = Array.isArray(raw.stagedLocalIds)
      ? raw.stagedLocalIds.filter(Boolean)
      : [];
    biv.characters = Array.isArray(raw.characters) ? raw.characters : [];

    const liveBySeq = new Map();
    if (keepLiveFiles) {
      (biv.images || []).forEach((img) => {
        if (img && img.file && Number.isFinite(Number(img.seq))) {
          liveBySeq.set(Number(img.seq), img);
        }
      });
    }

    const rawImages = Array.isArray(raw.images) ? raw.images : null;
    if (keepLiveFiles && liveBySeq.size && (!rawImages || !rawImages.length)) {
      // Keep in-memory uploads; empty draft metadata must not wipe them
    } else if (rawImages) {
      biv.images = rawImages
        .map((img) => {
          const seq = Number(img.seq);
          const live = liveBySeq.get(seq);
          if (live) {
            return {
              ...live,
              id: img.id || live.id,
              assetId: img.assetId || live.assetId || null,
              stagedId: img.stagedId || live.stagedId || null,
              name: img.name || live.name,
              seq,
              previewUrl:
                live.previewUrl ||
                (img.previewUrl && !String(img.previewUrl).startsWith('blob:')
                  ? img.previewUrl
                  : '') ||
                '',
            };
          }
          return {
            id: img.id || uuid(),
            assetId: img.assetId || null,
            stagedId: img.stagedId || null,
            name: img.name || '',
            seq,
            file: null,
            previewUrl:
              img.previewUrl && !String(img.previewUrl).startsWith('blob:')
                ? img.previewUrl
                : '',
          };
        })
        .filter((img) => Number.isFinite(img.seq));
    } else if (!keepLiveFiles) {
      biv.images = [];
    }

    biv.scenes = Array.isArray(raw.scenes) ? raw.scenes : [];
    biv.scenes.forEach((s, i) => {
      if (!s) return;
      s.index = Number(s.index) || i + 1;
      s.title = normalizeSceneTitle(s, i + 1);
      if (!keepLiveFiles) s.file = null;
      if (s.previewUrl && String(s.previewUrl).startsWith('blob:')) s.previewUrl = '';
      if (s.url && mediaUrlExpired(s.url)) {
        s.url = '';
        if (s.status === 'ready') {
          s.status = 'failed';
          s.error = 'Media expired';
        }
      }
      // Reattach server preview from image when missing
      if (!s.previewUrl && s.imageSeq != null) {
        const img = biv.images.find((x) => x.seq === s.imageSeq);
        if (img && img.previewUrl) s.previewUrl = img.previewUrl;
      }
      if (!s.stagedId && s.imageSeq != null) {
        const img = biv.images.find((x) => x.seq === s.imageSeq);
        if (img && img.stagedId) s.stagedId = img.stagedId;
        if (img && img.assetId) s.localAssetId = img.assetId;
      }
    });
    return true;
  }

  async function stageUploadedFile(file) {
    const form = new FormData();
    form.append('file', file, file.name || 'frame.jpg');
    const pid = getActiveProjectId();
    if (pid) form.append('projectId', pid);
    const res = await fetch(`${API_BASE}/api/assets/stage`, {
      method: 'POST',
      body: form,
      credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.error || 'Staging failed');
    const stagedId = data.staged_id || (data.asset && data.asset.staged_id) || null;
    const assetId = (data.asset && data.asset.id) || null;
    const url = (data.asset && data.asset.url) || '';
    if (!stagedId) throw new Error('Staging returned no staged-* id');
    return { stagedId, assetId, url };
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
    return !!biv.runActive && !biv.userStopped && Number(epoch) === Number(biv.runEpoch);
  }

  function bumpRunEpoch() {
    biv.runEpoch = (biv.runEpoch || 0) + 1;
    return biv.runEpoch;
  }

  function clearFillTimer() {
    if (biv._fillTimer) {
      clearTimeout(biv._fillTimer);
      biv._fillTimer = null;
    }
  }

  /** Hard stop flags — call before cancelling scenes. */
  function armUserStop() {
    biv.userStopped = true;
    biv.runActive = false;
    bumpRunEpoch();
    biv.pipelineBusy = false;
    biv.fillingSlots = false;
    clearFillTimer();
  }

  async function withSystemErrorRetry(fn, label) {
    if (typeof window.withSystemErrorRetry === 'function') {
      return window.withSystemErrorRetry(fn, label);
    }
    const maxAttempts = 5;
    const delayMs = 2500;
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
        console.warn(`[BulkI2V] system-retry ${label || ''} attempt ${attempt}/${maxAttempts}:`, msg);
        await new Promise((r) => setTimeout(r, delayMs));
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
    return `biv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function extractFlowMediaId(urlOrId) {
    if (!urlOrId) return null;
    const s = String(urlOrId);
    const m = s.match(/flow-content\.google\/(?:image|video)\/([a-f0-9-]+)/i);
    if (m) return m[1];
    if (/^[a-f0-9-]{20,}$/i.test(s) && !s.startsWith('staged-')) return s;
    return null;
  }

  function parseBulkI2VScript(text) {
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
      // Multiple blank-line-separated blocks → one prompt each (maps to uploaded images)
      const blocks = trimmed
        .split(/\n\s*\n+/)
        .map((b) => b.trim())
        .filter(Boolean);
      if (blocks.length > 1) {
        return blocks.map((prompt, i) => ({
          id: uuid(),
          index: i + 1,
          title: `Scene ${i + 1} :`,
          prompt,
          status: 'idle',
          url: '',
          mediaId: null,
          error: '',
          jobId: null,
          queueMessage: '',
        }));
      }
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

  function parseSequenceFromFilename(name) {
    const base = String(name || '').replace(/\.[^.]+$/, '');
    let m = base.match(/(?:^|[^a-z])(?:scene|sc)\s*[_-]?\s*(\d+)/i);
    if (m) return Number(m[1]);
    m = base.match(/^(\d+)/);
    if (m) return Number(m[1]);
    m = base.match(/(\d+)\s*$/);
    if (m) return Number(m[1]);
    return null;
  }

  function sortedImages() {
    return (biv.images || [])
      .slice()
      .sort((a, b) => {
        const sa = Number.isFinite(a.seq) ? a.seq : 1e9;
        const sb = Number.isFinite(b.seq) ? b.seq : 1e9;
        if (sa !== sb) return sa - sb;
        return String(a.name || '').localeCompare(String(b.name || ''));
      });
  }

  function parsedPrompts() {
    const { script } = els();
    const text = script ? script.value : biv.scriptText;
    return parseBulkI2VScript(text)
      .map((p) => ({ ...p, prompt: String(p.prompt || '').trim() }))
      .filter((p) => p.prompt)
      .sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0));
  }

  function mappingCounts() {
    const imgs = sortedImages();
    const promptList = parsedPrompts();
    return {
      images: imgs.length,
      prompts: promptList.length,
      equal: imgs.length > 0 && imgs.length === promptList.length,
      allPromptsFilled: promptList.length > 0 && promptList.every((p) => p.prompt),
      imgs,
      promptList,
    };
  }

  function canGenerateMapping() {
    const m = mappingCounts();
    return m.equal && m.allPromptsFilled && !biv.runActive;
  }

  function updateMappingStatus() {
    const el = document.getElementById('biv-mapping-status');
    const m = mappingCounts();
    let msg = `${m.images} image(s) • ${m.prompts} prompt(s)`;
    if (m.images && m.prompts && !m.equal) msg += ' — counts must match';
    else if (canGenerateMapping()) msg += ' — ready to generate';
    else if (m.images && !m.prompts) msg += ' — paste prompts';
    if (el) el.textContent = msg;
  }

  function revokeImagePreview(img) {
    if (img && img.previewUrl && String(img.previewUrl).startsWith('blob:')) {
      try {
        URL.revokeObjectURL(img.previewUrl);
      } catch (_) {}
    }
  }

  function clearImages() {
    (biv.images || []).forEach(revokeImagePreview);
    biv.images = [];
    const input = document.getElementById('biv-image-input');
    if (input) input.value = '';
    if (!biv.runActive) {
      biv.scenes = [];
      renderScenes({ force: true });
    }
    clearPersistedState();
    if (biv._draftSaveTimer) {
      clearTimeout(biv._draftSaveTimer);
      biv._draftSaveTimer = null;
    }
    deleteServerDraft().catch(() => {});
    updateMappingStatus();
    updateStatus();
    toast('Images cleared', 'info');
  }

  async function ingestImageFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f && String(f.type || '').startsWith('image/'));
    if (!files.length) {
      toast('Select image files', 'warning');
      return;
    }
    let skipped = 0;
    let loaded = 0;
    let stageFailed = 0;
    for (const file of files) {
      const seq = parseSequenceFromFilename(file.name);
      if (seq == null || !Number.isFinite(seq)) {
        skipped += 1;
        continue;
      }
      const existing = biv.images.findIndex((x) => x.seq === seq);
      const blobUrl = URL.createObjectURL(file);
      const entry = {
        id: uuid(),
        name: file.name,
        seq,
        file,
        previewUrl: blobUrl,
        assetId: null,
        stagedId: null,
      };
      try {
        const staged = await stageUploadedFile(file);
        entry.assetId = staged.assetId;
        entry.stagedId = staged.stagedId;
        if (staged.url) {
          revokeImagePreview(entry);
          entry.previewUrl = staged.url;
        }
        if (staged.assetId) trackStagedLocal(staged.assetId);
      } catch (err) {
        stageFailed += 1;
        console.warn('[BulkI2V] stage on upload failed', err);
      }
      if (existing >= 0) {
        revokeImagePreview(biv.images[existing]);
        biv.images[existing] = entry;
      } else {
        biv.images.push(entry);
      }
      loaded += 1;
    }
    if (skipped) toast(`Skipped ${skipped} file(s) without a sequence number`, 'warning');
    if (stageFailed) {
      toast(`Loaded ${loaded} image(s) — ${stageFailed} not saved to server yet`, 'warning');
    } else if (loaded) {
      toast(`Loaded ${loaded} image(s)`, 'success');
    }
    syncPreviewFromInputs({ force: true });
    scheduleServerDraftSave();
  }

  /** Live preview: one card per uploaded image; prompts attach by order as you paste. */
  function syncPreviewFromInputs({ force = false } = {}) {
    if (biv.runActive && !force) {
      updateMappingStatus();
      return;
    }
    const m = mappingCounts();
    const imgs = m.imgs;
    const promptList = m.promptList;

    biv.scenes = imgs.map((img, i) => {
      const promptText = promptList[i] ? String(promptList[i].prompt || '').trim() : '';
      const prev = biv.scenes.find((s) => s && s.imageSeq === img.seq);
      const inFlight =
        prev &&
        (prev.status === 'queued' || prev.status === 'generating') &&
        !force;
      if (inFlight) {
        return {
          ...prev,
          index: img.seq,
          title: normalizeSceneTitle({ index: img.seq }, i + 1),
          prompt: promptText || prev.prompt || '',
          imageName: img.name,
          imageSeq: img.seq,
          previewUrl: img.previewUrl || prev.previewUrl || '',
          file: img.file || prev.file || null,
          stagedId: img.stagedId || prev.stagedId || null,
          localAssetId: img.assetId || prev.localAssetId || null,
        };
      }
      const keepReady = prev && prev.status === 'ready' && prev.url && !force;
      return {
        id: (prev && prev.id) || uuid(),
        index: img.seq,
        title: `Scene ${img.seq} :`,
        prompt: promptText,
        status: keepReady ? 'ready' : 'idle',
        url: keepReady ? prev.url : '',
        mediaId: keepReady ? prev.mediaId : null,
        error: keepReady ? '' : '',
        jobId: keepReady ? prev.jobId : null,
        runId: keepReady ? prev.runId : null,
        queueMessage: '',
        submitPrompt: '',
        imageName: img.name,
        imageSeq: img.seq,
        previewUrl: img.previewUrl || (prev && prev.previewUrl) || '',
        file: img.file || (prev && prev.file) || null,
        stagedId: img.stagedId || (prev && prev.stagedId) || null,
        localAssetId: img.assetId || (prev && prev.localAssetId) || null,
      };
    });

    renderScenes({ force: true });
    updateMappingStatus();
    updateStatus();
    saveState();
  }

  function trackStagedLocal(id) {
    if (!id) return;
    if (!Array.isArray(biv.stagedLocalIds)) biv.stagedLocalIds = [];
    if (!biv.stagedLocalIds.includes(id)) biv.stagedLocalIds.push(id);
  }

  async function cleanupStagedLocals() {
    const ids = Array.from(new Set((biv.stagedLocalIds || []).filter(Boolean)));
    biv.stagedLocalIds = [];
    for (const id of ids) {
      try {
        await fetch(`${API_BASE}/api/assets?id=${encodeURIComponent(id)}`, {
          method: 'DELETE',
          credentials: 'include',
        });
      } catch (_) {}
    }
    biv.scenes.forEach((s) => {
      if (s) {
        s.stagedId = null;
        s.localAssetId = null;
      }
    });
  }

  async function maybeCleanupStagedAfterRun() {
    // Keep staged draft images until Clear — only drop orphans not in biv.images
    const active = biv.scenes.some(
      (s) => s && (s.status === 'idle' || s.status === 'queued' || s.status === 'generating')
    );
    if (active || biv.runActive) return;
    const keep = new Set(
      (biv.images || []).map((img) => img && (img.assetId || img.id)).filter(Boolean)
    );
    const orphans = (biv.stagedLocalIds || []).filter((id) => id && !keep.has(id));
    if (!orphans.length) return;
    for (const id of orphans) {
      try {
        await fetch(`${API_BASE}/api/assets?id=${encodeURIComponent(id)}`, {
          method: 'DELETE',
          credentials: 'include',
        });
      } catch (_) {}
    }
    biv.stagedLocalIds = (biv.stagedLocalIds || []).filter((id) => keep.has(id));
    saveState();
  }

  async function stageSceneFile(scene) {
    if (scene.stagedId) return scene.stagedId;
    if (scene.imageSeq != null) {
      const img = biv.images.find((x) => x.seq === scene.imageSeq);
      if (img && img.stagedId) {
        scene.stagedId = img.stagedId;
        scene.localAssetId = img.assetId || scene.localAssetId || null;
        return img.stagedId;
      }
    }
    const file = scene.file;
    if (!file) throw new Error('Re-upload images — file missing from browser memory');
    const staged = await stageUploadedFile(file);
    scene.stagedId = staged.stagedId;
    scene.localAssetId = staged.assetId;
    trackStagedLocal(staged.assetId);
    if (scene.imageSeq != null) {
      const img = biv.images.find((x) => x.seq === scene.imageSeq);
      if (img) {
        img.stagedId = staged.stagedId;
        img.assetId = staged.assetId || img.assetId;
        if (staged.url && (!img.previewUrl || String(img.previewUrl).startsWith('blob:'))) {
          revokeImagePreview(img);
          img.previewUrl = staged.url;
        }
      }
    }
    return staged.stagedId;
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
      model: document.getElementById('biv-model-select'),
      aspect: document.getElementById('biv-aspect-select'),
      duration: document.getElementById('biv-duration-select'),
      global: document.getElementById('biv-global-prompt'),
      script: document.getElementById('biv-script-editor'),
      imageInput: document.getElementById('biv-image-input'),
      clearImagesBtn: document.getElementById('biv-clear-images-btn'),
      genBtn: document.getElementById('biv-generate-all-btn'),
      clearBtn: document.getElementById('biv-clear-grid-btn'),
      stopBtn: document.getElementById('biv-stop-btn'),
      dlAllBtn: document.getElementById('biv-download-all-btn'),
      status: document.getElementById('biv-sequence-status'),
      empty: document.getElementById('biv-sequence-empty'),
      grid: document.getElementById('biv-sequence-grid'),
    };
  }

  function readFormIntoState() {
    const { model, aspect, duration, script } = els();
    if (model) biv.model = model.value || 'VEO_3_1_LITE';
    if (aspect) {
      const ar = aspect.value || '16:9';
      biv.aspect = ar === '1:1' ? '16:9' : ar;
    }
    if (duration) biv.duration = Number(duration.value) || 8;
    biv.globalPrompt = '';
    if (script) biv.scriptText = script.value || '';
    biv.chain = false; // V1 pure T2V — never chain
  }

  function writeFormFromState() {
    const { model, aspect, duration, script } = els();
    if (model && biv.model) model.value = biv.model;
    if (aspect) {
      if (biv.aspect === '1:1') biv.aspect = '16:9';
      aspect.value = biv.aspect || '16:9';
    }
    updateDurationOptionsForModel(biv.model);
    if (duration) duration.value = String(biv.duration || 8);
    if (script && biv.scriptText) script.value = biv.scriptText;
  }

  function updateDurationOptionsForModel(model) {
    const isOmni = String(model || biv.model || '') === 'OMNI_1_1_FLASH';
    const opt10 = document.getElementById('biv-dur-10s-opt');
    if (opt10) {
      opt10.hidden = !isOmni;
      opt10.disabled = !isOmni;
    }
    if (!isOmni && Number(biv.duration) === 10) {
      biv.duration = 8;
      const duration = document.getElementById('biv-duration-select');
      if (duration) duration.value = '8';
    }
  }

  function applyBulkI2VModelLockSync() {
    const model = document.getElementById('biv-model-select');
    if (!model) return;
    readFormIntoState();
    updateDurationOptionsForModel(biv.model);
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
    const payload = buildDraftPayload();
    try {
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
    scheduleServerDraftSave();
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
      const ok = applyDraftPayload(raw, { keepLiveFiles: true });
      if (!ok) return false;
      // Never resume a dead run (Stop left only failed/ready cards)
      if (biv.runActive || biv.userStopped) {
        const canWork = biv.scenes.some(
          (s) => s && (s.status === 'idle' || s.status === 'queued' || s.status === 'generating')
        );
        if (biv.userStopped || !canWork) {
          biv.runActive = false;
        }
      }
      return biv.scenes.length > 0 || !!biv.scriptText || biv.images.length > 0;
    } catch (_) {
      return false;
    }
  }

  function ensureDefaultCharacters() {
    if (biv.characters.length) return;
    for (let i = 0; i < 3; i++) {
      biv.characters.push({
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

    biv.characters.forEach((c) => {
      const card = document.createElement('div');
      const busy = c.status === 'generating';
      const filled = !!c.imageUrl;
      card.className = `biv-char-card${filled ? ' has-image' : ' is-empty'}${busy ? ' is-generating' : ''}`;

      if (filled) {
        card.innerHTML = `
          <div class="biv-char-thumb">
            <img src="${escapeHtml(c.imageUrl)}" alt="" draggable="false" />
            <span class="biv-char-dot" aria-hidden="true"></span>
            ${busy ? `<div class="biv-char-busy"><div class="biv-spinner"></div><span class="biv-noselect">Queue</span></div>` : ''}
            <div class="biv-char-overlay biv-noselect">
              <div class="biv-char-overlay-top">
                <button type="button" class="biv-char-icon-btn" data-act="upload" title="Upload" ${busy ? 'disabled' : ''}>${ICON_UPLOAD}</button>
                <button type="button" class="biv-char-icon-btn" data-act="aigen" title="AI Gen" ${busy ? 'disabled' : ''}>${ICON_SPARKLE}</button>
              </div>
              <div class="biv-char-overlay-bottom">
                <button type="button" class="biv-char-clear-btn" data-act="clear" title="Remove" ${busy ? 'disabled' : ''}>${ICON_X}</button>
              </div>
            </div>
          </div>
          <input class="biv-char-name" type="text" placeholder="CHAR NAME" value="${escapeHtml(c.name)}" ${busy ? 'disabled' : ''} />
        `;
      } else {
        card.innerHTML = `
          <div class="biv-char-split biv-noselect">
            <button type="button" class="biv-char-half" data-act="upload" ${busy ? 'disabled' : ''}>
              ${ICON_UPLOAD}
              <span>UPLOAD</span>
            </button>
            <button type="button" class="biv-char-half" data-act="aigen" ${busy ? 'disabled' : ''}>
              ${ICON_SPARKLE}
              <span>AI GEN</span>
            </button>
          </div>
          ${busy ? `<div class="biv-char-busy"><div class="biv-spinner"></div><span class="biv-noselect">Queue</span></div>` : ''}
          <input class="biv-char-name" type="text" placeholder="CHAR NAME" value="${escapeHtml(c.name)}" ${busy ? 'disabled' : ''} />
        `;
      }

      const nameInput = card.querySelector('.biv-char-name');
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
        const thumb = card.querySelector('.biv-char-thumb');
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
        const open = charGrid.querySelectorAll('.biv-char-card.is-controls-open');
        open.forEach((el) => {
          if (!el.contains(e.target)) el.classList.remove('is-controls-open');
        });
      });
    }

    if (biv.characters.length < MAX_CHARS) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'biv-char-add biv-noselect';
      add.innerHTML = '<span class="biv-char-add-plus">+</span><span>ADD NEW</span>';
      add.addEventListener('click', () => {
        biv.characters.push({
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
    let modal = document.getElementById('biv-modal-backdrop');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'biv-modal-backdrop';
      modal.className = 'biv-modal-backdrop';
      modal.innerHTML = '<div class="biv-gen-modal" id="biv-modal-card"></div>';
      document.body.appendChild(modal);
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeBvsModal();
      });
    }
    return modal;
  }

  function closeBvsModal() {
    const modal = document.getElementById('biv-modal-backdrop');
    if (modal) modal.style.display = 'none';
  }

  function openAiGenCharacterModal(c, draft) {
    const stateDraft = draft || {
      name: c.name || '',
      prompt: c.lastPrompt || '',
    };

    const modal = getOrCreateBvsModal();
    const card = modal.querySelector('#biv-modal-card');
    card.className = 'biv-gen-modal';

    card.innerHTML = `
      <div class="biv-gen-modal-head biv-noselect">
        <div class="biv-gen-modal-title">GENERATE CHARACTER</div>
        <div class="biv-gen-modal-sub">Describe the character's appearance.</div>
      </div>
      <textarea class="biv-gen-modal-textarea" id="biv-modal-prompt" rows="6" placeholder="Describe your character...">${escapeHtml(stateDraft.prompt)}</textarea>
      <div class="biv-gen-modal-actions biv-noselect">
        <button type="button" class="biv-gen-btn-cancel" id="biv-modal-cancel">Cancel</button>
        <button type="button" class="biv-gen-btn-create" id="biv-modal-gen-action">
          <span class="biv-gen-btn-label">Create Character</span>
        </button>
      </div>
    `;

    const promptEl = card.querySelector('#biv-modal-prompt');
    const syncDraft = () => {
      stateDraft.prompt = (promptEl.value || '').trim();
      stateDraft.name = c.name || stateDraft.name || '';
    };

    card.querySelector('#biv-modal-cancel').onclick = closeBvsModal;

    card.querySelector('#biv-modal-gen-action').onclick = async () => {
      syncDraft();
      const name = (c.name || stateDraft.name || '').trim() || 'Character';
      const prompt = stateDraft.prompt || defaultCharPrompt(name);
      const genBtn = card.querySelector('#biv-modal-gen-action');
      genBtn.disabled = true;
      genBtn.innerHTML =
        '<span class="biv-btn-spinner"></span><span class="biv-gen-btn-label">Create Character</span>';

      c.name = name;
      c.lastPrompt = prompt;
      c.status = 'generating';
      c.error = '';
      saveState();
      renderCharacters();
      closeBvsModal();

      try {
        const asset = await submitAndWaitI2V({
          prompt,
          aspect_ratio: '1:1',
          model: biv.model || 'VEO_3_1_LITE',
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
    return biv.scenes
      .map((s) => `${s.id}|${s.status}|${s.url || ''}|${s.error || ''}|${s.queueMessage || ''}`)
      .join('||');
  }


  function isMobileToolViewport() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 900px)').matches;
  }

  function setMobileToolLayout(mode) {
    const ws = document.getElementById('biv-workspace');
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
    const preferRun = !!(biv.runActive || biv._mobilePreferRun);
    setMobileToolLayout(preferRun ? 'run' : 'config');
  }

  function updateStatus(opts = {}) {
    const skipDomHeal = !!(opts && opts.skipDomHeal);
    const { status, empty, grid, dlAllBtn, genBtn, stopBtn } = els();

    // Ghost in-flight after Stop: clear so counts/buttons match the grid.
    // Must key off userStopped too — retry/races can leave runActive true while stopped.
    if (!biv.runActive || biv.userStopped) {
      let healed = false;
      biv.scenes.forEach((s) => {
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
        biv.pipelineBusy = false;
        biv.fillingSlots = false;
        clearFillTimer();
        if (biv.userStopped) biv.runActive = false;
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
      biv.scenes.length > 0 &&
      grid.childElementCount !== biv.scenes.length
    ) {
      renderScenes({ force: true });
      return;
    }

    const ready = biv.scenes.filter((s) => s.status === 'ready').length;
    const generating = biv.scenes.filter((s) => s.status === 'generating').length;
    const queued = biv.scenes.filter((s) => s.status === 'queued').length;
    const idle = biv.scenes.filter((s) => s.status === 'idle').length;
    const busy = generating > 0 || queued > 0;

    // Stuck runActive with nothing in flight → unlock Generate All (never while userStopped)
    if (biv.runActive && !biv.userStopped && !busy && idle === 0) {
      biv.runActive = false;
      saveState();
    }

    const parts = [`${biv.scenes.length} scenes identified`, `${ready} ready`];
    if (generating) parts.push(`${generating} generating`);
    if (queued) parts.push(`${queued} queue`);
    const planHint = biv.scenes.some(
      (s) => s && s.status === 'queued' && /plan parallel|parallel limit|Waiting in queue/i.test(String(s.queueMessage || ''))
    );
    if (planHint) parts.push('plan limit');
    const nextText = parts.join(' • ');
    if (status && status.textContent !== nextText) {
      status.textContent = nextText;
    }
    const has = biv.scenes.length > 0;
    if (empty) empty.classList.toggle('hidden', has);
    if (grid) grid.classList.toggle('hidden', !has);
    if (dlAllBtn) dlAllBtn.disabled = ready === 0;

    // Generate: require matching image↔prompt counts; lock while a run is busy
    if (genBtn) {
      const m = mappingCounts();
      const canGen =
        m.equal &&
        m.allPromptsFilled &&
        biv.scenes.length > 0 &&
        !(biv.runActive && busy && !biv.userStopped);
      genBtn.disabled = !canGen;
    }
    // Stop: only when there is something to cancel
    if (stopBtn) stopBtn.disabled = !((biv.runActive && !biv.userStopped) || busy);
    updateMappingStatus();
    syncMobileToolLayout();
  }

  function mediaInnerHtml(scene) {
    if (scene.status === 'ready' && scene.url) {
      return `
        <div class="biv-queue-label" data-ph>Queue</div>
        <video class="biv-scene-video" muted loop playsinline preload="metadata"></video>
        <button type="button" class="card-play-badge biv-play-badge" data-act="play" title="Play video" aria-label="Play video">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
        </button>
      `;
    }
    if (scene.status === 'failed' && isUserStopError(scene.error)) {
      return scene.previewUrl
        ? `<img class="biv-scene-still" alt="" src="${escapeHtml(scene.previewUrl)}"/><div class="biv-queue-label is-stopped">Stop by user</div>`
        : `<div class="biv-queue-label is-stopped">Stop by user</div>`;
    }
    if (scene.status === 'generating') {
      return scene.previewUrl
        ? `<img class="biv-scene-still" alt="" src="${escapeHtml(scene.previewUrl)}"/><div class="biv-gen-anim is-active"><div class="biv-spinner"></div><span>Generating</span><div class="biv-gen-pulse"></div></div>`
        : `<div class="biv-gen-anim is-active"><div class="biv-spinner"></div><span>Generating</span><div class="biv-gen-pulse"></div></div>`;
    }
    if (scene.status === 'queued') {
      return scene.previewUrl
        ? `<img class="biv-scene-still" alt="" src="${escapeHtml(scene.previewUrl)}"/><div class="biv-gen-anim is-queued"><div class="biv-queue-dots" aria-hidden="true"><span></span><span></span><span></span></div><span>Queue</span></div>`
        : `<div class="biv-gen-anim is-queued"><div class="biv-queue-dots" aria-hidden="true"><span></span><span></span><span></span></div><span>Queue</span></div>`;
    }
    if (scene.previewUrl) {
      return `<img class="biv-scene-still" alt="" src="${escapeHtml(scene.previewUrl)}"/><div class="biv-queue-label">Queue</div>`;
    }
    if (scene.status === 'failed') {
      return `<div class="biv-queue-label">Queue</div>`;
    }
    return `<div class="biv-queue-label">Queue</div>`;
  }

  function bindSceneMedia(card, scene) {
    if (!(scene.status === 'ready' && scene.url)) return;
    const vid = card.querySelector('video.biv-scene-video');
    const ph = card.querySelector('[data-ph]');
    const media = card.querySelector('.biv-scene-media');
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

    const openPlayer = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (typeof window.openMediaViewerModal === 'function') {
        window.openMediaViewerModal({
          type: 'video',
          url: scene.url,
          prompt: scene.prompt || scene.submitPrompt || '',
          name: scene.title || `Scene ${scene.index || ''}`,
          id: scene.jobId || scene.id,
        });
      } else {
        window.open(scene.url, '_blank', 'noopener');
      }
    };
    const playBtn = card.querySelector('[data-act="play"]');
    if (playBtn) playBtn.addEventListener('click', openPlayer);
    if (media) {
      media.style.cursor = 'pointer';
      media.addEventListener('click', (e) => {
        if (e.target.closest('[data-act="dl"], [data-act="retry"]')) return;
        openPlayer(e);
      });
    }
  }

  function renderScenes({ force = false } = {}) {
    const { grid } = els();
    if (!grid) return;
    const fp = scenesFingerprint();
    if (!force && biv._scenesFp === fp && grid.childElementCount === biv.scenes.length) {
      updateStatus({ skipDomHeal: true });
      return;
    }
    biv._scenesFp = fp;
    grid.innerHTML = '';
    biv.scenes.forEach((scene) => {
      const isGenerating = scene.status === 'generating';
      const isQueued = scene.status === 'queued';
      const busy = isGenerating || isQueued;
      const card = document.createElement('article');
      card.className = `biv-scene-card${isGenerating ? ' is-generating' : ''}${isQueued ? ' is-queued' : ''}`;
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
        <div class="biv-scene-media">${mediaInnerHtml(scene)}</div>
        <div class="biv-scene-body">
          <div class="biv-scene-title">${escapeHtml(scene.title)}</div>
          <div class="biv-scene-prompt">${escapeHtml(scene.prompt || '(paste matching prompt…)')}</div>
          <div class="biv-scene-status ${statusClass}">${escapeHtml(statusText)}</div>
          <div class="biv-scene-actions">
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
    const index = biv.scenes.findIndex((s) => s.id === scene.id);
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
    biv.userStopped = false;
    biv._mobilePreferRun = true;
    biv.runActive = true;
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
    syncPreviewFromInputs({ force });
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

  async function submitI2VJob({
    prompt,
    aspect_ratio,
    duration,
    model,
    run_id,
    enqueue_only,
    staged_id,
  }) {
    const runId = run_id || uuid();
    const body = {
      prompt,
      aspect_ratio: aspect_ratio || '16:9',
      duration: duration || biv.duration || 8,
      model: model || 'VEO_3_1_LITE',
      run_id: runId,
      source: 'bulki2v',
      frame_mode: 'first_only',
      staged_id,
    };
    if (enqueue_only) body.enqueue_only = true;

    const res = await fetch(`${API_BASE}/api/generate/image-to-video`, {
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

  async function submitAndWaitI2V(opts) {
    const started = await submitI2VJob(opts);
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
      if (asset.status === 'FAILED' || asset.status === 'CANCELLED') {
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
      const s = biv.scenes[i];
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

  /** Cancel only Bulk I2V jobs (not Studio / other All Media requests). */
  async function cancelBulkI2VPendingJobs(extraIds = [], extraRunIds = []) {
    const jobIds = new Set((extraIds || []).filter(Boolean).map(String));
    const runIds = new Set((extraRunIds || []).filter(Boolean).map(String));
    (biv.sessionJobIds || []).forEach((id) => jobIds.add(String(id)));
    biv.scenes.forEach((s) => {
      if (s.jobId) jobIds.add(String(s.jobId));
      if (s.runId) runIds.add(String(s.runId));
    });

    try {
      const res = await fetch(`${API_BASE}/api/generations/cancel-pending`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          source: 'bulki2v',
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
    if (!Array.isArray(biv.sessionJobIds)) biv.sessionJobIds = [];
    if (!biv.sessionJobIds.includes(jobId)) biv.sessionJobIds.push(jobId);
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
    const scene = biv.scenes[index];
    if (!scene || !scene.prompt) {
      if (scene) {
        scene.status = 'failed';
        scene.error = 'Empty scene prompt';
      }
      return;
    }
    if (!biv.runActive || biv.userStopped) return;
    if (scene.jobId && (scene.status === 'queued' || scene.status === 'generating' || scene.status === 'ready')) {
      return;
    }
    if (isUserStopError(scene.error) && scene.status === 'failed') return;

    const epoch = biv.runEpoch;
    if (!isRunCurrent(epoch)) return;

    const matched = [];
    const superPrompt = buildSuperPrompt(biv.globalPrompt, scene.prompt, matched);

    if (!isRunCurrent(epoch)) return;

    // Prefer live file from images[] (survives mapping refresh)
    if (!scene.file && scene.imageSeq != null) {
      const img = biv.images.find((x) => x.seq === scene.imageSeq);
      if (img && img.file) {
        scene.file = img.file;
        scene.previewUrl = img.previewUrl || scene.previewUrl;
      }
    }

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
      const stagedId = await stageSceneFile(scene);
      if (!isRunCurrent(epoch)) {
        markSceneCancelled(scene);
        saveState();
        renderScenes({ force: true });
        return;
      }
      const result = await submitI2VJob({
        prompt: superPrompt,
        aspect_ratio: biv.aspect || '16:9',
        duration: biv.duration || 8,
        model: biv.model || 'VEO_3_1_LITE',
        run_id: scene.runId,
        staged_id: stagedId,
      });

      // Stop pressed while this request was in flight — abandon + cancel server job.
      if (biv.userStopped || !isRunCurrent(epoch) || isUserStopError(scene.error)) {
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
      if (biv.userStopped || !isRunCurrent(epoch) || isUserStopError(scene.error)) {
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
        biv.runActive = false;
        for (let j = index + 1; j < biv.scenes.length; j++) {
          if (biv.scenes[j].status === 'idle') {
            biv.scenes[j].status = 'failed';
            biv.scenes[j].error = 'Cancelled — insufficient credits';
          }
        }
        toast('System Error', 'error');
        saveState();
        renderScenes();
        return;
      }

      // Client timeout / network blip: server job often still completes (your Scene 1 case).
      if (biv.userStopped || !isRunCurrent(epoch)) {
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

  async function pollPendingJobStatuses() {
    if (!biv.runActive || biv.userStopped) return;
    const pending = biv.scenes.filter(
      (s) =>
        s &&
        s.jobId &&
        !s.url &&
        (s.status === 'generating' || s.status === 'queued' || s.status === 'PROCESSING')
    );
    if (!pending.length) return;

    let changed = false;
    await Promise.all(
      pending.map(async (scene) => {
        if (!biv.runActive || biv.userStopped) return;
        try {
          const res = await fetch(
            `${API_BASE}/api/video/status/${encodeURIComponent(scene.jobId)}`,
            { credentials: 'include' }
          );
          if (!res.ok) return;
          const data = await res.json().catch(() => ({}));
          const asset = data.asset || data;
          const status = String(asset.status || '').toUpperCase();
          if ((status === 'COMPLETED' || status === 'READY') && asset.url) {
            applyCompletedAssetToScene(scene, {
              id: scene.jobId,
              url: asset.url,
              status: 'COMPLETED',
              upstreamAssetId: asset.upstreamAssetId || asset.mediaId,
            });
            changed = true;
          } else if (status === 'FAILED' || status === 'CANCELLED') {
            const err = asset.error || asset.errorMessage || 'Generation failed';
            if (status === 'CANCELLED' || isUserStopError(err)) {
              markSceneCancelled(scene);
            } else {
              scene.status = 'failed';
              scene.error = err;
            }
            changed = true;
          } else if (status === 'IN_QUEUE') {
            if (scene.status !== 'queued') {
              scene.status = 'queued';
              scene.queueMessage = asset.queueMessage || asset.error || '';
              changed = true;
            }
          } else if (status === 'PROCESSING' || status === 'GENERATING' || status === 'PREPARING') {
            if (scene.status !== 'generating') {
              scene.status = 'generating';
              changed = true;
            }
          }
        } catch (_) {}
      })
    );

    if (changed && biv.runActive && !biv.userStopped) {
      saveState();
      renderScenes({ force: true });
      await refreshCredits();
    }
  }

  async function reconcileJobsFromServer() {
    // After Stop, never revive cards into generating/queued from server status
    if (!biv.runActive || biv.userStopped) return;

    await pollPendingJobStatuses();
    if (!biv.runActive || biv.userStopped) return;

    const pending = biv.scenes.filter(
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
    if (!biv.runActive || biv.userStopped) return;

    let changed = false;
    for (const scene of pending) {
      if (!biv.runActive || biv.userStopped) break;
      if (isUserStopError(scene.error)) continue;
      if (scene.status === 'ready' && scene.url) continue;
      const asset = findAssetForScene(list, scene);
      if (!asset) continue;
      if (asset.status === 'COMPLETED' && asset.url) {
        const before = `${scene.status}|${scene.url || ''}`;
        applyCompletedAssetToScene(scene, asset);
        if (`${scene.status}|${scene.url || ''}` !== before) changed = true;
      } else if (
        (asset.status === 'FAILED' || asset.status === 'CANCELLED') &&
        scene.jobId &&
        asset.id === scene.jobId
      ) {
        const err = asset.error || asset.errorMessage || 'Generation failed';
        if (asset.status === 'CANCELLED' || isUserStopError(err)) {
          if (!isUserStopError(scene.error)) {
            markSceneCancelled(scene);
            changed = true;
          }
        } else if (scene.status !== 'failed' || scene.error !== err) {
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
    if (changed && biv.runActive && !biv.userStopped) {
      saveState();
      renderScenes({ force: true });
      await refreshCredits();
    }
  }

  async function advancePipeline() {
    if (!biv.runActive || biv.userStopped) return;

    const allDone = biv.scenes.every(
      (s) => s.status === 'ready' || s.status === 'failed' || !s.prompt
    );
    if (allDone && biv.scenes.length) {
      biv.runActive = false;
      saveState();
      updateStatus();
      await maybeCleanupStagedAfterRun();
      return;
    }

    if (biv.chain) {
      if (biv.pipelineBusy) return;
      biv.pipelineBusy = true;
      try {
        if (!biv.runActive || biv.userStopped) return;
        const inFlight = biv.scenes.some((s) => s.status === 'queued' || s.status === 'generating');
        if (inFlight) return;
        const nextIdx = biv.scenes.findIndex((s) => s.status === 'idle');
        if (nextIdx >= 0) {
          await submitSceneAt(nextIdx);
          if (biv.runActive && !biv.userStopped) scheduleFillSlots();
        }
      } finally {
        biv.pipelineBusy = false;
      }
      return;
    }

    // Non-chain: keep up to MAX_PARALLEL hot; refill as soon as a slot frees.
    await fillParallelSlots();
  }

  function scheduleFillSlots() {
    if (!biv.runActive || biv.userStopped) return;
    if (biv._fillTimer) return;
    biv._fillTimer = setTimeout(() => {
      biv._fillTimer = null;
      if (biv.runActive && !biv.userStopped) fillParallelSlots().catch(() => {});
    }, 40);
  }

  async function fillParallelSlots() {
    if (!biv.runActive || biv.userStopped || biv.chain) return;
    if (biv.fillingSlots) return;
    biv.fillingSlots = true;
    try {
      while (biv.runActive && !biv.userStopped) {
        const inFlight = biv.scenes.filter(
          (s) => s.status === 'queued' || s.status === 'generating'
        ).length;
        const slots = Math.max(0, MAX_PARALLEL - inFlight);
        if (!slots) break;
        const nextIdx = biv.scenes.findIndex((s) => s.status === 'idle');
        if (nextIdx < 0) break;

        // Fire without awaiting full HTTP — when one finishes, scheduleFillSlots starts the next.
        const idx = nextIdx;
        submitSceneAt(idx)
          .catch(() => {})
          .finally(() => {
            if (biv.userStopped) {
              markSceneCancelled(biv.scenes[idx]);
              updateStatus({ skipDomHeal: true });
              return;
            }
            if (biv.runActive && !biv.userStopped) scheduleFillSlots();
            updateStatus();
          });

        // Let status flip to generating before counting the next free slot
        await new Promise((r) => setTimeout(r, 60));
      }
    } finally {
      biv.fillingSlots = false;
      updateStatus();
    }
  }

  /** When the tab closes/hides, enqueue remaining idle scenes so the server keeps going. */
  async function enqueueRemainingForBackground() {
    if (!biv.runActive || biv.userStopped || biv.chain) return;
    const idle = biv.scenes
      .map((s, i) => (s.status === 'idle' ? i : -1))
      .filter((i) => i >= 0);
    if (!idle.length) return;

    for (const index of idle) {
      if (!biv.runActive) break;
      const scene = biv.scenes[index];
      if (!scene || scene.jobId) continue;
      const matched = [];
      const superPrompt = buildSuperPrompt(biv.globalPrompt, scene.prompt, matched);
      scene.runId = scene.runId || uuid();
      scene.submitPrompt = superPrompt;
      try {
        if (!scene.file && scene.imageSeq != null) {
          const img = biv.images.find((x) => x.seq === scene.imageSeq);
          if (img && img.file) scene.file = img.file;
        }
        const stagedId = await stageSceneFile(scene);
        const result = await submitI2VJob({
          prompt: superPrompt,
          aspect_ratio: biv.aspect || '16:9',
          duration: biv.duration || 8,
          model: biv.model || 'VEO_3_1_LITE',
          run_id: scene.runId,
          enqueue_only: true,
          staged_id: stagedId,
        });
        scene.jobId = result.jobId;
        scene.runId = result.runId || scene.runId;
        trackSessionJob(result.jobId);
        scene.status = 'queued';
        scene.queueMessage = result.queueMessage || 'In Queue: Bulk I2V background';
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
    if (biv.userStopped && !biv.runActive) return false;
    return (
      biv.runActive ||
      biv.scenes.some(
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
      if (biv.userStopped && !biv.runActive) {
        updateStatus();
        return;
      }
      if (!hasPendingWork()) {
        updateStatus();
        await maybeCleanupStagedAfterRun();
        return;
      }
      await reconcileJobsFromServer();
      await advancePipeline();
      updateStatus();
    } catch (e) {
      console.warn('[BulkI2V] background tick', e);
    }
  }

  function startBackgroundWorker() {
    if (biv.pollTimer) clearInterval(biv.pollTimer);
    // Faster tick while running so free slots + ready cards update quickly
    biv.pollTimer = setInterval(backgroundTick, biv.runActive ? 1500 : 3000);
    backgroundTick();
  }

  async function generateAll() {
    readFormIntoState();
    syncPreviewFromInputs({ force: true });
    const m = mappingCounts();
    if (!m.equal || !m.allPromptsFilled || !biv.scenes.length) {
      toast('Need matching image count and non-empty prompts', 'warning');
      return;
    }
    const missingFile = biv.scenes.some((s) => {
      if (s.stagedId) return false;
      if (s.file) return false;
      const img = biv.images.find((x) => x.seq === s.imageSeq);
      if (img && (img.file || img.stagedId)) return false;
      return true;
    });
    if (missingFile) {
      toast('Re-upload images (missing staged files on server)', 'warning');
      return;
    }

    // Wipe leftover BulkI2V queue only (leave Studio / other tools alone).
    armUserStop(); // kill any prior run races first
    const cleared = await cancelBulkI2VPendingJobs(
      biv.scenes.map((s) => s.jobId).filter(Boolean)
    );
    if (cleared) toast(`Cleared ${cleared} leftover Bulk I2V job(s)`, 'info');
    biv.sessionJobIds = [];

    // Always start fresh jobs — do not keep prior ready URLs when reusing the same script.
    biv.scenes.forEach((s) => {
      s.status = 'idle';
      s.error = '';
      s.jobId = null;
      s.runId = null;
      s.url = '';
      s.mediaId = null;
      s.queueMessage = '';
      s.submitPrompt = '';
      s.stagedId = null;
      // Keep localAssetId tracking separate; new stage creates new ids
    });

    biv.userStopped = false;
    biv.runActive = true;
    bumpRunEpoch();
    saveState();
    renderScenes({ force: true });
    toast('Bulk I2V started — parallel slots; Stop cancels this tool only', 'info');
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
    const ready = biv.scenes.filter((s) => s.url);
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
      a.download = 'bulki2v-scenes.zip';
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
    const pending = biv.scenes.filter(
      (s) => s.status === 'idle' || s.status === 'queued' || s.status === 'generating'
    );

    // Snapshot ids BEFORE markSceneCancelled clears them
    const snapJobIds = biv.scenes.map((s) => s.jobId).filter(Boolean);
    const snapRunIds = biv.scenes.map((s) => s.runId).filter(Boolean);
    (biv.sessionJobIds || []).forEach((id) => snapJobIds.push(id));

    armUserStop();

    pending.forEach((s) => markSceneCancelled(s));
    // Also clear any ghost generating/queued left by in-flight races
    biv.scenes.forEach((s) => {
      if (s.status === 'generating' || s.status === 'queued' || s.status === 'idle') {
        markSceneCancelled(s);
      }
    });

    saveState();
    renderScenes({ force: true });
    updateStatus({ skipDomHeal: true });
    toast('Stopping Bulk I2V generations…', 'info');

    // Only BulkI2V-tagged / this-run jobs — never cancel Studio or other tools.
    const refunded = await cancelBulkI2VPendingJobs(snapJobIds, snapRunIds);
    biv.sessionJobIds = [];
    // Keep stop lock armed until the user clicks Generate All again
    armUserStop();
    biv.scenes.forEach((s) => {
      if (s.status === 'generating' || s.status === 'queued' || s.status === 'idle') {
        markSceneCancelled(s);
      }
    });
    saveState();
    renderScenes({ force: true });
    updateStatus({ skipDomHeal: true });
    await refreshCredits();
    await refreshStudioGallery();
    await maybeCleanupStagedAfterRun();
    toast(
      refunded
        ? `Stopped — ${pending.length} scene(s) Stop by user, ${refunded} Bulk I2V job(s) cancelled`
        : pending.length
          ? `Stopped — ${pending.length} scene(s) Stop by user`
          : 'No pending Bulk I2V jobs to cancel',
      refunded ? 'success' : 'info'
    );
  }

  async function clearAll(opts) {
    const silent = !!(opts && opts.silent);
    armUserStop();
    biv._mobilePreferRun = false;
    setMobileToolLayout('config');
    const n = await cancelBulkI2VPendingJobs(biv.scenes.map((s) => s.jobId).filter(Boolean));
    biv.sessionJobIds = [];
    await deleteServerDraft();
    await cleanupStagedLocals();
    (biv.images || []).forEach(revokeImagePreview);
    biv.images = [];
    biv.scenes = [];
    biv.scriptText = '';
    const input = document.getElementById('biv-image-input');
    if (input) input.value = '';
    if (biv._draftSaveTimer) {
      clearTimeout(biv._draftSaveTimer);
      biv._draftSaveTimer = null;
    }
    clearPersistedState();
    writeFormFromState();
    renderScenes({ force: true });
    updateMappingStatus();
    updateStatus({ skipDomHeal: true });
    if (n) await refreshCredits();
    if (!silent) {
      await refreshStudioGallery();
      toast(n ? `Grid cleared — ${n} Bulk I2V job(s) cancelled` : 'Bulk I2V grid cleared', 'info');
    }
  }

  function bindUi() {
    if (biv.bound) return;
    const { script, genBtn, clearBtn, stopBtn, dlAllBtn, model, aspect, duration, imageInput, clearImagesBtn } = els();
    if (!script || !genBtn) return;
    biv.bound = true;

    let t = null;
    script.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        biv.scriptText = script.value;
        syncPreviewFromInputs();
      }, 180);
    });
    if (imageInput) {
      imageInput.addEventListener('change', () => {
        ingestImageFiles(imageInput.files).catch(() => {});
      });
    }
    if (clearImagesBtn) clearImagesBtn.addEventListener('click', () => clearImages());

    [model, aspect, duration].forEach((el) => {
      if (!el) return;
      el.addEventListener('change', () => {
        readFormIntoState();
        if (el === model) updateDurationOptionsForModel(biv.model);
        saveState();
      });
    });

    const editBtn = document.getElementById('biv-mobile-edit-btn');
    if (editBtn && editBtn.dataset.bound !== '1') {
      editBtn.dataset.bound = '1';
      editBtn.addEventListener('click', () => {
        biv._mobilePreferRun = false;
        setMobileToolLayout('config');
      });
    }
    if (!window.__GFLOW_BIV_MOBILE_RESIZE__) {
      window.__GFLOW_BIV_MOBILE_RESIZE__ = true;
      window.addEventListener('resize', () => syncMobileToolLayout());
    }
    genBtn.addEventListener('click', () => generateAll());
    if (stopBtn) stopBtn.addEventListener('click', () => stopGeneration());
    if (clearBtn) clearBtn.addEventListener('click', () => clearAll());
    if (dlAllBtn) dlAllBtn.addEventListener('click', () => downloadAll());

    window.addEventListener('beforeunload', () => {
      saveState();
      // Best-effort: kick remaining idle scenes onto the server queue (non-chain).
      if (biv.runActive && !biv.userStopped && !biv.chain) {
        try {
          enqueueRemainingForBackground();
        } catch (_) {}
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && biv.runActive && !biv.userStopped && !biv.chain) {
        enqueueRemainingForBackground().catch(() => {});
      }
      if (document.visibilityState === 'visible') backgroundTick();
    });
    window.addEventListener('pagehide', () => {
      if (biv.runActive && !biv.userStopped && !biv.chain) {
        enqueueRemainingForBackground().catch(() => {});
      }
    });
  }

  async function initBulkI2V() {
    const hadLiveFiles = (biv.images || []).some((img) => img && (img.file || img.stagedId || img.previewUrl));
    // Avoid clobbering warmer in-memory state with empty localStorage on tool switch
    const restoredLocal = hadLiveFiles ? true : loadState();
    try {
      const draft = await fetchServerDraft();
      if (draft && draft.payload) {
        applyDraftPayload(draft.payload, { keepLiveFiles: hadLiveFiles });
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(buildDraftPayload()));
        } catch (_) {}
        biv._serverHydrated = true;
      }
    } catch (e) {
      console.warn('[BulkI2V] server draft load failed', e);
    }

    bindUi();
    writeFormFromState();
    biv._formHydrated = true;
    const restored = restoredLocal || biv._serverHydrated || biv.images.length > 0 || biv.scenes.length > 0;
    if (restored) {
      if (biv.images.length || biv.scriptText) {
        syncPreviewFromInputs({ force: !biv.runActive });
      } else {
        renderScenes({ force: true });
      }
      if (biv.runActive && !biv.userStopped) {
        toast('Resuming Bulk I2V queue…', 'info');
      } else {
        biv.runActive = false;
      }
    } else {
      updateMappingStatus();
    }
    updateStatus();
    biv._mobilePreferRun = !!(biv.runActive && !biv.userStopped);
    syncMobileToolLayout();
    startBackgroundWorker();
  }

  window.initBulkI2V = initBulkI2V;
  window.wipeBulkI2VState = clearAll;
  window.__gflowBulkI2VOnModelLock = applyBulkI2VModelLockSync;
  window.parseBulkI2VScript = parseBulkI2VScript;
  window.__GFLOW_BULKI2V_INIT__ = true;

  // Start background poller even before opening the pane (after scripts load)
  try {
    if (loadState() && biv.runActive && !biv.userStopped) {
      startBackgroundWorker();
    }
  } catch (_) {}
})();
