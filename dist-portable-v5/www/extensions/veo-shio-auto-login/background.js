// Flow Browser Auto Login Extension Background Service Worker
// Connects to the Flow Browser backend (https://flowcreatorai.site)

const API_ORIGIN = "https://flowcreatorai.site";
/** Active base path — resolved from /api/public/branding (v2 or v3). */
let CLIENT_API_PATH = "/api/v2/client";
const FLOW_URL = "https://flow.google.com/";
const GOOGLE_LOGOUT = "https://accounts.google.com/Logout";

function normalizeClientApiVersion(value) {
  return String(value || "").toLowerCase() === "v3" ? "v3" : "v2";
}

function originFromSavedUrl(value) {
  let base = String(value || API_ORIGIN).replace(/\/$/, "");
  base = base.replace(/\/api\/v[23]\/client$/i, "").replace(/\/api\/client$/i, "");
  return base || API_ORIGIN;
}

async function resolveClientApiPath(origin, force = false) {
  const base = originFromSavedUrl(origin);
  try {
    const res = await fetch(`${base}/api/public/branding`, { cache: "no-store" });
    const data = await res.json();
    const ver = normalizeClientApiVersion(
      data?.settings?.clientApiVersion ?? data?.clientApiVersion
    );
    CLIENT_API_PATH = `/api/${ver}/client`;
  } catch (err) {
    if (!force) console.warn("[VeoShio] branding failed, keeping", CLIENT_API_PATH, err);
  }
  return `${base}${CLIENT_API_PATH}`;
}

function isFlowUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "flow.google.com"; }
  catch { return false; }
}
function isGoogleLoginUrl(value) {
  try { return new URL(value).origin === "https://accounts.google.com"; }
  catch { return false; }
}
function allowedNavigation(value) {
  return isFlowUrl(value) || isGoogleLoginUrl(value);
}
function createNavigationRules() {
  // Profile/DNR redirects removed — auto-login only.
  return [];
}
function validCredentialSender(sender, session) {
  return !!session && session.phase === "login" && sender.frameId === 0 &&
    sender.tab?.id === session.tabId &&
    isGoogleLoginUrl(sender.url) && Date.parse(session.expiresAt) > Date.now();
}

function createSiteOnboarding() {
  return {
    isSiteSender: () => false,
    handle: () => Promise.reject(new Error("Site onboarding is not available."))
  };
}

function createExtensionProtection({ chrome, isEnabled }) {
  return {
    scan: async () => {},
    restore: async () => {},
    status: async () => ({ items: [], results: [], status: { errors: [] }, message: "Flow Browser Protection Active" })
  };
}

const supportedBrowser = true;
let operationBusy = false;
let ruleUpdates = Promise.resolve();
let lifecycleUpdates = Promise.resolve();

const SESSION_PREFIX = "bfTransient:";
const sessionStore = chrome.storage.session ?? {
  async get(keys) {
    const names = Array.isArray(keys) ? keys : [keys];
    const records = await chrome.storage.local.get(names.map(name => SESSION_PREFIX + name));
    const result = {};
    for (const name of names) {
      const record = records[SESSION_PREFIX + name];
      if (record?.until > Date.now()) result[name] = record.value;
      else if (record) await chrome.storage.local.remove(SESSION_PREFIX + name);
    }
    return result;
  },
  async set(items) {
    const records = {};
    for (const [name, value] of Object.entries(items)) {
      const expiry = typeof value?.expiresAt === "number" ? value.expiresAt : Date.parse(value?.expiresAt);
      const until = name !== "workspace" && Number.isFinite(expiry) ? Math.min(expiry, Date.now() + 86400000) : Date.now() + 86400000;
      records[SESSION_PREFIX + name] = { value, until };
    }
    await chrome.storage.local.set(records);
  },
  async remove(keys) { await chrome.storage.local.remove((Array.isArray(keys) ? keys : [keys]).map(name => SESSION_PREFIX + name)); }
};

const initialize = Promise.all([chrome.storage.local, sessionStore].map(async area => {
  if (typeof area?.setAccessLevel === "function") await area.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
})).then(() => null, () => new Error("The browser could not protect extension storage."));

// ─── Local State ────────────────────────────────────────────────────────────
const localState = async () => {
  const error = await initialize;
  if (error) throw error;
  return chrome.storage.local.get([
    "flowBrowserToken", "flowBrowserServerUrl", "flowBrowserUser",
    "flowBrowserActiveServer", "profileProtectionEnabled"
  ]);
};

const isConnected = async () => {
  const saved = await localState();
  return !!saved.flowBrowserToken;
};

// ─── API Client ─────────────────────────────────────────────────────────────
async function api(path, body, anonymous = false) {
  const saved = await localState();
  const origin = originFromSavedUrl(saved.flowBrowserServerUrl || API_ORIGIN);
  let baseUrl = await resolveClientApiPath(origin);
  const token = saved.flowBrowserToken;

  if (!anonymous && !token) throw new Error("Not connected. Log in to Flow Browser first.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const doFetch = async (url) => {
      const response = await fetch(url, {
        method: body === undefined ? "GET" : "POST",
        cache: "no-store",
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(!anonymous && token ? { Authorization: `Bearer ${token}` } : {})
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal
      });
      const result = await response.json().catch(() => ({}));
      return { response, result };
    };

    let { response, result } = await doFetch(`${baseUrl}${path}`);
    // Hard cutover: branding flipped to v3 while we were on v2
    if (result && result.code === "FORCE_UPDATE") {
      const prev = baseUrl;
      baseUrl = await resolveClientApiPath(origin, true);
      if (baseUrl !== prev) {
        ({ response, result } = await doFetch(`${baseUrl}${path}`));
      }
    }
    if (!response.ok) throw Object.assign(
      new Error(result.error || result.message || `Request failed (${response.status}).`),
      { status: response.status, code: result.code }
    );
    return result;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("The server did not respond. Check that the admin server is running.");
    throw error;
  } finally { clearTimeout(timeout); }
}

// ─── Extension Protection ───────────────────────────────────────────────────
const extensionProtection = createExtensionProtection({
  chrome, isEnabled: async () => supportedBrowser && (await localState()).profileProtectionEnabled === true
});
async function protectionStatus() {
  return { ...(await extensionProtection.status()), enabled: (await localState()).profileProtectionEnabled === true };
}

