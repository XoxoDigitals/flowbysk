// WebView2 bridge for Flow Browser native ZexTTS C# backend
(function () {
(function initFlowBrowserZexTtsBridge() {
  if (window.pywebview && window.pywebview.api) return;
  if (!window.chrome || !window.chrome.webview) return;

  let _reqSeq = 1;
  const _pending = new Map();

  window.chrome.webview.addEventListener("message", (event) => {
    let msg = event.data;
    if (typeof msg === "string") {
      try { msg = JSON.parse(msg); } catch { return; }
    }
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "zextts-result") {
      const entry = _pending.get(msg.id);
      if (entry) {
        _pending.delete(msg.id);
        if (msg.error) entry.reject(new Error(msg.error));
        else entry.resolve(msg.result);
      }
    } else if (msg.type === "zextts-event" && msg.eventName) {
      window.dispatchEvent(new CustomEvent(msg.eventName, { detail: msg.detail || {} }));
    }
  });

  function invokeHost(cmd, payload = {}) {
    return new Promise((resolve, reject) => {
      const id = _reqSeq++;
      _pending.set(id, { resolve, reject });
      window.chrome.webview.postMessage({
        type: "zextts-invoke",
        id,
        cmd,
        payload,
      });
    });
  }

  window.pywebview = {
    api: {
      check_access: (force = true) => invokeHost("check_access", { force: Boolean(force) }),
      check_internet: () => invokeHost("check_internet", {}),
      list_voices: (force = false) => invokeHost("list_voices", { force: Boolean(force) }),
      get_default_output_folder: () => invokeHost("get_default_output_folder", {}),
      choose_output_folder: () => invokeHost("choose_output_folder", {}),
      preview_voice: (voice, rate = 1, pitch = 1, volume = 1, force = false) =>
        invokeHost("preview_voice", { voice, rate, pitch, volume, force: Boolean(force) }),
      generate_audio: (opts = {}) => invokeHost("generate_audio", opts || {}),
      generate_podcast: (opts = {}) => invokeHost("generate_podcast", opts || {}),
      open_external_url: (url) => invokeHost("open_external_url", { url: String(url || "") }),
    },
  };
})();

const state = {
  voices: [],
  filtered: [],
  selectedVoice: "",
  language: "all",
  country: "all",
  gender: "all",
  query: "",
  sortAsc: true,
  busy: false,
  online: false,
  connectivityKnown: false,
  connectivityCheckInFlight: false,
  connectivityTimer: null,
  voicesLoading: false,
  voiceRetryTimer: null,
  access: "checking",
  accessCheckInFlight: false,
  accessTimer: null,
  outputDir: "",
  latestAudio: null,
  jobs: [],
  characters: [
    { name: "Host", voiceId: "" },
    { name: "Guest", voiceId: "" },
  ],
  lines: [
    { character: "Host", text: "Welcome to the show." },
    { character: "Guest", text: "Glad to be here." },
  ],
};

const _langNames = (() => {
  try { return new Intl.DisplayNames(["en"], { type: "language" }); }
  catch { return null; }
})();

const _regionNames = (() => {
  try { return new Intl.DisplayNames(["en"], { type: "region" }); }
  catch { return null; }
})();

const TAB_TITLES = {
  studio: "Voice studio",
  podcast: "Podcast maker",
  voices: "Voice library",
  library: "My generations",
  settings: "Settings",
};

const TAB_EYEBROWS = {
  studio: "CREATE / SINGLE VOICE",
  podcast: "CREATE / MULTI-VOICE",
  voices: "EXPLORE / ALL VOICES",
  library: "LIBRARY / THIS SESSION",
  settings: "APP / PREFERENCES",
};

const $ = (id) => document.getElementById(id);

function toast(message, kind = "") {
  const el = $("toast");
  el.textContent = message;
  el.className = "toast show" + (kind ? ` ${kind}` : "");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { el.className = "toast"; }, 3200);
}

function setDock(title, sub = "") {
  $("dockTitle").textContent = title;
  $("dockSub").textContent = sub;
}

function setEngine(ok, label) {
  $("engineChip").className = "engine" + (ok ? "" : " err");
  $("engineLabel").textContent = label;
}

function showAccessGate(mode, detail = {}) {
  const gate = $("accessGate");
  const eyebrow = $("accessGateEyebrow");
  const title = $("accessGateTitle");
  const message = $("accessGateMessage");
  const status = $("accessGateStatus");
  const retry = $("btnAccessRetry");
  const contact = $("btnAccessContact");

  state.access = mode === "allowed" ? "tox" : mode;
  clearTimeout(state.accessTimer);
  retry.classList.add("hidden");
  contact.classList.add("hidden");

  if (mode === "allowed") {
    gate.className = "access-gate hidden";
    syncGenerationAvailability();
    scheduleAccessCheck(60000);
    return;
  }

  gate.className = `access-gate ${mode}`;
  if (mode === "checking") {
    eyebrow.textContent = "STARTING TTS STUDIO";
    title.textContent = "Getting your studio ready";
    message.textContent = "Please wait while TTS STUDIO connects to its online speech services.";
    status.textContent = "Connecting securely…";
  } else if (mode === "blocked") {
    eyebrow.textContent = "RELEASE UPDATE";
    title.textContent = "Sorry — access has ended";
    message.textContent = "Access to TTS STUDIO has been closed by the administrator.";
    status.textContent = "Access closed by the administrator";
    contact.classList.remove("hidden");
  } else {
    eyebrow.textContent = "CONNECTION PROBLEM";
    title.textContent = "TTS STUDIO couldn’t connect";
    message.textContent = "We couldn’t reach the online services TTS STUDIO needs. Check your internet connection, VPN, or firewall, then try again.";
    status.textContent = detail.message || "The TTS STUDIO service could not be reached";
    retry.classList.remove("hidden");
    contact.classList.remove("hidden");
  }
  syncGenerationAvailability();
}

