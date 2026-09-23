// Admin Dashboard Frontend Logic

class AdminApp {
  constructor() {
    this.token = localStorage.getItem('flow_admin_token') || null;
    this.currentTab = 'overview';
    this.users = [];
    this.servers = [];
    this.settings = null;
    this.logs = [];

    this.initElements();
    this.initEvents();

    if (this.token) {
      this.showDashboard();
      this.loadAllData();
    } else {
      this.showLogin();
    }
  }

  initElements() {
    this.loginModal = document.getElementById('login-modal');
    this.appContainer = document.getElementById('app-container');
    this.adminLoginForm = document.getElementById('admin-login-form');
    this.loginError = document.getElementById('login-error');
    this.navItems = document.querySelectorAll('.nav-item');
    this.tabPanes = document.querySelectorAll('.tab-pane');
    this.pageTitle = document.getElementById('page-title');
    this.pageSubtitle = document.getElementById('page-subtitle');

    // Modals
    this.userModal = document.getElementById('user-modal');
    this.userForm = document.getElementById('user-form');
    this.serverModal = document.getElementById('server-modal');
    this.serverForm = document.getElementById('server-form');

    // Forms
    this.settingsForm = document.getElementById('settings-form');
    this.userSearchInput = document.getElementById('user-search-input');
  }

  initEvents() {
    this.adminLoginForm.addEventListener('submit', (e) => this.handleAdminLogin(e));
    document.getElementById('btn-logout').addEventListener('click', () => this.handleLogout());
    document.getElementById('btn-refresh-data').addEventListener('click', () => this.loadAllData(true));

    this.navItems.forEach(item => {
      item.addEventListener('click', () => {
        const tab = item.getAttribute('data-tab');
        this.switchTab(tab);
      });
    });

    // User management events
    document.getElementById('btn-open-add-user-modal').addEventListener('click', () => this.openAddUserModal());
    this.userForm.addEventListener('submit', (e) => this.handleSaveUser(e));
    this.userSearchInput.addEventListener('input', () => this.renderUsersTable());

    // Server management events
    document.getElementById('btn-open-add-server-modal').addEventListener('click', () => this.openAddServerModal());
    this.serverForm.addEventListener('submit', (e) => this.handleSaveServer(e));
    document.getElementById('btn-totp-preview').addEventListener('click', () => this.previewTotpCode());

    // Settings events
    this.settingsForm.addEventListener('submit', (e) => this.handleSaveSettings(e));
    document.getElementById('btn-add-model-rule').addEventListener('click', () => this.addModelRuleRow('', '', true));
    document.getElementById('btn-add-selector-rule').addEventListener('click', () => this.addSelectorRow(''));
  }

  async apiRequest(endpoint, method = 'GET', body = null) {
    const headers = {
      'Content-Type': 'application/json'
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      const res = await fetch(endpoint, {
        method,
        headers,
        body: body ? JSON.stringify(body) : null
      });
      const data = await res.json();
      if (res.status === 401 && this.token) {
        this.showToast('Session expired. Please log in again.', 'error');
        this.handleLogout();
        return null;
      }
      return data;
    } catch (err) {
      console.error('API Error:', err);
      this.showToast('Network error: ' + err.message, 'error');
      return null;
    }
  }

  async handleAdminLogin(e) {
    e.preventDefault();
    this.loginError.classList.add('hidden');

    const username = document.getElementById('admin-username').value.trim();
    const password = document.getElementById('admin-password').value;

    const data = await this.apiRequest('/api/admin/login', 'POST', { username, password });
    if (data && data.success) {
      this.token = data.token;
      localStorage.setItem('flow_admin_token', this.token);
      document.getElementById('sidebar-admin-name').textContent = data.username;
      this.showToast('Welcome back, Admin!', 'success');
      this.showDashboard();
      this.loadAllData();
    } else {
      this.loginError.textContent = (data && data.error) || 'Invalid admin credentials';
      this.loginError.classList.remove('hidden');
    }
  }

  handleLogout() {
    this.token = null;
    localStorage.removeItem('flow_admin_token');
    this.showLogin();
  }

  showLogin() {
    this.loginModal.classList.remove('hidden');
    this.appContainer.classList.add('hidden');
  }