// ─── Workspace (login attempt state) ────────────────────────────────────────
const workspace = async () => (await sessionStore.get("workspace")).workspace || null;
let workspaceMutations = Promise.resolve();
function queueWorkspaceMutation(operation) {
  const next = workspaceMutations.catch(() => {}).then(operation);
  workspaceMutations = next.catch(() => {});
  return next;
}
function normaliseOtpWindows(value) {
  return Array.isArray(value) ? [...new Set(value.filter(item =>
    typeof item === "string" && Number.isFinite(Date.parse(item))))].slice(-2) : [];
}
function mergeOtpMetadata(current, next) {
  if (!current || !next || current.attemptId !== next.attemptId) return next;
  const currentWindows = normaliseOtpWindows(current.otpRejectedWindows);
  const nextWindows = normaliseOtpWindows(next.otpRejectedWindows);
  const currentExpiry = otpLastExpiresAt(current);
  const nextExpiry = otpLastExpiresAt(next);
  const newestExpiry = [currentExpiry, nextExpiry].filter(Boolean)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;
  return {
    ...next,
    otpSubmissionCount: Math.max(otpSubmissionCount(current), otpSubmissionCount(next)),
    otpLastExpiresAt: newestExpiry,
    otpRejectedWindows: [...new Set([...currentWindows, ...nextWindows])].slice(-2),
    otpFetchFailureCount: Math.max(Number(current.otpFetchFailureCount) || 0, Number(next.otpFetchFailureCount) || 0)
  };
}
const writeWorkspace = async (state, { resetOtp = false } = {}) => {
  const next = resetOtp ? state : mergeOtpMetadata(await workspace(), state);
  await sessionStore.set({ workspace: next });
  return next;
};
const saveWorkspace = (state, options = {}) => queueWorkspaceMutation(() => writeWorkspace(state, options));
const mutateWorkspace = mutator => queueWorkspaceMutation(async () => {
  const current = await workspace();
  const next = await mutator(current);
  if (next === undefined) return current;
  return writeWorkspace(next);
});

// ─── OTP Helpers ────────────────────────────────────────────────────────────
const otpFetchFailureCount = state => {
  const value = Number(state?.otpFetchFailureCount);
  return Number.isInteger(value) && value >= 0 ? value : 0;
};
const backupCodeRequestsInFlight = new Set();
const BACKUP_CODE_MANUAL_DETAIL = "A backup code was already requested for this sign-in attempt. Complete the backup-code challenge manually, then click Resume sign-in.";
const BACKUP_CODE_FAILURE_DETAIL = "A backup code could not be loaded. Ask the administrator to check the remaining backup codes, then click Resume sign-in.";
const OTP_AUTOMATIC_LIMIT = 2;
const otpSubmissionReservations = new Set();
const otpFailureReservations = new Set();
const OTP_SUBMIT_DETAIL = "The verification-code attempt is no longer available. Continue manually or start a fresh sign-in.";
const OTP_METADATA_DETAIL = "The verification-code attempt could not be safely recorded. Continue manually or start a fresh sign-in.";
const ALTERNATE_AUTHENTICATOR_ROUTE_LIMIT = 1;
function alternateAuthenticatorRouteCount(state) {
  const value = Number(state?.alternateAuthenticatorRouteCount);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}
function otpSubmissionCount(state) {
  const value = Number(state?.otpSubmissionCount);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}
function otpLastExpiresAt(state) {
  const value = state?.otpLastExpiresAt;
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}
function otpMetadata(state) {
  return {
    otpSubmissionCount: otpSubmissionCount(state),
    otpLastExpiresAt: otpLastExpiresAt(state),
    otpRejectedWindows: normaliseOtpWindows(state?.otpRejectedWindows),
    otpFetchFailureCount: otpFetchFailureCount(state)
  };
}
async function recordOtpFetchFailure(state) {
  const attemptId = state?.attemptId;
  if (!attemptId || otpFailureReservations.has(attemptId)) return;
  otpFailureReservations.add(attemptId);
  try {
    await mutateWorkspace(async current => {
      if (!current || current.attemptId !== attemptId || current.phase !== "login") {
        throw new Error(OTP_METADATA_DETAIL);
      }
      return { ...current, otpFetchFailureCount: otpFetchFailureCount(current) + 1 };
    });
  } finally {
    otpFailureReservations.delete(attemptId);
  }
}
async function recordOtpRejection(state, expiresAt) {
  const attemptId = state?.attemptId;
  const expiry = typeof expiresAt === "string" ? Date.parse(expiresAt) : NaN;
  if (!attemptId || !Number.isFinite(expiry)) throw new Error(OTP_METADATA_DETAIL);
  return mutateWorkspace(async current => {
    const metadata = otpMetadata(current);
    if (!current || current.attemptId !== attemptId || current.phase !== "login" ||
        metadata.otpSubmissionCount < 1 ||
        Date.parse(metadata.otpLastExpiresAt || "") === expiry) {
      throw new Error(OTP_METADATA_DETAIL);
    }
    if (metadata.otpRejectedWindows.includes(new Date(expiry).toISOString())) return current;
    return {
      ...current,
      otpRejectedWindows: [...metadata.otpRejectedWindows, new Date(expiry).toISOString()].slice(-2)
    };
  });
}

// ─── Tab and Automation Helpers ─────────────────────────────────────────────
const managedTabs = state => state ? [...new Set([state.tabId, ...(state.managedTabIds || []), ...(state.openerStack || []).map(tab => tab.tabId)])] : [];
const loginInProgress = state => !!state && ["login", "manual"].includes(state.phase) && Date.parse(state.expiresAt) > Date.now();
const redirectingTabs = new Set();
const automationHealth = new Map();

function normaliseEmail(value) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
function assignedEmail(status) {
  return normaliseEmail(status?.assignedAccount?.email);
}
function isAuthenticatorChallengeUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" &&
      parsed.hostname === "accounts.google.com" &&
      /(?:^|\/)challenge\/totp(?:\/|$)/i.test(parsed.pathname);
  } catch { return false; }
}
function isAlternateAuthenticatorChallengeUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" &&
      parsed.hostname === "accounts.google.com" &&
      /(?:^|\/)challenge\/(?:skotp|dp|az|ipp|security[-_]?code|sms|phone|ootp|email|wa|u2f|security[-_]?key)(?:\/|$)/i.test(parsed.pathname);
  } catch { return false; }
}