function scheduleAccessCheck(delay) {
  clearTimeout(state.accessTimer);
  state.accessTimer = setTimeout(() => checkRemoteAccess(true, true), delay);
}

async function checkRemoteAccess(force = true, background = false) {
  if (state.accessCheckInFlight) return state.access === "tox";
  state.accessCheckInFlight = true;
  if (!background) showAccessGate("checking");
  try {
    const api = await waitApi();
    const result = await api.check_access(Boolean(force));
    if (result && result.access === "tox") {
      showAccessGate("allowed");
      return true;
    }
    if (result && result.access === "nox") {
      showAccessGate("blocked");
      return false;
    }
    showAccessGate("error", {
      message: "The TTS STUDIO service could not be reached",
    });
    return false;
  } catch (error) {
    showAccessGate("error", { message: "The TTS STUDIO service could not be reached" });
    return false;
  } finally {
    state.accessCheckInFlight = false;
  }
}

function syncGenerationAvailability() {
  const disabled = state.busy || !state.online || state.access !== "tox";
  $("btnGenerate").disabled = disabled;
  $("btnPodcast").disabled = disabled;
}

function setConnectivity(online, { checking = false, silent = false } = {}) {
  const status = $("connectivityStatus");
  const label = $("connectivityLabel");
  const wasKnown = state.connectivityKnown;
  const wasOnline = state.online;

  if (checking && !wasKnown) {
    status.className = "connectivity-status checking";
    label.textContent = "Checking connection…";
    syncGenerationAvailability();
    return;
  }

  state.online = Boolean(online);
  state.connectivityKnown = true;
  status.className = `connectivity-status ${state.online ? "online" : "offline"}`;
  label.textContent = state.online ? "Online · speech service ready" : "No internet · generation disabled";
  status.title = state.online
    ? "Connected to the online speech service"
    : "TTS STUDIO needs an internet connection to generate audio";
  syncGenerationAvailability();

  // An offline startup can leave the catalogue empty. Recover it as soon as
  // the speech service comes back instead of requiring the sidebar sync button.
  if (state.online && wasKnown && !wasOnline && !state.voices.length) {
    scheduleVoiceLoad(0);
  }

  if (!silent && wasKnown && wasOnline !== state.online) {
    toast(state.online ? "Internet connection restored" : "Internet connection lost", state.online ? "ok" : "err");
  }
}

function scheduleConnectivityCheck(delay) {
  clearTimeout(state.connectivityTimer);
  state.connectivityTimer = setTimeout(() => checkConnectivity(true), delay);
}

async function checkConnectivity(silent = false) {
  if (state.connectivityCheckInFlight) return state.online;
  state.connectivityCheckInFlight = true;
  if (!state.connectivityKnown) setConnectivity(false, { checking: true, silent: true });
  try {
    const api = await waitApi();
    const result = await api.check_internet();
    const online = Boolean(result && result.ok && result.online);
    setConnectivity(online, { silent });
    return online;
  } catch {
    setConnectivity(false, { silent });
    return false;
  } finally {
    state.connectivityCheckInFlight = false;
    scheduleConnectivityCheck(5000);
  }
}

function requireInternet() {
  if (state.online) return true;
  toast("No internet connection. Generation is unavailable.", "err");
  setDock("Offline", "Reconnect to the internet to generate audio");
  return false;
}

function waitApi(timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const api = window.pywebview && window.pywebview.api;
      const ready = api
        && typeof api.check_access === "function"
        && typeof api.check_internet === "function"
        && typeof api.list_voices === "function";
      if (ready) return resolve(api);
      if (Date.now() - started > timeoutMs) return reject(new Error("TTS STUDIO backend is still starting"));
      setTimeout(tick, 50);
    };
    tick();
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function splitLocale(locale) {
  const parts = String(locale || "").split("-").filter(Boolean);
  if (!parts.length) return { lang: "", region: "" };
  const region = parts.length >= 2 ? (parts[1].length === 4 ? parts[2] || "" : parts[1]) : "";
  return { lang: parts[0], region };
}

function languageName(code) {
  try { return (_langNames && _langNames.of(code)) || code || ""; }
  catch { return code || ""; }
}

function countryName(code) {
  try { return (_regionNames && _regionNames.of(String(code).toUpperCase())) || code || ""; }
  catch { return code || ""; }
}

function voiceGivenName(shortName) {
  const raw = String(shortName || "");
  const parts = raw.split("-");
  return (parts.at(-1) || raw).replace(/Neural$/i, "").replace(/Multilingual$/i, "") || raw;
}

function voiceMeta(voice) {
  const { lang, region } = splitLocale(voice.locale || "");
  return {
    given: voiceGivenName(voice.shortName),
    language: languageName(lang),
    country: countryName(region),
    gender: voice.gender || "",
    langCode: lang,
    regionCode: region,
  };
}

function voiceLabel(voice) {
  const meta = voiceMeta(voice);
  const place = meta.country ? `${meta.language} (${meta.country})` : meta.language || voice.locale || "";
  return `${meta.given} — ${place}${meta.gender ? ` · ${meta.gender}` : ""}`;
}

function findVoice(shortName) {
  return state.voices.find((voice) => voice.shortName === shortName) || null;
}

function prosody() {
  return {
    rate: parseFloat($("rate").value),
    pitch: parseFloat($("pitch").value),
    volume: parseFloat($("volume").value),
  };
}

