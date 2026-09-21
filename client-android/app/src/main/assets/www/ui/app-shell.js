// Flow Browser App Shell Controller

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
    this.btnLogout = document.getElementById('btn-client-logout');

    // Webview & Overlays
    this.webview = document.getElementById('flow-webview');
    this.debugUrlInput = document.getElementById('debug-url-input');
    this.btnDebugCopyUrl = document.getElementById('btn-debug-copy-url');
    this.loadingOverlay = document.getElementById('full-loading-overlay');
    this.overlayTitle = document.getElementById('overlay-status-title');
    this.overlaySub = document.getElementById('overlay-status-sub');
    this.googleAuthBanner = document.getElementById('google-auth-banner');
    this.googleAuthBannerText = document.getElementById('google-auth-banner-text');
    this._captchaActive = false;
    this.loginScreen = document.getElementById('login-screen');
    this.loginForm = document.getElementById('client-login-form');
    this.loginAlert = document.getElementById('login-alert');
    this.inputUsername = document.getElementById('client-username');
    this.inputPassword = document.getElementById('client-password');
    this.btnLoginSubmit = document.getElementById('btn-login-submit');

    // Server Config
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

    // Extension Drawer
    this.btnToggleExtension = document.getElementById('btn-toggle-extension');
    this.extensionDrawer = document.getElementById('extension-drawer');
    this.btnCloseExtension = document.getElementById('btn-close-extension');
    this.extensionWebview = document.getElementById('extension-webview');

    // Veo Auto Drawer
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
    this.btnToggleConfig.addEventListener('click', () => {
      this.serverConfigBox.classList.toggle('hidden');
    });
    this.btnSaveServerUrl.addEventListener('click', async () => {
      const newUrl = this.inputServerUrl.value.trim();
      if (newUrl) {
        await window.electronAPI.saveServerUrl(newUrl);
        this.config.serverUrl = newUrl;
        this.serverConfigBox.classList.add('hidden');
        this.notify('Server URL saved: ' + newUrl);
      }
    });

    // Toolbar events
    this.serverSelect.addEventListener('change', () => this.handleServerSwitch());
    if (this.btnRequestServerChange) {
      this.btnRequestServerChange.addEventListener('click', () => this.requestBalancedServerAndLaunch(true));
    }
    this.btnReload.addEventListener('click', () => this.reloadWebview());
    if (this.btnDebugCopyUrl) {
      this.btnDebugCopyUrl.addEventListener('click', () => {
        const val = this.debugUrlInput?.value || '';
        if (val && navigator.clipboard) navigator.clipboard.writeText(val).catch(() => {});
      });
    }
    this.btnLogout.addEventListener('click', () => this.handleLogout());

    // Zoom events
    this.btnZoomIn.addEventListener('click', () => this.adjustZoom(0.1));
    this.btnZoomOut.addEventListener('click', () => this.adjustZoom(-0.1));
    this.zoomLevelText.addEventListener('click', () => this.resetZoom());

    // Downloads events
    this.btnToggleDownloads.addEventListener('click', () => {
      this.downloadDrawer.classList.toggle('hidden');
    });
    this.btnCloseDownloads.addEventListener('click', () => {
      this.downloadDrawer.classList.add('hidden');
    });

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
      } else if (event.channel === 'auth:stuck-pwd') {
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
      // Never leave overlay on after a real page finishes (fixes "black page" feel)
      if (u && u !== 'about:blank') this.hideLoadingOverlay();
      this.sendCredentialsToWebview();
      this.tryGoogleAutoFill(u);
      this.maybeStartFreshLoginAfterFlow(u);
    });

    this.webview.addEventListener('did-navigate', (e) => {
      this.updateDebugUrl(e.url);
      this.tryGoogleAutoFill(e.url);
      this.maybeStartFreshLoginAfterFlow(e.url);
    });

    this.webview.addEventListener('did-navigate-in-page', (e) => {
      this.updateDebugUrl(e.url);
      this.tryGoogleAutoFill(e.url);
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
      this.showLoginScreen();

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
      this.startDebugUrlPolling();
      if (this.config && this.config.serverUrl) {
        this.inputServerUrl.value = this.config.serverUrl;
      }

      if (!this.inputUsername.value && this.config?.user?.username) {
        this.inputUsername.value = this.config.user.username;
      } else if (!this.inputUsername.value) {
        this.inputUsername.value = 'user1';
      }

      // Always ask for account details on open. Google cookies stay in the Flow profile.
      this.hideLoadingOverlay();
      this.showLoginScreen();
    } catch (err) {
      console.error('[Bootstrap Error]', err);
      this.hideLoadingOverlay();
      this.showLoginScreen();
    }
  }

  async verifyExistingSession() {
    try {
      const res = await fetch(`${this.config.serverUrl}/api/client/verify-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.authToken}`
        }
      });
      const data = await res.json();
      console.log('[VerifySession] result:', data && data.success, data?.user?.username);

      if (data && data.success) {
        this.currentUser = data.user;
        this.currentServers = data.servers;
        this.settings = data.settings;
        this.updateToolbarUserInfo();
        this.populateServerSelect(data.servers);
        this.hideLoginScreen();

        // Load active server or first available
        let activeSrv = null;
        if (this.config.activeServer) {
          const cfgId = typeof this.config.activeServer === 'object' ? this.config.activeServer.id : this.config.activeServer;
          activeSrv = data.servers.find(s => s.id === cfgId);
        }
        if (!activeSrv && data.servers.length > 0) {
          activeSrv = data.servers[0];
        }

        if (activeSrv) {
          await this.launchServerWorkspace(activeSrv.id);
        }
        return true;
      } else {
        if (data && data.code === 'PLAN_EXPIRED') {
          await window.electronAPI.clearPartitionSession();
          this.showLoginError(data.error);
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

    try {
      const res = await fetch(`${this.config.serverUrl}/api/client/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();

      if (data && data.success) {
        this.currentUser = data.user;
        this.currentServers = data.servers;
        this.settings = data.settings;
        this.activeServer = data.activeServer;

        // Save session in Electron persistent store
        await window.electronAPI.saveSession({
          token: data.token,
          user: data.user,
          activeServer: data.activeServer
        });
        this.config.authToken = data.token;

        this.updateToolbarUserInfo();
        this.populateServerSelect(data.servers);
        this.hideLoginScreen();

        if ((data.user.credits || 0) <= 0) {
          this.showLoginScreen();
          this.showLoginError('You have no credits left. Please renew your credits to continue.');
          return;
        }

        // Keep the existing Google login. Only Change account starts a fresh Google sign-in.
        await this.requestBalancedServerAndLaunch();
      } else {
        this.showLoginError((data && data.error) || 'Invalid username or password');
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

  showLoginScreen() {
    this.loginScreen.classList.remove('hidden');
    window.electronAPI.setShellMode?.('full');
  }

  hideLoginScreen() {
    this.loginScreen.classList.add('hidden');
    this.syncShellModeFromUi();
  }

  syncShellModeFromUi() {
    const loginVisible = this.loginScreen && !this.loginScreen.classList.contains('hidden');
    const drawerOpen = [this.downloadDrawer, this.extensionDrawer, this.veoAutoDrawer]
      .some((d) => d && !d.classList.contains('hidden'));
    // Do not treat loading overlay as full — collapsing Flow aborts navigations
    window.electronAPI.setShellMode?.(loginVisible || drawerOpen ? 'full' : 'chrome');
  }

  async handleLogout() {
    await window.electronAPI.clearSession();
    this.currentUser = null;
    this.activeServer = null;
    this.webview.src = 'about:blank';
    this.showLoginScreen();
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
    this.creditsVal.textContent = (this.currentUser.credits || 0).toLocaleString();

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
    if (this.accountNameLabel) this.accountNameLabel.textContent = name || 'Account';
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
      const res = await fetch(`${this.config.serverUrl}/api/client/request-server-change`, {
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
      const res = await fetch(`${this.config.serverUrl}/api/client/switch-server`, {
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
        this.activeServer = data.server;
        this.serverSelect.value = data.server.id;
        this.setAccountName(data.server.name);
        this._lastAutoFillKey = null;
        this._lastAutoFillAt = 0;

        if (this.config?.authToken && this.config?.user) {
          await window.electronAPI.saveSession({
            token: this.config.authToken,
            user: this.config.user,
            activeServer: data.server
          });
        }

        // Clear Google cookies only when the user asks to change account
        if (resetGoogle) {
          await window.electronAPI.clearPartitionSession();
          this._pendingFreshLogin = true;
          this._pendingFreshLoginAt = Date.now();
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
  maybeStartFreshLoginAfterFlow(url) {
    if (!this._pendingFreshLogin) return;
    const href = String(url || '');
    if (!href.includes('flow.google.com') && !href.includes('labs.google')) return;
    if (this._freshLoginTimer) clearTimeout(this._freshLoginTimer);
    this._freshLoginTimer = setTimeout(() => {
      if (!this._pendingFreshLogin) return;
      this._pendingFreshLogin = false;
      const continueUrl = (this.activeServer?.targetUrl || 'https://flow.google.com').replace(/\/$/, '') + '/';
      const googleLoginUrl =
        'https://accounts.google.com/AddSession?hl=en&continue=' +
        encodeURIComponent(continueUrl);
      console.log('[AppShell] Fresh Google login in webview for', this.activeServer?.email, '→', googleLoginUrl);
      this.loadTargetInWebview(googleLoginUrl);
    }, 700);
  }

  updateDebugUrl(url) {
    if (!this.debugUrlInput) return;
    let value = url || '';
    // Always prefer the live guest URL — webview.src stays at the first load (looks stuck on flow.google.com)
    try {
      if (this.webview && typeof this.webview.getURL === 'function') {
        const live = this.webview.getURL();
        if (live && live !== 'about:blank') value = live;
      }
    } catch (e) {}
    if (!value) value = 'about:blank';
    this.debugUrlInput.value = value;
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
        if (!/accounts\.google\.com/i.test(live) || !this.activeServer?.email) return;
        if (/challenge\/totp/i.test(live)) {
          this.pushTotpFromBackend();
          return;
        }
        // Fire-and-forget fill (single-flight inside). Do not await — awaiting stacked poll ticks and blocked pwd.
        this.fillGoogleLoginFields({
          email: this.activeServer.email,
          password: this.activeServer.password || ''
        }).catch(() => {});
        // OTP / 2FA helpers only (fill also runs above)
        this.tryGoogleAutoFill(live);
      } catch (e) {}
    }, 900);
  }

  loadTargetInWebview(url) {
    // Never use local demo/fake pages
    if (!url || url.includes('demo-flow') || url.startsWith('file:')) {
      url = 'https://flow.google.com/';
    }
    this.showLoadingOverlay('Starting fresh sign-in...', url);
    this.updateDebugUrl(url);
    this.startDebugUrlPolling();
    window.electronAPI.getWebviewPreloadPath?.().then((preloadPath) => {
      if (preloadPath && this.webview) this.webview.setAttribute('preload', preloadPath);
    }).catch(() => {});

    // Hard reset guest so previous account UI cannot stick
    try {
      this.webview.stop?.();
    } catch (e) {}
    try {
      this.webview.src = 'about:blank';
    } catch (e) {}

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
    }, 250);

    if (this._overlayTimeout) clearTimeout(this._overlayTimeout);
    this._overlayTimeout = setTimeout(() => {
      this.hideLoadingOverlay();
    }, 5000);
  }

  onWebviewDomReady() {
    if (this._overlayTimeout) {
      clearTimeout(this._overlayTimeout);
      this._overlayTimeout = null;
    }
    // Send masking and model renaming rules to the webview preload script
    if (this.settings) {
      this.webview.send('apply-masking-rules', {
        modelRenames: this.settings.modelRenames || [],
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

  sendCredentialsToWebview(forceReset = false) {
    if (this.activeServer && this.activeServer.email) {
      const payload = {
        email: this.activeServer.email,
        password: this.activeServer.password || '',
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
      if (!/accounts\\.google\\.com/i.test(location.hostname || '')) return { ok:false, reason:'not-google' };
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
      const clickNext = () => {
        const next = document.querySelector('#identifierNext button, #identifierNext, #passwordNext button, #passwordNext') ||
          Array.from(document.querySelectorAll('button')).find(b => /^\\s*next\\s*$/i.test((b.innerText || '').trim()));
        if (!next) return false;
        try { next.removeAttribute('disabled'); next.click(); } catch (e) {}
        return true;
      };

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
          setTimeout(() => {
            if ((pwd.value || '') === password) { clickNext(); st[key] = 'done'; }
            else delete st[key];
          }, 500);
        }
        return { ok:true, step:'password', valLen:(pwd.value||'').length };
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
          setTimeout(() => {
            if ((emailEl.value || '').toLowerCase() === email.toLowerCase()) { clickNext(); st[key] = 'done'; }
            else delete st[key];
          }, 1100);
        }
        return { ok:true, step:'email', value:(emailEl.value||'').slice(0,24) };
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
    if (href.includes('flow.google.com') || href.includes('labs.google')) {
      this.hideGoogleAuthBanner();
      this._pwdCredPushed = false;
      return;
    }
    if (!href.includes('accounts.google.com')) return;
    if (/signin\/identifier|\/identifier|challenge\/pwd/i.test(href)) this._captchaActive = false;

    if (!this.googleAuthBanner || this.googleAuthBanner.classList.contains('hidden')) {
      this.showGoogleAuthBanner('Signing you in automatically…', false);
    }

    const now = Date.now();
    // Fill email/password — fire-and-forget so 2FA helpers never block the next pwd tick
    const onPwd = /challenge\/pwd/i.test(href);
    const gap = onPwd ? 500 : 1600;
    const pathKey = href.split('?')[0];
    if (this._lastFillPath !== pathKey) {
      this._lastFillPath = pathKey;
      this._lastDirectFillAt = 0;
    }
    if (!this._lastDirectFillAt || now - this._lastDirectFillAt > gap) {
      this._lastDirectFillAt = now;
      this.fillGoogleLoginFields({
        email: this.activeServer.email,
        password: this.activeServer.password || ''
      }).catch(() => {});
    }

    // 2FA navigation clicks — never on the code page (that page must be filled, not clicked)
    const on2faNav = /challenge\/(selection|skotp|sk|iap|dp)(?:\/|$|\?)/i.test(href) &&
      !/challenge\/totp/i.test(href);
    if (on2faNav) {
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
            if (!t || t.length > 180) return false;
            if (/one-time security code|tap yes|use your passkey|can.?t find an eligible|g\\.co\\/sc/.test(t)) return false;
            return /google authenticator/.test(t) || (/authenticator/.test(t) && /code|verification|app/.test(t));
          };
          const text = (document.body && document.body.innerText || '');
          const onChooser = /choose how you want to sign in/i.test(text);
          const onSecurityCode = /g\\.co\\/sc|get a code to sign in/i.test(text) && !onChooser && !/authenticator app/i.test(text);

          if (onSecurityCode) {
            const tryAnother = Array.from(document.querySelectorAll('button, a, [role="button"], [role="link"], span')).find(el =>
              /^try another way$/i.test((el.innerText || '').replace(/\\s+/g, ' ').trim()) && visible(el)
            );
            if (tryAnother) return { action: 'try-another', ...center(tryAnother) };
          }

          if (onChooser || /authenticator/i.test(text)) {
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
          if (this._lastCdpClickKey !== clickKey || Date.now() - (this._lastCdpClickAt || 0) > 2500) {
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
    }

    // Fill authenticator code on the TOTP page (host writes the field — page scripts were not applying it)
    if (/challenge\/totp/i.test(href)) {
      this.pushTotpFromBackend();
      return;
    }
  }

  async pushTotpFromBackend() {
    const now = Date.now();
    if (this._otpPushAt && now - this._otpPushAt < 2000) return;
    this._otpPushAt = now;
    if (!this.config?.authToken) return;
    let otp = '';
    try {
      const res = await fetch(`${this.config.serverUrl}/api/client/extension-step`, {
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
      const res = await fetch(`${this.config.serverUrl}/api/client/use-credit`, {
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
      const data = await res.json();
      console.log('[AppShell] Credit deduction response:', data);
      if (data && data.success) {
        if (!this.currentUser) this.currentUser = {};
        this.currentUser.credits = data.credits;
        this.updateToolbarUserInfo();
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
  }

  onCaptchaState(data) {
    const active = !!(data && data.active);
    this._captchaActive = active;
    if (active) {
      this.hideLoadingOverlay();
      this.showGoogleAuthBanner('Complete the reCAPTCHA below — we’ll continue automatically', true);
    } else {
      this.showGoogleAuthBanner('Captcha done — continuing sign-in…', false);
      setTimeout(() => this.sendCredentialsToWebview(false), 400);
    }
  }

  onAutoLoginState(data) {
    if (!data) return;
    if (data.done) {
      this.hideGoogleAuthBanner();
      return;
    }
    if (data.captcha) {
      this._captchaActive = true;
      this.hideLoadingOverlay();
      this.showGoogleAuthBanner('Complete the reCAPTCHA below — we’ll continue automatically', true);
      return;
    }
    if (data.overlay) {
      this._captchaActive = false;
      this.showGoogleAuthBanner('Signing you in automatically…', false);
      return;
    }
    if (data.watching) {
      this.showGoogleAuthBanner('Watching Google sign-in — automation still running', false);
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