async function focusTab(tab) {
  if (!tab) return;
  try { if (chrome.windows?.update && Number.isInteger(tab.windowId)) await chrome.windows.update(tab.windowId, { focused: true }); } catch {}
  await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
}

function updateAutomationHealth(state, patch) {
  if (!state) return;
  const old = automationHealth.get(state.tabId);
  automationHealth.set(state.tabId, {
    ...(old?.attemptId === state.attemptId ? old : {}),
    attemptId: state.attemptId, ...patch
  });
  if (automationHealth.size > 30) automationHealth.delete(automationHealth.keys().next().value);
}
function workspaceHealthStatus(state) {
  if (!state || state.phase !== "login") return state;
  if (!loginInProgress(state)) return { ...state, phase: "error", detail: "Login attempt expired. Click Open / resume Flow to start a fresh sign-in." };
  const health = automationHealth.get(state.tabId);
  if (health?.attemptId === state.attemptId) {
    if (health.problem) return { ...state, detail: health.problem };
    if (health.seenAt && Date.now() - health.seenAt < 15000) {
      return { ...state, detail: health.stage
        ? `Sign-in automation is running: ${health.stage} step.`
        : "Sign-in page connected. Looking for the Flow sign-in button or Google login form." };
    }
  }
  return { ...state, detail: "Waiting for the sign-in page to respond. If it stays here, click Open / resume Flow." };
}
function workspaceStatus(state) {
  if (!state) return null;
  let visible = workspaceHealthStatus(state);
  if (visible.phase === "manual" && !loginInProgress(state)) {
    visible = { ...visible, phase: "error", detail: "Login attempt expired. Start a fresh sign-in." };
  }
  const health = automationHealth.get(state.tabId);
  const currentHealth = health?.attemptId === state.attemptId ? health : null;
  const stage = currentHealth?.stage;
  const percent = visible.phase === "ready" ? 100 : ({ email: 30, password: 55, otp: 80, backup_code: 85 }[stage] || 10);
  const progressState = visible.phase === "ready" ? "complete"
    : visible.phase === "manual" ? "attention"
    : visible.phase === "error" || currentHealth?.problem ? "error" : "running";
  const label = progressState === "complete" ? "Flow login complete"
    : progressState === "attention" || progressState === "error" ? visible.detail
    : ({ email: "Entering email", password: "Entering password", otp: "Verifying security code", backup_code: "Verifying backup code" }[stage] || "Opening Flow and checking sign-in");
  return { ...visible, progress: { percent, label, state: progressState } };
}

async function ensureAutomation(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || (!isFlowUrl(tab.url) && !isGoogleLoginUrl(tab.url))) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["browser-guard.js", "automation.js"]
    });
  } catch {
    const state = await workspace();
    if (state?.tabId === tabId) updateAutomationHealth(state, {
      problem: "The browser blocked sign-in automation. Allow this extension to run on Flow and Google Accounts, then click Open / resume Flow."
    });
  }
}

// ─── Navigation Rules ───────────────────────────────────────────────────────
const profileRedirectsEnabled = () => false;

function refreshRules() {
  // DNR / profile containment disabled for slim auto-login build.
  return Promise.resolve();
}

async function recordProblem(message, phase = "manual", manualReason) {
  const state = await workspace();
  if (!state) return;
  const nextManualReason = manualReason === undefined
    ? phase === "manual" ? state.manualReason || null : null
    : manualReason;
  await saveWorkspace({ ...state, phase, manualReason: nextManualReason, detail: message });
  await refreshRules();
}

// ─── Identity Verification ──────────────────────────────────────────────────
async function verifyAttemptIdentity(state = null, attemptId = null) {
  const status = await api("/extension-status");
  const statusEmail = assignedEmail(status);
  const previous = normaliseEmail(state?.expectedEmail);
  if (previous && statusEmail && previous !== statusEmail) {
    throw new Error("The admin-assigned Google account changed. Start a fresh sign-in.");
  }
  let email = previous || statusEmail;
  if (!email && attemptId) {
    const step = await api("/extension-step", { attemptId, stage: "email" });
    const stepEmail = normaliseEmail(step?.value);
    if (!stepEmail) throw new Error("Could not verify the assigned Google account. Ask the admin to configure server credentials.");
    email = stepEmail;
  }
  if (!email) {
    throw new Error("No Google account assigned. Ask the administrator to configure a server with Google credentials.");
  }
  return email;
}

// ─── Login Flow ─────────────────────────────────────────────────────────────
async function bindLoginToTab(tab, { navigateToFlow = false } = {}) {
  const tabId = tab?.id;
  if (!Number.isInteger(tabId)) throw new Error("The browser could not find the Flow tab.");

  const current = await workspace();
  if (current && loginInProgress(current) && current.tabId === tabId) {
    const expectedEmail = await verifyAttemptIdentity(current, current.attemptId).catch(() => current.expectedEmail);
    await saveWorkspace({
      ...current,
      expectedEmail: expectedEmail || current.expectedEmail,
      phase: "login",
      manualReason: null,
      detail: "Sign-in automation is active."
    });
    return current;
  }

  if (current?.attemptId) {
    await api("/extension-finish", { attemptId: current.attemptId, outcome: "cancelled" }).catch(() => {});
  }

  const attempt = await api("/extension-start", {});
  if (!attempt.attemptId || !attempt.expiresAt) throw new Error("The server returned an invalid login attempt.");

  let expectedEmail;
  try {
    expectedEmail = await verifyAttemptIdentity(null, attempt.attemptId);
  } catch (error) {
    await api("/extension-finish", { attemptId: attempt.attemptId, outcome: "cancelled" }).catch(() => {});
    throw error;
  }

  const next = {
    windowId: tab.windowId,
    tabId,
    managedTabIds: [tabId],
    ownedTabIds: [],
    attemptId: attempt.attemptId,
    expiresAt: attempt.expiresAt,
    expectedEmail,
    phase: "login",
    otpSubmissionCount: 0,
    otpLastExpiresAt: null,
    otpRejectedWindows: [],
    otpFetchFailureCount: 0,
    authenticatorLockout: false,
    detail: "Opening Flow in this browser profile."
  };
  await saveWorkspace(next, { resetOtp: true });
  await refreshRules();
  automationHealth.delete(tabId);

  if (navigateToFlow && !isGoogleLoginUrl(tab.url) && !isFlowUrl(tab.url)) {
    await chrome.tabs.update(tabId, { url: FLOW_URL, active: true });
  } else if (navigateToFlow && isFlowUrl(tab.url) === false && isGoogleLoginUrl(tab.url) === false) {
    await chrome.tabs.update(tabId, { url: FLOW_URL, active: true });
  }

  await ensureAutomation(tabId);
  await chrome.tabs.sendMessage(tabId, { type: "RESUME" }).catch(() => {});
  await armConnectionCheck();
  return next;
}

