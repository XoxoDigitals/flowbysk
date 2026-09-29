// Flow Browser App Shell Controller

/** Active client API base — resolved from /api/public/branding (v2 or v3). */
let CLIENT_API = '/api/v2/client';

function normalizeClientApiVersion(value) {
  return String(value || '').toLowerCase() === 'v3' ? 'v3' : 'v2';
}

async function resolveClientApiBase(serverUrl, force = false) {
  const base = String(serverUrl || '').replace(/\/$/, '') || 'https://flowcreatorai.site';
  try {
    const res = await fetch(`${base}/api/public/branding`, { cache: 'no-store' });
    const data = await res.json();
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

class FlowBrowserApp {
  constructor() {
    this.config = null;
    this.currentUser = null;
    this.currentServers = [];
    this.activeServer = null;
    this.settings = null;
    this.zoomFactor = 1.0;
    this.downloads = [];

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

    // Extension events
    if (this.btnToggleExtension) {
      this.btnToggleExtension.addEventListener('click', () => {
        this.extensionDrawer.classList.toggle('hidden');
        if (!this.extensionDrawer.classList.contains('hidden')) {
          const url = 'http://flowbrowser.local/extensions/veo-shio-auto-login/popup.html';
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

    // Veo Auto events
    if (this.btnToggleVeoAuto) {
      this.btnToggleVeoAuto.addEventListener('click', () => {
        this.veoAutoDrawer.classList.toggle('hidden');
        if (!this.veoAutoDrawer.classList.contains('hidden')) {
          const url = 'http://flowbrowser.local/extensions/veo-auto/src/ui/side-panel/index.html';
          // Bust cache so chrome-polyfill + panel reload after updates
          const bust = url + '?v=' + Date.now();
          this.veoAutoWebview.src = bust;
          window.electronAPI.setShellMode?.('full');
        } else {
          this.syncShellModeFromUi();
        }
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
      } else if (event.channel === 'request-credentials') {
        this.sendCredentialsToWebview();
      } else if (event.channel === 'request-otp') {
        this.fetchAndSendOtp();
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
    });

    this.webview.addEventListener('did-navigate-in-page', (e) => {
      this.updateDebugUrl(e.url);
      this.tryGoogleAutoFill(e.url);
      this.maybeFinishGoogleCheckCookie(e.url);
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

        if (activeSrv?.id) {
          await this.launchServerWorkspace(activeSrv.id, wiped);
        } else if (wiped) {
          this.notify('No shared Google accounts available', true);
        }
        return true;
      } else {
        const code = data && data.code;
        if (code === 'FORCE_UPDATE') {
          const switched = await maybeSwitchClientApiOnForceUpdate(this.config.serverUrl, data);
          if (switched) return this.verifyExistingSession();
          await this.forceLogout(data.error || 'Please download the latest Flow Browser.');
          return false;
        }
        if (code === 'SESSION_REPLACED' || code === 'NO_CREDITS' || code === 'BANNED' || code === 'PLAN_EXPIRED') {
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
      const res = await fetch(`${serverUrl}${CLIENT_API}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      let data = await res.json();

      if ((!data || !data.success) && data && data.code === 'FORCE_UPDATE') {
        const switched = await maybeSwitchClientApiOnForceUpdate(serverUrl, data);
        if (switched) {
          const retry = await fetch(`${serverUrl}${CLIENT_API}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
          });
          data = await retry.json();
        }
      }

      if (data && data.success) {
        // Snapshot BEFORE overwriting — used to detect removed Google assignments
        const prevAssignment = this.config?.activeServer || this.activeServer;

        this.currentUser = data.user;
        this.currentServers = data.servers;
        this.settings = data.settings;
        this.activeServer = sanitizeServerForStorage(data.activeServer);

        // Save session — never persist Google password
        await window.electronAPI.saveSession({
          token: data.token,
          user: data.user,
          activeServer: sanitizeServerForStorage(data.activeServer)
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
        if (mustWipe) {
          if (data.activeServer?.id) {
            await this.launchServerWorkspace(data.activeServer.id, true);
          } else {
            await this.requestBalancedServerAndLaunch(false);
            if (this.activeServer?.id) await this.launchServerWorkspace(this.activeServer.id, true);
          }
        } else {
          await this.requestBalancedServerAndLaunch();
        }
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
    // Remeasure toolbar now that login chrome is gone
    try {
      window.electronAPI?.setShellMode?.('chrome');
    } catch (e) {}
  }

  showLoginScreen() {
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
    const drawerOpen = [this.downloadDrawer, this.extensionDrawer, this.veoAutoDrawer]
      .some((d) => d && !d.classList.contains('hidden'));
    // Do not treat loading overlay as full — collapsing Flow aborts navigations
    window.electronAPI.setShellMode?.(
      loginVisible || drawerOpen || settingsOpen || confirmOpen ? 'full' : 'chrome'
    );
  }

  async forceLogout(message) {
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
      this.notify('Cookies cleared — signing in fresh…');

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
    const reassigned = !!(prevId && nextId && prevId !== nextId);
    const emailChanged = !!(prevEmail && nextEmail && prevEmail !== nextEmail);
    // Do NOT wipe solely because there was no prior assignment — that forced
    // AddSession on every cold login and fought OAuth return (Google login loop).

    const mustWipe = prevIdMissing || reassigned || emailChanged;
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
          code === 'PLAN_EXPIRED'
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
      }
      const purged = await this.purgeStaleAssignedAccount(data.servers, data.activeServer);
      if (!purged) {
        if (data.activeServer) this.activeServer = sanitizeServerForStorage(data.activeServer);
        this.populateServerSelect(data.servers || []);
        return;
      }

      if (data.activeServer?.id) {
        await this.launchServerWorkspace(data.activeServer.id, true);
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

  updateToolbarUserInfo() {
    if (!this.currentUser) return;
    // Negative credits allowed server-side — UI shows/gates as 0
    const raw = Number(this.currentUser.credits);
    const shown = Number.isFinite(raw) ? Math.max(0, raw) : 0;
    this.creditsVal.textContent = shown.toLocaleString();

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

  populateServerSelect(servers = []) {
    this.serverSelect.innerHTML = '';
    if (servers.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Default Node';
      this.serverSelect.appendChild(opt);
      this.setAccountName('Account');
      return;
    }

    servers.forEach(srv => {
      const opt = document.createElement('option');
      opt.value = srv.id;
      opt.textContent = srv.name;
      this.serverSelect.appendChild(opt);
    });
    const current = this.activeServer && servers.find(s => s.id === this.activeServer.id);
    this.setAccountName((current && current.name) || (this.activeServer && this.activeServer.name) || servers[0].name);
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
    await this.launchServerWorkspace(serverId);
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
      if (data && data.success && data.server) {
        console.log('[AppShell] Load-balanced server:', data.server.name, data.server.email, data.load);
        if (fromButton && this.activeServer && data.server.id === this.activeServer.id) {
          this.notify('Already on the least-used account (' + data.server.name + ')');
          if (this.serverSelect) this.serverSelect.value = data.server.id;
          this.setAccountName(data.server.name);
          return;
        }
        await this.launchServerWorkspace(data.server.id, fromButton);
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
      if (this.activeServer?.id) await this.launchServerWorkspace(this.activeServer.id);
      else this.loadTargetInWebview('https://flow.google.com/');
    }
  }

  async launchServerWorkspace(serverId, resetGoogle = false) {
    this.showLoadingOverlay(
      resetGoogle ? 'Switching account...' : 'Opening Flow...',
      resetGoogle ? 'Starting a fresh Google sign-in' : 'Keeping your Google session'
    );

    try {
      const res = await fetch(`${this.config.serverUrl}${CLIENT_API}/switch-server`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.authToken}`
        },
        body: JSON.stringify({ serverId })
      });
      const data = await res.json();
      if (data && data.success) {
        const previousEmail = this.activeServer?.email || '';
        this.activeServer = sanitizeServerForStorage(data.server);
        this.serverSelect.value = data.server.id;
        this.setAccountName(data.server.name);
        this._lastAutoFillKey = null;
        this._lastAutoFillAt = 0;

        if (this.config?.authToken && this.config?.user) {
          await window.electronAPI.saveSession({
            token: this.config.authToken,
            user: this.config.user,
            activeServer: sanitizeServerForStorage(data.server)
          });
        }

        // Clear Google cookies only when the user asks to change account
        if (resetGoogle) {
          await window.electronAPI.clearPartitionSession();
          this._pendingFreshLogin = true;
          this._pendingFreshLoginAt = Date.now();
          this._freshLoginStarted = false;
        } else {
          this._pendingFreshLogin = false;
        }

        const targetUrl = (data.server.targetUrl || 'https://flow.google.com').replace(/\/$/, '') + '/';
        console.log('[AppShell] Open Flow for', data.server.email, resetGoogle ? '(fresh Google login)' : '(keep Google session)');
        this.loadTargetInWebview(targetUrl);
      } else {
        this.notify((data && data.error) || 'Failed to switch server node', true);
        this.hideLoadingOverlay();
      }
    } catch (err) {
      console.error('Server switch error:', err);
      this.notify('Error communicating with server: ' + err.message, true);
      this.hideLoadingOverlay();
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
    let dest = (this.activeServer?.targetUrl || 'https://flow.google.com').replace(/\/?$/, '/');
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
    if (!href.includes('flow.google.com') && !href.includes('labs.google')) return;
    // Already bounced to Google once this cycle — never schedule again
    if (this._freshLoginStarted) return;
    if (this._freshLoginTimer) clearTimeout(this._freshLoginTimer);
    this._freshLoginTimer = setTimeout(() => {
      if (!this._pendingFreshLogin) return;
      this._pendingFreshLogin = false;
      this._freshLoginStarted = true;
      const continueUrl = (this.activeServer?.targetUrl || 'https://flow.google.com').replace(/\/$/, '') + '/';
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
      return /flow\.google\.com|labs\.google|accounts\.google\.com|gds\.google\.com/i.test(url);
    }
  }

  updateDebugUrl(url) {
    if (!this.debugUrlInput) return;
    // Navigation events pass the authoritative URL. Prefer that over getURL() so the
    // bar cannot stick on the first Google /identifier load when history updates race.
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

        if (!this.activeServer?.email) return;
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
        this.resolveGooglePasswordForFill().then((password) => {
          this.fillGoogleLoginFields({
            email: this.activeServer.email,
            password: password || ''
          }).catch(() => {});
        }).catch(() => {});
        this.tryGoogleAutoFill(live);
      } catch (e) {}
    }, 900);
  }

  loadTargetInWebview(url) {
    // Never use local demo/fake pages
    if (!url || url.includes('demo-flow') || url.startsWith('file:')) {
      url = 'https://flow.google.com/';
    }
    // Never yank the tab to Flow while Google TOTP / sign-in is still open —
    // EXCEPT CheckCookie/LoginDone (login finished; continue= must reach Flow).
    try {
      const live = this.webview?.getURL ? this.webview.getURL() : (this.webview?.src || '');
      const onGoogleAuth = /accounts\.google\.com|accounts\.youtube\.com/i.test(String(live || ''));
      const goingToFlow = /flow\.google\.com|labs\.google/i.test(String(url || ''));
      const onLoginDone = /CheckCookie|LoginDoneHtml|chtml=LoginDone/i.test(String(live || ''));
      if (onGoogleAuth && (goingToFlow || this._totpFilling) && !onLoginDone && !this._allowFlowAfterCheckCookie) {
        console.warn('[AppShell] skip navigate while Google auth/TOTP active:', url);
        return;
      }
    } catch (e) {}
    // Only Flow workspace + Google login — block mail/drive/myaccount/etc.
    if (!this.isAllowedFlowUrl(url)) {
      console.warn('[AppShell] Blocked navigation to', url);
      // Mid-auth: do not rewrite blocked handoff hosts to Flow
      if (this._totpFilling || this._captchaActive) {
        console.warn('[AppShell] keep current page during auth (blocked url)', url);
        return;
      }
      url = this.activeServer?.targetUrl || 'https://flow.google.com/';
    }
    // Never force chrome while the Flow Creator login screen is open (clips UI + traps overlay)
    const loginVisible = this.loginScreen && !this.loginScreen.classList.contains('hidden');
    if (loginVisible) {
      window.electronAPI.setShellMode?.('full');
    } else {
      window.electronAPI.setShellMode?.('chrome');
    }
    this.showLoadingOverlay('Opening Flow...', url);
    this.updateDebugUrl(url);
    this.startDebugUrlPolling();

    // Do NOT navigate to about:blank first — that aborts the real load on many PCs
    setTimeout(() => {
      try {
        if (typeof this.webview.loadURL === 'function') this.webview.loadURL(url);
        else this.webview.src = url;
      } catch (e) {
        this.webview.src = url;
      }
      this.updateDebugUrl(url);
      setTimeout(() => this.sendCredentialsToWebview(true), 900);
      setTimeout(() => this.sendCredentialsToWebview(false), 2200);
      setTimeout(() => this.sendCredentialsToWebview(false), 4500);
    }, 80);

    if (this._overlayTimeout) clearTimeout(this._overlayTimeout);
    this._overlayTimeout = setTimeout(() => {
      this.hideLoadingOverlay();
    }, 8000);
  }

  onWebviewDomReady() {
    if (this._overlayTimeout) {
      clearTimeout(this._overlayTimeout);
      this._overlayTimeout = null;
    }
    // Send masking rules to the webview (model renaming removed)
    if (this.settings) {
      this.webview.send('apply-masking-rules', {
        modelRenames: [],
        cssSelectorsToHide: this.settings.cssSelectorsToHide || [],
        customCss: this.settings.customCss || ''
      });
    }

    // Send Google auto-login credentials into the webview preload (single owner of fill)
    this.sendCredentialsToWebview();
    // OTP-only backup — never re-fill email/password (that caused the password loop)
    this.tryGoogleAutoFill(this.webview.src);

    // Hide full overlay after short grace period to allow DOM mutations to finish cleanly
    setTimeout(() => {
      this.hideLoadingOverlay();
    }, 600);
  }

  async sendCredentialsToWebview(forceReset = false) {
    if (this.activeServer && this.activeServer.email) {
      const password = await this.resolveGooglePasswordForFill();
      const payload = {
        email: this.activeServer.email,
        password: password || '',
        targetUrl: this.activeServer.targetUrl || 'https://flow.google.com',
        forceReset: !!forceReset
      };
      this._captchaActive = false;
      try {
        console.log('[AppShell] Sending credentials to webview for:', this.activeServer.email, forceReset ? '(forceReset)' : '');
        window.chrome?.webview?.postMessage(JSON.stringify({
          type: 'cmd',
          cmd: 'setFlowCreds',
          email: payload.email,
          password: payload.password,
          targetUrl: payload.targetUrl
        }));
        this.webview.send('apply-credentials', payload);
      } catch (err) {
        console.warn('[AppShell] Could not send credentials to webview:', err.message);
      }
      // Proven path: fill Google fields directly (host/inject postMessage was not sticking)
      this.fillGoogleLoginFields(payload).catch((e) => console.warn('[AppShell] fillGoogle:', e.message));
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
    if (!url || !this.activeServer || !this.activeServer.email) return;
    const href = String(url);
    if (DEBUG_DISABLE_AUTH_OVERLAY) {
      // Keep Google UI visible while debugging
      this.postAuthOverlay({ show: false, captcha: false });
    }
    if (href.includes('flow.google.com') || href.includes('labs.google')) {
      this.hideGoogleAuthBanner();
      this._totpFilling = false;
      // Do not end overlay during Flow→Google bounce (fresh login) — that flickers the cover.
      // Host clears overlay on auth:auto-login done from workspace, or when shell posts done after settle.
      if (!this._pendingFreshLogin) {
        this.postAuthOverlay({ show: false, done: true });
      }
      this._pwdCredPushed = false;
      return;
    }
    if (!href.includes('accounts.google.com') && !href.includes('accounts.youtube.com')) return;
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
      this.resolveGooglePasswordForFill().then((password) => {
        this.fillGoogleLoginFields({
          email: this.activeServer.email,
          password: password || ''
        }).catch(() => {});
      }).catch(() => {});
    }
  }

  async fetchGoogleCredential(stage) {
    if (!this.config?.authToken || !this.config?.serverUrl) return '';
    try {
      const res = await fetch(`${this.config.serverUrl}${CLIENT_API}/extension-step`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.authToken}`
        },
        body: JSON.stringify({ attemptId: 'shell_' + Date.now(), stage })
      });
      const data = await res.json().catch(() => ({}));
      if (data && data.value) return String(data.value);
      console.warn('[AppShell] credential not available:', stage, (data && data.error) || res.status);
    } catch (err) {
      console.warn('[AppShell] credential fetch failed:', stage, err.message);
    }
    return '';
  }

  /** Fetch Google password from API into memory only (never from activeServer JSON). */
  async resolveGooglePasswordForFill() {
    // Prefer JIT API — do not trust any leftover password field
    const fromApi = await this.fetchGoogleCredential('password');
    if (fromApi) return fromApi;
    return '';
  }

  async pushTotpFromBackend() {
    const now = Date.now();
    if (this._otpPushAt && now - this._otpPushAt < 2500) return;
    this._otpPushAt = now;
    this._totpFilling = true;
    // Keep cover while auto-OTP runs — do not lift overlay
    this.postAuthOverlay({ show: true, captcha: false });
    if (!this.config?.authToken) return;
    let otp = '';
    try {
      const res = await fetch(`${this.config.serverUrl}${CLIENT_API}/extension-step`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.authToken}`
        },
        body: JSON.stringify({ attemptId: 'shell_' + Date.now(), stage: 'otp' })
      });
      const data = await res.json().catch(() => ({}));
      if (data && data.value) otp = String(data.value);
      else console.warn('[AppShell] OTP not available:', (data && data.error) || res.status);
    } catch (err) {
      console.warn('[AppShell] OTP fetch skipped:', err.message);
      return;
    }
    if (!otp) return;
    console.log('[AppShell] Pushing backend TOTP, len', otp.length);
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

  // Downloads Management
  onDownloadStarted(data) {
    this.downloads.unshift({
      filename: data.filename,
      totalBytes: data.totalBytes,
      receivedBytes: 0,
      state: 'progressing',
      savePath: null
    });
    this.updateDownloadsUI();
  }

  onDownloadProgress(data) {
    const item = this.downloads.find(d => d.filename === data.filename);
    if (item) {
      item.receivedBytes = data.receivedBytes;
      item.totalBytes = data.totalBytes;
      this.updateDownloadsUI();
    }
  }

  onDownloadCompleted(data) {
    const item = this.downloads.find(d => d.filename === data.filename);
    if (item) {
      item.state = 'completed';
      item.savePath = data.savePath;
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

    this.downloadsList.innerHTML = this.downloads.map(item => {
      const pct = item.totalBytes > 0 ? Math.round((item.receivedBytes / item.totalBytes) * 100) : 0;
      let statusText = `${pct}% completed`;
      let actionBtn = '';

      if (item.state === 'completed') {
        statusText = 'Completed';
        actionBtn = `<button class="btn-open-file" onclick="app.showDownloadedFile('${item.savePath.replace(/\\/g, '\\\\')}')">Open in Folder</button>`;
      } else if (item.state === 'failed') {
        statusText = '<span style="color:#f87171;">Failed</span>';
      }

      return `
        <div class="download-item">
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
    this.googleAuthBannerText.textContent = text;
    this.googleAuthBanner.classList.toggle('captcha', !!captcha);
    this.googleAuthBanner.classList.remove('hidden');
  }

  hideGoogleAuthBanner() {
    if (!this.googleAuthBanner) return;
    this.googleAuthBanner.classList.add('hidden');
    this.googleAuthBanner.classList.remove('captcha');
    this._captchaActive = false;
    this._totpFilling = false;
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

let app;
function initApp() {
  if (!app) {
    console.log('[App] Initializing FlowBrowserApp...');
    app = new FlowBrowserApp();
    window.app = app; // for CDP debugging / server switch tests
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