  showDashboard() {
    this.loginModal.classList.add('hidden');
    this.appContainer.classList.remove('hidden');
  }

  switchTab(tabId) {
    this.currentTab = tabId;
    this.navItems.forEach(item => {
      if (item.getAttribute('data-tab') === tabId) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    this.tabPanes.forEach(pane => {
      if (pane.id === `tab-${tabId}`) {
        pane.classList.add('active');
      } else {
        pane.classList.remove('active');
      }
    });

    const titles = {
      overview: { title: 'Overview Dashboard', sub: 'Real-time telemetry, active subscriptions, and server pool status' },
      users: { title: 'User & Subscription Management', sub: 'Manage user access, credits allocation, and plan expiration dates' },
      servers: { title: 'Shared Account Pool', sub: 'Shared Google accounts with email, password, and TOTP auto-login' },
      masking: { title: 'Model & DOM Masking', sub: 'Configure AI model renaming and hide Google/Flow account profile details' },
      logs: { title: 'Activity & Auth Telemetry', sub: 'Audit logs of user logins, server switches, and credits deduction' }
    };

    if (titles[tabId]) {
      this.pageTitle.textContent = titles[tabId].title;
      this.pageSubtitle.textContent = titles[tabId].sub;
    }
  }

  async loadAllData(showToast = false) {
    await Promise.all([
      this.loadMetrics(),
      this.loadUsers(),
      this.loadServers(),
      this.loadSettings(),
      this.loadLogs()
    ]);
    if (showToast) {
      this.showToast('Data refreshed successfully', 'success');
    }
  }

  async loadMetrics() {
    const data = await this.apiRequest('/api/admin/metrics');
    if (data && data.success) {
      document.getElementById('stat-total-users').textContent = data.metrics.totalUsers;
      document.getElementById('stat-active-users').textContent = data.metrics.activeUsers;
      document.getElementById('stat-expired-users').textContent = data.metrics.expiredUsers;
      document.getElementById('stat-total-credits').textContent = data.metrics.totalCredits.toLocaleString();
    }
  }

  async loadUsers() {
    const data = await this.apiRequest('/api/admin/users');
    if (data && data.success) {
      this.users = data.users;
      this.renderUsersTable();
    }
  }

  renderUsersTable() {
    const tbody = document.getElementById('users-table-body');
    const query = (this.userSearchInput.value || '').toLowerCase();
    const filtered = this.users.filter(u =>
      u.username.toLowerCase().includes(query) ||
      (u.notes && u.notes.toLowerCase().includes(query))
    );

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">No users found</td></tr>`;
      return;
    }

    const now = new Date();

    tbody.innerHTML = filtered.map(u => {
      const expiry = new Date(u.planExpiry);
      const isExpired = expiry <= now;
      const expiryFormatted = expiry.toLocaleDateString() + ' ' + expiry.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      let statusBadge = '';
      if (!u.isActive) {
        statusBadge = '<span class="badge badge-danger">Disabled</span>';
      } else if (isExpired) {
        statusBadge = '<span class="badge badge-danger">Plan Expired</span>';
      } else {
        statusBadge = '<span class="badge badge-success">Active Plan</span>';
      }

      return `
        <tr>
          <td>
            <div style="font-weight: 700; color: #f8fafc;">${u.username}</div>
            <div style="font-size: 0.75rem; color: #94a3b8;">${u.notes || 'No notes'}</div>
          </td>
          <td>${statusBadge}</td>
          <td><strong style="color: #38bdf8;">${(u.credits || 0).toLocaleString()}</strong> credits</td>
          <td>
            <div style="font-weight: 600; color: ${isExpired ? '#f87171' : '#f8fafc'}">${expiryFormatted}</div>
            <div style="font-size: 0.75rem; color: ${isExpired ? '#ef4444' : '#10b981'}">
              ${isExpired ? 'Expired' : this.getRemainingDaysText(expiry)}
            </div>
          </td>
          <td>
            <span class="badge badge-neutral">${u.allowedServerIds?.includes('all') ? 'All Servers' : (u.allowedServerIds?.length || 0) + ' Servers'}</span>
          </td>
          <td style="color: #64748b; font-size: 0.8rem;">
            ${new Date(u.createdAt).toLocaleDateString()}
          </td>
          <td>
            <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
              <button class="btn btn-sm btn-secondary" onclick="app.openEditUserModal('${u.id}')">Edit</button>
              <button class="btn btn-sm btn-secondary" onclick="app.quickAddCredits('${u.id}', 100)">+100 Cr</button>
              <button class="btn btn-sm btn-secondary" onclick="app.forceLogoutUser('${u.id}')" title="Revoke session and clear Google cookies on their device">Revoke + clear Google</button>
              <button class="btn btn-sm btn-icon" onclick="app.deleteUser('${u.id}')" title="Delete">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  getRemainingDaysText(expiryDate) {
    const diffMs = expiryDate.getTime() - Date.now();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days > 0) return `${days}d ${hours}h left`;
    return `${hours}h left`;
  }

  async loadServers() {
    const data = await this.apiRequest('/api/admin/servers');
    if (data && data.success) {
      this.servers = data.servers;
      this.renderServersGrid();
    }
  }

  renderServersGrid() {
    const grid = document.getElementById('servers-grid');
    if (this.servers.length === 0) {
      grid.innerHTML = '<p class="text-muted">No shared server nodes configured. Add one below.</p>';
      return;
    }

    grid.innerHTML = this.servers.map(s => {
      const emailDisplay = s.email || '<span style="color:#f87171;">No email set</span>';
      const hasTotp = !!(s.hasTotp || (s.totpSecret && String(s.totpSecret).trim()));
      const totpBadge = hasTotp
        ? '<span class="badge badge-success">TOTP Ready</span>'
        : '<span class="badge badge-danger">TOTP Missing</span>';
      return `
        <div class="server-node-card">
          <div class="server-card-header">
            <span class="server-card-title">${s.name}</span>
            <span class="badge ${s.isActive ? 'badge-success' : 'badge-danger'}">${s.isActive ? 'Active' : 'Disabled'}</span>
          </div>
          <div class="server-meta-item">
            <span class="server-meta-label">Target URL:</span>
            <span class="server-meta-val" title="${s.targetUrl}">${s.targetUrl}</span>
          </div>
          <div class="server-meta-item">
            <span class="server-meta-label">Auto-Login Email:</span>
            <span class="server-meta-val" style="color:#38bdf8;font-weight:600;">${emailDisplay}</span>
          </div>
          <div class="server-meta-item">
            <span class="server-meta-label">Auto-Login Password:</span>
            <span class="server-meta-val" style="letter-spacing:2px;color:#94a3b8;">${s.password ? '••••••••' : '<span style="color:#f87171;">None</span>'}</span>
          </div>
          <div class="server-meta-item">
            <span class="server-meta-label">Authenticator:</span>
            <span class="server-meta-val">${totpBadge}</span>
          </div>
          <div class="server-card-actions">
            <button class="btn btn-sm btn-secondary" onclick="app.openEditServerModal('${s.id}')">Edit Account</button>
            <button class="btn btn-sm btn-icon" onclick="app.deleteServer('${s.id}')" title="Delete Server">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  async loadSettings() {
    const data = await this.apiRequest('/api/admin/settings');
    if (data && data.success) {
      this.settings = data.settings;
      document.getElementById('setting-app-name').value = this.settings.appName || 'Flow Browser';
      document.getElementById('setting-default-url').value = this.settings.defaultTargetUrl || 'https://flow.google.com';
      document.getElementById('setting-custom-css').value = this.settings.customCss || '';

      // Render model rename rows
      const modelContainer = document.getElementById('model-rules-container');
      modelContainer.innerHTML = '';
      if (this.settings.modelRenames && this.settings.modelRenames.length > 0) {
        this.settings.modelRenames.forEach(r => this.addModelRuleRow(r.originalName, r.displayName, r.enabled));
      }

      // Render CSS selectors
      const selectorContainer = document.getElementById('selectors-container');
      selectorContainer.innerHTML = '';
      if (this.settings.cssSelectorsToHide && this.settings.cssSelectorsToHide.length > 0) {
        this.settings.cssSelectorsToHide.forEach(s => this.addSelectorRow(s));
      }
    }
  }

  addModelRuleRow(orig = '', display = '', enabled = true) {
    const container = document.getElementById('model-rules-container');
    const row = document.createElement('div');
    row.className = 'rule-row';
    row.innerHTML = `
      <input type="text" class="model-orig-input" placeholder="Original Model Name (e.g. Gemini 1.5 Pro)" value="${orig}">
      <input type="text" class="model-display-input" placeholder="Display Name (e.g. Flow Ultra Pro)" value="${display}">
      <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.8rem;cursor:pointer;">
        <input type="checkbox" class="model-enabled-input" ${enabled ? 'checked' : ''}> Active
      </label>
      <button type="button" class="btn-icon" onclick="this.closest('.rule-row').remove()">&times;</button>
    `;
    container.appendChild(row);
  }

  addSelectorRow(selector = '') {
    const container = document.getElementById('selectors-container');
    const row = document.createElement('div');
    row.className = 'selector-row';
    row.innerHTML = `
      <input type="text" class="selector-input" placeholder="CSS Selector (e.g. img[src*='googleusercontent.com'])" value="${selector}">
      <button type="button" class="btn-icon" onclick="this.closest('.selector-row').remove()">&times;</button>
    `;
    container.appendChild(row);
  }

  async loadLogs() {
    const data = await this.apiRequest('/api/admin/logs');
    if (data && data.success) {
      this.logs = data.logs;
      this.renderLogs();
    }
  }

  renderLogs() {
    const logsBody = document.getElementById('logs-table-body');
    const overviewBody = document.getElementById('overview-recent-logs');

    if (this.logs.length === 0) {
      const empty = '<tr><td colspan="4" class="text-center py-4 text-muted">No telemetry logs recorded yet</td></tr>';
      logsBody.innerHTML = empty;
      overviewBody.innerHTML = empty;
      return;
    }

    const rows = this.logs.map(log => {
      const time = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + new Date(log.timestamp).toLocaleDateString();
      let badge = '<span class="badge badge-neutral">' + log.action + '</span>';
      if (log.action === 'client_login') badge = '<span class="badge badge-success">Client Login</span>';
      if (log.action === 'switch_server') badge = '<span class="badge badge-info">Switch Server</span>';
      if (log.action === 'use_credit') badge = '<span class="badge badge-neutral">Credit Usage</span>';

      return `
        <tr>
          <td style="color:#64748b;font-family:var(--font-mono);font-size:0.75rem;">${time}</td>
          <td><strong>${log.username}</strong></td>
          <td>${badge}</td>
          <td style="font-family:var(--font-mono);font-size:0.75rem;color:#94a3b8;">${JSON.stringify(log.details)}</td>
        </tr>
      `;
    }).join('');

    logsBody.innerHTML = rows;
    overviewBody.innerHTML = this.logs.slice(0, 5).map(log => {
      const time = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `
        <tr>
          <td style="color:#64748b;font-size:0.8rem;">${time}</td>
          <td><strong>${log.username}</strong></td>
          <td><span class="badge badge-neutral">${log.action}</span></td>
          <td style="font-size:0.8rem;color:#94a3b8;">${JSON.stringify(log.details)}</td>
        </tr>
      `;
    }).join('');
  }

  // User Actions
  openAddUserModal() {
    document.getElementById('user-modal-title').textContent = 'Add New User';
    document.getElementById('user-form-id').value = '';
    document.getElementById('user-form-username').value = '';
    document.getElementById('user-form-username').disabled = false;
    document.getElementById('user-form-password').value = '';
    document.getElementById('user-form-password').required = true;
    document.getElementById('user-password-label').textContent = 'Password';
    document.getElementById('user-password-help').textContent = 'Initial password for client';
    document.getElementById('user-form-credits').value = '100';
    document.getElementById('user-form-notes').value = '';
    document.getElementById('user-form-active').checked = true;

    this.setExpiryPreset(30);
    this.userModal.classList.remove('hidden');
  }

  openEditUserModal(userId) {
    const user = this.users.find(u => u.id === userId);
    if (!user) return;

    document.getElementById('user-modal-title').textContent = 'Edit User: ' + user.username;
    document.getElementById('user-form-id').value = user.id;
    document.getElementById('user-form-username').value = user.username;
    document.getElementById('user-form-username').disabled = false;
    document.getElementById('user-form-password').value = '';
    document.getElementById('user-form-password').required = false;
    document.getElementById('user-password-label').textContent = 'Change Password (Optional)';
    document.getElementById('user-password-help').textContent = 'Leave empty to keep existing password';
    document.getElementById('user-form-credits').value = user.credits;
    document.getElementById('user-form-notes').value = user.notes || '';
    document.getElementById('user-form-active').checked = user.isActive;

    // Set expiry
    const expiry = new Date(user.planExpiry);
    const localIso = new Date(expiry.getTime() - expiry.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    document.getElementById('user-form-expiry').value = localIso;

    this.userModal.classList.remove('hidden');
  }

  setExpiryPreset(days) {
    const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const localIso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    document.getElementById('user-form-expiry').value = localIso;
  }

  async handleSaveUser(e) {
    e.preventDefault();
    const id = document.getElementById('user-form-id').value;
    const username = document.getElementById('user-form-username').value.trim();
    const password = document.getElementById('user-form-password').value;
    const credits = Number(document.getElementById('user-form-credits').value);
    const planExpiry = new Date(document.getElementById('user-form-expiry').value).toISOString();
    const notes = document.getElementById('user-form-notes').value;
    const isActive = document.getElementById('user-form-active').checked;

    const payload = { username, credits, planExpiry, notes, isActive };
    if (password) payload.password = password;

    let res;
    if (id) {
      res = await this.apiRequest(`/api/admin/users/${id}`, 'PUT', payload);
    } else {
      res = await this.apiRequest('/api/admin/users', 'POST', payload);
    }

    if (res && res.success) {
      this.showToast(id ? 'User updated successfully' : 'User created successfully', 'success');
      this.closeModals();
      this.loadAllData();
    } else {
      this.showToast((res && res.error) || 'Failed to save user', 'error');
    }
  }

  async quickAddCredits(userId, amount) {
    const user = this.users.find(u => u.id === userId);
    if (!user) return;
    const newCredits = (user.credits || 0) + amount;
    const res = await this.apiRequest(`/api/admin/users/${userId}`, 'PUT', { credits: newCredits });
    if (res && res.success) {
      this.showToast(`Added +${amount} credits to ${user.username}`, 'success');
      this.loadAllData();
    }
  }

  async forceLogoutUser(userId) {
    const user = this.users.find(u => u.id === userId);
    if (!user) return;
    if (!confirm(`Revoke session for "${user.username}" and clear Google cookies on their device?`)) return;
    const res = await this.apiRequest(`/api/admin/users/${userId}/force-logout`, 'POST', {});
    if (res && res.success) {
      this.showToast(`Revoked ${user.username} — they will return to login shortly`, 'success');
    } else {
      this.showToast((res && res.error) || 'Force logout failed', 'error');
    }
  }

  async deleteUser(userId) {
    const user = this.users.find(u => u.id === userId);
    if (!user || !confirm(`Are you sure you want to delete user "${user.username}"?`)) return;

    const res = await this.apiRequest(`/api/admin/users/${userId}`, 'DELETE');
    if (res && res.success) {
      this.showToast('User deleted', 'success');
      this.loadAllData();
    }
  }

  // Server Actions
  openAddServerModal() {
    document.getElementById('server-modal-title').textContent = 'Add Shared Google Account Node';
    document.getElementById('server-form-id').value = '';
    document.getElementById('server-form-name').value = '';
    document.getElementById('server-form-target-url').value = 'https://flow.google.com';
    document.getElementById('server-form-email').value = '';
    document.getElementById('server-form-password').value = '';
    document.getElementById('server-form-totp-secret').value = '';
    document.getElementById('server-totp-preview').textContent = '';
    document.getElementById('server-form-active').checked = true;

    this.serverModal.classList.remove('hidden');
  }

  openEditServerModal(serverId) {
    const server = this.servers.find(s => s.id === serverId);
    if (!server) return;

    document.getElementById('server-modal-title').textContent = 'Edit Account Node: ' + server.name;
    document.getElementById('server-form-id').value = server.id;
    document.getElementById('server-form-name').value = server.name;
    document.getElementById('server-form-target-url').value = server.targetUrl || 'https://flow.google.com';
    document.getElementById('server-form-email').value = server.email || '';
    document.getElementById('server-form-password').value = server.password || '';
    document.getElementById('server-form-totp-secret').value = server.totpSecret || '';
    document.getElementById('server-totp-preview').textContent = '';
    document.getElementById('server-form-active').checked = server.isActive;

    this.serverModal.classList.remove('hidden');
  }

  async previewTotpCode() {
    const secret = document.getElementById('server-form-totp-secret').value.trim();
    const previewEl = document.getElementById('server-totp-preview');
    if (!secret) {
      previewEl.textContent = '';
      this.showToast('Paste an authenticator secret first', 'error');
      return;
    }
    const data = await this.apiRequest('/api/admin/servers/totp-preview', 'POST', { secret });
    if (data && data.success) {
      previewEl.textContent = `${data.code}  (${data.expiresInSeconds}s left)`;
    } else {
      previewEl.textContent = '';
      this.showToast((data && data.error) || 'Could not generate TOTP preview', 'error');
    }
  }

  async handleSaveServer(e) {
    e.preventDefault();
    const id = document.getElementById('server-form-id').value;
    const name = document.getElementById('server-form-name').value.trim();
    const targetUrl = document.getElementById('server-form-target-url').value.trim() || 'https://flow.google.com';
    const email = document.getElementById('server-form-email').value.trim();
    const password = document.getElementById('server-form-password').value;
    const totpSecret = document.getElementById('server-form-totp-secret').value.trim();
    const isActive = document.getElementById('server-form-active').checked;

    const payload = { name, targetUrl, email, password, totpSecret, isActive };

    let res;
    if (id) {
      res = await this.apiRequest(`/api/admin/servers/${id}`, 'PUT', payload);
    } else {
      res = await this.apiRequest('/api/admin/servers', 'POST', payload);
    }

    if (res && res.success) {
      this.showToast(id ? 'Account node updated successfully' : 'Account node added successfully', 'success');
      this.closeModals();
      this.loadAllData();
    } else {
      this.showToast((res && res.error) || 'Failed to save account node', 'error');
    }
  }

  async deleteServer(serverId) {
    const srv = this.servers.find(s => s.id === serverId);
    if (!srv || !confirm(`Delete server "${srv.name}"?`)) return;

    const res = await this.apiRequest(`/api/admin/servers/${serverId}`, 'DELETE');
    if (res && res.success) {
      this.showToast('Server node removed', 'success');
      this.loadAllData();
    }
  }

  // Settings & Masking
  async handleSaveSettings(e) {
    e.preventDefault();
    const appName = document.getElementById('setting-app-name').value.trim();
    const defaultTargetUrl = document.getElementById('setting-default-url').value.trim();
    const customCss = document.getElementById('setting-custom-css').value;

    // Collect model rules
    const modelRows = document.querySelectorAll('#model-rules-container .rule-row');
    const modelRenames = [];
    modelRows.forEach((row, i) => {
      const orig = row.querySelector('.model-orig-input').value.trim();
      const disp = row.querySelector('.model-display-input').value.trim();
      const en = row.querySelector('.model-enabled-input').checked;
      if (orig && disp) {
        modelRenames.push({ id: String(i + 1), originalName: orig, displayName: disp, enabled: en });
      }
    });

    // Collect selector rules
    const selectorRows = document.querySelectorAll('#selectors-container .selector-row');
    const cssSelectorsToHide = [];
    selectorRows.forEach(row => {
      const sel = row.querySelector('.selector-input').value.trim();
      if (sel) cssSelectorsToHide.push(sel);
    });

    const payload = { appName, defaultTargetUrl, customCss, modelRenames, cssSelectorsToHide };

    const res = await this.apiRequest('/api/admin/settings', 'PUT', payload);
    if (res && res.success) {
      this.showToast('Browser branding and masking rules updated', 'success');
      this.loadSettings();
    }
  }

  closeModals() {
    this.userModal.classList.add('hidden');
    this.serverModal.classList.add('hidden');
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3500);
  }
}

const app = new AdminApp();