async function startLogin(preferredWindowId, forceFresh = false) {
  const connected = await isConnected();
  if (!connected) throw new Error("Not connected. Log in to Flow Browser first.");

  const current = await workspace();
  const currentTab = current ? await chrome.tabs.get(current.tabId).catch(() => null) : null;
  if (currentTab) {
    await focusTab(currentTab);
    if (current.phase === "ready" && !forceFresh) return { message: "Your existing Flow tab is already open." };
    if (!forceFresh && ["login", "manual"].includes(current.phase) &&
        Date.parse(current.expiresAt) > Date.now()) {
      try {
        await bindLoginToTab(currentTab, { navigateToFlow: false });
        return { message: "Sign-in resumed." };
      } catch (error) {
        await recordProblem(error.message || "The assigned Google account could not be verified.", "error");
        throw error;
      }
    }
    await api("/extension-finish", { attemptId: current.attemptId, outcome: "cancelled" }).catch(() => {});
    await saveWorkspace(null);
    await refreshRules();
  }

  let tab;
  let createdTab = false;
  try {
    let windowId = currentTab?.windowId ?? preferredWindowId ?? null;
    if (!Number.isInteger(windowId)) {
      try { windowId = (await chrome.windows.getLastFocused({ windowTypes: ["normal"] })).id ?? null; } catch { windowId = null; }
    }
    const scope = Number.isInteger(windowId) ? { windowId } : {};
    const existing = currentTab
      || (await chrome.tabs.query(scope)).find(candidate => isFlowUrl(candidate.url) || isGoogleLoginUrl(candidate.url))
      || (await chrome.tabs.query(scope))[0];
    if (existing) {
      tab = existing;
    } else {
      tab = await chrome.tabs.create({ ...scope, url: "about:blank", active: true });
      createdTab = true;
    }
    await bindLoginToTab(tab, { navigateToFlow: !isGoogleLoginUrl(tab.url) });
    if (createdTab) {
      const state = await workspace();
      if (state) {
        await saveWorkspace({ ...state, ownedTabIds: [tab.id] });
      }
    }
    await startProfileRedirects();
    return { message: "Flow opened. Sign-in is starting." };
  } catch (error) {
    await saveWorkspace(null);
    await refreshRules();
    if (createdTab && tab?.id) await chrome.tabs.remove(tab.id).catch(() => {});
    throw error;
  }
}

async function armConnectionCheck() {
  await chrome.alarms.create("flow-auto-login-check", { periodInMinutes: 1 });
}

async function closeOwnedTabs(state) {
  for (const tabId of state?.ownedTabIds || []) await chrome.tabs.remove(tabId).catch(() => {});
}

async function openGoogleLogoutTab() {
  const tab = await chrome.tabs.create({ url: "about:blank" });
  await sessionStore.set({ logoutGrant: { tabId: tab.id, expiresAt: Date.now() + 120000 } });
  await refreshRules();
  await chrome.tabs.update(tab.id, { url: GOOGLE_LOGOUT });
  return tab;
}

async function closeAllFlowTabs(except = null) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!Number.isInteger(tab?.id) || tab.id === except || !isFlowUrl(tab.url)) continue;
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function clearLocalConnection(state) {
  // Do NOT remove flowBrowserToken — that's managed by the Electron shell
  await saveWorkspace(null);
  await refreshRules();
  await chrome.alarms.clear("flow-auto-login-check");
  await closeOwnedTabs(state);
}

async function disconnect(signOut) {
  const state = await workspace();
  await clearLocalConnection(state);
  if (signOut) await openGoogleLogoutTab();
  return { message: signOut ? "Disconnected. Complete Google sign-out in the opened tab." : "Disconnected. Your existing Google session may still be signed in." };
}

