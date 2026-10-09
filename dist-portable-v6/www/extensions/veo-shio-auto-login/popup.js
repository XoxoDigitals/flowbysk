
const $ = id => document.getElementById(id);
const DAY_MS = 24 * 60 * 60 * 1000;
let working = false;
let lastStatus = null;
let lastProgress = null;
const browserUnavailable = false;

async function send(type, extra = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...extra });
  if (!response?.ok) throw new Error(response?.error || "The extension could not complete this action.");
  return response.data;
}

function errorText(message = "") {
  $("error").textContent = message;
  $("error").hidden = !message;
}

function nonEmptyText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function subscriptionText(planExpiresAt, now = Date.now(), daysRemaining = null) {
  if (Number.isInteger(daysRemaining) && daysRemaining >= 0) {
    if (daysRemaining === 0) {
      const exp = typeof planExpiresAt === "string" ? Date.parse(planExpiresAt) : planExpiresAt;
      if (!Number.isFinite(exp) || exp < now) return "Expired";
    }
    return `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} left`;
  }
  let expiresAt;
  if (typeof planExpiresAt === "number") expiresAt = planExpiresAt;
  else if (typeof planExpiresAt === "string" && planExpiresAt.trim()) expiresAt = Date.parse(planExpiresAt);
  if (!Number.isFinite(expiresAt)) return "Plan details unavailable";
  if (expiresAt < now) return "Expired";
  const days = Math.max(0, Math.ceil((expiresAt - now) / DAY_MS));
  return `${days} day${days === 1 ? "" : "s"} left`;
}

function renderAccount(user, connected) {
  const account = user && typeof user === "object" ? user : null;
  const name = nonEmptyText(account?.name) || nonEmptyText(account?.username);
  const dispName = account ? (name || "Flow Browser User") : (connected ? "Account details unavailable" : "Not connected");

  const customerNameEl = $("customer-name");
  if (customerNameEl) customerNameEl.textContent = dispName;

  const subText = account ? subscriptionText(account.planExpiresAt, Date.now(), account.daysRemaining) : "Plan details unavailable";
  const subDaysEl = $("subscription-days");
  if (subDaysEl) subDaysEl.textContent = subText;

  const plan = account?.plan ? String(account.plan) : null;
  const planEl = $("customer-plan");
  if (planEl) {
    planEl.textContent = plan || "Plan unavailable";
    planEl.hidden = !connected || !account || !plan;
  }

  // Show credits
  const creditsEl = $("user-credits-display");
  if (creditsEl) {
    if (account && account.credits !== undefined) {
      creditsEl.textContent = `⚡ ${Number(account.credits).toLocaleString()} Credits`;
    } else {
      creditsEl.textContent = "";
    }
  }

  const avatar = $("user-avatar");
  if (avatar) {
    if (account && dispName && dispName !== "Flow Browser User" && dispName !== "Not connected") {
      const rawText = dispName.replace(/<[^>]+>/g, "").trim();
      avatar.textContent = (rawText.charAt(0) || "?").toUpperCase();
    } else {
      avatar.textContent = "?";
    }
  }
}

function fallbackProgress(phase) {
  switch (phase) {
    case "ready":
      return { percent: 100, state: "ready", label: "Step 4 of 4 — Ready. Flow is open." };
    case "manual":
      return { percent: 0, state: "waiting", label: "Step progress unavailable — waiting for worker status." };
    case "error":
      return { percent: 0, state: "waiting", label: "Step progress unavailable — waiting for worker status." };
    case "login":
      return { percent: 0, state: "waiting", label: "Step progress unavailable — waiting for worker status." };
    default:
      return { percent: 0, state: "waiting", label: "Step progress unavailable — waiting to start." };
  }
}

function numericPercent(value) {
  if (value == null || value === "") return null;
  const percent = Number(value);
  return Number.isFinite(percent) ? percent : null;
}

function boundedPercent(value, ready = false) {
  return ready ? 100 : Math.min(99, Math.max(0, value));
}

function setAttribute(element, name, value) {
  if (typeof element?.setAttribute === "function") element.setAttribute(name, String(value));
  else if (element) element[name] = String(value);
}