function fmtSigned(value, unit) {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded}${unit}`;
}

function syncSliders() {
  const rate = parseFloat($("rate").value);
  const pitch = parseFloat($("pitch").value);
  const volume = parseFloat($("volume").value);
  $("rateVal").textContent = fmtSigned((rate - 1) * 100, "%");
  $("pitchVal").textContent = fmtSigned((pitch - 1) * 50, "Hz");
  $("volumeVal").textContent = fmtSigned((volume - 1) * 100, "%");
  ["rate", "pitch", "volume"].forEach((id) => {
    const input = $(id);
    const fill = ((parseFloat(input.value) - parseFloat(input.min)) / (parseFloat(input.max) - parseFloat(input.min))) * 100;
    input.style.setProperty("--range-fill", `${fill}%`);
  });
  document.querySelectorAll("#speedPresets .preset").forEach((button) => {
    button.classList.toggle("active", Math.abs(parseFloat(button.dataset.rate) - rate) < 0.001);
  });
}

function updateCharCount() {
  const text = $("scriptText").value || "";
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const seconds = Math.round((words / (150 * parseFloat($("rate").value || "1"))) * 60);
  $("charCount").textContent = `${text.length.toLocaleString()} / 50,000 characters`;
  const duration = seconds < 60 ? `${seconds} sec` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  $("readTime").textContent = `~ ${duration} audio`;
}

function setProgress(progress, text) {
  const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
  $("progressFill").style.width = `${pct}%`;
  $("progressPct").textContent = `${pct}%`;
  if (text) $("progressText").textContent = text;
}

function setPodProgress(progress, text) {
  const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
  $("podProgressFill").style.width = `${pct}%`;
  $("podProgressPct").textContent = `${pct}%`;
  if (text) $("podProgressText").textContent = text;
}

function dataUrlToPlayableUrl(url) {
  if (!url || typeof url !== "string" || !url.startsWith("data:")) return url;
  try {
    const commaIdx = url.indexOf(",");
    if (commaIdx < 0) return url;
    const b64 = url.slice(commaIdx + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: "audio/mpeg" });
    return URL.createObjectURL(blob);
  } catch {
    return url;
  }
}

function playUrl(url, path = "", autoplay = true) {
  const player = $("player");
  if (path) {
    $("outPath").value = path;
    const lastSep = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
    if (lastSep > 0) {
      const folder = path.slice(0, lastSep);
      if (!state.outputDir && folder) {
        state.outputDir = folder;
        if ($("outputFolder")) $("outputFolder").value = folder;
      }
    }
  }
  if (!url) {
    player.classList.add("hidden");
    $("audioEmpty").classList.remove("hidden");
    return;
  }
  $("audioEmpty").classList.add("hidden");
  player.classList.remove("hidden");
  if (player._blobUrl) {
    try { URL.revokeObjectURL(player._blobUrl); } catch {}
    player._blobUrl = null;
  }
  const playable = dataUrlToPlayableUrl(url);
  if (playable && playable.startsWith("blob:")) player._blobUrl = playable;
  player.src = playable;
  $("btnReplay").disabled = false;
  if ($("btnDownloadAudio")) $("btnDownloadAudio").disabled = false;
  if (autoplay) player.play().catch(() => {});
}

function downloadAudioItem(item) {
  const target = item || state.latestAudio;
  if (!target || (!target.downloadUrl && !target.url)) {
    toast("Generate audio first", "err");
    return;
  }
  const rawUrl = target.downloadUrl || target.url;
  const rawPath = String(target.path || "");
  const lastSep = Math.max(rawPath.lastIndexOf("\\"), rawPath.lastIndexOf("/"));
  let filename = lastSep >= 0 ? rawPath.slice(lastSep + 1) : "";
  if (!filename || !/\.mp3$/i.test(filename)) {
    filename = `zextts_${Date.now()}.mp3`;
  }
  try {
    const a = document.createElement("a");
    a.href = rawUrl;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { a.remove(); } catch {}
    }, 500);
    toast(rawPath ? `Saved MP3: ${filename}` : `Downloading ${filename}`, "ok");
  } catch (err) {
    toast(String(err.message || err), "err");
  }
}

function setBusy(busy, mode = "") {
  state.busy = busy;
  ["btnGenerate", "btnPreviewStudio", "btnPodcast", "btnRefreshVoices", "btnLibraryRefresh", "btnChooseOutput", "btnImportScript"].forEach((id) => {
    const element = $(id);
    if (element) element.disabled = busy;
  });
  document.querySelectorAll("[data-library-action]").forEach((button) => { button.disabled = busy; });
  $("btnGenerate").classList.toggle("is-generating", busy && mode === "generate");
  $("btnPodcast").classList.toggle("is-generating", busy && mode === "podcast");
  $("generateLabel").textContent = busy && mode === "generate" ? "Generating…" : "Generate audio";
  syncGenerationAvailability();
}

function populateSelect(id, firstLabel, values) {
  const select = $(id);
  if (!select) return;
  select.innerHTML = `<option value="all">${escapeHtml(firstLabel)}</option>`;
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
}

function renderLanguageCountryFilters() {
  const languages = new Set();
  const countries = new Set();
  state.voices.forEach((voice) => {
    const meta = voiceMeta(voice);
    if (meta.language) languages.add(meta.language);
    if (meta.country) countries.add(meta.country);
  });
  const langValues = [...languages].sort((a, b) => a.localeCompare(b));
  const countryValues = [...countries].sort((a, b) => a.localeCompare(b));
  ["languageFilter", "libraryLanguageFilter"].forEach((id) => populateSelect(id, "All languages", langValues));
  ["countryFilter", "libraryCountryFilter"].forEach((id) => populateSelect(id, "All countries", countryValues));
  syncFilterControls();
}

function syncFilterControls() {
  ["languageFilter", "libraryLanguageFilter"].forEach((id) => { if ($(id)) $(id).value = state.language; });
  ["countryFilter", "libraryCountryFilter"].forEach((id) => { if ($(id)) $(id).value = state.country; });
  ["genderFilter", "libraryGenderFilter"].forEach((id) => { if ($(id)) $(id).value = state.gender; });
  ["voiceSearch", "libraryVoiceSearch"].forEach((id) => { if ($(id) && $(id).value !== state.query) $(id).value = state.query; });
}

function applyFilters() {
  const query = state.query.trim().toLowerCase();
  let voices = state.voices.slice();
  if (state.language !== "all") voices = voices.filter((voice) => voiceMeta(voice).language === state.language);
  if (state.country !== "all") voices = voices.filter((voice) => voiceMeta(voice).country === state.country);
  if (state.gender !== "all") voices = voices.filter((voice) => (voice.gender || "").toLowerCase() === state.gender.toLowerCase());
  if (query) {
    voices = voices.filter((voice) => `${voiceLabel(voice)} ${voice.shortName} ${voice.name || ""} ${voice.locale || ""}`.toLowerCase().includes(query));
  }
  voices.sort((a, b) => {
    const result = voiceLabel(a).localeCompare(voiceLabel(b));
    return state.sortAsc ? result : -result;
  });
  state.filtered = voices;
  syncFilterControls();
  renderVoiceSelect();
  renderVoices();
}

function renderVoiceSelect() {
  const select = $("voiceSelect");
  select.innerHTML = '<option value="">Choose a voice…</option>';
  state.filtered.forEach((voice) => {
    const option = document.createElement("option");
    option.value = voice.shortName;
    option.textContent = voiceLabel(voice);
    option.selected = voice.shortName === state.selectedVoice;
    select.appendChild(option);
  });
  if (state.selectedVoice && !state.filtered.some((voice) => voice.shortName === state.selectedVoice)) {
    const voice = findVoice(state.selectedVoice);
    if (voice) {
      const option = document.createElement("option");
      option.value = voice.shortName;
      option.textContent = voiceLabel(voice);
      option.selected = true;
      select.appendChild(option);
    }
  }
}

function renderVoices() {
  const list = $("voiceList");
  list.innerHTML = "";
  const shown = state.filtered.length;
  const total = state.voices.length;
  $("voiceCount").textContent = `${shown} / ${total}`;
  $("libraryVoiceCount").textContent = `Showing ${shown.toLocaleString()} of ${total.toLocaleString()} voices`;
  $("statVoices").textContent = String(total);
  if (!shown) {
    list.innerHTML = '<div class="card library-empty"><strong>No matching voices</strong><span>Try clearing a filter or searching another name.</span></div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  state.filtered.slice(0, 500).forEach((voice) => {
    const meta = voiceMeta(voice);
    const card = document.createElement("article");
    card.className = "voice-library-card" + (voice.shortName === state.selectedVoice ? " active" : "");
    const genderClass = meta.gender.toLowerCase().startsWith("f") ? "f" : "m";
    card.innerHTML = `
      <div class="library-card-top">
        <div class="library-locale-avatar">${escapeHtml((meta.regionCode || meta.langCode || "AI").toUpperCase())}</div>
        <div class="library-card-copy"><strong>${escapeHtml(meta.given)}</strong><span>${escapeHtml(meta.language)}${meta.country ? ` · ${escapeHtml(meta.country)}` : ""}</span></div>
        <span class="library-gender ${genderClass}">${escapeHtml(meta.gender || "Voice")}</span>
      </div>
      <div class="library-voice-id"><span>${escapeHtml(voice.locale || "")}</span><span>${escapeHtml(voice.shortName)}</span></div>
      <div class="library-card-actions">
        <button type="button" class="library-preview" data-library-action="preview">▷ Preview</button>
        <button type="button" class="library-use${voice.shortName === state.selectedVoice ? " selected" : ""}" data-library-action="use">${voice.shortName === state.selectedVoice ? "Selected" : "Use this voice"}</button>
      </div>`;
    const previewButton = card.querySelector('[data-library-action="preview"]');
    previewButton.onclick = () => onPreviewVoice(voice.shortName, false, previewButton);
    card.querySelector('[data-library-action="use"]').onclick = () => {
      selectVoice(voice.shortName);
      toast(`${meta.given} selected`, "ok");
      openTab("studio");
    };
    fragment.appendChild(card);
  });
  list.appendChild(fragment);
}

function selectVoice(id) {
  state.selectedVoice = id;
  const voice = findVoice(id);
  const meta = voice ? voiceMeta(voice) : null;
  $("selectedVoiceName").textContent = meta ? meta.given : "No voice";
  $("selectedVoiceLabel").textContent = meta
    ? `${meta.language}${meta.country ? ` · ${meta.country}` : ""}${meta.gender ? ` · ${meta.gender}` : ""}`
    : "Select a voice below";
  $("selectedVoiceAvatar").querySelector("span").textContent = meta ? meta.given.slice(0, 1).toUpperCase() : "V";
  renderVoiceSelect();
  renderVoices();
  renderChars();
  setDock("Voice", voice ? voiceLabel(voice) : "None selected");
}

function voiceOptionsHtml(selected) {
  let html = '<option value="">Choose a voice…</option>';
  state.voices.slice().sort((a, b) => voiceLabel(a).localeCompare(voiceLabel(b))).forEach((voice) => {
    html += `<option value="${escapeHtml(voice.shortName)}"${voice.shortName === selected ? " selected" : ""}>${escapeHtml(voiceLabel(voice))}</option>`;
  });
  return html;
}

function renderChars() {
  const wrap = $("charList");
  wrap.innerHTML = "";
  state.characters.forEach((character, index) => {
    const row = document.createElement("div");
    row.className = "char-card";
    const name = document.createElement("input");
    name.type = "text";
    name.value = character.name;
    name.placeholder = "Name";
    name.oninput = () => { state.characters[index].name = name.value; renderLines(); };
    const voice = document.createElement("select");
    voice.innerHTML = voiceOptionsHtml(character.voiceId || state.selectedVoice);
    if (!character.voiceId && state.selectedVoice) character.voiceId = state.selectedVoice;
    voice.value = character.voiceId;
    voice.onchange = () => { state.characters[index].voiceId = voice.value; };
    const remove = document.createElement("button");
    remove.className = "btn-icon";
    remove.type = "button";
    remove.textContent = "×";
    remove.onclick = () => { state.characters.splice(index, 1); renderChars(); renderLines(); };
    row.append(name, voice, remove);
    wrap.appendChild(row);
  });
  $("statChars").textContent = String(state.characters.length);
}

function renderLines() {
  const wrap = $("lineList");
  wrap.innerHTML = "";
  state.lines.forEach((line, index) => {
    const row = document.createElement("div");
    row.className = "line-card";
    const fields = document.createElement("div");
    fields.className = "fields";
    const speaker = document.createElement("select");
    speaker.innerHTML = state.characters.map((character) => `<option value="${escapeHtml(character.name)}"${character.name === line.character ? " selected" : ""}>${escapeHtml(character.name)}</option>`).join("");
    speaker.onchange = () => { state.lines[index].character = speaker.value; };
    const text = document.createElement("input");
    text.type = "text";
    text.value = line.text;
    text.placeholder = "Spoken line…";
    text.oninput = () => { state.lines[index].text = text.value; };
    fields.append(speaker, text);
    const remove = document.createElement("button");
    remove.className = "btn-icon";
    remove.type = "button";
    remove.textContent = "×";
    remove.onclick = () => { state.lines.splice(index, 1); renderLines(); };
    row.append(fields, remove);
    wrap.appendChild(row);
  });
}

function parseImportedScript(value) {
  const parsedLines = [];
  const invalidLines = [];
  const speakers = new Map();

  String(value || "").split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;
    const separator = line.indexOf(":");
    const speaker = separator > 0 ? line.slice(0, separator).trim() : "";
    const dialogue = separator > 0 ? line.slice(separator + 1).trim() : "";
    if (!speaker || !dialogue || speaker.length > 80) {
      invalidLines.push(index + 1);
      return;
    }
    const key = speaker.toLocaleLowerCase();
    if (!speakers.has(key)) speakers.set(key, speaker);
    parsedLines.push({ speakerKey: key, text: dialogue });
  });

  return {
    lines: parsedLines.map((line) => ({ character: speakers.get(line.speakerKey), text: line.text })),
    speakers: [...speakers.values()],
    invalidLines,
  };
}

function updateImportFeedback() {
  const value = $("importScriptText").value;
  const result = parseImportedScript(value);
  const feedback = $("importFeedback");
  const label = feedback.querySelector("span");
  const apply = $("btnApplyImport");

  feedback.className = "import-feedback";
  if (!value.trim()) {
    label.textContent = "Waiting for your script";
    apply.disabled = true;
    $("importButtonLabel").textContent = "Import script";
  } else if (result.invalidLines.length) {
    feedback.classList.add("invalid");
    label.textContent = `Fix line${result.invalidLines.length === 1 ? "" : "s"} ${result.invalidLines.slice(0, 5).join(", ")} · use Speaker: dialogue`;
    apply.disabled = true;
    $("importButtonLabel").textContent = "Fix script first";
  } else {
    feedback.classList.add("valid");
    label.textContent = `${result.lines.length} dialogue line${result.lines.length === 1 ? "" : "s"} · ${result.speakers.length} speaker${result.speakers.length === 1 ? "" : "s"}`;
    apply.disabled = !result.lines.length;
    $("importButtonLabel").textContent = result.lines.length ? `Import ${result.lines.length} lines` : "Import script";
  }
  return result;
}

function openImportModal() {
  if (state.busy) return;
  const modal = $("importModal");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  updateImportFeedback();
  requestAnimationFrame(() => $("importScriptText").focus());
}

function closeImportModal() {
  const modal = $("importModal");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  $("btnImportScript").focus();
}

function applyImportedScript() {
  const result = updateImportFeedback();
  if (!result.lines.length || result.invalidLines.length) return;

  const existingVoices = new Map(
    state.characters.map((character) => [character.name.trim().toLocaleLowerCase(), character.voiceId]),
  );
  state.characters = result.speakers.map((name) => ({
    name,
    voiceId: existingVoices.get(name.toLocaleLowerCase()) || state.selectedVoice || "",
  }));
  state.lines = result.lines;
  renderChars();
  renderLines();
  setPodProgress(0, `${result.lines.length} imported lines · assign a voice to each speaker`);
  closeImportModal();
  setDock("Podcast imported", `${result.speakers.length} speakers · ${result.lines.length} lines`);
  toast(`Imported ${result.lines.length} dialogue lines`, "ok");
}

function renderHistory() {
  const wrap = $("historyList");
  wrap.innerHTML = "";
  $("statJobs").textContent = String(state.jobs.length);
  if (!state.jobs.length) {
    wrap.innerHTML = '<div class="empty-state history-empty"><div><strong>Empty</strong><span>Finished Studio and Podcast outputs will show here</span></div></div>';
    return;
  }
  state.jobs.forEach((job) => {
    const row = document.createElement("div");
    row.className = "voice-item history-row";
    const hasDownload = Boolean(job.downloadUrl || job.url);
    row.innerHTML = `<div><strong>${escapeHtml(job.title)}</strong><small>${escapeHtml(job.path || "")}</small></div><div class="history-meta">${hasDownload ? '<button type="button" class="btn btn-download btn-history-dl">Download MP3</button>' : ""}<span>${escapeHtml(job.time)}</span><b>SAVED</b></div>`;
    const dlBtn = row.querySelector(".btn-history-dl");
    if (dlBtn) dlBtn.addEventListener("click", () => downloadAudioItem(job));
    wrap.appendChild(row);
  });
}

function pushHistory(item) {
  state.jobs.unshift({ ...item, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) });
  state.jobs = state.jobs.slice(0, 40);
  renderHistory();
}

async function loadVoices(force = false) {
  if (state.voicesLoading) return;
  state.voicesLoading = true;
  clearTimeout(state.voiceRetryTimer);
  setEngine(false, "Fetching…");
  setDock("Loading", "Voice catalogue");
  try {
    let loadedVoices = [];
    try {
      const api = await waitApi(10000);
      const result = await api.list_voices(force);
      if (result && result.ok && Array.isArray(result.voices) && result.voices.length > 0) {
        loadedVoices = result.voices;
      }
    } catch {}

    if (!loadedVoices.length) {
      try {
        const fallbackResp = await fetch("./voices_fallback.json");
        if (fallbackResp.ok) {
          const fallbackArr = await fallbackResp.json();
          if (Array.isArray(fallbackArr) && fallbackArr.length > 0) {
            loadedVoices = fallbackArr;
          }
        }
      } catch {}
    }

    if (!loadedVoices.length) throw new Error("Failed to list voices");
    state.voices = loadedVoices;
    renderLanguageCountryFilters();
    applyFilters();
    if (!state.selectedVoice && state.voices.length) {
      const preferred = state.voices.find((voice) => voice.shortName === "en-US-AriaNeural") || state.voices.find((voice) => (voice.locale || "").startsWith("en-")) || state.voices[0];
      selectVoice(preferred.shortName);
    } else if (state.selectedVoice) selectVoice(state.selectedVoice);
    renderChars();
    renderLines();
    setEngine(true, `${state.voices.length} voices`);
    setDock(
      state.online ? "Ready" : "Offline",
      state.online
        ? `${state.voices.length} voices loaded`
        : `${state.voices.length} voices loaded · generation unavailable`,
    );
    toast(`Loaded ${state.voices.length} voices`, "ok");
  } catch (error) {
    setEngine(false, state.online ? "Retrying…" : "Offline");
    setDock("Error", String(error.message || error));
    toast(String(error.message || error), "err");
    if (state.online) scheduleVoiceLoad(5000, force);
  } finally {
    state.voicesLoading = false;
  }
}

function scheduleVoiceLoad(delay = 0, force = false) {
  clearTimeout(state.voiceRetryTimer);
  state.voiceRetryTimer = setTimeout(() => loadVoices(force), delay);
}

async function refreshVoices() {
  const online = await checkConnectivity(false);
  if (!online) {
    setEngine(false, "Offline");
    return;
  }
  await loadVoices(true);
}

function requireOutputFolder() {
  return true;
}

async function onGenerate() {
  if (state.busy || !requireInternet() || !requireOutputFolder()) return;
  const text = $("scriptText").value;
  if (!text.trim()) return toast("Enter text first", "err");
  if (!state.selectedVoice) return toast("Select a voice", "err");
  setBusy(true, "generate");
  setProgress(0.02, "Generating your audio…");
  const selected = findVoice(state.selectedVoice);
  setDock("Generating", selected ? voiceLabel(selected) : state.selectedVoice);
  try {
    const api = await waitApi();
    const settings = prosody();
    const result = await api.generate_audio({
      text,
      voice: state.selectedVoice,
      outputDir: state.outputDir,
      rate: settings.rate,
      pitch: settings.pitch,
      volume: settings.volume,
      subs: false,
    });
    if (!result || !result.ok) throw new Error((result && result.error) || "Generation failed");
    setProgress(1, `Done · ${result.totalChunks || 1} chunk(s) · ${result.elapsedMs || 0} ms`);
    const dlUrl = result.downloadUrl || result.audioUrl;
    state.latestAudio = { url: result.audioUrl, downloadUrl: dlUrl, path: result.outputPath };
    playUrl(result.audioUrl, result.outputPath);
    $("btnPreviewStudio").classList.add("show");
    pushHistory({ title: `Studio · ${selected ? voiceLabel(selected) : state.selectedVoice}`, path: result.outputPath, url: result.audioUrl, downloadUrl: dlUrl });
    setDock("Saved", result.outputPath || "");
    toast("Audio generated and saved", "ok");
  } catch (error) {
    setProgress(0, "Generation failed");
    setDock("Failed", String(error.message || error));
    toast(String(error.message || error), "err");
    checkConnectivity(true);
  } finally {
    setBusy(false);
  }
}

function onPreviewLatest() {
  if (!state.latestAudio) return;
  playUrl(state.latestAudio.url, state.latestAudio.path, true);
}

function resetLibraryPreviewButton(button) {
  if (!button || !button.isConnected) return;
  button.classList.remove("loading", "playing");
  button.innerHTML = "▷ Preview";
  button.removeAttribute("aria-busy");
  const card = button.closest(".voice-library-card");
  if (card) card.classList.remove("preview-loading", "preview-playing");
}

async function onPreviewVoice(voiceId, force = false, triggerButton = null) {
  if (state.busy) return;
  const voice = voiceId || state.selectedVoice;
  if (!voice) return toast("Select a voice", "err");
  const pretty = findVoice(voice);
  const label = pretty ? voiceLabel(pretty) : voice;

  document.querySelectorAll(".library-preview.playing").forEach(resetLibraryPreviewButton);
  const triggerCard = triggerButton ? triggerButton.closest(".voice-library-card") : null;
  setBusy(true);
  if (triggerButton) {
    triggerButton.classList.add("loading");
    triggerButton.innerHTML = '<span class="preview-spinner" aria-hidden="true"></span><span>Generating…</span>';
    triggerButton.setAttribute("aria-busy", "true");
    if (triggerCard) triggerCard.classList.add("preview-loading");
  }
  setDock("Voice preview", label);
  let playing = false;
  try {
    const api = await waitApi();
    const settings = prosody();
    const result = await api.preview_voice(voice, settings.rate, settings.pitch, settings.volume, force);
    if (!result || !result.ok) throw new Error((result && result.error) || "Preview failed");
    const player = $("voicePreviewPlayer");
    if (player._blobUrl) {
      try { URL.revokeObjectURL(player._blobUrl); } catch {}
      player._blobUrl = null;
    }
    const playable = dataUrlToPlayableUrl(result.audioUrl);
    if (playable && playable.startsWith("blob:")) player._blobUrl = playable;
    player.src = playable;
    if (triggerButton) {
      triggerButton.classList.remove("loading");
      triggerButton.classList.add("playing");
      triggerButton.innerHTML = "▶ Playing";
      triggerButton.removeAttribute("aria-busy");
      if (triggerCard) {
        triggerCard.classList.remove("preview-loading");
        triggerCard.classList.add("preview-playing");
      }
    }
    playing = true;
    player.onended = () => resetLibraryPreviewButton(triggerButton);
    player.onerror = () => resetLibraryPreviewButton(triggerButton);
    player.play().catch(() => resetLibraryPreviewButton(triggerButton));
    toast(result.source === "cache" ? "Playing cached preview" : "Playing voice preview", "ok");
  } catch (error) {
    resetLibraryPreviewButton(triggerButton);
    toast(String(error.message || error), "err");
  } finally {
    setBusy(false);
    if (!playing) resetLibraryPreviewButton(triggerButton);
  }
}

async function onPodcast() {
  if (state.busy || !requireInternet() || !requireOutputFolder()) return;
  if (!state.characters.length) return toast("Add characters", "err");
  if (!state.lines.some((line) => (line.text || "").trim())) return toast("Add dialogue lines", "err");
  setBusy(true, "podcast");
  setPodProgress(0.02, "Rendering your conversation…");
  setDock("Podcast", "Rendering lines");
  try {
    const api = await waitApi();
    const settings = prosody();
    const result = await api.generate_podcast({
      characters: state.characters,
      dialogue: state.lines,
      outputDir: state.outputDir,
      rate: settings.rate,
      pitch: settings.pitch,
      volume: settings.volume,
      subs: false,
    });
    if (!result || !result.ok) throw new Error((result && result.error) || "Podcast failed");
    setPodProgress(1, `${result.elapsedMs || 0} ms · saved`);
    const dlUrl = result.downloadUrl || result.audioUrl;
    state.latestAudio = { url: result.audioUrl, downloadUrl: dlUrl, path: result.outputPath };
    playUrl(result.audioUrl, result.outputPath, false);
    if ($("btnDownloadPodcast")) $("btnDownloadPodcast").classList.remove("hidden");
    pushHistory({ title: `Podcast · ${result.jobId}`, path: result.outputPath, url: result.audioUrl, downloadUrl: dlUrl });
    setDock("Podcast saved", result.outputPath || "");
    toast("Podcast generated and saved", "ok");
  } catch (error) {
    setPodProgress(0, "Podcast failed");
    toast(String(error.message || error), "err");
    checkConnectivity(true);
  } finally {
    setBusy(false);
  }
}

async function chooseOutputFolder() {
  if (state.busy) return;
  try {
    const api = await waitApi();
    const result = await api.choose_output_folder();
    if (!result || !result.ok) {
      if (result && result.cancelled) return;
      throw new Error((result && result.error) || "Could not select folder");
    }
    state.outputDir = result.path;
    try { localStorage.setItem("zextts.outputDir", result.path); } catch {}
    $("outputFolder").value = result.path;
    $("outputFolderHint").textContent = "Ready — new audio will be saved here.";
    $("outputFolderHint").classList.add("ready");
    setDock("Output folder", result.path);
    toast("Output folder selected", "ok");
  } catch (error) {
    toast(String(error.message || error), "err");
  }
}

async function openContactPage(triggerButton = null) {
  const button = triggerButton || $("btnContact");
  button.disabled = true;
  try {
    const api = await waitApi();
    const result = await api.open_external_url("https://www.facebook.com/itxme.zafarx");
    if (!result || !result.ok) throw new Error((result && result.error) || "Could not open Facebook");
  } catch (error) {
    toast(String(error.message || error), "err");
  } finally {
    button.disabled = false;
  }
}

function openTab(id) {
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.tab === id));
  document.querySelectorAll(".pane").forEach((pane) => pane.classList.toggle("active", pane.id === `pane-${id}`));
  $("pageTitle").textContent = TAB_TITLES[id] || id;
  $("pageEyebrow").textContent = TAB_EYEBROWS[id] || "";
  document.querySelector(".workspace").classList.toggle("wide-mode", id === "voices" || id === "settings");
  document.querySelector(".canvas").scrollTop = 0;
}

function bindFilterControl(id, key) {
  $(id).addEventListener("change", () => { state[key] = $(id).value; applyFilters(); });
}

function bindEvents() {
  document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => openTab(button.dataset.tab)));
  syncSliders();
  updateCharCount();
  renderHistory();
  try { state.outputDir = localStorage.getItem("zextts.outputDir") || ""; } catch {}
  if (state.outputDir) {
    $("outputFolder").value = state.outputDir;
    $("outputFolderHint").textContent = "Ready — new audio will be saved here.";
    $("outputFolderHint").classList.add("ready");
  }

  ["rate", "pitch", "volume"].forEach((id) => $(id).addEventListener("input", () => { syncSliders(); updateCharCount(); }));
  $("scriptText").addEventListener("input", updateCharCount);
  ["voiceSearch", "libraryVoiceSearch"].forEach((id) => $(id).addEventListener("input", () => { state.query = $(id).value; applyFilters(); }));
  bindFilterControl("languageFilter", "language");
  bindFilterControl("libraryLanguageFilter", "language");
  bindFilterControl("countryFilter", "country");
  bindFilterControl("libraryCountryFilter", "country");
  bindFilterControl("genderFilter", "gender");
  bindFilterControl("libraryGenderFilter", "gender");

  $("voiceSelect").addEventListener("change", () => { if ($("voiceSelect").value) selectVoice($("voiceSelect").value); });
  $("btnSort").addEventListener("click", () => {
    state.sortAsc = !state.sortAsc;
    $("btnSort").textContent = state.sortAsc ? "A–Z ↓" : "Z–A ↑";
    applyFilters();
  });
  $("btnResetParams").addEventListener("click", () => {
    $("rate").value = "1"; $("pitch").value = "1"; $("volume").value = "1";
    syncSliders(); updateCharCount();
  });
  document.querySelectorAll("#speedPresets .preset").forEach((button) => button.addEventListener("click", () => { $("rate").value = button.dataset.rate || "1"; syncSliders(); updateCharCount(); }));

  $("btnRefreshVoices").addEventListener("click", refreshVoices);
  $("btnLibraryRefresh").addEventListener("click", refreshVoices);
  $("btnOpenLibrary").addEventListener("click", () => openTab("voices"));
  $("btnChooseOutput").addEventListener("click", chooseOutputFolder);
  $("btnContact").addEventListener("click", openContactPage);
  $("btnAccessContact").addEventListener("click", () => openContactPage($("btnAccessContact")));
  $("btnAccessRetry").addEventListener("click", boot);
  $("btnGenerate").addEventListener("click", onGenerate);
  $("btnPreviewStudio").addEventListener("click", onPreviewLatest);
  $("btnPodcast").addEventListener("click", onPodcast);
  $("btnImportScript").addEventListener("click", openImportModal);
  $("btnCloseImport").addEventListener("click", closeImportModal);
  $("btnCancelImport").addEventListener("click", closeImportModal);
  $("btnApplyImport").addEventListener("click", applyImportedScript);
  $("importScriptText").addEventListener("input", updateImportFeedback);
  $("importModal").addEventListener("click", (event) => { if (event.target === $("importModal")) closeImportModal(); });
  $("btnClear").addEventListener("click", () => { $("scriptText").value = ""; updateCharCount(); setProgress(0, "Ready when your script is"); });
  $("btnSample").addEventListener("click", () => {
    $("scriptText").value = "The best stories don't just live on the page. They breathe, pause, whisper, and come alive in the space between words.";
    updateCharCount(); $("scriptText").focus();
  });
  $("btnReplay").addEventListener("click", onPreviewLatest);
  if ($("btnDownloadAudio")) $("btnDownloadAudio").addEventListener("click", () => downloadAudioItem(state.latestAudio));
  if ($("btnDownloadPodcast")) $("btnDownloadPodcast").addEventListener("click", () => downloadAudioItem(state.latestAudio));
  $("btnAddChar").addEventListener("click", () => {
    state.characters.push({ name: `Speaker ${state.characters.length + 1}`, voiceId: state.selectedVoice });
    renderChars(); renderLines();
  });
  $("btnAddLine").addEventListener("click", () => {
    state.lines.push({ character: state.characters[0] ? state.characters[0].name : "", text: "" });
    renderLines();
  });

  window.addEventListener("offline", () => {
    setConnectivity(false);
    scheduleConnectivityCheck(3000);
  });
  window.addEventListener("online", () => checkConnectivity(false));

  document.addEventListener("keydown", (event) => {
    if (!$("importModal").classList.contains("hidden")) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeImportModal();
      } else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        applyImportedScript();
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      if ($("pane-studio").classList.contains("active")) onGenerate();
      else if ($("pane-podcast").classList.contains("active")) onPodcast();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      ($("pane-voices").classList.contains("active") ? $("libraryVoiceSearch") : $("voiceSearch")).focus();
    }
  });

  window.addEventListener("generation-progress", (event) => {
    const detail = event.detail || {};
    if (detail.phase === "chunk") {
      setProgress(detail.progress || 0, `Rendering chunk ${detail.currentChunk} of ${detail.totalChunks}`);
      setDock("Generating", `Chunk ${detail.currentChunk}/${detail.totalChunks}`);
    } else if (detail.phase === "start") setProgress(0.01, "Preparing voice engine…");
    else if (detail.phase === "done") setProgress(1, "Finalizing audio…");
    else if (detail.phase === "error") setProgress(0, detail.error || "Generation failed");
  });

  window.addEventListener("podcast-progress", (event) => {
    const detail = event.detail || {};
    if (detail.phase === "line") setPodProgress(detail.progress || 0, `${detail.speaker || "Line"} · ${detail.current}/${detail.total}`);
    else if (detail.phase === "start") setPodProgress(0.01, "Preparing cast…");
    else if (detail.phase === "done") setPodProgress(1, "Finalizing podcast…");
  });

  window.addEventListener("access-check-progress", (event) => {
    if (state.access !== "checking") return;
    const detail = event.detail || {};
    showAccessGate("checking", detail);
  });
}

async function boot() {
  if (boot.complete || boot.running) return;
  if (!boot.bound) {
    boot.bound = true;
    bindEvents();
    renderChars();
    renderLines();
  }
  boot.running = true;
  try {
    const api = await waitApi();
    if (!state.outputDir && typeof api.get_default_output_folder === "function") {
      try {
        const defRes = await api.get_default_output_folder();
        if (defRes && defRes.ok && defRes.path) {
          state.outputDir = defRes.path;
          try { localStorage.setItem("zextts.outputDir", defRes.path); } catch {}
          if ($("outputFolder")) $("outputFolder").value = defRes.path;
          if ($("outputFolderHint")) {
            $("outputFolderHint").textContent = "Ready — new audio will be saved here.";
            $("outputFolderHint").classList.add("ready");
          }
        }
      } catch {}
    }
    const allowed = await checkRemoteAccess(true);
    if (!allowed) return;
    await checkConnectivity(true);
    await loadVoices(false);
    boot.complete = true;
  } catch (error) {
    setEngine(false, "Starting…");
    setTimeout(boot, 1000);
  } finally {
    boot.running = false;
  }
}

window.addEventListener("pywebviewready", boot);
boot();
})();