// ─── Message Handler ────────────────────────────────────────────────────────
async function messageHandler(message, sender) {
  const fromPopup = sender.id === chrome.runtime.id && sender.url?.split("?")[0] === chrome.runtime.getURL("popup.html");

  if (message?.type === "BROWSER_SUPPORT") {
    return { supportedBrowser };
  }

  if (!supportedBrowser) {
    if (message?.type === "CONTEXT") return { managed: false, active: false, supportedBrowser: false };
    if (message?.type === "STATUS" && fromPopup) return { connected: false, supportedBrowser: false };
  }

  const state = await workspace();
  const fromLoginTab = sender.id === chrome.runtime.id && sender.frameId === 0 &&
    Number.isInteger(sender.tab?.id) && sender.tab.id === state?.tabId &&
    sender.tab.windowId === state?.windowId && (isFlowUrl(sender.url) || isGoogleLoginUrl(sender.url));

  if (message?.type === "LOGIN_PROGRESS") {
    return { progress: fromLoginTab ? workspaceStatus(state)?.progress || null : null };
  }

  if (message?.type === "CONTEXT") {
    const onAuthHost = sender.id === chrome.runtime.id && sender.frameId === 0 &&
      Number.isInteger(sender.tab?.id) && (isFlowUrl(sender.url) || isGoogleLoginUrl(sender.url));

    // Electron webview guests sometimes omit sender.tab — still auto-bind using any Google/Flow tab.
    if (onAuthHost && await isConnected()) {
      let stateNow = await workspace();
      const boundHere = stateNow && loginInProgress(stateNow) &&
        (!sender.tab?.id || stateNow.tabId === sender.tab.id);
      if (!boundHere) {
        try {
          let tab = sender.tab;
          if (!tab || !Number.isInteger(tab.id)) {
            const tabs = await chrome.tabs.query({});
            tab = tabs.find(t => t.id === sender.tab?.id) ||
              tabs.find(t => isGoogleLoginUrl(t.url) || isFlowUrl(t.url)) ||
              tabs[0];
          }
          if (tab && Number.isInteger(tab.id)) {
            await bindLoginToTab(tab, { navigateToFlow: false });
          }
        } catch (error) {
          console.warn("[Flow Auto Login] auto-bind failed:", error.message || error);
        }
      }
    }

    const stateFresh = await workspace();
    const fromLoginTabNow = sender.id === chrome.runtime.id && sender.frameId === 0 &&
      Number.isInteger(sender.tab?.id) && sender.tab.id === stateFresh?.tabId &&
      (isFlowUrl(sender.url) || isGoogleLoginUrl(sender.url));

    if (fromLoginTabNow) updateAutomationHealth(stateFresh, { seenAt: Date.now(), problem: null });
    if (sender.id === chrome.runtime.id && sender.frameId === 0 && Number.isInteger(sender.tab?.id) && isFlowUrl(sender.url)) {
      const live = fromLoginTabNow && loginInProgress(stateFresh);
      const connected = await isConnected();
      return {
        managed: true, active: live && stateFresh.phase === "login", phase: live ? stateFresh.phase : "ready",
        allowLaunch: connected && (live || stateFresh?.phase === "ready"),
        expectedEmail: live && stateFresh.phase === "login" ? stateFresh.expectedEmail || null : null,
        manualReason: live ? stateFresh.manualReason || null : null, expiresAt: live ? stateFresh.expiresAt : null,
        ...(live && stateFresh.phase === "login" ? {
          attemptId: stateFresh.attemptId,
          alternateAuthenticatorRouteAttempted: alternateAuthenticatorRouteCount(stateFresh) >= ALTERNATE_AUTHENTICATOR_ROUTE_LIMIT,
          backupCodeAttempted: stateFresh.backupCodeAttempted === true,
          authenticatorLockout: stateFresh.authenticatorLockout === true,
          ...otpMetadata(stateFresh)
        } : {})
      };
    }
    if (!fromLoginTabNow) return { managed: false, active: false };
    const live = loginInProgress(stateFresh);
    return {
      managed: true, active: live && stateFresh.phase === "login", phase: live ? stateFresh.phase : "error",
      expectedEmail: live && stateFresh.phase === "login" ? stateFresh.expectedEmail || null : null,
      manualReason: live ? stateFresh.manualReason || null : null, expiresAt: stateFresh.expiresAt,
      ...(live && stateFresh.phase === "login" ? {
        attemptId: stateFresh.attemptId,
        alternateAuthenticatorRouteAttempted: alternateAuthenticatorRouteCount(stateFresh) >= ALTERNATE_AUTHENTICATOR_ROUTE_LIMIT,
        backupCodeAttempted: stateFresh.backupCodeAttempted === true,
        authenticatorLockout: stateFresh.authenticatorLockout === true,
        ...otpMetadata(stateFresh)
      } : {})
    };
  }

  // ─── Authenticator / OTP Handlers (unchanged) ─────────────────────────────
  if (message?.type === "ALTERNATE_AUTHENTICATOR_ROUTE") {
    const latest = await workspace();
    const validRouteSender = latest && latest.phase === "login" &&
      loginInProgress(latest) &&
      message.attemptId === latest.attemptId &&
      isAlternateAuthenticatorChallengeUrl(sender.url) &&
      validCredentialSender(sender, latest);
    if (!validRouteSender) throw new Error("The alternate authenticator route could not be safely recorded.");
    let reserved = false;
    const committed = await mutateWorkspace(async current => {
      if (!current || current.phase !== "login" || !loginInProgress(current) ||
          current.attemptId !== latest.attemptId ||
          !isAlternateAuthenticatorChallengeUrl(sender.url) ||
          !validCredentialSender(sender, current)) {
        throw new Error("The alternate authenticator route could not be safely recorded.");
      }
      const count = alternateAuthenticatorRouteCount(current);
      if (count >= ALTERNATE_AUTHENTICATOR_ROUTE_LIMIT) return current;
      reserved = true;
      return { ...current, alternateAuthenticatorRouteCount: count + 1 };
    });
    return { reserved, attempted: alternateAuthenticatorRouteCount(committed) >= ALTERNATE_AUTHENTICATOR_ROUTE_LIMIT };
  }

  if (message?.type === "AUTHENTICATOR_LOCKOUT") {
    const latest = await workspace();
    const validLockoutSender = latest && latest.phase === "login" &&
      loginInProgress(latest) &&
      message.attemptId === latest.attemptId &&
      isAuthenticatorChallengeUrl(sender.url) &&
      validCredentialSender(sender, latest);
    if (!validLockoutSender) throw new Error("The authenticator lockout could not be safely recorded.");
    const committed = await mutateWorkspace(async current => {
      if (!current || current.phase !== "login" || !loginInProgress(current) ||
          current.attemptId !== latest.attemptId ||
          !isAuthenticatorChallengeUrl(sender.url) ||
          !validCredentialSender(sender, current)) {
        throw new Error("The authenticator lockout could not be safely recorded.");
      }
      return { ...current, authenticatorLockout: true };
    });
    if (!committed?.authenticatorLockout) throw new Error("The authenticator lockout could not be safely recorded.");
    return { recorded: true };
  }

  if (message?.type === "OTP_SUBMIT") {
    const latest = await workspace();
    const senderIsCredentialTab = validCredentialSender(sender, latest);
    if (!senderIsCredentialTab || (message.attemptId != null && message.attemptId !== latest.attemptId)) {
      throw new Error("This tab is not authorized for automatic sign-in.");
    }
    const expiresAt = typeof message.expiresAt === "string" ? message.expiresAt : "";
    const expiry = Date.parse(expiresAt);
    if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error(OTP_SUBMIT_DETAIL);
    const current = otpMetadata(latest);
    if (current.otpSubmissionCount >= OTP_AUTOMATIC_LIMIT ||
        (current.otpLastExpiresAt && Date.parse(current.otpLastExpiresAt) === expiry) ||
        otpSubmissionReservations.has(latest.attemptId)) {
      throw new Error(OTP_SUBMIT_DETAIL);
    }
    otpSubmissionReservations.add(latest.attemptId);
    try {
      const committed = await mutateWorkspace(async state => {
        if (!state || state.attemptId !== latest.attemptId ||
            !validCredentialSender(sender, state)) throw new Error(OTP_SUBMIT_DETAIL);
        const metadata = otpMetadata(state);
        if (metadata.otpSubmissionCount >= OTP_AUTOMATIC_LIMIT ||
            (metadata.otpLastExpiresAt && Date.parse(metadata.otpLastExpiresAt) === expiry)) {
          throw new Error(OTP_SUBMIT_DETAIL);
        }
        return {
          ...state,
          otpSubmissionCount: metadata.otpSubmissionCount + 1,
          otpLastExpiresAt: new Date(expiry).toISOString()
        };
      });
      if (!committed || committed.attemptId !== latest.attemptId ||
          otpSubmissionCount(committed) < 1 ||
          Date.parse(otpLastExpiresAt(committed) || "") !== expiry) {
        throw new Error(OTP_METADATA_DETAIL);
      }
      return { reserved: true };
    } finally {
      otpSubmissionReservations.delete(latest.attemptId);
    }
  }

  if (message?.type === "OTP_REJECTED") {
    const latest = await workspace();
    if (!validCredentialSender(sender, latest) || message.attemptId !== latest?.attemptId) {
      throw new Error(OTP_METADATA_DETAIL);
    }
    const saved = await recordOtpRejection(latest, message.expiresAt);
    return otpMetadata(saved);
  }

  // ─── Credential Step Handler ──────────────────────────────────────────────
  if (message?.type === "STEP") {
    const backupCodeStep = message.stage === "backup_code";
    const backupCodeSender = backupCodeStep && state?.backupCodeAttempted === true &&
      ["login", "manual"].includes(state.phase) && sender.frameId === 0 &&
      sender.tab?.id === state.tabId && sender.tab?.windowId === state.windowId &&
      isGoogleLoginUrl(sender.url) && Date.parse(state.expiresAt) > Date.now();
    if ((!validCredentialSender(sender, state) && !backupCodeSender) ||
        !["email", "password", "otp"].includes(message.stage)) {
      throw new Error(message.stage === "backup_code"
        ? "Backup codes are not supported. Configure TOTP in Admin."
        : "This tab is not authorized for automatic sign-in.");
    }
    if (message.stage === "otp" && otpFetchFailureCount(state) >= 2) {
      throw new Error(OTP_SUBMIT_DETAIL);
    }
    updateAutomationHealth(state, { seenAt: Date.now(), stage: message.stage });
    const backupCodeAttemptId = backupCodeStep ? state.attemptId : null;
    if (backupCodeStep && (state.backupCodeAttempted === true ||
        backupCodeRequestsInFlight.has(backupCodeAttemptId))) {
      await recordProblem(BACKUP_CODE_MANUAL_DETAIL, "manual", "backup_code");
      throw new Error(BACKUP_CODE_MANUAL_DETAIL);
    }
    if (backupCodeStep) {
      backupCodeRequestsInFlight.add(backupCodeAttemptId);
      try {
        const committed = await mutateWorkspace(async current => {
          if (!current || current.attemptId !== state.attemptId ||
              !validCredentialSender(sender, current)) throw new Error(BACKUP_CODE_FAILURE_DETAIL);
          return { ...current, backupCodeAttempted: true };
        });
        if (!committed || committed.attemptId !== state.attemptId ||
            committed.backupCodeAttempted !== true) {
          throw new Error(BACKUP_CODE_FAILURE_DETAIL);
        }
      } catch (error) {
        backupCodeRequestsInFlight.delete(backupCodeAttemptId);
        throw error;
      }
    }
    try {
      // Fetch credential from our own backend
      const result = await api("/extension-step", { attemptId: state.attemptId, stage: message.stage });
      const current = await workspace();
      const currentBackupSender = backupCodeStep && current?.backupCodeAttempted === true &&
        ["login", "manual"].includes(current.phase) && sender.frameId === 0 &&
        sender.tab?.id === current.tabId && sender.tab?.windowId === current.windowId &&
        isGoogleLoginUrl(sender.url) && Date.parse(current.expiresAt) > Date.now();
      if (!current || current.attemptId !== state.attemptId ||
          !(validCredentialSender(sender, current) || currentBackupSender)) {
        throw Object.assign(new Error("The sign-in attempt changed before the credential step completed."), { staleAttempt: true });
      }
      return { ...result, attemptId: state.attemptId };
    } catch (error) {
      if (error?.staleAttempt) throw error;
      const detail = backupCodeStep
        ? BACKUP_CODE_FAILURE_DETAIL
        : `Unable to load the ${message.stage} step${Number.isInteger(error.status) ? ` (HTTP ${error.status})` : ""}. Check the connection, then click Resume sign-in.`;
      if (message.stage === "otp") {
        try {
          await recordOtpFetchFailure(state);
          updateAutomationHealth(state, { problem: detail });
        } catch {
          throw new Error(OTP_METADATA_DETAIL);
        }
      } else await recordProblem(detail, "manual", backupCodeStep ? "backup_code" : undefined);
      throw new Error(message.stage === "backup_code" ? detail : "The sign-in step could not be loaded. Check the extension status.");
    } finally {
      if (backupCodeStep) backupCodeRequestsInFlight.delete(backupCodeAttemptId);
    }
  }

  // ─── Login Success / Manual / Mismatch ────────────────────────────────────
  if (message?.type === "LOGIN_SUCCESS") {
    if (!fromLoginTab || !isFlowUrl(sender.url) || state.phase !== "login" || !loginInProgress(state)) throw new Error("Invalid or expired login completion.");
    try {
      await api("/extension-finish", { attemptId: state.attemptId, outcome: "success" });
    } catch (error) {
      const latest = await workspace();
      if (latest?.attemptId === state.attemptId && latest.phase === "login") {
        await recordProblem(`Flow appears signed in, but could not confirm completion. Start Flow again to retry.`, "error");
      }
      throw new Error("Could not confirm login completion.");
    }
    const latest = await workspace();
    if (latest?.attemptId !== state.attemptId || latest.phase !== "login") throw new Error("The login attempt changed before completion.");
    await saveWorkspace({ ...state, phase: "ready", manualReason: null, detail: null });
    await refreshRules();
    await redirectAllTabs();
    return { ok: true };
  }

  if (message?.type === "ACCOUNT_MISMATCH") {
    if (!fromLoginTab || !isFlowUrl(sender.url) || state.phase !== "login" || !loginInProgress(state)) {
      throw new Error("Invalid or expired login completion.");
    }
    if (state.accountSwitchAttempted === true) return { redirect: false };
    await saveWorkspace({ ...state, accountSwitchAttempted: true });
    return { redirect: true };
  }

  if (message?.type === "LOGIN_MANUAL") {
    if (!fromLoginTab || !loginInProgress(state)) throw new Error("Invalid or expired login tab.");
    const captcha = message.reason === "captcha";
    const accountMismatch = message.reason === "account_mismatch";
    const accountUnverified = message.reason === "account_unverified";
    const invalidCode = message.reason === "invalid_code";
    const backupCode = message.reason === "backup_code";
    const reason = captcha ? "captcha" : accountMismatch ? "account_mismatch"
      : accountUnverified ? "account_unverified" : invalidCode ? "invalid_code"
      : backupCode ? "backup_code" : undefined;
    if (state.phase === "manual" && reason === undefined) return { ok: true };
    await recordProblem(captcha
      ? "CAPTCHA detected. Please solve it on the Google page, then click Resume sign-in."
      : accountMismatch
        ? "The signed-in Google account does not match the admin-assigned account. Use the assigned Google account, then click Resume sign-in."
        : accountUnverified
          ? "The signed-in Google account could not be verified. Use the admin-assigned Google account, then click Resume sign-in."
          : invalidCode
            ? "Google rejected the verification code. Click Resume sign-in below to request a fresh code."
            : backupCode
              ? "Google's backup code challenge needs your attention. Enter a backup code manually, then click Resume sign-in below."
            : "Google needs your attention. Complete the security prompt manually, then click Resume sign-in below.",
    "manual", reason);
    return { ok: true };
  }

  const resumeFromPage = message?.type === "RESUME_LOGIN" && fromLoginTab &&
    ["login", "manual", "error"].includes(state.phase);

  if (message?.type === "TOKEN_SYNCED") {
    await armConnectionCheck();
    return { ok: true };
  }

  if (!fromPopup && !resumeFromPage) throw new Error("This action is available only inside the extension or the active sign-in tab.");

  if (message?.type === "LOCAL_STATUS") return { workspace: workspaceStatus(state), protection: await protectionStatus() };

  if (message?.type === "STATUS") {
    const connected = await isConnected();
    let server = { connected: false };
    if (connected) {
      try { server = await api("/extension-status"); }
      catch (error) {
        if (error.status === 401 || error.status === 403) {
          return { connected: false, workspace: null, protection: await protectionStatus(),
            message: "Session expired. Log in to Flow Browser again." };
        }
        throw error;
      }
    }
    return { ...server, workspace: workspaceStatus(state), protection: await protectionStatus() };
  }

  if (operationBusy) throw new Error("An action is already in progress. Please wait.");
  operationBusy = true;
  try {
    if (message?.type === "PROTECTION_SCAN") {
      if ((await localState()).profileProtectionEnabled === true) await extensionProtection.scan();
      else await extensionProtection.restore();
      return { message: "Protection check completed." };
    }
    if (message?.type === "PROTECTION_TOGGLE") {
      if (typeof message.enabled !== "boolean") throw new Error("Choose whether to enable profile protection.");
      await chrome.storage.local.set({ profileProtectionEnabled: message.enabled });
      await startProfileRedirects();
      if (message.enabled) await extensionProtection.scan();
      else await extensionProtection.restore();
      return { message: message.enabled ? "Profile protection enabled." : "Protection paused." };
    }
    if (message?.type === "START" || resumeFromPage) {
      return await startLogin(sender.tab?.windowId, message.type === "START");
    }
    if (message?.type === "DISCONNECT") return await disconnect(message.signOut === true);
    throw new Error("Unknown extension action.");
  } finally { operationBusy = false; }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  messageHandler(message, sender).then(data => respond({ ok: true, data })).catch(async error => {
    respond({ ok: false, error: error.message || "The action could not be completed." });
  });
  return true;
});

