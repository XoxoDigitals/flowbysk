// Flow Browser App Shell Controller

/** Active client API base � v7 traditional login only. */
(function () {
let CLIENT_API = '/api/v11/client';

function normalizeClientApiVersion(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'v11') return 'v11';
  return 'v11';
}

const _nativeFetch = window.fetch.bind(window);
window.fetch = async function (input, init) {
  const urlStr = typeof input === 'string' ? input : (input && input.url ? input.url : String(input || ''));
  if (/\/api\/v\d+\/client\//i.test(urlStr)) {
    init = init ? { ...init } : {};
    const headers = new Headers(init.headers || {});
    try {
      if (window.electronAPI && typeof window.electronAPI.getDeviceId === 'function') {
        const att = await window.electronAPI.getDeviceId();
        if (att && typeof att === 'object') {
          if (att.client) headers.set('X-Flow-Client', String(att.client));
          if (att.deviceId) headers.set('X-Flow-Device-Id', String(att.deviceId));
          if (att.binHash) headers.set('X-Flow-Bin-Hash', String(att.binHash));
          if (att.ts != null) headers.set('X-Flow-Ts', String(att.ts));
          if (att.nonce) headers.set('X-Flow-Nonce', String(att.nonce));
          if (att.signature) headers.set('X-Flow-Signature', String(att.signature));
        }
      }
    } catch (e) {}
    const hObj = {};
    headers.forEach((v, k) => { hObj[k] = v; });
    init.headers = hObj;
  }
  return _nativeFetch(input, init);
};

async function resolveClientApiBase(serverUrl, force = false) {
  const base = String(serverUrl || '').replace(/\/$/, '') || 'https://flowcreatorai.site';
  try {
    const res = await _nativeFetch(`${base}/api/public/branding`, { cache: 'no-store' });
    const data = await res.json();
    if (data && data.serverTime) {
      const st = typeof data.serverTime === 'number' ? data.serverTime : Date.parse(data.serverTime);
      if (Number.isFinite(st) && st > 0) {
        window.__flowServerTimeOffset = st - Date.now();
        try { window.electronAPI?.credSetServerTime?.(st); } catch (e) {}
      }
    }
    const ver = normalizeClientApiVersion(
      data?.settings?.clientApiVersion ?? data?.clientApiVersion
    );
    CLIENT_API = `/api/${ver}/client`;
    console.log('[ClientAPI] active:', CLIENT_API);
    return CLIENT_API;
  } catch (err) {
    if (!force) console.warn('[ClientAPI] branding failed, keeping', CLIENT_API, err?.message || err);
    return CLIENT_API;
  }
}

/**
 * If response is FORCE_UPDATE, refresh branding and return true when base changed
 * so the caller can retry once on the new path.
 */
async function maybeSwitchClientApiOnForceUpdate(serverUrl, data) {
  if (!data || data.code !== 'FORCE_UPDATE') return false;
  const prev = CLIENT_API;
  await resolveClientApiBase(serverUrl, true);
  return CLIENT_API !== prev;
}

/** Strip Google secrets before anything is persisted locally. */
function sanitizeServerForStorage(server) {
  if (!server || typeof server !== 'object') return server || null;
  const out = { ...server };
  delete out.password;
  delete out.totpSecret;
  delete out.totp;
  delete out.secret;
  return out;
}

/** Production: restore session when token is valid. */
const DEBUG_ALWAYS_ASK_LOGIN = false;
/** Production: autofill + auto-click Next / 2FA. */
const DEBUG_SKIP_GOOGLE_NEXT = false;
/** Production: auth overlay/cover enabled. */
const DEBUG_DISABLE_AUTH_OVERLAY = false;


/** Extensible AI Platforms Suite catalog — add or enable more tools here anytime. */
const SUITE_TOOLS_CATALOG = [
  {
    id: 'google-flow',
    code: 'GOOGLE FLOW / 01',
    name: 'Google Flow',
    eyebrow: '— SHARED ACCESS / GOOGLE FLOW',
    heroTitle: 'Create without limits.',
    heroDesc: 'From the first prompt to the finished cinema scene, Google Flow is a flexible workspace for Veo 3.1 video, Nano Banana imagery, and bulk automation.',
    category: 'Creative AI / Workflow',
    description: 'Google Next-Gen Creative AI & Generative Video/Image Workflow Suite',
    domain: '',
    url: 'https://flow.google.com/',
    ready: true,
    usesGoogleAccount: true,
    iconSvg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81z" fill="#38bdf8"/></svg>'
  },
  {
    id: 'google-gemini',
    code: 'GOOGLE GEMINI / 02',
    name: 'Google Gemini',
    eyebrow: '— SHARED ACCESS / GOOGLE GEMINI',
    heroTitle: 'Supercharge your thinking.',
    heroDesc: 'Powered by your shared Google Ultra account — access Gemini Advanced Pro for deep reasoning, coding, Canvas, and multimodal research.',
    category: 'Conversational AI / Google Ultra',
    description: 'Google Gemini Advanced Ultra — Deep Reasoning, Coding, Canvas & Multimodal AI',
    domain: '',
    url: 'https://gemini.google.com/app',
    ready: true,
    usesGoogleAccount: true,
    iconSvg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 2C12 7.52 16.48 12 22 12C16.48 12 12 16.48 12 22C12 16.48 7.52 12 2 12C7.52 12 12 7.52 12 2Z" fill="url(#geminiGrad)"/><defs><linearGradient id="geminiGrad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse"><stop stop-color="#60a5fa"/><stop offset="0.5" stop-color="#a78bfa"/><stop offset="1" stop-color="#34d399"/></linearGradient></defs></svg>'
  },
  {
    id: 'zextts-studio',
    code: 'TTS STUDIO / 03',
    name: 'TTS STUDIO',
    eyebrow: '— BUILT-IN AI STUDIO / TTS STUDIO',
    heroTitle: 'Human-realistic neural voices.',
    heroDesc: 'Multi-language Neural TTS & Multi-Speaker Podcast Studio with custom prosody, pitch, rate, and instant MP3 export.',
    category: 'AI Voice & Podcast Studio',
    description: 'Neural Text-to-Speech & Multi-Speaker Podcast Audio Generator',
    domain: '',
    url: 'https://app.flowbrowser.localhost/zextts/index.html',
    ready: true,
    usesGoogleAccount: false,
    iconSvg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>'
  }
];

class FlowBrowserApp {
  constructor() {
    this.config = null;
    this.currentUser = null;
    this.currentServers = [];
    this.activeServer = null;
    this.settings = null;
    this.zoomFactor = 1.0;
    this.downloads = [];
    this.selectedToolId = 'google-flow';
    this.runningToolId = null;
    this._activeToolTargetUrl = 'https://flow.google.com/';

    this.initElements();
    this.initEvents();
    this.bootstrap();
  }

  initElements() {
    // Window controls
    this.btnMin = document.getElementById('btn-win-min');
    this.btnMax = document.getElementById('btn-win-max');
    this.btnClose = document.getElementById('btn-win-close');

    // Toolbar items
    this.serverSelect = document.getElementById('server-select');
    this.accountNameLabel = document.getElementById('account-name-label');
    this.btnRequestServerChange = document.getElementById('btn-request-server-change');
    this.creditsVal = document.getElementById('user-credits-val');
    this.expiryVal = document.getElementById('user-expiry-val');
    this.btnZoomOut = document.getElementById('btn-zoom-out');
    this.btnZoomIn = document.getElementById('btn-zoom-in');
    this.zoomLevelText = document.getElementById('zoom-level-text');
    this.btnReload = document.getElementById('btn-reload-webview');
    this.btnClearCookies = document.getElementById('btn-clear-cookies');
    this.btnLogout = document.getElementById('btn-client-logout');

    // Webview & Overlays
    this.webview = document.getElementById('flow-webview');
    this.debugUrlInput = document.getElementById('debug-url-input');
    this.btnUrlGo = null;
    this.btnUrlBack = null;
    this.btnDebugCopyUrl = null;
    this.loadingOverlay = document.getElementById('full-loading-overlay');
    this.overlayTitle = document.getElementById('overlay-status-title');
    this.overlaySub = document.getElementById('overlay-status-sub');
    this.googleAuthBanner = document.getElementById('google-auth-banner');
    this.googleAuthBannerText = document.getElementById('google-auth-banner-text');
    this._captchaActive = false;
    this._totpFilling = false;
    this.loginScreen = document.getElementById('login-screen');
    this.loginForm = document.getElementById('client-login-form');
    this.loginAlert = document.getElementById('login-alert');
    this.inputUsername = document.getElementById('client-username');
    this.inputPassword = document.getElementById('client-password');
    this.btnLoginSubmit = document.getElementById('btn-login-submit');

    // Server Config (hidden from users — URL comes from AppConfig)
    this.btnToggleConfig = document.getElementById('btn-toggle-server-config');
    this.serverConfigBox = document.getElementById('server-config-box');
    this.inputServerUrl = document.getElementById('input-server-url');
    this.btnSaveServerUrl = document.getElementById('btn-save-server-url');

    // Downloads Drawer
    this.btnToggleDownloads = document.getElementById('btn-toggle-downloads');
    this.downloadBadge = document.getElementById('download-badge');
    this.downloadDrawer = document.getElementById('download-drawer');
    this.btnCloseDownloads = document.getElementById('btn-close-downloads');
    this.downloadsList = document.getElementById('downloads-list');
    this.btnAndroidSettings = document.getElementById('btn-android-settings');
    this.androidSettingsSheet = document.getElementById('android-settings-sheet');
    this.androidSettingsMenu = this.androidSettingsSheet;
    this.androidSettingsAccountLabel = document.getElementById('android-settings-account-label');
    this.btnAndroidSettingsClose = document.getElementById('btn-android-settings-close');
    this.androidSettingsBackdrop = document.getElementById('android-settings-backdrop');

    // Extension / Veo drawers removed from user UI
    this.btnToggleExtension = document.getElementById('btn-toggle-extension');
    this.extensionDrawer = document.getElementById('extension-drawer');
    this.btnCloseExtension = document.getElementById('btn-close-extension');
    this.extensionWebview = document.getElementById('extension-webview');
    this.btnToggleVeoAuto = document.getElementById('btn-toggle-veo-auto');
    this.btnOpenWorkspaceHub = document.getElementById('btn-open-workspace-hub');
    this.workspaceHubScreen = document.getElementById('workspace-hub-screen');
    this.hubToolsGrid = document.getElementById('hub-tools-grid');
    this.hubBcToolName = document.getElementById('hub-bc-tool-name');
    this.hubHeroEyebrow = document.getElementById('hub-hero-eyebrow');
    this.hubHeroTitle = document.getElementById('hub-hero-title');
    this.hubHeroDesc = document.getElementById('hub-hero-desc');
    this.hubHeroPrimaryBtn = document.getElementById('hub-hero-primary-btn');
    this.hubHeroStopBtn = document.getElementById('hub-hero-stop-btn');
    this.hubHeroGuideBtn = document.getElementById('hub-hero-guide-btn');
    this.hubHeroIconBox = document.getElementById('hub-hero-icon-box');
    this.hubHeroCode = document.getElementById('hub-hero-code');
    this.hubMetaDest = document.getElementById('hub-meta-dest');
    this.hubMetaMembership = document.getElementById('hub-meta-membership');
    this.hubSuiteCountLabel = document.getElementById('hub-suite-count-label');
    this.veoAutoDrawer = document.getElementById('veo-auto-drawer');
    this.btnCloseVeoAuto = document.getElementById('btn-close-veo-auto');
    this.veoAutoWebview = document.getElementById('veo-auto-webview');
  }

  initEvents() {
    // Window control buttons
    this.btnMin.addEventListener('click', () => window.electronAPI.minimizeWindow());
    this.btnMax.addEventListener('click', () => window.electronAPI.maximizeWindow());
    this.btnClose.addEventListener('click', () => window.electronAPI.closeWindow());

    // Dismiss loading overlay on click or Escape so it can never lock the browser
    if (this.loadingOverlay) {
      this.loadingOverlay.addEventListener('click', () => this.hideLoadingOverlay());
    }
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hideLoadingOverlay();
    });

    // Login Events
    this.loginForm.addEventListener('submit', (e) => this.handleLogin(e));
    if (this.btnToggleConfig && this.serverConfigBox) {
      this.btnToggleConfig.addEventListener('click', () => {
        this.serverConfigBox.classList.toggle('hidden');
      });
    }
    if (this.btnSaveServerUrl && this.inputServerUrl) {
      this.btnSaveServerUrl.addEventListener('click', async () => {
        const newUrl = this.inputServerUrl.value.trim();
        if (newUrl) {
          await window.electronAPI.saveServerUrl(newUrl);
          this.config.serverUrl = newUrl;
          this.serverConfigBox?.classList.add('hidden');
          this.notify('Server URL saved: ' + newUrl);
        }
      });
    }

    // Toolbar events
    this.serverSelect.addEventListener('change', () => this.handleServerSwitch());
    if (this.btnRequestServerChange) {
      this.btnRequestServerChange.addEventListener('click', () => this.requestBalancedServerAndLaunch(true));
    }
    this.btnReload.addEventListener('click', () => this.reloadWebview());
    if (this.btnClearCookies) {
      this.btnClearCookies.addEventListener('click', () => this.handleClearCookies());
    }
    this.btnLogout.addEventListener('click', () => this.handleLogout());

    // Zoom events
    this.btnZoomIn.addEventListener('click', () => this.adjustZoom(0.1));
    this.btnZoomOut.addEventListener('click', () => this.adjustZoom(-0.1));
    this.zoomLevelText.addEventListener('click', () => this.resetZoom());

    // Downloads events
    this.btnToggleDownloads.addEventListener('click', () => {
      this.downloadDrawer.classList.toggle('hidden');
      if (!this.downloadDrawer.classList.contains('hidden')) {
        window.electronAPI.setShellMode?.('full');
      }
      this.syncShellModeFromUi();
    });
    this.btnCloseDownloads.addEventListener('click', () => {
      this.downloadDrawer.classList.add('hidden');
      this.syncShellModeFromUi();
    });

    this.initAndroidSettingsMenu();
    this.initWorkspaceHub();

    // Extension events
    if (this.btnToggleExtension) {
      this.btnToggleExtension.addEventListener('click', () => {
        this.extensionDrawer.classList.toggle('hidden');
        if (!this.extensionDrawer.classList.contains('hidden')) {
          const base =
            typeof location !== 'undefined' && location.origin && location.origin !== 'null'
              ? location.origin
              : 'https://app.flowbrowser.localhost';
          const url = base + '/extensions/veo-shio-auto-login/popup.html';
          if (this.extensionWebview.src !== url) this.extensionWebview.src = url;
          window.electronAPI.setShellMode?.('full');
        } else {
          this.syncShellModeFromUi();
        }
      });
    }
    if (this.btnCloseExtension) {
      this.btnCloseExtension.addEventListener('click', () => {
        this.extensionDrawer.classList.add('hidden');
        this.syncShellModeFromUi();
      });
    }

        // Veo Auto events (native side-by-side Bulk Mode panel)
    if (this.btnToggleVeoAuto) {
      this.btnToggleVeoAuto.addEventListener('click', () => {
        window.electronAPI?.toggleBulkPanel?.();
      });
    }
    if (this.btnCloseVeoAuto) {
      this.btnCloseVeoAuto.addEventListener('click', () => {
        this.veoAutoDrawer.classList.add('hidden');
        this.syncShellModeFromUi();
      });
    }

    // Tapping the Sign In badge opens the login overlay
    if (this.expiryVal && this.expiryVal.parentElement) {
      this.expiryVal.parentElement.style.cursor = 'pointer';
      this.expiryVal.parentElement.addEventListener('click', () => {
        if (!this.currentUser) this.showLoginScreen();
      });
    }



    // Webview lifecycle & IPC communication
    this.webview.addEventListener('new-window', (e) => {
      console.log('[Webview] new-window requested:', e.url);
      if (e.url && e.url !== 'about:blank' && !e.url.startsWith('javascript:') && e.url.startsWith('http')) {
        this.webview.loadURL(e.url);
      }
    });

    this.webview.addEventListener('console-message', (e) => {
      console.log('[Webview Console]', e.message);
    });

    this.webview.addEventListener('ipc-message', (event) => {
      if (event.channel === 'credit:deduct') {
        this.handleCreditDeduction(event.args[0]);
      } else if (event.channel === 'credit:refund') {
        this.handleCreditRefund(event.args[0]);
      } else if (event.channel === 'request-credentials') {
        this.sendCredentialsToWebview();
        this.syncCreditsToWebview();
        this.syncSavedProjectsToWebview();
      } else if (event.channel === 'request-credits') {
        this.syncCreditsToWebview();
      } else if (event.channel === 'saved-projects:load') {
        this.syncSavedProjectsToWebview();
      } else if (event.channel === 'saved-projects:save') {
        this.handleSaveProjectsFromWebview(event.args[0]);
      } else if (event.channel === 'request-otp') {
        const arg = event.args && event.args[0];
        if (arg && arg.forceRefresh) {
          this._credUsedStages?.delete('otp');
          this._otpPushAt = 0;
          this._lastOtpCode = '';
          this._lastOtpFetchedAt = 0;
          this.pushTotpFromBackend(true);
          return;
        }
        this.fetchAndSendOtp();
      } else if (event.channel === 'flow:totp-retry-needed') {
        console.warn('[AppShell] TOTP retry requested by inject — fetching fresh code');
        this._credUsedStages?.delete('otp');
        this._otpPushAt = 0;
        this._lastOtpCode = '';
        this._lastOtpFetchedAt = 0;
        setTimeout(() => this.pushTotpFromBackend(true), 800);
      } else if (event.channel === 'auth:need-otp') {
        this.pushTotpFromBackend();
      } else if (event.channel === 'auth:stuck-pwd') {
        if (document.documentElement.classList.contains('platform-android')) {
          console.warn('[AppShell] stuck-pwd on Android — skip cache reload');
          return;
        }
        // Google SPA stuck: URL is /challenge/pwd but email UI still showing
        console.warn('[AppShell] Stuck password UI — reloadIgnoringCache');
        try {
          if (typeof this.webview.reloadIgnoringCache === 'function') this.webview.reloadIgnoringCache();
          else this.webview.reload();
        } catch (err) {
          console.warn('[AppShell] Stuck reload failed:', err.message);
        }
      } else if (event.channel === 'auth:captcha') {
        this.onCaptchaState(event.args && event.args[0]);
      } else if (event.channel === 'auth:auto-login') {
        this.onAutoLoginState(event.args && event.args[0]);
      }
    });

    this.webview.addEventListener('did-start-loading', () => {
      let u = this.webview.src;
      try { if (this.webview.getURL) u = this.webview.getURL(); } catch (e) {}
      console.log('[Webview] did-start-loading, URL:', u);
      this.updateDebugUrl(u);
    });

      this.webview.addEventListener('did-finish-load', () => {
      let u = this.webview.src;
      try { if (this.webview.getURL) u = this.webview.getURL(); } catch (e) {}
      console.log('[Webview] did-finish-load, URL:', u);
      this.updateDebugUrl(u);
      // Keep shell overlay while Google auto-login / captcha chrome is active
      const onGoogle = /accounts\.google\.com|accounts\.youtube\.com/i.test(String(u || ''));
      if (u && u !== 'about:blank' && !onGoogle && !this._captchaActive) {
        this.hideLoadingOverlay();
      }
      this.sendCredentialsToWebview();
      this.tryGoogleAutoFill(u);
      this.maybeStartFreshLoginAfterFlow(u);
    });

    this.webview.addEventListener('did-navigate', (e) => {
      this.updateDebugUrl(e.url);
      this.tryGoogleAutoFill(e.url);
      this.maybeStartFreshLoginAfterFlow(e.url);
      this.maybeFinishGoogleCheckCookie(e.url);
      this.maybeReportGoogleSuccess(e.url);
    });

    this.webview.addEventListener('did-navigate-in-page', (e) => {
      this.updateDebugUrl(e.url);
      this.tryGoogleAutoFill(e.url);
      this.maybeFinishGoogleCheckCookie(e.url);
      this.maybeReportGoogleSuccess(e.url);
    });

    this.webview.addEventListener('page-title-updated', (e) => {
      let u = this.webview.src;
      try { if (this.webview.getURL) u = this.webview.getURL(); } catch (err) {}
      this.updateDebugUrl(u);
    });

    this.webview.addEventListener('did-fail-load', (e) => {
      console.error('[Webview] did-fail-load:', e.errorCode, e.errorDescription, e.validatedURL);
      // -3 aborted / ConnectionAborted — ignore (URL switches, shell mode)
      const desc = String(e.errorDescription || '');
      if (e.errorCode === -3 || /abort|cancel/i.test(desc)) return;
      this.updateDebugUrl(e.validatedURL || this.webview.src || '');
      this.hideLoadingOverlay();
      this.showWebviewError(
        e.errorDescription || 'Page failed to load',
        e.validatedURL || this.webview.src || ''
      );
    });

    this.webview.addEventListener('dom-ready', () => {
      let u = this.webview.src;
      try { if (this.webview.getURL) u = this.webview.getURL(); } catch (e) {}
      console.log('[Webview] dom-ready, URL:', u);
      this.updateDebugUrl(u);
      this.onWebviewDomReady();
      this.tryGoogleAutoFill(u);
    });

    // Electron Download Listeners
    window.electronAPI.onDownloadStarted((data) => this.onDownloadStarted(data));
    window.electronAPI.onDownloadProgress((data) => this.onDownloadProgress(data));
    window.electronAPI.onDownloadCompleted((data) => this.onDownloadCompleted(data));
    window.electronAPI.onDownloadFailed((data) => this.onDownloadFailed(data));
  }

  async bootstrap() {
    try {
      window.electronAPI.setShellMode?.('full');

      // Ensure webview preload uses an absolute path (relative paths break in packaged exe)
      try {
        const preloadPath = await window.electronAPI.getWebviewPreloadPath();
        if (preloadPath && this.webview) {
          this.webview.setAttribute('preload', preloadPath);
          console.log('[Bootstrap] Webview preload set to:', preloadPath);
        }
      } catch (err) {
        console.warn('[Bootstrap] Could not set absolute preload path:', err.message);
      }

      this.config = await window.electronAPI.getConfig();
      if (!this.config || typeof this.config !== 'object') {
        this.config = { serverUrl: 'https://flowcreatorai.site' };
      }
      if (!this.config.serverUrl) {
        this.config.serverUrl = 'https://flowcreatorai.site';
      }
      if (typeof this.startDebugUrlPolling === 'function' && this.debugUrlInput) {
        this.startDebugUrlPolling();
      }
      if (this.inputServerUrl && this.config?.serverUrl) {
        this.inputServerUrl.value = this.config.serverUrl;
      }

      // Pick v2 or v3 before any client API call
      await resolveClientApiBase(this.config.serverUrl);

      if (!this.inputUsername.value && this.config?.user?.username) {
        this.inputUsername.value = this.config.user.username;
      } else if (!this.inputUsername.value) {
        this.inputUsername.value = 'user1';
      }

      // Prefer saved session (v2/v3 verify) — only show login if token missing / rejected
      this.hideLoadingOverlay();
      if (!DEBUG_ALWAYS_ASK_LOGIN && this.config.authToken) {
        const ok = await this.verifyExistingSession();
        if (ok) return;
      }
      this.showLoginScreen();
    } catch (err) {
      console.error('[Bootstrap Error]', err);
      this.hideLoadingOverlay();
      this.showLoginScreen();
    }
  }

  async verifyExistingSession() {
    try {
      const res = await fetch(`${this.config.serverUrl}${CLIENT_API}/verify-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.authToken}`
        }
      });
      const data = await res.json();
      console.log('[VerifySession] result:', data && data.success, data?.user?.username);

      if (data && data.success) {
        if (data.forceClearGoogle) {
          try {
            await fetch(`${this.config.serverUrl}${CLIENT_API}/ack-google-wipe`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.config.authToken}`
              }
            });
          } catch (e) {}
          await this.forceLogout('Session revoked by administrator. Please sign in again.');
          return false;
        }
        const prevAssignment = this.config?.activeServer || this.activeServer;
        this.currentUser = data.user;
        this.currentServers = data.servers;
        this.settings = data.settings;
        this.activeServer = sanitizeServerForStorage(data.activeServer);
        this.updateToolbarUserInfo();
        this.populateServerSelect(data.servers);
        this.hideLoginScreen();
        this.startAssignmentWatch();

        const wiped = await this.ensureFreshGoogleSessionOnLogin(
          prevAssignment,
          data.servers,
          this.activeServer
        );
        let activeSrv = this.activeServer;
        if (!activeSrv && data.servers.length > 0) {
          activeSrv = data.servers[0];
        }

        if (activeSrv) {
          this.activeServer = sanitizeServerForStorage({
            ...activeSrv,
            imageOnly: this.isImageOnlyServer(activeSrv)
          });
          if (this.serverSelect && !this.isImageOnlyServer(activeSrv)) {
            this.serverSelect.value = activeSrv.id;
          }
          this.setAccountName(this.formatServerDisplayName(activeSrv, data.servers));
        }
        this._pendingFreshLogin = !!wiped;
        this.showWorkspaceHub();
        return true;
      } else {
        const code = data && data.code;
        if (code === 'FORCE_UPDATE') {
          const switched = await maybeSwitchClientApiOnForceUpdate(this.config.serverUrl, data);
          if (switched) return this.verifyExistingSession();
          await this.forceLogout(data.error || 'Please download the latest Flow Browser.');
          return false;
        }
        if (code === 'SESSION_REPLACED' || code === 'NO_CREDITS' || code === 'BANNED' || code === 'PLAN_EXPIRED' || code === 'TAMPERED_CLIENT' || code === 'SUSPICIOUS_CLIENT') {
          await this.forceLogout(data.error || 'Please sign in again.');
          return false;
        }
        return false;
      }
    } catch (err) {
      console.error('Session verify error:', err);
      return false;
    }
  }

  async handleLogin(e) {
    e.preventDefault();
    this.loginAlert.classList.add('hidden');
    this.btnLoginSubmit.disabled = true;
    this.btnLoginSubmit.textContent = 'Authenticating...';

    const username = this.inputUsername.value.trim();
    const password = this.inputPassword.value;
    const serverUrl = (this.config && this.config.serverUrl) || 'https://flowcreatorai.site';
    if (!this.config) this.config = { serverUrl };
    else if (!this.config.serverUrl) this.config.serverUrl = serverUrl;

    try {
      await resolveClientApiBase(serverUrl);
      if (!window.FlowCredChannel) throw new Error('Secure channel module missing');
      const clientPublicKey = await window.FlowCredChannel.generateClientPublicKey();
      let deviceId = null;
      let flowClient = 'windows-exe/8.0.14';
      let binHash = '';
      let attestTs = 0;
      let attestNonce = '';
      let signature = '';
      try {
        if (window.electronAPI && typeof window.electronAPI.getDeviceId === 'function') {
          const dev = await window.electronAPI.getDeviceId();
          if (dev && dev.deviceId) deviceId = String(dev.deviceId);
          if (dev && dev.client) flowClient = String(dev.client);
          if (dev && dev.binHash) binHash = String(dev.binHash);
          if (dev && dev.ts != null) attestTs = Number(dev.ts) || 0;
          if (dev && dev.nonce) attestNonce = String(dev.nonce);
          if (dev && dev.signature) signature = String(dev.signature);
        }
      } catch (err) {
        console.warn('[AppShell] getDeviceId failed', err); window.__deviceErr = err && err.message ? String(err.message) : String(err);
      }
      if (!deviceId) throw new Error('Device ID unavailable' + (window.__deviceErr ? ' (' + window.__deviceErr + ')' : '') + '. Please update the app.');
      const loginBody = { username, password, clientPublicKey, deviceId, binHash, attestTs, attestNonce, signature };
      const loginHeaders = {
        'Content-Type': 'application/json',
        'X-Flow-Client': flowClient,
        'X-Flow-Device-Id': deviceId,
        'X-Flow-Bin-Hash': binHash,
        'X-Flow-Ts': String(attestTs),
        'X-Flow-Nonce': attestNonce,
        'X-Flow-Signature': signature
      };
      const res = await fetch(`${serverUrl}${CLIENT_API}/login`, {
        method: 'POST',
        headers: loginHeaders,
        body: JSON.stringify(loginBody)
      });
      let data = await res.json();

      if ((!data || !data.success) && data && data.code === 'FORCE_UPDATE') {
        const switched = await maybeSwitchClientApiOnForceUpdate(serverUrl, data);
        if (switched) {
          const retry = await fetch(`${serverUrl}${CLIENT_API}/login`, {
            method: 'POST',
            headers: loginHeaders,
            body: JSON.stringify(loginBody)
          });
          data = await retry.json();
        }
      }

      if (data && data.success) {
        if (!data.channel?.channelId || !data.channel?.serverPublicKey) {
          throw new Error('Server did not open a secure credential channel. Update the API.');
        }
        const serverTimeMs = typeof data.serverTime === 'number' ? data.serverTime : (data.serverTime ? Date.parse(data.serverTime) : undefined);
        await window.FlowCredChannel.establish(data.channel.channelId, data.channel.serverPublicKey, serverTimeMs);
        this._credAttemptId = null;

        // Snapshot BEFORE overwriting � used to detect removed Google assignments
        const prevAssignment = this.config?.activeServer || this.activeServer;

        this.currentUser = data.user;
        this.currentServers = data.servers;
        this.settings = data.settings;
        this.activeServer = sanitizeServerForStorage(data.activeServer);
        this._flowLoginPassword = password; // memory only � seals session.bin (Phase 4)

        // Save session � never persist Google password
        await window.electronAPI.saveSession({
          token: data.token,
          user: data.user,
          activeServer: sanitizeServerForStorage(data.activeServer),
          vaultPassword: password
        });
        this.config.authToken = data.token;
        this.config.activeServer = sanitizeServerForStorage(data.activeServer);
        this.config.user = data.user;

        this.updateToolbarUserInfo();
        this.populateServerSelect(data.servers);
        this.hideLoginScreen();
        this.startAssignmentWatch();

        if ((Number(data.user.credits) || 0) <= 0) {
          this.showLoginScreen();
          this.showLoginError('You have no credits left. Please renew your credits to continue.');
          return;
        }

        // Wipe Google cookies when old shared account is gone / reassigned
        const mustWipe = await this.ensureFreshGoogleSessionOnLogin(
          prevAssignment,
          data.servers,
          data.activeServer
        );
        this._pendingFreshLogin = !!mustWipe;
        if (!this.activeServer?.id && Array.isArray(data.servers) && data.servers.length > 0) {
          this.activeServer = sanitizeServerForStorage({
            ...data.servers[0],
            imageOnly: this.isImageOnlyServer(data.servers[0])
          });
          if (this.serverSelect && !this.isImageOnlyServer(this.activeServer)) {
            this.serverSelect.value = this.activeServer.id;
          }
          this.setAccountName(this.formatServerDisplayName(this.activeServer, data.servers));
        }
        this.showWorkspaceHub();
      } else {
        this.showLoginError((data && data.error) || 'Invalid username or password');
        if (data && data.code === 'FORCE_UPDATE') {
          this.showLoginError(data.error || 'Please download the latest Flow Browser.');
        }
      }
    } catch (err) {
      console.error('Login error:', err);
      this.showLoginError('Could not connect to backend server: ' + err.message);
    } finally {
      this.btnLoginSubmit.disabled = false;
      this.btnLoginSubmit.textContent = 'Launch Flow Workspace';
    }
  }

  showLoginError(msg) {
    this.loginAlert.textContent = msg;
    this.loginAlert.classList.remove('hidden');
  }

  hideLoginScreen() {
    this.loginScreen.classList.add('hidden');
    this.loginScreen.style.display = 'none';
    document.documentElement.classList.remove('login-active');
    document.body?.classList.remove('login-active');
    this.syncShellModeFromUi();
  }

  showLoginScreen() {
    if (this.workspaceHubScreen) this.workspaceHubScreen.classList.add('hidden');
    this.runningToolId = null;
    this.loginScreen.classList.remove('hidden');
    this.loginScreen.style.display = '';
    document.documentElement.classList.add('login-active');
    document.body?.classList.add('login-active');
    this.postAuthOverlay({ show: false, done: true });
    window.electronAPI.setShellMode?.('full');
  }

  syncShellModeFromUi() {
    const loginVisible = this.loginScreen && !this.loginScreen.classList.contains('hidden') &&
      this.loginScreen.style.display !== 'none';
    const settingsOpen = this.androidSettingsSheet && !this.androidSettingsSheet.classList.contains('hidden');
    const confirmOpen = (() => {
      const m = document.getElementById('app-confirm-modal');
      return !!(m && !m.classList.contains('hidden'));
    })();
    const hubVisible = !!(this.workspaceHubScreen && !this.workspaceHubScreen.classList.contains('hidden'));
    const drawerOpen = [this.downloadDrawer, this.extensionDrawer, this.veoAutoDrawer]
      .some((d) => d && !d.classList.contains('hidden'));
    // Do not treat loading overlay as full — collapsing Flow aborts navigations
    window.electronAPI.setShellMode?.(
      loginVisible || hubVisible || drawerOpen || settingsOpen || confirmOpen ? 'full' : 'chrome'
    );
  }

  async forceLogout(message) {
    try { await this.reportGoogleFinish('cancelled'); } catch (e) {}
    this.resetGoogleLockState();
    this.stopAssignmentWatch();
    this.postAuthOverlay?.({ show: false, done: true });
    this._captchaActive = false;
    try {
      await window.electronAPI.clearPartitionSession();
    } catch (e) {}
    try {
      await window.electronAPI.clearSession();
    } catch (e) {}
    this.currentUser = null;
    this.activeServer = null;
    this.config = this.config || {};
    this.config.authToken = null;
    this.config.user = null;
    this.config.activeServer = null;
    try {
      this.webview.src = 'about:blank';
    } catch (e) {}
    this.showLoginScreen();
    if (message) this.showLoginError(message);
  }

  async handleLogout() {
    await this.forceLogout('');
  }

  /**
   * Wipe Google / Flow cookies and browsing data for this profile, then
   * re-launch a fresh Google sign-in for the current assignment.
   */
  async handleClearCookies() {
    const ok = await this.showConfirmDialog({
      title: 'Clear cookies & accounts',
      body: 'Clear all Google cookies and signed-in accounts in this app?\n\nThis wipes the Flow browser profile (cookies, cache, local data) and starts a fresh Google login.',
      confirmLabel: 'Clear everything',
      cancelLabel: 'Cancel'
    });
    if (!ok) return;

    this.showLoadingOverlay('Clearing cookies…', 'Wiping Google accounts and browsing data', 12000);
    this.hideGoogleAuthBanner();
    // Always drop sticky auth cover first — wipe must not leave a looping overlay
    this.postAuthOverlay({ show: false, done: true });
    this._captchaActive = false;
    this._pendingFreshLogin = false;
    try {
      await window.electronAPI.clearPartitionSession();
      this._lastAutoFillKey = null;

      const loggedIn = !!(this.currentUser && this.config?.authToken);
      if (!loggedIn) {
        // Not signed into Flow Creator — wipe only; do not start Google login / overlay
        this.notify('Cookies cleared');
        try {
          if (typeof this.webview.loadURL === 'function') this.webview.loadURL('about:blank');
          else this.webview.src = 'about:blank';
        } catch (e) {}
        this.showLoginScreen();
        this.hideLoadingOverlay();
        this.postAuthOverlay({ show: false, done: true });
        return;
      }

      this._pendingFreshLogin = true;
      this._pendingFreshLoginAt = Date.now();
      const lockLeftMs = this.googleLockRemainingMs();
      if (lockLeftMs > 0) {
        this.notify(this.googleLockMessage({ retryAfterSeconds: Math.ceil(lockLeftMs / 1000) }), true);
      } else {
        this.notify('Cookies cleared, signing in fresh...');
      }

      if (this.activeServer?.id) {
        await this.launchServerWorkspace(this.activeServer.id, true);
      } else {
        await this.requestBalancedServerAndLaunch(false);
        if (this.activeServer?.id) {
          await this.launchServerWorkspace(this.activeServer.id, true);
        } else {
          this.hideLoadingOverlay();
          this.notify('No Google account assigned — cookies cleared only', true);
          this.postAuthOverlay({ show: false, done: true });
          try {
            if (typeof this.webview.loadURL === 'function') this.webview.loadURL('about:blank');
            else this.webview.src = 'about:blank';
          } catch (e) {}
        }
      }
    } catch (err) {
      console.error('[AppShell] clear cookies failed', err);
      this.notify('Could not clear cookies: ' + (err.message || err), true);
      this.postAuthOverlay({ show: false, done: true });
      this.hideLoadingOverlay();
      this.syncShellModeFromUi();
    }
  }

  showConfirmDialog({ title, body, confirmLabel = 'OK', cancelLabel = 'Cancel' } = {}) {
    return new Promise((resolve) => {
      const modal = document.getElementById('app-confirm-modal');
      const titleEl = document.getElementById('app-confirm-title');
      const bodyEl = document.getElementById('app-confirm-body');
      const okBtn = document.getElementById('app-confirm-ok');
      const cancelBtn = document.getElementById('app-confirm-cancel');
      if (!modal || !okBtn || !cancelBtn) {
        resolve(false);
        return;
      }
      if (titleEl) titleEl.textContent = title || 'Confirm';
      if (bodyEl) bodyEl.textContent = body || '';
      okBtn.textContent = confirmLabel;
      cancelBtn.textContent = cancelLabel;
      modal.classList.remove('hidden');
      window.electronAPI.setShellMode?.('full');

      const finish = (value) => {
        modal.classList.add('hidden');
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        modal.removeEventListener('click', onBackdrop);
        this.syncShellModeFromUi();
        resolve(value);
      };
      const onOk = () => finish(true);
      const onCancel = () => finish(false);
      const onBackdrop = (e) => { if (e.target === modal) finish(false); };
      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      modal.addEventListener('click', onBackdrop);
    });
  }

  /** Previous shared Google account id from memory or saved config */
  getSavedAssignedAccountId() {
    const cur = this.activeServer;
    if (cur && typeof cur === 'object' && cur.id) return cur.id;
    const cfg = this.config?.activeServer;
    if (!cfg) return null;
    return typeof cfg === 'object' ? cfg.id : cfg;
  }

  getAssignmentEmail(assignment) {
    if (!assignment || typeof assignment !== 'object') return '';
    return String(assignment.email || '').trim().toLowerCase();
  }

  /**
   * At login: if previously saved Google account is gone from the server list,
   * or the assigned Google email changed, wipe cookies so old Google sessions
   * cannot stick around in the exe.
   */
  async ensureFreshGoogleSessionOnLogin(prevAssignment, servers, activeServer) {
    const list = Array.isArray(servers) ? servers : [];
    const prevId = prevAssignment && (typeof prevAssignment === 'object' ? prevAssignment.id : prevAssignment);
    const prevEmail = this.getAssignmentEmail(prevAssignment);
    const nextId = activeServer?.id || null;
    const nextEmail = this.getAssignmentEmail(activeServer);

    const prevIdMissing = !!(prevId && !list.some((s) => s.id === prevId));
    // Keep all valid Google accounts signed in simultaneously; only wipe if a server was deleted by admin.
    const mustWipe = prevIdMissing;
    if (!mustWipe) return false;

    console.warn('[AppShell] Wiping Google session on login', {
      prevIdMissing, reassigned, emailChanged, prevId, nextId
    });
    this.notify(
      prevIdMissing
        ? 'Old Google account removed from server — clearing browser…'
        : 'Refreshing Google session for your assigned account…',
      true
    );
    try {
      await window.electronAPI.clearPartitionSession();
    } catch (e) {}
    this._pendingFreshLogin = true;
    this._pendingFreshLoginAt = Date.now();
    this._freshLoginStarted = false;
    this._checkCookieBounced = false;
    this._allowFlowAfterCheckCookie = false;
    this._lastAutoFillKey = null;
    this.activeServer = activeServer || null;
    if (this.config) this.config.activeServer = this.activeServer;
    this.populateServerSelect(list);
    return true;
  }

  /**
   * If the saved/shared Google account was deleted, wipe Google cookies so the
   * exe does not keep using a removed account.
   * @returns {Promise<boolean>} true when a stale account was purged
   */
  async purgeStaleAssignedAccount(servers, activeServer) {
    const list = Array.isArray(servers) ? servers : [];
    const prevId = this.getSavedAssignedAccountId();
    const prevStillListed = prevId && list.some((s) => s.id === prevId);
    const activeOk = activeServer && list.some((s) => s.id === activeServer.id);

    if (prevId && !prevStillListed) {
      console.warn('[AppShell] Assigned Google account removed:', prevId);
      this.notify('Shared Google account was removed — switching…', true);
      try {
        await window.electronAPI.clearPartitionSession();
      } catch (e) {}
      this._pendingFreshLogin = true;
      this.activeServer = activeOk ? activeServer : null;
      if (this.config) this.config.activeServer = this.activeServer;
      try {
        await window.electronAPI.saveSession({
          token: this.config?.authToken,
          user: this.config?.user || this.currentUser,
          activeServer: sanitizeServerForStorage(this.activeServer)
        });
      } catch (e) {}
      this.populateServerSelect(list);
      return true;
    }
    return false;
  }

  startAssignmentWatch() {
    if (this._assignWatchTimer) return;
    this._assignWatchTimer = setInterval(() => {
      this.checkAssignedAccountStillExists().catch(() => {});
    }, 3000);
  }

  stopAssignmentWatch() {
    if (this._assignWatchTimer) {
      clearInterval(this._assignWatchTimer);
      this._assignWatchTimer = null;
    }
  }

  async checkAssignedAccountStillExists() {
    if (!this.config?.authToken || !this.config?.serverUrl) return;
    if (this._switchingServerInFlight) return;
    // Never wipe / force-logout while Google OAuth is mid-flight
    try {
      const live = this.webview?.getURL ? this.webview.getURL() : (this.webview?.src || '');
      if (/accounts\.google\.com|accounts\.youtube\.com/i.test(String(live || ''))) return;
    } catch (e) {}
    try {
      const res = await fetch(`${this.config.serverUrl}${CLIENT_API}/verify-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.authToken}`
        }
      });
      const data = await res.json().catch(() => ({}));
      if (!data || !data.success) {
        const code = data && data.code;
        if (code === 'FORCE_UPDATE') {
          const switched = await maybeSwitchClientApiOnForceUpdate(this.config.serverUrl, data);
          if (switched) return; // next poll uses v3
          await this.forceLogout((data && data.error) || 'Please download the latest Flow Browser.');
          return;
        }
        // Only explicit session codes — bare 401/403 during blips must not clear Google cookies
        if (
          code === 'SESSION_REPLACED' ||
          code === 'NO_CREDITS' ||
          code === 'BANNED' ||
          code === 'PLAN_EXPIRED' ||
          code === 'TAMPERED_CLIENT' ||
          code === 'SUSPICIOUS_CLIENT'
        ) {
          await this.forceLogout((data && data.error) || 'Please sign in again.');
        }
        return;
      }

      if (data.forceClearGoogle) {
        try {
          await fetch(`${this.config.serverUrl}${CLIENT_API}/ack-google-wipe`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.config.authToken}`
            }
          });
        } catch (e) {}
        await this.forceLogout('Session revoked by administrator. Please sign in again.');
        return;
      }

      this.currentServers = data.servers || [];
      if (data.user) {
        this.currentUser = { ...(this.currentUser || {}), ...data.user };
        this.updateToolbarUserInfo();
        this.applyLockFromUser(data.user);
      }
      const purged = await this.purgeStaleAssignedAccount(data.servers, data.activeServer);
      if (!purged) {
        if (data.activeServer && !this._switchingServerInFlight) {
          const isStandardToolRunning =
            this.runningToolId === 'google-gemini' || this.runningToolId === 'google-flow';
          const isImageToolRunning = String(this.runningToolId || '').startsWith('flow-image-srv-');
          if (!(isStandardToolRunning && this.isImageOnlyServer(data.activeServer)) &&
              !(isImageToolRunning && !this.isImageOnlyServer(data.activeServer))) {
            this.activeServer = sanitizeServerForStorage({
              ...data.activeServer,
              imageOnly: this.isImageOnlyServer(data.activeServer)
            });
          }
        }
        this.populateServerSelect(data.servers || []);
        return;
      }

      const stdServers = this.getStandardServers(data.servers);
      if (data.activeServer?.id && !this.isImageOnlyServer(data.activeServer)) {
        await this.launchServerWorkspace(data.activeServer.id, true);
      } else if (stdServers.length > 0) {
        await this.launchServerWorkspace(stdServers[0].id, true);
      } else if ((data.servers || []).length > 0) {
        await this.launchServerWorkspace(data.servers[0].id, true);
      } else {
        this.activeServer = null;
        this.setAccountName('No account');
        this.notify('No shared Google accounts available', true);
      }
    } catch (err) {
      console.warn('[AppShell] assignment watch failed:', err.message);
    }
  }

  notify(message, isError = false) {
    let el = document.getElementById('app-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'app-toast';
      el.className = 'app-toast';
      document.body.appendChild(el);
    }
    el.textContent = String(message || '');
    el.classList.toggle('error', !!isError);
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  isImageOnlyServer(srv) {
    if (!srv) return false;
    if (srv.imageOnly || srv.accountType === 'image') return true;
    const match = (this.currentServers || []).find((s) => s && s.id === srv.id);
    return !!(match && (match.imageOnly || match.accountType === 'image'));
  }

  getStandardServers(list) {
    const arr = Array.isArray(list) ? list : (this.currentServers || []);
    return arr.filter((s) => s && !this.isImageOnlyServer(s));
  }

  formatServerDisplayName(srv, allServers) {
    if (!srv) return 'Account';
    if (!this.isImageOnlyServer(srv)) return srv.name || 'Account';
    const list = Array.isArray(allServers) ? allServers : (this.currentServers || []);
    const imgServers = list.filter((s) => s && this.isImageOnlyServer(s));
    const idx = Math.max(0, imgServers.findIndex((s) => s.id === srv.id));
    const raw = String(srv.name || '').trim();
    if (/^(google|glow)s*flows*images/i.test(raw)) return raw;
    if (/^servers*d+$/i.test(raw)) {
      return 'Google Flow Images - ' + raw.replace(/^servers*/i, 'Server ');
    }
    return 'Google Flow Images - Server ' + (idx + 1);
  }

  getAllSuiteTools() {
    const imgServers = (this.currentServers || []).filter((s) => s && this.isImageOnlyServer(s));
    const imgTools = imgServers.map((srv, idx) => {
      const displayName = this.formatServerDisplayName(srv, this.currentServers);
      return {
        id: 'flow-image-srv-' + srv.id,
        serverId: srv.id,
        imageOnlyServer: true,
        code: 'FLOW IMAGES / 0' + (idx + 1),
        name: displayName,
        eyebrow: '— FREE IMAGE GENERATION / ' + displayName.toUpperCase(),
        heroTitle: 'Unlimited AI Image Studio.',
        heroDesc: 'Dedicated Google Flow Image Generation account (' + displayName + ') — Nano Banana & Imagen studio with 0 credit cost and Bulk Image automation.',
        category: 'Image Generation Only (0 Cost)',
        description: 'Google Flow Image Generation Studio & Bulk Image Mode (Free — 0 Credits)',
        domain: '',
        url: srv.targetUrl || 'https://flow.google.com/',
        ready: true,
        usesGoogleAccount: true,
        iconSvg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="4" stroke="#38bdf8" stroke-width="2"/><circle cx="8.5" cy="8.5" r="1.8" fill="#34d399"/><path d="M21 15l-5-5L5 21" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      };
    });
    return [...SUITE_TOOLS_CATALOG, ...imgTools];
  }

  initWorkspaceHub() {
    if (this.btnOpenWorkspaceHub) {
      this.btnOpenWorkspaceHub.addEventListener('click', () => {
        if (!this.currentUser) return;
        const isOpen = this.workspaceHubScreen && !this.workspaceHubScreen.classList.contains('hidden');
        if (isOpen && this.runningToolId) {
          if (this.selectedToolId && this.selectedToolId !== this.runningToolId) {
            this.openToolFromHub(this.selectedToolId);
          } else {
            this.hideWorkspaceHub();
          }
        } else {
          this.showWorkspaceHub();
        }
      });
    }
    if (this.hubHeroPrimaryBtn) {
      this.hubHeroPrimaryBtn.addEventListener('click', () => {
        const allTools = this.getAllSuiteTools();
        const tool = allTools.find((t) => t.id === this.selectedToolId) || allTools[0];
        if (!tool.ready) {
          this.notify(tool.name + ' will be available in an upcoming update.');
          return;
        }
        this.openToolFromHub(tool.id);
      });
    }
    if (this.hubHeroStopBtn) {
      this.hubHeroStopBtn.addEventListener('click', () => {
        if (this.runningToolId) {
          this.stopToolSession(this.runningToolId);
        }
      });
    }
    if (this.hubHeroGuideBtn) {
      this.hubHeroGuideBtn.addEventListener('click', () => {
        this.notify('Select any Ready tool below to launch immediately with your shared Pro account.');
      });
    }
    this.renderWorkspaceHub();
  }

  syncToolbarBadgesForMode() {
    const hubOpen = this.workspaceHubScreen && !this.workspaceHubScreen.classList.contains('hidden');
    const activeTool = this.getAllSuiteTools().find((t) => t.id === this.runningToolId);
    const isGemini = this.runningToolId === 'google-gemini';
    const hideGoogleToolbarItems = hubOpen || (activeTool && !activeTool.usesGoogleAccount);
    const hideServerSwitcher = hideGoogleToolbarItems || isGemini;

    const srvWrap = document.querySelector('.server-switcher-wrapper');
    const pillExpiry = document.getElementById('pill-expiry');
    const pillLock = document.getElementById('pill-lock');
    if (srvWrap) srvWrap.style.display = hideServerSwitcher ? 'none' : '';
    if (pillExpiry) pillExpiry.style.display = hubOpen ? 'none' : '';
    if (pillLock) {
      if (hideGoogleToolbarItems) pillLock.style.display = 'none';
      else pillLock.style.display = '';
    }
  }

  showWorkspaceHub() {
    if (!this.workspaceHubScreen) return;
    this.hideLoadingOverlay();
    this.hideGoogleAuthBanner();
    this.postAuthOverlay?.({ show: false, captcha: false, done: true });
    this.workspaceHubScreen.classList.remove('hidden');
    this.btnOpenWorkspaceHub?.classList.add('active');
    if (this.btnToggleVeoAuto) {
      this.btnToggleVeoAuto.style.display = 'none';
    }
    const urlBar = document.getElementById('debug-url-bar');
    if (urlBar) urlBar.classList.add('hidden');
    this.syncToolbarBadgesForMode();
    this.renderWorkspaceHub();
    this.syncShellModeFromUi();
    // Refresh server list in background so newly added Image-Only accounts appear immediately
    this.checkAssignedAccountStillExists?.().catch(() => {});
  }

  hideWorkspaceHub() {
    if (!this.workspaceHubScreen) return;
    this.workspaceHubScreen.classList.add('hidden');
    this.btnOpenWorkspaceHub?.classList.remove('active');
    const isFlowTool = this.runningToolId === 'google-flow' || String(this.runningToolId || '').startsWith('flow-image-srv-');
    if (this.btnToggleVeoAuto) {
      this.btnToggleVeoAuto.style.display = isFlowTool ? '' : 'none';
    }
    const urlBar = document.getElementById('debug-url-bar');
    if (urlBar) {
      const isTts = this.runningToolId === 'zextts-studio';
      urlBar.classList.toggle('hidden', isTts);
      urlBar.style.display = isTts ? 'none' : '';
    }
    this.syncToolbarBadgesForMode();
    try {
      const live = this.webview?.getURL ? this.webview.getURL() : (this.webview?.src || '');
      if (!/accounts\.google\.com|accounts\.youtube\.com/i.test(String(live || ''))) {
        this.hideLoadingOverlay();
        this.hideGoogleAuthBanner();
        this.postAuthOverlay?.({ show: false, captcha: false, done: true });
      }
    } catch (e) {}
    this.syncShellModeFromUi();
  }

  selectToolInHub(toolId) {
    const tool = this.getAllSuiteTools().find((t) => t.id === toolId);
    if (!tool) return;
    this.selectedToolId = tool.id;
    this.renderWorkspaceHub();
  }

  isUrlMatchingTool(url, tool) {
    const u = String(url || '').toLowerCase();
    if (!u || u === 'about:blank') return false;
    if (tool.imageOnlyServer && tool.serverId) {
      return (u.includes('flow.google.com') || u.includes('labs.google')) && this.activeServer?.id === tool.serverId;
    }
    if (tool.id === 'google-flow') {
      return (u.includes('flow.google.com') || u.includes('labs.google')) && !this.isImageOnlyServer(this.activeServer);
    }
    if (tool.id === 'google-gemini') {
      return (u.includes('gemini.google.com') || u.includes('bard.google.com')) && !this.isImageOnlyServer(this.activeServer);
    }
    if (tool.id === 'zextts-studio') {
      return u.includes('/zextts/');
    }
    return tool.domain ? u.includes(tool.domain.toLowerCase()) : false;
  }

  async openToolFromHub(toolId) {
    const tool = this.getAllSuiteTools().find((t) => t.id === toolId);
    if (!tool) return;
    if (!tool.ready) {
      this.notify(tool.name + ' is not configured yet.');
      return;
    }

    const prevRunning = this.runningToolId;
    this.selectedToolId = tool.id;
    this.runningToolId = tool.id;
    this._activeToolTargetUrl = tool.url;
    this._totpFilling = false;

    // Check if WebView is already on the requested tool's domain and same account
    let liveUrl = '';
    try {
      liveUrl = this.webview?.getURL ? this.webview.getURL() : (this.webview?.src || '');
    } catch (e) {}

    if (prevRunning === tool.id && this.isUrlMatchingTool(liveUrl, tool) && !this._pendingFreshLogin) {
      this.hideWorkspaceHub();
      this.hideLoadingOverlay();
      this.hideGoogleAuthBanner();
      this.postAuthOverlay({ show: false, captcha: false, done: true });
      return;
    }

    // Activate native transition cover BEFORE shrinking Workspace Hub so the previous app never flashes!
    try {
      window.chrome?.webview?.postMessage(JSON.stringify({
        type: 'cmd',
        cmd: 'prepareToolSwitch',
        url: tool.url
      }));
    } catch (e) {}

    this.hideWorkspaceHub();

    if (tool.imageOnlyServer && tool.serverId) {
      await this.launchServerWorkspace(tool.serverId, !!this._pendingFreshLogin, tool.url);
      return;
    }

    if ((tool.id === 'google-flow' || tool.id === 'google-gemini') && (!this.activeServer?.id || this.isImageOnlyServer(this.activeServer))) {
      const stdList = this.getStandardServers(this.currentServers);
      const stdSrv = stdList.find((s) => this.googleLockRemainingMs(s.id) <= 0) || stdList[0];
      if (stdSrv && stdSrv.id) {
        await this.launchServerWorkspace(stdSrv.id, !!this._pendingFreshLogin, tool.url);
        return;
      }
    }

    if (tool.usesGoogleAccount) {
      if (!this._pendingFreshLogin) {
        this.hideGoogleAuthBanner();
        this.postAuthOverlay({ show: false, captcha: false, done: true });
      }
      if (this.activeServer?.id) {
        await this.launchServerWorkspace(this.activeServer.id, !!this._pendingFreshLogin, tool.url);
      } else {
        await this.requestBalancedServerAndLaunch(false);
        if (this.activeServer?.id) {
          await this.launchServerWorkspace(this.activeServer.id, !!this._pendingFreshLogin, tool.url);
        } else {
          this.loadTargetInWebview(tool.url, true);
        }
      }
    } else {
      this._totpFilling = false;
      this.hideGoogleAuthBanner();
      this.hideLoadingOverlay();
      this.postAuthOverlay({ show: false, captcha: false, done: true });
      this.loadTargetInWebview(tool.url, true);
    }
  }

  stopToolSession(toolId) {
    if (this.runningToolId === toolId) {
      this.runningToolId = null;
      if (this.btnToggleVeoAuto) {
        this.btnToggleVeoAuto.style.display = 'none';
      }
      try {
        if (typeof this.webview?.loadURL === 'function') this.webview.loadURL('about:blank');
        else if (this.webview) this.webview.src = 'about:blank';
      } catch (e) {}
      const tool = this.getAllSuiteTools().find((t) => t.id === toolId);
      this.notify((tool ? tool.name : 'Tool') + ' session stopped.');
    }
    this.renderWorkspaceHub();
  }

  renderWorkspaceHub() {
    if (!this.hubToolsGrid) return;
    const allTools = this.getAllSuiteTools();
    const selectedTool =
      allTools.find((t) => t.id === this.selectedToolId) ||
      allTools.find((t) => t.id === this.runningToolId) ||
      allTools[0];

    if (this.hubBcToolName) this.hubBcToolName.textContent = selectedTool.name;
    if (this.hubHeroEyebrow) this.hubHeroEyebrow.textContent = selectedTool.eyebrow;
    if (this.hubHeroTitle) this.hubHeroTitle.textContent = selectedTool.heroTitle;
    if (this.hubHeroDesc) this.hubHeroDesc.textContent = selectedTool.heroDesc;
    if (this.hubHeroIconBox) this.hubHeroIconBox.innerHTML = selectedTool.iconSvg;
    if (this.hubHeroCode) this.hubHeroCode.textContent = selectedTool.code;
    if (this.hubMetaDest) this.hubMetaDest.textContent = selectedTool.domain;

    if (this.hubMetaMembership && this.currentUser) {
      const cr = Math.max(0, Number(this.currentUser.credits) || 0).toLocaleString();
      this.hubMetaMembership.innerHTML = '<span class="hub-meta-check">🔒</span> Active Pro Member (' + cr + ' Credits)';
    }

    const isSelectedRunning = this.runningToolId === selectedTool.id;
    if (this.hubHeroPrimaryBtn) {
      if (!selectedTool.ready) {
        this.hubHeroPrimaryBtn.innerHTML = '<span>Not Configured</span>';
        this.hubHeroPrimaryBtn.disabled = true;
        this.hubHeroPrimaryBtn.style.opacity = '0.55';
      } else {
        this.hubHeroPrimaryBtn.disabled = false;
        this.hubHeroPrimaryBtn.style.opacity = '1';
        this.hubHeroPrimaryBtn.innerHTML = isSelectedRunning
          ? '<span>Resume Session &rsaquo;</span>'
          : '<span>Open ' + selectedTool.name + ' &rsaquo;</span>';
      }
    }
    if (this.hubHeroStopBtn) {
      this.hubHeroStopBtn.classList.toggle('hidden', !isSelectedRunning);
    }

    const readyCount = allTools.filter((t) => t.ready).length;
    if (this.hubSuiteCountLabel) {
      this.hubSuiteCountLabel.textContent = readyCount + ' Ready / ' + allTools.length + ' Tools Configured';
    }

    const gridSig =
      allTools.map((t) => `${t.id}:${t.ready ? 1 : 0}:${t.name}`).join('|') +
      `||sel=${selectedTool.id}||run=${this.runningToolId || ''}`;
    if (this._lastHubGridSig === gridSig && this.hubToolsGrid.children.length === allTools.length) {
      return;
    }
    this._lastHubGridSig = gridSig;

    this.hubToolsGrid.innerHTML = '';
    allTools.forEach((tool) => {
      const isRunning = this.runningToolId === tool.id;
      const isSelected = selectedTool.id === tool.id;

      const card = document.createElement('div');
      card.className = 'hub-tool-card' + (isSelected ? ' selected' : '');
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        this.selectToolInHub(tool.id);
      });

      const statusClass = tool.ready ? 'ready' : 'not-configured';
      const statusText = tool.ready ? '• Ready' : '• Not Configured';

      let actionsHtml = '';
      if (!tool.ready) {
        actionsHtml = '<button type="button" class="hub-card-btn disabled" disabled>Not Configured</button>';
      } else if (isRunning) {
        actionsHtml =
          '<button type="button" class="hub-card-btn primary" data-hub-open="' + tool.id + '">Running &rsaquo;</button>' +
          '<button type="button" class="hub-card-btn stop" data-hub-stop="' + tool.id + '">Stop</button>';
      } else {
        actionsHtml =
          '<button type="button" class="hub-card-btn primary" data-hub-open="' + tool.id + '">Open &rsaquo;</button>';
      }

      card.innerHTML =
        '<div class="hub-card-top">' +
          '<div class="hub-card-brand">' +
            '<div class="hub-card-icon">' + tool.iconSvg + '</div>' +
            '<div class="hub-card-titles">' +
              '<div class="hub-card-name">' + tool.name + '</div>' +
              '<div class="hub-card-cat">' + tool.category + '</div>' +
            '</div>' +
          '</div>' +
          '<span class="hub-status-pill ' + statusClass + '">' + statusText + '</span>' +
        '</div>' +
        '<div class="hub-card-desc">' + tool.description + '</div>' +
        '<div class="hub-card-footer">' +
          '<span class="hub-card-domain">' + tool.domain + '</span>' +
          '<div class="hub-card-actions">' + actionsHtml + '</div>' +
        '</div>';

      const openBtn = card.querySelector('[data-hub-open]');
      if (openBtn) {
        openBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openToolFromHub(tool.id);
        });
      }
      const stopBtn = card.querySelector('[data-hub-stop]');
      if (stopBtn) {
        stopBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.stopToolSession(tool.id);
        });
      }

      this.hubToolsGrid.appendChild(card);
    });
  }

  updateToolbarUserInfo() {
    if (!this.currentUser) return;
    this.applyLockFromUser(this.currentUser);
    // Negative credits allowed server-side — UI shows/gates as 0
    const raw = Number(this.currentUser.credits);
    const shown = Number.isFinite(raw) ? Math.max(0, raw) : 0;
    if (this.creditsVal) this.creditsVal.textContent = shown.toLocaleString();
    this.syncCreditsToWebview();
    this.renderWorkspaceHub?.();

    const expiry = new Date(this.currentUser.planExpiry);
    const diffDays = Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

    if (diffDays > 0) {
      this.expiryVal.textContent = `${diffDays} Days Left`;
      this.expiryVal.parentElement.className = 'pill-badge expiry-badge no-drag';
    } else {
      this.expiryVal.textContent = `Expired`;
      this.expiryVal.parentElement.className = 'pill-badge expiry-badge no-drag';
      this.expiryVal.parentElement.style.borderColor = '#ef4444';
      this.expiryVal.parentElement.style.color = '#f87171';
    }
  }

  syncCreditsToWebview() {
    if (!this.currentUser) return;
    const raw = Number(this.currentUser.credits);
    const shown = Number.isFinite(raw) ? Math.max(0, raw) : 0;
    try {
      if (this.webview && typeof this.webview.send === 'function') {
        this.webview.send('apply-user-credits', { credits: shown });
      }
      if (this.webview && typeof this.webview.executeJavaScript === 'function') {
        this.webview.executeJavaScript(`try { if (window.__flowSetDatabaseCredits) window.__flowSetDatabaseCredits(${shown}); } catch(e){}`).catch(() => {});
      }
    } catch (e) {}
  }

  getSavedProjectsStorageKey() {
    const uid = (this.currentUser && (this.currentUser.id || this.currentUser.username || this.currentUser.email)) || 'default';
    const srvId = (this.activeServer && this.activeServer.id) || 'default_srv';
    return 'flow_device_saved_projects_v2_' + uid + '_' + srvId;
  }

  handleSaveProjectsFromWebview(payload) {
    try {
      const list = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.projects) ? payload.projects : null);
      if (!list) return;
      const key = this.getSavedProjectsStorageKey();
      localStorage.setItem(key, JSON.stringify(list));
    } catch (e) {}
  }

  syncSavedProjectsToWebview() {
    try {
      const key = this.getSavedProjectsStorageKey();
      const srvId = (this.activeServer && this.activeServer.id) || '';
      const raw = localStorage.getItem(key) || '[]';
      const list = JSON.parse(raw);
      if (Array.isArray(list) && this.webview && typeof this.webview.send === 'function') {
        this.webview.send('apply-saved-projects', { projects: list, serverId: srvId, replace: true });
      }
    } catch (e) {}
  }

  populateServerSelect(servers = []) {
    this.serverSelect.innerHTML = '';
    const stdServers = this.getStandardServers(servers);
    const dropdownServers = stdServers.length > 0 ? stdServers : servers;
    if (dropdownServers.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Default Node';
      this.serverSelect.appendChild(opt);
      this.setAccountName('Account');
      return;
    }

    dropdownServers.forEach(srv => {
      const opt = document.createElement('option');
      opt.value = srv.id;
      opt.textContent = this.formatServerDisplayName(srv, servers);
      this.serverSelect.appendChild(opt);
    });
    const current = this.activeServer && dropdownServers.find(s => s.id === this.activeServer.id);
    const activeId = (current && current.id) || dropdownServers[0].id;
    if (activeId) this.serverSelect.value = activeId;
    const activeSrvObj = (this.activeServer && servers.find(s => s.id === this.activeServer.id)) || this.activeServer || dropdownServers[0];
    this.setAccountName(this.formatServerDisplayName(activeSrvObj, servers));
    this.renderWorkspaceHub?.();
  }

  setAccountName(name) {
    const label = name || 'Account';
    if (this.accountNameLabel) this.accountNameLabel.textContent = label;
    if (this.androidSettingsAccountLabel) this.androidSettingsAccountLabel.textContent = label;
  }

  initAndroidSettingsMenu() {
    if (!this.btnAndroidSettings || !this.androidSettingsSheet) return;

    const closeMenu = () => {
      this.androidSettingsSheet.classList.add('hidden');
      this.btnAndroidSettings.setAttribute('aria-expanded', 'false');
      this.syncShellModeFromUi?.();
    };

    const openMenu = () => {
      this.androidSettingsSheet.classList.remove('hidden');
      this.btnAndroidSettings.setAttribute('aria-expanded', 'true');
      // Lift Google cover while settings is open (full shell hosts the sheet)
      this.postAuthOverlay({ show: false, captcha: false });
      this.syncShellModeFromUi();
    };

    this.btnAndroidSettings.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.androidSettingsSheet.classList.contains('hidden')) openMenu();
      else closeMenu();
    });

    this.btnAndroidSettingsClose?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenu();
    });

    this.androidSettingsBackdrop?.addEventListener('click', () => closeMenu());

    this.androidSettingsSheet.addEventListener('click', (e) => {
      const item = e.target.closest('[data-settings-action]');
      if (!item) return;
      e.stopPropagation();
      const action = item.getAttribute('data-settings-action');
      switch (action) {
        case 'change-account':
          closeMenu();
          this.requestBalancedServerAndLaunch(true);
          break;
        case 'reload':
          closeMenu();
          this.reloadWebview();
          break;
        case 'clear-cookies':
          closeMenu();
          this.handleClearCookies();
          break;
        case 'veo-auto':
          closeMenu();
          window.electronAPI?.toggleBulkPanel?.();
          break;
        case 'downloads':
          // Keep shell full while opening downloads — closing settings first
          // collapsed the shell strip and hid the drawer under Flow.
          this.downloadDrawer?.classList.remove('hidden');
          this.androidSettingsSheet.classList.add('hidden');
          this.btnAndroidSettings?.setAttribute('aria-expanded', 'false');
          window.electronAPI.setShellMode?.('full');
          this.syncShellModeFromUi();
          break;
        case 'logout':
          closeMenu();
          this.handleLogout();
          break;
        default:
          closeMenu();
          break;
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
    });
  }

  async handleServerSwitch() {
    const serverId = this.serverSelect.value;
    if (!serverId) return;
    await this.launchServerWorkspace(serverId, true);
  }

  /** Ask backend for the least-loaded shared Google account, then open it. */
  async requestBalancedServerAndLaunch(fromButton = false) {
    const btn = this.btnRequestServerChange;
    if (fromButton && btn) {
      btn.disabled = true;
      btn.textContent = 'Checking…';
    }
    try {
      const res = await fetch(`${this.config.serverUrl}${CLIENT_API}/request-server-change`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.authToken}`
        },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (data && data.code === 'GOOGLE_SESSION_LOCKED') {
        this.noteGoogleLock(data);
        if (fromButton) {
          this.notify(this.googleLockMessage(data), true);
          return;
        }
        // Login path: stay on the current account and just open Flow (no re-login needed).
      } else if (data && data.success && data.server) {
        console.log('[AppShell] Load-balanced server:', data.server.name, data.server.email, data.load);
        const stdList = this.getStandardServers(this.currentServers);
        if (fromButton && this.activeServer && (data.server.id === this.activeServer.id || this.isImageOnlyServer(data.server))) {
          if (stdList.length > 1) {
            const idx = Math.max(0, stdList.findIndex((s) => s.id === this.activeServer.id));
            let nextSrv = null;
            for (let offset = 1; offset < stdList.length; offset++) {
              const cand = stdList[(idx + offset) % stdList.length];
              if (cand && cand.id && this.googleLockRemainingMs(cand.id) <= 0) {
                nextSrv = cand;
                break;
              }
            }
            if (!nextSrv) {
              nextSrv = stdList[(idx + 1) % stdList.length];
            }
            if (nextSrv && nextSrv.id) {
              await this.launchServerWorkspace(nextSrv.id, true);
              return;
            }
          }
          this.notify('Already on the least-used account (' + data.server.name + ')');
          if (this.serverSelect) this.serverSelect.value = data.server.id;
          this.setAccountName(data.server.name);
          return;
        }
        if (data.user) this.applyLockFromUser(data.user);
        const chosenId = this.isImageOnlyServer(data.server) && stdList.length > 0 ? stdList[0].id : data.server.id;
        await this.launchServerWorkspace(chosenId, fromButton);
        return;
      }
    } catch (err) {
      console.warn('[AppShell] request-server-change failed:', err.message);
      if (fromButton) this.notify('Could not change account: ' + err.message, true);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Change account';
      }
    }
    if (!fromButton) {
      const stdList = this.getStandardServers(this.currentServers);
      if (this.activeServer?.id && !this.isImageOnlyServer(this.activeServer)) {
        await this.launchServerWorkspace(this.activeServer.id);
      } else if (stdList.length > 0) {
        await this.launchServerWorkspace(stdList[0].id);
      } else if (this.activeServer?.id) {
        await this.launchServerWorkspace(this.activeServer.id);
      } else {
        this.loadTargetInWebview('https://flow.google.com/');
      }
    }
  }

  async launchServerWorkspace(serverId, resetGoogle = false, targetOverrideUrl = '') {
    const rawTarget = targetOverrideUrl || this._activeToolTargetUrl || '';
    const isGeminiOrStandardFlow =
      rawTarget.includes('gemini.google.com') ||
      this.runningToolId === 'google-gemini' ||
      this.runningToolId === 'google-flow';
    if (isGeminiOrStandardFlow && this.isImageOnlyServer({ id: serverId })) {
      const stdList = this.getStandardServers(this.currentServers);
      const stdSrv = stdList.find((s) => this.googleLockRemainingMs(s.id) <= 0) || stdList[0];
      if (stdSrv && stdSrv.id) {
        serverId = stdSrv.id;
      }
    }

    const toolLabel = rawTarget.includes('gemini.google.com') ? 'Google Gemini' : 'Google Flow';
    this.showLoadingOverlay(
      resetGoogle ? 'Switching account...' : ('Opening ' + toolLabel + '...'),
      resetGoogle ? 'Starting a fresh Google sign-in' : 'Connecting shared Google workspace session'
    );

    this._switchingServerInFlight = true;
    try {
      let data;
      try {
        const res = await fetch(`${this.config.serverUrl}${CLIENT_API}/switch-server`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.authToken}`
          },
          body: JSON.stringify({ serverId })
        });
        data = await res.json();
        if (data && data.code === 'GOOGLE_SESSION_LOCKED') this.noteGoogleLock(data);
        if (data && data.user) this.applyLockFromUser(data.user);
      } catch (switchErr) {
        if (this.activeServer?.id && this.activeServer.id === serverId) {
          data = { success: true, server: this.activeServer };
        } else {
          throw switchErr;
        }
      }
      if (data && data.success) {
        const previousServerId = this.activeServer?.id || '';
        const serverChanged = !!(previousServerId && previousServerId !== data.server.id);
        const isImgServer = !!(
          this.isImageOnlyServer(data.server) ||
          String(this.runningToolId || '').startsWith('flow-image-srv-')
        );
        this.activeServer = sanitizeServerForStorage({
          ...data.server,
          imageOnly: isImgServer
        });
        if (this.serverSelect && !isImgServer) {
          this.serverSelect.value = data.server.id;
        }
        this.setAccountName(this.formatServerDisplayName(this.activeServer, this.currentServers));
        if (serverChanged) {
          this._credFailUntil = 0;
        }
        this.renderLockPill();
        const desiredUrl = targetOverrideUrl || this._activeToolTargetUrl || data.server.targetUrl || 'https://flow.google.com/';
        const isGeminiTarget = desiredUrl.includes('gemini.google.com');
        if (isGeminiTarget) {
          this.runningToolId = 'google-gemini';
          this.selectedToolId = 'google-gemini';
        } else if (isImgServer) {
          this.runningToolId = 'flow-image-srv-' + data.server.id;
          this.selectedToolId = this.runningToolId;
        } else if (String(this.runningToolId || '').startsWith('flow-image-srv-')) {
          this.runningToolId = 'google-flow';
          this.selectedToolId = 'google-flow';
        }
        this.syncToolbarBadgesForMode();
        this._lastAutoFillKey = null;
        this._lastAutoFillAt = 0;
        this._totpFilling = false;
        this._otpPushAt = 0;
        this._lastOtpCode = '';
        this._lastOtpFetchedAt = 0;
        this._credAttemptId = null;
        this._googleEmailMem = '';
        this._googlePasswordMem = '';
        this._googleCredServerId = data.server.id;
        this._credUsedStages = new Set();

        if (this.config?.authToken && this.config?.user) {
          await window.electronAPI.saveSession({
            token: this.config.authToken,
            user: this.config.user,
            activeServer: sanitizeServerForStorage(this.activeServer)
          });
        }

        const targetUrl = isGeminiTarget
          ? desiredUrl
          : desiredUrl.replace(/\/$/, '') + '/';

        // Snapshot previous server's isolated cookies and restore target server's isolated cookies
        let cookieRestored = false;
        try {
          const cookieSwitch = await window.electronAPI.switchFlowCookieProfile?.({
            fromServerId: previousServerId || data.server.id,
            toServerId: data.server.id
          });
          cookieRestored = !!(cookieSwitch && cookieSwitch.restored);
        } catch (e) {}

        if (cookieRestored && !resetGoogle) {
          this._pendingFreshLogin = false;
          this.hideGoogleAuthBanner();
          this.postAuthOverlay({ show: false, captcha: false, done: true });
          await this.sendCredentialsToWebview(false);
          console.log('[AppShell] Restored isolated session for', data.server.name, '->', targetUrl);
          this.loadTargetInWebview(targetUrl, true);
          if (this.googleLockRemainingMs() <= 0 || serverChanged) {
            this.reportGoogleFinish('success', { forceLock: true }).catch(() => {});
          }
        } else {
          this._pendingFreshLogin = false;
          this._freshLoginStarted = true;
          await this.sendCredentialsToWebview(true);
          await this.resolveGoogleEmailForFill();
          const loginUrl =
            'https://accounts.google.com/ServiceLogin?hl=en&continue=' +
            encodeURIComponent(targetUrl);
          console.log('[AppShell] Starting isolated Google login for', data.server.name, '->', loginUrl);
          this.loadTargetInWebview(loginUrl, true);
        }
      } else {
        const isLock = data && data.code === 'GOOGLE_SESSION_LOCKED';
        this.notify(
          isLock ? this.googleLockMessage(data) : (data && data.error) || 'Failed to switch server node',
          true
        );
        this.hideLoadingOverlay();
        // Never leave the workspace blank: reopen the account we are already on.
        if (this.serverSelect && this.activeServer?.id) {
          this.serverSelect.value = this.activeServer.id;
        }
        if (isLock && this.activeServer?.id && this.activeServer.id !== serverId) {
          const keepUrl = (this.activeServer.targetUrl || 'https://flow.google.com').replace(/\/$/, '') + '/';
          this.loadTargetInWebview(keepUrl);
        }
      }
    } catch (err) {
      console.error('Server switch error:', err);
      this.notify('Error communicating with server: ' + err.message, true);
      this.hideLoadingOverlay();
    } finally {
      this._switchingServerInFlight = false;
    }
  }

  /**
   * After switching servers we land on flow.google.com first, then start
   * exactly one fresh Google Sign-in in the main webview (no popup).
   */
  /**
   * Google CheckCookie / LoginDoneHtml often stalls under the auth cover.
   * Finish handoff by navigating to continue= (Flow) and clearing the overlay.
   */
  maybeFinishGoogleCheckCookie(url) {
    const href = String(url || '');
    if (!/CheckCookie|LoginDoneHtml|chtml=LoginDone/i.test(href)) return;
    if (this._checkCookieBounced) return;
    this._checkCookieBounced = true;
    this.maybeReportGoogleSuccess('https://flow.google.com/');
    let dest = this._activeToolTargetUrl || (this.activeServer?.targetUrl || 'https://flow.google.com').replace(/\/?$/, '/');
    try {
      const cont = new URL(href).searchParams.get('continue');
      if (cont && /^https:\/\//i.test(cont)) dest = cont;
    } catch (e) {}
    console.warn('[AppShell] CheckCookie/LoginDone →', dest);
    this._totpFilling = false;
    this._pendingFreshLogin = false;
    this._freshLoginStarted = true;
    this._allowFlowAfterCheckCookie = true;
    this.hideGoogleAuthBanner();
    this.hideLoadingOverlay();
    this.postAuthOverlay({ show: false, done: true });
    setTimeout(() => {
      this.loadTargetInWebview(dest);
    }, 400);
  }

  maybeStartFreshLoginAfterFlow(url) {
    if (!this._pendingFreshLogin) return;
    const href = String(url || '');
    if (!href.includes('flow.google.com') && !href.includes('labs.google') && !href.includes('gemini.google.com')) return;
    // Already bounced to Google once this cycle — never schedule again
    if (this._freshLoginStarted) return;
    if (this._freshLoginTimer) clearTimeout(this._freshLoginTimer);
    this._freshLoginTimer = setTimeout(() => {
      if (!this._pendingFreshLogin) return;
      this._pendingFreshLogin = false;
      this._freshLoginStarted = true;
      const continueUrl = this._activeToolTargetUrl || ((this.activeServer?.targetUrl || 'https://flow.google.com').replace(/\/$/, '') + '/');
      const googleLoginUrl =
        'https://accounts.google.com/AddSession?hl=en&continue=' +
        encodeURIComponent(continueUrl);
      console.log('[AppShell] Fresh Google login in webview for', this.activeServer?.email, '→', googleLoginUrl);
      this.loadTargetInWebview(googleLoginUrl);
    }, 700);
  }

  navigateFromSearchBar() {
    // URL bar is display-only — never navigate from it
    return;
  }

  /** Top-level URLs allowed in the Flow webview. */
  isAllowedFlowUrl(raw) {
    const url = String(raw || '');
    if (!url || url.startsWith('about:') || url.startsWith('data:')) return true;
    try {
      const u = new URL(url);
      const host = (u.hostname || '').toLowerCase();
      const path = (u.pathname || '').toLowerCase();
      if (host === 'flow.google.com' || host.endsWith('.flow.google.com')) return true;
      if (host === 'labs.google' || host.endsWith('.labs.google')) return true;
      if (host === 'gemini.google.com' || host.endsWith('.gemini.google.com')) return true;
      if (host === 'app.flowbrowser.localhost' || host === 'flowbrowser.local') return true;
      if (host === 'bard.google.com' || host === 'aistudio.google.com') return true;
      if (host === 'accounts.google.com' || host.endsWith('.accounts.google.com')) return true;
      if (host === 'accounts.youtube.com') return true;
      // Post-login recovery / home-address cards (auto-cancelled)
      if (host === 'gds.google.com' || host.endsWith('.gds.google.com')) return true;
      if (host === 'google.com' || host === 'www.google.com') {
        return (
          path.startsWith('/accountchooser') ||
          path.startsWith('/signin') ||
          path.startsWith('/accounts') ||
          path.startsWith('/servicelogin') ||
          path.startsWith('/logout') ||
          path.startsWith('/oauth') ||
          path.includes('signin') ||
          path.includes('recaptcha')
        );
      }
      if (host.includes('gstatic.com') && path.includes('recaptcha')) return true;
      if (host === 'youtube.com' || host.endsWith('.youtube.com')) return true;
      return false;
    } catch (e) {
      return /flow\.google\.com|labs\.google|gemini\.google\.com|accounts\.google\.com|gds\.google\.com/i.test(url);
    }
  }

  updateDebugUrl(url) {
    if (!this.debugUrlInput) return;
    let value = url || '';
    if (!value || value === 'about:blank') {
      try {
        if (this.webview && typeof this.webview.getURL === 'function') {
          const live = this.webview.getURL();
          if (live && live !== 'about:blank') value = live;
        }
      } catch (e) {}
    }
    if (!value) value = 'about:blank';
    // Strip/redact any email address or Email= query parameter so account emails NEVER appear in the URL bar
    try {
      value = String(value)
        .replace(/([?&])(email|Email|login_hint)=[^&#]*/g, '$1')
        .replace(/[?&]+(&)/g, '?')
        .replace(/\?&/g, '?')
        .replace(/[?&]$/g, '')
        .replace(/[a-zA-Z0-9._%+-]+(?:@|%40)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[hidden]');
    } catch (e) {}
    const urlBar = document.getElementById('debug-url-bar');
    if (urlBar) {
      const isTtsStudio = /zextts|app.flowbrowser.localhost|flowbrowser.local/i.test(value);
      urlBar.classList.toggle('hidden', isTtsStudio);
      urlBar.style.display = isTtsStudio ? 'none' : '';
    }
    // Display-only bar (div or input)
    if ('value' in this.debugUrlInput && this.debugUrlInput.tagName === 'INPUT') {
      this.debugUrlInput.value = value;
      this.debugUrlInput.readOnly = true;
    } else {
      this.debugUrlInput.textContent = value;
    }
    this.debugUrlInput.title = value;
  }

  startDebugUrlPolling() {
    if (this._urlPollTimer) return;
    this._urlPollTimer = setInterval(() => {
      try {
        if (!this.webview) return;
        const live = this.webview.getURL ? this.webview.getURL() : this.webview.src;
        if (!live) return;
        this.updateDebugUrl(live);
        if (!/accounts\.google\.com|accounts\.youtube\.com/i.test(live)) return;
        if (DEBUG_SKIP_GOOGLE_NEXT) {
          // Keep URL live; do not drive overlay or auto-Next from the poller
          if (DEBUG_DISABLE_AUTH_OVERLAY) this.postAuthOverlay({ show: false, captcha: false });
          return;
        }

        // Recaptcha challenge — no fills, no overlays, keep cover lifted
        if (/challenge\/recaptcha|\/recaptcha/i.test(live)) {
          this._captchaActive = true;
          this.showGoogleAuthBanner('Please solve the captcha below', true);
          this.postAuthOverlay({ show: false, captcha: true });
          try {
            this.webview.executeJavaScript(`(() => {
              try {
                document.getElementById('__flow_host_ol__')?.remove();
                document.getElementById('__flow_auto_login_overlay__')?.remove();
              } catch (e) {}
              return true;
            })()`).catch(() => {});
          } catch (e) {}
          return;
        }

        // Keep Google loading overlay visible (except captcha)
        if (!this._captchaActive) {
          this.showGoogleAuthBanner('Signing you in automatically…', false);
          try {
            this.webview.executeJavaScript(`(() => {
              try {
                if (typeof syncGoogleAuthChrome === 'function') syncGoogleAuthChrome();
                else if (typeof ensureAutoLoginOverlay === 'function') ensureAutoLoginOverlay();
              } catch (e) {}
              return true;
            })()`).catch(() => {});
          } catch (e) {}
        }

        if (!this.activeServer?.id) return;
        // Selection / sk must run even if a sticky _totpFilling flag was left on
        if (/challenge\/(selection|skotp|sk|iap|dp|ootp)/i.test(live) && !/challenge\/totp/i.test(live)) {
          this._totpFilling = false;
          this.tryGoogleAutoFill(live);
          return;
        }
        if (/challenge\/totp|accounts\.youtube\.com\/accounts\/SetSID/i.test(live)) {
          this._totpFilling = true;
          this.postAuthOverlay({ show: true, captcha: false });
          this.pushTotpFromBackend();
          return;
        }
        // Do not re-fill email/password while OTP autofill is in progress
        if (this._totpFilling) return;
        Promise.all([this.resolveGoogleEmailForFill(), this.resolveGooglePasswordForFill()])
          .then(([email, password]) => {
            this.fillGoogleLoginFields({ email: email || '', password: password || '' }).catch(() => {});
          })
          .catch(() => {});
        this.tryGoogleAutoFill(live);
      } catch (e) {}
    }, 900);
  }

  loadTargetInWebview(url, forceNavigate = false) {
    // Never use local demo/fake pages
    if (!url || url.includes('demo-flow') || url.startsWith('file:')) {
      url = this._activeToolTargetUrl || 'https://flow.google.com/';
    }
    // Never yank the tab to Flow while Google TOTP / sign-in is still open —
    // EXCEPT CheckCookie/LoginDone or an explicit user tool switch from the Workspace Hub (forceNavigate).
    if (!forceNavigate) {
      try {
        const live = this.webview?.getURL ? this.webview.getURL() : (this.webview?.src || '');
        const onGoogleAuth = /accounts\.google\.com|accounts\.youtube\.com/i.test(String(live || ''));
        const goingToFlow = /flow\.google\.com|labs\.google|gemini\.google\.com/i.test(String(url || ''));
        const onLoginDone = /CheckCookie|LoginDoneHtml|chtml=LoginDone/i.test(String(live || ''));
        if (onGoogleAuth && (goingToFlow || this._totpFilling) && !onLoginDone && !this._allowFlowAfterCheckCookie) {
          console.warn('[AppShell] skip navigate while Google auth/TOTP active:', url);
          return;
        }
      } catch (e) {}
    }
    // Only Flow workspace + Google login — block mail/drive/myaccount/etc.
    if (!this.isAllowedFlowUrl(url)) {
      console.warn('[AppShell] Blocked navigation to', url);
      // Mid-auth: do not rewrite blocked handoff hosts to Flow
      if (this._totpFilling || this._captchaActive) {
        console.warn('[AppShell] keep current page during auth (blocked url)', url);
        return;
      }
      url = this._activeToolTargetUrl || this.activeServer?.targetUrl || 'https://flow.google.com/';
    }
    // Never force chrome while the Flow Creator login screen is open (clips UI + traps overlay)
    const loginVisible = this.loginScreen && !this.loginScreen.classList.contains('hidden');
    if (loginVisible) {
      window.electronAPI.setShellMode?.('full');
    } else {
      window.electronAPI.setShellMode?.('chrome');
    }
    const isBuiltInStudio = /app\.flowbrowser\.localhost|flowbrowser\.local/i.test(String(url || ''));
    if (!isBuiltInStudio) {
      this.showLoadingOverlay('Opening Workspace...', '');
    } else {
      this.hideLoadingOverlay();
    }
    this.updateDebugUrl(url);
    this.startDebugUrlPolling();

    if (this._navTimer) clearTimeout(this._navTimer);
    if (this._credTimer1) clearTimeout(this._credTimer1);
    if (this._credTimer2) clearTimeout(this._credTimer2);
    if (this._credTimer3) clearTimeout(this._credTimer3);

    // Navigate immediately for built-in studio or forced tool switches
    const runNav = () => {
      this._navTimer = null;
      try {
        if (typeof this.webview.loadURL === 'function') this.webview.loadURL(url);
        else this.webview.src = url;
      } catch (e) {
        this.webview.src = url;
      }
      this.updateDebugUrl(url);
      if (!isBuiltInStudio) {
        this._credTimer1 = setTimeout(() => this.sendCredentialsToWebview(true), 900);
        this._credTimer2 = setTimeout(() => this.sendCredentialsToWebview(false), 2200);
        this._credTimer3 = setTimeout(() => this.sendCredentialsToWebview(false), 4500);
      }
    };
    if (forceNavigate || isBuiltInStudio) {
      runNav();
    } else {
      this._navTimer = setTimeout(runNav, 40);
    }

    if (this._overlayTimeout) clearTimeout(this._overlayTimeout);
    this._overlayTimeout = setTimeout(() => {
      this.hideLoadingOverlay();
    }, 6000);
  }

  onWebviewDomReady() {
    if (this._overlayTimeout) {
      clearTimeout(this._overlayTimeout);
      this._overlayTimeout = null;
    }
    // Send masking rules to the webview (keep profile icon visible)
    if (this.settings) {
      this.webview.send('apply-masking-rules', {
        modelRenames: [],
        cssSelectorsToHide: [],
        customCss: ''
      });
    }

    // Send Google auto-login credentials, database credits, and saved projects into the webview preload
    this.sendCredentialsToWebview();
    this.syncCreditsToWebview();
    this.syncSavedProjectsToWebview();
    // OTP-only backup — never re-fill email/password (that caused the password loop)
    this.tryGoogleAutoFill(this.webview.src);

    // Hide full overlay after short grace period to allow DOM mutations to finish cleanly
    setTimeout(() => {
      this.hideLoadingOverlay();
    }, 400);
  }

  async sendCredentialsToWebview(forceReset = false) {
    if (this.activeServer && this.activeServer.id) {
      const imageOnly = !!(
        this.isImageOnlyServer(this.activeServer) ||
        String(this.runningToolId || '').startsWith('flow-image-srv-')
      );
      const serverId = String(this.activeServer.id || '');
      const targetUrl = this._activeToolTargetUrl || this.activeServer.targetUrl || 'https://flow.google.com';

      // 1. Immediately push imageOnly & serverId to C# host and FlowView BEFORE any network await.
      // Omit email in Step 1 apply-credentials so flow-inject never sees a mismatched email or wipes _otp.
      try {
        window.chrome?.webview?.postMessage(JSON.stringify({
          type: 'cmd',
          cmd: 'setFlowCreds',
          email: this._googleEmailMem || '',
          password: this._googlePasswordMem || '',
          targetUrl: targetUrl,
          imageOnly: imageOnly,
          serverId: serverId
        }));
        this.webview.send('apply-credentials', {
          targetUrl: targetUrl,
          imageOnly: imageOnly,
          serverId: serverId
        });
        if (this.webview && typeof this.webview.executeJavaScript === 'function') {
          this.webview.executeJavaScript(
            `try { if (window.__flowSetImageOnlyMode) window.__flowSetImageOnlyMode(${imageOnly ? 'true' : 'false'}, ${JSON.stringify(serverId)}); } catch(e){}`
          ).catch(() => {});
        }
        this.syncSavedProjectsToWebview();
      } catch (e) {}

      // 2. Check current WebView URL before fetching or pushing login credentials.
      let liveStr = '';
      let onGoogleAuthPage = false;
      try {
        const live = this.webview?.getURL ? this.webview.getURL() : (this.webview?.src || '');
        liveStr = String(live || '');
        onGoogleAuthPage = /accounts\.google\.com|accounts\.youtube\.com/i.test(liveStr);
      } catch (e) {}

      // If currently on the TOTP / SetSID step, push OTP immediately and never re-run email/password fill!
      if (!forceReset && (/challenge\/totp|accounts\.youtube\.com\/accounts\/SetSID/i.test(liveStr) || this._totpFilling)) {
        this.pushTotpFromBackend();
        return;
      }

      if (!forceReset && !onGoogleAuthPage) {
        return;
      }

      const email = await this.resolveGoogleEmailForFill();
      const password = await this.resolveGooglePasswordForFill();
      const payload = {
        email: email || '',
        password: password || '',
        targetUrl: targetUrl,
        imageOnly: imageOnly,
        serverId: serverId,
        forceReset: !!forceReset
      };
      this._captchaActive = false;
      try {
        console.log('[AppShell] Sending credentials to webview (sealed)', forceReset ? '(forceReset)' : '', imageOnly ? '(imageOnly)' : '');
        window.chrome?.webview?.postMessage(JSON.stringify({
          type: 'cmd',
          cmd: 'setFlowCreds',
          email: payload.email,
          password: payload.password,
          targetUrl: payload.targetUrl,
          imageOnly: imageOnly,
          serverId: serverId
        }));
        this.webview.send('apply-credentials', payload);
      } catch (err) {
        console.warn('[AppShell] Could not send credentials to webview:', err.message);
      }
      if (onGoogleAuthPage && !/challenge\/totp|accounts\.youtube\.com\/accounts\/SetSID/i.test(liveStr)) {
        this.fillGoogleLoginFields(payload).catch((e) => console.warn('[AppShell] fillGoogle:', e.message));
      }
    } else {
      console.warn('[AppShell] No activeServer email to send for auto-login');
    }
  }

  async fillGoogleLoginFields(payload) {
    if (!payload?.email || !this.webview?.executeJavaScript) return;
    try {
      const live = this.webview.getURL ? this.webview.getURL() : this.webview.src;
      if (/challenge\/recaptcha|\/recaptcha/i.test(String(live || ''))) return;
    } catch (e) {}
    // Single-flight: concurrent poll/navigate handlers were queuing host executeFlow until timeout
    if (this._fillInFlight) return this._fillInFlight;
    const email = payload.email;
    const password = payload.password || '';
    this._fillInFlight = (async () => {
    const code = `(() => {
      const email = ${JSON.stringify(email)};
      const password = ${JSON.stringify(password)};
      const st = window.__flowFill = window.__flowFill || {};
      const path = location.pathname || '';
      if (!/accounts\\.google\\.com|accounts\\.youtube\\.com/i.test(location.hostname || '')) return { ok:false, reason:'not-google' };
      if (/recaptcha/i.test(path)) return { ok:false, reason:'recaptcha' };
      try { if (typeof window.__flowApplyCreds === 'function') window.__flowApplyCreds({ email, password, forceReset: false }); } catch (e) {}

      const visible = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
      };
      const textCaptchaInput = () => {
        return Array.from(document.querySelectorAll(
          'input[type="text"], input:not([type]), input[name="ca"], input[name="captcha"], input#ca, input#captcha'
        )).find((el) => {
          if (!visible(el) || el.type === 'hidden' || el.type === 'password') return false;
          const hint = ((el.placeholder || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.name || '') + ' ' + (el.id || '')).toLowerCase();
          return /type the text|hear or see|captcha|characters you see|\\bca\\b/i.test(hint);
        }) || null;
      };
      const hasTextCaptcha = () => {
        if (textCaptchaInput()) return true;
        const img = Array.from(document.querySelectorAll('#captchaimg, img#captchaimg, img[src*="Captcha" i], img[src*="captcha" i]')).find((el) => {
          if (!visible(el)) return false;
          const r = el.getBoundingClientRect();
          return r.width >= 40 && r.height >= 20;
        });
        if (img) return true;
        const t = ((document.body && document.body.innerText) || '').slice(0, 2000);
        return /type the text you hear or see|characters you see in the (?:box|image)/i.test(t);
      };
      if (hasTextCaptcha()) {
        try {
          if (typeof syncGoogleAuthChrome === 'function') syncGoogleAuthChrome();
        } catch (e) {}
        return { ok:false, reason:'text-captcha', path };
      }
      const fill = (el, val) => {
        if (!el || !val) return false;
        if ((el.value || '') === val) return true;
        try { el.focus(); el.click(); } catch (e) {}
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(el, val); else el.value = val;
        try { el.dispatchEvent(new InputEvent('input', { bubbles: true, data: val, inputType: 'insertText' })); }
        catch (e) { el.dispatchEvent(new Event('input', { bubbles: true })); }
        el.dispatchEvent(new Event('change', { bubbles: true }));
        try { el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' })); } catch (e) {}
        return (el.value || '') === val;
      };
      const skipAutoNext = ${DEBUG_SKIP_GOOGLE_NEXT ? 'true' : 'false'};
      const clickNext = (kind) => {
        if (skipAutoNext) return false;
        if (hasTextCaptcha()) {
          const ca = textCaptchaInput();
          if (!ca || !(ca.value || '').trim()) return false;
        }
        let next = null;
        if (kind === 'password') next = document.querySelector('#passwordNext button, #passwordNext');
        else if (kind === 'identifier') next = document.querySelector('#identifierNext button, #identifierNext');
        else if (kind === 'totp') next = document.querySelector('#totpNext button, #totpNext');
        if (!next) {
          next = Array.from(document.querySelectorAll('button')).find(b => /^\\s*next\\s*$/i.test((b.innerText || '').trim()));
        }
        if (!next) return false;
        try { next.removeAttribute('disabled'); next.click(); } catch (e) {}
        return true;
      };

      // AccountChooser support: click matching signed-in account or "Use another account"
      const chooserItems = Array.from(document.querySelectorAll('[data-identifier], [data-email], [data-profileidentifier]')).filter(visible);
      if (chooserItems.length > 0 && email) {
        const matchItem = chooserItems.find(el => {
          const idVal = (el.getAttribute('data-identifier') || el.getAttribute('data-email') || el.getAttribute('data-profileidentifier') || '').trim().toLowerCase();
          return idVal === email.toLowerCase();
        });
        if (matchItem) {
          const chooseKey = 'choose:' + email.toLowerCase() + ':' + path;
          if (!st[chooseKey]) {
            st[chooseKey] = 'clicked';
            const clickable = matchItem.querySelector('[role="link"], [role="button"], a, button') || matchItem;
            try { clickable.click(); } catch (e) {}
            try { matchItem.click(); } catch (e) {}
          }
          return { ok: true, step: 'chooser-match', email };
        }
        const useAnother = Array.from(document.querySelectorAll('li, div[role="link"], div[role="button"], button, a')).find(el =>
          visible(el) && /^use another account$/i.test((el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim())
        );
        if (useAnother) {
          const anotherKey = 'another:' + email.toLowerCase() + ':' + path;
          if (!st[anotherKey]) {
            st[anotherKey] = 'clicked';
            try { useAnother.click(); } catch (e) {}
          }
          return { ok: true, step: 'chooser-another', email };
        }
      }

      const pageTxt = ((document.body && document.body.innerText) || '').slice(0, 1500);
      const totpEl = document.querySelector('input[name="totpPin"], input#totpPin, input[autocomplete="one-time-code"]');
      const onTotpUi = /challenge\\/totp/i.test(path) ||
        (totpEl && visible(totpEl)) ||
        (/Authenticator|2-Step Verification/i.test(pageTxt) && /Enter code|verification code/i.test(pageTxt));
      if (onTotpUi) return { ok:true, step:'totp-wait' };

      // Prefer visible Passwd; only on password challenge (never on totp/skotp)
      const onPwdPath = path.indexOf('/challenge/pwd') >= 0;
      const pwd = onPwdPath ? Array.from(document.querySelectorAll(
        'input[name="Passwd"], input[type="password"], input[autocomplete*="current-password"]'
      )).find(el => visible(el)) : null;
      if (pwd && password) {
        const key = 'pwd:' + path;
        if (st[key] === 'done' && (pwd.value || '').length > 0) return { ok:true, step:'password-done' };
        if (st[key] === 'done') delete st[key];
        const ok = fill(pwd, password);
        if (!ok) return { ok:false, step:'password', reason:'fill-failed', valLen:(pwd.value||'').length };
        if (st[key] !== 'clicked') {
          st[key] = 'clicked';
          if (!skipAutoNext) {
            setTimeout(() => {
              if (document.querySelector('input[name="totpPin"], input#totpPin')) return;
              if ((pwd.value || '') === password) { clickNext('password'); st[key] = 'done'; }
              else delete st[key];
            }, 1600);
          } else {
            st[key] = 'done';
          }
        }
        return { ok:true, step: skipAutoNext ? 'password-filled-manual-next' : 'password', valLen:(pwd.value||'').length };
      }

      // SPA lag: URL already /challenge/pwd but password input not mounted yet — do not re-submit email
      if (path.indexOf('/challenge/pwd') >= 0) return { ok:false, reason:'awaiting-password', path };

      const emailEl = Array.from(document.querySelectorAll(
        'input#identifierId, input[type="email"], input[name="identifier"], input[autocomplete="username"]'
      )).find(el => visible(el));
      if (emailEl && email) {
        const key = 'email:' + path;
        if (st[key] === 'done' && (emailEl.value || '').toLowerCase() === email.toLowerCase()) return { ok:true, step:'email-done' };
        if (st[key] === 'done') delete st[key];
        const ok = fill(emailEl, email);
        if (!ok) return { ok:false, step:'email', reason:'fill-failed' };
        if (st[key] !== 'clicked') {
          st[key] = 'clicked';
          if (!skipAutoNext) {
            setTimeout(() => {
              if (/\\/challenge\\/pwd/i.test(location.pathname)) return;
              if ((emailEl.value || '').toLowerCase() === email.toLowerCase()) { clickNext('identifier'); st[key] = 'done'; }
              else delete st[key];
            }, 1600);
          } else {
            st[key] = 'done';
          }
        }
        return { ok:true, step: skipAutoNext ? 'email-filled-manual-next' : 'email', value:(emailEl.value||'').slice(0,24) };
      }
      return { ok:false, reason:'no-field', path };
    })()`;
    try {
      const result = await this.webview.executeJavaScript(code);
      console.log('[AppShell] fillGoogleLoginFields', result);
      return result;
    } catch (err) {
      console.warn('[AppShell] fillGoogleLoginFields failed', err.message);
      return null;
    }
    })();
    try {
      return await this._fillInFlight;
    } finally {
      this._fillInFlight = null;
    }
  }

  /**
   * OTP-only backup + 2FA challenge navigation helpers.
   * Email/password fill uses fillGoogleLoginFields (proven via CDP).
   */
  async tryGoogleAutoFill(url) {
    if (!url || !this.activeServer || !this.activeServer.id) return;
    const href = String(url);
    if (DEBUG_DISABLE_AUTH_OVERLAY) {
      // Keep Google UI visible while debugging
      this.postAuthOverlay({ show: false, captcha: false });
    }
    if (href.includes('flow.google.com') || href.includes('labs.google') || href.includes('gemini.google.com') || href.includes('bard.google.com')) {
      this.hideGoogleAuthBanner();
      this._totpFilling = false;
      // Do not end overlay immediately during Flow?Google bounce (fresh login).
      // Always force-finish within 10s once we are on the Flow workspace.
      this.scheduleFlowOverlayMaxDone();
      if (!this._pendingFreshLogin) {
        this.postAuthOverlay({ show: false, done: true });
        this.hideLoadingOverlay();
        this.cancelFlowOverlayMaxDone();
      }
      this._pwdCredPushed = false;
      return;
    }
    if (!href.includes('accounts.google.com') && !href.includes('accounts.youtube.com')) return;
    this.cancelFlowOverlayMaxDone();
    if (/challenge\/recaptcha|\/recaptcha/i.test(href)) {
      this._captchaActive = true;
      this._totpFilling = false;
      this.showGoogleAuthBanner('Please solve the captcha below', true);
      if (!DEBUG_DISABLE_AUTH_OVERLAY) this.postAuthOverlay({ show: false, captcha: true });
      return;
    }
    // TOTP / authenticator — keep cover on (auto-fill). Do not clear captcha flag
    // just because SPA URL still says /identifier or /pwd (that caused overlay flicker).
    const onTotpPath = /challenge\/totp/i.test(href);
    if (onTotpPath) this._totpFilling = true;
    if (/signin\/identifier|\/identifier|challenge\/pwd/i.test(href) && !this._totpFilling) {
      this._captchaActive = false;
    }

    if (!DEBUG_DISABLE_AUTH_OVERLAY) {
      if (!this.googleAuthBanner || this.googleAuthBanner.classList.contains('hidden')) {
        this.showGoogleAuthBanner('Signing you in automatically…', false);
      }
      if (!this._captchaActive || this._totpFilling) {
        this.postAuthOverlay({ show: true, captcha: false });
      }
    }

    const now = Date.now();
    // 2FA method chooser / security-key — MUST run before _totpFilling early-return
    // (otherwise challenge/selection stays stuck forever)
    const on2faNav = !DEBUG_SKIP_GOOGLE_NEXT &&
      /challenge\/(selection|skotp|sk|iap|dp|ootp)(?:\/|$|\?)/i.test(href) &&
      !/challenge\/totp/i.test(href);
    if (on2faNav) {
      // Clear sticky TOTP flag if Google bounced us back to the chooser
      this._totpFilling = false;
      try {
        const twoFa = await this.webview.executeJavaScript(`(() => {
          const visible = (el) => {
            if (!el) return false;
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) return false;
            const s = getComputedStyle(el);
            return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
          };
          const center = (el) => {
            const r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          };
          const isAuth = (raw) => {
            const t = String(raw || '').replace(/\\s+/g, ' ').trim().toLowerCase();
            if (!t || t.length > 220) return false;
            if (/one-time security code|tap yes|use your passkey|can.?t find an eligible|g\\.co\\/sc/i.test(t) &&
                !/authenticator/i.test(t)) return false;
            return /google authenticator/i.test(t) ||
              (/authenticator app/i.test(t) && /code|verification|get/i.test(t)) ||
              (/verification code/i.test(t) && /authenticator/i.test(t)) ||
              (/get a verification code/i.test(t) && /authenticator/i.test(t)) ||
              (/authentication app/i.test(t));
          };
          const text = (document.body && document.body.innerText || '');
          const onChooser = /choose how you want to sign in|choose a way/i.test(text);
          const onSecurityCode = /g\\.co\\/sc|get a code to sign in/i.test(text) && !onChooser && !/authenticator app/i.test(text);

          if (onSecurityCode || /\\/challenge\\/sk/i.test(location.pathname || '')) {
            const tryAnother = Array.from(document.querySelectorAll('button, a, [role="button"], [role="link"], span')).find(el =>
              /^try another way$/i.test((el.innerText || '').replace(/\\s+/g, ' ').trim()) && visible(el)
            );
            if (tryAnother) return { action: 'try-another', ...center(tryAnother) };
          }

          if (onChooser || /authenticator/i.test(text) || /\\/challenge\\/selection/i.test(location.pathname || '')) {
            const cands = Array.from(document.querySelectorAll(
              '[data-challengeid], [data-challengetype], [data-action="selectchallenge"], li, div[role="link"], div[role="button"], button, a'
            )).filter(el => visible(el) && isAuth(el.getAttribute('aria-label') || el.innerText || ''));
            cands.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
            if (cands[0]) {
              const el = cands[0].closest('[data-challengeid], [data-challengetype], li, [role="link"], [role="button"], button, a') || cands[0];
              return { action: 'auth-app', ...center(el), text: (el.innerText || '').slice(0, 80) };
            }
          }
          return { action: 'none', path: location.pathname };
        })()`);
        console.log('[AppShell] 2FA helper:', twoFa);
        if (twoFa && (twoFa.action === 'try-another' || twoFa.action === 'auth-app') && twoFa.x > 0 && twoFa.y > 0) {
          const clickKey = 'cdp|' + twoFa.action + '|' + href.split('?')[0];
          if (this._lastCdpClickKey !== clickKey || Date.now() - (this._lastCdpClickAt || 0) > 1400) {
            this._lastCdpClickKey = clickKey;
            this._lastCdpClickAt = Date.now();
            window.chrome?.webview?.postMessage(JSON.stringify({
              type: 'cmd',
              cmd: 'cdpClick',
              x: twoFa.x,
              y: twoFa.y
            }));
          }
        }
      } catch (err) {
        console.warn('[AppShell] 2FA selection helper:', err.message);
      }
      return;
    }

    // Fill email/password — fire-and-forget so 2FA helpers never block the next pwd tick
    // Skip entirely while OTP UI is active — re-submitting password bounces the flow
    if (this._totpFilling || onTotpPath) {
      this.pushTotpFromBackend();
      return;
    }
    const onPwd = /challenge\/pwd/i.test(href);
    const gap = onPwd ? 2000 : 1800;
    const pathKey = href.split('?')[0];
    if (this._lastFillPath !== pathKey) {
      this._lastFillPath = pathKey;
      this._lastDirectFillAt = 0;
    }
    if (!this._lastDirectFillAt || now - this._lastDirectFillAt > gap) {
      this._lastDirectFillAt = now;
      Promise.all([this.resolveGoogleEmailForFill(), this.resolveGooglePasswordForFill()])
        .then(([email, password]) => {
          this.fillGoogleLoginFields({ email: email || '', password: password || '' }).catch(() => {});
        })
        .catch(() => {});
    }
  }

  async ensureCredChannel() {
    if (!window.FlowCredChannel) throw new Error('FlowCredChannel missing');
    if (window.FlowCredChannel.channelId && window.FlowCredChannel.aesCryptoKey) return;
    if (!this.config?.authToken || !this.config?.serverUrl) throw new Error('Not logged in');
    const clientPublicKey = await window.FlowCredChannel.generateClientPublicKey();
    const res = await fetch(`${this.config.serverUrl}${CLIENT_API}/channel-open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.authToken}`
      },
      body: JSON.stringify({ clientPublicKey })
    });
    const data = await res.json().catch(() => ({}));
    if (!data?.success || !data.channel) {
      throw new Error((data && data.error) || 'channel-open failed');
    }
    const serverTimeMs = typeof data.serverTime === 'number' ? data.serverTime : (data.serverTime ? Date.parse(data.serverTime) : undefined);
    await window.FlowCredChannel.establish(data.channel.channelId, data.channel.serverPublicKey, serverTimeMs);
    this._credAttemptId = null;
    this._credUsedStages = new Set();
    this._googlePasswordMem = null;
  }

  /**
   * 60 min Google session lock (PER SERVER ACCOUNT). The SERVER owns the clock:
   * we keep monotonic countdowns keyed by serverId so logging into Server 1
   * locks only Server 1 while allowing Server 2 / Image Server 1 to log in.
   */
  noteGoogleLock(data, explicitServerId = '') {
    if (!this._googleServerLocksMono) this._googleServerLocksMono = {};
    const nowMono = performance.now();
    if (data && data.googleServerLocks && typeof data.googleServerLocks === 'object') {
      const serverTimeMs = data.serverTime ? Date.parse(data.serverTime) : Date.now();
      const nextMap = {};
      for (const [sid, info] of Object.entries(data.googleServerLocks)) {
        let s = Number(info && info.retryAfterSeconds);
        if (!Number.isFinite(s) && info && info.lockedUntil) {
          s = (Date.parse(info.lockedUntil) - serverTimeMs) / 1000;
        } else if (!Number.isFinite(s) && typeof info === 'string') {
          s = (Date.parse(info) - serverTimeMs) / 1000;
        }
        if (Number.isFinite(s) && s > 0) {
          nextMap[sid] = nowMono + s * 1000;
        }
      }
      this._googleServerLocksMono = nextMap;
    }
    const targetSrvId = String(
      explicitServerId || (data && data.serverId) || (data && data.activeServerId) || (this.activeServer && this.activeServer.id) || ''
    ).trim();
    if (targetSrvId) {
      let secs = Number(data && (data.retryAfterSeconds ?? data.googleSessionRetryAfterSeconds));
      if (!Number.isFinite(secs) && data && data.lockedUntil && data.serverTime) {
        secs = (Date.parse(data.lockedUntil) - Date.parse(data.serverTime)) / 1000;
      }
      if (Number.isFinite(secs)) {
        if (secs <= 0) {
          delete this._googleServerLocksMono[targetSrvId];
        } else {
          this._googleServerLocksMono[targetSrvId] = nowMono + secs * 1000;
        }
      }
    }
    this.renderLockPill();
  }

  googleLockRemainingMs(serverId = '') {
    if (!this._googleServerLocksMono) return 0;
    const sid = String(serverId || (this.activeServer && this.activeServer.id) || '').trim();
    if (!sid) return 0;
    const endMono = this._googleServerLocksMono[sid];
    if (!endMono) return 0;
    return Math.max(0, endMono - performance.now());
  }

  resetGoogleLockState() {
    this._googleServerLocksMono = {};
    this._googleLockEndMono = 0;
    this._lockNotifyAt = 0;
    this._credFailUntil = 0;
    this.renderLockPill();
  }

  /** Apply lock fields from any server user payload (login, verify-session, /me). */
  applyLockFromUser(user) {
    if (!user) return;
    if (user.googleServerLocks && typeof user.googleServerLocks === 'object') {
      this.noteGoogleLock(user, user.activeServerId || (this.activeServer && this.activeServer.id) || '');
      return;
    }
    if (user.googleSessionRetryAfterSeconds === undefined) return;
    this.noteGoogleLock(
      { retryAfterSeconds: user.googleSessionRetryAfterSeconds },
      user.activeServerId || (this.activeServer && this.activeServer.id) || ''
    );
  }

  googleLockMessage(data) {
    const secs = Math.max(
      0,
      Number(data && data.retryAfterSeconds) || Math.ceil(this.googleLockRemainingMs(data && data.serverId) / 1000)
    );
    const mins = Math.max(1, Math.ceil(secs / 60));
    return `This account is locked for about ${mins} more minute${mins === 1 ? '' : 's'}. You can switch to another server or wait for the timer.`;
  }

  renderLockPill() {
    const pill = document.getElementById('pill-lock');
    const val = document.getElementById('lock-val');
    if (!pill || !val) return;
    const ms = this.googleLockRemainingMs();
    if (ms <= 0) {
      pill.classList.add('hidden');
      if (this._lockTicker) { clearInterval(this._lockTicker); this._lockTicker = null; }
      return;
    }
    const total = Math.ceil(ms / 1000);
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    val.textContent = `${mm}:${ss}`;
    pill.classList.remove('hidden');
    if (!this._lockTicker) {
      this._lockTicker = setInterval(() => this.renderLockPill(), 1000);
    }
  }

  /**
   * Tell the server how the Google login ended (success starts the 60 min lock,
   * cancelled/failed closes the attempt so admin never sees it stuck "in progress").
   */
  async reportGoogleFinish(outcome, opts = {}) {
    const attemptId = this._finishAttemptId || (opts.forceLock ? 'restored-session' : null);
    if (!attemptId || !this.config?.authToken || !this.config?.serverUrl) return;
    this._finishAttemptId = null;
    try {
      const res = await fetch(`${this.config.serverUrl}${CLIENT_API}/extension-finish`, {
        method: 'POST',
        keepalive: !!opts.keepalive,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.authToken}`
        },
        body: JSON.stringify({ attemptId, outcome, serverId: this.activeServer?.id || null })
      });
      const data = await res.json().catch(() => ({}));
      if (outcome === 'success' && data && data.user) this.applyLockFromUser(data.user);
    } catch (e) {}
  }

  /** Landed on Flow/Gemini after the credential steps ran => Google login completed. */
  maybeReportGoogleSuccess(url) {
    if (!this._finishAttemptId) return;
    const href = String(url || '');
    const onGoogleAuth = (u) => u.includes('accounts.google.com') || u.includes('accounts.youtube.com');
    const onFlow = (u) => u.includes('flow.google.com') || u.includes('labs.google') || u.includes('gemini.google.com');
    // Still inside Google sign-in (OTP / 2FA / challenge): never finish, drop any pending finish.
    if (onGoogleAuth(href)) {
      if (this._finishTimer) { clearTimeout(this._finishTimer); this._finishTimer = null; }
      return;
    }
    if (!onFlow(href)) return;
    if (this._finishTimer) clearTimeout(this._finishTimer);
    // Flow is also touched mid-login (continue= bounce) before Google asks for the OTP.
    // Require the page to STAY on Flow: short settle when the OTP was already used,
    // long settle otherwise (Google may still redirect to the 2FA challenge).
    const settleMs = this._credUsedStages?.has('otp') ? 2500 : 8000;
    this._finishTimer = setTimeout(() => {
      this._finishTimer = null;
      const cur = String(this.webview?.src || '');
      if (onGoogleAuth(cur) || !onFlow(cur)) return;
      this.reportGoogleFinish('success');
    }, settleMs);
  }

  async ensureCredAttempt() {
    await this.ensureCredChannel();
    const curSrvId = (this.activeServer && this.activeServer.id) || '';
    if (this._credAttemptId && this._googleCredServerId === curSrvId) return this._credAttemptId;
    this._googleCredServerId = curSrvId;
    const res = await fetch(`${this.config.serverUrl}${CLIENT_API}/extension-start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.authToken}`
      },
      body: JSON.stringify({
        channelId: window.FlowCredChannel.channelId,
        serverId: curSrvId || null
      })
    });
    const data = await res.json().catch(() => ({}));
    if (data && data.serverTime) {
      const stMs = typeof data.serverTime === 'number' ? data.serverTime : Date.parse(data.serverTime);
      if (Number.isFinite(stMs)) await window.FlowCredChannel.setServerTime?.(stMs);
    }
    if (data && data.code === 'GOOGLE_SESSION_LOCKED') {
      this.noteGoogleLock(data);
      if (!this._lockNotifyAt || Date.now() - this._lockNotifyAt > 30000) {
        this._lockNotifyAt = Date.now();
        this.notify(this.googleLockMessage(data), true);
      }
      this._credFailUntil = Date.now() + Math.max(this.googleLockRemainingMs(), 1000);
      throw new Error(this.googleLockMessage(data));
    }
    if (!data?.attemptId) throw new Error((data && data.error) || 'extension-start failed');
    this._credAttemptId = data.attemptId;
    this._finishAttemptId = data.attemptId;
    this._credUsedStages = new Set();
    return this._credAttemptId;
  }

  async fetchGoogleCredential(stage, _retriedClock = false, _retriedAttempt = false) {
    if (!this.config?.authToken || !this.config?.serverUrl) return '';
    // 60 min Google lock: do not hit extension-start/step until it ends (no retry spam).
    if (this.googleLockRemainingMs() > 0 && !this._credAttemptId) return '';
    try {
      // Same stage already sealed in this attempt ? do not spam extension-start (except otp retry).
      if (stage !== 'otp' && this._credUsedStages?.has(stage)) {
        if (stage === 'email' && this._googleEmailMem) return this._googleEmailMem;
        if (stage === 'password' && this._googlePasswordMem) return this._googlePasswordMem;
        return '';
      }
      const attemptId = await this.ensureCredAttempt();
      const { ts, mac } = await window.FlowCredChannel.mac(attemptId, stage);
      const res = await fetch(`${this.config.serverUrl}${CLIENT_API}/extension-step`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.authToken}`
        },
        body: JSON.stringify({
          attemptId,
          stage,
          channelId: window.FlowCredChannel.channelId,
          ts,
          mac
        })
      });
      const data = await res.json().catch(() => ({}));
      if (data && data.code === 'BAD_MAC' && data.serverTime && !_retriedClock) {
        const stMs = typeof data.serverTime === 'number' ? data.serverTime : Date.parse(data.serverTime);
        if (Number.isFinite(stMs)) {
          await window.FlowCredChannel.setServerTime?.(stMs);
          return this.fetchGoogleCredential(stage, true, _retriedAttempt);
        }
      }
      if (data && data.sealed && data.ciphertext) {
        const plain = await window.FlowCredChannel.decryptSealed(data);
        const value = String(plain || '');
        if (this._credUsedStages) this._credUsedStages.add(stage);
        if (stage === 'email' && value) this._googleEmailMem = value;
        if (stage === 'password' && value) this._googlePasswordMem = value;
        if (stage === 'otp' && value) {
          this._lastOtpCode = value;
          this._lastOtpFetchedAt = Date.now();
          this._lastOtpExpiresAt = Number(data.expiresAt) || (Date.now() + 18000);
        }
        return value;
      }
      if (data && data.code === 'GOOGLE_SESSION_LOCKED') {
        this.noteGoogleLock(data);
        return '';
      }
      if ((res.status === 401 || (data && data.code === 'CHANNEL_REQUIRED')) && !_retriedAttempt) {
        console.warn('[AppShell] Credential channel expired — reopening channel for stage:', stage);
        if (window.FlowCredChannel) {
          window.FlowCredChannel.channelId = null;
          window.FlowCredChannel.aesCryptoKey = null;
        }
        this._credAttemptId = null;
        this._credUsedStages = new Set();
        return this.fetchGoogleCredential(stage, _retriedClock, true);
      }
      if ((res.status === 400 || res.status === 403 || res.status === 404) && !_retriedAttempt) {
        const errMsg = String((data && data.error) || '');
        if (!/not configured/i.test(errMsg)) {
          console.warn('[AppShell] Credential attempt stale/exhausted — opening fresh attempt for stage:', stage, errMsg);
          this._credAttemptId = null;
          this._credUsedStages = new Set();
          return this.fetchGoogleCredential(stage, _retriedClock, true);
        }
      }
      // Legacy plaintext must never be accepted
      if (data && data.value) {
        console.warn('[AppShell] Rejected plaintext credential response');
      }
      console.warn('[AppShell] credential not available:', stage, (data && data.error) || res.status);
    } catch (err) {
      console.warn('[AppShell] credential fetch failed:', stage, err.message);
      // Back off before opening a new attempt (avoids 1/sec start spam in Activity).
      const now = Date.now();
      if (!this._credFailUntil || now > this._credFailUntil) {
        this._credFailUntil = now + 4000;
        this._credAttemptId = null;
      }
    }
    return '';
  }

  async resolveGoogleEmailForFill() {
    const curSrvId = (this.activeServer && this.activeServer.id) || '';
    if (this._googleCredServerId !== curSrvId) {
      this._googleEmailMem = '';
      this._googlePasswordMem = '';
      this._credAttemptId = null;
      this._credUsedStages = new Set();
      this._googleCredServerId = curSrvId;
    }
    if (this._googleEmailMem) return this._googleEmailMem;
    const email = await this.fetchGoogleCredential('email');
    if (email) this._googleEmailMem = email;
    return email || '';
  }

  /** Fetch Google password from API into memory only (never from activeServer JSON). */
  async resolveGooglePasswordForFill() {
    const curSrvId = (this.activeServer && this.activeServer.id) || '';
    if (this._googleCredServerId !== curSrvId) {
      this._googleEmailMem = '';
      this._googlePasswordMem = '';
      this._credAttemptId = null;
      this._credUsedStages = new Set();
      this._googleCredServerId = curSrvId;
    }
    if (this._googlePasswordMem) return this._googlePasswordMem;
    const fromApi = await this.fetchGoogleCredential('password');
    if (fromApi) return fromApi;
    return '';
  }

  async pushTotpFromBackend(forceFresh = false) {
    const now = Date.now();
    if (!forceFresh && this._otpPushAt && now - this._otpPushAt < 1200) return;
    this._otpPushAt = now;
    this._totpFilling = true;
    this.postAuthOverlay({ show: true, captcha: false });
    if (!this.config?.authToken) return;
    let otp = '';
    const canReuseCached =
      !forceFresh &&
      this._lastOtpCode &&
      (now - (this._lastOtpFetchedAt || 0) < 12000) &&
      (!this._lastOtpExpiresAt || now < this._lastOtpExpiresAt - 4000);
    if (canReuseCached) {
      otp = this._lastOtpCode;
    } else {
      otp = await this.fetchGoogleCredential('otp');
    }
    if (!otp) return;
    console.log('[AppShell] Pushing backend TOTP, len', otp.length, canReuseCached ? '(cached)' : '(fresh)');
    try { this.webview.send('apply-otp', { otp }); } catch (err) {}
    window.chrome?.webview?.postMessage(JSON.stringify({
      type: 'cmd',
      cmd: 'fillOtp',
      otp
    }));
  }

  async fetchAndSendOtp() {
    return this.pushTotpFromBackend();
  }

  showWebviewError(message, url) {
    this.showLoadingOverlay(
      'Workspace failed to load',
      `${message}${url ? ` — ${url}` : ''}. Use Reload or switch server.`,
      8000
    );
  }

  reloadWebview() {
    this.showLoadingOverlay('Reloading Session...', 'Refreshing current Flow workspace', 1500);
    try {
      this.webview.reload();
    } catch (err) {
      console.error('Reload error:', err);
    }
  }

  // Zoom Controls
  adjustZoom(delta) {
    this.zoomFactor = Math.max(0.5, Math.min(2.0, this.zoomFactor + delta));
    this.applyZoom();
  }

  resetZoom() {
    this.zoomFactor = 1.0;
    this.applyZoom();
  }

  applyZoom() {
    this.zoomLevelText.textContent = `${Math.round(this.zoomFactor * 100)}%`;
    try {
      this.webview.setZoomFactor(this.zoomFactor);
    } catch (err) {
      console.error('Error setting zoom:', err);
    }
  }

  // Credit Deduction
  async handleCreditDeduction(eventData) {
    try {
      console.log('[AppShell] Initiating credit deduction:', eventData);
      const res = await fetch(`${this.config.serverUrl}${CLIENT_API}/use-credit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.authToken}`
        },
        body: JSON.stringify({
          amount: eventData.amount || 1,
          reason: eventData.reason || 'generation'
        })
      });
      const data = await res.json().catch(() => ({}));
      console.log('[AppShell] Credit deduction response:', data);
      if (data && data.success) {
        if (!this.currentUser) this.currentUser = {};
        this.currentUser.credits = data.credits;
        this.updateToolbarUserInfo();
        if (data.code === 'NO_CREDITS' || (Number(data.credits) || 0) <= 0) {
          await this.forceLogout(data.error || 'You have no credits left. Please renew and sign in again.');
        }
      } else if (data && data.code === 'FORCE_UPDATE') {
        const switched = await maybeSwitchClientApiOnForceUpdate(this.config.serverUrl, data);
        if (switched) {
          return this.handleCreditDeduction(eventData);
        }
        await this.forceLogout(data.error || 'Please download the latest Flow Browser.');
      } else if (data && (data.code === 'NO_CREDITS' || data.code === 'BANNED' || data.code === 'SESSION_REPLACED' || data.code === 'PLAN_EXPIRED')) {
        await this.forceLogout(data.error || 'Please sign in again.');
      } else if (!data?.success && (res.status === 401 || res.status === 403)) {
        // Ban/disable during generation — logout immediately even if code missing
        await this.forceLogout((data && data.error) || 'Your account is no longer active. Please sign in again.');
      }
    } catch (err) {
      console.error('Credit sync error:', err);
    }
  }

  // Credit Refund (for failed generations)
  async handleCreditRefund(eventData) {
    try {
      const amount = Math.max(1, Number(eventData && eventData.amount) || 1);
      console.log('[AppShell] Initiating credit refund:', eventData);
      if (this.currentUser) {
        this.currentUser.credits = (Number(this.currentUser.credits) || 0) + amount;
        this.updateToolbarUserInfo();
      }
      const res = await fetch(`${this.config.serverUrl}${CLIENT_API}/refund-credit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.authToken}`
        },
        body: JSON.stringify({
          amount: amount,
          reason: (eventData && eventData.reason) || 'generation_failed_refund'
        })
      });
      if (res && res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data && data.success && data.credits !== undefined) {
          if (!this.currentUser) this.currentUser = {};
          this.currentUser.credits = data.credits;
          this.updateToolbarUserInfo();
        }
      }
    } catch (err) {
      console.warn('[AppShell] Refund sync note:', err.message);
    }
  }

  // Downloads Management
  onDownloadStarted(data) {
    this.downloads.unshift({
      filename: data.filename,
      totalBytes: Number(data.totalBytes) || 0,
      receivedBytes: Number(data.receivedBytes) || 0,
      state: 'progressing',
      savePath: data.savePath || null
    });
    this.updateDownloadsUI();
  }

  onDownloadProgress(data) {
    const item = this.downloads.find(d => (data.savePath && d.savePath === data.savePath) || d.filename === data.filename);
    if (item) {
      item.receivedBytes = Number(data.receivedBytes) || 0;
      if (Number(data.totalBytes) > 0) item.totalBytes = Number(data.totalBytes);
      if (data.savePath) item.savePath = data.savePath;
      this.updateDownloadsUI();
    }
  }

  onDownloadCompleted(data) {
    const item = this.downloads.find(d => (data.savePath && d.savePath === data.savePath) || d.filename === data.filename);
    if (item) {
      item.state = 'completed';
      item.savePath = data.savePath || item.savePath;
      if (Number(data.receivedBytes) > 0) item.receivedBytes = Number(data.receivedBytes);
      if (Number(data.totalBytes) > 0) item.totalBytes = Number(data.totalBytes);
      this.updateDownloadsUI();
    } else if (data && data.filename) {
      this.downloads.unshift({
        filename: data.filename,
        totalBytes: Number(data.totalBytes) || 0,
        receivedBytes: Number(data.receivedBytes) || 0,
        state: 'completed',
        savePath: data.savePath || null
      });
      this.updateDownloadsUI();
    }
  }

  onDownloadFailed(data) {
    const item = this.downloads.find(d => d.filename === data.filename);
    if (item) {
      item.state = 'failed';
      this.updateDownloadsUI();
    }
  }

  formatDownloadBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n <= 0) return '0 B';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  updateDownloadsUI() {
    const activeCount = this.downloads.filter(d => d.state === 'progressing').length;
    if (activeCount > 0) {
      this.downloadBadge.textContent = activeCount;
      this.downloadBadge.classList.remove('hidden');
    } else {
      this.downloadBadge.classList.add('hidden');
    }

    if (this.downloads.length === 0) {
      this.downloadsList.innerHTML = '<p class="empty-text">No active or recent downloads</p>';
      return;
    }

    this.downloadsList.innerHTML = this.downloads.map((item, idx) => {
      const pct = item.totalBytes > 0 ? Math.min(100, Math.round((item.receivedBytes / item.totalBytes) * 100)) : 0;
      const sizeInfo = item.totalBytes > 0
        ? `${this.formatDownloadBytes(item.receivedBytes)} / ${this.formatDownloadBytes(item.totalBytes)}`
        : (item.receivedBytes > 0 ? this.formatDownloadBytes(item.receivedBytes) : '');
      let statusText = `${pct}%${sizeInfo ? ' • ' + sizeInfo : ''}`;
      let actionBtn = '';
      const canDrag = item.state === 'completed' && !!item.savePath;

      if (item.state === 'completed') {
        statusText = `<span style="color:#34d399;font-weight:600;">Ready • Drag to Flow</span>`;
        actionBtn = `
          <div style="display:flex;gap:6px;align-items:center;">
            <button class="btn-open-file" onclick="app.openDownloadedFileByIndex(${idx})">Open</button>
            <button class="btn-open-file" onclick="app.showDownloadedFileByIndex(${idx})">Folder</button>
          </div>
        `;
      } else if (item.state === 'failed') {
        statusText = '<span style="color:#f87171;">Failed</span>';
      }

      return `
        <div class="download-item" ${canDrag ? `draggable="true" ondragstart="app.handleDownloadDragStart(event, ${idx})" style="cursor:grab;" title="Drag directly into Flow workspace"` : ''}>
          <div class="download-filename" title="${item.filename}">${item.filename}</div>
          <div class="download-progress-bar">
            <div class="download-progress-fill" style="width: ${item.state === 'completed' ? '100%' : pct + '%'}"></div>
          </div>
          <div class="download-status-line">
            <span>${statusText}</span>
            ${actionBtn}
          </div>
        </div>
      `;
    }).join('');
  }

  handleDownloadDragStart(event, idx) {
    const item = this.downloads && this.downloads[idx];
    if (!item || !item.savePath) return;
    if (event && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    // Hide the downloads drawer immediately so FlowView is uncovered to receive the drop
    if (this.downloadDrawer) {
      this.downloadDrawer.classList.add('hidden');
    }
    this.syncShellModeFromUi();
    window.electronAPI.startFileDrag?.(item.savePath);
  }

  openDownloadedFileByIndex(idx) {
    const item = this.downloads && this.downloads[idx];
    if (item && item.savePath) {
      window.electronAPI.openDownloadedFile?.(item.savePath);
    }
  }

  showDownloadedFileByIndex(idx) {
    const item = this.downloads && this.downloads[idx];
    if (item && item.savePath) {
      window.electronAPI.showInFolder(item.savePath);
    }
  }

  showDownloadedFile(filePath) {
    if (filePath) {
      window.electronAPI.showInFolder(filePath);
    }
  }

  showLoadingOverlay(title = 'Loading...', sub = 'Please wait', maxDurationMs = 2500) {
    this.overlayTitle.textContent = title;
    this.overlaySub.textContent = sub;
    this.loadingOverlay.classList.remove('hidden');
    // Keep Flow WebView visible during loads (shellMode stays chrome unless login/drawer)

    if (this._overlayTimeout) clearTimeout(this._overlayTimeout);
    this._overlayTimeout = setTimeout(() => {
      this.hideLoadingOverlay();
    }, maxDurationMs);
  }

  hideLoadingOverlay() {
    if (this._overlayTimeout) {
      clearTimeout(this._overlayTimeout);
      this._overlayTimeout = null;
    }
    this.loadingOverlay.classList.add('hidden');
    this.syncShellModeFromUi();
  }

  showGoogleAuthBanner(text, captcha = false) {
    if (!this.googleAuthBanner || !this.googleAuthBannerText) return;
    // Keep URL bar visible during normal Google login; only show top banner if captcha is active
    if (!captcha) {
      this.googleAuthBanner.classList.add('hidden');
      return;
    }
    this.googleAuthBannerText.textContent = text;
    this.googleAuthBanner.classList.toggle('captcha', true);
    this.googleAuthBanner.classList.remove('hidden');
  }

  hideGoogleAuthBanner() {
    if (!this.googleAuthBanner) return;
    this.googleAuthBanner.classList.add('hidden');
    this.googleAuthBanner.classList.remove('captcha');
    this._captchaActive = false;
    this._totpFilling = false;
  }

  /** Max 10s sticky overlay after landing on Flow workspace post-login. */
  scheduleFlowOverlayMaxDone() {
    if (this._flowOverlayMaxTimer) return;
    this._flowOverlayMaxTimer = setTimeout(() => {
      this._flowOverlayMaxTimer = null;
      this._pendingFreshLogin = false;
      this._freshLoginStarted = true;
      this._totpFilling = false;
      this.hideGoogleAuthBanner();
      this.hideLoadingOverlay();
      this.postAuthOverlay({ show: false, done: true });
      console.log('[AppShell] Flow page held 10s ? forcing overlay done');
    }, 10000);
  }

  cancelFlowOverlayMaxDone() {
    if (!this._flowOverlayMaxTimer) return;
    clearTimeout(this._flowOverlayMaxTimer);
    this._flowOverlayMaxTimer = null;
  }

  /** Drive native WPF/Android auth cover (WebView2 page overlays cannot mask Google login). */
  postAuthOverlay(opts = {}) {
    if (DEBUG_DISABLE_AUTH_OVERLAY) {
      // Force cover off during manual debug
      opts = { show: false, captcha: false, done: !!opts.done };
    }
    try {
      window.chrome?.webview?.postMessage(JSON.stringify({
        type: 'cmd',
        cmd: 'authOverlay',
        show: !!opts.show,
        captcha: !!opts.captcha,
        done: !!opts.done
      }));
    } catch (e) {}
    // Persist Google cookies to disk when sign-in finishes (critical on Android phones)
    if (opts && opts.done) {
      this.cancelFlowOverlayMaxDone();
      try {
        window.chrome?.webview?.postMessage(JSON.stringify({ type: 'cmd', cmd: 'flushCookies' }));
      } catch (e) {}
    }
  }

  onCaptchaState(data) {
    const active = !!(data && data.active);
    this._captchaActive = active;
    if (active) {
      this.hideLoadingOverlay();
      this.showGoogleAuthBanner('Please solve the captcha below', true);
      this.postAuthOverlay({ show: false, captcha: true });
    } else {
      this.showGoogleAuthBanner('Captcha done — continuing sign-in…', false);
      this.postAuthOverlay({ show: true, captcha: false });
      setTimeout(() => this.sendCredentialsToWebview(false), 400);
    }
  }

  onAutoLoginState(data) {
    if (!data) return;
    if (data.done) {
      this.cancelFlowOverlayMaxDone();
      this.hideGoogleAuthBanner();
      this.hideLoadingOverlay();
      this._totpFilling = false;
      this._pendingFreshLogin = false;
      this._freshLoginStarted = true;
      this.postAuthOverlay({ show: false, done: true });
      return;
    }
    if (data.captcha) {
      this._captchaActive = true;
      this._totpFilling = false;
      this.hideLoadingOverlay();
      this.showGoogleAuthBanner('Please solve the captcha below', true);
      this.postAuthOverlay({ show: false, captcha: true });
      return;
    }
    if (data.overlay) {
      this._captchaActive = false;
      this.showGoogleAuthBanner('Signing you in automatically…', false);
      this.postAuthOverlay({ show: true, captcha: false });
      return;
    }
    if (data.watching) {
      this.showGoogleAuthBanner('Watching Google sign-in — automation still running', false);
      this.postAuthOverlay({ show: true, captcha: false });
    }
  }
}

/** Show the real EXE version under the app name (from the host, not hardcoded). */
async function showAppVersion() {
  try {
    const el = document.getElementById('toolbar-app-version');
    if (!el) return;
    const dev = window.electronAPI && typeof window.electronAPI.getDeviceId === 'function'
      ? await window.electronAPI.getDeviceId()
      : null;
    const v = (dev && (dev.version || String(dev.client || '').split('/')[1])) || '';
    el.textContent = v ? 'v' + v : '';
    const loginEl = document.getElementById('login-app-version');
    if (loginEl) loginEl.textContent = v ? 'Version ' + v : '';
  } catch (e) {}
}

let app;
function initApp() {
  if (!app) {
    console.log('[App] Initializing FlowBrowserApp...');
    app = new FlowBrowserApp();
    window.app = app; // for CDP debugging / server switch tests
    showAppVersion();
    setTimeout(showAppVersion, 1500);
    const cancelOnExit = () => {
      try { app.reportGoogleFinish('cancelled', { keepalive: true }); } catch (e) {}
    };
    window.addEventListener('pagehide', cancelOnExit);
    window.addEventListener('beforeunload', cancelOnExit);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
})();