function renderProgress(workspace, connected) {
  const panel = $("flow-progress");
  const phase = nonEmptyText(workspace?.phase)?.toLowerCase() || "idle";
  const supplied = workspace?.progress && typeof workspace.progress === "object"
    ? workspace.progress : {};
  const suppliedState = nonEmptyText(supplied.state)?.toLowerCase();
  const state = suppliedState || phase;
  const isActive = ["started", "running", "manual", "error", "ready", "login"].includes(phase) || ["started", "running", "manual", "error", "ready", "login"].includes(state);

  panel.hidden = !connected || !isActive;
  if (!connected || !isActive) return;

  const ready = phase === "ready";
  const fallbackPhase = ready ? "ready" : ["login", "manual", "error"].includes(state) ? state : phase;
  const fallback = fallbackProgress(ready ? "ready" : fallbackPhase);
  const suppliedPercent = numericPercent(supplied.percent);
  const attemptId = nonEmptyText(workspace?.attemptId);
  const remembered = suppliedPercent === null && !ready && attemptId && lastProgress?.attemptId === attemptId
    ? lastProgress : null;
  const stagePercent = suppliedPercent ?? remembered?.percent ?? null;
  const hasStage = ready || stagePercent !== null;
  const percent = ready ? 100 : hasStage ? boundedPercent(stagePercent) : 0;
  const actionState = state === "manual" || phase === "manual";
  const errorState = state === "error" || phase === "error";
  const label = nonEmptyText(supplied.label)
    || (remembered && !actionState && !errorState ? remembered.label : null)
    || fallback.label;
  const stateLabel = ready ? "Ready"
    : !hasStage ? "Waiting"
      : actionState ? "Action needed"
        : errorState ? "Error" : "In progress";

  const bar = $("progressbar");
  const fill = $("progress-fill");
  setAttribute(bar, "aria-valuenow", percent);
  setAttribute(bar, "aria-valuetext", label);
  setAttribute($("progress-state"), "data-state", ready ? "ready" : state);
  $("progress-state").textContent = stateLabel;
  $("progress-percent").textContent = `${percent}%`;
  $("progress-label").textContent = label;
  if (!fill.style) fill.style = {};
  fill.style.width = `${percent}%`;
  if (suppliedPercent !== null && attemptId) {
    lastProgress = {
      attemptId,
      percent: boundedPercent(suppliedPercent),
      label: nonEmptyText(supplied.label) || fallback.label
    };
  }
}

async function status() {
  if (browserUnavailable) {
    $("profile-protection").hidden = true;
    $("flow-progress").hidden = true;
    $("connected-actions").hidden = true;
    $("more-options").hidden = true;
    $("status").textContent = "Browser not supported.";
    $("status").hidden = false;
    document.querySelectorAll("button").forEach(button => { button.disabled = true; });
    return;
  }
  const result = await send("STATUS");
  renderStatus(result);
}

function renderStatus(result) {
  lastStatus = result;
  const connected = !!result?.connected;
  renderAccount(result?.user, connected);

  $("not-connected-info").hidden = connected;
  $("connected-actions").hidden = !connected;
  $("more-options").hidden = !connected;

  const version = chrome.runtime.getManifest?.().version || "2.0.0";
  const badge = $("version-badge");
  if (badge) badge.textContent = `v${version}`;

  const workspace = result?.workspace || null;
  const detail = nonEmptyText(workspace?.detail);
  $("status").textContent = connected
    ? `Connected · v${version}\n${detail || "Your Flow Browser account is connected. Start Flow when ready."}`
    : "Log in to Flow Browser to connect. The extension auto-connects when you sign in.";

  const phase = nonEmptyText(workspace?.phase)?.toLowerCase() || "idle";
  const progressState = nonEmptyText(workspace?.progress?.state)?.toLowerCase() || phase;

  if (connected && result?.user && ["idle", "ready"].includes(phase) && ["idle", "ready"].includes(progressState)) {
    $("status").hidden = true;
  } else {
    $("status").hidden = false;
  }

  renderProgress(workspace, connected);
  $("start").textContent = phase === "manual" || progressState === "manual"
    ? "Resume sign-in"
    : phase === "ready"
      ? "Open Flow"
      : "Start Flow";
}

async function action(task) {
  if (working || browserUnavailable) return;
  working = true;
  errorText();
  document.querySelectorAll("button").forEach(button => { button.disabled = true; });
  try {
    const result = await task();
    if (result?.message) $("status").textContent = result.message;
    await status();
    if (result?.message) { $("status").textContent = result.message; $("status").hidden = false; }
  } catch (error) {
    errorText(error.message);
    await status().catch(() => {});
  } finally {
    working = false;
    document.querySelectorAll("button").forEach(button => { button.disabled = browserUnavailable; });
  }
}

$("start").addEventListener("click", () => {
  void action(() => send("START", { consent: true }));
});

$("refresh").addEventListener("click", () => void action(async () => null));

status().catch(error => {
  errorText(error.message);
  $("status").textContent = "Unable to check connection. Make sure the Flow Browser admin server is running.";
  $("not-connected-info").hidden = false;
});

if (!browserUnavailable) chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.workspace && lastStatus?.connected) {
    const rawWorkspace = changes.workspace.newValue || null;
    renderStatus({ ...lastStatus, workspace: rawWorkspace });
    void send("LOCAL_STATUS").then(local => {
      if (!lastStatus?.connected) return;
      const attemptId = nonEmptyText(rawWorkspace?.attemptId);
      const currentAttemptId = nonEmptyText(lastStatus.workspace?.attemptId);
      if (attemptId && currentAttemptId && attemptId !== currentAttemptId) return;
      const workspace = local && Object.prototype.hasOwnProperty.call(local, "workspace")
        ? local.workspace : rawWorkspace;
      renderStatus({ ...lastStatus, workspace });
    }).catch(() => {});
  }
  // Auto-refresh when the Electron shell writes the token
  if (area === "local" && changes.flowBrowserToken) {
    void status().catch(() => {});
  }
});

if (!browserUnavailable) setInterval(async () => {
  if (working || !lastStatus) return;
  try {
    const local = await send("LOCAL_STATUS");
    renderStatus({ ...lastStatus, workspace: local.workspace });
  } catch {
    errorText("The extension stopped responding. Reload Flow Browser to reload the extension.");
  }
}, 2000);