// ─── Lifecycle ──────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(({ reason }) => {
  (async () => {
    if (supportedBrowser && (await localState()).profileProtectionEnabled === undefined) {
      await chrome.storage.local.set({ profileProtectionEnabled: false });
    }
    await bootstrap(reason === "install");
  })().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => { bootstrap(false).catch(() => {}); });
chrome.management?.onInstalled?.addListener(() => {
  if (supportedBrowser) extensionProtection.scan().catch(() => {});
});
chrome.management?.onEnabled?.addListener(info => {
  if (supportedBrowser && info.id !== chrome.runtime.id) extensionProtection.scan().catch(() => {});
});

async function injectExistingTabs() {
  if (!supportedBrowser) return;
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    let url;
    try { url = new URL(tab.url); } catch { continue; }
    let files;
    if (isFlowUrl(tab.url) || isGoogleLoginUrl(tab.url)) {
      files = ["browser-guard.js", "automation.js"];
    } else continue;
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files }).catch(() => {});
  }
}

async function bootstrap(isInstall) {
  if (supportedBrowser && await isConnected()) await armConnectionCheck();
  await startProfileRedirects().catch(() => {});
  await injectExistingTabs().catch(() => {});
  if (supportedBrowser) await extensionProtection.scan().catch(() => {});
}

