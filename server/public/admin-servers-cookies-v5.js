/**
 * Additive v5 admin UI for cookie JSON upload / sorted expiry preview.
 * Loaded after app.js — extends FlowAdminApp prototype when present.
 */
(function () {
  'use strict';

  function formatExpiry(previewRow) {
    if (!previewRow || previewRow.session || previewRow.expirationDate == null) {
      return 'session';
    }
    const ms = Number(previewRow.expirationDate) * 1000;
    if (!Number.isFinite(ms)) return '—';
    const iso = previewRow.expiresAtIso || new Date(ms).toISOString();
    const days = Math.round((ms - Date.now()) / (24 * 60 * 60 * 1000));
    const rel = days >= 0 ? `in ${days}d` : `${Math.abs(days)}d ago`;
    return `${iso} (${rel})`;
  }

  function renderCookieTable(meta) {
    const tbody = document.getElementById('server-cookies-tbody');
    const summary = document.getElementById('server-cookies-summary');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!meta || !Array.isArray(meta.sortedPreview) || !meta.sortedPreview.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center py-2">No cookies uploaded yet</td></tr>';
      if (summary) summary.textContent = '';
      return;
    }
    if (summary) {
      const earliest = meta.earliestExpiryIso
        ? `Earliest expiry: ${meta.earliestExpiryIso}`
        : `${meta.sessionCount || 0} session cookie(s)`;
      summary.textContent = `${meta.count} cookies · ${earliest} · v-meta ready`;
    }
    for (const row of meta.sortedPreview) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td><code>${escapeHtml(row.name)}</code></td>` +
        `<td>${escapeHtml(row.domain)}${escapeHtml(row.path || '/')}</td>` +
        `<td>${escapeHtml(formatExpiry(row))}</td>` +
        `<td><code style="font-size:0.7rem">${escapeHtml((row.valueHash || '').slice(0, 12))}…</code></td>`;
      tbody.appendChild(tr);
    }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function attach() {
    const App = window.app && window.app.constructor ? window.app.constructor : null;
    const proto = App && App.prototype;
    if (!proto || proto.__cookiesV5Attached) {
      // Instance methods on live app object
      if (window.app && !window.app.__cookiesV5Attached) {
        bindInstance(window.app);
      }
      return;
    }
    proto.__cookiesV5Attached = true;
  }

  function bindInstance(app) {
    if (!app || app.__cookiesV5Attached) return;
    app.__cookiesV5Attached = true;

    const origOpenAdd = app.openAddServerModal.bind(app);
    const origOpenEdit = app.openEditServerModal.bind(app);

    app.openAddServerModal = function () {
      origOpenAdd();
      resetCookiePanel();
    };

    app.openEditServerModal = function (serverId) {
      origOpenEdit(serverId);
      const server = this.servers.find((s) => s.id === serverId);
      const versionEl = document.getElementById('server-cookies-version');
      if (versionEl) {
        versionEl.textContent = server?.hasCookies
          ? `Cookie pack v${server.cookieVersion}`
          : 'No cookie pack';
      }
      renderCookieTable(server?.cookieMeta || null);
      const ta = document.getElementById('server-form-cookies-json');
      if (ta) ta.value = '';
    };

    app.uploadServerCookiesV5 = async function () {
      const id = document.getElementById('server-form-id').value;
      if (!id) {
        this.showToast('Save the account node first, then upload cookies', 'error');
        return;
      }
      const text = document.getElementById('server-form-cookies-json').value;
      const res = await this.apiRequest(`/api/admin/servers/${id}/cookies`, 'PUT', {
        cookies: text,
      });
      if (res && res.success) {
        this.showToast(res.message || 'Cookies uploaded', 'success');
        renderCookieTable(res.meta);
        const versionEl = document.getElementById('server-cookies-version');
        if (versionEl) versionEl.textContent = `Cookie pack v${res.server?.cookieVersion || ''}`;
        await this.loadAllData();
      } else {
        this.showToast((res && res.error) || 'Cookie upload failed', 'error');
      }
    };

    app.clearServerCookiesV5 = async function () {
      const id = document.getElementById('server-form-id').value;
      if (!id) return;
      if (!confirm('Clear stored cookie export for this account?')) return;
      const res = await this.apiRequest(`/api/admin/servers/${id}/cookies`, 'DELETE');
      if (res && res.success) {
        this.showToast('Cookies cleared', 'success');
        resetCookiePanel();
        await this.loadAllData();
      } else {
        this.showToast((res && res.error) || 'Could not clear cookies', 'error');
      }
    };

    app.refreshServerCookiesMetaV5 = async function () {
      const id = document.getElementById('server-form-id').value;
      if (!id) return;
      const res = await this.apiRequest(`/api/admin/servers/${id}/cookies/meta`);
      if (res && res.success) {
        renderCookieTable(res.meta);
        const versionEl = document.getElementById('server-cookies-version');
        if (versionEl) {
          versionEl.textContent = res.hasCookies
            ? `Cookie pack v${res.cookieVersion}`
            : 'No cookie pack';
        }
      }
    };

    const uploadBtn = document.getElementById('btn-upload-server-cookies');
    const clearBtn = document.getElementById('btn-clear-server-cookies');
    const refreshBtn = document.getElementById('btn-refresh-server-cookies-meta');
    if (uploadBtn) uploadBtn.addEventListener('click', () => app.uploadServerCookiesV5());
    if (clearBtn) clearBtn.addEventListener('click', () => app.clearServerCookiesV5());
    if (refreshBtn) refreshBtn.addEventListener('click', () => app.refreshServerCookiesMetaV5());
  }

  function resetCookiePanel() {
    const ta = document.getElementById('server-form-cookies-json');
    if (ta) ta.value = '';
    const versionEl = document.getElementById('server-cookies-version');
    if (versionEl) versionEl.textContent = 'Save account first, then upload cookies';
    renderCookieTable(null);
  }

  function boot() {
    attach();
    if (window.app) bindInstance(window.app);
    else {
      const timer = setInterval(() => {
        if (window.app) {
          clearInterval(timer);
          bindInstance(window.app);
        }
      }, 200);
      setTimeout(() => clearInterval(timer), 10000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
