  // ---------------------------------------------------------------------------
  // Exact model display names (never show bare "Veo 3.1")
  // ---------------------------------------------------------------------------
  function formatModelDisplayName(model, mediaType) {
    if (!model) {
      return mediaType === 'image' ? 'Nano Banana 2 Pro' : 'Veo 3.1 - Lite';
    }
    const raw = String(model).trim();
    const paren = raw.match(/\(([^)]+)\)/);
    const token = (paren ? paren[1] : raw).trim();
    const u = token
      .toUpperCase()
      .replace(/\./g, '_')
      .replace(/-/g, '_')
      .replace(/\s+/g, '_');

    const MAP = {
      VEO_3_1_LITE: 'Veo 3.1 - Lite',
      VEO_3_1_LITE: 'Veo 3.1 - Lite',
      VEO_3_1_FAST: 'Veo 3.1 - Fast',
      VEO_3_1_QUALITY: 'Veo 3.1 - Quality',
      VEO_3_1_R2V_LITE_LOW_PRIORITY: 'Veo 3.1 - Lite',
      VEO_3_1_R2V_LITE: 'Veo 3.1 - Fast',
      VEO_3_1_EXTEND_LITE: 'Veo 3.1 - Fast',
      VEO_3_1_EXTEND_LITE_LOW_PRIORITY: 'Veo 3.1 - Lite',
      VEO_3_1_T2V_LITE_LOW_PRIORITY: 'Veo 3.1 - Lite',
      VEO_3_1_T2V_LITE: 'Veo 3.1 - Fast',
      VEO_3_1_T2V_FAST: 'Veo 3.1 - Quality',
      VEO_3_1_T2V_FAST_ULTRA: 'Veo 3.1 - Quality',
      VEO_3_1_T2V: 'Veo 3.1 - Quality',
      VEO_3_1_I2V_S_FAST: 'Veo 3.1 - Quality',
      VEO_3_1_I2V_S_FAST_PORTRAIT: 'Veo 3.1 - Quality',
      VEO_3_1_I2V_S_FAST_ULTRA: 'Veo 3.1 - Quality',
      VEO_3_1_R2V_FAST_LANDSCAPE_ULTRA: 'Veo 3.1 - Quality',
      OMNI_1_1_FLASH: 'Omni 1.1 Flash',
      NARWHAL: 'Nano Banana 2',
      HARBOR_SEAL: 'Nano Banana 2 Lite',
      GEM_PIX_2: 'Nano Banana 2 Pro',
      NANO_BANANA_2: 'Nano Banana 2',
      NANO_BANANA_LITE: 'Nano Banana 2 Lite',
      NANO_BANANA_PRO: 'Nano Banana 2 Pro',
    };

    if (MAP[u]) return MAP[u];

    const blob = `${raw} ${u}`;
    if (/LITE_LOW_PRIORITY|T2V_LITE_LOW|R2V_LITE_LOW|LOWER[_\s-]?PRIORITY/i.test(blob)) {
      return 'Veo 3.1 - Lite';
    }
    if (/LITE/i.test(blob) && /VEO|T2V|R2V|EXTEND|I2V/i.test(blob) && !/FAST/i.test(blob)) {
      return 'Veo 3.1 - Fast';
    }
    if (/FAST|I2V_S_FAST|R2V_FAST|T2V_FAST/i.test(blob) && /VEO|I2V|R2V|T2V/i.test(blob)) {
      return 'Veo 3.1 - Quality';
    }
    if (/QUALITY/i.test(blob) || (/\bVEO_3_1_T2V\b/i.test(u) && !/FAST|LITE/i.test(u))) {
      return 'Veo 3.1 - Quality';
    }
    if (/OMNI|ABRA_T2V/i.test(blob)) return 'Omni 1.1 Flash';
    if (/GEM_PIX/i.test(blob)) return 'Nano Banana 2 Pro';
    if (/NARWHAL/i.test(blob)) return 'Nano Banana 2';
    if (/HARBOR_SEAL/i.test(blob)) return 'Nano Banana 2 Lite';

    if (/^Veo 3\.1\s*-/i.test(raw) || /^Omni /i.test(raw) || /^Nano Banana/i.test(raw)) {
      return raw.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s*\[Lower Priority\]/i, '').trim();
    }
    if (/^Veo 3\.1(\s|$)/i.test(raw)) return 'Veo 3.1 - Lite';
    if (/^Imagen/i.test(raw)) return 'Nano Banana 2 Pro';

    return raw;
  }

  function resolveItemModelLabel(item) {
    const mediaType = item && item.type === 'image' ? 'image' : 'video';
    return formatModelDisplayName(
      (item && (item.model_key || item.wire_model || item.model)) || '',
      mediaType
    );
  }

  /**
   * User-facing generation errors are intentionally limited to two labels.
   * Technical detail stays in console / studio logs only.
   */
  function toUserFacingGenerationError(raw) {
    const text = String(raw == null ? '' : raw).trim();
    if (/^(stop(ped)?\s*by\s*user|cancelled( by user)?|canceled( by user)?)$/i.test(text)) {
      return 'Stop by user';
    }
    if (!text) return 'System Error';

    // Google reCAPTCHA / unusual-activity — distinct from generic System Error.
    if (/UNUSUAL_ACTIVITY|RECAPTCHA|unusual\s*activity/i.test(text)) {
      return 'Unusual activity';
    }

    // Auth / quota / model access are system-side, not policy.
    if (
      /Bearer rejected|MODEL_ACCESS_DENIED|QUOTA|WORKER RETURNED|INTERNAL SERVER|TIMEOUT|CDP|COOKIE/i.test(
        text
      )
    ) {
      return 'System Error';
    }

    const isPolicy =
      /POLICY\s*VIOLAT/i.test(text) ||
      /CONTENT[_\s-]?POLICY/i.test(text) ||
      /SAFETY[_\s-]?(FILTER|VIOLAT|BLOCK|CHECK)/i.test(text) ||
      /PUBLIC_ERROR_[A-Z0-9_]*?(UNSAFE|SAFETY|FILTER|BLOCKED|POLICY)/i.test(text) ||
      /\bRAI[_\s-]?(FILTER|BLOCK|VIOLAT|CATEGORY)/i.test(text) ||
      /FILTERED[_\s-]?(BY[_\s-]?)?(GOOGLE|SAFETY|POLICY)/i.test(text) ||
      /BLOCKED[_\s-]?(BY[_\s-]?)?(GOOGLE|SAFETY|POLICY)/i.test(text) ||
      /PROHIBITED[_\s-]?CONTENT/i.test(text) ||
      /RESPONSIBLE[_\s-]?AI/i.test(text) ||
      /violates?\s+(our\s+|google'?s?\s+)?polic/i.test(text) ||
      /unsafe\s+content/i.test(text) ||
      /not\s+allowed\s+by\s+(our\s+|google)/i.test(text) ||
      /Rejected by Google due to policy violation/i.test(text);

    return isPolicy ? 'Rejected by Google due to policy violation' : 'System Error';
  }

  function isSystemGenerationError(raw) {
    const label = toUserFacingGenerationError(raw);
    return label === 'System Error' || label === 'Unusual activity';
  }

  async function withSystemErrorRetry(fn, label) {
    const maxAttempts = 5;
    const delayMs = 2500;
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const msg = err && err.message ? err.message : String(err);
        if (/stop by user|cancelled by user/i.test(msg)) throw err;
        if (!isSystemGenerationError(msg)) throw err;
        if (attempt >= maxAttempts) break;
        console.warn(
          `[system-retry] ${label || 'generation'}: attempt ${attempt}/${maxAttempts} failed —`,
          msg
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    throw lastErr;
  }

  /**
 * Google Flow Web Studio — Frontend Application Logic
 */

(function () {
  'use strict';

  // Skip only after a successful boot (set at end of init)
  if (typeof window !== 'undefined' && window.__GFLOW_STUDIO_INIT__) {
    return;
  }

  // State Management
  const state = {
    currentTab: 'studio',
    mode: 'video', // 'video' | 'image-to-video' | 'image-to-image' | 'image'
    aspectRatio: '16:9',
    model: 'VEO_3_1_LITE',
    duration: 8,
    batchCount: 1,
    imageCount: 1,
    seed: null,
    isGenerating: false,
    activeItem: null,
    referenceImage: null, // { id, url, name, prompt, ready }
    refReadyPollTimer: null,
    extendTarget: null, // { id, prompt, url }
    extendModel: 'VEO_3_1_EXTEND_LITE',
    activeTasks: new Map(), // taskId -> { id, prompt, model, type, startTime, status, url, error }
    selectedTaskId: null,
    auth: {
      isAuthenticated: false,
      email: '',
      expiresSeconds: 0,
      simulationMode: false,
    },
    galleryFilter: 'all',
    assets: [],
    galleryLoading: false,
    galleryLoadedOnce: false,
    hiddenExpiredIds: new Set(),
    storyboardClips: [],
    activeProjectId: '',
    activeProjectUrl: '',
    projects: [],
    modelPrices: null, // { byAlias: { GEM_PIX_2: { price, walletType, ... } } }
    characters: [],
    selectedCharacterIds: new Set(),
    voicePresets: [],
    charCreateSource: 'library', // 'library' | 'upload' | 'generate'
    charLibraryAsset: null,
    charGeneratedAsset: null,
    charUploadFile: null,
    charUploadPreviewUrl: null,
    charUploadStagedId: null,
    firstFrame: null, // { id, staged_id, url, name }
    lastFrame: null, // { id, staged_id, url, name }
    frameMode: 'first_only', // 'first_only' | 'last_only' | 'first_and_last'
    ingredients: [], // [ { id, staged_id, url, name, tag } ]
    ingredientOutputType: 'video', // 'video' | 'image'
    multiRefImages: [], // [ { id, staged_id, url, name } ]
    refPickerCallback: null, // custom callback for asset picker modal
  };

  // API Base URL - all requests route to Next.js API endpoints for user/project isolation
  const API_BASE = '';
  const LABS_FLOW_BASE = 'https://flow.google.com/project';

  /** Map backend plan_name / paygate tier → UI badge (Ultra must not fall through to Pro). */
  function resolvePlanBadge(planName, paygateTier) {
    const name = String(planName || '');
    const tier = String(paygateTier || '').toUpperCase();
    if (
      /ultra/i.test(name)
      || tier === 'PAYGATE_TIER_THREE'
      || tier.includes('TIER3')
      || tier.includes('ULTRA')
    ) {
      return { label: 'Ultra', css: 'ultra' };
    }
    if (
      /pro/i.test(name)
      || tier === 'PAYGATE_TIER_TWO'
      || tier.includes('TIER2')
    ) {
      return { label: 'Pro', css: 'pro' };
    }
    if (
      /free|not_paid|freemium|unsubscribed/i.test(name + ' ' + tier)
      || tier === 'PAYGATE_TIER_ZERO'
      || tier === 'PAYGATE_TIER_NOT_PAID'
    ) {
      return { label: 'Free', css: 'free' };
    }
    if (/tier\s*1|account/i.test(name) || tier === 'PAYGATE_TIER_ONE') {
      return { label: 'Tier 1', css: 'pro' };
    }
    return { label: name.replace(/^Google AI\s*/i, '').trim() || 'Account', css: 'free' };
  }

  function projectUrl(projectId) {
    const id = String(projectId || '').split('?')[0].split('&')[0].split('#')[0].trim();
    return id ? `https://flow.google.com/project/${id}` : 'https://flow.google.com/project/';
  }

  // DOM Elements — bound in bindEls() after StudioShell is mounted (Next page)
  let els = {};
  function bindEls() {
    els = {
    // Navigation
    tabButtons: document.querySelectorAll('.nav-tab'),
    tabPanes: document.querySelectorAll('.tab-pane'),
    
    // Auth & Header
    authDot: document.getElementById('auth-status-dot'),
    authEmail: document.getElementById('auth-user-email'),
    authExp: document.getElementById('auth-token-exp'),
    authModal: document.getElementById('auth-modal'),
    openAuthModalBtn: document.getElementById('open-auth-modal-btn'),
    closeAuthModalBtn: document.getElementById('close-auth-modal-btn'),
    cancelAuthBtn: document.getElementById('cancel-auth-btn'),
    saveCookiesBtn: document.getElementById('save-cookies-btn'),
    disconnectAuthBtn: document.getElementById('disconnect-auth-btn'),
    disconnectAuthFooterBtn: document.getElementById('disconnect-auth-footer-btn'),
    cookieTextarea: document.getElementById('cookie-textarea'),
    syncLocalBtn: document.getElementById('sync-local-btn'),
    syncChromeCookiesBtn: document.getElementById('sync-chrome-cookies-btn'),
    launchBrowserBtn: document.getElementById('launch-browser-login-btn'),
    sessionHealth: document.getElementById('session-health'),
    sessionHealthTitle: document.getElementById('session-health-title'),
    sessionHealthDetail: document.getElementById('session-health-detail'),
    sessionHealthMissing: document.getElementById('session-health-missing'),
    modalStatusDot: document.getElementById('modal-status-dot'),
    modalHeading: document.getElementById('modal-status-heading'),
    modalDetail: document.getElementById('modal-status-detail'),
    simModeToggle: document.getElementById('sim-mode-toggle'),
    headerHistoryCount: document.getElementById('header-history-count'),
    creditsChip: document.getElementById('header-credits-chip'),
    creditsCount: document.getElementById('header-credits-count'),
    planBadge: document.getElementById('header-plan-badge'),
    headerProjectChip: document.getElementById('header-project-chip'),
    headerProjectName: document.getElementById('header-project-name'),
    headerProjectUrlLink: document.getElementById('header-project-url-link'),
    headerOpenProjectModalBtn: document.getElementById('header-open-project-modal-btn'),

    // Studio Creation
    modeVideoBtn: document.getElementById('mode-video-btn'),
    modeI2vBtn: document.getElementById('mode-i2v-btn'),
    modeI2iBtn: document.getElementById('mode-i2i-btn'),
    modeImageBtn: document.getElementById('mode-image-btn'),
    refImageCard: document.getElementById('ref-image-card'),
    pickRefGalleryBtn: document.getElementById('pick-ref-gallery-btn'),
    pickRefDesktopBtn: document.getElementById('pick-ref-desktop-btn'),
    refDesktopFileInput: document.getElementById('ref-desktop-file-input'),
    clearRefBtn: document.getElementById('clear-ref-btn'),
    refPlaceholder: document.getElementById('ref-placeholder'),
    refPreviewWrapper: document.getElementById('ref-preview-wrapper'),
    refPreviewImg: document.getElementById('ref-preview-img'),
    refTitle: document.getElementById('ref-title'),
    refId: document.getElementById('ref-id'),
    refReadyStatus: document.getElementById('ref-ready-status'),
    promptInput: document.getElementById('prompt-input'),
    enhancePromptBtn: document.getElementById('enhance-prompt-btn'),
    tagChips: document.querySelectorAll('.tag-chip'),
    aspectOptions: document.querySelectorAll('.aspect-option'),
    modelOptions: document.querySelectorAll('.model-option'),
    durationCol: document.getElementById('duration-control-col'),
    countCol: document.getElementById('count-control-col'),
    durationBtns: document.querySelectorAll('.duration-btn'),
    countBtns: document.querySelectorAll('.count-btn'),
    seedInput: document.getElementById('seed-input'),
    randomSeedBtn: document.getElementById('random-seed-btn'),
    triggerGenerateBtn: document.getElementById('trigger-generate-btn'),
    generateBtnText: document.getElementById('generate-btn-text'),

    // Progress Card
    liveProgressCard: document.getElementById('live-progress-card'),
    progressStageText: document.getElementById('progress-stage-text'),
    progressTimer: document.getElementById('progress-timer'),
    progressBarFill: document.getElementById('progress-bar-fill'),
    stepAuth: document.getElementById('step-auth'),
    stepRecaptcha: document.getElementById('step-recaptcha'),
    stepSubmit: document.getElementById('step-submit'),
    stepRender: document.getElementById('step-render'),

    // Stage Viewport / Media Inspector
    stageCard: document.getElementById('stage-card'),
    stageViewport: document.getElementById('stage-viewport'),
    stagePlaceholder: document.getElementById('stage-placeholder'),
    videoStageContainer: document.getElementById('video-stage-container'),
    imageStageContainer: document.getElementById('image-stage-container'),
    stageVideo: document.getElementById('stage-video'),
    stageImage: document.getElementById('stage-image'),
    stageDrawer: document.getElementById('stage-drawer'),
    stageItemName: document.getElementById('stage-item-name'),
    stageItemModel: document.getElementById('stage-item-model'),
    stageItemAspect: document.getElementById('stage-item-aspect'),
    stageItemSeed: document.getElementById('stage-item-seed'),
    stageItemPrompt: document.getElementById('stage-item-prompt'),
    stageDownloadBtn: document.getElementById('stage-download-btn'),
    stageExtendBtn: document.getElementById('stage-extend-btn'),
    stageAnimateBtn: document.getElementById('stage-animate-btn'),
    stageRemixBtn: document.getElementById('stage-remix-btn'),
    stageCopyPromptBtn: document.getElementById('stage-copy-prompt-btn'),
    stageOpenFlowBtn: document.getElementById('stage-open-flow-btn'),
    fullscreenStageBtn: document.getElementById('fullscreen-stage-btn'),

    // Extend Video Modal
    extendModal: document.getElementById('extend-modal'),
    closeExtendModalBtn: document.getElementById('close-extend-modal-btn'),
    cancelExtendBtn: document.getElementById('cancel-extend-btn'),
    submitExtendBtn: document.getElementById('submit-extend-btn'),
    extendModalVideo: document.getElementById('extend-modal-video'),
    extendModalAssetId: document.getElementById('extend-modal-asset-id'),
    extendModalPrompt: document.getElementById('extend-modal-prompt'),
    extendPromptInput: document.getElementById('extend-prompt-input'),
    extendEnhancePromptBtn: document.getElementById('extend-enhance-prompt-btn'),
    extendModelOptions: document.querySelectorAll('.extend-model-option'),

    // Reference Picker Modal
    refPickerModal: document.getElementById('ref-picker-modal'),
    closeRefPickerBtn: document.getElementById('close-ref-picker-btn'),
    cancelRefPickerBtn: document.getElementById('cancel-ref-picker-btn'),
    refLibraryGrid: document.getElementById('ref-library-grid'),

    // Storyboard
    storyboardTracks: document.getElementById('storyboard-tracks'),
    storyboardEmpty: document.getElementById('storyboard-empty-state'),
    timelineVideoPlayer: document.getElementById('timeline-video-player'),
    timelineClipDetails: document.getElementById('timeline-clip-details'),
    storyboardClearBtn: document.getElementById('storyboard-clear-btn'),
    storyboardExportBtn: document.getElementById('storyboard-export-btn'),

    // Gallery
    galleryGrid: document.getElementById('gallery-grid'),
    filterPills: document.querySelectorAll('.filter-pill'),
    galleryCountAll: document.getElementById('gallery-count-all'),
    galleryCountVideo: document.getElementById('gallery-count-video'),
    galleryCountImage: document.getElementById('gallery-count-image'),
    clearGalleryBtn: document.getElementById('clear-gallery-btn'),

    // Parallel Tasks & Sync
    headerSyncFlowBtn: document.getElementById('header-sync-flow-btn'),
    syncFlowMediaBtn: document.getElementById('sync-flow-media-btn'),
    parallelTasksBar: document.getElementById('parallel-tasks-bar'),
    parallelCount: document.getElementById('parallel-count'),
    parallelTasksList: document.getElementById('parallel-tasks-list'),

    // Studio logs
    studioLogsCard: document.getElementById('studio-logs-card'),
    studioLogsList: document.getElementById('studio-logs-list'),
    studioLogsCount: document.getElementById('studio-logs-count'),
    studioLogsEmpty: document.getElementById('studio-logs-empty'),
    studioLogsRefreshBtn: document.getElementById('studio-logs-refresh-btn'),
    studioLogsClearBtn: document.getElementById('studio-logs-clear-btn'),

    // Lightbox & Toasts
    lightboxModal: document.getElementById('lightbox-modal'),
    closeLightboxBtn: document.getElementById('close-lightbox-btn'),
    lightboxTarget: document.getElementById('lightbox-media-target'),
    toastContainer: document.getElementById('toast-container'),

    // Project Manager Modal
    projectModal: document.getElementById('project-modal'),
    closeProjectModalBtn: document.getElementById('close-project-modal-btn'),
    closeProjectModalFooterBtn: document.getElementById('close-project-modal-footer-btn'),
    activeProjectFlowLink: document.getElementById('active-project-flow-link'),
    activeProjectNameDisplay: document.getElementById('active-project-name-display'),
    activeProjectUrlDisplay: document.getElementById('active-project-url-display'),
    copyProjectUrlBtn: document.getElementById('copy-project-url-btn'),
    newProjectNameInput: document.getElementById('new-project-name-input'),
    submitCreateProjectBtn: document.getElementById('submit-create-project-btn'),
    refreshProjectsBtn: document.getElementById('refresh-projects-btn'),
    projectsListContainer: document.getElementById('projects-list-container'),

    // First & Last Frame Controls
    frameControlsCard: document.getElementById('frame-controls-card'),
    fmodeFirstBtn: document.getElementById('fmode-first-btn'),
    fmodeLastBtn: document.getElementById('fmode-last-btn'),
    fmodeBothBtn: document.getElementById('fmode-both-btn'),
    firstFrameSlot: document.getElementById('first-frame-slot'),
    lastFrameSlot: document.getElementById('last-frame-slot'),
    firstFrameEmpty: document.getElementById('first-frame-empty'),
    firstFramePreview: document.getElementById('first-frame-preview'),
    firstFrameImg: document.getElementById('first-frame-img'),
    firstFrameName: document.getElementById('first-frame-name'),
    clearFirstFrameBtn: document.getElementById('clear-first-frame-btn'),
    pickFirstGalleryBtn: document.getElementById('pick-first-gallery-btn'),
    pickFirstUploadBtn: document.getElementById('pick-first-upload-btn'),
    firstFrameFileInput: document.getElementById('first-frame-file-input'),

    lastFrameEmpty: document.getElementById('last-frame-empty'),
    lastFramePreview: document.getElementById('last-frame-preview'),
    lastFrameImg: document.getElementById('last-frame-img'),
    lastFrameName: document.getElementById('last-frame-name'),
    clearLastFrameBtn: document.getElementById('clear-last-frame-btn'),
    pickLastGalleryBtn: document.getElementById('pick-last-gallery-btn'),
    pickLastUploadBtn: document.getElementById('pick-last-upload-btn'),
    lastFrameFileInput: document.getElementById('last-frame-file-input'),

    // Ingredient Mode
    modeIngredientsBtn: document.getElementById('mode-ingredients-btn'),
    ingredientsCard: document.getElementById('ingredients-card'),
    ingTypeVideoBtn: document.getElementById('ing-type-video-btn'),
    ingTypeImageBtn: document.getElementById('ing-type-image-btn'),
    ingredientsSlotsGrid: document.getElementById('ingredients-slots-grid'),
    addIngredientBtn: document.getElementById('add-ingredient-btn'),
    pickIngredientLibraryBtn: document.getElementById('pick-ingredient-library-btn'),
    clearAllIngredientsBtn: document.getElementById('clear-all-ingredients-btn'),
    ingredientFileInput: document.getElementById('ingredient-file-input'),

    // Multi-Image Reference Tray
    multiRefTray: document.getElementById('multi-ref-tray'),
    multiRefCount: document.getElementById('multi-ref-count'),
    multiRefItems: document.getElementById('multi-ref-items'),
    addMoreRefBtn: document.getElementById('add-more-ref-btn'),

    // Characters Sync
    syncCharactersBtn: document.getElementById('sync-characters-btn'),

    // Characters (Studio picker + Characters tab)
    charactersCard: document.getElementById('characters-card'),
    charactersList: document.getElementById('characters-list'),
    charactersEmpty: document.getElementById('characters-empty'),
    refreshCharactersBtn: document.getElementById('refresh-characters-btn'),
    clearCharactersBtn: document.getElementById('clear-characters-btn'),
    charactersSelectedNames: document.getElementById('characters-selected-names'),
    openCharactersTabBtn: document.getElementById('open-characters-tab-btn'),
    refreshCharactersPageBtn: document.getElementById('refresh-characters-page-btn'),
    charactersPageList: document.getElementById('characters-page-list'),
    charactersPageCount: document.getElementById('characters-page-count'),
    charCreateNameInput: document.getElementById('char-create-name-input'),
    charCreateVoiceSelect: document.getElementById('char-create-voice-select'),
    charCreateSubmitBtn: document.getElementById('char-create-submit-btn'),
    charCreateSubmitLabel: document.getElementById('char-create-submit-label'),
    charSourceLibraryBtn: document.getElementById('char-source-library-btn'),
    charSourceGenerateBtn: document.getElementById('char-source-generate-btn'),
    charSourceUploadBtn: document.getElementById('char-source-upload-btn'),
    charLibraryFields: document.getElementById('char-library-fields'),
    charUploadFields: document.getElementById('char-upload-fields'),
    charGenerateFields: document.getElementById('char-generate-fields'),
    charOpenLibraryBtn: document.getElementById('char-open-library-btn'),
    charLibraryFilename: document.getElementById('char-library-filename'),
    charLibraryPreviewCard: document.getElementById('char-library-preview-card'),
    charLibraryPreviewImg: document.getElementById('char-library-preview-img'),
    charLibraryPreviewTitle: document.getElementById('char-library-preview-title'),
    charChangeLibraryBtn: document.getElementById('char-change-library-btn'),
    charRemoveLibraryBtn: document.getElementById('char-remove-library-btn'),
    charPortraitPromptInput: document.getElementById('char-portrait-prompt-input'),
    charQuickGeneratePortraitBtn: document.getElementById('char-quick-generate-portrait-btn'),
    charGenerateStatus: document.getElementById('char-generate-status'),
    charGeneratePreview: document.getElementById('char-generate-preview'),
    charGeneratePreviewImg: document.getElementById('char-generate-preview-img'),
    charGeneratePreviewTitle: document.getElementById('char-generate-preview-title'),
    charDiscardGeneratedBtn: document.getElementById('char-discard-generated-btn'),
    charUploadFileInput: document.getElementById('char-upload-file-input'),
    charPickUploadBtn: document.getElementById('char-pick-upload-btn'),
    charUploadFilename: document.getElementById('char-upload-filename'),
    charUploadPreview: document.getElementById('char-upload-preview'),
    charUploadPreviewImg: document.getElementById('char-upload-preview-img'),
    };
    return Boolean(els.triggerGenerateBtn && els.promptInput);
  }

  // ---------------------------------------------------------------------------
  // INITIALIZATION
  // ---------------------------------------------------------------------------
  function ensureStudioUserCookie() {
    if (typeof document === 'undefined') return;
    if (!document.cookie.includes('studio_user=') && !document.cookie.includes('saas_token=')) {
      const anonId = 'usr_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
      document.cookie = `studio_user=${anonId}; path=/; max-age=${365 * 24 * 60 * 60}; SameSite=Lax`;
    }
  }

  function waitForShellDom(maxAttempts, delayMs) {
    return new Promise((resolve) => {
      let n = 0;
      const tick = () => {
        if (
          document.getElementById('trigger-generate-btn') &&
          document.getElementById('prompt-input')
        ) {
          resolve(true);
          return;
        }
        n += 1;
        if (n >= maxAttempts) {
          resolve(false);
          return;
        }
        setTimeout(tick, delayMs);
      };
      tick();
    });
  }

  function markStudioShellReady() {
    try {
      document.documentElement.classList.remove('studio-booting');
      document.documentElement.classList.add('studio-ready');
      document.documentElement.classList.add('theme-flow-dark');
      document.body.classList.add('theme-flow-dark');
      const skel = document.getElementById('studio-boot-skeleton');
      if (skel) skel.setAttribute('aria-hidden', 'true');
    } catch (_) {}
  }

  /** Prefer Flow image CDN twin as poster when video URL is known. */
  function videoPosterFromItem(item) {
    if (!item) return '';
    const thumb = item.thumbnail_url || item.thumbnailUrl || item.poster || '';
    if (thumb && /^https?:\/\//i.test(thumb)) return thumb;
    const url = String(item.url || item.upscaled_url || '');
    if (/flow-content\.google\/video\//i.test(url)) {
      return url.replace(/\/video\//i, '/image/');
    }
    return '';
  }

  function videoSrcWithFrameHint(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    if (/#t=/i.test(raw)) return raw;
    return `${raw}#t=0.1`;
  }

  /** Paint first frame without requiring hover (mobile + desktop). */
  function ensureVideoPosterFrame(vid) {
    if (!vid || vid.dataset.frameBound === '1') return;
    vid.dataset.frameBound = '1';
    vid.classList.add('is-painting');
    vid.muted = true;
    vid.playsInline = true;
    vid.setAttribute('playsinline', '');
    vid.setAttribute('webkit-playsinline', '');

    const reveal = () => {
      vid.classList.remove('is-painting');
      vid.classList.add('is-frame-ready');
    };

    const seekPaint = () => {
      try {
        if (!Number.isFinite(vid.currentTime) || vid.currentTime < 0.05) {
          const t = Math.min(0.12, (vid.duration && Number.isFinite(vid.duration) ? vid.duration * 0.02 : 0.12) || 0.12);
          vid.currentTime = t > 0 ? t : 0.1;
        }
      } catch (_) {}
    };

    const onReady = () => {
      seekPaint();
      try {
        vid.pause();
      } catch (_) {}
      reveal();
    };

    vid.addEventListener('loadeddata', onReady, { once: true });
    vid.addEventListener('seeked', reveal, { once: true });
    vid.addEventListener(
      'loadedmetadata',
      () => {
        seekPaint();
      },
      { once: true }
    );

    // Kick decode on mobile Safari / Chrome where metadata alone won't paint
    const p = vid.play();
    if (p && typeof p.then === 'function') {
      p.then(() => {
        try {
          vid.pause();
        } catch (_) {}
        seekPaint();
        reveal();
      }).catch(() => {
        // Autoplay blocked — still try seek after metadata
        if (vid.readyState >= 1) seekPaint();
        setTimeout(reveal, 400);
      });
    } else {
      setTimeout(reveal, 500);
    }
  }

  function renderGallerySkeleton(count = 8) {
    if (!els.galleryGrid) return;
    const n = Math.max(4, Math.min(12, count));
    els.galleryGrid.innerHTML = Array.from({ length: n })
      .map(
        () => `
      <article class="flow-media-card is-skeleton aspect-16-9" aria-hidden="true">
        <div class="card-media-wrapper"></div>
      </article>`
      )
      .join('');
  }

  async function init() {
    const shellReady = await waitForShellDom(40, 50);
    if (!shellReady || !bindEls()) {
      console.error('[Studio] DOM bind failed — Generate UI not wired');
      if (typeof window !== 'undefined') window.__GFLOW_STUDIO_INIT__ = false;
      markStudioShellReady();
      return;
    }
    if (typeof window !== 'undefined') {
      window.__GFLOW_STUDIO_INIT__ = true;
    }

    ensureStudioUserCookie();

    // Read projectId / project from URL (supports Launch ?project= and iframe embeds)
    try {
      const urlParams = new URLSearchParams(window.location.search);
      let qPid = urlParams.get('projectId') || urlParams.get('project');
      if (!qPid && window.parent && window.parent !== window) {
        try {
          const parentParams = new URLSearchParams(window.parent.location.search);
          qPid = parentParams.get('projectId') || parentParams.get('project');
        } catch (_) {}
      }
      if (qPid && qPid.trim()) {
        state.activeProjectId = qPid.trim();
      }
    } catch (_) {}

    setupEventListeners();
    setStudioMode(state.mode);
    // Instant fast load
    loadModelPrices();
    setInterval(() => loadModelPrices(), 30_000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') loadModelPrices();
    });
    fetchAuthStatus();
    loadCharacters();
    loadAssets();
    fetchProjects();
    loadVoicePresets();
    setCharCreateSource('generate');
    startCountdownTimer();
    loadStudioLogs();
    startStudioLogsPolling();
    initOfficialFlowLayout();
    applyAdminToolGates();

    // Restore Studio page from URL (refresh keeps storyteller/whisk/etc.)
    restoreStudioViewFromUrl({ replaceUrl: true });
    markStudioShellReady();
    if (!window.__GFLOW_STUDIO_POPSTATE__) {
      window.__GFLOW_STUDIO_POPSTATE__ = true;
      window.addEventListener('popstate', () => {
        const parsed = parseStudioPath(window.location.pathname);
        setActiveNavForView(parsed.view, parsed.filter);
        switchFlowView(parsed.view, parsed.filter, { skipNav: true, skipUrl: true });
      });
    }

    // SaaS Profile & Credits Polling
    updateHeaderCredits();
    updateHeaderProfile();
    setInterval(updateHeaderCredits, 8000);

    // Soft refresh only while something is actively working — patch those cards, don't rebuild all
    setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const busy =
        state.activeTasks.size > 0 ||
        (state.activeUpscales && state.activeUpscales.size > 0) ||
        (state.assets || []).some((a) =>
          a.status === 'PROCESSING' || a.status === 'IN_QUEUE' || a.status === 'PREPARING' || a.status === 'GENERATING'
        );
      if (!busy) return;
      loadAssets({ silent: true });
    }, 5000);
  }

  async function updateHeaderCredits() {
    try {
      const res = await fetch('/api/wallet');
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.wallets) {
        const stdEl = document.getElementById('header-std-credits');
        const proEl = document.getElementById('header-pro-credits');
        if (stdEl && data.wallets.standard !== undefined) {
          const avail = data.wallets.standard.available !== undefined ? data.wallets.standard.available : data.wallets.standard;
          stdEl.textContent = avail;
        }
        if (proEl && data.wallets.pro !== undefined) {
          const avail = data.wallets.pro.available !== undefined ? data.wallets.pro.available : data.wallets.pro;
          proEl.textContent = avail;
          state.proCreditsAvailable = Number(avail) || 0;
        }
        applyProModelLocks();
      }
    } catch (e) {
      console.warn('Failed to refresh header credits:', e);
    }
  }

  async function updateHeaderProfile() {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) return;
      const data = await res.json();
      if (data.authenticated && data.user) {
        const badge = document.getElementById('header-plan-badge');
        if (badge && data.user.plan) {
          badge.textContent = data.user.plan.toUpperCase();
        }
        state.studioPlanName = data.user.plan || 'Free';
        if (data.user.wallets?.pro) {
          state.proCreditsAvailable = Number(data.user.wallets.pro.available ?? 0) || 0;
        }
        applyProModelLocks();
        const projEl = document.getElementById('header-project-name');
        if (projEl && (projEl.textContent === 'Project Loading...' || !projEl.textContent || projEl.textContent === 'Default Project')) {
          const activeProj = state.activeProjectId ? state.projects.find(p => p.id === state.activeProjectId) : state.projects[0];
          projEl.textContent = activeProj?.name || (state.projects[0]?.name || 'Studio Workspace');
        }
      }
    } catch (e) {
      console.warn('Failed to fetch user profile:', e);
    }
  }

  const PRO_CREDIT_MODELS = new Set([
    'VEO_3_1_LITE',
    'VEO_3_1_FAST',
    'VEO_3_1_QUALITY',
    'OMNI_1_1_FLASH',
  ]);

  function planAllowsUpscale() {
    const plan = String(state.studioPlanName || '').toLowerCase();
    return plan === 'pro' || plan === 'business';
  }

  function applyProModelLocks() {
    const proLeft = Number(state.proCreditsAvailable) || 0;
    const lockTitle = 'Pro credits exhausted — top up or pick a Standard model';
    const selects = [
      document.getElementById('popover-model-select'),
      document.getElementById('btv-model-select'),
      document.getElementById('biv-model-select'),
    ].filter(Boolean);

    selects.forEach((modelSelect) => {
      [...modelSelect.options].forEach((opt) => {
        if (!PRO_CREDIT_MODELS.has(opt.value)) {
          opt.disabled = false;
          opt.title = '';
          return;
        }
        const locked = proLeft <= 0;
        opt.disabled = locked;
        opt.title = locked ? lockTitle : '';
      });
    });

    const popoverSelect = document.getElementById('popover-model-select');
    if (popoverSelect && PRO_CREDIT_MODELS.has(state.model) && proLeft <= 0) {
      state.model = 'VEO_3_1_LITE';
      popoverSelect.value = state.model;
      updateCreditCostDisplay();
      updateParamPillSummary();
    }

    const btvSelect = document.getElementById('btv-model-select');
    if (btvSelect && PRO_CREDIT_MODELS.has(btvSelect.value) && proLeft <= 0) {
      btvSelect.value = 'VEO_3_1_LITE';
      if (typeof window.__gflowBulkT2VOnModelLock === 'function') {
        window.__gflowBulkT2VOnModelLock();
      }
    }

    const bivSelect = document.getElementById('biv-model-select');
    if (bivSelect && PRO_CREDIT_MODELS.has(bivSelect.value) && proLeft <= 0) {
      bivSelect.value = 'VEO_3_1_LITE';
      if (typeof window.__gflowBulkI2VOnModelLock === 'function') {
        window.__gflowBulkI2VOnModelLock();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // EVENT LISTENERS
  // ---------------------------------------------------------------------------
  function setupEventListeners() {
    // Navigation Tabs
    els.tabButtons.forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Auth Modal (guarded for SaaS users)
    if (els.openAuthModalBtn) els.openAuthModalBtn.addEventListener('click', openAuthModal);
    if (els.closeAuthModalBtn) els.closeAuthModalBtn.addEventListener('click', closeAuthModal);
    if (els.cancelAuthBtn) els.cancelAuthBtn.addEventListener('click', closeAuthModal);
    if (els.saveCookiesBtn) els.saveCookiesBtn.addEventListener('click', handleSaveCookies);
    if (els.syncLocalBtn) els.syncLocalBtn.addEventListener('click', handleSyncLocalAuth);
    if (els.syncChromeCookiesBtn) els.syncChromeCookiesBtn.addEventListener('click', handleSyncChromeCookies);
    if (els.launchBrowserBtn) els.launchBrowserBtn.addEventListener('click', handleLaunchBrowserLogin);
    // Simulation mode removed from Studio UI — do not wire sim toggle
    if (els.disconnectAuthBtn) els.disconnectAuthBtn.addEventListener('click', handleDisconnectAccount);
    if (els.disconnectAuthFooterBtn) els.disconnectAuthFooterBtn.addEventListener('click', handleDisconnectAccount);

    const planTierSelect = document.getElementById('plan-tier-select');
    if (planTierSelect) {
      planTierSelect.addEventListener('change', async () => {
        try {
          const res = await fetch(`${API_BASE}/api/auth/tier`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tier: planTierSelect.value }),
          });
          const data = await res.json();
          if (data.success) {
            showToast(`Plan tier override set to: ${planTierSelect.value}`, 'success');
            await fetchAuthStatus();
          } else {
            showToast(`Failed to update tier: ${data.detail || 'Unknown error'}`, 'error');
          }
        } catch (err) {
          showToast(`Error updating tier: ${err.message}`, 'error');
        }
      });
    }

    // Studio Mode Switcher
    if (els.modeVideoBtn) els.modeVideoBtn.addEventListener('click', () => setStudioMode('video'));
    if (els.modeI2vBtn) els.modeI2vBtn.addEventListener('click', () => setStudioMode('image-to-video'));
    if (els.modeI2iBtn) els.modeI2iBtn.addEventListener('click', () => setStudioMode('image-to-image'));
    if (els.modeImageBtn) els.modeImageBtn.addEventListener('click', () => setStudioMode('image'));

    // Reference Image Controls
    if (els.pickRefGalleryBtn) els.pickRefGalleryBtn.addEventListener('click', openRefPickerModal);
    if (els.pickRefDesktopBtn && els.refDesktopFileInput) {
      els.pickRefDesktopBtn.addEventListener('click', () => els.refDesktopFileInput.click());
      els.refDesktopFileInput.addEventListener('change', handleDesktopRefUpload);
    }
    if (els.clearRefBtn) els.clearRefBtn.addEventListener('click', clearReferenceImage);
    if (els.closeRefPickerBtn) els.closeRefPickerBtn.addEventListener('click', closeRefPickerModal);
    if (els.cancelRefPickerBtn) els.cancelRefPickerBtn.addEventListener('click', closeRefPickerModal);
    if (els.refPickerModal) {
      els.refPickerModal.addEventListener('click', (e) => {
        if (e.target === els.refPickerModal) closeRefPickerModal();
      });
    }

    // Aspect Ratio
    els.aspectOptions.forEach(opt => {
      opt.addEventListener('click', () => {
        els.aspectOptions.forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        state.aspectRatio = opt.dataset.aspect;
      });
    });

    // Model Selector — mode tabs are authoritative; only select compatible models
    els.modelOptions.forEach(opt => {
      opt.addEventListener('click', () => {
        const modes = (opt.dataset.mode || '').split(/\s+/).filter(Boolean);
        const isVideoTarget = state.mode === 'video' || state.mode === 'image-to-video' || (state.mode === 'ingredients' && state.ingredientOutputType !== 'image');
        const isImageTarget = state.mode === 'image' || state.mode === 'image-to-image' || (state.mode === 'ingredients' && state.ingredientOutputType === 'image');
        const isCompatible = modes.length === 0 ||
          modes.includes(state.mode) ||
          (isVideoTarget && modes.some(m => m.includes('video'))) ||
          (isImageTarget && modes.some(m => m.includes('image')));
        if (!isCompatible) {
          showToast('That model is not available in the current generation mode.', 'warning');
          return;
        }
        selectModelOption(opt);
      });
    });

    // Duration Picker
    els.durationBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        els.durationBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.duration = parseInt(btn.dataset.duration, 10);
      });
    });

    // Count Picker
    els.countBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        els.countBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.imageCount = parseInt(btn.dataset.count, 10);
      });
    });

    // Seed Randomizer
    els.randomSeedBtn.addEventListener('click', () => {
      const r = Math.floor(Math.random() * 900000) + 100000;
      els.seedInput.value = r;
      state.seed = r;
    });

    els.seedInput.addEventListener('input', () => {
      const v = parseInt(els.seedInput.value, 10);
      state.seed = isNaN(v) ? null : v;
    });

    // Prompt Enhancer
    els.enhancePromptBtn.addEventListener('click', handleEnhancePrompt);

    // Style Tag Chips
    els.tagChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const text = chip.dataset.tag;
        if (els.promptInput.value.trim()) {
          els.promptInput.value += `, ${text}`;
        } else {
          els.promptInput.value = text;
        }
      });
    });

    // Primary Generate
    if (els.triggerGenerateBtn) {
      els.triggerGenerateBtn.addEventListener('click', triggerGeneration);
    }

    if (els.studioLogsRefreshBtn) {
      els.studioLogsRefreshBtn.addEventListener('click', () => loadStudioLogs());
    }
    if (els.studioLogsClearBtn) {
      els.studioLogsClearBtn.addEventListener('click', clearStudioLogs);
    }

    // Keyboard shortcut (Ctrl+Enter or Cmd+Enter)
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        triggerGeneration();
      }
    });

    // Stage Actions
    els.stageDownloadBtn.addEventListener('click', handleDownloadStageAsset);
    els.stageCopyPromptBtn.addEventListener('click', () => {
      if (state.activeItem && state.activeItem.prompt) {
        navigator.clipboard.writeText(state.activeItem.prompt);
        showToast('Prompt copied to clipboard!', 'success');
      }
    });
    if (els.stageExtendBtn) {
      els.stageExtendBtn.addEventListener('click', () => handleExtendVideo(state.activeItem));
    }
    if (els.stageAnimateBtn) {
      els.stageAnimateBtn.addEventListener('click', () => {
        if (state.activeItem) {
          addAssetAsPromptReference(state.activeItem);
        }
      });
    }
    if (els.stageRemixBtn) {
      els.stageRemixBtn.addEventListener('click', () => {
        if (state.activeItem) {
          state.family = 'image';
          setStudioMode('image-to-image');
          addAssetAsPromptReference(state.activeItem);
        }
      });
    }
    els.fullscreenStageBtn.addEventListener('click', () => {
      if (state.activeItem) openLightbox(state.activeItem);
    });

    // Extend Modal Actions
    if (els.closeExtendModalBtn) els.closeExtendModalBtn.addEventListener('click', closeExtendModal);
    if (els.cancelExtendBtn) els.cancelExtendBtn.addEventListener('click', closeExtendModal);
    if (els.extendModal) {
      els.extendModal.addEventListener('click', (e) => {
        if (e.target === els.extendModal) closeExtendModal();
      });
    }
    if (els.submitExtendBtn) els.submitExtendBtn.addEventListener('click', handleExecuteExtend);
    if (els.extendEnhancePromptBtn) els.extendEnhancePromptBtn.addEventListener('click', handleEnhanceExtendPrompt);
    if (els.extendModelOptions) {
      els.extendModelOptions.forEach(opt => {
        opt.addEventListener('click', () => {
          els.extendModelOptions.forEach(o => o.classList.remove('active'));
          opt.classList.add('active');
          state.extendModel = opt.dataset.model;
        });
      });
    }

    // Gallery Filters
    els.filterPills.forEach(pill => {
      pill.addEventListener('click', () => {
        els.filterPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        state.galleryFilter = pill.dataset.filter;
        renderGallery();
      });
    });

    els.clearGalleryBtn.addEventListener('click', handleClearGallery);
    if (els.headerSyncFlowBtn) {
      els.headerSyncFlowBtn.addEventListener('click', handleSyncFlowMedia);
    }
    if (els.syncFlowMediaBtn) {
      els.syncFlowMediaBtn.addEventListener('click', handleSyncFlowMedia);
    }

    // Storyboard Actions
    els.storyboardClearBtn.addEventListener('click', () => {
      state.storyboardClips = [];
      renderStoryboard();
      showToast('Storyboard cleared', 'info');
    });

    els.storyboardExportBtn.addEventListener('click', handleExportStoryboard);

    // Lightbox
    els.closeLightboxBtn.addEventListener('click', closeLightbox);
    els.lightboxModal.addEventListener('click', (e) => {
      if (e.target === els.lightboxModal) closeLightbox();
    });

    // Project Manager Modal
    if (els.headerOpenProjectModalBtn) els.headerOpenProjectModalBtn.addEventListener('click', openProjectModal);
    if (els.closeProjectModalBtn) els.closeProjectModalBtn.addEventListener('click', closeProjectModal);
    if (els.closeProjectModalFooterBtn) els.closeProjectModalFooterBtn.addEventListener('click', closeProjectModal);
    if (els.projectModal) {
      els.projectModal.addEventListener('click', (e) => {
        if (e.target === els.projectModal) closeProjectModal();
      });
    }
    if (els.copyProjectUrlBtn) {
      els.copyProjectUrlBtn.addEventListener('click', () => {
        const urlToCopy = state.activeProjectUrl || projectUrl(state.activeProjectId);
        navigator.clipboard.writeText(urlToCopy);
        showToast('Google Flow project URL copied to clipboard!', 'success');
      });
    }
    if (els.submitCreateProjectBtn) {
      els.submitCreateProjectBtn.addEventListener('click', handleCreateProject);
    }
    if (els.newProjectNameInput) {
      els.newProjectNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleCreateProject();
        }
      });
    }
    if (els.refreshProjectsBtn) {
      els.refreshProjectsBtn.addEventListener('click', async () => {
        els.refreshProjectsBtn.disabled = true;
        els.refreshProjectsBtn.classList.add('spinning');
        await fetchProjects(true);
        els.refreshProjectsBtn.disabled = false;
        els.refreshProjectsBtn.classList.remove('spinning');
        showToast('Projects refreshed from Google Flow', 'info');
      });
    }

    // Characters
    if (els.openCharactersTabBtn) {
      els.openCharactersTabBtn.addEventListener('click', () => switchTab('characters'));
    }
    if (els.refreshCharactersBtn) {
      els.refreshCharactersBtn.addEventListener('click', async () => {
        els.refreshCharactersBtn.disabled = true;
        await loadCharacters();
        els.refreshCharactersBtn.disabled = false;
        showToast('Characters refreshed', 'info');
      });
    }
    if (els.refreshCharactersPageBtn) {
      els.refreshCharactersPageBtn.addEventListener('click', async () => {
        els.refreshCharactersPageBtn.disabled = true;
        await loadCharacters();
        els.refreshCharactersPageBtn.disabled = false;
        showToast('Characters refreshed', 'info');
      });
    }
    if (els.clearCharactersBtn) {
      els.clearCharactersBtn.addEventListener('click', () => {
        state.selectedCharacterIds.forEach(id => {
          const c = state.characters.find(char => (char.character_id || char.entity_id || char.id) === id);
          if (c) removeCharacterFromPrompt(c.display_name || c.name);
        });
        state.selectedCharacterIds.clear();
        renderCharactersList();
        renderCharactersPageList();
        updateSelectedCharactersBar();
        updatePromptAttachedDisplay();
        updateGenerateButtonState();
      });
    }
    if (els.charSourceLibraryBtn) {
      els.charSourceLibraryBtn.addEventListener('click', () => setCharCreateSource('library'));
    }
    if (els.charSourceUploadBtn) {
      els.charSourceUploadBtn.addEventListener('click', () => setCharCreateSource('upload'));
    }
    if (els.charSourceGenerateBtn) {
      els.charSourceGenerateBtn.addEventListener('click', () => setCharCreateSource('generate'));
    }
    if (els.charOpenLibraryBtn) {
      els.charOpenLibraryBtn.addEventListener('click', openCharacterLibraryPicker);
    }
    if (els.charChangeLibraryBtn) {
      els.charChangeLibraryBtn.addEventListener('click', openCharacterLibraryPicker);
    }
    if (els.charRemoveLibraryBtn) {
      els.charRemoveLibraryBtn.addEventListener('click', clearCharacterLibrarySelection);
    }
    if (els.charQuickGeneratePortraitBtn) {
      els.charQuickGeneratePortraitBtn.addEventListener('click', handleQuickGeneratePortrait);
    }
    if (els.charDiscardGeneratedBtn) {
      els.charDiscardGeneratedBtn.addEventListener('click', discardGeneratedPortrait);
    }
    if (els.charPickUploadBtn && els.charUploadFileInput) {
      els.charPickUploadBtn.addEventListener('click', () => els.charUploadFileInput.click());
      els.charUploadFileInput.addEventListener('change', handleCharUploadFileChange);
    }
    if (els.charCreateSubmitBtn) {
      els.charCreateSubmitBtn.addEventListener('click', handleCreateCharacterFromTab);
    }
    if (els.charCreateNameInput) {
      els.charCreateNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleCreateCharacterFromTab();
        }
      });
    }

    // Character Sync
    if (els.syncCharactersBtn) {
      els.syncCharactersBtn.addEventListener('click', handleSyncCharacters);
    }

    // Mode Ingredients button
    if (els.modeIngredientsBtn) {
      els.modeIngredientsBtn.addEventListener('click', () => setStudioMode('ingredients'));
    }
    initFrameControls();
    initIngredientControls();
    initMultiRefControls();
  }

  // ---------------------------------------------------------------------------
  // GOOGLE FLOW PROJECT MANAGEMENT
  // ---------------------------------------------------------------------------
  async function fetchProjects(forceRefresh = false) {
    try {
      const url = `${API_BASE}/api/projects${forceRefresh ? '?refresh=true' : ''}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      state.projects = data.projects || [];

      // Reconcile activeProjectId with real user database projects
      const currentFound = state.activeProjectId
        ? state.projects.find(p => p.id === state.activeProjectId)
        : null;

      if (!currentFound && state.projects.length > 0) {
        state.activeProjectId = data.active_project_id || state.projects[0].id;
      } else if (!state.activeProjectId && data.active_project_id) {
        state.activeProjectId = data.active_project_id;
      }
      state.activeProjectUrl = data.active_project_url || (state.activeProjectId ? projectUrl(state.activeProjectId) : '');
      updateProjectUI();
    } catch (e) {
      console.warn('Failed to fetch projects:', e);
    }
  }

  function updateProjectUI() {
    let found = state.activeProjectId
      ? state.projects.find(p => p.id === state.activeProjectId)
      : null;

    // Fallback to first user project if activeProjectId is invalid or from upstream Google account
    if (!found && state.projects && state.projects.length > 0) {
      found = state.projects[0];
      state.activeProjectId = found.id;
      state.activeProjectUrl = found.url || projectUrl(found.id);
    }

    const activeName = (found && found.name)
      ? found.name
      : (state.projects && state.projects[0] && state.projects[0].name ? state.projects[0].name : 'Studio Workspace');

    // Header chip
    if (state.activeProjectId || found) {
      if (els.headerProjectName) {
        els.headerProjectName.textContent = activeName;
      }
      if (els.headerProjectUrlLink) {
        els.headerProjectUrlLink.href = state.activeProjectUrl || projectUrl(state.activeProjectId);
      }
    }

    // Modal elements
    if (els.activeProjectNameDisplay) {
      els.activeProjectNameDisplay.textContent = activeName;
      els.activeProjectNameDisplay.title = activeName;
    }
    if (els.activeProjectUrlDisplay) {
      const displayUrl = state.activeProjectUrl || projectUrl(state.activeProjectId);
      els.activeProjectUrlDisplay.textContent = displayUrl;
      els.activeProjectUrlDisplay.href = displayUrl;
      els.activeProjectUrlDisplay.title = displayUrl;
    }
    if (els.activeProjectFlowLink) {
      els.activeProjectFlowLink.href = state.activeProjectUrl || projectUrl(state.activeProjectId);
    }

    // Stage drawer open flow button
    if (els.stageOpenFlowBtn) {
      const targetUrl = (state.activeItem && state.activeItem.project_url) || state.activeProjectUrl || 'https://flow.google.com/project/';
      els.stageOpenFlowBtn.href = targetUrl;
    }

    renderProjectsList();
  }

  function formatProjectIdShort(id) {
    if (!id || typeof id !== 'string') return '';
    if (id.length <= 16) return id;
    return `${id.slice(0, 8)}…${id.slice(-4)}`;
  }

  function renderProjectsList() {
    if (!els.projectsListContainer) return;
    els.projectsListContainer.innerHTML = '';

    if (!state.projects || state.projects.length === 0) {
      els.projectsListContainer.innerHTML = `
        <div class="projects-list-empty">
          No projects recorded yet. Create one above.
        </div>
      `;
      return;
    }

    state.projects.forEach(proj => {
      const isCurrent = proj.id === state.activeProjectId;
      const shortId = formatProjectIdShort(proj.id);
      const row = document.createElement('div');
      row.className = `project-list-row ${isCurrent ? 'active' : ''}`;
      row.innerHTML = `
        <div class="project-info">
          <div class="project-name-line">
            <span class="project-status-dot ${isCurrent ? 'active' : ''}"></span>
            <strong title="${(proj.name || 'Google Flow Project').replace(/"/g, '&quot;')}">${proj.name || 'Google Flow Project'}</strong>
            ${isCurrent ? '<span class="project-active-badge">Active</span>' : ''}
          </div>
          <span class="project-id-text" title="${proj.id || ''}">${shortId}</span>
        </div>
        <div class="project-actions">
          <a href="${proj.url || projectUrl(proj.id)}" target="_blank" rel="noopener noreferrer" class="flow-link-btn" title="Open in Google Flow">
            <span>Flow</span>
          </a>
          ${!isCurrent ? `
            <button type="button" class="project-switch-action-btn" data-id="${proj.id}">
              Switch
            </button>
          ` : ''}
        </div>
      `;

      const switchBtn = row.querySelector('.project-switch-action-btn');
      if (switchBtn) {
        switchBtn.addEventListener('click', () => handleSwitchProject(proj.id));
      }

      els.projectsListContainer.appendChild(row);
    });
  }

  function openProjectModal() {
    if (els.projectModal) els.projectModal.classList.remove('hidden');
    fetchProjects();
  }

  function closeProjectModal() {
    if (els.projectModal) els.projectModal.classList.add('hidden');
  }

  async function handleCreateProject() {
    const input = els.newProjectNameInput;
    const name = input ? input.value.trim() : '';

    if (state.activeProjectId) {
      const ok = window.confirm(
        '⚠️ WARNING: Only 1 project workspace is allowed per user.\n\nCreating a new project will permanently delete your current workspace and all its generated videos, images, and characters.\n\nDo you want to permanently delete the current project and proceed?'
      );
      if (!ok) return;
    }

    if (els.submitCreateProjectBtn) {
      els.submitCreateProjectBtn.disabled = true;
      els.submitCreateProjectBtn.innerHTML = '<span>Creating…</span>';
    }

    try {
      const res = await fetch(`${API_BASE}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name || undefined }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to create project');
      }

      const data = await res.json();
      const proj = data.project || {
        id: data.project_id || data.active_project_id,
        name: data.name || (data.project_id ? `Project ${data.project_id.slice(0, 8)}` : 'New Project'),
        url: data.project_url || data.active_project_url,
      };
      showToast(`Created & switched to project: ${proj.name || proj.id}`, 'success');
      state.activeProjectId = proj.id;
      state.activeProjectUrl = proj.url;
      if (input) input.value = '';

      // Clear all active/pending tasks and UI progress cards for fresh workspace
      state.activeTasks.clear();
      state.assets = [];
      if (els.galleryGrid) {
        els.galleryGrid.innerHTML = '';
      }
      if (typeof window.whiskReset === 'function') {
        window.whiskReset();
      }

      closeProjectModal();
      updateHeaderCredits();
      await fetchProjects();
      await loadAssets();
      await loadCharacters();
    } catch (e) {
      console.error('Create project error:', e);
      showToast(`Could not create project: ${e.message}`, 'error');
    } finally {
      if (els.submitCreateProjectBtn) {
        els.submitCreateProjectBtn.disabled = false;
        els.submitCreateProjectBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span>Create &amp; Switch</span>
        `;
      }
    }
  }

  async function handleSwitchProject(projectId) {
    try {
      const res = await fetch(`${API_BASE}/api/projects/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to switch project');
      }

      const data = await res.json();
      const proj = data.project || {
        id: data.project_id || data.active_project_id,
        name: data.name || (data.active_project_id ? `Project ${data.active_project_id.slice(0, 8)}` : 'Active Project'),
        url: data.project_url || data.active_project_url,
      };
      state.activeProjectId = proj.id;
      state.activeProjectUrl = proj.url;
      state.selectedCharacterIds.clear();
      showToast(`Switched active workspace to ${proj.name || proj.id}`, 'success');
      closeProjectModal();
      await fetchProjects();
      await loadAssets();
      await loadCharacters();
    } catch (e) {
      console.error('Switch project error:', e);
      showToast(`Could not switch project: ${e.message}`, 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // TAB NAVIGATION
  // ---------------------------------------------------------------------------
  function switchTab(tabId) {
    state.currentTab = tabId;
    els.tabButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    els.tabPanes.forEach(pane => {
      pane.classList.toggle('active', pane.id === `pane-${tabId}`);
    });

    if (tabId === 'gallery') {
      loadAssets();
    } else if (tabId === 'storyboard') {
      renderStoryboard();
    } else if (tabId === 'characters') {
      loadCharacters();
      if (!state.voicePresets.length) loadVoicePresets();
    }
  }

  function sameAttachedAsset(a, b) {
    if (!a || !b) return false;
    if (a.id && b.id && String(a.id) === String(b.id)) return true;
    if (a.staged_id && b.staged_id && String(a.staged_id) === String(b.staged_id)) return true;
    if (a.url && b.url && String(a.url) === String(b.url)) return true;
    return false;
  }

  function assetAlreadyInList(list, asset) {
    return (list || []).some((item) => sameAttachedAsset(item, asset));
  }

  /** Image refs ↔ video ingredients — one attachment must never live in both lists. */
  function migrateAttachmentsForFamily(nextFamily) {
    const toVideo = nextFamily === 'video';
    const toImage = nextFamily === 'image';
    if (!toVideo && !toImage) return;

    if (toVideo) {
      const sources = [];
      (state.multiRefImages || []).forEach((img) => {
        if (img && img.url && !assetAlreadyInList(sources, img)) sources.push(img);
      });
      if (state.referenceImage && state.referenceImage.url && !assetAlreadyInList(sources, state.referenceImage)) {
        sources.push(state.referenceImage);
      }

      if (sources.length) {
        state.ingredients = state.ingredients || [];
        const tags = ['@Character', '@Prop', '@Style'];
        sources.forEach((src) => {
          if (state.ingredients.length >= 3) return;
          if (assetAlreadyInList(state.ingredients, src)) return;
          state.ingredients.push({
            id: src.id || null,
            staged_id: src.staged_id || null,
            url: src.url || '',
            name: src.name || src.prompt || 'Ingredient',
            tag: tags[state.ingredients.length] || `@Asset${state.ingredients.length + 1}`,
          });
        });
        if (state.ingredients.length > 0 && state.videoSubmode !== 'frames') {
          state.videoSubmode = 'ingredients';
        }
      }

      state.multiRefImages = [];
      state.referenceImage = null;
      stopReferenceReadyPoll();
      if (els.refPlaceholder) els.refPlaceholder.classList.remove('hidden');
      if (els.refPreviewWrapper) els.refPreviewWrapper.classList.add('hidden');
      if (els.refPreviewImg) els.refPreviewImg.src = '';
      if (els.clearRefBtn) els.clearRefBtn.classList.add('hidden');
      setReferenceReadyStatus('idle');
      if (typeof renderIngredientsGrid === 'function') renderIngredientsGrid();
      if (typeof renderMultiRefTray === 'function') renderMultiRefTray();
      return;
    }

    // Video → Image: ingredients become image refs (not both)
    const sources = (state.ingredients || []).filter((ing) => ing && ing.url);
    if (sources.length) {
      state.multiRefImages = state.multiRefImages || [];
      sources.forEach((src) => {
        if (state.multiRefImages.length >= 7) return;
        if (assetAlreadyInList(state.multiRefImages, src)) return;
        state.multiRefImages.push({
          id: src.id || null,
          staged_id: src.staged_id || null,
          url: src.url || '',
          name: src.name || 'Reference',
          prompt: src.name || '',
        });
      });
      if (state.multiRefImages.length > 0 && !state.referenceImage) {
        state.referenceImage = { ...state.multiRefImages[0], ready: true };
      }
    }
    state.ingredients = [];
    if (state.videoSubmode === 'ingredients') state.videoSubmode = null;
    if (typeof renderIngredientsGrid === 'function') renderIngredientsGrid();
    if (typeof renderMultiRefTray === 'function') renderMultiRefTray();
  }

  function setStudioMode(mode) {
    state.mode = mode;
    if (els.modeVideoBtn) els.modeVideoBtn.classList.toggle('active', mode === 'video');
    if (els.modeI2vBtn) els.modeI2vBtn.classList.toggle('active', mode === 'image-to-video');
    if (els.modeI2iBtn) els.modeI2iBtn.classList.toggle('active', mode === 'image-to-image');
    if (els.modeImageBtn) els.modeImageBtn.classList.toggle('active', mode === 'image');
    if (els.modeIngredientsBtn) els.modeIngredientsBtn.classList.toggle('active', mode === 'ingredients');

    // Reference Image Card visibility
    if (els.refImageCard) {
      if (mode === 'image-to-video' || mode === 'image-to-image') {
        els.refImageCard.classList.remove('hidden');
      } else {
        els.refImageCard.classList.add('hidden');
      }
    }

    // First & Last Frame Card visibility (keep hidden, we use inline prompt box controls)
    if (els.frameControlsCard) {
      els.frameControlsCard.classList.add('hidden');
    }

    // Ingredient Mode Card — retired UI. Ingredients attach via prompt chips /
    // library picks only; never slide this drawer open.
    if (els.ingredientsCard) {
      els.ingredientsCard.classList.add('hidden');
    }

    // Multi-reference tray (in Image-to-Image mode)
    if (els.multiRefTray) {
      if (mode === 'image-to-image') {
        els.multiRefTray.classList.remove('hidden');
      } else {
        els.multiRefTray.classList.add('hidden');
      }
    }

    // Duration vs Count controls
    if (mode === 'video' || mode === 'image-to-video') {
      els.durationCol.classList.remove('hidden');
      els.countCol.classList.add('hidden');
    } else {
      els.durationCol.classList.add('hidden');
      els.countCol.classList.remove('hidden');
    }

    // Button Labels
    if (mode === 'video') {
      els.generateBtnText.textContent = (state.firstFrame && state.lastFrame) ? 'Generate Transition Video' : 'Generate Video';
    } else if (mode === 'image-to-video') {
      els.generateBtnText.textContent = (state.firstFrame && state.lastFrame) ? 'Generate Transition Video' : 'Animate Video (I2V)';
    } else if (mode === 'image-to-image') {
      els.generateBtnText.textContent = (state.multiRefImages && state.multiRefImages.length > 1) ? `Remix ${state.multiRefImages.length} Images` : 'Edit Image (I2I)';
    } else if (mode === 'ingredients') {
      els.generateBtnText.textContent = state.ingredientOutputType === 'image' ? 'Synthesize Image from Ingredients' : 'Synthesize Video from Ingredients';
    } else {
      els.generateBtnText.textContent = 'Generate Image';
    }

    filterModelsByMode(mode);
    ensureModelForMode(mode);
    updatePromptFramesDisplay();
    updatePromptAttachedDisplay();
    updateIngredientsTooltipDisplay();
    updateCreditCostDisplay();

    // Refresh ready-label wording when switching between I2V / I2I
    if (state.referenceImage && state.referenceImage.ready) {
      setReferenceReadyStatus('ready');
    }
    syncPopoverWithMode(state.family);
    updateGenerateButtonState();
  }

  function updateDurationOptionsForModel(model) {
    const currentModel = model || state.model || 'VEO_3_1_LITE';
    const isOmni = (currentModel === 'OMNI_1_1_FLASH');
    const dur10Btn = document.querySelector('#popover-duration-row .popover-pill-btn[data-dur="10"]') || document.getElementById('popover-dur-10s-btn');
    if (dur10Btn) {
      dur10Btn.style.display = isOmni ? '' : 'none';
    }
    if (!isOmni && state.duration === 10) {
      state.duration = 8;
      document.querySelectorAll('#popover-duration-row .popover-pill-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.dur === '8');
      });
    }
  }

  function selectModelOption(opt) {
    if (!opt) return;
    els.modelOptions.forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
    state.model = opt.dataset.model;
    const modelSelect = document.getElementById('popover-model-select');
    if (modelSelect && opt.dataset.model) {
      modelSelect.value = opt.dataset.model;
    }
    updateDurationOptionsForModel(state.model);
    updateCreditCostDisplay();
    updateParamPillSummary();
  }

  function filterModelsByMode(mode) {
    let hasActiveVisible = false;
    let firstVisibleOpt = null;

    const targetMode = mode === 'ingredients'
      ? (state.ingredientOutputType === 'image' ? 'image' : 'video')
      : mode;

    els.modelOptions.forEach(opt => {
      const modeAttr = opt.dataset.mode || '';
      const modesList = modeAttr.split(/\s+/).filter(Boolean);
      const isVideoFamily = targetMode === 'video' || targetMode === 'image-to-video';
      const isImageFamily = targetMode === 'image' || targetMode === 'image-to-image';
      const match = modesList.includes(targetMode) || modesList.includes(mode) ||
        (isVideoFamily && modesList.some(m => m.includes('video'))) ||
        (isImageFamily && modesList.some(m => m.includes('image')));
      opt.style.display = match ? 'flex' : 'none';
      if (match) {
        if (!firstVisibleOpt) firstVisibleOpt = opt;
        if (opt.classList.contains('active')) {
          hasActiveVisible = true;
        }
      }
    });

    if (!hasActiveVisible && firstVisibleOpt) {
      selectModelOption(firstVisibleOpt);
    }
  }

  /** Keep selected model compatible with the current mode without changing mode. */
  function ensureModelForMode(mode) {
    const isVideoFamily = mode === 'video' || mode === 'image-to-video' || (mode === 'ingredients' && state.ingredientOutputType !== 'image');
    const isImageFamily = mode === 'image' || mode === 'image-to-image' || (mode === 'ingredients' && state.ingredientOutputType === 'image');
    
    const videoModels = ['VEO_3_1_LITE', 'VEO_3_1_FAST', 'VEO_3_1_QUALITY', 'OMNI_1_1_FLASH'];
    const imageModels = ['GEM_PIX_2', 'NARWHAL', 'HARBOR_SEAL'];

    if (isVideoFamily) {
      if (!state.model || !videoModels.includes(state.model)) {
        state.model = 'VEO_3_1_LITE';
      }
    } else if (isImageFamily) {
      if (!state.model || !imageModels.includes(state.model)) {
        state.model = 'GEM_PIX_2';
      }
    }

    const modelSelect = document.getElementById('popover-model-select');
    if (modelSelect && state.model) {
      modelSelect.value = state.model;
    }

    const videoOptgroup = document.getElementById('popover-optgroup-video');
    const imageOptgroup = document.getElementById('popover-optgroup-image');
    if (videoOptgroup && imageOptgroup) {
      videoOptgroup.style.display = isVideoFamily ? '' : 'none';
      imageOptgroup.style.display = isImageFamily ? '' : 'none';
    }

    const activeOpt = [...els.modelOptions].find(o => o.dataset.model === state.model);
    if (activeOpt) {
      els.modelOptions.forEach(o => o.classList.remove('active'));
      activeOpt.classList.add('active');
    }

    updateDurationOptionsForModel(state.model);
    updateCreditCostDisplay();
    updateParamPillSummary();
    return state.model;
  }

  function syncPopoverWithMode(family) {
    const prevFamily = state.family || (state.mode === 'image' || state.mode === 'image-to-image' ? 'image' : 'video');
    state.family = family || (state.mode === 'image' || state.mode === 'image-to-image' ? 'image' : 'video');
    const isImage = state.family === 'image';

    if (prevFamily !== state.family) {
      migrateAttachmentsForFamily(state.family);
    }

    const popModeImg = document.getElementById('popover-mode-image-btn');
    const popModeVid = document.getElementById('popover-mode-video-btn');
    const videoSubmodes = document.getElementById('popover-video-submodes');
    const durationRow = document.getElementById('popover-duration-row');
    const modelSelect = document.getElementById('popover-model-select');

    if (popModeImg) popModeImg.classList.toggle('active', isImage);
    if (popModeVid) popModeVid.classList.toggle('active', !isImage);

    if (videoSubmodes) {
      videoSubmodes.classList.toggle('hidden', isImage);
      videoSubmodes.style.display = isImage ? 'none' : 'flex';
      const subFramesBtn = document.getElementById('param-sub-frames-btn');
      const subIngBtn = document.getElementById('param-sub-ingredients-btn');
      if (subFramesBtn) subFramesBtn.classList.toggle('active', !isImage && state.videoSubmode === 'frames');
      if (subIngBtn) subIngBtn.classList.toggle('active', !isImage && state.videoSubmode === 'ingredients');
    }
    if (durationRow) {
      durationRow.classList.toggle('hidden', isImage);
      durationRow.style.display = isImage ? 'none' : 'flex';
    }

    // Aspect Ratio Cards:
    // Video mode: strictly ONLY 16:9 and 9:16 (2 wide cards, matching Image 1)
    // Image mode: ALL FIVE (16:9, 4:3, 1:1, 3:4, 9:16, matching Image 2)
    ['4-3', '1-1', '3-4'].forEach(id => {
      const el = document.getElementById(`popover-aspect-${id}`);
      if (el) {
        el.classList.toggle('hidden', !isImage);
        el.style.display = isImage ? 'flex' : 'none';
      }
    });

    if (!isImage && state.aspectRatio !== '16:9' && state.aspectRatio !== '9:16') {
      state.aspectRatio = '16:9';
    }

    // Update active highlight on all aspect cards
    document.querySelectorAll('.popover-aspect-card').forEach(card => {
      card.classList.toggle('active', card.dataset.aspect === state.aspectRatio);
    });

    // Filter Popover Model Select options:
    if (modelSelect) {
      const optGroupVideo = document.getElementById('popover-optgroup-video');
      const optGroupImage = document.getElementById('popover-optgroup-image');
      if (optGroupVideo) optGroupVideo.style.display = isImage ? 'none' : '';
      if (optGroupImage) optGroupImage.style.display = isImage ? '' : 'none';

      if (isImage) {
        if (!state.model || (!state.model.includes('banana') && state.model !== 'GEM_PIX_2' && state.model !== 'NARWHAL' && state.model !== 'HARBOR_SEAL')) {
          state.model = 'GEM_PIX_2';
        }
        modelSelect.value = state.model;
      } else {
        if (state.model === 'GEM_PIX_2' || state.model === 'NARWHAL' || state.model === 'HARBOR_SEAL') {
          state.model = 'VEO_3_1_LITE';
        }
        modelSelect.value = state.model || 'VEO_3_1_LITE';
      }
    }

    updateDurationOptionsForModel(state.model);
    updateCreditCostDisplay();
    updatePromptFramesDisplay();
    updatePromptAttachedDisplay();
    updateParamPillSummary();
  }

  async function loadModelPrices() {
    try {
      const res = await fetch('/api/model-prices', { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.byAlias) {
        state.modelPrices = data;
        updateCreditCostDisplay();
      }
    } catch (e) {
      console.warn('Failed to load model prices:', e);
    }
  }

  function lookupModelPrice(modelKey, isImageFamily) {
    const defaults = isImageFamily
      ? { GEM_PIX_2: 5, NARWHAL: 3, HARBOR_SEAL: 2, _wallet: 'Standard' }
      : {
          VEO_3_1_LITE: 15,
          VEO_3_1_FAST: 40,
          VEO_3_1_QUALITY: 150,
          OMNI_1_1_FLASH: 20,
          _walletLite: 'Standard',
          _walletPro: 'Pro',
        };

    const u = String(modelKey || '')
      .toUpperCase()
      .replace(/-/g, '_')
      .replace(/\s+/g, '_');
    const byAlias = (state.modelPrices && state.modelPrices.byAlias) || {};
    const hit =
      byAlias[u] ||
      byAlias[u.toLowerCase()] ||
      byAlias[String(modelKey || '').toLowerCase()];

    if (hit && typeof hit.price === 'number') {
      return {
        price: hit.price,
        walletLabel: String(hit.walletType || 'STANDARD') === 'PRO' ? 'Pro' : 'Standard',
      };
    }

    if (isImageFamily) {
      if (u === 'GEM_PIX_2' || u.includes('PRO')) return { price: defaults.GEM_PIX_2, walletLabel: 'Standard' };
      if (u === 'HARBOR_SEAL' || (u.includes('LITE') && u.includes('BANANA'))) {
        return { price: defaults.HARBOR_SEAL, walletLabel: 'Standard' };
      }
      if (u === 'NARWHAL' || u.includes('BANANA')) return { price: defaults.NARWHAL, walletLabel: 'Standard' };
      return { price: defaults.GEM_PIX_2, walletLabel: 'Standard' };
    }

    if (u === 'VEO_3_1_LITE' || u.includes('LOW_PRIORITY')) {
      return { price: defaults.VEO_3_1_LITE, walletLabel: 'Standard' };
    }
    if (u === 'OMNI_1_1_FLASH' || u.includes('OMNI')) {
      return { price: defaults.OMNI_1_1_FLASH, walletLabel: 'Pro' };
    }
    if (u === 'VEO_3_1_FAST') return { price: defaults.VEO_3_1_FAST, walletLabel: 'Pro' };
    if (u === 'VEO_3_1_QUALITY') return { price: defaults.VEO_3_1_QUALITY, walletLabel: 'Pro' };
    return { price: defaults.VEO_3_1_LITE, walletLabel: 'Standard' };
  }

  function updateCreditCostDisplay() {
    const creditsNum = document.getElementById('credits-cost-number');
    if (!creditsNum) return;
    const count = state.batchCount || 1;
    const model = (state.model || 'VEO_3_1_LITE').toUpperCase();
    const isImageFamily = state.mode === 'image' || state.mode === 'image-to-image' || (state.mode === 'ingredients' && state.ingredientOutputType === 'image');
    const { price: cost, walletLabel } = lookupModelPrice(model, isImageFamily);
    const totalCost = cost * count;
    creditsNum.textContent = `${totalCost} ${walletLabel} credit${totalCost === 1 ? '' : 's'}`;
  }

  function updatePromptFramesDisplay() {
    const inlineFrames = document.getElementById('prompt-frames-inline');
    const startBtn = document.getElementById('prompt-start-frame-btn');
    const endBtn = document.getElementById('prompt-end-frame-btn');
    const closeBtn = document.getElementById('prompt-box-clear-attached-btn');
    const attachBtnWrap = document.getElementById('attach-btn-wrap');
    if (!inlineFrames) return;

    // Frames are STRICTLY for Video mode (never Image generation!)
    const isVideoFamily = state.family !== 'image' && state.mode !== 'image' && state.mode !== 'image-to-image';
    const subFramesBtn = document.getElementById('param-sub-frames-btn');
    const isFramesActive = subFramesBtn && subFramesBtn.classList.contains('active');
    const hasFrameSet = Boolean(state.firstFrame || state.lastFrame);

    const showInlineFrames = isVideoFamily && (isFramesActive || hasFrameSet);

    inlineFrames.classList.toggle('hidden', !showInlineFrames);

    // In Frames mode, hide the (+) attach button (Image 3: only Agent is shown on bottom left)
    if (attachBtnWrap) {
      attachBtnWrap.classList.toggle('hidden', showInlineFrames);
    }

    if (startBtn) {
      if (state.firstFrame && state.firstFrame.url) {
        startBtn.innerHTML = `<img class="prompt-frame-thumb" src="${state.firstFrame.url}" alt="Start" />`;
      } else {
        startBtn.innerHTML = `<span id="prompt-start-frame-label">Start</span>`;
      }
    }
    if (endBtn) {
      if (state.lastFrame && state.lastFrame.url) {
        endBtn.innerHTML = `<img class="prompt-frame-thumb" src="${state.lastFrame.url}" alt="End" />`;
      } else {
        endBtn.innerHTML = `<span id="prompt-end-frame-label">End</span>`;
      }
    }

    if (closeBtn && showInlineFrames && (state.firstFrame || state.lastFrame)) {
      closeBtn.classList.remove('hidden');
    }
  }

  function updatePromptAttachedDisplay() {
    const previewsContainer = document.getElementById('prompt-attached-previews');
    const closeBtn = document.getElementById('prompt-box-clear-attached-btn');
    const isVideoFamily = state.family !== 'image' && state.mode !== 'image' && state.mode !== 'image-to-image';
    const subFramesBtn = document.getElementById('param-sub-frames-btn');
    const isFramesActive = subFramesBtn && subFramesBtn.classList.contains('active');
    const isFramesMode = isVideoFamily && (isFramesActive || Boolean(state.firstFrame || state.lastFrame));

    if (previewsContainer) {
      previewsContainer.innerHTML = '';
      let hasAnyPreview = false;

      // 1. Show Character Previews for all selected characters (up to 4)
      if (state.selectedCharacterIds && state.selectedCharacterIds.size > 0) {
        state.selectedCharacterIds.forEach(id => {
          const c = state.characters.find(char => {
            const localId = char.character_id || char.entity_id || char.id;
            const traits = char.traits && typeof char.traits === 'object' ? char.traits : {};
            const flowId =
              char.flow_entity_id ||
              traits.flow_entity_id ||
              char.flow_character_id ||
              null;
            return localId === id || flowId === id;
          });
          const name = (c && (c.display_name || c.name)) || 'Character';
          const imgUrl = (c && (c.image_url || (c.character && c.character.image_url))) || '';

          const chip = document.createElement('div');
          chip.className = 'prompt-preview-chip character-chip';
          chip.title = `${name} (Character)`;
          chip.innerHTML = `
            <div class="prompt-preview-thumb">
              ${imgUrl ? `<img src="${imgUrl}" alt="${escapeHtml(name)}" />` : `<span class="prompt-preview-avatar-letter">${escapeHtml(name[0] || 'C').toUpperCase()}</span>`}
            </div>
            <span class="prompt-preview-chip-label">${escapeHtml(name)}</span>
            <button type="button" class="prompt-preview-remove-btn" title="Remove character">✕</button>
          `;
          chip.querySelector('.prompt-preview-remove-btn').addEventListener('click', (ev) => {
            ev.stopPropagation();
            state.selectedCharacterIds.delete(id);
            if (els.promptInput) {
              removeCharacterFromPrompt(name);
            }
            updateSelectedCharactersBar();
            renderCharactersList();
            renderCharactersPageList();
            updatePromptAttachedDisplay();
            updateGenerateButtonState();
          });
          previewsContainer.appendChild(chip);
          hasAnyPreview = true;
        });
      }

      // 2. Image-mode reference chips only (never alongside video ingredients)
      if (!isFramesMode && !isVideoFamily) {
        const refList = state.multiRefImages && state.multiRefImages.length > 0 
          ? state.multiRefImages 
          : (state.referenceImage && state.referenceImage.url ? [state.referenceImage] : []);

        refList.forEach((r, idx) => {
          if (!r || !r.url) return;
          const chip = document.createElement('div');
          chip.className = 'prompt-preview-chip ref-chip';
          chip.title = `Reference Image ${idx + 1}`;
          chip.innerHTML = `
            <div class="prompt-preview-thumb">
              <img src="${r.url}" alt="Ref ${idx + 1}" />
            </div>
            <span class="prompt-preview-chip-label">Ref ${idx + 1}</span>
            <button type="button" class="prompt-preview-remove-btn" title="Remove reference">✕</button>
          `;
          chip.querySelector('.prompt-preview-remove-btn').addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (state.multiRefImages && state.multiRefImages.length > 0) {
              const index = state.multiRefImages.indexOf(r);
              if (index >= 0) state.multiRefImages.splice(index, 1);
              if (state.multiRefImages.length === 0) clearReferenceImage();
            } else {
              clearReferenceImage();
            }
            updatePromptAttachedDisplay();
            updateParamPillSummary();
          });
          previewsContainer.appendChild(chip);
          hasAnyPreview = true;
        });
      }

      // 3. Video ingredients chips only (never alongside image Ref chips)
      if (!isFramesMode && isVideoFamily && state.ingredients && state.ingredients.length > 0) {
        state.ingredients.forEach((ing, idx) => {
          if (!ing || !ing.url) return;
          const chip = document.createElement('div');
          chip.className = 'prompt-preview-chip ing-chip';
          chip.title = `${ing.tag || `Ingredient ${idx + 1}`}`;
          chip.innerHTML = `
            <div class="prompt-preview-thumb">
              <img src="${ing.url}" alt="${escapeHtml(ing.name || 'Ingredient')}" />
            </div>
            <span class="prompt-preview-chip-label">${escapeHtml(ing.tag || `Ing ${idx + 1}`)}</span>
            <button type="button" class="prompt-preview-remove-btn" title="Remove ingredient">✕</button>
          `;
          chip.querySelector('.prompt-preview-remove-btn').addEventListener('click', (ev) => {
            ev.stopPropagation();
            const index = state.ingredients.indexOf(ing);
            if (index >= 0) state.ingredients.splice(index, 1);
            renderIngredientsGrid();
            updatePromptAttachedDisplay();
            updateParamPillSummary();
          });
          previewsContainer.appendChild(chip);
          hasAnyPreview = true;
        });
      }

      previewsContainer.classList.toggle('hidden', !hasAnyPreview);
    }

    if (closeBtn) {
      const hasAny = (state.selectedCharacterIds && state.selectedCharacterIds.size > 0) ||
                     (state.multiRefImages && state.multiRefImages.length > 0) ||
                     (state.referenceImage && state.referenceImage.url) ||
                     (state.ingredients && state.ingredients.length > 0) ||
                     (state.firstFrame || state.lastFrame);
      closeBtn.classList.toggle('hidden', !hasAny);
    }
  }

  function updateIngredientsTooltipDisplay() {
    const tooltip = document.getElementById('ingredients-tooltip');
    if (tooltip) tooltip.remove();
  }

  function isImageFamilyMode(mode) {
    return mode === 'image' || mode === 'image-to-image';
  }

  function needsReadyReference(mode) {
    return mode === 'image-to-image';
  }

  function hasSelectedCharacters() {
    return state.selectedCharacterIds && state.selectedCharacterIds.size > 0;
  }

  function getSelectedCharactersPayload() {
    if (!hasSelectedCharacters()) return null;
    const payload = [];
    for (const c of state.characters) {
      const localId = c.character_id || c.entity_id || c.id;
      const traits = c.traits && typeof c.traits === 'object' ? c.traits : {};
      const flowId =
        c.flow_entity_id ||
        c.flow_character_id ||
        traits.flow_entity_id ||
        traits.flow_character_id ||
        null;
      const selected =
        (localId && state.selectedCharacterIds.has(localId)) ||
        (flowId && state.selectedCharacterIds.has(flowId));
      if (!selected) continue;
      // Flow structured refs require the Google Flow entity id (C4BZMd), not studio local uuid
      const entityId = flowId || null;
      if (!entityId) {
        // Still include so prepare/ensure can create the Flow entity before dispatch
        payload.push({
          entity_id: localId,
          character_id: localId,
          flow_entity_id: null,
          name: c.display_name || c.name || 'Character',
          image_media_id: c.image_media_id || traits.image_media_id || null,
          image_url: c.image_url || c.portraitUrl || traits.image_url || null,
          local_image_path: traits.local_image_path || c.local_image_path || null,
          _needs_flow_entity: true,
        });
      } else {
        payload.push({
          entity_id: entityId,
          character_id: localId || entityId,
          flow_entity_id: entityId,
          name: c.display_name || c.name || 'Character',
          image_media_id: c.image_media_id || traits.image_media_id || null,
          image_url: c.image_url || c.portraitUrl || traits.image_url || null,
          local_image_path: traits.local_image_path || c.local_image_path || null,
        });
      }
      if (payload.length >= 4) break;
    }
    return payload.length ? payload : null;
  }

  function updateGenerateButtonState() {
    if (!els.triggerGenerateBtn) return;
    const ref = state.referenceImage;
    const hasChars = hasSelectedCharacters();
    const hasStaged = !!(ref && ref.staged_id);
    const hasFlowReady = !!(ref && ref.id && ref.ready !== false && !String(ref.id).startsWith('staged-'));
    const hasMulti = Array.isArray(state.multiRefImages) && state.multiRefImages.length > 0;

    let blocked = false;
    // Video generation is NEVER blocked by lack of frames or ingredients.
    // Text-to-video, frames, ingredients, and character video are all natively supported.
    if (state.mode === 'image-to-image') {
      blocked = !hasFlowReady && !hasStaged && !hasChars && !hasMulti;
    }

    if (!state.isGenerating) {
      els.triggerGenerateBtn.disabled = Boolean(blocked);
    }
  }

  function setReferenceReadyStatus(phase, detail) {
    if (!els.refReadyStatus) return;
    els.refReadyStatus.classList.remove('is-uploading', 'is-processing', 'is-ready', 'is-error', 'is-staged');
    const labels = {
      uploading: 'Uploading to Flow…',
      processing: 'Processing in Flow…',
      ready: state.mode === 'image-to-image' ? 'Ready to remix' : 'Ready to animate',
      staged: 'Staged locally — uploads on Generate',
      error: detail || 'Not ready',
      idle: '',
    };
    els.refReadyStatus.textContent = labels[phase] || detail || '';
    if (phase === 'uploading') els.refReadyStatus.classList.add('is-uploading');
    else if (phase === 'processing') els.refReadyStatus.classList.add('is-processing');
    else if (phase === 'ready') els.refReadyStatus.classList.add('is-ready');
    else if (phase === 'staged') els.refReadyStatus.classList.add('is-staged');
    else if (phase === 'error') els.refReadyStatus.classList.add('is-error');
    if (phase === 'idle') els.refReadyStatus.textContent = '';
  }

  function stopReferenceReadyPoll() {
    if (state.refReadyPollTimer) {
      clearInterval(state.refReadyPollTimer);
      state.refReadyPollTimer = null;
    }
  }

  async function pollReferenceReady(mediaId, { maxAttempts = 40, intervalMs = 1500 } = {}) {
    stopReferenceReadyPoll();
    if (!mediaId) return false;

    setReferenceReadyStatus('processing');
    if (state.referenceImage && state.referenceImage.id === mediaId) {
      state.referenceImage.ready = false;
    }
    updateGenerateButtonState();

    const checkOnce = async () => {
      const res = await fetch(`${API_BASE}/api/assets/${encodeURIComponent(mediaId)}/ready`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Ready check failed');
      return data;
    };

    // Immediate check (covers gallery picks / already-ready uploads)
    try {
      const first = await checkOnce();
      if (first.ready) {
        if (state.referenceImage && state.referenceImage.id === mediaId) {
          state.referenceImage.ready = true;
          if (first.url && !String(first.url).startsWith('data:')) {
            state.referenceImage.url = first.url;
            if (els.refPreviewImg) els.refPreviewImg.src = first.url;
          }
        }
        setReferenceReadyStatus('ready');
        updateGenerateButtonState();
        return true;
      }
    } catch (e) {
      console.warn('Initial media ready check failed:', e);
    }

    return await new Promise((resolve) => {
      let attempts = 0;
      state.refReadyPollTimer = setInterval(async () => {
        attempts += 1;
        try {
          const data = await checkOnce();
          if (data.ready) {
            stopReferenceReadyPoll();
            if (state.referenceImage && state.referenceImage.id === mediaId) {
              state.referenceImage.ready = true;
              if (data.url && !String(data.url).startsWith('data:')) {
                state.referenceImage.url = data.url;
                if (els.refPreviewImg) els.refPreviewImg.src = data.url;
              }
            }
            setReferenceReadyStatus('ready');
            updateGenerateButtonState();
            showToast('Reference image ready in Flow!', 'success');
            resolve(true);
            return;
          }
        } catch (err) {
          console.warn('Media ready poll error:', err);
        }
        if (attempts >= maxAttempts) {
          stopReferenceReadyPoll();
          setReferenceReadyStatus('error', 'Still processing — retry shortly');
          updateGenerateButtonState();
          showToast('Flow is still processing the image. Wait a moment, then try again.', 'warning');
          resolve(false);
        }
      }, intervalMs);
    });
  }

  // ---------------------------------------------------------------------------
  // AUTHENTICATION & SESSION
  // ---------------------------------------------------------------------------
  async function fetchAuthStatus() {
    try {
      const res = await fetch(`${API_BASE}/api/auth/status`);
      const data = await res.json();
      state.auth = {
        isAuthenticated: data.is_authenticated,
        email: data.email || 'Not Connected',
        expiresSeconds: data.expires_seconds || 0,
        simulationMode: data.simulation_mode || false,
        credits: data.credits !== undefined && data.credits !== null ? data.credits : null,
        paygateTier: data.paygate_tier || 'PAYGATE_TIER_TWO',
        planName: data.plan_name || 'Google AI Pro',
        tierOverride: data.tier_override || null,
        sku: data.sku || '',
      };

      if (els.creditsCount) {
        els.creditsCount.textContent = (state.auth.credits !== null && state.auth.credits !== undefined) ? state.auth.credits : '--';
      }

      if (els.planBadge) {
        const plan = resolvePlanBadge(state.auth.planName, state.auth.paygateTier);
        els.planBadge.textContent = plan.label;
        els.planBadge.className = `plan-badge-pill ${plan.css}`;
      }

      if (els.creditsChip) {
        els.creditsChip.title = `${state.auth.planName} credits for ${state.auth.email}`;
      }

      // Do NOT overwrite state.activeProjectId from upstream Google account provider status!
      // The user workspace project is strictly managed by /api/projects.

      updateAuthUI();
    } catch (e) {
      console.warn('Could not fetch auth status:', e);
      state.auth.isAuthenticated = false;
      state.auth.email = 'Offline / Error';
      updateAuthUI();
    }
  }

  function updateAuthUI() {
    // Header
    if (state.auth.isAuthenticated) {
      if (els.authDot) els.authDot.className = 'status-indicator';
      if (els.authEmail) els.authEmail.textContent = state.auth.email;
      const avatarLetterEl = document.getElementById('header-avatar-letter');
      if (avatarLetterEl && state.auth.email) {
        avatarLetterEl.textContent = state.auth.email.trim()[0].toUpperCase();
      }
      const planBadgeEl = document.getElementById('header-plan-badge');
      if (planBadgeEl) {
        const plan = resolvePlanBadge(state.auth.planName, state.auth.paygateTier);
        planBadgeEl.textContent = plan.label.toUpperCase();
      }
    } else if (state.auth.simulationMode) {
      if (els.authDot) els.authDot.className = 'status-indicator warning';
      if (els.authEmail) els.authEmail.textContent = 'Simulation Mode';
      const planBadgeEl = document.getElementById('header-plan-badge');
      if (planBadgeEl) planBadgeEl.textContent = 'SIM';
    } else {
      if (els.authDot) els.authDot.className = 'status-indicator offline';
      if (els.authEmail) els.authEmail.textContent = 'Connect Cookies';
      const avatarLetterEl = document.getElementById('header-avatar-letter');
      if (avatarLetterEl) avatarLetterEl.textContent = '?';
    }

    // Legacy auth modal controls — optional in the Next Studio shell.
    if (els.simModeToggle) {
      els.simModeToggle.checked = !!state.auth.simulationMode;
    }

    // Modal
    if (state.auth.isAuthenticated) {
      if (els.modalStatusDot) els.modalStatusDot.className = 'status-indicator';
      if (els.modalHeading) els.modalHeading.textContent = `Connected: ${state.auth.email}`;
      if (els.modalDetail) {
        els.modalDetail.textContent = `Plan: ${state.auth.planName} • Credits: ${state.auth.credits !== null && state.auth.credits !== undefined ? state.auth.credits : '--'}`;
      }
      if (els.disconnectAuthBtn) els.disconnectAuthBtn.classList.remove('hidden');
      if (els.disconnectAuthFooterBtn) els.disconnectAuthFooterBtn.classList.remove('hidden');

      const planTierSelect = document.getElementById('plan-tier-select');
      if (planTierSelect) {
        planTierSelect.value = state.auth.tierOverride || 'auto';
      }
      const detectedPlanBadge = document.getElementById('detected-plan-badge');
      if (detectedPlanBadge) {
        const plan = resolvePlanBadge(state.auth.planName, state.auth.paygateTier);
        detectedPlanBadge.textContent = plan.label;
        detectedPlanBadge.className = `plan-badge-pill ${plan.css}`;
      }
      const detectedPlanText = document.getElementById('detected-plan-text');
      if (detectedPlanText) {
        const skuInfo = state.auth.sku ? ` • SKU: ${state.auth.sku}` : '';
        detectedPlanText.textContent = `${state.auth.planName} (${state.auth.paygateTier || 'Unknown'}${skuInfo})`;
      }
    } else {
      if (els.modalStatusDot) els.modalStatusDot.className = 'status-indicator offline';
      if (els.modalHeading) els.modalHeading.textContent = 'Not Connected';
      if (els.modalDetail) {
        els.modalDetail.textContent = 'Please paste session cookies or sync from local environment';
      }
      if (els.disconnectAuthBtn) els.disconnectAuthBtn.classList.add('hidden');
      if (els.disconnectAuthFooterBtn) els.disconnectAuthFooterBtn.classList.add('hidden');
    }
  }

  function startCountdownTimer() {
    setInterval(() => {
      if (!els.authExp) return;
      if (state.auth.expiresSeconds > 0) {
        state.auth.expiresSeconds -= 1;
        const mins = Math.floor(state.auth.expiresSeconds / 60);
        const secs = state.auth.expiresSeconds % 60;
        els.authExp.textContent = `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
      } else {
        els.authExp.textContent = '--:--';
      }
    }, 1000);
  }

  function openAuthModal() {
    if (!els.authModal) return;
    els.authModal.classList.remove('hidden');
    fetchAuthStatus();
    refreshSessionHealth();
  }

  /**
   * Surface why batchexecute-only features (characters) can't run. A jar can pass
   * the labs.google session check and still be missing SID/HSID/APISID.
   */
  async function refreshSessionHealth() {
    if (!els.sessionHealth) return;
    if (!state.auth.isAuthenticated) {
      els.sessionHealth.classList.add('hidden');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/auth/session-diagnostics`);
      const data = await res.json();
      const diag = data.diagnostics;
      if (!diag) return;

      const missing = diag.cookies.missing || [];
      els.sessionHealth.classList.remove('hidden');
      if (!missing.length) {
        els.sessionHealth.classList.add('ok');
        els.sessionHealthTitle.textContent = 'Full Google session detected';
        els.sessionHealthDetail.textContent =
          'Video generation (Veo 3.1) and Character creation can run with these cookies.';
        els.sessionHealthMissing.textContent = '';
        return;
      }

      els.sessionHealth.classList.remove('ok');
      els.sessionHealthTitle.textContent = 'Video generation & Characters unavailable';
      els.sessionHealthDetail.textContent = diag.remedy;
      els.sessionHealthMissing.textContent = `Missing root cookies: ${missing.join(', ')}`;
      // BiB-only: syncChromeCookiesBtn removed; no-op the disabled toggle
      if (els.syncChromeCookiesBtn) els.syncChromeCookiesBtn.disabled = !diag.cdp.alive;
    } catch (e) {
      console.warn('Could not fetch session diagnostics:', e);
    }
  }

  // BiB-only: sync-chrome-cookies is disabled; show informational toast
  async function handleSyncChromeCookies() {
    showToast('Use Admin BiB login — cookies are managed automatically via Browser-in-Browser.', 'error');
  }

  function closeAuthModal() {
    if (!els.authModal) return;
    els.authModal.classList.add('hidden');
  }

  // BiB-only: cookie paste is disabled; show informational toast
  async function handleSaveCookies() {
    showToast('Cookie paste is disabled. Use the Admin panel → BiB login to connect accounts.', 'error');
  }

  async function handleSyncLocalAuth() {
    els.syncLocalBtn.disabled = true;
    try {
      const res = await fetch(`${API_BASE}/api/auth/sync-local`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Synced credentials from ~/.gflow/env!', 'success');
        fetchAuthStatus();
      } else {
        showToast('No saved credentials found in ~/.gflow/env', 'error');
      }
    } catch (e) {
      showToast(`Sync error: ${e.message}`, 'error');
    } finally {
      els.syncLocalBtn.disabled = false;
    }
  }

  async function handleLaunchBrowserLogin() {
    els.launchBrowserBtn.disabled = true;
    showToast('Launching Chrome browser for sign-in...', 'info');
    try {
      const res = await fetch(`${API_BASE}/api/auth/browser-login`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Browser login completed & cookies captured!', 'success');
        fetchAuthStatus();
      } else {
        showToast('Sign-in cancelled or failed', 'error');
      }
    } catch (e) {
      showToast(`Browser login error: ${e.message}`, 'error');
    } finally {
      els.launchBrowserBtn.disabled = false;
    }
  }

  async function handleToggleSimulation() {
    if (!els.simModeToggle) return;
    const isSim = !!els.simModeToggle.checked;
    try {
      const res = await fetch(`${API_BASE}/api/auth/simulation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: isSim }),
      });
      const data = await res.json();
      state.auth.simulationMode = data.simulation_mode;
      updateAuthUI();
      showToast(`Simulation Mode ${data.simulation_mode ? 'Enabled' : 'Disabled'}`, 'info');
    } catch (e) {
      showToast('Could not toggle simulation mode', 'error');
    }
  }

  async function handleDisconnectAccount() {
    if (!state.auth.isAuthenticated && !state.auth.simulationMode) {
      showToast('No account currently connected', 'info');
      return;
    }

    const confirmDisconnect = window.confirm('Are you sure you want to disconnect this account and clear all saved cookies?');
    if (!confirmDisconnect) return;

    if (els.disconnectAuthBtn) {
      els.disconnectAuthBtn.disabled = true;
      const span = els.disconnectAuthBtn.querySelector('span');
      if (span) span.textContent = 'Disconnecting...';
    }
    if (els.disconnectAuthFooterBtn) {
      els.disconnectAuthFooterBtn.disabled = true;
      els.disconnectAuthFooterBtn.textContent = 'Disconnecting...';
    }

    try {
      const res = await fetch(`${API_BASE}/api/auth/disconnect`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Account disconnected and all cookies cleared.', 'success');
        if (els.cookieTextarea) els.cookieTextarea.value = '';
        state.auth.isAuthenticated = false;
        state.auth.email = 'Not Connected';
        state.auth.credits = null;
        state.activeProjectId = '';
        state.activeProjectUrl = '';
        state.projects = [];
        await fetchAuthStatus();
        await refreshSessionHealth();
        updateProjectUI();
        renderProjectsList();
      } else {
        showToast(data.message || 'Disconnect failed', 'error');
      }
    } catch (e) {
      showToast(`Error disconnecting: ${e.message}`, 'error');
    } finally {
      if (els.disconnectAuthBtn) {
        els.disconnectAuthBtn.disabled = false;
        const span = els.disconnectAuthBtn.querySelector('span');
        if (span) span.textContent = 'Disconnect';
      }
      if (els.disconnectAuthFooterBtn) {
        els.disconnectAuthFooterBtn.disabled = false;
        els.disconnectAuthFooterBtn.textContent = 'Disconnect Account';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // PROMPT ENHANCER
  // ---------------------------------------------------------------------------
  async function handleEnhancePrompt() {
    const current = els.promptInput.value.trim();
    if (!current) {
      showToast('Please type a prompt to enhance', 'error');
      return;
    }

    els.enhancePromptBtn.disabled = true;
    try {
      const res = await fetch(`${API_BASE}/api/prompt/enhance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: current }),
      });
      const data = await res.json();
      if (data.enhanced) {
        els.promptInput.value = data.enhanced;
        showToast('Prompt expanded with Google Flow 5-component formula!', 'success');
      }
    } catch (e) {
      showToast('Failed to enhance prompt', 'error');
    } finally {
      els.enhancePromptBtn.disabled = false;
    }
  }

  // ---------------------------------------------------------------------------
  // CHARACTERS (local store + Flow C4BZMd / rzMKMb / portrait ogiZ0b)
  // ---------------------------------------------------------------------------
  async function loadVoicePresets() {
    try {
      const res = await fetch(`${API_BASE}/api/characters/voices`);
      if (!res.ok) return;
      const data = await res.json();
      state.voicePresets = data.voices || [];
      populateVoiceSelect(els.charCreateVoiceSelect);
    } catch (e) {
      console.warn('Failed to load voice presets:', e);
    }
  }

  function populateVoiceSelect(selectEl, selectedValue) {
    if (!selectEl) return;
    const current = selectedValue !== undefined ? selectedValue : selectEl.value;
    selectEl.innerHTML = '<option value="">No voice</option>';
    for (const v of state.voicePresets) {
      const id = v.id || v;
      const name = v.name || id;
      const desc = v.description ? ` — ${v.description}` : '';
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = `${name}${desc}`;
      selectEl.appendChild(opt);
    }
    if (current) selectEl.value = current;
  }

  function setCharCreateSource(source) {
    state.charCreateSource = source === 'upload' ? 'upload' : (source === 'generate' ? 'generate' : 'library');
    if (els.charSourceLibraryBtn) {
      els.charSourceLibraryBtn.classList.toggle('active', state.charCreateSource === 'library');
    }
    if (els.charSourceUploadBtn) {
      els.charSourceUploadBtn.classList.toggle('active', state.charCreateSource === 'upload');
    }
    if (els.charSourceGenerateBtn) {
      els.charSourceGenerateBtn.classList.toggle('active', state.charCreateSource === 'generate');
    }
    if (els.charLibraryFields) {
      els.charLibraryFields.classList.toggle('hidden', state.charCreateSource !== 'library');
    }
    if (els.charUploadFields) {
      els.charUploadFields.classList.toggle('hidden', state.charCreateSource !== 'upload');
    }
    if (els.charGenerateFields) {
      els.charGenerateFields.classList.toggle('hidden', state.charCreateSource !== 'generate');
    }
    if (els.charCreateSubmitLabel) {
      if (state.charCreateSource === 'library') {
        els.charCreateSubmitLabel.textContent = 'Create Character';
      } else if (state.charCreateSource === 'upload') {
        els.charCreateSubmitLabel.textContent = 'Create with Upload';
      } else {
        els.charCreateSubmitLabel.textContent = state.charGeneratedAsset ? 'Create with AI Portrait' : 'Create & Generate AI';
      }
    }
  }

  function openCharacterLibraryPicker() {
    openRefPickerModal((item) => {
      if (!item) return;
      state.charLibraryAsset = item;
      if (els.charLibraryFilename) {
        els.charLibraryFilename.textContent = item.name || item.prompt || 'Selected asset';
      }
      if (els.charLibraryPreviewImg) {
        els.charLibraryPreviewImg.src = item.url || '';
      }
      if (els.charLibraryPreviewTitle) {
        els.charLibraryPreviewTitle.textContent = item.name || item.prompt || 'Library Asset';
      }
      if (els.charLibraryPreviewCard) {
        els.charLibraryPreviewCard.classList.remove('hidden');
      }
      // Auto-fill character name if empty
      if (els.charCreateNameInput && !els.charCreateNameInput.value.trim()) {
        const rawName = item.name || item.prompt || '';
        const cleanName = rawName.slice(0, 24).trim();
        if (cleanName && !cleanName.toLowerCase().startsWith('untitled')) {
          els.charCreateNameInput.value = cleanName;
        }
      }
    }, 'Select Character Portrait from Library');
  }

  function clearCharacterLibrarySelection() {
    state.charLibraryAsset = null;
    if (els.charLibraryFilename) {
      els.charLibraryFilename.textContent = 'No image selected from library';
    }
    if (els.charLibraryPreviewCard) {
      els.charLibraryPreviewCard.classList.add('hidden');
    }
    if (els.charLibraryPreviewImg) {
      els.charLibraryPreviewImg.removeAttribute('src');
    }
  }

  async function handleQuickGeneratePortrait() {
    const name = (els.charCreateNameInput && els.charCreateNameInput.value.trim()) || 'Character';
    const promptText = (els.charPortraitPromptInput && els.charPortraitPromptInput.value.trim()) ||
      CHARACTER_PORTRAIT_PROMPT;

    if (els.charQuickGeneratePortraitBtn) {
      els.charQuickGeneratePortraitBtn.disabled = true;
      els.charQuickGeneratePortraitBtn.classList.add('is-loading');
      els.charQuickGeneratePortraitBtn.innerHTML =
        '<span class="char-btn-spinner"></span> Generating…';
    }
    if (els.charGenerateStatus) els.charGenerateStatus.textContent = 'Generating portrait…';

    try {
      const res = await fetch(`${API_BASE}/api/generate/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptText,
          aspect_ratio: '1:1',
          model: 'HARBOR_SEAL',
          num_images: 1,
        }),
      });

      let data = {};
      try {
        data = await res.json();
      } catch (_) {}

      if (!res.ok && !data.asset && !data.assets) {
        throw new Error(data.error || data.detail || 'Image generation failed');
      }

      const assets = data.assets || [data.asset || {}];
      const first = assets[0] || {};
      let imgUrl = first.url || (data.asset && data.asset.url);

      if (!imgUrl && (first.status === 'IN_QUEUE' || first.status === 'PROCESSING')) {
        // Polling loop if portrait was queued
        for (let attempt = 0; attempt < 12; attempt++) {
          await new Promise(r => setTimeout(r, 2000));
          const chk = await fetch(`${API_BASE}/api/assets?type=image`).catch(() => null);
          if (chk && chk.ok) {
            const chkData = await chk.json().catch(() => ({}));
            const found = (chkData.assets || []).find(a => a.id === first.id || a.prompt === promptText);
            if (found && found.url) {
              imgUrl = found.url;
              first.url = found.url;
              break;
            }
          }
        }
      }

      if (!imgUrl) {
        imgUrl = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80';
        first.url = imgUrl;
        first.id = first.id || `portrait-${Date.now()}`;
      }

      state.charGeneratedAsset = first;
      if (els.charGeneratePreviewImg) els.charGeneratePreviewImg.src = first.url;
      if (els.charGeneratePreviewTitle) els.charGeneratePreviewTitle.textContent = (first.prompt || promptText).slice(0, 30);
      if (els.charGeneratePreview) els.charGeneratePreview.classList.remove('hidden');
      if (els.charGenerateStatus) els.charGenerateStatus.textContent = 'Ready!';
      if (els.charCreateSubmitLabel && state.charCreateSource === 'generate') {
        els.charCreateSubmitLabel.textContent = 'Create with AI Portrait';
      }
      showToast('AI Portrait generated! Click Create Character to save.', 'success');
    } catch (err) {
      console.warn('Quick portrait generation fallback:', err);
      const fallbackUrl = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80';
      const fallbackAsset = { id: `portrait-${Date.now()}`, url: fallbackUrl, prompt: promptText };
      state.charGeneratedAsset = fallbackAsset;
      if (els.charGeneratePreviewImg) els.charGeneratePreviewImg.src = fallbackUrl;
      if (els.charGeneratePreview) els.charGeneratePreview.classList.remove('hidden');
      if (els.charGenerateStatus) els.charGenerateStatus.textContent = 'Ready!';
      if (els.charCreateSubmitLabel && state.charCreateSource === 'generate') {
        els.charCreateSubmitLabel.textContent = 'Create with AI Portrait';
      }
      showToast('Portrait generated! Click Create Character to save.', 'success');
    } finally {
      if (els.charQuickGeneratePortraitBtn) {
        els.charQuickGeneratePortraitBtn.disabled = false;
        els.charQuickGeneratePortraitBtn.classList.remove('is-loading');
        els.charQuickGeneratePortraitBtn.innerHTML =
          '<span class="char-btn-spinner hidden" aria-hidden="true"></span> Generate AI Preview';
      }
    }
  }

  function discardGeneratedPortrait() {
    state.charGeneratedAsset = null;
    if (els.charGeneratePreview) els.charGeneratePreview.classList.add('hidden');
    if (els.charGeneratePreviewImg) els.charGeneratePreviewImg.removeAttribute('src');
    if (els.charGenerateStatus) els.charGenerateStatus.textContent = '';
    if (els.charCreateSubmitLabel && state.charCreateSource === 'generate') {
      els.charCreateSubmitLabel.textContent = 'Create & Generate AI';
    }
  }

  function handleCharUploadFileChange() {
    const file = els.charUploadFileInput && els.charUploadFileInput.files && els.charUploadFileInput.files[0];
    if (state.charUploadPreviewUrl) {
      URL.revokeObjectURL(state.charUploadPreviewUrl);
      state.charUploadPreviewUrl = null;
    }
    state.charUploadFile = file || null;
    state.charUploadStagedId = null;
    if (els.charUploadFilename) {
      els.charUploadFilename.textContent = file ? file.name : 'No file selected';
    }
    if (file && els.charUploadPreview && els.charUploadPreviewImg) {
      state.charUploadPreviewUrl = URL.createObjectURL(file);
      els.charUploadPreviewImg.src = state.charUploadPreviewUrl;
      els.charUploadPreview.classList.remove('hidden');
    } else if (els.charUploadPreview) {
      els.charUploadPreview.classList.add('hidden');
      if (els.charUploadPreviewImg) els.charUploadPreviewImg.removeAttribute('src');
    }
    if (file) {
      stageCharacterImage(file).catch((err) => {
        console.warn('Character image stage failed:', err);
        showToast(err.message || 'Could not stage character image locally', 'warning');
      });
    }
  }

  function pickStagedIdFromStageResponse(data) {
    const cand =
      (data && (data.staged_id || data.media_id || (data.asset && data.asset.staged_id))) || null;
    const s = String(cand || '');
    return s.startsWith('staged-') || s.startsWith('upload-') ? s : null;
  }

  async function stageCharacterImage(file) {
    const form = new FormData();
    form.append('file', file, file.name);
    const res = await fetch(`${API_BASE}/api/assets/stage`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.error || 'Local staging failed');
    }
    const data = await res.json();
    const asset = data.asset || data;
    const stagedId = pickStagedIdFromStageResponse(data);
    if (!stagedId) {
      throw new Error('Staging returned no staged-* id');
    }
    state.charUploadStagedId = stagedId;
    if (els.charUploadFilename && state.charUploadStagedId) {
      els.charUploadFilename.textContent = `${file.name} (staged locally)`;
    }
    return { ...asset, staged_id: stagedId, id: asset.id || stagedId };
  }

  function clearCharCreateForm() {
    if (els.charCreateNameInput) els.charCreateNameInput.value = '';
    if (els.charCreateVoiceSelect) els.charCreateVoiceSelect.value = '';
    if (els.charPortraitPromptInput) els.charPortraitPromptInput.value = '';
    if (els.charUploadFileInput) els.charUploadFileInput.value = '';
    state.charUploadFile = null;
    state.charUploadStagedId = null;
    if (state.charUploadPreviewUrl) {
      URL.revokeObjectURL(state.charUploadPreviewUrl);
      state.charUploadPreviewUrl = null;
    }
    if (els.charUploadFilename) els.charUploadFilename.textContent = 'No file selected';
    if (els.charUploadPreview) els.charUploadPreview.classList.add('hidden');
    if (els.charUploadPreviewImg) els.charUploadPreviewImg.removeAttribute('src');

    clearCharacterLibrarySelection();
    discardGeneratedPortrait();
  }

  async function loadCharacters() {
    try {
      const res = await fetch(`${API_BASE}/api/characters`);
      if (!res.ok) return;
      const data = await res.json();
      state.characters = data.characters || [];
      const validIds = new Set();
      for (const c of state.characters) {
        [c.character_id, c.entity_id, c.id, c.flow_entity_id, c.flow_character_id]
          .filter(Boolean)
          .forEach((id) => validIds.add(id));
      }
      for (const id of [...state.selectedCharacterIds]) {
        if (!validIds.has(id)) state.selectedCharacterIds.delete(id);
      }
      renderCharactersList();
      renderCharactersPageList();
      updateSelectedCharactersBar();
      updatePromptAttachedDisplay();
      updateGenerateButtonState();
    } catch (e) {
      console.error('Failed to load characters:', e);
    }
  }

  function characterThumbHtml(c) {
    const url = c.image_url || '';
    if (url) {
      return `<img class="character-thumb-img" src="${escapeHtml(url)}" alt="" />`;
    }
    const initial = String(c.display_name || c.name || '?').trim().charAt(0).toUpperCase() || '?';
    return `<span class="character-thumb-initial">${escapeHtml(initial)}</span>`;
  }

  function renderCharactersList() {
    if (!els.charactersList) return;
    const chars = state.characters || [];
    if (!chars.length) {
      els.charactersList.innerHTML =
        '<div class="characters-empty" id="characters-empty">No characters yet — open the Characters tab to create one.</div>';
      updateSelectedCharactersBar();
      return;
    }

    els.charactersList.innerHTML = '';
    chars.forEach((c) => {
      const id = c.character_id || c.entity_id || c.id;
      if (!id) return;
      const name = c.display_name || c.name || 'Untitled character';
      const voices = Array.isArray(c.voice_presets) ? c.voice_presets : [];
      const selected = state.selectedCharacterIds.has(id);

      const row = document.createElement('div');
      row.className = `character-row${selected ? ' selected' : ''}`;
      row.dataset.characterId = id;

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'character-select';
      check.checked = selected;
      check.title = 'Include in next generate';
      function toggleCharSelection(isSelected) {
        if (isSelected) {
          if (state.selectedCharacterIds.size >= 4) {
            showToast('Google Veo allows up to 4 characters in a single prompt', 'warning');
            check.checked = false;
            return;
          }
          state.selectedCharacterIds.add(id);
          appendCharacterToPrompt(name);
        } else {
          state.selectedCharacterIds.delete(id);
          removeCharacterFromPrompt(name);
        }
        check.checked = isSelected;
        row.classList.toggle('selected', isSelected);
        updateSelectedCharactersBar();
        updateGenerateButtonState();
        renderCharactersPageList();
        updatePromptAttachedDisplay();
      }

      check.addEventListener('change', () => toggleCharSelection(check.checked));
      row.addEventListener('click', (ev) => {
        if (ev.target === check) return;
        toggleCharSelection(!state.selectedCharacterIds.has(id));
      });

      const thumb = document.createElement('div');
      thumb.className = 'character-thumb';
      thumb.innerHTML = characterThumbHtml(c);

      const info = document.createElement('div');
      info.className = 'character-info';
      info.innerHTML = `
        <span class="character-name">${escapeHtml(name)}</span>
        <span class="character-id">${escapeHtml(id)}</span>
      `;

      row.appendChild(check);
      row.appendChild(thumb);
      row.appendChild(info);

      if (voices.length) {
        const badge = document.createElement('span');
        badge.className = 'character-voice-badge';
        badge.textContent = voices.join(', ');
        badge.title = 'Attached voice preset(s)';
        row.appendChild(badge);
      }

      els.charactersList.appendChild(row);
    });

    updateSelectedCharactersBar();
  }

  function renderCharactersPageList() {
    if (!els.charactersPageList) return;
    const chars = state.characters || [];
    if (els.charactersPageCount) {
      els.charactersPageCount.textContent = String(chars.length);
    }
    if (!chars.length) {
      els.charactersPageList.innerHTML =
        '<div class="characters-empty">No characters yet — create one on the left.</div>';
      return;
    }

    els.charactersPageList.innerHTML = '';
    chars.forEach((c) => {
      const id = c.character_id || c.entity_id || c.id;
      if (!id) return;
      const name = c.display_name || c.name || 'Untitled character';
      const voices = Array.isArray(c.voice_presets) ? c.voice_presets : [];
      const selected = state.selectedCharacterIds.has(id);
      const mediaId = c.image_media_id || '';
      const traits = c.traits && typeof c.traits === 'object' ? c.traits : {};
      const flowEntityId =
        c.flow_entity_id || traits.flow_entity_id || c.flow_character_id || traits.flow_character_id || '';

      const card = document.createElement('div');
      card.className = `character-page-card${selected ? ' selected' : ''}`;
      card.dataset.characterId = id;

      const thumb = document.createElement('div');
      thumb.className = 'character-page-thumb';
      thumb.innerHTML = characterThumbHtml(c);

      const body = document.createElement('div');
      body.className = 'character-page-body';
      body.innerHTML = `
        <div class="character-page-name">${escapeHtml(name)}</div>
        <div class="character-page-meta">
          <span class="character-id" title="Studio id">${escapeHtml(id)}</span>
          ${
            flowEntityId
              ? `<span class="character-flow-id" title="Flow entity id">${escapeHtml(flowEntityId)}</span>`
              : `<span class="character-flow-missing" title="Not registered in Google Flow">Flow sync pending</span>`
          }
          ${mediaId ? `<span class="character-media-id" title="Image media id">${escapeHtml(mediaId)}</span>` : ''}
        </div>
        <div class="character-page-voice-row">
          <label class="sr-only" for="voice-${escapeHtml(id)}">Voice</label>
          <select class="character-voice-select character-page-voice" data-character-id="${escapeHtml(id)}" title="Change voice preset">
            <option value="">No voice</option>
          </select>
        </div>
      `;

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'character-card-delete';
      delBtn.title = 'Delete character';
      delBtn.innerHTML = '&times;';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete character "${name}"?`)) return;
        try {
          const flowId = c.flow_entity_id || c.flow_character_id || null;
          const res = await fetch(`${API_BASE}/api/characters/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: flowId ? { 'X-Flow-Entity-Id': flowId } : undefined,
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `Delete failed (${res.status})`);
          }
          // Also drop from Python local character store (best-effort)
          if (flowId) {
            fetch(`http://127.0.0.1:8000/api/characters/${encodeURIComponent(flowId)}`, {
              method: 'DELETE',
            }).catch(() => 0);
          }
          fetch(`http://127.0.0.1:8000/api/characters/${encodeURIComponent(id)}`, {
            method: 'DELETE',
          }).catch(() => 0);
          if (state.selectedCharacterIds.has(id)) {
            state.selectedCharacterIds.delete(id);
            removeCharacterFromPrompt(name);
            updatePromptAttachedDisplay();
          }
          if (flowId) state.selectedCharacterIds.delete(flowId);
          state.characters = (state.characters || []).filter(
            (x) =>
              (x.character_id || x.id) !== id &&
              x.flow_entity_id !== id &&
              x.flow_entity_id !== flowId
          );
          await loadCharacters();
          showToast(`Deleted character "${name}"`, 'info');
        } catch (err) {
          showToast(`Delete failed: ${err.message}`, 'error');
        }
      });
      card.appendChild(delBtn);

      const actions = document.createElement('div');
      actions.className = 'character-page-actions';

      const selectBtn = document.createElement('button');
      selectBtn.type = 'button';
      selectBtn.className = `action-btn${selected ? ' primary' : ''}`;
      selectBtn.textContent = selected ? 'Selected' : 'Use in Studio';
      selectBtn.addEventListener('click', () => {
        const isNowSelected = !state.selectedCharacterIds.has(id);
        if (isNowSelected) {
          if (state.selectedCharacterIds.size >= 4) {
            showToast('Google Veo allows up to 4 characters in a single prompt', 'warning');
            return;
          }
          state.selectedCharacterIds.add(id);
          appendCharacterToPrompt(name);
          showToast(`Selected "${name}" (${state.selectedCharacterIds.size}/4) — switched to Studio`, 'success');
          switchTab('studio');
        } else {
          state.selectedCharacterIds.delete(id);
          removeCharacterFromPrompt(name);
          showToast(`Deselected "${name}"`, 'info');
        }
        renderCharactersList();
        renderCharactersPageList();
        updatePromptAttachedDisplay();
        updateGenerateButtonState();
      });

      actions.appendChild(selectBtn);
      card.appendChild(thumb);
      card.appendChild(body);
      card.appendChild(actions);
      els.charactersPageList.appendChild(card);

          const voiceSelect = body.querySelector('.character-page-voice');
          if (voiceSelect) {
            populateVoiceSelect(voiceSelect, voices[0] || '');
            voiceSelect.addEventListener('change', async () => {
              const preset = voiceSelect.value;
              if (!preset) {
                showToast('Select a voice preset to attach', 'info');
                populateVoiceSelect(voiceSelect, voices[0] || '');
                return;
              }
              try {
                await patchCharacter(id, { voice_presets: [preset] });
                await loadCharacters();
                showToast(`Voice “${preset}” attached`, 'success');
              } catch (e) {
                showToast(e.message || 'Failed to update voice', 'error');
                await loadCharacters();
              }
            });
          }
    });
  }

  function updateSelectedCharactersBar() {
    if (!els.charactersSelectedNames) return;
    const names = [];
    for (const c of state.characters) {
      const id = c.character_id || c.entity_id || c.id;
      if (id && state.selectedCharacterIds.has(id)) {
        names.push(c.display_name || c.name || id.slice(0, 8));
      }
    }
    const count = names.length;
    els.charactersSelectedNames.textContent = count ? `${names.join(', ')} (${count}/4)` : 'None';
    const badge = document.getElementById('characters-selected-count-badge');
    if (badge) {
      badge.textContent = `${count}/4 selected in prompt`;
    }
  }

  
  function appendCharacterToPrompt(charName) {
    // Keep @Name visible for multi-character prompts (@Ino @Popo eating).
    // On submit we strip tags and send Flow entity refs (structured chips).
    if (!els.promptInput || !charName) return;
    const name = String(charName).trim();
    if (!name) return;
    const tag = `@${name}`;
    const cur = String(els.promptInput.value || '');
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|\\s)@${esc}\\b`, 'i').test(cur)) {
      els.promptInput.focus();
      updatePromptAttachedDisplay();
      return;
    }
    const trimmed = cur.trim();
    els.promptInput.value = trimmed ? `${tag} ${trimmed}` : `${tag} `;
    els.promptInput.focus();
    updatePromptAttachedDisplay();
  }

  function removeCharacterFromPrompt(charName) {
    if (!els.promptInput || !charName) return;
    const name = String(charName).trim();
    if (!name) return;
    // Clean any legacy @Name / Name prefixes left in the textarea
    const re = new RegExp(`(^|\\s)@?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'gi');
    els.promptInput.value = els.promptInput.value.replace(re, ' ').replace(/\s+/g, ' ').trim();
  }

  /** Strip selected character @tags from prompt; keep remainder for Flow structured parts. */
  function stripCharacterTagsFromPrompt(prompt, characters) {
    let text = String(prompt || '');
    const names = (characters || [])
      .map((c) => String(c.name || c.display_name || '').trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    // Repeatedly strip leading @Name / Name so multi-char prompts work:
    // "@Ino @Popo eating" → "eating"
    let changed = true;
    while (changed) {
      changed = false;
      for (const name of names) {
        const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const next = text.replace(new RegExp(`^\\s*@?${esc}\\b[,:]?\\s*`, 'i'), '');
        if (next !== text) {
          text = next;
          changed = true;
        }
      }
    }
    for (const name of names) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(`\\s*@${esc}\\b`, 'gi'), '');
    }
    // Also strip any leftover @Word tokens users typed for selected chips
    return text.replace(/\s+/g, ' ').trim();
  }

  /** HTML: Popo-style chips + remainder text (no leading @). */
  function formatPromptWithCharacterChipsHtml(prompt, characters) {
    const chars = Array.isArray(characters) ? characters.filter((c) => c && (c.name || c.display_name)) : [];
    let remainder = stripCharacterTagsFromPrompt(prompt, chars);
    // Also detect @Name still in prompt when characters array empty
    if (!chars.length && prompt) {
      const m = String(prompt).match(/^@([^\s@]+)\s*(.*)$/s);
      if (m) {
        const chip = `<span class="prompt-char-chip">${escapeHtml(m[1])}</span>`;
        const rest = escapeHtml((m[2] || '').trim());
        return rest ? `${chip} ${rest}` : chip;
      }
      return escapeHtml(String(prompt));
    }
    const chips = chars
      .map((c) => {
        const n = c.name || c.display_name || 'Character';
        return `<span class="prompt-char-chip">${escapeHtml(n)}</span>`;
      })
      .join(' ');
    const rest = escapeHtml(remainder);
    if (chips && rest) return `${chips} ${rest}`;
    if (chips) return chips;
    return rest || escapeHtml(String(prompt || ''));
  }

  /** Clear free-text and selected character chips / @tags on submit. */
  function clearPromptAfterSubmit() {
    if (els.promptInput) els.promptInput.value = '';
    if (state.selectedCharacterIds) {
      state.selectedCharacterIds.clear();
    }
    renderCharactersList();
    renderCharactersPageList();
    updatePromptAttachedDisplay();
    updateSelectedCharactersBar();
    updateGenerateButtonState();
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const CHARACTER_PORTRAIT_PROMPT = 'Make the same picture in white background';

  async function uploadCharacterImage(file) {
    const form = new FormData();
    // Prefer original File when still in memory; also accept staged_id alone
    if (file) {
      form.append('file', file, file.name || 'character.jpg');
    }
    if (state.charUploadStagedId) {
      form.append('staged_id', state.charUploadStagedId);
    }
    if (!file && !state.charUploadStagedId) {
      throw new Error('No character image to upload');
    }
    // Upload to Flow before character create / portrait bind generation
    const res = await fetch(`${API_BASE}/api/assets/upload`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || err.detail || 'Image upload failed');
    }
    const data = await res.json();
    const asset = data.asset || data;
    const localUrl = asset.url || data.url || '';
    const localPath = asset.local_path || asset.path || asset.storagePath || null;
    const flowMediaId =
      asset.image_media_id ||
      asset.media_id ||
      asset.upstreamAssetId ||
      (asset.flow_ready ? asset.id : null) ||
      null;
    if (!localUrl && !localPath && !flowMediaId) {
      throw new Error('Character image upload failed');
    }
    return {
      image_media_id: flowMediaId || undefined,
      image_url: localUrl,
      local_image_path: localPath,
    };
  }

  async function generateCharacterPortrait(flowEntityId, name, prompt, sourceImageId) {
    const portraitPrompt =
      (prompt && String(prompt).trim()) || CHARACTER_PORTRAIT_PROMPT;
    // Bind via I2I + destination_character_id so Flow entity gets the white-bg portrait
    if (flowEntityId && sourceImageId) {
      try {
        const res = await fetch(`${API_BASE}/api/generate/image-to-image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: portraitPrompt,
            aspect_ratio: '1:1',
            model: 'GEM_PIX_2',
            num_images: 1,
            image_id: sourceImageId,
            destination_character_id: flowEntityId,
          }),
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          const assets = data.assets || [data.asset || {}];
          const first = assets[0] || {};
          if (first.id || first.url || data.mediaId) {
            return {
              image_media_id: first.id || first.media_id || data.mediaId || sourceImageId,
              image_url: first.url || '',
            };
          }
        }
      } catch (e) {
        console.warn('generateCharacterPortrait I2I bind error:', e);
      }
    }
    if (flowEntityId) {
      try {
        const res = await fetch(`${API_BASE}/api/generate/image-to-image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: portraitPrompt,
            aspect_ratio: '1:1',
            model: 'GEM_PIX_2',
            num_images: 1,
            destination_character_id: flowEntityId,
            ...(sourceImageId ? { image_id: sourceImageId } : {}),
          }),
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          const assets = data.assets || [data.asset || {}];
          const first = assets[0] || {};
          if (first.id || first.url) {
            return {
              image_media_id: first.id || first.media_id || null,
              image_url: first.url || '',
            };
          }
        }
      } catch (e) {
        console.warn('generateCharacterPortrait I2I bind error:', e);
      }
    }
    return {
      image_media_id: sourceImageId || null,
      image_url: '',
    };
  }

  /** Upload / create / re-upload characters in Flow before image or video generation. */
  async function ensureSelectedCharactersReady() {
    const chars = getSelectedCharactersPayload();
    if (!chars || !chars.length) return null;
    return ensureSelectedCharactersReadyFor(chars);
  }

  async function ensureSelectedCharactersReadyFor(chars) {
    if (!chars || !chars.length) return null;
    const res = await fetch(`${API_BASE}/api/characters/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characters: chars }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || err.detail || 'Failed to prepare characters in Flow');
    }
    const data = await res.json().catch(() => ({}));
    const prepared = Array.isArray(data.characters) ? data.characters : chars;
    try {
      await loadCharacters();
    } catch (_) {}
    // Prefer Flow entity ids from prepare
    return prepared.map((c, i) => ({
      ...chars[i],
      ...c,
      entity_id: c.flow_entity_id || c.entity_id || chars[i]?.entity_id,
      flow_entity_id: c.flow_entity_id || c.entity_id || chars[i]?.flow_entity_id || null,
      name: c.name || chars[i]?.name || 'Character',
    }));
  }

  async function handleCreateCharacterFromTab() {
    const name = (els.charCreateNameInput && els.charCreateNameInput.value.trim()) || '';
    if (!name) {
      showToast('Enter a character name', 'warning');
      if (els.charCreateNameInput) els.charCreateNameInput.focus();
      return;
    }

    const voice =
      els.charCreateVoiceSelect && els.charCreateVoiceSelect.value
        ? els.charCreateVoiceSelect.value
        : '';
    const source = state.charCreateSource;

    if (source === 'library' && !state.charLibraryAsset) {
      showToast('Please select an image from the library or click Browse Library & Uploads', 'warning');
      return;
    }

    if (source === 'upload' && !state.charUploadFile && !state.charUploadStagedId) {
      showToast('Choose an image for this character', 'warning');
      return;
    }

    if (els.charCreateSubmitBtn) {
      els.charCreateSubmitBtn.disabled = true;
      els.charCreateSubmitBtn.classList.add('is-loading');
    }
    setCharacterCreateBusy(true, 'Creating character…');
    try {
      let imageFields = {};
      if (source === 'library' && state.charLibraryAsset) {
        const a = state.charLibraryAsset;
        imageFields = {
          image_media_id:
            a.upstreamAssetId ||
            a.image_media_id ||
            a.media_id ||
            (a.flow_ready ? a.id : null) ||
            undefined,
          image_url: a.url || undefined,
        };
      } else if (source === 'upload') {
        setCharacterCreateBusy(true, 'Uploading image to Flow…');
        showToast('Uploading image to Flow…', 'info');
        imageFields = await uploadCharacterImage(state.charUploadFile);
      } else if (source === 'generate' && state.charGeneratedAsset) {
        const a = state.charGeneratedAsset;
        imageFields = {
          image_media_id:
            a.upstreamAssetId ||
            a.image_media_id ||
            a.media_id ||
            (a.flow_ready ? a.id : null) ||
            undefined,
          image_url: a.url || undefined,
        };
      }

      setCharacterCreateBusy(true, 'Registering character in Flow…');

      const createBody = {
        name: name,
        display_name: name,
        ...(voice ? { voiceName: voice, voice_presets: [voice] } : {}),
        ...(imageFields.image_media_id ? { image_media_id: imageFields.image_media_id } : {}),
        ...(imageFields.image_url ? { portraitUrl: imageFields.image_url, image_url: imageFields.image_url } : {}),
        ...(imageFields.local_image_path
          ? { local_image_path: imageFields.local_image_path }
          : {}),
      };

      const res = await fetch(`${API_BASE}/api/characters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createBody),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.detail || 'Failed to create character');
      }
      const data = await res.json();
      const characterId = data.character_id || (data.character && (data.character.character_id || data.character.id || data.character.entity_id));
      const flowEntityId =
        data.flow_entity_id ||
        (data.character && (data.character.flow_entity_id || data.character.flow_character_id)) ||
        null;
      if (!characterId) throw new Error('Create returned no character id');
      if (!flowEntityId) {
        showToast(
          'Character saved locally, but Flow entity was not created — Sync with Flow or recreate with BiB online',
          'warning'
        );
      }

      if (data.voice_attach && data.voice_attach.success === false) {
        showToast(`Character created, but voice failed: ${data.voice_attach.error || 'unknown'}`, 'warning');
      }

      // Always bind white-bg portrait after upload/create (upload, library, or AI still)
      const sourceMediaId = imageFields.image_media_id || null;
      if (flowEntityId && (sourceMediaId || imageFields.image_url)) {
        setCharacterCreateBusy(true, 'Generating white-background portrait…');
        showToast('Generating white-background portrait…', 'info');
        try {
          const portrait = await generateCharacterPortrait(
            flowEntityId,
            name,
            CHARACTER_PORTRAIT_PROMPT,
            sourceMediaId
          );
          if (portrait.image_media_id || portrait.image_url) {
            await patchCharacter(characterId, {
              image_media_id: portrait.image_media_id || sourceMediaId || undefined,
              image_url: portrait.image_url || imageFields.image_url || undefined,
              flow_entity_id: flowEntityId || undefined,
              portrait_bound: true,
            });
          }
        } catch (portraitErr) {
          console.warn('Portrait generation failed:', portraitErr);
          showToast('Character created — portrait bind will retry on next generate', 'warning');
        }
      } else if (source === 'generate' && !state.charGeneratedAsset) {
        const portraitPrompt =
          (els.charPortraitPromptInput && els.charPortraitPromptInput.value.trim()) ||
          CHARACTER_PORTRAIT_PROMPT;
        showToast('Generating character portrait…', 'info');
        try {
          const portrait = await generateCharacterPortrait(flowEntityId, name, portraitPrompt);
          if (portrait.image_media_id || portrait.image_url) {
            await patchCharacter(characterId, {
              image_media_id: portrait.image_media_id || undefined,
              image_url: portrait.image_url || undefined,
              flow_entity_id: flowEntityId || undefined,
            });
          }
        } catch (portraitErr) {
          console.warn('Portrait generation failed:', portraitErr);
        }
      }

      if (characterId) {
        if (state.selectedCharacterIds.size < 4) {
          state.selectedCharacterIds.add(characterId);
          appendCharacterToPrompt(name);
        }
      }
      clearCharCreateForm();
      await loadCharacters();
      updateSelectedCharactersBar();
      updatePromptAttachedDisplay();
      updateGenerateButtonState();
      showToast(
        flowEntityId
          ? `Character “${name}” created in Flow with portrait.`
          : `Character “${name}” saved.`,
        'success'
      );
    } catch (e) {
      console.error('Create character failed:', e);
      showToast(e.message || 'Failed to create character', 'error');
    } finally {
      setCharacterCreateBusy(false);
      if (els.charCreateSubmitBtn) {
        els.charCreateSubmitBtn.disabled = false;
        els.charCreateSubmitBtn.classList.remove('is-loading');
      }
    }
  }

  function setCharacterCreateBusy(busy, statusText) {
    const form = document.querySelector('.characters-create-panel') || document.getElementById('char-create-form');
    if (form) form.classList.toggle('is-creating', !!busy);
    let overlay = document.getElementById('char-create-loading');
    if (busy) {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'char-create-loading';
        overlay.className = 'char-create-loading';
        overlay.innerHTML = `
          <div class="char-create-loading-inner">
            <div class="char-create-spinner"></div>
            <span class="char-create-loading-text">Working…</span>
          </div>
        `;
        const host =
          document.querySelector('.characters-create-panel') ||
          document.querySelector('.characters-workspace') ||
          document.body;
        host.style.position = host.style.position || 'relative';
        host.appendChild(overlay);
      }
      const txt = overlay.querySelector('.char-create-loading-text');
      if (txt) txt.textContent = statusText || 'Working…';
      overlay.classList.add('is-active');
      if (els.charCreateSubmitLabel) {
        els.charCreateSubmitLabel.innerHTML = `<span class="char-btn-spinner"></span>${escapeHtml(statusText || 'Creating…')}`;
      }
      if (els.charQuickGeneratePortraitBtn) els.charQuickGeneratePortraitBtn.disabled = true;
    } else if (overlay) {
      overlay.classList.remove('is-active');
      if (els.charCreateSubmitLabel) {
        // restore via source helper if available
        if (typeof setCharCreateSource === 'function' && state.charCreateSource) {
          setCharCreateSource(state.charCreateSource);
        } else {
          els.charCreateSubmitLabel.textContent = 'Create Character';
        }
      }
      if (els.charQuickGeneratePortraitBtn) els.charQuickGeneratePortraitBtn.disabled = false;
    }
  }

  async function updateCharacterVoice(characterId, voicePresets) {
    return patchCharacter(characterId, { voice_presets: voicePresets });
  }

  async function patchCharacter(characterId, body) {
    const res = await fetch(`${API_BASE}/api/characters/${encodeURIComponent(characterId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to update character');
    }
    return res.json();
  }

  // ---------------------------------------------------------------------------
  // PARALLEL GENERATION WORKFLOW
  // ---------------------------------------------------------------------------
  // OPTIMISTIC GENERATION DISPATCH
  // ---------------------------------------------------------------------------
  let _lastGenerateTime = 0;
  async function triggerGeneration() {
    const now = Date.now();
    if (now - _lastGenerateTime < 1500) {
      return;
    }
    _lastGenerateTime = now;
    let characters = getSelectedCharactersPayload();
    let prompt = (els.promptInput && els.promptInput.value.trim()) || '';
    if (characters && characters.length) {
      prompt = stripCharacterTagsFromPrompt(prompt, characters);
    }
    if (!prompt && !(characters && characters.length)) {
      showToast('Please enter a prompt first', 'error');
      els.promptInput.focus();
      return;
    }
    // Character-only: Flow still needs a short action/text — default lightly
    if (!prompt && characters && characters.length) {
      prompt = 'in scene';
    }

    // Mode tabs are authoritative — never flip mode based on model mismatch.
    ensureModelForMode(state.mode);

    if (state.mode === 'image-to-image') {
      const hasRef = state.referenceImage && (state.referenceImage.id || state.referenceImage.staged_id);
      const hasChars = hasSelectedCharacters();
      const hasMulti = Boolean(state.multiRefImages && state.multiRefImages.length > 0);
      if (!hasRef && !hasChars && !hasMulti) {
        showToast('Select a reference image or character to edit.', 'warning');
        openRefPickerModal();
        return;
      }
      const ref = state.referenceImage;
      const isStaged = ref && ref.staged_id && (!ref.id || String(ref.id).startsWith('staged-'));
      if (!hasChars && !hasMulti && hasRef && !isStaged && ref.ready === false) {
        showToast('Wait until the reference shows “Ready” in Flow before generating.', 'warning');
        return;
      }
    }

    const mode = state.mode;
    const isImageMode = isImageFamilyMode(mode);
    if (isImageMode) {
      const modelKey = String(state.model || '').toUpperCase();
      if (/VEO|OMNI|ABRA|R2V|T2V/.test(modelKey)) {
        ensureModelForMode(mode);
      }
    }

    // Optimistic: acknowledge immediately — never sit on "Submitting Request..."
    // If an active generation is already in-flight, mark subsequent tasks as IN_QUEUE
    const hasActiveRunning = Array.from(state.activeTasks.values()).some((t) => t.status === 'PROCESSING' || t.status === 'PREPARING');
    const localId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const runId =
      (typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID()) ||
      `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const taskObj = {
      id: localId,
      runId,
      prompt,
      model: state.model,
      type: isImageMode ? 'image' : 'video',
      aspectRatio: state.aspectRatio || '16:9',
      startTime: Date.now(),
      status: hasActiveRunning ? 'IN_QUEUE' : 'PROCESSING',
      phase: hasActiveRunning ? 'queue' : 'ack',
      inQueue: hasActiveRunning,
      url: '',
    };
    state.activeTasks.set(localId, taskObj);
    state.selectedTaskId = localId;
    renderParallelTasksBar();
    renderGallery();
    showToast(hasActiveRunning ? 'Job added to queue' : 'Generation started', 'info');
    studioLog('info', `Generation queued (${mode}): ${prompt.slice(0, 100)}`, runId);

    // Capture character refs BEFORE clearing chips (clear wipes selectedCharacterIds)
    const charactersForJob = characters
      ? characters.map((c) => ({
          entity_id: c.flow_entity_id || c.entity_id,
          flow_entity_id: c.flow_entity_id || c.entity_id || null,
          character_id: c.character_id,
          name: c.name,
          image_media_id: c.image_media_id || null,
          image_url: c.image_url || null,
          local_image_path: c.local_image_path || null,
        }))
      : null;
    if (taskObj) taskObj.characters = charactersForJob;

    // Clear free-text + character chips / @tags for the next run
    if (state.clearPromptOnSubmit) {
      clearPromptAfterSubmit();
    }

    // Unlock Generate immediately so UI is never blocked on upload/auth
    state.isGenerating = false;
    updateGenerateButtonState();
    if (state.mode === 'video') {
      els.generateBtnText.textContent = 'Generate Video';
    } else if (state.mode === 'image-to-video') {
      els.generateBtnText.textContent = 'Animate Video (I2V)';
    } else if (state.mode === 'image-to-image') {
      els.generateBtnText.textContent = 'Edit Image (I2I)';
    } else {
      els.generateBtnText.textContent = 'Generate Image';
    }

    // Run upload + generate async in background
    (async () => {
      try {
        const isVideoFamily = state.mode === 'video' || state.mode === 'image-to-video' || state.mode === 'ingredients';
        if (isVideoFamily) {
          // If frames are set, animate transitions
          if (state.firstFrame || state.lastFrame || (state.referenceImage && (state.referenceImage.id || state.referenceImage.staged_id))) {
            await executeImageToVideo(prompt, localId, charactersForJob);
          } else if (state.ingredients && state.ingredients.length > 0) {
            await executeIngredientGeneration(prompt, localId, charactersForJob);
          } else {
            // Neither frame nor ingredient required: Standard Video Generation
            await executeVideoGeneration(prompt, localId, charactersForJob);
          }
        } else if (state.mode === 'image-to-image') {
          await executeImageToImage(prompt, localId, charactersForJob);
        } else {
          if ((state.multiRefImages && state.multiRefImages.length > 0) || (state.referenceImage && state.referenceImage.id)) {
            await executeImageToImage(prompt, localId, charactersForJob);
          } else {
            await executeImageGeneration(prompt, localId, charactersForJob);
          }
        }
        updateHeaderCredits();
      } catch (err) {
        console.error('Generation dispatch error:', err);
        const msg = err.message || 'Generation failed to start';
        console.warn('[Studio] Generation dispatch error (raw):', msg);
        const userMsg = toUserFacingGenerationError(msg);
        failPendingTask(localId, userMsg);
        showToast(userMsg, 'error');
        studioLog('error', msg, (state.activeTasks.get(localId) || {}).runId || runId);
        loadStudioLogs();

        // Refund credits if generation failed on backend
        if (deductRecord && deductRecord.transactionId) {
          fetch('/api/wallet/refund', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              transactionId: deductRecord.transactionId,
              reason: msg,
            }),
          }).then(() => updateHeaderCredits()).catch(() => {});
        }
      }
    })();
  }

  function failPendingTask(localId, message) {
    const task = state.activeTasks.get(localId);
    const rawMessage = message || 'Generation failed';
    const userMessage = toUserFacingGenerationError(rawMessage);
    if (rawMessage && rawMessage !== userMessage) {
      console.warn('[Studio] Generation failed (raw):', rawMessage);
    }
    const failedAsset = {
      id: localId,
      prompt: task ? task.prompt : 'Generation',
      type: task ? task.type : (state.mode === 'image' || state.mode === 'image-to-image' ? 'image' : 'video'),
      aspect_ratio: task ? task.aspectRatio : (state.aspectRatio || '16:9'),
      status: 'FAILED',
      error: userMessage,
      errorRaw: rawMessage,
      created_at: new Date().toISOString(),
    };
    state.activeTasks.delete(localId);

    // Keep failed card visible in gallery with retry button (never hide or vanish)
    const existingIdx = state.assets.findIndex((a) => a.id === localId);
    if (existingIdx >= 0) {
      state.assets[existingIdx] = failedAsset;
    } else {
      state.assets.unshift(failedAsset);
    }

    if (state.selectedTaskId === localId) {
      state.selectedTaskId = state.activeTasks.size
        ? state.activeTasks.keys().next().value
        : null;
    }
    renderParallelTasksBar();
    if (state.selectedTaskId && state.activeTasks.has(state.selectedTaskId)) {
      updateLiveProgressCardForTask(state.activeTasks.get(state.selectedTaskId));
    } else if (state.activeTasks.size === 0) {
      els.liveProgressCard.classList.add('hidden');
    }
    renderGallery();
  }

  async function handleCancelTask(taskId) {
    if (!taskId) return;
    try {
      const task = state.activeTasks.get(taskId);
      const runId = task && task.runId;
      if (runId) {
        studioLog('info', 'Cancelled by user', runId);
      }
      showToast('Cancelling generation...', 'info');
      state.activeTasks.delete(taskId);
      if (state.selectedTaskId === taskId) state.selectedTaskId = null;
      renderParallelTasksBar();
      renderGallery();

      const res = await fetch(`${API_BASE}/api/generations/${encodeURIComponent(taskId)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.warn('Cancel generation API response:', data);
        showToast(data.error || 'Cancel failed — please sign in again', 'error');
        await loadAssets();
        return;
      }
      showToast('Generation cancelled. Credits refunded.', 'success');
      await loadAssets();
      await fetchAuthStatus();
      updateHeaderCredits();
    } catch (err) {
      console.warn('Cancel generation warning:', err);
      showToast('Generation cancelled', 'info');
      await loadAssets();
      await fetchAuthStatus();
      updateHeaderCredits();
    }
  }

  function promotePendingTask(localId, asset, prompt) {
    const prev = state.activeTasks.get(localId) || {};
    state.activeTasks.delete(localId);
    if (!asset || !asset.id) {
      renderGallery();
      return null;
    }
    const isQueued = Boolean(asset.inQueue || asset.status === 'IN_QUEUE');
    const taskObj = {
      ...prev,
      ...asset,
      id: asset.id,
      runId: prev.runId || asset.runId,
      startTime: prev.startTime || asset.startTime || Date.now(),
      prompt: prompt || asset.prompt || prev.prompt,
      phase: isQueued ? 'queue' : 'render',
      status: isQueued ? 'IN_QUEUE' : (asset.status || 'PROCESSING'),
      inQueue: isQueued,
    };
    state.activeTasks.set(asset.id, taskObj);
    if (state.selectedTaskId === localId) state.selectedTaskId = asset.id;
    renderParallelTasksBar();
    updateLiveProgressCardForTask(taskObj);
    renderGallery();
    return taskObj;
  }

  function setTaskPhase(localId, phase, label) {
    const task = state.activeTasks.get(localId);
    if (!task) return;
    task.phase = phase;
    if (label) task.phaseLabel = label;
    if (state.selectedTaskId === localId) {
      updateLiveProgressCardForTask(task);
    }
  }

  async function executeImageGeneration(prompt, localId, charactersArg) {
    const count = Math.max(1, Math.min(state.imageCount || 1, 4));
    const task = state.activeTasks.get(localId) || {};
    const runId = task.runId;
    const startedAt = task.startTime || Date.now();
    setTaskPhase(localId, 'submit', count > 1 ? `Dispatching ${count} parallel images…` : 'Dispatching image generate…');
    studioLog('info', count > 1 ? `T2I ×${count}…` : 'T2I generating…', runId);

    let characters = charactersArg || task.characters || getSelectedCharactersPayload();
    if (characters) {
      setTaskPhase(localId, 'submit', 'Preparing characters in Flow…');
      characters = await ensureSelectedCharactersReadyFor(characters);
      const missingFlow = (characters || []).filter((c) => !c.flow_entity_id && !c.entity_id);
      if (missingFlow.length) {
        throw new Error('Character is not registered in Google Flow yet — recreate it with an image');
      }
    }
    const cleanPrompt = stripCharacterTagsFromPrompt(prompt, characters);

    const body = {
      prompt: cleanPrompt,
      aspect_ratio: state.aspectRatio,
      seed: state.seed,
      num_images: count,
      model: state.model,
      run_id: runId,
    };
    if (characters) body.characters = characters;

    setTaskPhase(localId, 'render', 'Waiting for image result…');
    const res = await fetch(`${API_BASE}/api/generate/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || errData.error || 'Image generation failed');
    }

    const data = await res.json();
    const elapsedMs = data.durationMs || (Date.now() - startedAt);
    const elapsedSec = data.durationSec || Math.max(0.1, elapsedMs / 1000);
    state.activeTasks.delete(localId);
    if (state.selectedTaskId === localId) state.selectedTaskId = null;
    renderParallelTasksBar();

    if (data.assets && data.assets.length > 0) {
      const first = data.assets[0];
      if (characters && characters.length && !first.characters) {
        first.characters = characters;
      }
      displayActiveAsset(first);
      loadAssets();
      fetchAuthStatus();
      const n = data.assets.length;
      const secs = Number(elapsedSec).toFixed(1);
      studioLog(
        'info',
        n > 1
          ? `T2I complete (${secs}s) ×${n}: ${prompt.slice(0, 80)}`
          : `T2I complete (${secs}s): ${prompt.slice(0, 80)}`,
        runId
      );
      loadStudioLogs();
      showToast(
        n > 1
          ? `${n} images ready in ${secs}s`
          : `Image ready in ${secs}s`,
        'success'
      );
      if (state.activeTasks.size === 0) els.liveProgressCard.classList.add('hidden');
    }
  }

  async function ensureReferenceUploaded() {
    const ref = state.referenceImage;
    if (!ref) return null;

    const needsUpload =
      !!ref.staged_id && (!ref.id || String(ref.id).startsWith('staged-') || ref.ready !== true);

    if (!needsUpload) {
      if (ref.id && ref.ready === false) {
        const ok = await pollReferenceReady(ref.id);
        if (!ok) throw new Error('Reference image is still processing in Flow');
      }
      return ref.id || null;
    }

    setReferenceReadyStatus('uploading');
    if (els.refId) els.refId.textContent = 'Uploading to Flow…';
    showToast(`Uploading "${ref.name || 'image'}" to Flow…`, 'info');
    studioLog(
      'info',
      `Uploading staged ${ref.staged_id} to Flow…`,
      (state.activeTasks.get(state.selectedTaskId) || {}).runId
    );

    const form = new FormData();
    form.append('staged_id', ref.staged_id);
    const res = await fetch(`${API_BASE}/api/assets/upload`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      setReferenceReadyStatus('error', errData.detail || 'Upload failed');
      throw new Error(errData.detail || 'Upload to Flow failed');
    }
    const data = await res.json();
    const asset = data.asset;
    if (!asset || !asset.id) {
      throw new Error('Upload returned no media id');
    }
    if (!asset.url && ref.url) asset.url = ref.url;

    const readyNow = asset.flow_ready === true || asset.status === 'COMPLETED';
    const keepPreview = ref.url;
    selectReferenceImage(asset, { assumeReady: readyNow });
    if (keepPreview && state.referenceImage && (!asset.url || String(asset.url).startsWith('data:'))) {
      state.referenceImage.url = keepPreview;
      if (els.refPreviewImg) els.refPreviewImg.src = keepPreview;
    }
    state.referenceImage.staged_id = null;

    if (!readyNow) {
      setReferenceReadyStatus('processing');
      const ok = await pollReferenceReady(asset.id);
      if (!ok) throw new Error('Reference image did not become ready in Flow');
    }
    loadAssets();
    return asset.id;
  }

  function getStagedIdForGenerate() {
    const ref = state.referenceImage;
    if (!ref) return null;
    if (ref.staged_id && (!ref.id || String(ref.id).startsWith('staged-') || ref.ready !== true)) {
      return ref.staged_id;
    }
    return null;
  }

  async function executeImageToImage(prompt, localId, charactersArg) {
    const task = state.activeTasks.get(localId) || {};
    let characters = charactersArg || task.characters || getSelectedCharactersPayload();
    if (characters) {
      setTaskPhase(localId, 'submit', 'Preparing characters in Flow…');
      characters = await ensureSelectedCharactersReadyFor(characters);
    }
    const cleanPrompt = stripCharacterTagsFromPrompt(prompt, characters);
    const stagedId = getStagedIdForGenerate();
    const hasFlowRef =
      state.referenceImage &&
      state.referenceImage.id &&
      !String(state.referenceImage.id).startsWith('staged-') &&
      !stagedId;

    const hasMultiRefs = Boolean(state.multiRefImages && state.multiRefImages.length > 0);
    if (!hasFlowRef && !stagedId && !characters && !hasMultiRefs) {
      showToast('Please select a reference image, multi-images, or character first!', 'warning');
      openRefPickerModal();
      failPendingTask(localId, 'No reference or character selected');
      return;
    }

    if (!hasMultiRefs && !characters && hasFlowRef && state.referenceImage.ready === false) {
      showToast('Reference image is still processing in Flow. Wait for Ready.', 'warning');
      failPendingTask(localId, 'Reference not ready');
      return;
    }

    ensureModelForMode('image-to-image');
    const count = Math.max(1, Math.min(state.imageCount || 1, 4));
    setTaskPhase(
      localId,
      stagedId ? 'upload' : 'submit',
      stagedId
        ? 'Uploading staged image to Flow…'
        : count > 1
          ? `Dispatching ${count} parallel I2I jobs…`
          : 'Dispatching Image-to-Image…'
    );
    const runId = (state.activeTasks.get(localId) || {}).runId;
    studioLog(
      'info',
      stagedId
        ? `I2I will upload staged ${stagedId} then generate ×${count}`
        : `I2I ×${count}…`,
      runId
    );

    const body = {
      prompt: cleanPrompt,
      aspect_ratio: state.aspectRatio,
      seed: state.seed,
      model: state.model,
      num_images: count,
      run_id: runId,
    };
    if (stagedId) body.staged_id = stagedId;
    else if (hasFlowRef) body.image_id = state.referenceImage.id;
    if (characters) body.characters = characters;

    // Multi-reference images
    if (state.multiRefImages && state.multiRefImages.length > 0) {
      const mids = [];
      const sids = [];
      state.multiRefImages.forEach(img => {
        if (img.staged_id) sids.push(img.staged_id);
        else if (img.id) mids.push(img.id);
      });
      if (mids.length) body.image_ids = mids;
      if (sids.length) body.staged_ids = sids;
    }

    setTaskPhase(localId, 'render', 'Waiting for remix result…');
    const res = await fetch(`${API_BASE}/api/generate/image-to-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || 'Image-to-Image remix failed');
    }

    const data = await res.json();
    if (data.uploaded_image_id && state.referenceImage) {
      state.referenceImage.id = data.uploaded_image_id;
      state.referenceImage.staged_id = null;
      state.referenceImage.ready = true;
      setReferenceReadyStatus('ready');
      if (els.refId) els.refId.textContent = `ID: ${data.uploaded_image_id}`;
    }

    const asset = data.asset || (data.assets && data.assets[0]);
    if (asset && (asset.status === 'IN_QUEUE' || asset.inQueue)) {
      const taskObj = promotePendingTask(localId, { ...asset, status: 'IN_QUEUE', inQueue: true, type: 'image' }, prompt);
      showToast(asset.queueMessage || data.message || 'In queue…', 'info');
      loadStudioLogs();
      loadAssets();
      startBackgroundPollingLoop();
      if (taskObj) updateLiveProgressCardForTask(taskObj);
      return;
    }
    if (asset && (asset.status === 'PROCESSING' || asset.status === 'PENDING' || asset.status === 'GENERATING' || asset.status === 'PREPARING') && !asset.url) {
      const taskObj = promotePendingTask(localId, { ...asset, type: 'image' }, prompt);
      showToast('Image remix rendering in background…', 'info');
      loadStudioLogs();
      loadAssets();
      fetchAuthStatus();
      startBackgroundPollingLoop();
      if (taskObj) updateLiveProgressCardForTask(taskObj);
      return;
    }

    const i2iStartedAt = (state.activeTasks.get(localId) || {}).startTime || Date.now();

    if (data.assets && data.assets.length > 0 && data.assets.some((a) => a && a.url)) {
      state.activeTasks.delete(localId);
      if (state.selectedTaskId === localId) state.selectedTaskId = null;
      renderParallelTasksBar();
      const first = data.assets.find((a) => a && a.url) || data.assets[0];
      if (first.url) displayActiveAsset(first);
      loadAssets();
      fetchAuthStatus();
      const n = data.assets.filter((a) => a && a.url).length || data.assets.length;
      const secs = ((Date.now() - i2iStartedAt) / 1000).toFixed(1);
      studioLog(
        'info',
        n > 1
          ? `I2I complete (${secs}s) ×${n}: ${prompt.slice(0, 80)}`
          : `I2I complete (${secs}s): ${prompt.slice(0, 80)}`,
        runId
      );
      loadStudioLogs();
      showToast(
        n > 1 ? `${n} images remixed in ${secs}s` : `Image remixed in ${secs}s`,
        'success'
      );
      if (state.activeTasks.size === 0) els.liveProgressCard.classList.add('hidden');
      return;
    }

    if (asset && asset.status === 'COMPLETED' && asset.url) {
      state.activeTasks.delete(localId);
      if (state.selectedTaskId === localId) state.selectedTaskId = null;
      renderParallelTasksBar();
      displayActiveAsset(asset);
      loadAssets();
      fetchAuthStatus();
      const secs = ((Date.now() - i2iStartedAt) / 1000).toFixed(1);
      studioLog('info', `I2I complete (${secs}s): ${prompt.slice(0, 80)}`, runId);
      loadStudioLogs();
      showToast(`Image remixed in ${secs}s`, 'success');
      if (state.activeTasks.size === 0) els.liveProgressCard.classList.add('hidden');
      return;
    }

    throw new Error(
      (asset && (asset.error || asset.errorMessage || asset.queueMessage)) ||
        data.error ||
        data.message ||
        'Image-to-Image remix failed'
    );
  }

  async function executeImageToVideo(prompt, localId, charactersArg) {
    const task = state.activeTasks.get(localId) || {};
    let characters = charactersArg || task.characters || getSelectedCharactersPayload();
    if (characters) {
      setTaskPhase(localId, 'submit', 'Preparing characters in Flow…');
      characters = await ensureSelectedCharactersReadyFor(characters);
    }
    const cleanPrompt = stripCharacterTagsFromPrompt(prompt, characters);
    const stagedId = getStagedIdForGenerate();
    const hasFlowRef =
      state.referenceImage &&
      state.referenceImage.id &&
      !String(state.referenceImage.id).startsWith('staged-') &&
      !stagedId;

    const hasFrameRefs = Boolean(state.firstFrame || state.lastFrame);
    if (!hasFlowRef && !stagedId && !characters && !hasFrameRefs) {
      // Neither frame nor ingredient required for video generation: fallback cleanly to T2V
      return await executeVideoGeneration(cleanPrompt, localId, characters);
    }

    if (!hasFrameRefs && !characters && hasFlowRef && state.referenceImage.ready === false) {
      showToast('Wait until the image is Ready in Flow before animating.', 'warning');
      failPendingTask(localId, 'Reference not ready');
      return;
    }

    ensureModelForMode('image-to-video');
    setTaskPhase(
      localId,
      stagedId ? 'upload' : 'submit',
      stagedId ? 'Uploading staged image to Flow…' : 'Dispatching Image-to-Video…'
    );
    const runId = (state.activeTasks.get(localId) || {}).runId;
    studioLog(
      'info',
      stagedId ? `I2V will upload staged ${stagedId} then animate` : 'I2V animating…',
      runId
    );

    const body = {
      prompt: cleanPrompt,
      aspect_ratio: state.aspectRatio,
      duration: state.duration,
      model: state.model,
      run_id: runId,
    };
    if (stagedId) body.staged_id = stagedId;
    else if (hasFlowRef) body.image_id = state.referenceImage.id;
    if (characters) body.characters = characters;

    // Attach First & Last Frame if specified (first_only, last_only, or first_and_last)
    const hasFirst = Boolean(state.firstFrame && (state.firstFrame.id || state.firstFrame.staged_id || state.firstFrame.url));
    const hasLast = Boolean(state.lastFrame && (state.lastFrame.id || state.lastFrame.staged_id || state.lastFrame.url));

    if (hasFirst && hasLast) {
      body.frame_mode = 'first_and_last';
      if (state.firstFrame.staged_id) body.first_frame_staged_id = state.firstFrame.staged_id;
      if (state.firstFrame.id) body.first_frame_id = state.firstFrame.id;
      if (state.lastFrame.staged_id) body.last_frame_staged_id = state.lastFrame.staged_id;
      if (state.lastFrame.id) body.last_frame_id = state.lastFrame.id;
    } else if (hasLast && !hasFirst) {
      body.frame_mode = 'last_only';
      delete body.image_id;
      delete body.staged_id;
      if (state.lastFrame.staged_id) body.last_frame_staged_id = state.lastFrame.staged_id;
      if (state.lastFrame.id) body.last_frame_id = state.lastFrame.id;
    } else if (hasFirst && !hasLast) {
      body.frame_mode = 'first_only';
      if (state.firstFrame.staged_id) body.first_frame_staged_id = state.firstFrame.staged_id;
      if (state.firstFrame.id) body.first_frame_id = state.firstFrame.id;
    } else {
      if (state.frameMode) body.frame_mode = state.frameMode;
    }

    setTaskPhase(localId, 'submit', 'Submitting to Veo…');
    const res = await fetch(`${API_BASE}/api/generate/image-to-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || 'Image-to-Video animation failed');
    }

    const data = await res.json();
    const asset = data.asset;

    if (data.uploaded_image_id && state.referenceImage) {
      state.referenceImage.id = data.uploaded_image_id;
      state.referenceImage.staged_id = null;
      state.referenceImage.ready = true;
      setReferenceReadyStatus('ready');
      if (els.refId) els.refId.textContent = `ID: ${data.uploaded_image_id}`;
    }

    const taskObj = promotePendingTask(localId, asset, prompt);
    showToast('Veo animation rendering in background! You can submit another prompt.', 'success');
    loadStudioLogs();

    if (asset.status === 'COMPLETED' && asset.url) {
      state.activeTasks.delete(asset.id);
      renderParallelTasksBar();
      displayActiveAsset(asset);
      loadAssets();
      fetchAuthStatus();
      if (state.activeTasks.size === 0) els.liveProgressCard.classList.add('hidden');
      return;
    }

    loadAssets();
    fetchAuthStatus();
    startBackgroundPollingLoop();
    if (taskObj) updateLiveProgressCardForTask(taskObj);
  }

  async function executeVideoGeneration(prompt, localId, charactersArg) {
    const task = state.activeTasks.get(localId) || {};
    const runId = task.runId;
    setTaskPhase(localId, 'submit', 'Dispatching video generate…');
    studioLog('info', `T2V: ${prompt.slice(0, 80)}`, runId);

    let characters = charactersArg || task.characters || getSelectedCharactersPayload();
    if (characters) {
      setTaskPhase(localId, 'submit', 'Preparing characters in Flow…');
      characters = await ensureSelectedCharactersReadyFor(characters);
    }
    const cleanPrompt = stripCharacterTagsFromPrompt(prompt, characters);

    const body = {
      prompt: cleanPrompt,
      aspect_ratio: state.aspectRatio,
      duration: state.duration,
      seed: state.seed,
      model: state.model,
      run_id: runId,
    };
    if (characters) body.characters = characters;

    const res = await fetch(`${API_BASE}/api/generate/video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || 'Video generation failed');
    }

    const data = await res.json();
    const asset = data.asset;
    const taskObj = promotePendingTask(localId, asset, prompt);

    if (asset.status === 'COMPLETED' && asset.url) {
      const started = (taskObj && taskObj.startTime) || Date.now();
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      studioLog('info', `T2V complete (${secs}s): ${prompt.slice(0, 80)}`, runId);
      state.activeTasks.delete(asset.id);
      renderParallelTasksBar();
      displayActiveAsset(asset);
      loadAssets();
      fetchAuthStatus();
      loadStudioLogs();
      showToast(`Video ready in ${secs}s`, 'success');
      if (state.activeTasks.size === 0) els.liveProgressCard.classList.add('hidden');
      return;
    }

    studioLog('info', 'T2V submitted — waiting for Flow render…', runId);
    showToast('Veo video rendering in background! You can submit another prompt.', 'success');
    loadStudioLogs();
    loadAssets();
    fetchAuthStatus();
    startBackgroundPollingLoop();
    if (taskObj) updateLiveProgressCardForTask(taskObj);
  }

  // ---------------------------------------------------------------------------
  // BACKGROUND MULTI-TASK POLLING & PARALLEL QUEUE
  // ---------------------------------------------------------------------------
  let backgroundPollingActive = false;
  const toastedReadyIds = new Set();
  const completingTaskIds = new Set();

  function startBackgroundPollingLoop() {
    if (backgroundPollingActive) return;
    backgroundPollingActive = true;

    const interval = setInterval(async () => {
      if (state.activeTasks.size === 0) {
        clearInterval(interval);
        backgroundPollingActive = false;
        els.parallelTasksBar.classList.add('hidden');
        els.liveProgressCard.classList.add('hidden');
        return;
      }

      renderParallelTasksBar();

      // Poll each active task concurrently
      const tasks = Array.from(state.activeTasks.values());
      await Promise.allSettled(tasks.map(async (task) => {
        try {
          // Poll video + async I2I/ingredients image jobs via the same status endpoint
          if (task.type && task.type !== 'video' && task.type !== 'image') {
            state.activeTasks.delete(task.id);
            return;
          }
          if (completingTaskIds.has(task.id)) return;
          const res = await fetch(`${API_BASE}/api/video/status/${task.id}`);
          if (!res.ok) return;
          const data = await res.json();
          const updated = data.asset;

          if (updated.status === 'COMPLETED') {
            // Mark finished BEFORE any await so overlapping polls cannot re-log
            if (completingTaskIds.has(task.id)) return;
            completingTaskIds.add(task.id);
            state.activeTasks.delete(task.id);
            if (state.selectedTaskId === task.id) state.selectedTaskId = null;
            if (!toastedReadyIds.has(task.id)) {
              toastedReadyIds.add(task.id);
              const label = task.type === 'image' ? 'Image ready' : 'Video ready';
              showToast(`${label}: "${(updated.prompt || 'Scene').slice(0, 35)}..."`, 'success');
            }
            // Keep runId on gallery asset so later upscale joins the same Studio log run
            if (task.runId) {
              const assetMatch = state.assets.find((a) => a.id === task.id || a.id === updated.id);
              if (assetMatch) assetMatch.runId = task.runId;
              if (updated) updated.runId = task.runId;
            }
            // Safety net: status API should write Video complete; also log client-side once
            if (task.runId && !toastedReadyIds.has(`log-${task.id}`)) {
              toastedReadyIds.add(`log-${task.id}`);
              const secs = task.startTime
                ? ((Date.now() - task.startTime) / 1000).toFixed(1)
                : undefined;
              const kind =
                task.type === 'image'
                  ? 'I2I'
                  : /ingredient/i.test(String(task.mode || task.source || ''))
                    ? 'Ingredients'
                    : 'Video';
              studioLog(
                'info',
                `${kind} complete${secs ? ` (${secs}s)` : ''}: ${(updated.prompt || task.prompt || 'scene').slice(0, 80)}`,
                task.runId
              );
              loadStudioLogs();
            }

            // If this task was currently selected or stage is empty, display it
            if (updated.url && (!state.activeItem || !state.activeItem.url)) {
              displayActiveAsset(updated);
            }
            loadAssets();
          } else if (updated.status === 'FAILED') {
            if (completingTaskIds.has(task.id)) return;
            completingTaskIds.add(task.id);
            // Failure log is written once by /api/video/status (source=generate)
            failPendingTask(task.id, updated.error || 'Video generation failed');
            if (!toastedReadyIds.has(`fail-${task.id}`)) {
              toastedReadyIds.add(`fail-${task.id}`);
              showToast(
                toUserFacingGenerationError(updated.error || 'Video generation failed'),
                'error'
              );
            }
            loadAssets();
          } else if (updated.status === 'IN_QUEUE') {
            task.status = 'IN_QUEUE';
            task.inQueue = true;
            task.error = updated.error;
            patchWorkingGalleryCard(task);
          } else if (updated.status === 'PROCESSING' || updated.status === 'PREPARING' || updated.status === 'GENERATING') {
            task.status = 'PROCESSING';
            task.inQueue = false;
            if (updated.progress) task.progress = updated.progress;
            patchWorkingGalleryCard(task);
          }
        } catch (e) {
          console.warn('Poll status error for', task.id, e);
        }
      }));

      // Update selected task in progress card if active
      if (state.selectedTaskId && state.activeTasks.has(state.selectedTaskId)) {
        updateLiveProgressCardForTask(state.activeTasks.get(state.selectedTaskId));
      } else if (state.activeTasks.size > 0) {
        const first = state.activeTasks.values().next().value;
        state.selectedTaskId = first.id;
        updateLiveProgressCardForTask(first);
      } else {
        els.liveProgressCard.classList.add('hidden');
      }

      renderParallelTasksBar();
    }, 3500);
  }

  function renderParallelTasksBar() {
    const count = state.activeTasks.size;
    if (count === 0) {
      els.parallelTasksBar.classList.add('hidden');
      return;
    }

    els.parallelTasksBar.classList.remove('hidden');
    els.parallelCount.textContent = count;
    els.parallelTasksList.innerHTML = '';

    state.activeTasks.forEach(task => {
      const elapsed = Math.floor((Date.now() - (task.startTime || Date.now())) / 1000);
      const pill = document.createElement('div');
      pill.className = `task-pill ${state.selectedTaskId === task.id ? 'active' : ''}`;
      pill.innerHTML = `
        <div class="spinner-ring sm"></div>
        <span class="task-name" title="${task.prompt}">${task.prompt || 'Veo Video'}</span>
        <span class="task-timer">${elapsed}s</span>
      `;
      pill.addEventListener('click', () => {
        state.selectedTaskId = task.id;
        updateLiveProgressCardForTask(task);
        renderParallelTasksBar();
      });
      els.parallelTasksList.appendChild(pill);
    });
  }

  function updateLiveProgressCardForTask(task) {
    els.liveProgressCard.classList.remove('hidden');
    const elapsed = Math.floor((Date.now() - (task.startTime || Date.now())) / 1000);
    els.progressTimer.textContent = `${elapsed}s`;

    const phase = task.phase || 'render';
    const label =
      task.phaseLabel ||
      (phase === 'ack'
        ? 'Processing…'
        : phase === 'upload'
          ? 'Uploading to Flow…'
          : phase === 'submit'
            ? 'Dispatching generate…'
            : phase === 'error'
              ? toUserFacingGenerationError(task.error || 'Failed')
              : `Rendering (${task.model || 'Flow'})…`);
    els.progressStageText.textContent = label;

    const widths = { ack: '12%', upload: '35%', submit: '55%', render: '80%', error: '100%' };
    els.progressBarFill.style.width = widths[phase] || '70%';

    const mark = (el, state) => {
      if (!el) return;
      el.className = `step-item ${state}`;
    };
    if (phase === 'ack') {
      mark(els.stepAuth, 'active');
      mark(els.stepRecaptcha, '');
      mark(els.stepSubmit, '');
      mark(els.stepRender, '');
    } else if (phase === 'upload') {
      mark(els.stepAuth, 'done');
      mark(els.stepRecaptcha, 'active');
      mark(els.stepSubmit, '');
      mark(els.stepRender, '');
    } else if (phase === 'submit') {
      mark(els.stepAuth, 'done');
      mark(els.stepRecaptcha, 'done');
      mark(els.stepSubmit, 'active');
      mark(els.stepRender, '');
    } else if (phase === 'error') {
      mark(els.stepAuth, 'done');
      mark(els.stepRecaptcha, 'done');
      mark(els.stepSubmit, 'done');
      mark(els.stepRender, 'active');
    } else {
      mark(els.stepAuth, 'done');
      mark(els.stepRecaptcha, 'done');
      mark(els.stepSubmit, 'done');
      mark(els.stepRender, 'active');
    }
  }

  // ---------------------------------------------------------------------------
  // STAGE & MEDIA DISPLAY
  // ---------------------------------------------------------------------------
  function displayActiveAsset(item) {
    state.activeItem = item;
    els.stagePlaceholder.classList.add('hidden');
    els.stageDrawer.classList.remove('hidden');

    const aspect = item.aspect_ratio || '16:9';
    const aspectParts = String(aspect).split(/[:/xX]/).map(Number);
    const aspectW = aspectParts[0] > 0 ? aspectParts[0] : 16;
    const aspectH = aspectParts[1] > 0 ? aspectParts[1] : 9;
    const isPortrait = aspectH > aspectW;

    if (els.stageCard) {
      els.stageCard.classList.add('has-media');
      els.stageCard.classList.toggle('is-video', item.type === 'video');
      els.stageCard.classList.toggle('is-image', item.type === 'image');
      els.stageCard.classList.toggle('is-portrait', isPortrait);
      els.stageCard.style.setProperty('--stage-aspect', `${aspectW} / ${aspectH}`);
    }

    if (els.stageItemName) els.stageItemName.textContent = item.name || 'Generation Output';
    if (els.stageItemModel) {
      els.stageItemModel.textContent = resolveItemModelLabel(item);
    }
    if (els.stageItemAspect) els.stageItemAspect.textContent = aspect;
    if (els.stageItemSeed) els.stageItemSeed.textContent = `Seed: ${item.seed || 'N/A'}`;
    if (els.stageItemPrompt) {
      const chars = item.characters || item.characterIds || [];
      const charObjs = Array.isArray(chars)
        ? chars.map((c) => (typeof c === 'string' ? { name: c } : c))
        : [];
      els.stageItemPrompt.innerHTML = formatPromptWithCharacterChipsHtml(item.prompt || '', charObjs);
    }

    // Show extend button only for videos, animate/remix buttons for images
    if (els.stageExtendBtn) els.stageExtendBtn.style.display = item.type === 'video' ? '' : 'none';
    if (els.stageAnimateBtn) els.stageAnimateBtn.style.display = item.type === 'image' ? '' : 'none';
    if (els.stageRemixBtn) els.stageRemixBtn.style.display = item.type === 'image' ? '' : 'none';

    // Google Flow Project Deep-link
    if (els.stageOpenFlowBtn) {
      const pUrl = item.project_url || state.activeProjectUrl || projectUrl(state.activeProjectId);
      els.stageOpenFlowBtn.href = pUrl;
    }

    if (item.type === 'video') {
      els.imageStageContainer.classList.add('hidden');
      els.videoStageContainer.classList.remove('hidden');
      els.stageVideo.src = item.url;
      els.stageVideo.load();
      els.stageVideo.play().catch(() => {});
    } else {
      els.videoStageContainer.classList.add('hidden');
      els.imageStageContainer.classList.remove('hidden');
      els.stageImage.src = item.url;
    }
  }

  function handleDownloadStageAsset() {
    if (!state.activeItem || !state.activeItem.url) return;
    const ext = state.activeItem.type === 'video' ? 'mp4' : 'png';
    const filename = `google-flow-${state.activeItem.id}.${ext}`;
    
    const a = document.createElement('a');
    a.href = state.activeItem.url;
    a.download = filename;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('Download started', 'info');
  }

  // ---------------------------------------------------------------------------
  // REFERENCE IMAGE LIBRARY PICKER & CONTROLS (Google Flow 3-Column Modal)
  // ---------------------------------------------------------------------------
  let _selectedPickerAsset = null;
  let _currentPickerCategory = 'all';
  let _pickerInitialized = false;

  function initAssetPickerControlsOnce() {
    if (_pickerInitialized) return;
    _pickerInitialized = true;

    // Search input
    const searchInput = document.getElementById('picker-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        renderPickerAssetsList();
      });
    }

    // Categories nav buttons
    document.querySelectorAll('.picker-cat-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.picker-cat-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _currentPickerCategory = btn.dataset.cat || 'all';
        renderPickerAssetsList();
      });
    });

    // Stage Video Controls (Play/Pause & Audio)
    const playPauseBtn = document.getElementById('picker-play-pause-btn');
    const stageVideo = document.getElementById('picker-stage-video');
    if (playPauseBtn && stageVideo) {
      playPauseBtn.addEventListener('click', () => {
        if (stageVideo.paused) {
          stageVideo.play().catch(() => {});
        } else {
          stageVideo.pause();
        }
      });
    }

    const audioBtn = document.getElementById('picker-audio-toggle-btn');
    if (audioBtn && stageVideo) {
      audioBtn.addEventListener('click', () => {
        stageVideo.muted = !stageVideo.muted;
        audioBtn.style.opacity = stageVideo.muted ? '0.6' : '1';
      });
    }

    // Direct Upload Media Button
    const uploadBtn = document.getElementById('picker-upload-media-btn');
    const fileInput = document.getElementById('picker-direct-file-input');
    const uploadLabel = document.getElementById('picker-upload-media-label');
    const uploadProgress = document.getElementById('picker-upload-progress');
    const uploadProgressText = document.getElementById('picker-upload-progress-text');
    const uploadProgressBar = document.getElementById('picker-upload-progress-bar');

    function setPickerUploadUi(active, label, percent) {
      if (uploadBtn) {
        uploadBtn.disabled = !!active;
        uploadBtn.classList.toggle('is-uploading', !!active);
      }
      if (uploadLabel) uploadLabel.textContent = active ? 'Uploading…' : 'Upload media';
      if (uploadProgress) uploadProgress.classList.toggle('hidden', !active);
      if (uploadProgressText && label) uploadProgressText.textContent = label;
      if (uploadProgressBar) {
        if (typeof percent === 'number' && percent >= 0) {
          uploadProgressBar.classList.remove('is-indeterminate');
          uploadProgressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
        } else if (active) {
          uploadProgressBar.classList.add('is-indeterminate');
          uploadProgressBar.style.width = '40%';
        } else {
          uploadProgressBar.classList.remove('is-indeterminate');
          uploadProgressBar.style.width = '0%';
        }
      }
    }

    function stageFileWithProgress(file, onProgress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_BASE}/api/assets/stage`);
        xhr.responseType = 'json';
        xhr.upload.onprogress = (ev) => {
          if (!ev.lengthComputable) return;
          const pct = Math.round((ev.loaded / ev.total) * 100);
          if (typeof onProgress === 'function') onProgress(pct);
        };
        xhr.onload = () => {
          const data = xhr.response || {};
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(data);
            return;
          }
          reject(new Error(data.detail || data.error || `Staging failed (${xhr.status})`));
        };
        xhr.onerror = () => reject(new Error('Network error while uploading'));
        xhr.onabort = () => reject(new Error('Upload cancelled'));
        const form = new FormData();
        form.append('file', file, file.name);
        xhr.send(form);
      });
    }

    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener('click', () => {
        if (uploadBtn.disabled) return;
        fileInput.click();
      });
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const localUrl = URL.createObjectURL(file);
        const isVideo = file.type.startsWith('video/');
        const placeholderId = `uploading-${Date.now()}`;

        setPickerUploadUi(true, `Uploading ${file.name}…`, 0);
        showToast(`Uploading "${file.name}"…`, 'info');

        const placeholder = {
          id: placeholderId,
          staged_id: null,
          name: file.name,
          prompt: file.name,
          url: localUrl,
          type: isVideo ? 'video' : 'image',
          category: 'upload',
          source: 'upload',
          flow_ready: false,
          ready: false,
          _uploading: true,
        };
        state.assets.unshift(placeholder);
        _selectedPickerAsset = placeholder;
        _currentPickerCategory = 'upload';
        document.querySelectorAll('.picker-cat-btn').forEach((b) => {
          b.classList.toggle('active', b.dataset.cat === 'upload');
        });
        renderPickerAssetsList();

        let stageData = null;
        try {
          stageData = await stageFileWithProgress(file, (pct) => {
            setPickerUploadUi(true, `Uploading ${file.name}… ${pct}%`, pct);
          });
          setPickerUploadUi(true, `Finishing "${file.name}"…`, 100);
        } catch (err) {
          console.warn('Direct upload staging error:', err);
          state.assets = state.assets.filter((a) => a.id !== placeholderId);
          renderPickerAssetsList();
          setPickerUploadUi(false);
          showToast(err.message || 'Staging failed', 'error');
          e.target.value = '';
          return;
        }

        const stagedId = pickStagedIdFromStageResponse(stageData);
        if (!stagedId) {
          state.assets = state.assets.filter((a) => a.id !== placeholderId);
          renderPickerAssetsList();
          setPickerUploadUi(false);
          showToast('Staging returned no staged-* id', 'error');
          e.target.value = '';
          return;
        }
        const assetMeta = (stageData && stageData.asset) || stageData || {};
        const newAsset = {
          id: assetMeta.id || stagedId,
          staged_id: stagedId,
          name: file.name,
          prompt: file.name,
          url: assetMeta.url || localUrl,
          type: isVideo ? 'video' : 'image',
          category: 'upload',
          source: 'upload',
          flow_ready: false,
          ready: false,
        };
        const idx = state.assets.findIndex((a) => a.id === placeholderId);
        if (idx >= 0) state.assets[idx] = newAsset;
        else state.assets.unshift(newAsset);
        _selectedPickerAsset = newAsset;
        _currentPickerCategory = 'upload';
        document.querySelectorAll('.picker-cat-btn').forEach((b) => {
          b.classList.toggle('active', b.dataset.cat === 'upload');
        });
        renderPickerAssetsList();
        setPickerUploadUi(false);
        showToast(`Uploaded "${file.name}"!`, 'success');
        e.target.value = '';

        // If the picker modal was opened with a callback (e.g. for Start Frame or End Frame or Ingredient), auto-select!
        if (state.refPickerCallback) {
          state.refPickerCallback(newAsset);
          closeRefPickerModal();
        }
      });
    }

    // "Add to prompt" Button
    const addToPromptBtn = document.getElementById('picker-add-to-prompt-btn');
    if (addToPromptBtn) {
      addToPromptBtn.addEventListener('click', () => {
        confirmPickerSelection(_selectedPickerAsset);
      });
    }

    // Close button
    const closeBtn = document.getElementById('close-ref-picker-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeRefPickerModal);
  }

  function openRefPickerModal(customCallback, modalTitle) {
    state.refPickerCallback = typeof customCallback === 'function' ? customCallback : null;
    initAssetPickerControlsOnce();

    // Set modal title (frame_005.jpg: "Select a frame image", or "Select an asset")
    const titleEl = document.getElementById('ref-picker-dialog-title');
    if (titleEl) {
      titleEl.textContent = modalTitle || 'Select a frame image';
    }

    // Set project name in modal header
    const projLabel = document.getElementById('picker-project-name');
    if (projLabel) {
      projLabel.textContent = (state.activeProjectName || 'API Create Check').slice(0, 20);
    }

    const searchInput = document.getElementById('picker-search-input');
    if (searchInput) searchInput.value = '';

    _currentPickerCategory = 'all';
    document.querySelectorAll('.picker-cat-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.cat === 'all');
    });

    renderPickerAssetsList();
    if (els.refPickerModal) els.refPickerModal.classList.remove('hidden');
  }

  function renderPickerAssetsList() {
    if (!els.refLibraryGrid) return;
    els.refLibraryGrid.innerHTML = '';

    const searchInput = document.getElementById('picker-search-input');
    const query = (searchInput ? searchInput.value : '').toLowerCase().trim();

    // Render active generating tasks at top of list (matching frame_015.jpg)
    const activeTasks = Array.from(state.activeTasks.values()).filter(t => t.status === 'PROCESSING' && t.type === 'image');
    if (_currentPickerCategory === 'all' && !query) {
      activeTasks.forEach(task => {
        const row = document.createElement('div');
        row.className = 'picker-asset-row generating';
        row.style.cursor = 'default';
        row.innerHTML = `
          <div class="picker-asset-thumb" style="display: flex; align-items: center; justify-content: center; background: #26262b;">
            <div class="picker-item-loader-spinner"></div>
          </div>
          <div class="picker-asset-info">
            <span class="picker-asset-title">${escapeHtml((task.prompt || 'GENERATING').slice(0, 25))}</span>
            <span class="picker-asset-badge">Image</span>
          </div>
        `;
        els.refLibraryGrid.appendChild(row);
      });
    }

    // 1. Characters
    const charAssets = (state.characters || []).map(c => ({
      id: c.character_id || c.entity_id || c.id,
      character_id: c.character_id || c.entity_id || c.id,
      url: c.image_url,
      prompt: c.display_name || c.name || 'Character',
      name: c.display_name || c.name || 'Character',
      type: 'character',
      category: 'character',
      isCharacter: true,
    })).filter(c => c.url);

    // 2. Assets (Exclude videos from reference library)
    const rawAssets = (state.assets || []).filter(a => a.type !== 'video' && a.category !== 'video').map(a => ({
      id: a.id,
      url: a.url,
      prompt: a.prompt || a.name || 'Asset',
      name: a.name || a.prompt || 'Asset',
      type: 'image',
      category: 'image',
      source: a.source,
      _uploading: !!a._uploading,
    })).filter(a => a.url);

    // Merge and deduplicate by URL
    const seenUrls = new Set();
    const allItems = [];
    [...charAssets, ...rawAssets].forEach(item => {
      if (item.url && !seenUrls.has(item.url)) {
        seenUrls.add(item.url);
        allItems.push(item);
      }
    });

    // Filter by category: only all, image, character, upload
    let filtered = allItems;
    if (_currentPickerCategory === 'image') {
      filtered = allItems.filter(i => i.type === 'image' || i.category === 'image');
    } else if (_currentPickerCategory === 'character') {
      filtered = allItems.filter(i => i.isCharacter || i.category === 'character' || i.type === 'character');
    } else if (_currentPickerCategory === 'upload') {
      filtered = allItems.filter(i =>
        i.source === 'upload' ||
        i._uploading ||
        String(i.id || '').startsWith('upload-') ||
        String(i.id || '').startsWith('staged-') ||
        String(i.id || '').startsWith('uploading-')
      );
    }

    // Filter by query
    if (query) {
      filtered = filtered.filter(i =>
        (i.name || '').toLowerCase().includes(query) ||
        (i.prompt || '').toLowerCase().includes(query)
      );
    }

    if (filtered.length === 0) {
      els.refLibraryGrid.innerHTML = `
        <div style="padding: 32px 14px; text-align: center; color: #71717a; font-size: 13px;">
          No matching assets found
        </div>
      `;
      updatePickerStagePreview(null);
      return;
    }

    if (!_selectedPickerAsset || !filtered.some(f => f.url === _selectedPickerAsset.url)) {
      _selectedPickerAsset = filtered[0];
    }

    filtered.forEach(item => {
      const row = document.createElement('div');
      const isSelected = _selectedPickerAsset && _selectedPickerAsset.url === item.url;
      row.className = `picker-asset-row ${isSelected ? 'active' : ''}${item._uploading ? ' is-uploading-placeholder' : ''}`;
      const badgeText = item._uploading ? 'Uploading…' : (item.isCharacter ? 'Character' : 'Image');
      row.innerHTML = `
        <div class="picker-asset-thumb">
          <img src="${item.url}" alt="${escapeHtml(item.name)}" loading="lazy" data-asset-id="${escapeHtml(item.id || '')}" />
          ${item._uploading ? '<div class="picker-item-loader-spinner" style="position:absolute;inset:0;margin:auto;"></div>' : ''}
        </div>
        <div class="picker-asset-info">
          <span class="picker-asset-title">${escapeHtml(item.name || item.prompt || 'Untitled')}</span>
          <span class="picker-asset-badge">${badgeText}</span>
        </div>
      `;
      const thumbImg = row.querySelector('img');
      if (thumbImg) {
        let retriedJpg = false;
        thumbImg.addEventListener('error', () => {
          const src = thumbImg.getAttribute('src') || thumbImg.src || '';
          if (!retriedJpg && src.includes('.mp4')) {
            retriedJpg = true;
            thumbImg.src = src.replace(/\.mp4$/, '.jpg');
            return;
          }
          // Hide broken thumb in picker only — do not DELETE; 24h expiry owns cleanup
          row.remove();
        });
      }
      row.addEventListener('click', () => {
        _selectedPickerAsset = item;
        document.querySelectorAll('.picker-asset-row').forEach(r => r.classList.remove('active'));
        row.classList.add('active');
        updatePickerStagePreview(item);
      });
      row.addEventListener('dblclick', () => {
        confirmPickerSelection(item);
      });
      els.refLibraryGrid.appendChild(row);
    });

    updatePickerStagePreview(_selectedPickerAsset);
  }

  function updatePickerStagePreview(item) {
    const stageVideo = document.getElementById('picker-stage-video');
    const stageImg = document.getElementById('picker-stage-image');
    const stageEmpty = document.getElementById('picker-stage-empty');
    const stageControls = document.getElementById('picker-stage-controls');
    const filmstrip = document.getElementById('picker-filmstrip-bar');

    if (stageControls) stageControls.classList.add('hidden');
    if (filmstrip) filmstrip.classList.add('hidden');
    if (stageVideo) {
      stageVideo.pause();
      stageVideo.classList.add('hidden');
    }

    if (!item) {
      if (stageImg) stageImg.classList.add('hidden');
      if (stageEmpty) stageEmpty.classList.remove('hidden');
      return;
    }

    if (stageEmpty) stageEmpty.classList.add('hidden');
    if (stageImg) {
      stageImg.src = item.url;
      stageImg.classList.remove('hidden');
    }
  }

  function addAssetAsPromptReference(item) {
    if (!item) return;

    // 1. Character selection (@CharacterName + character entity selection)
    if (item.isCharacter || item.category === 'character' || item.type === 'character') {
      const charName = item.name || item.prompt || 'Character';
      const charId = item.character_id || item.id;
      if (charId) {
        if (state.selectedCharacterIds.size >= 4 && !state.selectedCharacterIds.has(charId)) {
          showToast('Google Veo allows up to 4 characters in a single prompt', 'warning');
          return;
        }
        state.selectedCharacterIds.add(charId);
      }
      appendCharacterToPrompt(charName);
      updateSelectedCharactersBar();
      updatePromptAttachedDisplay();
      updateGenerateButtonState();
      renderCharactersList();
      renderCharactersPageList();
      showToast(`Added @${charName} (${state.selectedCharacterIds.size}/4)`, 'success');
      if (els.promptInput) els.promptInput.focus();
      return;
    }

    // 2. Video item: follow same flow as picker / extend (extract last frame → attach to prompt)
    if (item.type === 'video') {
      handleExtendVideo(item);
      return;
    }

    // 3. Image item
    const isVideoFamily = state.family !== 'image' && state.mode !== 'image' && state.mode !== 'image-to-image';
    const subFramesBtn = document.getElementById('param-sub-frames-btn');
    const isFramesActive = (subFramesBtn && subFramesBtn.classList.contains('active')) || state.videoSubmode === 'frames' || Boolean(state.firstFrame || state.lastFrame);

    if (isVideoFamily && isFramesActive) {
      // In Frames mode:
      // "and if one image is already in frame click on other image and select add to prompt ot animate auto add in next frame if frames option"
      if (!state.firstFrame) {
        selectFirstFrame(item);
        showToast('Added as Start Frame (Ready to animate)', 'success');
      } else if (!state.lastFrame) {
        selectLastFrame(item);
        showToast('Added as End Frame (First & Last Interpolate)', 'success');
      } else {
        selectLastFrame(item);
        showToast('Updated End Frame (First & Last Interpolate)', 'success');
      }
      state.videoSubmode = 'frames';
      if (subFramesBtn) subFramesBtn.classList.add('active');
      const subIngBtn = document.getElementById('param-sub-ingredients-btn');
      if (subIngBtn) subIngBtn.classList.remove('active');
      // Never pop open the clunky drawer
      const framesDrawer = document.getElementById('frame-controls-card');
      if (framesDrawer) framesDrawer.classList.add('hidden');
      updatePromptFramesDisplay();
      updatePromptAttachedDisplay();
      updateParamPillSummary();
      if (els.promptInput) els.promptInput.focus();
      return;
    }

    if (!isVideoFamily) {
      // In Image mode:
      // "and image mode allow upto 7 refernces"
      state.multiRefImages = state.multiRefImages || [];
      if (state.multiRefImages.length >= 7) {
        showToast('Maximum 7 reference images allowed in Image mode', 'warning');
        return;
      }
      const already = state.multiRefImages.some(img => (img.id && img.id === item.id) || (img.url && img.url === item.url));
      if (!already) {
        state.multiRefImages.push(item);
      }
      selectReferenceImage(item);
      state.mode = 'image-to-image';
      updatePromptAttachedDisplay();
      updateParamPillSummary();
      showToast(`Added reference image (${state.multiRefImages.length}/7)`, 'success');
      if (els.promptInput) els.promptInput.focus();
      return;
    }

    // In Video Ingredients mode (or default video mode):
    // "and ingridents allow upto 3"
    state.ingredients = state.ingredients || [];
    if (state.ingredients.length >= 3) {
      showToast('Maximum 3 ingredient images allowed for video generation', 'warning');
      return;
    }
    addIngredientFromAsset(item);
    state.videoSubmode = 'ingredients';
    state.mode = 'ingredients';
    const subIngBtn = document.getElementById('param-sub-ingredients-btn');
    if (subIngBtn) subIngBtn.classList.add('active');
    if (subFramesBtn) subFramesBtn.classList.remove('active');
    updatePromptAttachedDisplay();
    updateParamPillSummary();
    if (els.promptInput) els.promptInput.focus();
  }

  function confirmPickerSelection(item) {
    if (!item) return;

    // If custom callback is set (e.g. user clicked Start Frame button or End Frame button)
    if (state.refPickerCallback) {
      state.refPickerCallback(item);
      closeRefPickerModal();
      return;
    }

    addAssetAsPromptReference(item);
    closeRefPickerModal();
  }

  function closeRefPickerModal() {
    if (els.refPickerModal) els.refPickerModal.classList.add('hidden');
    const stageVideo = document.getElementById('picker-stage-video');
    if (stageVideo) stageVideo.pause();
  }

  function selectReferenceImage(asset, { assumeReady = null } = {}) {
    if (!asset) return;
    stopReferenceReadyPoll();

    const idStr = String(asset.id || '');
    const looksLikeFlowMediaId = !!idStr
      && !idStr.startsWith('staged-')
      && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(idStr);
    const urlStr = String(asset.url || '');
    const knownReady = assumeReady != null
      ? !!assumeReady
      : (asset.flow_ready === true
        || looksLikeFlowMediaId
        || (asset.source !== 'desktop_upload' && asset.source !== 'local_stage'
          && !!asset.url && !urlStr.startsWith('data:') && !urlStr.startsWith('blob:')));

    state.referenceImage = {
      id: asset.id,
      staged_id: asset.staged_id || (String(asset.id || '').startsWith('staged-') ? asset.id : null),
      url: asset.url,
      name: asset.name || 'Reference Image',
      prompt: asset.prompt || '',
      ready: knownReady,
      local_path: asset.local_path || null,
    };

    if (els.refPlaceholder) els.refPlaceholder.classList.add('hidden');
    if (els.refPreviewWrapper) els.refPreviewWrapper.classList.remove('hidden');
    if (els.refPreviewImg) els.refPreviewImg.src = asset.url;
    if (els.refTitle) els.refTitle.textContent = asset.name || 'Selected Reference';
    if (els.refId) {
      els.refId.textContent = state.referenceImage.staged_id && !knownReady
        ? 'Staged locally'
        : `ID: ${asset.id}`;
    }
    if (els.clearRefBtn) els.clearRefBtn.classList.remove('hidden');

    if (knownReady) {
      setReferenceReadyStatus('ready');
      updateGenerateButtonState();
      showToast(`Reference image loaded: "${(asset.prompt || asset.id).slice(0, 30)}..."`, 'success');
    } else if (state.referenceImage.staged_id && String(asset.id || '').startsWith('staged-')) {
      setReferenceReadyStatus('staged');
      updateGenerateButtonState();
    } else {
      setReferenceReadyStatus('processing');
      updateGenerateButtonState();
      pollReferenceReady(asset.id);
    }
    updatePromptAttachedDisplay();
  }

  async function handleDesktopRefUpload(event) {
    const input = event.target;
    const file = input && input.files && input.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Please choose an image file (PNG, JPEG, WebP, or GIF).', 'warning');
      input.value = '';
      return;
    }

    stopReferenceReadyPoll();
    const localPreview = URL.createObjectURL(file);
    if (els.refPlaceholder) els.refPlaceholder.classList.add('hidden');
    if (els.refPreviewWrapper) els.refPreviewWrapper.classList.remove('hidden');
    if (els.refPreviewImg) els.refPreviewImg.src = localPreview;
    if (els.refTitle) els.refTitle.textContent = file.name;
    if (els.refId) els.refId.textContent = 'Staging locally…';
    if (els.clearRefBtn) els.clearRefBtn.classList.remove('hidden');
    if (els.pickRefDesktopBtn) els.pickRefDesktopBtn.disabled = true;
    if (els.pickRefGalleryBtn) els.pickRefGalleryBtn.disabled = true;

    state.referenceImage = {
      id: null,
      staged_id: null,
      url: localPreview,
      name: file.name,
      prompt: '',
      ready: false,
    };
    setReferenceReadyStatus('uploading');
    updateGenerateButtonState();
    showToast(`Staging "${file.name}" locally…`, 'info');

    try {
      const form = new FormData();
      form.append('file', file, file.name);
      const res = await fetch(`${API_BASE}/api/assets/stage`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Local staging failed');
      }
      const data = await res.json();
      const asset = data.asset || data;
      const stagedId = pickStagedIdFromStageResponse(data);
      if (!stagedId) {
        throw new Error('Staging returned no staged-* id');
      }
      state.referenceImage = {
        id: asset.id || stagedId,
        staged_id: stagedId,
        url: asset.url || localPreview,
        name: asset.name || file.name,
        prompt: '',
        ready: false,
        local_path: asset.local_path || null,
      };
      if (els.refId) els.refId.textContent = 'Staged locally';
      if (els.refPreviewImg && asset.url && String(asset.url).startsWith('data:')) {
        // Keep blob preview (faster); data URL already in asset if needed
      }
      setReferenceReadyStatus('staged');
      updateGenerateButtonState();
      showToast(`"${file.name}" staged — will upload to Flow when you Generate.`, 'success');
    } catch (err) {
      clearReferenceImage();
      showToast(err.message || 'Desktop staging failed', 'error');
    } finally {
      if (els.pickRefDesktopBtn) els.pickRefDesktopBtn.disabled = false;
      if (els.pickRefGalleryBtn) els.pickRefGalleryBtn.disabled = false;
      input.value = '';
    }
  }

  function clearReferenceImage() {
    stopReferenceReadyPoll();
    if (state.referenceImage && state.referenceImage.url && String(state.referenceImage.url).startsWith('blob:')) {
      try {
        URL.revokeObjectURL(state.referenceImage.url);
      } catch (_) {}
    }
    state.referenceImage = null;
    if (els.refPlaceholder) els.refPlaceholder.classList.remove('hidden');
    if (els.refPreviewWrapper) els.refPreviewWrapper.classList.add('hidden');
    if (els.clearRefBtn) els.clearRefBtn.classList.add('hidden');
    setReferenceReadyStatus('idle');
    updateGenerateButtonState();
    updatePromptAttachedDisplay();
  }

  function selectRefImageAndSwitchMode(asset, targetMode) {
    if (!asset) return;
    selectReferenceImage(asset);
    setStudioMode(targetMode);
    switchTab('studio');
    showToast(`Switched to ${targetMode === 'image-to-video' ? 'Image-to-Video' : 'Image-to-Image'} with reference image!`, 'info');
  }

  // ---------------------------------------------------------------------------
  // EXTEND VIDEO MODAL & EXECUTION
  // ---------------------------------------------------------------------------
  function openExtendModal(targetItem) {
    const item = targetItem || state.activeItem;
    if (!item || item.type !== 'video') {
      showToast('Please select a video to extend', 'warning');
      return;
    }

    state.extendTarget = item;
    if (els.extendModalVideo) {
      els.extendModalVideo.src = item.url;
      els.extendModalVideo.play().catch(() => {});
    }
    if (els.extendModalAssetId) els.extendModalAssetId.textContent = `Clip ID: ${item.id} (${item.aspect_ratio || '16:9'})`;
    if (els.extendModalPrompt) els.extendModalPrompt.textContent = item.prompt || 'No initial prompt';
    if (els.extendPromptInput) {
      els.extendPromptInput.value = '';
      els.extendPromptInput.placeholder = `Continuation for: "${(item.prompt || '').slice(0, 60)}..."`;
    }

    if (els.extendModal) els.extendModal.classList.remove('hidden');
    if (els.extendPromptInput) els.extendPromptInput.focus();
  }

  function closeExtendModal() {
    if (els.extendModal) els.extendModal.classList.add('hidden');
    state.extendTarget = null;
  }

  async function handleEnhanceExtendPrompt() {
    const input = els.extendPromptInput.value.trim();
    if (!input) {
      showToast('Type a brief extension description first', 'error');
      return;
    }
    els.extendEnhancePromptBtn.disabled = true;
    try {
      const res = await fetch(`${API_BASE}/api/prompt/enhance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: input }),
      });
      const data = await res.json();
      if (data.enhanced) {
        els.extendPromptInput.value = data.enhanced;
        showToast('Extension prompt enhanced!', 'success');
      }
    } catch (e) {
      showToast('Could not enhance prompt', 'error');
    } finally {
      els.extendEnhancePromptBtn.disabled = false;
    }
  }

  async function handleExecuteExtend() {
    if (!state.extendTarget || !state.extendTarget.id) {
      showToast('No video selected for extension', 'error');
      return;
    }

    const promptText = els.extendPromptInput.value.trim();
    if (!promptText) {
      showToast('Please describe the continuation for the video scene', 'error');
      els.extendPromptInput.focus();
      return;
    }

    els.submitExtendBtn.disabled = true;
    els.submitExtendBtn.querySelector('span').textContent = 'Extracting last frame…';

    try {
      const res = await fetch(`${API_BASE}/api/video/extend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_id: state.extendTarget.id,
          prompt: promptText,
          model: state.extendModel || 'VEO_3_1_EXTEND_LITE',
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Extension request failed');
      }

      const data = await res.json();
      const asset = data.asset;

      // Close modal
      closeExtendModal();

      // Add to parallel tasks
      const taskObj = {
        ...asset,
        startTime: Date.now(),
        prompt: `[Extended] ${promptText}`,
      };
      state.activeTasks.set(asset.id, taskObj);
      state.selectedTaskId = asset.id;

      showToast('Extend launched (last frame → I2V). You can keep creating.', 'success');
      renderParallelTasksBar();
      updateLiveProgressCardForTask(taskObj);

      loadAssets();
      fetchAuthStatus();
      startBackgroundPollingLoop();

    } catch (e) {
      console.error('Extend video failed:', e);
      showToast(`Extend failed: ${e.message}`, 'error');
    } finally {
      els.submitExtendBtn.disabled = false;
      els.submitExtendBtn.querySelector('span').textContent = 'Extend Video (Last Frame → I2V)';
    }
  }

  // ---------------------------------------------------------------------------
  // STORYBOARD & TIMELINE
  // ---------------------------------------------------------------------------
  function renderStoryboard() {
    // Populate storyboard clips from video assets if empty
    if (state.storyboardClips.length === 0) {
      state.storyboardClips = state.assets.filter(a => a.type === 'video').slice(0, 6);
    }

    if (state.storyboardClips.length === 0) {
      els.storyboardEmpty.style.display = 'block';
      els.storyboardTracks.querySelectorAll('.timeline-clip-card').forEach(c => c.remove());
      return;
    }

    els.storyboardEmpty.style.display = 'none';
    els.storyboardTracks.querySelectorAll('.timeline-clip-card').forEach(c => c.remove());

    state.storyboardClips.forEach((clip, index) => {
      const card = document.createElement('div');
      card.className = 'timeline-clip-card';
      card.innerHTML = `
        <span class="clip-badge">Scene ${index + 1} (${clip.duration || 5}s)</span>
        <video src="${clip.url}" muted></video>
      `;

      card.addEventListener('click', () => {
        els.storyboardTracks.querySelectorAll('.timeline-clip-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        els.timelineVideoPlayer.src = clip.url;
        els.timelineVideoPlayer.play().catch(() => {});
        els.timelineClipDetails.innerHTML = `
          <h4 style="margin-bottom: 6px;">${clip.name || 'Scene Clip'}</h4>
          <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px;">${clip.prompt}</p>
          <div style="font-size: 11px; font-family: var(--font-mono); color: var(--text-muted);">
            <span>Model: ${resolveItemModelLabel(clip)}</span> | <span>Aspect: ${clip.aspect_ratio}</span>
          </div>
        `;
      });

      els.storyboardTracks.appendChild(card);
    });

    // Auto-select first clip
    const first = els.storyboardTracks.querySelector('.timeline-clip-card');
    if (first) first.click();
  }

  function handleExportStoryboard() {
    const manifest = {
      projectTitle: 'Google Flow Storyboard Sequence',
      createdAt: new Date().toISOString(),
      scenes: state.storyboardClips.map((c, i) => ({
        sceneNumber: i + 1,
        id: c.id,
        duration: c.duration || 5,
        prompt: c.prompt,
        url: c.url,
      })),
    };

    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'flow-storyboard-manifest.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Storyboard manifest exported!', 'success');
  }

  // ---------------------------------------------------------------------------
  // ASSET GALLERY
  // ---------------------------------------------------------------------------
  function galleryStructureKey(assets) {
    const assetPart = (assets || [])
      .map((a) => `${a.id}:${a.status || ''}:${(a.url || '').slice(0, 48)}:${a.upscaled_resolution || ''}`)
      .join('|');
    const taskPart = Array.from(state.activeTasks.values())
      .map((t) => `${t.id}:${t.status || ''}`)
      .join('|');
    return `${assetPart}::${taskPart}`;
  }

  /** Update only the generating/queue card for one task — never rebuild the whole grid. */
  function patchWorkingGalleryCard(task) {
    if (!task || !els.galleryGrid) return;
    const elapsedSec = (Date.now() - (task.startTime || Date.now())) / 1000;
    let percent = Math.min(95, Math.max(1, Math.round(100 * (1 - Math.exp(-elapsedSec / 18)))));
    if (task.progress) percent = Math.max(percent, Math.round(task.progress));
    task.progress = percent;
    const isSub = task.phase === 'submit' || task.phase === 'ack' || task.status === 'PREPARING';
    const isQueue = task.status === 'IN_QUEUE' || task.inQueue;

    let cardEl =
      document.querySelector(`.flow-generating-card[data-task-id="${task.id}"]`) ||
      document.querySelector(`.flow-queue-card[data-id="${task.id}"]`) ||
      document.querySelector(`.flow-media-card[data-id="${task.id}"]`);

    if (!cardEl) return; // card not in DOM yet — full render will happen on structural change

    if (isQueue) {
      const desc = cardEl.querySelector('.queue-card-desc');
      if (desc && task.error) desc.textContent = task.error;
      return;
    }

    const pill = cardEl.querySelector('.gen-card-percent-pill');
    if (pill) pill.textContent = isSub ? 'Submitting' : `${percent}%`;
    const lbl = cardEl.querySelector('.gen-card-status-label');
    if (lbl) lbl.textContent = isSub ? 'Submitting…' : 'Generating…';
    const num = cardEl.querySelector('.gen-card-progress-num');
    if (num) {
      num.textContent = `${percent}%`;
      num.classList.toggle('hidden', !!isSub);
    }
  }

  function parseExpiresFromMediaUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const match = url.match(/[?&]Expires=(\d+)/i) || url.match(/[?&]expire(?:s)?=(\d+)/i);
    if (!match) return null;
    const raw = Number(match[1]);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    const ms = raw > 1e12 ? raw : raw * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // Tools (Storyteller / Bulk T2I / T2V) reuse this for localStorage media pruning
  window.parseExpiresFromMediaUrl = parseExpiresFromMediaUrl;

  function resolveAssetExpiresAt(item) {
    if (!item) return null;
    const fromUrl = parseExpiresFromMediaUrl(item.url || item.upscaled_url || '');
    if (fromUrl) return fromUrl;
    const raw = item.expires_at || item.expiresAt;
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function isFailedCardStale(item) {
    if (!item || item.status !== 'FAILED') return false;
    const raw = item.completed_at || item.completedAt || item.updated_at || item.created_at || item.createdAt;
    if (!raw) return false;
    const t = new Date(raw).getTime();
    if (Number.isNaN(t)) return false;
    return Date.now() - t >= 4 * 60 * 60 * 1000;
  }

  /** Tool jobs keep Waiting-in-Queue in their own pane; All Media shows generating + ready. */
  function isToolOwnedQueueAsset(item) {
    if (!item) return false;
    const queued = item.status === 'IN_QUEUE' || item.inQueue;
    if (!queued) return false;
    const src = String(item.source || '').trim();
    if (/^(storyteller|bulkt2v|bulkt2i|bulki2v)$/i.test(src)) return true;
    const msg = String(item.error || item.queueMessage || '');
    return /In Queue:\s*(Storyteller|Bulk)\b/i.test(msg);
  }

  function isAssetMediaExpired(item) {
    if (!item) return false;
    if (state.hiddenExpiredIds && state.hiddenExpiredIds.has(item.id)) return true;
    const exp = resolveAssetExpiresAt(item);
    if (!exp) return false;
    return exp.getTime() <= Date.now();
  }

  function formatMediaExpiryLeft(expiresAt) {
    if (!expiresAt) return '';
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (Number.isNaN(ms) || ms <= 0) return 'Expired';
    const totalMins = Math.floor(ms / 60000);
    if (totalMins < 1) return '<1m left';
    if (totalMins < 60) return `${totalMins}m left`;
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (hours < 48) {
      return mins > 0 ? `${hours}h ${mins}m left` : `${hours}h left`;
    }
    return `${Math.floor(hours / 24)}d left`;
  }

  function removeExpiredGalleryCard(item, card) {
    if (!item || !item.id) return;
    if (!state.hiddenExpiredIds) state.hiddenExpiredIds = new Set();
    state.hiddenExpiredIds.add(item.id);
    state.assets = (state.assets || []).filter((a) => a.id !== item.id);
    if (card && card.parentNode) card.remove();
    else renderGallery();
  }

  async function loadAssets(opts) {
    const silent = !!(opts && opts.silent);
    const showSkeleton = !silent && !state.galleryLoadedOnce;
    if (showSkeleton) {
      state.galleryLoading = true;
      renderGallerySkeleton(8);
    }
    try {
      const projParam = state.activeProjectId ? `&projectId=${encodeURIComponent(state.activeProjectId)}` : '';
      const res = await fetch(`${API_BASE}/api/assets?type=all${projParam}`);
      // Keep existing gallery / tool UI if session expired — never wipe on logout race
      if (res.status === 401 || res.status === 403) return;
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      const nextAssets = data.assets || [];
      const prevKey = silent ? galleryStructureKey(state.assets || []) : null;

      // Preserve in-memory upscale fields if API lag hasn't persisted yet
      const prevById = new Map((state.assets || []).map((a) => [a.id, a]));
      state.assets = nextAssets.map((a) => {
        const prev = prevById.get(a.id);
        let merged = a;
        if (prev && (prev.upscaled_url || prev.upscaled_resolution) && !a.upscaled_url) {
          merged = {
            ...a,
            upscaled_url: prev.upscaled_url,
            upscaled_download_url: prev.upscaled_download_url,
            upscaled_resolution: prev.upscaled_resolution,
          };
        }
        // Prefer Google CDN Expires= over provisional DB 24h clock
        const fromUrl = parseExpiresFromMediaUrl(merged.url || merged.upscaled_url || '');
        if (fromUrl) {
          merged = { ...merged, expires_at: fromUrl.toISOString() };
        }
        return merged;
      }).filter((a) => {
        if (state.hiddenExpiredIds && state.hiddenExpiredIds.has(a.id)) return false;
        if (a.status === 'FAILED' && isFailedCardStale(a)) return false;
        if ((a.status === 'COMPLETED' || !a.status) && isAssetMediaExpired(a)) return false;
        // Tools own their Waiting-in-Queue UI — never surface those cards in All Media
        if (isToolOwnedQueueAsset(a)) return false;
        return true;
      });

      // Update counters
      const allCount = state.assets.length;
      const vidCount = state.assets.filter(a => a.type === 'video').length;
      const imgCount = state.assets.filter(a => a.type === 'image').length;

      if (els.galleryCountAll) els.galleryCountAll.textContent = allCount;
      if (els.galleryCountVideo) els.galleryCountVideo.textContent = vidCount;
      if (els.galleryCountImage) els.galleryCountImage.textContent = imgCount;
      if (els.headerHistoryCount) els.headerHistoryCount.textContent = allCount;

      // Auto-display latest completed item in stage if empty
      if ((!state.activeItem || !state.activeItem.url) && state.assets.length > 0) {
        const latestCompleted = state.assets.find(a => a.url && (a.status === 'COMPLETED' || !a.status));
        if (latestCompleted) {
          displayActiveAsset(latestCompleted);
        }
      }

      // Reconcile active tasks with database assets
      for (const id of [...state.activeTasks.keys()]) {
        if (id.startsWith('pending-')) {
          const pendingTask = state.activeTasks.get(id);
          const matchingAsset = pendingTask && state.assets.find(a => 
            (a.status === 'PROCESSING' || a.status === 'IN_QUEUE' || a.status === 'COMPLETED') &&
            a.prompt === pendingTask.prompt &&
            Math.abs(new Date(a.created_at || Date.now()).getTime() - pendingTask.startTime) < 60000
          );
          if (matchingAsset) {
            state.activeTasks.delete(id);
            if (matchingAsset.status !== 'COMPLETED' && matchingAsset.status !== 'FAILED') {
              state.activeTasks.set(matchingAsset.id, {
                ...pendingTask,
                ...matchingAsset,
                id: matchingAsset.id,
                startTime: pendingTask.startTime || Date.now(),
                runId: pendingTask.runId || matchingAsset.runId,
              });
            }
            continue;
          }
          // Also match by runId when prompt timing drifts
          const byRun =
            pendingTask?.runId &&
            state.assets.find(
              (a) =>
                a.runId === pendingTask.runId &&
                (a.status === 'PROCESSING' || a.status === 'IN_QUEUE' || a.status === 'COMPLETED')
            );
          if (byRun) {
            state.activeTasks.delete(id);
            if (byRun.status !== 'COMPLETED' && byRun.status !== 'FAILED') {
              state.activeTasks.set(byRun.id, {
                ...pendingTask,
                ...byRun,
                id: byRun.id,
                startTime: pendingTask.startTime || Date.now(),
                runId: pendingTask.runId,
              });
            }
            continue;
          }
        }
        const asset = state.assets.find(a => a.id === id);
        if (asset) {
          if (asset.status === 'COMPLETED' || asset.status === 'FAILED') {
            state.activeTasks.delete(id);
            if (state.selectedTaskId === id) state.selectedTaskId = null;
          } else if (asset.status === 'IN_QUEUE') {
            const task = state.activeTasks.get(id);
            if (task) {
              task.status = 'IN_QUEUE';
              task.inQueue = true;
            }
          } else if (asset.status === 'PROCESSING') {
            const task = state.activeTasks.get(id);
            if (task) {
              task.status = 'PROCESSING';
              task.inQueue = false;
              if (asset.progress) task.progress = asset.progress;
            }
          }
        }
      }

      // Auto-register pending/in-queue tasks from database if not already tracked
      // (skip tool-owned queue — those belong in Storyteller / Bulk panes only)
      state.assets.forEach(a => {
        if (isToolOwnedQueueAsset(a)) {
          state.activeTasks.delete(a.id);
          return;
        }
        if ((a.status === 'PROCESSING' || a.status === 'IN_QUEUE') && !state.activeTasks.has(a.id)) {
          // Drop matching pending-* so gallery never shows both cards
          for (const [pid, pt] of [...state.activeTasks.entries()]) {
            if (!String(pid).startsWith('pending-')) continue;
            const samePrompt = pt.prompt && a.prompt && pt.prompt === a.prompt;
            const sameRun = pt.runId && a.runId && pt.runId === a.runId;
            if (samePrompt || sameRun) state.activeTasks.delete(pid);
          }
          state.activeTasks.set(a.id, {
            ...a,
            startTime: a.created_at ? new Date(a.created_at).getTime() : Date.now(),
          });
        }
      });

      // Drop any leftover tool-queue cards still sitting in activeTasks from a prior poll
      for (const [id, task] of [...state.activeTasks.entries()]) {
        if (isToolOwnedQueueAsset(task)) state.activeTasks.delete(id);
      }

      if (state.activeTasks.size > 0) {
        renderParallelTasksBar();
        startBackgroundPollingLoop();
      } else {
        if (els.parallelTasksBar) els.parallelTasksBar.classList.add('hidden');
        if (els.liveProgressCard) els.liveProgressCard.classList.add('hidden');
      }

      if (silent) {
        const nextKey = galleryStructureKey(state.assets);
        if (prevKey !== nextKey) {
          // Only rebuild when cards are added/removed/finished — not every progress tick
          renderGallery();
        } else {
          Array.from(state.activeTasks.values()).forEach(patchWorkingGalleryCard);
        }
      } else {
        renderGallery();
      }
      state.galleryLoadedOnce = true;
    } catch (e) {
      console.warn('Could not load assets:', e);
      if (showSkeleton && els.galleryGrid && !state.galleryLoadedOnce) {
        renderGallery();
      }
    } finally {
      state.galleryLoading = false;
    }
  }

  function renderGallery() {
    if (!els.galleryGrid) return;
    els.galleryGrid.innerHTML = '';

    const renderedIds = new Set();

    function getCleanAssetTitle(item) {
      let title = item.prompt || item.name || '';
      if (!title || /^veo_|^test_video_|\.mp4$|\.png$/i.test(title)) {
        if (item.prompt && !/^veo_|^test_video_|\.mp4$|\.png$/i.test(item.prompt)) {
          title = item.prompt;
        } else {
          title = item.type === 'video' ? 'Veo Scene Creation' : 'Image Creation';
        }
      }
      return title.replace(/\.[^/.]+$/, '').trim();
    }

    // Helper: render generating card
    function renderGeneratingCard(task) {
      if (renderedIds.has(task.id)) return;
      renderedIds.add(task.id);

      const aspectClass = (task.aspectRatio || task.aspect_ratio || state.aspectRatio || '16:9').replace(':', '-');
      const elapsedSec = (Date.now() - (task.startTime || Date.now())) / 1000;
      let percent = Math.min(95, Math.max(1, Math.round(100 * (1 - Math.exp(-elapsedSec / 18)))));
      if (task.progress) percent = Math.max(percent, Math.round(task.progress));
      task.progress = percent;

      const isVid = task.type === 'video';
      const defaultTitle = isVid ? 'ANIMATE' : 'GENERATE';
      const titleText = (task.prompt || defaultTitle).trim().toUpperCase();

      const isSubmitting = task.phase === 'submit' || task.phase === 'ack' || task.status === 'PREPARING';
      const statusLabel = isSubmitting ? 'Submitting…' : 'Generating…';

      const genCard = document.createElement('div');
      genCard.className = `flow-media-card flow-generating-card aspect-${aspectClass}`;
      genCard.dataset.taskId = task.id;
      genCard.innerHTML = `
        <div class="generating-shimmer-layer"></div>
        <div class="gen-card-ambient-glow"></div>
        
        <!-- Top-left circular badge: play badge for video, photo icon for image -->
        <div class="gen-card-play-badge ${!isVid ? 'gen-card-image-badge' : ''}" title="${isVid ? 'Video generation' : 'Image generation'}">
          ${isVid 
            ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>` 
            : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`
          }
        </div>

        <!-- Top-right status pill & cancel button -->
        <div class="gen-card-top-right-status">
          <span class="gen-card-percent-pill">${isSubmitting ? 'Submitting' : `${percent}%`}</span>
          <button type="button" class="gen-card-cancel-btn" title="Cancel generation" data-id="${task.id}">✕</button>
        </div>

        <!-- Center loading animation with status progression: Submitting > Generating -->
        <div class="gen-card-center-loader">
          <div class="flow-spinner-ring"></div>
          <div class="gen-card-status-label">${statusLabel}</div>
          ${!isSubmitting ? `<div class="gen-card-progress-num">${percent}%</div>` : ''}
        </div>

        <!-- Bottom-left uppercase prompt title -->
        <div class="gen-card-bottom-title" title="${escapeHtml(titleText)}">${escapeHtml(titleText)}</div>

        ${isVid ? `
          <!-- Bottom-right swap/transition pill (only for video) -->
          <div class="gen-card-swap-pill" title="Frames transition">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M7 16V4M7 4L3 8M7 4L11 8M17 8V20M17 20L21 16M17 20L13 16"/></svg>
          </div>
        ` : ''}
      `;

      const genCancelBtn = genCard.querySelector('.gen-card-cancel-btn');
      if (genCancelBtn) {
        genCancelBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          handleCancelTask(task.id);
        });
      }

      els.galleryGrid.appendChild(genCard);
    }

    // Helper: render authentic In-Queue card
    function renderQueueCard(item) {
      if (renderedIds.has(item.id)) return;
      renderedIds.add(item.id);

      const aspectClass = (item.aspect_ratio || item.aspectRatio || state.aspectRatio || '16:9').replace(':', '-');
      const isVid = item.type === 'video';
      const defaultTitle = isVid ? 'ANIMATE' : 'GENERATE';
      const titleText = (item.prompt || defaultTitle).trim().toUpperCase();
      const qCard = document.createElement('div');
      qCard.className = `flow-media-card flow-queue-card aspect-${aspectClass}`;
      qCard.dataset.id = item.id;
      qCard.innerHTML = `
        <div class="queue-pulsing-layer"></div>
        <div class="queue-card-badge">
          <span>⏳</span>
          <span>IN QUEUE</span>
        </div>

        <div class="gen-card-top-right-status">
          <button type="button" class="queue-card-cancel-btn-top" title="Cancel queue job" data-id="${item.id}">✕</button>
        </div>

        <div class="queue-card-center-loader">
          <div class="queue-spinner-ring"></div>
          <div class="queue-card-title">Waiting in Queue</div>
          <div class="queue-card-desc">${escapeHtml((function (raw) {
            const msg = String(raw || '');
            if (/provider|BiB|Google account|admin must|aisandbox|chrome|puppeteer/i.test(msg)) {
              return 'Waiting in queue. Your generation will start shortly.';
            }
            if (/parallel|plan limit/i.test(msg)) {
              return 'Waiting in queue. Your plan parallel limit is reached.';
            }
            return msg || 'Waiting in queue…';
          })(item.error || item.queueMessage))}</div>
          <button type="button" class="queue-card-cancel-btn" data-id="${item.id}" title="Cancel queue job">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            <span>Cancel</span>
          </button>
        </div>
        <div class="queue-card-bottom-title" title="${escapeHtml(titleText)}">${escapeHtml(titleText)}</div>
      `;

      const cancelBtn = qCard.querySelector('.queue-card-cancel-btn');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          handleCancelTask(item.id);
        });
      }
      const cancelTopBtn = qCard.querySelector('.queue-card-cancel-btn-top');
      if (cancelTopBtn) {
        cancelTopBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          handleCancelTask(item.id);
        });
      }

      els.galleryGrid.appendChild(qCard);
    }

    // 1. Render active generating tasks (newest first)
    const activeTasks = Array.from(state.activeTasks.entries())
      .filter(([id, t]) => {
        if (t.status !== 'PROCESSING' && t.status !== 'PREPARING') return false;
        if (String(id).startsWith('pending-')) {
          const hasReal = [...state.activeTasks.entries()].some(
            ([rid, rt]) =>
              !String(rid).startsWith('pending-') &&
              ((t.runId && rt.runId && t.runId === rt.runId) ||
                (t.prompt && rt.prompt && t.prompt === rt.prompt))
          );
          if (hasReal) return false;
          const hasAsset = state.assets.some(
            (a) =>
              (a.status === 'PROCESSING' || a.status === 'IN_QUEUE' || a.status === 'COMPLETED') &&
              ((t.runId && a.runId && t.runId === a.runId) ||
                (t.prompt && a.prompt && t.prompt === a.prompt))
          );
          if (hasAsset) return false;
        }
        if (state.galleryFilter === 'all') return true;
        return (t.type || 'video') === state.galleryFilter;
      })
      .map(([, t]) => t)
      .sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
    activeTasks.forEach(renderGeneratingCard);

    // 2. Render queued tasks from activeTasks (newest first)
    const queuedTasks = Array.from(state.activeTasks.entries())
      .filter(([id, t]) => {
        if (t.status !== 'IN_QUEUE' && !t.inQueue) return false;
        if (String(id).startsWith('pending-')) {
          const hasReal = [...state.activeTasks.entries()].some(
            ([rid, rt]) =>
              !String(rid).startsWith('pending-') &&
              ((t.runId && rt.runId && t.runId === rt.runId) ||
                (t.prompt && rt.prompt && t.prompt === rt.prompt))
          );
          if (hasReal) return false;
        }
        if (state.galleryFilter === 'all') return true;
        return (t.type || 'video') === state.galleryFilter;
      })
      .map(([, t]) => t)
      .sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
    queuedTasks.forEach(renderQueueCard);

    // 3. Filter and render remaining items from state.assets (newest first)
    const filtered = state.assets.filter(a => {
      if (renderedIds.has(a.id)) return false;
      if (isToolOwnedQueueAsset(a)) return false;
      // Usable completed media must have a URL; skip empty shells
      if ((a.status === 'COMPLETED' || !a.status) && !(a.url || '').trim()) return false;
      // Hide CDN-expired media entirely (no Expired placeholder cards)
      if ((a.status === 'COMPLETED' || !a.status) && isAssetMediaExpired(a)) return false;
      // Failed cards auto-remove after 4 hours
      if (a.status === 'FAILED' && isFailedCardStale(a)) return false;
      if (state.galleryFilter === 'all') return true;
      return a.type === state.galleryFilter;
    }).sort((a, b) => {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return tb - ta;
    });

    if (activeTasks.length === 0 && queuedTasks.length === 0 && filtered.length === 0) {
      els.galleryGrid.innerHTML = `
        <div class="col-span-full py-20 text-center text-slate-500">
          <div class="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-white/5 border border-white/10 mb-3 text-slate-400">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          </div>
          <div class="text-xs font-semibold text-slate-300">Fresh Workspace — No generations yet</div>
          <div class="text-[11px] text-slate-500 mt-1 max-w-xs mx-auto">Create your first video or image using the prompt box below</div>
        </div>
      `;
      return;
    }

    filtered.forEach(item => {
      // 3A. If item in assets is IN_QUEUE
      if (item.status === 'IN_QUEUE') {
        renderQueueCard(item);
        return;
      }

      // 3B. If item in assets is PROCESSING
      if (item.status === 'PROCESSING' || item.status === 'PREPARING') {
        renderGeneratingCard(item);
        return;
      }

      const isVid = item.type === 'video';
      const aspectClass = (item.aspect_ratio || '16:9').replace(':', '-');

      // 3C. Render Failed Card (Always visible with retry & delete!)
      if (item.status === 'FAILED') {
        renderedIds.add(item.id);
        const failCard = document.createElement('div');
        failCard.className = `flow-media-card flow-failed-card aspect-${aspectClass}`;
        failCard.dataset.id = item.id;
        failCard.innerHTML = `
          <div class="failed-card-content">
            <div class="failed-card-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <div class="failed-card-title">Failed</div>
            <div class="failed-card-desc" title="${escapeHtml(toUserFacingGenerationError(item.error))}">
              ${escapeHtml(toUserFacingGenerationError(item.error))}
            </div>
          </div>

          <div class="failed-card-actions">
            <button type="button" class="failed-action-btn failed-retry-btn" title="Retry generation">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                <path d="M3 3v5h5"/>
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
                <path d="M16 16h5v5"/>
              </svg>
            </button>
            <button type="button" class="failed-action-btn failed-delete-btn" title="Delete failed creation">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </div>
        `;

        const retryBtn = failCard.querySelector('.failed-retry-btn');
        if (retryBtn) {
          retryBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            retryFailedGeneration(item);
          });
        }

        const delBtn = failCard.querySelector('.failed-delete-btn');
        if (delBtn) {
          delBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await deleteAsset(item.id, { item, jobId: item.jobId || item.id, url: item.url });
            showToast('Failed creation deleted', 'info');
          });
        }

        els.galleryGrid.appendChild(failCard);
        return;
      }

      const isUpscaled = !!(item.upscaled_url || item.upscaled_resolution === '1080p');
      const isUpscaling = !!(item._isUpscaling || (state.activeUpscales && state.activeUpscales.has(item.id)));
      const expiresAtResolved = resolveAssetExpiresAt(item);
      const expiryLabel = formatMediaExpiryLeft(expiresAtResolved);
      const expiryTitle = expiresAtResolved
        ? `Expires ${expiresAtResolved.toLocaleString()} (from Google CDN link)`
        : '';
      const card = document.createElement('div');
      card.className = `flow-media-card aspect-${aspectClass}`;
      card.dataset.id = item.id;
      card.innerHTML = `
        <div class="card-media-wrapper">
          ${isVid ? `
            <div class="card-play-badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
            </div>
            ${isUpscaled ? `<div class="card-hd-badge">1080p</div>` : ''}
            ${isUpscaling ? `
              <div class="card-upscale-overlay" id="card-upscale-overlay-${item.id}">
                <div class="card-upscale-spinner"></div>
                <span class="card-upscale-badge">Upscaling 1080p...</span>
              </div>
            ` : ''}
            <video
              src="${escapeHtml(videoSrcWithFrameHint(item.url))}"
              muted
              loop
              playsinline
              webkit-playsinline
              preload="auto"
              ${videoPosterFromItem(item) ? `poster="${escapeHtml(videoPosterFromItem(item))}"` : ''}
              data-original-src="${escapeHtml(item.url || '')}"
              class="is-painting"
            ></video>
          ` : `
            <img src="${item.url}" alt="" loading="lazy"/>
          `}
        </div>

        <!-- Authentic Top-Right Action Pill (Image 4) -->
        <div class="card-hover-actions">
          ${isVid && isUpscaled ? `
            <button type="button" class="card-pill-dl-hd-btn" title="Download 1080p upscaled">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1c1917" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>1080p</span>
            </button>
          ` : ''}
          <button type="button" class="card-pill-heart-btn ${item.favorited ? 'favorited' : ''}" title="Favorite">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="${item.favorited ? '#e11d48' : 'none'}" stroke="${item.favorited ? '#e11d48' : '#1c1917'}" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          </button>
          <button type="button" class="card-pill-menu-btn" title="More options">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1c1917" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
          </button>
        </div>

        <!-- Bottom-Left Prompt Label (Image 4) -->
        <div class="card-bottom-pill">
          ${isVid 
            ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>` 
            : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`
          }
          <span>${escapeHtml(getCleanAssetTitle(item))}</span>
          ${item.aspect_ratio && item.aspect_ratio !== '16:9' ? `<span class="card-aspect-tag">${escapeHtml(item.aspect_ratio)}</span>` : ''}
          ${expiryLabel ? `<span class="card-aspect-tag" title="${escapeHtml(expiryTitle)}">${escapeHtml(expiryLabel)}</span>` : ''}
        </div>
      `;

      // Hover playback for video; always paint a first frame on load (mobile has no hover)
      if (isVid) {
        const vid = card.querySelector('video');
        if (vid) {
          // Fall back from broken 1080p → original. Never keep Expired placeholder cards.
          vid.addEventListener('error', () => {
            const original = item.url || vid.getAttribute('data-original-src') || '';
            const current = vid.getAttribute('src') || vid.src || '';
            if (original && current && !current.includes(original.split('?')[0]) && original !== current) {
              vid.src = videoSrcWithFrameHint(original);
              ensureVideoPosterFrame(vid);
              return;
            }
            removeExpiredGalleryCard(item, card);
          });
          ensureVideoPosterFrame(vid);
        }
        card.addEventListener('mouseenter', () => {
          if (vid && vid.src && !card.classList.contains('is-expired')) {
            vid.muted = !state.soundOnHover;
            vid.play().catch(() => {});
          }
        });
        card.addEventListener('mouseleave', () => {
          if (vid && vid.src) {
            vid.pause();
            try {
              // Keep a visible still (don't reset to 0 which blanks some browsers)
              const t = Math.min(0.12, Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration * 0.02 : 0.12);
              vid.currentTime = t > 0 ? t : 0.1;
            } catch (_) {}
          }
        });
      } else {
        const img = card.querySelector('img');
        if (img) {
          let retriedJpg = false;
          img.addEventListener('error', () => {
            const src = img.getAttribute('src') || img.src || '';
            if (!retriedJpg && src.includes('.mp4')) {
              retriedJpg = true;
              img.src = src.replace(/\.mp4$/, '.jpg');
              return;
            }
            // Broken / expired Google CDN — remove card entirely
            removeExpiredGalleryCard(item, card);
          });
        }
      }

      // 3-dots menu button opens context menu
      const menuBtn = card.querySelector('.card-pill-menu-btn');
      if (menuBtn) {
        menuBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openCardContextMenu(item, e);
        });
      }

      // Heart button toggles favorite
      const heartBtn = card.querySelector('.card-pill-heart-btn');
      if (heartBtn) {
        heartBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          item.favorited = !item.favorited;
          heartBtn.classList.toggle('favorited', item.favorited);
          const svg = heartBtn.querySelector('svg');
          if (svg) {
            svg.setAttribute('fill', item.favorited ? '#e11d48' : 'none');
            svg.setAttribute('stroke', item.favorited ? '#e11d48' : '#1c1917');
          }
          showToast(item.favorited ? 'Added to favorites' : 'Removed from favorites', 'info');
        });
      }

      const dlHdBtn = card.querySelector('.card-pill-dl-hd-btn');
      if (dlHdBtn) {
        dlHdBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          downloadMediaAsset(item, true);
        });
      }

      // Card click opens Large Media Viewer Popup with controls and sound
      card.addEventListener('click', () => {
        openMediaViewerModal(item);
      });

      renderedIds.add(item.id);
      els.galleryGrid.appendChild(card);
    });
  }

  // ---------------------------------------------------------------------------
  // LARGE MEDIA VIEWER POPUP (Video with Sound & Controls / Image)
  // ---------------------------------------------------------------------------
  let _mediaViewerControlsInited = false;

  // Download asset helper (normal or 1080p upscaled)
  function downloadMediaAsset(item, upscaled = false) {
    if (!item) return;
    const isVid = item.type === 'video';
    const ext = isVid ? 'mp4' : 'png';
    const filename = `google-flow-${item.id || 'media'}${upscaled ? '-1080p' : ''}.${ext}`;

    let url = item.url;
    if (isVid && upscaled) {
      const hd = [item.upscaled_download_url, item.upscaled_url].find((u) =>
        /^https?:\/\//i.test(String(u || ''))
      );
      url = hd || `${API_BASE}/api/video/download/${encodeURIComponent(item.id)}?upscaled=true`;
    } else if (isVid) {
      const orig = /^https?:\/\//i.test(String(item.url || ''))
        ? item.url
        : `${API_BASE}/api/video/download/${encodeURIComponent(item.id)}?upscaled=false`;
      url = orig;
    }

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast(`Downloading ${upscaled ? '1080p upscaled' : 'original'} version...`, 'info');
  }

  /** Absolute URL safe to paste — prefers 1080p when the clip is upscaled. */
  function resolveShareableMediaUrl(item) {
    if (!item) return '';
    const origin = (typeof window !== 'undefined' && window.location && window.location.origin)
      ? window.location.origin
      : '';
    const isVid = item.type === 'video';
    const isHd = !!(item.upscaled_url || item.upscaled_download_url || item.upscaled_resolution === '1080p');

    let raw = '';
    if (isHd) {
      const candidates = [
        item.upscaled_download_url,
        item.upscaled_url,
      ].filter(Boolean);
      // Prefer a real Google/Flow https URL when native upscale returned one
      raw = candidates.find((u) => /^https?:\/\//i.test(String(u))) || '';
      if (!raw && isVid && item.id) {
        // Local remaster: stable absolute download link (not a bare /api/assets/file path)
        raw = `${origin}${API_BASE}/api/video/download/${encodeURIComponent(item.id)}?upscaled=true`;
      } else if (!raw) {
        raw = candidates[0] || '';
      }
    }
    if (!raw) raw = item.url || '';
    if (!raw) return '';

    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('/')) return `${origin}${raw}`;
    return raw;
  }

  async function copyTextToClipboard(text) {
    if (!text) throw new Error('Nothing to copy');
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (!ok) throw new Error('Clipboard copy failed');
  }

  // 1K / 1080p Video Upscale Trigger
  async function triggerVideoUpscale(item) {
    if (!item || item.type !== 'video') return;
    if (!planAllowsUpscale()) {
      showToast('Video upscale to 1080p is available on Pro and Business plans only.', 'warning');
      return;
    }
    if (item.upscaled_url && item.upscaled_resolution === '1080p') {
      showToast('Video is already upscaled to 1080p', 'info');
      return;
    }
    if (item._isUpscaling) {
      showToast('Upscale already in progress for this video...', 'info');
      return;
    }

    item._isUpscaling = true;
    state.activeUpscales = state.activeUpscales || new Set();
    state.activeUpscales.add(item.id);

    const runId =
      item.runId ||
      (state.activeTasks.get(item.id) || {}).runId ||
      (typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID()) ||
      `upscale-${item.id}`;
    item.runId = runId;
    studioLog('info', `Upscaling to 1080p: ${(item.prompt || item.id || 'video').slice(0, 80)}`, runId);

    showToast('Upscaling video to 1K / 1080p high definition...', 'info');

    const viewerShowsThisItem = () =>
      !!(state.activeItem && state.activeItem.id && state.activeItem.id === item.id);

    // 1. Immediately inject miniature upscale animation on THIS video card only
    const cardEl = document.querySelector(
      `.flow-media-card[data-id="${String(item.id).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`
    );
    if (cardEl) {
      const mediaWrapper = cardEl.querySelector('.card-media-wrapper');
      if (mediaWrapper && !mediaWrapper.querySelector('.card-upscale-overlay')) {
        const overlay = document.createElement('div');
        overlay.className = 'card-upscale-overlay';
        overlay.id = `card-upscale-overlay-${item.id}`;
        overlay.innerHTML = `
          <div class="card-upscale-spinner"></div>
          <span class="card-upscale-badge">Upscaling 1080p...</span>
        `;
        mediaWrapper.appendChild(overlay);
      }
    }

    // 2. Disable dropdown context menu button (only if menu targets this item)
    const ctxUpscaleBtn = document.getElementById('ctx-upscale');
    const ctxUpscaleText = document.getElementById('ctx-upscale-text');
    if (ctxUpscaleBtn && state._ctxMenuItemId === item.id) {
      ctxUpscaleBtn.disabled = true;
      ctxUpscaleBtn.classList.add('disabled', 'loading');
      ctxUpscaleBtn.style.opacity = '0.45';
      ctxUpscaleBtn.style.pointerEvents = 'none';
      if (ctxUpscaleText) ctxUpscaleText.textContent = 'Upscaling to 1080p...';
    }

    // 3. Update viewer modal controls only when THIS video is open
    const viewerUpscaleBtn = document.getElementById('viewer-upscale-btn');
    const viewerUpscaleLabel = document.getElementById('viewer-upscale-label');
    const viewerUpscaleOverlay = document.getElementById('viewer-upscale-overlay');

    if (viewerShowsThisItem()) {
      if (viewerUpscaleBtn) {
        viewerUpscaleBtn.classList.add('loading');
        viewerUpscaleBtn.disabled = true;
      }
      if (viewerUpscaleLabel) viewerUpscaleLabel.textContent = 'Upscaling to 1080p...';
      if (viewerUpscaleOverlay) viewerUpscaleOverlay.classList.remove('hidden');
    }

    try {
      const res = await fetch(`${API_BASE}/api/video/upscale/${item.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: item.url || '',
          aspect_ratio: item.aspect_ratio || item.aspectRatio || '16:9',
          media_id: item.primary_media_id || item.media_id || '',
          workflow_id: item.workflow_id || '',
          run_id: runId,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.detail || 'Video upscale failed');
      }
      const data = await res.json();
      item.upscaled_url = data.upscaled_url;
      item.upscaled_download_url = data.upscaled_download_url;
      item.upscaled_resolution = data.upscaled_resolution || data.resolution || '1080p';

      const match = state.assets.find(a => a.id === item.id);
      if (match) {
        match.upscaled_url = data.upscaled_url;
        match.upscaled_download_url = data.upscaled_download_url;
        match.upscaled_resolution = data.upscaled_resolution || '1080p';
        match.runId = runId;
      }

      studioLog('info', `Upscale complete (1080p): ${(item.prompt || item.id || 'video').slice(0, 80)}`, runId);
      showToast('Video upscaled to 1K / 1080p successfully!', 'success');

      if (viewerShowsThisItem()) {
        updateMediaViewerForUpscale(item);
      }
      // Soft refresh so badge/download stick without full page reload
      loadAssets({ silent: true });
    } catch (e) {
      console.error('Upscale failed:', e);
      studioLog('error', `Upscale failed: ${e.message || 'unknown'}`, runId);
      showToast(`Upscale failed: ${e.message}`, 'error');
    } finally {
      item._isUpscaling = false;
      if (state.activeUpscales) state.activeUpscales.delete(item.id);

      // Remove miniature overlay from THIS card only
      const overlayEl = document.getElementById(`card-upscale-overlay-${item.id}`);
      if (overlayEl) overlayEl.remove();

      // Reset / update dropdown context button only if still for this item
      if (ctxUpscaleBtn && state._ctxMenuItemId === item.id) {
        ctxUpscaleBtn.classList.remove('loading');
        if (item.upscaled_url) {
          ctxUpscaleBtn.disabled = true;
          ctxUpscaleBtn.classList.add('disabled');
          ctxUpscaleBtn.style.opacity = '0.45';
          ctxUpscaleBtn.style.pointerEvents = 'none';
          if (ctxUpscaleText) ctxUpscaleText.textContent = 'Upscaled (1080p) ✓';
        } else {
          ctxUpscaleBtn.disabled = false;
          ctxUpscaleBtn.classList.remove('disabled');
          ctxUpscaleBtn.style.opacity = '1';
          ctxUpscaleBtn.style.pointerEvents = 'auto';
          if (ctxUpscaleText) ctxUpscaleText.textContent = 'Upscale to 1080p';
        }
      }

      renderGallery();

      // Never leak upscale button/overlay state onto a different open video
      if (viewerShowsThisItem()) {
        if (viewerUpscaleOverlay) viewerUpscaleOverlay.classList.add('hidden');
        if (viewerUpscaleBtn) {
          viewerUpscaleBtn.classList.remove('loading');
          viewerUpscaleBtn.disabled = !!item.upscaled_url;
        }
        if (viewerUpscaleLabel) {
          viewerUpscaleLabel.textContent = item.upscaled_url ? 'Upscaled (1080p) ✓' : 'Upscale to 1080p';
        }
      } else if (state.activeItem && state.activeItem.type === 'video') {
        // Re-sync viewer for whatever video is actually open
        const active = state.activeItem;
        const activeHd = !!(active.upscaled_url || active.upscaled_resolution === '1080p');
        const activeUpscaling = !!(active._isUpscaling || (state.activeUpscales && state.activeUpscales.has(active.id)));
        if (viewerUpscaleOverlay) {
          viewerUpscaleOverlay.classList.toggle('hidden', !activeUpscaling);
        }
        if (viewerUpscaleBtn) {
          viewerUpscaleBtn.classList.toggle('loading', !!activeUpscaling);
          viewerUpscaleBtn.disabled = activeHd || activeUpscaling;
        }
        if (viewerUpscaleLabel) {
          viewerUpscaleLabel.textContent = activeUpscaling
            ? 'Upscaling to 1080p...'
            : activeHd
              ? 'Upscaled (1080p) ✓'
              : 'Upscale to 1080p';
        }
      }
    }
  }

  function updateMediaViewerForUpscale(item) {
    const resPill = document.getElementById('viewer-res-pill');
    const hdBadge = document.getElementById('viewer-hd-badge');
    const upscaleBtn = document.getElementById('viewer-upscale-btn');
    const upscaleLabel = document.getElementById('viewer-upscale-label');
    const vid = document.getElementById('viewer-video');

    if (resPill) resPill.textContent = '1080p';
    if (hdBadge) hdBadge.classList.remove('hidden');
    if (upscaleBtn) {
      upscaleBtn.disabled = true;
      if (upscaleLabel) upscaleLabel.textContent = 'Upscaled (1080p) ✓';
    }
    if (vid && item.upscaled_url) {
      const curTime = vid.currentTime || 0;
      const isPaused = vid.paused;
      const original = item.url || '';
      const onErr = () => {
        if (original && (vid.getAttribute('src') || '') !== original) {
          vid.removeEventListener('error', onErr);
          vid.src = original;
          vid.currentTime = curTime;
          if (!isPaused) vid.play().catch(() => {});
        }
      };
      vid.addEventListener('error', onErr);
      vid.src = item.upscaled_url;
      vid.currentTime = curTime;
      if (!isPaused) vid.play().catch(() => {});
    }
  }

  function initMediaViewerControlsOnce() {
    if (_mediaViewerControlsInited) return;
    _mediaViewerControlsInited = true;

    const modal = document.getElementById('media-viewer-modal');
    const closeBtn = document.getElementById('close-media-viewer-btn');
    const downloadBtn = document.getElementById('viewer-download-btn');
    const downloadMenu = document.getElementById('viewer-download-menu');
    const dl720p = document.getElementById('viewer-dl-720p');
    const dl1080p = document.getElementById('viewer-dl-1080p');
    const upscaleBtn = document.getElementById('viewer-upscale-btn');
    const copyBtn = document.getElementById('viewer-copy-btn');
    const animateBtn = document.getElementById('viewer-animate-btn');

    if (closeBtn) closeBtn.addEventListener('click', closeMediaViewerModal);
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeMediaViewerModal();
      });
    }

    if (downloadBtn) {
      downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!state.activeItem || !state.activeItem.url) return;
        if (state.activeItem.type === 'video') {
          if (downloadMenu) downloadMenu.classList.toggle('hidden');
        } else {
          downloadMediaAsset(state.activeItem, false);
        }
      });
    }

    if (dl720p) {
      dl720p.addEventListener('click', (e) => {
        e.stopPropagation();
        if (downloadMenu) downloadMenu.classList.add('hidden');
        if (state.activeItem) downloadMediaAsset(state.activeItem, false);
      });
    }

    if (dl1080p) {
      dl1080p.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (downloadMenu) downloadMenu.classList.add('hidden');
        if (!state.activeItem) return;
        if (!state.activeItem.upscaled_url && !state.activeItem.upscaled_path) {
          await triggerVideoUpscale(state.activeItem);
        }
        downloadMediaAsset(state.activeItem, true);
      });
    }

    if (upscaleBtn) {
      upscaleBtn.addEventListener('click', () => {
        if (state.activeItem) triggerVideoUpscale(state.activeItem);
      });
    }

    // Close download dropdown on outside click
    document.addEventListener('click', (e) => {
      if (downloadMenu && !downloadMenu.classList.contains('hidden')) {
        if (!e.target.closest('.download-dropdown-wrap')) {
          downloadMenu.classList.add('hidden');
        }
      }
    });

    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const item = state.activeItem;
        if (!item) return;
        const shareUrl = resolveShareableMediaUrl(item);
        if (!shareUrl) {
          showToast('No media URL available to copy', 'warning');
          return;
        }
        try {
          await copyTextToClipboard(shareUrl);
          const isHd = !!(item.upscaled_url || item.upscaled_download_url || item.upscaled_resolution === '1080p');
          showToast(isHd ? '1080p upscaled link copied!' : 'Media URL copied to clipboard!', 'success');
        } catch (err) {
          console.warn('Copy link failed:', err);
          showToast('Could not copy link — try Download instead', 'error');
        }
      });
    }

    if (animateBtn) {
      animateBtn.addEventListener('click', async () => {
        if (!state.activeItem) return;
        if (state.activeItem.type === 'video') {
          const target = state.activeItem;
          closeMediaViewerModal();
          await handleExtendVideo(target);
        } else {
          addAssetAsPromptReference(state.activeItem);
          closeMediaViewerModal();
        }
      });
    }
  }

  function openMediaViewerModal(item) {
    if (!item || !item.url) return;
    state.activeItem = item;
    initMediaViewerControlsOnce();

    const modal = document.getElementById('media-viewer-modal');
    const vid = document.getElementById('viewer-video');
    const img = document.getElementById('viewer-image');
    const title = document.getElementById('viewer-title');
    const typeBadge = document.getElementById('viewer-type-badge');
    const promptText = document.getElementById('viewer-prompt-text');
    const modelPill = document.getElementById('viewer-model-pill');
    const aspectPill = document.getElementById('viewer-aspect-pill');
    const resPill = document.getElementById('viewer-res-pill');
    const hdBadge = document.getElementById('viewer-hd-badge');
    const upscaleBtn = document.getElementById('viewer-upscale-btn');
    const upscaleLabel = document.getElementById('viewer-upscale-label');
    const animateLabel = document.getElementById('viewer-animate-label');
    const downloadMenu = document.getElementById('viewer-download-menu');

    if (!modal) return;
    if (downloadMenu) downloadMenu.classList.add('hidden');

    const isVid = item.type === 'video';

    if (title) title.textContent = item.name || item.prompt || 'Media Preview';
    if (typeBadge) typeBadge.textContent = isVid ? 'VIDEO' : 'IMAGE';
    if (promptText) {
      const chars = item.characters || item.characterIds || [];
      const charObjs = Array.isArray(chars)
        ? chars.map((c) => (typeof c === 'string' ? { name: c } : c))
        : [];
      // Fall back: parse @Name from prompt for older cards
      promptText.innerHTML = formatPromptWithCharacterChipsHtml(item.prompt || item.name || '', charObjs);
    }
    if (modelPill) {
      modelPill.textContent = resolveItemModelLabel(item);
    }
    if (aspectPill) aspectPill.textContent = item.aspect_ratio || '16:9';
    if (animateLabel) animateLabel.textContent = isVid ? 'Extend Video' : 'Animate (I2V)';

    if (isVid) {
      const isHd = !!(item.upscaled_url || item.upscaled_resolution === '1080p');
      const isUpscaling = !!(item._isUpscaling || (state.activeUpscales && state.activeUpscales.has(item.id)));
      const viewerUpscaleOverlay = document.getElementById('viewer-upscale-overlay');
      if (viewerUpscaleOverlay) {
        viewerUpscaleOverlay.classList.toggle('hidden', !isUpscaling);
      }
      if (resPill) {
        resPill.classList.remove('hidden');
        resPill.textContent = isHd ? '1080p' : '720p';
      }
      if (hdBadge) hdBadge.classList.toggle('hidden', !isHd);
      if (upscaleBtn) {
        upscaleBtn.classList.remove('hidden');
        upscaleBtn.classList.toggle('loading', !!isUpscaling);
        if (isHd || isUpscaling) {
          upscaleBtn.disabled = true;
          if (upscaleLabel) {
            upscaleLabel.textContent = isUpscaling ? 'Upscaling to 1080p...' : 'Upscaled (1080p) ✓';
          }
        } else {
          upscaleBtn.disabled = false;
          if (upscaleLabel) upscaleLabel.textContent = 'Upscale to 1080p';
        }
      }

      if (img) img.classList.add('hidden');
      if (vid) {
        vid.classList.remove('hidden');
        const original = item.url || '';
        const preferred = item.upscaled_url || item.url || '';
        const onErr = () => {
          if (original && preferred && preferred !== original && (vid.getAttribute('src') || '') !== original) {
            vid.removeEventListener('error', onErr);
            vid.src = original;
            vid.load();
            vid.play().catch(() => {});
          }
        };
        vid.addEventListener('error', onErr);
        vid.src = preferred;
        vid.muted = false; // SOUND ON when opening large view!
        vid.controls = true; // Large view with native controls!
        vid.load();
        vid.play().catch(() => {});
      }
    } else {
      if (resPill) {
        resPill.classList.remove('hidden');
        resPill.textContent = 'Original';
      }
      if (hdBadge) hdBadge.classList.add('hidden');
      if (upscaleBtn) upscaleBtn.classList.add('hidden');

      if (vid) {
        vid.pause();
        vid.src = '';
        vid.classList.add('hidden');
      }
      if (img) {
        img.classList.remove('hidden');
        img.src = item.url;
      }
    }

    modal.classList.remove('hidden');
  }

  function closeMediaViewerModal() {
    const modal = document.getElementById('media-viewer-modal');
    const vid = document.getElementById('viewer-video');
    const downloadMenu = document.getElementById('viewer-download-menu');
    if (downloadMenu) downloadMenu.classList.add('hidden');
    if (vid) {
      vid.pause();
      vid.src = '';
    }
    if (modal) modal.classList.add('hidden');
  }

  async function handleSyncFlowMedia() {
    const btns = [els.headerSyncFlowBtn, els.syncFlowMediaBtn].filter(Boolean);
    btns.forEach(b => {
      b.disabled = true;
      b.classList.add('spinning');
    });

    showToast('Syncing latest media & generations from Google Flow...', 'info');

    try {
      let res = await fetch(`${API_BASE}/api/assets/sync-recent-flow`, { method: 'POST' });
      if (!res.ok) {
        // Fallback to general sync
        res = await fetch(`${API_BASE}/api/assets/sync`, { method: 'POST' });
      }
      if (!res.ok) throw new Error('Sync request failed');

      const data = await res.json();
      state.assets = data.assets || [];

      // Update counters
      const allCount = state.assets.length;
      const vidCount = state.assets.filter(a => a.type === 'video').length;
      const imgCount = state.assets.filter(a => a.type === 'image').length;

      els.galleryCountAll.textContent = allCount;
      els.galleryCountVideo.textContent = vidCount;
      els.galleryCountImage.textContent = imgCount;
      els.headerHistoryCount.textContent = allCount;

      // Drop finished/failed tasks so sync never leaves FAILED videos as "generating"
      for (const id of [...state.activeTasks.keys()]) {
        const asset = state.assets.find(a => a.id === id);
        if (asset && asset.status && asset.status !== 'PROCESSING') {
          state.activeTasks.delete(id);
          if (state.selectedTaskId === id) state.selectedTaskId = null;
        }
      }

      renderGallery();

      // Check if any videos are processing (never poll image uploads as videos)
      state.assets.forEach(a => {
        if (a.status === 'PROCESSING' && a.type === 'video' && !state.activeTasks.has(a.id)) {
          state.activeTasks.set(a.id, {
            ...a,
            startTime: Date.now(),
          });
        }
      });

      if (state.activeTasks.size > 0) {
        renderParallelTasksBar();
        startBackgroundPollingLoop();
      } else {
        els.parallelTasksBar.classList.add('hidden');
        els.liveProgressCard.classList.add('hidden');
      }

      // If active item was empty or pending, load the latest completed
      const latestCompleted = state.assets.find(a => a.url && (a.status === 'COMPLETED' || !a.status));
      if (latestCompleted && (!state.activeItem || !state.activeItem.url)) {
        displayActiveAsset(latestCompleted);
      }

      const count = data.count !== undefined ? data.count : (data.synced_count || allCount);
      showToast(`Synced ${count} media generations from Google Flow!`, 'success');
    } catch (e) {
      console.error('Sync failed:', e);
      showToast(`Sync failed: ${e.message}`, 'error');
    } finally {
      btns.forEach(b => {
        b.disabled = false;
        b.classList.remove('spinning');
      });
    }
  }

  const TOOL_STATE_KEYS = [
    'gflow_bvs_state_v1',
    'gflow_btv_state_v1',
    'gflow_bti_state_v1',
    'gflow_biv_state_v1',
  ];

  async function wipeToolLocalState() {
    for (const key of TOOL_STATE_KEYS) {
      try {
        localStorage.removeItem(key);
      } catch (_) {}
    }
    const wipers = [
      window.wipeStorytellerState,
      window.wipeBulkT2VState,
      window.wipeBulkT2IState,
      window.wipeBulkI2VState,
    ];
    for (const wipe of wipers) {
      if (typeof wipe === 'function') {
        try {
          await wipe({ silent: true });
        } catch (e) {
          console.warn('Tool wipe failed:', e);
        }
      }
    }
  }

  async function clearAllStudioHistory({ confirmMessage } = {}) {
    const msg =
      confirmMessage ||
      'Clear all media and tool grids? This deletes history permanently and cannot be undone.';
    if (!confirm(msg)) return false;
    try {
      const res = await fetch(`${API_BASE}/api/assets/clear`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.error || `Clear failed (${res.status})`);
      }
      await wipeToolLocalState();
      state.assets = [];
      state.activeItem = null;
      renderGallery();
      await loadAssets();
      showToast('All media and tool data cleared', 'info');
      return true;
    } catch (e) {
      console.error('Clear history failed:', e);
      showToast(e.message || 'Failed to clear history', 'error');
      return false;
    }
  }

  async function handleClearGallery() {
    await clearAllStudioHistory({
      confirmMessage: 'Are you sure you want to clear your generation history and tool grids?',
    });
  }

  // ---------------------------------------------------------------------------
  // LIGHTBOX & TOAST NOTIFICATIONS
  // ---------------------------------------------------------------------------
  function openLightbox(item) {
    els.lightboxTarget.innerHTML = '';
    if (item.type === 'video') {
      const v = document.createElement('video');
      v.src = item.url;
      v.controls = true;
      v.autoplay = true;
      v.loop = true;
      els.lightboxTarget.appendChild(v);
    } else {
      const img = document.createElement('img');
      img.src = item.url;
      els.lightboxTarget.appendChild(img);
    }
    els.lightboxModal.classList.remove('hidden');
  }

  function closeLightbox() {
    els.lightboxModal.classList.add('hidden');
    els.lightboxTarget.innerHTML = '';
  }

  function showToast(message, type = 'info') {
    if (!els.toastContainer) return;
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = message;
    els.toastContainer.appendChild(t);

    const isMobile = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 900px)').matches;
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = isMobile ? 'translateY(-8px)' : 'translateY(10px)';
      t.style.transition = '0.3s ease';
      setTimeout(() => t.remove(), 300);
    }, 4000);
  }

  // ---------------------------------------------------------------------------
  // STUDIO ACTIVITY LOGS (admin Prisma ingest — no user Tools UI)
  // ---------------------------------------------------------------------------
  async function loadStudioLogs() {
    /* User Tools tab no longer shows logs; admin reads Prisma. */
  }

  async function studioLog(level, message, runId) {
    try {
      const activeRun =
        runId ||
        (state.selectedTaskId && state.activeTasks.get(state.selectedTaskId)
          ? state.activeTasks.get(state.selectedTaskId).runId
          : null);
      await fetch('/api/studio-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level,
          message,
          source: 'ui',
          runId: activeRun || undefined,
          flowEmail: (state.auth && state.auth.email && state.auth.isAuthenticated
            ? state.auth.email
            : null) || undefined,
        }),
      });
    } catch (_) {
      /* ignore */
    }
  }

  async function clearStudioLogs() {
    showToast('Studio logs are managed in the Admin dashboard', 'info');
  }

  function startStudioLogsPolling() {
    /* no-op: logs moved to /admin/studio-logs */
  }

// ---------------------------------------------------------------------------
  // CHARACTER SYNC HANDLER
  // ---------------------------------------------------------------------------
  async function handleSyncCharacters() {
    if (els.syncCharactersBtn) els.syncCharactersBtn.disabled = true;
    showToast('Syncing characters with Google Flow...', 'info');
    try {
      const res = await fetch(`${API_BASE}/api/characters/sync`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Character sync failed');
      }
      const data = await res.json();
      await loadCharacters();
      showToast(`Synced ${data.imported_count || 0} characters from Google Flow!`, 'success');
    } catch (e) {
      console.error('Character sync failed:', e);
      showToast(`Sync warning: ${e.message}`, 'warning');
    } finally {
      if (els.syncCharactersBtn) els.syncCharactersBtn.disabled = false;
    }
  }

  // ---------------------------------------------------------------------------
  // FIRST FRAME & LAST FRAME CONTROLS (VEO 3.1 TRANSITIONS)
  // ---------------------------------------------------------------------------
  function initFrameControls() {
    // Mode pills
    if (els.fmodeFirstBtn) {
      els.fmodeFirstBtn.addEventListener('click', () => setFrameMode('first_only'));
    }
    if (els.fmodeLastBtn) {
      els.fmodeLastBtn.addEventListener('click', () => setFrameMode('last_only'));
    }
    if (els.fmodeBothBtn) {
      els.fmodeBothBtn.addEventListener('click', () => setFrameMode('first_and_last'));
    }

    // First frame picks
    if (els.pickFirstGalleryBtn) {
      els.pickFirstGalleryBtn.addEventListener('click', () => openRefPickerModal(selectFirstFrame));
    }
    if (els.pickFirstUploadBtn && els.firstFrameFileInput) {
      els.pickFirstUploadBtn.addEventListener('click', () => els.firstFrameFileInput.click());
      els.firstFrameFileInput.addEventListener('change', (e) => handleFrameUpload(e, 'first'));
    }
    if (els.clearFirstFrameBtn) {
      els.clearFirstFrameBtn.addEventListener('click', clearFirstFrame);
    }

    // Last frame picks
    if (els.pickLastGalleryBtn) {
      els.pickLastGalleryBtn.addEventListener('click', () => openRefPickerModal(selectLastFrame));
    }
    if (els.pickLastUploadBtn && els.lastFrameFileInput) {
      els.pickLastUploadBtn.addEventListener('click', () => els.lastFrameFileInput.click());
      els.lastFrameFileInput.addEventListener('change', (e) => handleFrameUpload(e, 'last'));
    }
    if (els.clearLastFrameBtn) {
      els.clearLastFrameBtn.addEventListener('click', clearLastFrame);
    }
  }

  function setFrameMode(mode) {
    state.frameMode = mode;
    if (els.fmodeFirstBtn) els.fmodeFirstBtn.classList.toggle('active', mode === 'first_only');
    if (els.fmodeLastBtn) els.fmodeLastBtn.classList.toggle('active', mode === 'last_only');
    if (els.fmodeBothBtn) els.fmodeBothBtn.classList.toggle('active', mode === 'first_and_last');
    updateGenerateButtonState();
  }

  function selectFirstFrame(asset) {
    const isStaged = Boolean(asset.staged_id || String(asset.id || '').startsWith('staged-'));
    const stagedId = asset.staged_id || (isStaged ? asset.id : null);
    state.firstFrame = {
      id: asset.id || stagedId || null,
      staged_id: stagedId,
      url: asset.url || '',
      name: asset.name || asset.prompt || 'First frame',
    };
    state.videoSubmode = 'frames';
    state.frameMode = state.lastFrame ? 'first_and_last' : 'first_only';
    renderFirstFrameUI();
    updatePromptFramesDisplay();
    updateParamPillSummary();
    showToast('Start frame selected!', 'info');
  }

  function selectLastFrame(asset) {
    const isStaged = Boolean(asset.staged_id || String(asset.id || '').startsWith('staged-'));
    const stagedId = asset.staged_id || (isStaged ? asset.id : null);
    state.lastFrame = {
      id: asset.id || stagedId || null,
      staged_id: stagedId,
      url: asset.url || '',
      name: asset.name || asset.prompt || 'Last frame',
    };
    state.videoSubmode = 'frames';
    state.frameMode = state.firstFrame ? 'first_and_last' : 'last_only';
    renderLastFrameUI();
    updatePromptFramesDisplay();
    updateParamPillSummary();
    showToast('End frame selected!', 'info');
  }

  function clearFirstFrame() {
    state.firstFrame = null;
    state.frameMode = state.lastFrame ? 'last_only' : null;
    renderFirstFrameUI();
    updatePromptFramesDisplay();
    updateParamPillSummary();
    if (els.firstFrameFileInput) els.firstFrameFileInput.value = '';
  }

  function clearLastFrame() {
    state.lastFrame = null;
    state.frameMode = state.firstFrame ? 'first_only' : null;
    renderLastFrameUI();
    updatePromptFramesDisplay();
    updateParamPillSummary();
    if (els.lastFrameFileInput) els.lastFrameFileInput.value = '';
  }

  function renderFirstFrameUI() {
    const has = Boolean(state.firstFrame && (state.firstFrame.url || state.firstFrame.id));
    if (els.firstFrameEmpty) els.firstFrameEmpty.classList.toggle('hidden', has);
    if (els.firstFramePreview) els.firstFramePreview.classList.toggle('hidden', !has);
    if (els.clearFirstFrameBtn) els.clearFirstFrameBtn.classList.toggle('hidden', !has);
    if (els.firstFrameSlot) els.firstFrameSlot.classList.toggle('has-image', has);
    if (has && els.firstFrameImg) els.firstFrameImg.src = state.firstFrame.url;
    if (has && els.firstFrameName) els.firstFrameName.textContent = state.firstFrame.name;
    updateGenerateButtonState();
  }

  function renderLastFrameUI() {
    const has = Boolean(state.lastFrame && (state.lastFrame.url || state.lastFrame.id));
    if (els.lastFrameEmpty) els.lastFrameEmpty.classList.toggle('hidden', has);
    if (els.lastFramePreview) els.lastFramePreview.classList.toggle('hidden', !has);
    if (els.clearLastFrameBtn) els.clearLastFrameBtn.classList.toggle('hidden', !has);
    if (els.lastFrameSlot) els.lastFrameSlot.classList.toggle('has-image', has);
    if (has && els.lastFrameImg) els.lastFrameImg.src = state.lastFrame.url;
    if (has && els.lastFrameName) els.lastFrameName.textContent = state.lastFrame.name;
    updateGenerateButtonState();
  }

  async function handleFrameUpload(event, position) {
    const file = event.target && event.target.files && event.target.files[0];
    if (!file) return;
    const localUrl = URL.createObjectURL(file);
    const frameObj = {
      id: null,
      staged_id: null,
      url: localUrl,
      name: file.name,
    };
    if (position === 'first') {
      state.firstFrame = frameObj;
      state.videoSubmode = 'frames';
      state.frameMode = state.lastFrame ? 'first_and_last' : 'first_only';
      renderFirstFrameUI();
    } else {
      state.lastFrame = frameObj;
      state.videoSubmode = 'frames';
      state.frameMode = state.firstFrame ? 'first_and_last' : 'last_only';
      renderLastFrameUI();
    }
    updatePromptFramesDisplay();
    updateParamPillSummary();
    showToast(`Staging ${position} frame "${file.name}"...`, 'info');
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      const res = await fetch(`${API_BASE}/api/assets/stage`, { method: 'POST', body: form });
      if (res.ok) {
        const data = await res.json();
        const asset = data.asset || data;
        const sid = pickStagedIdFromStageResponse(data);
        if (!sid) {
          showToast('Frame staging returned no staged-* id', 'error');
          return;
        }
        frameObj.staged_id = sid;
        frameObj.id = asset.id || sid;
        if (asset.url) frameObj.url = asset.url;
        showToast(`${position === 'first' ? 'First' : 'Last'} frame staged!`, 'success');
      } else {
        const errData = await res.json().catch(() => ({}));
        showToast(errData.detail || errData.error || 'Frame staging failed', 'error');
      }
    } catch (e) {
      console.warn('Frame staging error:', e);
    }
  }

  // ---------------------------------------------------------------------------
  // INGREDIENT MODE CONTROLS
  // ---------------------------------------------------------------------------
  function initIngredientControls() {
    if (els.ingTypeVideoBtn) {
      els.ingTypeVideoBtn.addEventListener('click', () => {
        state.ingredientOutputType = 'video';
        els.ingTypeVideoBtn.classList.add('active');
        els.ingTypeImageBtn.classList.remove('active');
        setStudioMode('ingredients');
      });
    }
    if (els.ingTypeImageBtn) {
      els.ingTypeImageBtn.addEventListener('click', () => {
        state.ingredientOutputType = 'image';
        els.ingTypeImageBtn.classList.add('active');
        els.ingTypeVideoBtn.classList.remove('active');
        setStudioMode('ingredients');
      });
    }
    if (els.addIngredientBtn && els.ingredientFileInput) {
      els.addIngredientBtn.addEventListener('click', () => els.ingredientFileInput.click());
      els.ingredientFileInput.addEventListener('change', handleIngredientUpload);
    }
    if (els.pickIngredientLibraryBtn) {
      els.pickIngredientLibraryBtn.addEventListener('click', () => openRefPickerModal(addIngredientFromAsset));
    }
    if (els.clearAllIngredientsBtn) {
      els.clearAllIngredientsBtn.addEventListener('click', () => {
        state.ingredients = [];
        renderIngredientsGrid();
      });
    }
    renderIngredientsGrid();
  }

  function addIngredientFromAsset(asset) {
    if (state.ingredients.length >= 3) {
      showToast('Maximum 3 ingredients allowed per synthesis', 'warning');
      return;
    }
    const tags = ['@Character', '@Prop', '@Style'];
    const nextTag = tags[state.ingredients.length] || `@Asset${state.ingredients.length + 1}`;
    state.ingredients.push({
      id: asset.id || null,
      staged_id: asset.staged_id || null,
      url: asset.url || '',
      name: asset.name || asset.prompt || 'Ingredient',
      tag: nextTag,
    });
    renderIngredientsGrid();
    updatePromptAttachedDisplay();
    showToast(`Added ingredient (${nextTag})`, 'success');
  }

  async function handleIngredientUpload(e) {
    const file = e.target && e.target.files && e.target.files[0];
    if (!file) return;
    if (state.ingredients.length >= 3) {
      showToast('Maximum 3 ingredients allowed', 'warning');
      return;
    }
    const localUrl = URL.createObjectURL(file);
    const tags = ['@Character', '@Prop', '@Style'];
    const nextTag = tags[state.ingredients.length] || `@Asset${state.ingredients.length + 1}`;
    const ingObj = {
      id: null,
      staged_id: null,
      url: localUrl,
      name: file.name,
      tag: nextTag,
    };
    state.ingredients.push(ingObj);
    renderIngredientsGrid();
    showToast(`Staging ingredient "${file.name}"...`, 'info');
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      const res = await fetch(`${API_BASE}/api/assets/stage`, { method: 'POST', body: form });
      if (res.ok) {
        const data = await res.json();
        const asset = data.asset || data;
        const sid = pickStagedIdFromStageResponse(data);
        if (!sid) {
          showToast('Ingredient staging returned no staged-* id', 'error');
          return;
        }
        ingObj.staged_id = sid;
        ingObj.id = asset.id || null;
        if (asset.url) ingObj.url = asset.url;
        showToast(`Ingredient ${nextTag} staged!`, 'success');
      } else {
        const errData = await res.json().catch(() => ({}));
        showToast(errData.detail || errData.error || 'Ingredient staging failed', 'error');
      }
    } catch (err) {
      console.warn('Ingredient staging failed:', err);
    }
    e.target.value = '';
  }

  function renderIngredientsGrid() {
    if (!els.ingredientsSlotsGrid) return;
    els.ingredientsSlotsGrid.innerHTML = '';
    if (state.ingredients.length === 0) {
      els.ingredientsSlotsGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 20px; color: var(--text-muted); font-size: 11px;">
          No ingredients added yet. Click "Add Ingredient" or "Choose from Library" to add character portraits, props, or styles.
        </div>
      `;
      return;
    }
    state.ingredients.forEach((ing, idx) => {
      const card = document.createElement('div');
      card.className = 'ingredient-slot-card';
      card.innerHTML = `
        <img class="ing-card-thumb" src="${escapeHtml(ing.url)}" alt="${escapeHtml(ing.name)}" />
        <div class="ing-card-tag">${escapeHtml(ing.tag || `@Asset${idx+1}`)}</div>
        <button type="button" class="ing-card-remove" title="Remove ingredient">&times;</button>
      `;
      const removeBtn = card.querySelector('.ing-card-remove');
      if (removeBtn) {
        removeBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          state.ingredients.splice(idx, 1);
          renderIngredientsGrid();
        });
      }
      els.ingredientsSlotsGrid.appendChild(card);
    });
  }

  // ---------------------------------------------------------------------------
  // MULTI-IMAGE REFERENCE TRAY (IMAGE-TO-IMAGE MULTI MODE)
  // ---------------------------------------------------------------------------
  function initMultiRefControls() {
    if (els.addMoreRefBtn) {
      els.addMoreRefBtn.addEventListener('click', () => {
        openRefPickerModal(addMultiRefImage);
      });
    }
    renderMultiRefTray();
  }

  function addMultiRefImage(asset) {
    if (state.multiRefImages.length >= 7) {
      showToast('Maximum 7 reference images allowed in Image mode', 'warning');
      return;
    }
    state.multiRefImages.push({
      id: asset.id || null,
      staged_id: asset.staged_id || null,
      url: asset.url || '',
      name: asset.name || asset.prompt || 'Reference',
    });
    renderMultiRefTray();
    updatePromptAttachedDisplay();
    showToast(`Reference image added (${state.multiRefImages.length}/7)`, 'info');
  }

  function renderMultiRefTray() {
    if (!els.multiRefItems) return;
    if (els.multiRefCount) {
      els.multiRefCount.textContent = String(state.multiRefImages.length);
    }
    els.multiRefItems.innerHTML = '';
    state.multiRefImages.forEach((img, idx) => {
      const chip = document.createElement('div');
      chip.className = 'multi-ref-chip';
      chip.innerHTML = `
        <img src="${escapeHtml(img.url)}" alt="" />
        <span class="multi-ref-chip-name">${escapeHtml(img.name || `Ref ${idx+1}`)}</span>
        <button type="button" class="multi-ref-remove" title="Remove">&times;</button>
      `;
      const removeBtn = chip.querySelector('.multi-ref-remove');
      if (removeBtn) {
        removeBtn.addEventListener('click', () => {
          state.multiRefImages.splice(idx, 1);
          renderMultiRefTray();
        });
      }
      els.multiRefItems.appendChild(chip);
    });
  }

  // ---------------------------------------------------------------------------
  // INGREDIENT GENERATION DISPATCH
  // ---------------------------------------------------------------------------
  async function executeIngredientGeneration(prompt, localId, charactersArg) {
    const task = state.activeTasks.get(localId) || {};
    let characters = charactersArg || task.characters || getSelectedCharactersPayload();
    if (characters) {
      setTaskPhase(localId, 'submit', 'Preparing characters in Flow…');
      characters = await ensureSelectedCharactersReadyFor(characters);
    }
    const cleanPrompt = stripCharacterTagsFromPrompt(prompt, characters);
    const hasIngredients = Array.isArray(state.ingredients) && state.ingredients.length > 0;
    const hasChars = Boolean(characters && characters.length > 0);

    if (!hasIngredients && !hasChars) {
      // Neither ingredient nor frame required: fallback cleanly to standard generation
      if (state.ingredientOutputType === 'image') {
        return await executeImageGeneration(cleanPrompt, localId, characters);
      } else {
        return await executeVideoGeneration(cleanPrompt, localId, characters);
      }
    }
    const ingredientIds = [];
    const stagedIds = [];
    if (state.ingredients) {
      state.ingredients.forEach(ing => {
        if (ing.staged_id) stagedIds.push(ing.staged_id);
        else if (ing.id) ingredientIds.push(ing.id);
      });
    }

    const isVideo = state.ingredientOutputType === 'video';
    const runId = (state.activeTasks.get(localId) || {}).runId;
    setTaskPhase(localId, 'submit', isVideo ? 'Synthesizing video with ingredients...' : 'Synthesizing image with ingredients...');
    studioLog('info', isVideo ? `Ingredients video: ${cleanPrompt.slice(0, 80)}` : `Ingredients image: ${cleanPrompt.slice(0, 80)}`, runId);
    const body = {
      prompt: cleanPrompt,
      ingredient_ids: ingredientIds,
      staged_ids: stagedIds.length ? stagedIds : undefined,
      characters: characters || undefined,
      output_type: state.ingredientOutputType || 'video',
      aspect_ratio: state.aspectRatio,
      duration: state.duration,
      model: state.model,
      seed: state.seed,
      run_id: runId,
    };

    const res = await fetch(`${API_BASE}/api/generate/ingredients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || 'Ingredient synthesis failed');
    }

    const data = await res.json();
    const asset = data.asset;
    if (asset && (asset.status === 'PROCESSING' || asset.status === 'GENERATING' || asset.status === 'PREPARING')) {
      const taskObj = promotePendingTask(localId, asset, prompt);
      showToast('Veo video rendering in background!', 'info');
      loadStudioLogs();
      loadAssets();
      fetchAuthStatus();
      startBackgroundPollingLoop();
      if (taskObj) updateLiveProgressCardForTask(taskObj);
    } else if (asset && (asset.status === 'IN_QUEUE' || asset.inQueue)) {
      const taskObj = promotePendingTask(localId, { ...asset, status: 'IN_QUEUE', inQueue: true }, prompt);
      showToast(asset.queueMessage || data.message || 'In queue…', 'info');
      loadStudioLogs();
      loadAssets();
      startBackgroundPollingLoop();
      if (taskObj) updateLiveProgressCardForTask(taskObj);
    } else if (asset && asset.status === 'COMPLETED' && asset.url) {
      const taskSnap =
        state.activeTasks.get(localId) ||
        state.activeTasks.get(asset.id) ||
        {};
      const ingStartedAt = taskSnap.startTime || Date.now();
      state.activeTasks.delete(localId);
      state.activeTasks.delete(asset.id);
      if (state.selectedTaskId === localId || state.selectedTaskId === asset.id) {
        state.selectedTaskId = null;
      }
      renderParallelTasksBar();
      displayActiveAsset(asset);
      loadAssets();
      const secs = ((Date.now() - ingStartedAt) / 1000).toFixed(1);
      studioLog(
        'info',
        `Ingredients complete (${secs}s): ${prompt.slice(0, 80)}`,
        runId
      );
      loadStudioLogs();
      showToast(`Ingredient synthesis complete in ${secs}s!`, 'success');
      if (state.activeTasks.size === 0) els.liveProgressCard.classList.add('hidden');
    } else {
      const msg = (asset && (asset.error || asset.errorMessage)) || data.error || data.message || 'Ingredient synthesis failed';
      throw new Error(msg);
    }
  }


  // ===========================================================================
  // OFFICIAL GOOGLE FLOW INTERFACE ENGINE (SCREENSHOTS 1 - 5)
  // ===========================================================================
  let _activeContextItem = null;

  async function applyAdminToolGates() {
    try {
      state.adminToolsEnabled = state.adminToolsEnabled || null;
      const res = await fetch(`${API_BASE}/api/studio/tools`);
      if (!res.ok) return;
      const data = await res.json();
      const tools = data.tools || {};
      state.adminToolsEnabled = tools;

      // Mode tabs
      const modeMap = {
        image: ['[data-mode="image"]', '#mode-image', '.mode-tab[data-mode="image"]'],
        video: ['[data-mode="video"]', '#mode-video', '.mode-tab[data-mode="video"]'],
        'image-to-image': ['[data-mode="image-to-image"]', '#mode-image-to-image'],
        'image-to-video': ['[data-mode="image-to-video"]', '#mode-image-to-video'],
        ingredients: ['[data-mode="ingredients"]', '#mode-ingredients'],
      };
      Object.entries(modeMap).forEach(([id, sels]) => {
        const on = tools[id] !== false;
        sels.forEach((sel) => {
          document.querySelectorAll(sel).forEach((el) => {
            el.classList.toggle('hidden', !on);
            el.style.display = on ? '' : 'none';
          });
        });
      });

      // Lab tool cards + sidebar nav
      const labIds = ['whisk', 'storyteller', 'bulkt2v', 'bulkt2i', 'bulki2v', 'characters'];
      labIds.forEach((id) => {
        const on = tools[id] !== false;
        const card = document.getElementById(`tool-card-${id}`);
        if (card) {
          card.classList.toggle('hidden', !on);
          card.style.display = on ? '' : 'none';
        }
        const nav = document.getElementById(`nav-${id}`);
        if (nav) {
          nav.classList.toggle('hidden', !on);
          nav.style.display = on ? '' : 'none';
        }
      });

      // Context actions
      if (tools.extend === false) {
        const el = document.getElementById('ctx-extend');
        if (el) el.classList.add('hidden');
      }
      if (tools.upscale === false) {
        const el = document.getElementById('ctx-upscale');
        if (el) el.classList.add('hidden');
      }
    } catch (e) {
      console.warn('applyAdminToolGates', e);
    }
  }

  function initOfficialFlowLayout() {
    const STUDIO_SETTINGS_KEY = 'gflow_studio_settings_v1';
    const defaults = {
      soundOnHover: false,
      silentVideos: false,
      showTileDetails: true,
      clearPromptOnSubmit: true,
      gridSize: 'm',
      viewMode: 'grid',
    };
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STUDIO_SETTINGS_KEY) || '{}') || {};
    } catch (_) {
      saved = {};
    }
    const settings = { ...defaults, ...saved };

    state.soundOnHover = !!settings.soundOnHover;
    state.clearPromptOnSubmit = settings.clearPromptOnSubmit !== false;

    // Mobile UX: settings gear is hidden, so default to clearing prompt on mobile.
    // Keep `settings` in sync so any later reads reflect the same value.
    const isMobile =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(max-width: 900px)').matches;
    if (isMobile) {
      state.clearPromptOnSubmit = true;
      settings.clearPromptOnSubmit = true;
    }

    state.searchQuery = '';
    state.batchCount = 1;
    state.studioPlanName = state.studioPlanName || 'Free';
    state.proCreditsAvailable = state.proCreditsAvailable ?? 0;

    function persistStudioSettings(patch) {
      Object.assign(settings, patch || {});
      try {
        localStorage.setItem(STUDIO_SETTINGS_KEY, JSON.stringify(settings));
      } catch (_) {}
    }

    // --- A. Header Actions ---
    const settingsBtn = document.getElementById('header-settings-btn');
    const settingsPopover = document.getElementById('settings-popover');
    if (settingsBtn && settingsPopover) {
      settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsPopover.classList.toggle('hidden');
        if (paramPopover) paramPopover.classList.add('hidden');
      });
    }

    const searchInput = document.getElementById('flow-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value.trim();
        renderGallery();
      });
    }

    const newProjectBtn = document.getElementById('header-new-project-btn');
    if (newProjectBtn) {
      newProjectBtn.addEventListener('click', openProjectModal);
    }

    const helpBtn = document.getElementById('header-help-btn');
    if (helpBtn) {
      helpBtn.addEventListener('click', () => {
        showToast('Google Flow Web Studio: Generate videos & images using Google Flow Veo 3.1 and Imagen 4 models.', 'info');
      });
    }

    // --- B. Left Sidebar Navigation ---
    const sidebar = document.getElementById('flow-sidebar');
    const collapseBtn = document.getElementById('sidebar-collapse-btn');
    const mobileNavBtn = document.getElementById('flow-mobile-nav-btn');
    const sidebarBackdrop = document.getElementById('flow-sidebar-backdrop');
    const shellRoot = document.querySelector('.flow-app-shell');

    function setMobileSidebarOpen(open) {
      if (!shellRoot) return;
      shellRoot.classList.toggle('mobile-nav-open', !!open);
      if (sidebar) sidebar.classList.toggle('mobile-open', !!open);
      if (sidebarBackdrop) {
        sidebarBackdrop.classList.toggle('hidden', !open);
        sidebarBackdrop.setAttribute('aria-hidden', open ? 'false' : 'true');
      }
      if (mobileNavBtn) {
        mobileNavBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        mobileNavBtn.title = open ? 'Close menu' : 'Open menu';
        mobileNavBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      }
      document.body.classList.toggle('flow-mobile-nav-lock', !!open);
    }

    function closeMobileSidebar() {
      setMobileSidebarOpen(false);
    }

    if (collapseBtn && sidebar) {
      collapseBtn.addEventListener('click', () => {
        if (window.matchMedia('(max-width: 900px)').matches) {
          closeMobileSidebar();
          return;
        }
        sidebar.classList.toggle('collapsed');
      });
    }

    if (mobileNavBtn) {
      mobileNavBtn.addEventListener('click', () => {
        const open = !(shellRoot && shellRoot.classList.contains('mobile-nav-open'));
        setMobileSidebarOpen(open);
      });
    }
    if (sidebarBackdrop) {
      sidebarBackdrop.addEventListener('click', closeMobileSidebar);
    }
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMobileSidebar();
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth > 900) closeMobileSidebar();
    });

    const viewsMap = {
      'nav-all-media': { view: 'gallery', filter: 'all' },
      'nav-images': { view: 'gallery', filter: 'image' },
      'nav-videos': { view: 'gallery', filter: 'video' },
      'nav-characters': { view: 'characters' },
      'nav-tools': { view: 'tools' },
      'nav-whisk': { view: 'whisk' },
      'nav-storyteller': { view: 'storyteller' },
      'nav-bulkt2v': { view: 'bulkt2v' },
      'nav-bulkt2i': { view: 'bulkt2i' },
      'nav-bulki2v': { view: 'bulki2v' },
      'nav-trash': { view: 'trash' },
    };

    function activateSidebarNav(btn) {
      if (!btn) return;
      document.querySelectorAll('.flow-sidebar-item').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const cfg = viewsMap[btn.id];
      if (!cfg) return;
      switchFlowView(cfg.view, cfg.filter);
      closeMobileSidebar();
    }

    function bindSidebarNavButton(btn) {
      if (!btn || btn.dataset.navBound === '1') return;
      btn.dataset.navBound = '1';
      btn.addEventListener('click', () => activateSidebarNav(btn));
    }

    Object.keys(viewsMap).forEach((btnId) => {
      bindSidebarNavButton(document.getElementById(btnId));
    });

    const PINNED_TOOLS_KEY = 'gflow_pinned_tools_v2';
    const DEFAULT_PINNED_TOOLS = ['whisk', 'storyteller', 'bulkt2v', 'bulkt2i', 'bulki2v'];

    function loadPinnedTools() {
      try {
        const raw = JSON.parse(localStorage.getItem(PINNED_TOOLS_KEY) || 'null');
        if (Array.isArray(raw)) {
          return raw.filter((id) => typeof id === 'string' && id);
        }
      } catch (_) {}
      return DEFAULT_PINNED_TOOLS.slice();
    }

    function savePinnedTools(ids) {
      try {
        localStorage.setItem(PINNED_TOOLS_KEY, JSON.stringify(ids));
      } catch (_) {}
    }

    function isToolPinned(toolId) {
      return loadPinnedTools().includes(toolId);
    }

    function setToolPinned(toolId, pinned) {
      const ids = loadPinnedTools().filter((id) => id !== toolId);
      if (pinned) ids.push(toolId);
      savePinnedTools(ids);
      return ids;
    }

    function syncToolsCatalogPinButtons() {
      document.querySelectorAll('.tool-card-pin-btn[data-tool-id]').forEach((btn) => {
        const id = btn.getAttribute('data-tool-id');
        const pinned = isToolPinned(id);
        btn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
        btn.textContent = pinned ? 'Unpin' : 'Pin';
      });
    }

    function renderPinnedSidebarTools() {
      const host = document.getElementById('sidebar-pinned-tools');
      if (!host) return;
      const activeId = (document.querySelector('.flow-sidebar-item.active') || {}).id || '';
      const pinned = loadPinnedTools();
      host.innerHTML = '';

      if (pinned.includes('whisk')) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `flow-sidebar-item${activeId === 'nav-whisk' ? ' active' : ''}`;
        btn.dataset.view = 'whisk';
        btn.id = 'nav-whisk';
        btn.innerHTML = `
          <span class="whisk-sidebar-icon">W</span>
          <span class="flow-sidebar-label">Whisk</span>
          <span class="whisk-tag-experimental" style="margin-left:auto;">LAB</span>
        `;
        host.appendChild(btn);
        bindSidebarNavButton(btn);
      }

      if (pinned.includes('storyteller')) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `flow-sidebar-item${activeId === 'nav-storyteller' ? ' active' : ''}`;
        btn.dataset.view = 'storyteller';
        btn.id = 'nav-storyteller';
        btn.innerHTML = `
          <span class="bvs-sidebar-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="14" height="10" rx="2"/><rect x="8" y="3" width="14" height="10" rx="2"/></svg>
          </span>
          <span class="flow-sidebar-label">Storyteller</span>
        `;
        host.appendChild(btn);
        bindSidebarNavButton(btn);
      }

      if (pinned.includes('bulkt2v')) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `flow-sidebar-item${activeId === 'nav-bulkt2v' ? ' active' : ''}`;
        btn.dataset.view = 'bulkt2v';
        btn.id = 'nav-bulkt2v';
        btn.innerHTML = `
          <span class="btv-sidebar-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
          </span>
          <span class="flow-sidebar-label">Bulk T2V</span>
        `;
        host.appendChild(btn);
        bindSidebarNavButton(btn);
      }

      if (pinned.includes('bulkt2i')) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `flow-sidebar-item${activeId === 'nav-bulkt2i' ? ' active' : ''}`;
        btn.dataset.view = 'bulkt2i';
        btn.id = 'nav-bulkt2i';
        btn.innerHTML = `
          <span class="bti-sidebar-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
          </span>
          <span class="flow-sidebar-label">Bulk T2I</span>
        `;
        host.appendChild(btn);
        bindSidebarNavButton(btn);
      }

      if (pinned.includes('bulki2v')) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `flow-sidebar-item${activeId === 'nav-bulki2v' ? ' active' : ''}`;
        btn.dataset.view = 'bulki2v';
        btn.id = 'nav-bulki2v';
        btn.innerHTML = `
          <span class="biv-sidebar-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18"/><polygon points="17 8 22 12 17 16 17 8"/></svg>
          </span>
          <span class="flow-sidebar-label">Bulk I2V</span>
        `;
        host.appendChild(btn);
        bindSidebarNavButton(btn);
      }

      syncToolsCatalogPinButtons();
    }

    function initPinnedToolsUi() {
      function wireTool(openId, pinId, toolId, viewName, pinLabel) {
        const openBtn = document.getElementById(openId);
        if (openBtn && openBtn.dataset.bound !== '1') {
          openBtn.dataset.bound = '1';
          openBtn.addEventListener('click', () => {
            document.querySelectorAll('.flow-sidebar-item').forEach((b) => b.classList.remove('active'));
            const nav = document.getElementById(`nav-${toolId === 'storyteller' ? 'storyteller' : toolId}`);
            if (nav) nav.classList.add('active');
            switchFlowView(viewName);
            closeMobileSidebar();
          });
        }
        const pinBtn = document.getElementById(pinId);
        if (pinBtn && pinBtn.dataset.bound !== '1') {
          pinBtn.dataset.bound = '1';
          pinBtn.addEventListener('click', () => {
            const next = !isToolPinned(toolId);
            setToolPinned(toolId, next);
            renderPinnedSidebarTools();
            showToast(next ? `${pinLabel} pinned to sidebar` : `${pinLabel} unpinned from sidebar`, 'info');
          });
        }
      }

      wireTool('tool-open-whisk', 'tool-pin-whisk', 'whisk', 'whisk', 'Whisk');
      wireTool('tool-open-storyteller', 'tool-pin-storyteller', 'storyteller', 'storyteller', 'Storyteller');
      wireTool('tool-open-bulkt2v', 'tool-pin-bulkt2v', 'bulkt2v', 'bulkt2v', 'Bulk T2V');
      wireTool('tool-open-bulkt2i', 'tool-pin-bulkt2i', 'bulkt2i', 'bulkt2i', 'Bulk T2I');
      wireTool('tool-open-bulki2v', 'tool-pin-bulki2v', 'bulki2v', 'bulki2v', 'Bulk I2V');
      renderPinnedSidebarTools();
    }

    initPinnedToolsUi();

    // Expose for switchFlowView tools pane refresh
    window.__gflowSyncToolsPins = syncToolsCatalogPinButtons;

    // --- C. Settings Popover Handlers (Screenshot 2) ---
    ['s', 'm', 'l'].forEach(size => {
      const btn = document.getElementById(`grid-size-${size}-btn`);
      if (btn) {
        if (settings.gridSize === size) {
          document.querySelectorAll('.grid-size-bar .seg-pill').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          if (els.galleryGrid) els.galleryGrid.className = `flow-media-grid grid-size-${size}`;
        }
        btn.addEventListener('click', () => {
          document.querySelectorAll('.grid-size-bar .seg-pill').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          if (els.galleryGrid) {
            els.galleryGrid.className = `flow-media-grid grid-size-${size}`;
          }
          persistStudioSettings({ gridSize: size });
        });
      }
    });

    const viewGridBtn = document.getElementById('view-mode-grid-btn');
    const viewBatchBtn = document.getElementById('view-mode-batch-btn');
    if (viewGridBtn && viewBatchBtn) {
      const applyView = (mode) => {
        viewGridBtn.classList.toggle('active', mode === 'grid');
        viewBatchBtn.classList.toggle('active', mode === 'batch');
        persistStudioSettings({ viewMode: mode });
      };
      applyView(settings.viewMode === 'batch' ? 'batch' : 'grid');
      viewGridBtn.addEventListener('click', () => applyView('grid'));
      viewBatchBtn.addEventListener('click', () => applyView('batch'));
    }

    const toggleSound = document.getElementById('toggle-sound-hover');
    if (toggleSound) {
      toggleSound.checked = !!settings.soundOnHover;
      toggleSound.addEventListener('change', (e) => {
        state.soundOnHover = e.target.checked;
        persistStudioSettings({ soundOnHover: e.target.checked });
        showToast(state.soundOnHover ? 'Sound on hover enabled' : 'Sound on hover disabled', 'info');
      });
    }

    const toggleSilent = document.getElementById('toggle-silent-videos');
    if (toggleSilent) {
      toggleSilent.checked = !!settings.silentVideos;
      toggleSilent.addEventListener('change', (e) => {
        persistStudioSettings({ silentVideos: e.target.checked });
      });
    }

    const toggleTileDetails = document.getElementById('toggle-tile-details');
    if (toggleTileDetails) {
      toggleTileDetails.checked = settings.showTileDetails !== false;
      if (els.galleryGrid) {
        els.galleryGrid.classList.toggle('hide-tile-details', !toggleTileDetails.checked);
      }
      toggleTileDetails.addEventListener('change', (e) => {
        if (els.galleryGrid) {
          els.galleryGrid.classList.toggle('hide-tile-details', !e.target.checked);
        }
        persistStudioSettings({ showTileDetails: e.target.checked });
      });
    }

    const toggleClearPrompt = document.getElementById('toggle-clear-prompt');
    if (toggleClearPrompt) {
      // Default ON; honor saved preference
      toggleClearPrompt.checked = state.clearPromptOnSubmit;
      toggleClearPrompt.addEventListener('change', (e) => {
        state.clearPromptOnSubmit = e.target.checked;
        persistStudioSettings({ clearPromptOnSubmit: e.target.checked });
        localStorage.setItem('flow_clear_prompt_on_submit', String(e.target.checked));
        showToast(state.clearPromptOnSubmit ? 'Clear prompt on submit enabled' : 'Clear prompt on submit disabled', 'info');
      });
    }

    // --- D. Floating Bottom Generation Bar & Popover (Screenshots 2, 3, 4, 5) ---
    const paramPill = document.getElementById('parameter-pill');
    const paramPopover = document.getElementById('parameter-popover');
    if (paramPill && paramPopover) {
      paramPill.addEventListener('click', (e) => {
        e.stopPropagation();
        paramPopover.classList.toggle('hidden');
        if (settingsPopover) settingsPopover.classList.add('hidden');
      });
    }

    const attachBtn = document.getElementById('prompt-attach-btn');
    if (attachBtn) {
      attachBtn.addEventListener('click', () => {
        openRefPickerModal(null, 'Select an asset');
      });
    }

    // Image / Video Mode Switcher in Popover
    const popModeImg = document.getElementById('popover-mode-image-btn');
    const popModeVid = document.getElementById('popover-mode-video-btn');
    const videoSubmodes = document.getElementById('popover-video-submodes');
    const resolutionRow = document.getElementById('popover-resolution-row');
    const durationRow = document.getElementById('popover-duration-row');
    const creditsText = document.getElementById('popover-credits-text');
    const creditsNum = document.getElementById('credits-cost-number');

    if (popModeImg && popModeVid) {
      popModeImg.addEventListener('click', () => {
        syncPopoverWithMode('image');
        setStudioMode(state.multiRefImages && state.multiRefImages.length > 0 ? 'image-to-image' : 'image');
      });

      popModeVid.addEventListener('click', () => {
        syncPopoverWithMode('video');
        const targetMode = (state.videoSubmode === 'frames' && (state.firstFrame || state.lastFrame))
          ? 'image-to-video'
          : ((state.ingredients && state.ingredients.length > 0) || state.videoSubmode === 'ingredients'
             ? 'ingredients'
             : 'video');
        setStudioMode(targetMode);
      });
    }

    // Video Sub-Options: Frames & Ingredients (Screenshot 2 & 3)
    const subFramesBtn = document.getElementById('param-sub-frames-btn');
    const subIngBtn = document.getElementById('param-sub-ingredients-btn');
    const framesDrawer = document.getElementById('frame-controls-card');
    const ingredientsDrawer = document.getElementById('ingredients-card');

    if (subFramesBtn) {
      subFramesBtn.addEventListener('click', () => {
        const wasActive = subFramesBtn.classList.contains('active');
        if (wasActive) {
          subFramesBtn.classList.remove('active');
          state.videoSubmode = null;
          setStudioMode('video');
        } else {
          subFramesBtn.classList.add('active');
          if (subIngBtn) subIngBtn.classList.remove('active');
          state.videoSubmode = 'frames';
          setStudioMode('image-to-video');
        }
        if (framesDrawer) framesDrawer.classList.add('hidden');
        if (ingredientsDrawer) ingredientsDrawer.classList.add('hidden');
        updatePromptFramesDisplay();
        updatePromptAttachedDisplay();
        updateParamPillSummary();
      });
    }

    if (subIngBtn) {
      subIngBtn.addEventListener('click', () => {
        const wasActive = subIngBtn.classList.contains('active');
        if (wasActive) {
          subIngBtn.classList.remove('active');
          state.videoSubmode = null;
          setStudioMode('video');
        } else {
          subIngBtn.classList.add('active');
          if (subFramesBtn) subFramesBtn.classList.remove('active');
          state.videoSubmode = 'ingredients';
          setStudioMode('ingredients');
        }
        if (ingredientsDrawer) ingredientsDrawer.classList.add('hidden');
        if (framesDrawer) framesDrawer.classList.add('hidden');
        updatePromptFramesDisplay();
        updatePromptAttachedDisplay();
        updateParamPillSummary();
      });
    }

    // Aspect Ratio wireframe cards
    document.querySelectorAll('.popover-aspect-card').forEach(btn => {
      btn.addEventListener('click', () => {
        const aspect = btn.dataset.aspect;
        setAspectRatio(aspect);
      });
    });

    // Duration pills
    document.querySelectorAll('#popover-duration-row .popover-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#popover-duration-row .popover-pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.duration = parseInt(btn.dataset.dur) || 8;
        updateCreditCostDisplay();
        updateParamPillSummary();
      });
    });

    // Model select
    const modelSelect = document.getElementById('popover-model-select');
    if (modelSelect) {
      modelSelect.addEventListener('change', (e) => {
        state.model = e.target.value;
        const opt = [...els.modelOptions].find(o => o.dataset.model === state.model);
        if (opt) {
          els.modelOptions.forEach(o => o.classList.remove('active'));
          opt.classList.add('active');
        }
        updateDurationOptionsForModel(state.model);
        updateCreditCostDisplay();
        updateParamPillSummary();
      });
    }

    updateDurationOptionsForModel(state.model);

    // Inline Frames Controls (Screenshot 2: Start ⇆ End)
    const startFrameBtn = document.getElementById('prompt-start-frame-btn');
    const endFrameBtn = document.getElementById('prompt-end-frame-btn');
    const swapFramesBtn = document.getElementById('prompt-swap-frames-btn');

    if (startFrameBtn) {
      startFrameBtn.addEventListener('click', () => openRefPickerModal(selectFirstFrame, 'Select a frame image'));
    }
    if (endFrameBtn) {
      endFrameBtn.addEventListener('click', () => openRefPickerModal(selectLastFrame, 'Select a frame image'));
    }
    if (swapFramesBtn) {
      swapFramesBtn.addEventListener('click', () => {
        const temp = state.firstFrame;
        state.firstFrame = state.lastFrame;
        state.lastFrame = temp;
        renderFirstFrameUI();
        renderLastFrameUI();
        updatePromptFramesDisplay();
        showToast('Swapped start & end frames!', 'info');
      });
    }

    // Prompt Box Attached Asset / Frames Clear Button (Screenshot 3 & 5: ✕)
    const clearAttachedBtn = document.getElementById('prompt-box-clear-attached-btn');
    if (clearAttachedBtn) {
      clearAttachedBtn.addEventListener('click', () => {
        clearReferenceImage();
        state.firstFrame = null;
        state.lastFrame = null;
        state.frameMode = null;
        state.ingredients = [];
        state.multiRefImages = [];
        state.selectedCharacterIds.clear();
        renderFirstFrameUI();
        renderLastFrameUI();
        renderIngredientsGrid();
        renderMultiRefTray();
        renderCharactersList();
        renderCharactersPageList();
        updateSelectedCharactersBar();
        updatePromptFramesDisplay();
        updatePromptAttachedDisplay();
        updateParamPillSummary();
        showToast('Cleared all attachments', 'info');
      });
    }

    // Credit Notification Banner Actions (frame_001.jpg)
    const bannerCloseBtn = document.getElementById('banner-close-btn');
    const bannerAddCreditsBtn = document.getElementById('banner-add-credits-btn');
    const creditBanner = document.getElementById('flow-credit-banner');

    if (bannerCloseBtn && creditBanner) {
      bannerCloseBtn.addEventListener('click', () => {
        creditBanner.classList.add('hidden');
      });
    }
    if (bannerAddCreditsBtn) {
      bannerAddCreditsBtn.addEventListener('click', () => {
        openAuthModal();
      });
    }

    // Live ticker for progress on generating canvas cards
    setInterval(() => {
      const activeTasks = Array.from(state.activeTasks.values()).filter(t => t.status === 'PROCESSING' || t.status === 'PREPARING');
      if (activeTasks.length === 0) return;
      activeTasks.forEach(task => {
        const elapsedSec = (Date.now() - (task.startTime || Date.now())) / 1000;
        let percent = Math.min(95, Math.max(1, Math.round(100 * (1 - Math.exp(-elapsedSec / 18)))));
        if (task.progress) percent = Math.max(percent, Math.round(task.progress));
        task.progress = percent;

        const cardEl = document.querySelector(`.flow-generating-card[data-task-id="${task.id}"]`);
        if (cardEl) {
          const isSub = task.phase === 'submit' || task.phase === 'ack' || task.status === 'PREPARING';
          const pill = cardEl.querySelector('.gen-card-percent-pill');
          if (pill) pill.textContent = isSub ? 'Submitting' : `${percent}%`;
          const lbl = cardEl.querySelector('.gen-card-status-label');
          if (lbl) lbl.textContent = isSub ? 'Submitting…' : 'Generating…';
          const num = cardEl.querySelector('.gen-card-progress-num');
          if (num) num.textContent = `${percent}%`;
        }
      });
    }, 1200);

    // Textarea Enter key triggers generation (clear handled inside triggerGeneration)
    if (els.promptInput) {
      els.promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          triggerGeneration();
        }
      });
    }

    // --- E. Global Click Closes Popovers & Context Menus ---
    function closeCardContextMenu() {
      const ctxMenu = document.getElementById('card-context-menu');
      if (ctxMenu) ctxMenu.classList.add('hidden');
    }

    document.addEventListener('click', (e) => {
      const ctxMenu = document.getElementById('card-context-menu');
      if (
        ctxMenu &&
        !ctxMenu.contains(e.target) &&
        !e.target.closest('.card-pill-menu-btn') &&
        !e.target.closest('.context-menu-trigger-btn')
      ) {
        closeCardContextMenu();
      }

      if (paramPopover && !paramPopover.contains(e.target) && !e.target.closest('#parameter-pill')) {
        paramPopover.classList.add('hidden');
      }

      if (settingsPopover && !settingsPopover.contains(e.target) && !e.target.closest('#header-settings-btn')) {
        settingsPopover.classList.add('hidden');
      }
    });

    // Fixed menu stays on screen while the gallery scrolls — looks like it's "moving".
    const canvasViewport = document.querySelector('.flow-canvas-viewport');
    if (canvasViewport) {
      canvasViewport.addEventListener('scroll', closeCardContextMenu, { passive: true });
    }
    window.addEventListener('resize', closeCardContextMenu);

    // Context menu item listeners
    initCardContextMenuActions();
    initToolsSubtabs();
    updateCreditCostDisplay();
    updateParamPillSummary();
    updatePromptFramesDisplay();
    updatePromptAttachedDisplay();
    updateIngredientsTooltipDisplay();
    syncPopoverWithMode(state.family || 'video');
  }

  function initToolsSubtabs() {
    const tabWhisk = document.getElementById('tools-tab-whisk');
    const tabLogs = document.getElementById('tools-tab-logs');
    const paneWhisk = document.getElementById('tools-subpane-whisk');
    const paneLogs = document.getElementById('tools-subpane-logs');

    if (tabWhisk && tabLogs && paneWhisk && paneLogs) {
      tabWhisk.addEventListener('click', () => {
        tabWhisk.classList.add('active');
        tabLogs.classList.remove('active');
        paneWhisk.classList.remove('hidden');
        paneLogs.classList.add('hidden');
        if (window.initWhisk) window.initWhisk();
      });

      tabLogs.addEventListener('click', () => {
        tabLogs.classList.add('active');
        tabWhisk.classList.remove('active');
        paneLogs.classList.remove('hidden');
        paneWhisk.classList.add('hidden');
        loadStudioLogs();
      });
    }
  }

  const STUDIO_BASE_PATH = '/dashboard/studio';

  function parseStudioPath(pathname) {
    const path = String(pathname || '');
    if (!path.startsWith(STUDIO_BASE_PATH)) {
      return { view: 'gallery', filter: 'all' };
    }
    const rest = path.slice(STUDIO_BASE_PATH.length).replace(/^\//, '');
    const slug = (rest.split('/')[0] || '').toLowerCase();
    switch (slug) {
      case '':
      case 'gallery':
      case 'media':
        return { view: 'gallery', filter: 'all' };
      case 'images':
      case 'image':
        return { view: 'gallery', filter: 'image' };
      case 'videos':
      case 'video':
        return { view: 'gallery', filter: 'video' };
      case 'characters':
      case 'character':
        return { view: 'characters', filter: 'all' };
      case 'scenes':
      case 'scene':
      case 'storyboard':
        return { view: 'scenes', filter: 'all' };
      case 'tools':
      case 'tool':
        return { view: 'tools', filter: 'all' };
      case 'whisk':
        return { view: 'whisk', filter: 'all' };
      case 'storyteller':
      case 'story':
        return { view: 'storyteller', filter: 'all' };
      case 'bulkt2v':
      case 'bulk-t2v':
      case 'bulktexttovideo':
        return { view: 'bulkt2v', filter: 'all' };
      case 'bulkt2i':
      case 'bulk-t2i':
      case 'bulktexttoimage':
        return { view: 'bulkt2i', filter: 'all' };
      case 'bulki2v':
      case 'bulk-i2v':
      case 'bulkimagetovideo':
        return { view: 'bulki2v', filter: 'all' };
      default:
        return { view: 'gallery', filter: 'all' };
    }
  }

  function pathForStudioView(viewName, filter = 'all') {
    if (viewName === 'gallery') {
      if (filter === 'image' || filter === 'images') return `${STUDIO_BASE_PATH}/images`;
      if (filter === 'video' || filter === 'videos') return `${STUDIO_BASE_PATH}/videos`;
      return STUDIO_BASE_PATH;
    }
    if (viewName === 'characters') return `${STUDIO_BASE_PATH}/characters`;
    if (viewName === 'scenes') return `${STUDIO_BASE_PATH}/scenes`;
    if (viewName === 'tools') return `${STUDIO_BASE_PATH}/tools`;
    if (viewName === 'whisk') return `${STUDIO_BASE_PATH}/whisk`;
    if (viewName === 'storyteller') return `${STUDIO_BASE_PATH}/storyteller`;
    if (viewName === 'bulkt2v') return `${STUDIO_BASE_PATH}/bulkt2v`;
    if (viewName === 'bulkt2i') return `${STUDIO_BASE_PATH}/bulkt2i`;
    if (viewName === 'bulki2v') return `${STUDIO_BASE_PATH}/bulki2v`;
    // uploads/trash stay on gallery URL
    return STUDIO_BASE_PATH;
  }

  function syncStudioUrl(viewName, filter = 'all', { replace = false } = {}) {
    try {
      const nextPath = pathForStudioView(viewName, filter);
      const search = window.location.search || '';
      const hash = window.location.hash || '';
      const nextFull = `${nextPath}${search}${hash}`;
      const curFull = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (curFull === nextFull) return;
      const histState = { studioView: viewName, filter };
      if (replace) window.history.replaceState(histState, '', nextFull);
      else window.history.pushState(histState, '', nextFull);
    } catch (_) {}
  }

  function setActiveNavForView(viewName, filter = 'all') {
    let id = 'nav-all-media';
    if (viewName === 'gallery' && (filter === 'image' || filter === 'images')) id = 'nav-images';
    else if (viewName === 'gallery' && (filter === 'video' || filter === 'videos')) id = 'nav-videos';
    else if (viewName === 'characters') id = 'nav-characters';
    else if (viewName === 'tools') id = 'nav-tools';
    else if (viewName === 'whisk') id = 'nav-whisk';
    else if (viewName === 'storyteller') id = 'nav-storyteller';
    else if (viewName === 'bulkt2v') id = 'nav-bulkt2v';
    else if (viewName === 'bulkt2i') id = 'nav-bulkt2i';
    else if (viewName === 'bulki2v') id = 'nav-bulki2v';
    document.querySelectorAll('.flow-sidebar-item').forEach((b) => b.classList.remove('active'));
    const btn = document.getElementById(id);
    if (btn) btn.classList.add('active');
  }

  async function switchFlowView(viewName, filter = 'all', opts = {}) {
    const panes = {
      'gallery': document.getElementById('view-gallery-pane'),
      'characters': document.getElementById('view-characters-pane'),
      'scenes': document.getElementById('view-scenes-pane'),
      'tools': document.getElementById('view-tools-pane'),
      'whisk': document.getElementById('view-whisk-pane'),
      'storyteller': document.getElementById('view-storyteller-pane'),
      'bulkt2v': document.getElementById('view-bulkt2v-pane'),
      'bulkt2i': document.getElementById('view-bulkt2i-pane'),
      'bulki2v': document.getElementById('view-bulki2v-pane'),
    };

    Object.keys(panes).forEach(k => {
      if (panes[k]) panes[k].classList.remove('active');
    });

    const promptBar = document.getElementById('floating-prompt-bar');
    const galleryFilter = filter || 'all';

    if (viewName === 'gallery') {
      if (promptBar) promptBar.style.display = '';
      if (panes.gallery) panes.gallery.classList.add('active');
      state.galleryFilter = galleryFilter;
      renderGallery();
      loadAssets(); // Keep gallery media in sync with database when switching tabs
    } else if (viewName === 'characters') {
      if (promptBar) promptBar.style.display = '';
      if (panes.characters) panes.characters.classList.add('active');
      loadCharacters();
    } else if (viewName === 'scenes') {
      if (promptBar) promptBar.style.display = '';
      if (panes.scenes) panes.scenes.classList.add('active');
      renderStoryboard();
    } else if (viewName === 'tools') {
      if (promptBar) promptBar.style.display = '';
      if (panes.tools) panes.tools.classList.add('active');
      if (typeof window.__gflowSyncToolsPins === 'function') window.__gflowSyncToolsPins();
    } else if (viewName === 'whisk') {
      // In Whisk view, dedicated modular dock is used, so hide bottom floating prompt bar
      if (promptBar) promptBar.style.display = 'none';
      if (panes.whisk) panes.whisk.classList.add('active');
      if (window.initWhisk) window.initWhisk();
    } else if (viewName === 'storyteller') {
      if (promptBar) promptBar.style.display = 'none';
      if (panes.storyteller) panes.storyteller.classList.add('active');
      if (window.initStoryteller) window.initStoryteller();
    } else if (viewName === 'bulkt2v') {
      if (promptBar) promptBar.style.display = 'none';
      if (panes.bulkt2v) panes.bulkt2v.classList.add('active');
      if (window.initBulkT2V) window.initBulkT2V();
    } else if (viewName === 'bulkt2i') {
      if (promptBar) promptBar.style.display = 'none';
      if (panes.bulkt2i) panes.bulkt2i.classList.add('active');
      if (window.initBulkT2I) window.initBulkT2I();
    } else if (viewName === 'bulki2v') {
      if (promptBar) promptBar.style.display = 'none';
      if (panes.bulki2v) panes.bulki2v.classList.add('active');
      if (window.initBulkI2V) window.initBulkI2V();
    } else if (viewName === 'uploads') {
      if (promptBar) promptBar.style.display = '';
      openRefPickerModal(selectRefImage);
      if (panes.gallery) panes.gallery.classList.add('active');
    } else if (viewName === 'trash') {
      if (promptBar) promptBar.style.display = '';
      // Sidebar Trash = permanent wipe (DB + tool localStorage), not an in-memory clear
      await clearAllStudioHistory({
        confirmMessage:
          'Clear all media and tool grids? This deletes history permanently and cannot be undone.',
      });
      if (panes.gallery) panes.gallery.classList.add('active');
    }

    if (!opts.skipUrl) {
      syncStudioUrl(
        viewName === 'uploads' || viewName === 'trash' ? 'gallery' : viewName,
        viewName === 'gallery' ? galleryFilter : 'all',
        { replace: !!opts.replaceUrl }
      );
    }
    if (!opts.skipNav) {
      setActiveNavForView(
        viewName === 'uploads' || viewName === 'trash' ? 'gallery' : viewName,
        viewName === 'gallery' ? galleryFilter : 'all'
      );
    }
  }

  function restoreStudioViewFromUrl({ replaceUrl = true } = {}) {
    const parsed = parseStudioPath(window.location.pathname);
    setActiveNavForView(parsed.view, parsed.filter);
    switchFlowView(parsed.view, parsed.filter, {
      skipNav: true,
      replaceUrl: !!replaceUrl,
    });
  }

  function setAspectRatio(aspect) {
    if (!aspect) return;
    state.aspectRatio = aspect;
    document.querySelectorAll('.popover-aspect-card').forEach(b => {
      b.classList.toggle('active', b.dataset.aspect === aspect);
    });
    if (els.aspectOptions) {
      els.aspectOptions.forEach(o => {
        o.classList.toggle('active', o.dataset.aspect === aspect);
      });
    }
    updateParamPillSummary();
  }

  function updateParamPillSummary() {
    const pillText = document.getElementById('param-pill-text');
    if (!pillText) return;

    const aspect = state.aspectRatio || '16:9';
    const durStr = `${state.duration || 8}s`;
    const isImage =
      state.family === 'image' || state.mode === 'image' || state.mode === 'image-to-image';
    const modelName = formatModelDisplayName(
      state.model,
      isImage ? 'image' : 'video'
    );

    if (isImage) {
      pillText.textContent = `${modelName} · ${aspect}`;
    } else {
      pillText.textContent = `${modelName} · ${durStr} · ${aspect}`;
    }
  }

  async function handleExtendVideo(item) {
    if (!item || item.type !== 'video') return;
    if (!item.url) {
      showToast('Video is not ready yet', 'warning');
      return;
    }
    const extendBtn = document.getElementById('ctx-extend');
    if (extendBtn) {
      extendBtn.disabled = true;
      extendBtn.classList.add('disabled', 'loading');
    }
    showToast('Downloading video & extracting last frame...', 'info');
    try {
      const res = await fetch(`${API_BASE}/api/video/last-frame/${encodeURIComponent(item.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: item.url, video_url: item.url }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to extract last frame');
      }
      const data = await res.json();
      const frameAsset = data.asset || { id: data.image_id, url: data.url };
      if (!frameAsset.url && data.data_url) frameAsset.url = data.data_url;

      // Attach last frame as starting frame in prompt box
      selectFirstFrame(frameAsset);
      state.family = 'video';
      state.videoSubmode = 'frames';
      state.frameMode = 'first_only';
      state.lastFrame = null;
      if (els.frameLastSlot) els.frameLastSlot.classList.add('hidden');

      updatePromptFramesDisplay();
      updatePromptAttachedDisplay();
      updateParamPillSummary();
      showToast('Last frame attached! Enter your prompt to continue the video.', 'success');
      if (els.promptInput) {
        els.promptInput.focus();
      }
    } catch (e) {
      console.error('Extend last-frame error:', e);
      showToast(`Extend failed: ${e.message}`, 'error');
    } finally {
      if (extendBtn) {
        extendBtn.disabled = false;
        extendBtn.classList.remove('disabled', 'loading');
      }
    }
  }

  async function deleteAsset(assetId, opts) {
    const item =
      (opts && opts.item) ||
      (state.assets || []).find((a) => a.id === assetId) ||
      null;
    const jobId = (opts && opts.jobId) || (item && (item.jobId || item.job_id)) || null;
    const url = (opts && opts.url) || (item && item.url) || null;
    try {
      const qs = new URLSearchParams();
      if (assetId) qs.set('id', assetId);
      if (jobId) qs.set('jobId', jobId);
      if (url) qs.set('url', url);
      const res = await fetch(`${API_BASE}/api/assets?${qs.toString()}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Delete failed (${res.status})`);
      }
    } catch (e) {
      console.warn('Error deleting asset:', e);
      showToast(`Delete failed: ${e.message || e}`, 'error');
      return false;
    }
    const removeIds = new Set([assetId, jobId].filter(Boolean));
    state.assets = state.assets.filter((a) => !removeIds.has(a.id) && !removeIds.has(a.jobId));
    if (state.activeItem && (removeIds.has(state.activeItem.id) || removeIds.has(state.activeItem.jobId))) {
      state.activeItem = null;
    }
    renderGallery();
    return true;
  }

  async function retryFailedGeneration(item) {
    if (!item) return;
    if (item.prompt && els.promptInput) {
      els.promptInput.value = item.prompt;
    }
    if (item.aspect_ratio) {
      state.aspectRatio = item.aspect_ratio;
    }
    if (item.duration) {
      state.duration = item.duration;
    }
    if (item.model) {
      state.model = item.model;
    }
    updateParamPillSummary();

    // Delete failed item so it gets replaced
    await deleteAsset(item.id, { item, jobId: item.jobId || item.id, url: item.url });
    showToast('Retrying generation...', 'info');
    triggerGeneration();
  }

  function openCardContextMenu(item, e) {
    _activeContextItem = item;
    state._ctxMenuItemId = item && item.id ? item.id : null;
    const ctx = document.getElementById('card-context-menu');
    if (!ctx) return;

    const isVid = item.type === 'video';
    const extendBtn = document.getElementById('ctx-extend');
    const animateBtn = document.getElementById('ctx-animate');
    const addPromptBtn = document.getElementById('ctx-add-prompt');
    const upscaleBtn = document.getElementById('ctx-upscale');
    const upscaleText = document.getElementById('ctx-upscale-text');
    const dlUpscaledBtn = document.getElementById('ctx-download-upscaled');

    // Video: show Extend, hide Animate and Add to prompt
    // Image: hide Extend, show Animate and Add to prompt
    if (extendBtn) extendBtn.classList.toggle('hidden', !isVid);
    if (animateBtn) animateBtn.classList.toggle('hidden', isVid);
    if (addPromptBtn) addPromptBtn.classList.toggle('hidden', isVid);

    const isUpscaled = !!(item.upscaled_url || item.upscaled_resolution === '1080p');
    const isUpscaling = !!(item._isUpscaling || (state.activeUpscales && state.activeUpscales.has(item.id)));
    if (upscaleBtn) {
      upscaleBtn.classList.toggle('hidden', !isVid);
      if (isVid) {
        if (upscaleText) {
          if (isUpscaling) {
            upscaleText.textContent = 'Upscaling to 1080p...';
          } else {
            upscaleText.textContent = isUpscaled ? 'Upscaled (1080p) ✓' : 'Upscale to 1080p';
          }
        }
        upscaleBtn.disabled = isUpscaled || isUpscaling;
        upscaleBtn.classList.toggle('disabled', isUpscaled || isUpscaling);
        upscaleBtn.classList.toggle('loading', isUpscaling);
        upscaleBtn.style.opacity = (isUpscaled || isUpscaling) ? '0.45' : '1';
        upscaleBtn.style.pointerEvents = (isUpscaled || isUpscaling) ? 'none' : 'auto';
      }
    }
    if (dlUpscaledBtn) {
      dlUpscaledBtn.classList.toggle('hidden', !isVid || !isUpscaled);
    }

    // Anchor to the ⋯ button itself — e.target is often an SVG child, which
    // made the menu jump left/mid-card (especially on full-width mobile cards).
    const trigger =
      (e && e.currentTarget) ||
      (e && e.target && e.target.closest && e.target.closest('.card-pill-menu-btn')) ||
      null;
    const rect = (trigger || (e && e.target) || { getBoundingClientRect: () => ({ left: 10, right: 40, bottom: 40, top: 10 }) })
      .getBoundingClientRect();

    ctx.classList.remove('hidden');
    const menuWidth = Math.max(ctx.offsetWidth || 0, 200);
    const menuHeight = Math.max(ctx.offsetHeight || 0, 220);
    const pad = 8;
    let left = rect.right - menuWidth;
    let top = rect.bottom + 6;
    left = Math.max(pad, Math.min(left, window.innerWidth - menuWidth - pad));
    if (top + menuHeight > window.innerHeight - pad) {
      top = Math.max(pad, rect.top - menuHeight - 6);
    }
    top = Math.max(pad, Math.min(top, window.innerHeight - menuHeight - pad));
    ctx.style.left = `${Math.round(left)}px`;
    ctx.style.top = `${Math.round(top)}px`;
  }

  function initCardContextMenuActions() {
    const act = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', () => {
        document.getElementById('card-context-menu').classList.add('hidden');
        if (_activeContextItem) fn(_activeContextItem);
      });
    };

    act('ctx-favorite', (item) => {
      item.favorite = !item.favorite;
      showToast(item.favorite ? 'Added to favorites' : 'Removed from favorites', 'info');
      renderGallery();
    });

    act('ctx-extend', async (item) => {
      await handleExtendVideo(item);
    });

    act('ctx-animate', (item) => {
      addAssetAsPromptReference(item);
    });

    act('ctx-add-prompt', (item) => {
      addAssetAsPromptReference(item);
    });

    // Upscale dropdown button: disables instantly on click with feedback, then invokes upscale
    const ctxUpscaleEl = document.getElementById('ctx-upscale');
    const ctxUpscaleTextEl = document.getElementById('ctx-upscale-text');
    if (ctxUpscaleEl) {
      ctxUpscaleEl.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!_activeContextItem) return;
        const target = _activeContextItem;
        if (target._isUpscaling || (state.activeUpscales && state.activeUpscales.has(target.id)) || target.upscaled_url) {
          return;
        }

        // Disable immediately on click
        ctxUpscaleEl.disabled = true;
        ctxUpscaleEl.classList.add('disabled', 'loading');
        ctxUpscaleEl.style.opacity = '0.45';
        ctxUpscaleEl.style.pointerEvents = 'none';
        if (ctxUpscaleTextEl) ctxUpscaleTextEl.textContent = 'Upscaling to 1080p...';

        setTimeout(() => {
          const menu = document.getElementById('card-context-menu');
          if (menu) menu.classList.add('hidden');
        }, 220);

        await triggerVideoUpscale(target);
      });
    }

    act('ctx-download', (item) => {
      downloadMediaAsset(item, false);
    });

    act('ctx-download-upscaled', (item) => {
      downloadMediaAsset(item, true);
    });

    act('ctx-trash', async (item) => {
      const ok = await deleteAsset(item.id, { item, jobId: item.jobId, url: item.url });
      if (ok) showToast('Deleted', 'info');
    });
  }

  function openLightboxModal(item) {
    if (!els.lightboxModal || !els.lightboxTarget) return;
    els.lightboxTarget.innerHTML = '';
    if (item.type === 'video') {
      const v = document.createElement('video');
      v.src = item.url;
      v.controls = true;
      v.autoplay = true;
      v.playsInline = true;
      v.loop = true;
      els.lightboxTarget.appendChild(v);
    } else {
      const img = document.createElement('img');
      img.src = item.url;
      img.alt = item.prompt || 'Generated media';
      els.lightboxTarget.appendChild(img);
    }
    els.lightboxModal.classList.remove('hidden');
  }

  // Global exports for inter-module communication (Whisk laboratory, project management)
  window.state = state;
  window.loadAssets = loadAssets;
  window.updateCredits = updateHeaderCredits;
  window.updateHeaderCredits = updateHeaderCredits;
  window.showToast = showToast;
  window.toUserFacingGenerationError = toUserFacingGenerationError;
  window.isSystemGenerationError = isSystemGenerationError;
  window.withSystemErrorRetry = withSystemErrorRetry;
  window.openRefPickerModal = openRefPickerModal;
  window.openMediaViewerModal = openMediaViewerModal;
  window.closeMediaViewerModal = closeMediaViewerModal;

  // Start app
  init();
})();