// ─── Navigation Containment ─────────────────────────────────────────────────
async function containNavigation(tabId, windowId, url) {
  return;
}

async function redirectAllTabs() {
  return;
}

async function startProfileRedirects() {
  await initialize;
  await refreshRules();
  await chrome.alarms.clear("flow-profile-redirect");
}

initialize.then(() => bootstrap(false)).catch(() => {});

function flowSignInEntry(value) {
  if (!isGoogleLoginUrl(value)) return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  const entry = /^\/(?:v3\/signin\/identifier|ServiceLogin|signin|AccountChooser)\/?$/.test(url.pathname);
  const oauth = /^\/o\/oauth2\/(?:v2\/)?auth\/?$/.test(url.pathname);
  if (!entry && !oauth) return false;
  const target = url.searchParams.get(oauth ? "redirect_uri" : "continue");
  return isFlowUrl(target);
}

function adoptGoogleSignInTab(tab, url) {
  if (!supportedBrowser || !Number.isInteger(tab?.id) || !flowSignInEntry(url)) return Promise.resolve();
  lifecycleUpdates = lifecycleUpdates.catch(() => {}).then(async () => {
    const state = await workspace();
    if (!loginInProgress(state) || state.phase !== "login") return;
    if (tab.id === state.tabId || tab.windowId !== state.windowId) return;
    const current = await chrome.tabs.get(state.tabId).catch(() => null);
    if (current && isGoogleLoginUrl(current.pendingUrl || current.url)) return;
    await saveWorkspace({
      ...state, tabId: tab.id, windowId: tab.windowId,
      managedTabIds: [...managedTabs(state), tab.id],
      openerStack: [...(state.openerStack || []), { tabId: state.tabId, windowId: state.windowId }].slice(-8),
      detail: "Continuing sign-in in the Google sign-in tab."
    });
    await refreshRules();
  });
  return lifecycleUpdates;
}

chrome.webNavigation?.onBeforeNavigate?.addListener(details => {
  if (!supportedBrowser) return;
  if (details.frameId !== 0) return;
  chrome.tabs.get(details.tabId).then(async tab => {
    await containNavigation(tab.id, tab.windowId, details.url);
    await adoptGoogleSignInTab(tab, details.url);
  }).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changes, tab) => {
  const destination = changes.url || tab.pendingUrl || tab.url;
  if (changes.url) {
    containNavigation(tabId, tab.windowId, destination)
      .then(() => adoptGoogleSignInTab(tab, destination)).catch(() => {});
  }
  if (supportedBrowser && changes.status === "complete") {
    workspace().then(state => {
      if (state?.tabId === tabId && loginInProgress(state)) return ensureAutomation(tabId);
    }).catch(() => {});
  }
});

chrome.tabs.onCreated.addListener(tab => {
  if (!supportedBrowser) return;
  lifecycleUpdates = lifecycleUpdates.catch(() => {}).then(workspace).then(async state => {
    const destination = tab.pendingUrl || tab.url;
    if (loginInProgress(state) && tab.openerTabId === state.tabId &&
        (!destination || destination === "about:blank" || isFlowUrl(destination) || isGoogleLoginUrl(destination))) {
      if (tab.windowId !== state.windowId) {
        tab = await chrome.tabs.move(tab.id, { windowId: state.windowId, index: -1 });
      }
      await saveWorkspace({
        ...state, tabId: tab.id, windowId: tab.windowId,
        managedTabIds: [...managedTabs(state), tab.id],
        ownedTabIds: [...(state.ownedTabIds || []), tab.id],
        openerStack: [...(state.openerStack || []), { tabId: state.tabId, windowId: state.windowId }].slice(-8)
      });
      await refreshRules();
      await containNavigation(tab.id, tab.windowId, tab.pendingUrl || tab.url);
      return;
    }
    await containNavigation(tab.id, tab.windowId, destination || "about:blank");
  }).catch(() => {});
});

chrome.tabs.onAttached.addListener((tabId, info) => {
  if (!supportedBrowser) return;
  workspace().then(async state => {
    if (state?.tabId !== tabId) return;
    await saveWorkspace({ ...state, windowId: info.newWindowId });
    await refreshRules();
  }).catch(() => {});
});

function restoreOpenerOrCancel(closedTabId, closedWindowId) {
  if (!supportedBrowser) return Promise.resolve();
  lifecycleUpdates = lifecycleUpdates.catch(() => {}).then(async () => {
    const state = await workspace();
    if (!state || (closedTabId != null ? state.tabId !== closedTabId : state.windowId !== closedWindowId)) return;
    const stack = [...(state.openerStack || [])];
    while (stack.length) {
      const opener = stack.pop();
      const tab = await chrome.tabs.get(opener.tabId).catch(() => null);
      if (!tab || tab.windowId === closedWindowId || tab.id === closedTabId) continue;
      await saveWorkspace({
        ...state, tabId: tab.id, windowId: tab.windowId, openerStack: stack,
        managedTabIds: managedTabs(state).filter(id => id !== closedTabId),
        ownedTabIds: (state.ownedTabIds || []).filter(id => id !== closedTabId)
      });
      await refreshRules();
      await chrome.tabs.sendMessage(tab.id, { type: "RESUME" }).catch(() => {});
      return;
    }
    if (state.phase !== "ready") await api("/extension-finish", { attemptId: state.attemptId, outcome: "cancelled" }).catch(() => {});
    await saveWorkspace(null);
    await refreshRules();
  });
  return lifecycleUpdates;
}

chrome.tabs.onRemoved.addListener((tabId, info) => { restoreOpenerOrCancel(tabId, info.isWindowClosing ? info.windowId : null).catch(() => {}); });
chrome.windows?.onRemoved?.addListener(windowId => { restoreOpenerOrCancel(null, windowId).catch(() => {}); });

chrome.alarms.onAlarm.addListener(alarm => {
  if (!supportedBrowser) return;
  if (alarm.name === "flow-profile-redirect") {
    startProfileRedirects().catch(() => {});
    return;
  }
  if (alarm.name !== "flow-auto-login-check") return;
  (async () => {
    const state = await workspace();
    if (!await isConnected()) { await chrome.alarms.clear("flow-auto-login-check"); return; }
    try {
      await api("/extension-status");
      if (state?.phase === "login" && Date.parse(state.expiresAt) <= Date.now()) {
        await recordProblem("Login attempt expired. Click Start Flow to begin a fresh sign-in.", "error");
      }
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        await clearLocalConnection(state);
      } else if (state) {
        await recordProblem("Connection check failed. Verify the admin server is running.", "error");
      }
    }
  })().catch(() => {});
});

// ─── Auto-Connect Listener ──────────────────────────────────────────────────
// When the Electron shell writes the token, auto-arm the connection check
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.flowBrowserToken) {
    if (changes.flowBrowserToken.newValue) {
      armConnectionCheck().catch(() => {});
    }
  }
});