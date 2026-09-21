(() => {
  "use strict";
  const start = async () => {
    // Electron preload-flow.js owns Google email/password/OTP fill.
    // Running this content-script automation in parallel caused password spam + failed login.
    return;
    let backupFallbackStarted = false;
    let backupChallengeSelected = false;
    let backupCodeAttempted = false;
    let backupCodeRejected = false;
    // A confirmed Google authenticator lockout ends the authenticator route.
    // Keep this separate from backupFallbackStarted so a missing alternate
    // method cannot cause Resume or reinjection to try Authenticator again.
    let authenticatorLockout = false;
    let otpRetryInFlight = false;
    let otpAutomaticAttempts = 0;
    let otpWaitingForFirstRejection = false;
    let otpLastExpiresAt = null;
    let otpConfirmedRejections = [];
    let otpFetchFailures = 0;
    let emailStepAttemptId = null;
    let otpAwaitingFreshRejection = false;
    let otpPendingSince = 0;
    let otpPendingInput = null;
    let otpPendingErrorElements = new Set();
    let otpPendingErrorCleared = false;
    // Google can land on a non-Authenticator verification method such as
    // /challenge/skotp. Route that rendered challenge through its own
    // "Try another way" control once, then let the bounded method chooser
    // select only a real Authenticator option.
    let alternateAuthenticatorRouteStarted = false;
    let expectedEmail = null;
    let lastActionAt = 0;
    let captchaBanner = null;
    let lifecycleEpoch = 0;
    let disposed = false;
    const submitted = new Set();
    const waitingSince = new Map();
    const isCurrent = epoch => !disposed && epoch === lifecycleEpoch;
    const invalidate = () => {
      lifecycleEpoch++;
      // An old inspect may still be awaiting a runtime response. Let a new
      // inspection start, but only its epoch may clear busy in finally.
      busy = false;
      return lifecycleEpoch;
    };
    function settled(key) {
    key = `${location.pathname}:${key}`;
    if (!waitingSince.has(key)) waitingSince.set(key, Date.now());
    return Date.now() - waitingSince.get(key) >= 8000;
    }
    const visuallyVisible = element => {
      if (!element || element.getClientRects?.().length === 0) return false;
      for (let current = element; current; current = current.parentElement) {
        if (current !== element && (current.hidden ||
            current.getAttribute?.("hidden") != null ||
            current.getAttribute?.("aria-hidden") === "true")) return false;
        const style = current.style;
        if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) return false;
        if (typeof getComputedStyle === "function") {
          const computed = getComputedStyle(current);
          if (computed.display === "none" || computed.visibility === "hidden" ||
              computed.visibility === "collapse" || computed.opacity === "0") return false;
        }
      }
      return element.hidden !== true &&
        element.getAttribute?.("hidden") == null &&
        element.getAttribute?.("aria-hidden") !== "true";
    };
    function extensionUi(element) {
      for (let current = element; current; current = current.parentElement || current.parentNode) {
        const id = current.id || current.getAttribute?.("id") || "";
        if (id === "bunnyflow-privacy-shield" || id === "flow-auto-login-captcha-banner") return true;
      }
      return false;
    }
    const visible = element => !extensionUi(element) && visuallyVisible(element) &&
      !element.disabled && element.getAttribute?.("aria-disabled") !== "true";
    const elements = selector => Array.from(document.querySelectorAll(selector)).filter(visible);
    const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    const automationHost = () => location.hostname === "accounts.google.com" || location.hostname === "flow.google.com";
    const captchaSelector = [
    'input[name="ca"]',
    'input[name="captcha"]',
    'input[id*="captcha" i]',
    'textarea[name="g-recaptcha-response"]',
    "textarea.g-recaptcha-response",
    'iframe[src*="recaptcha" i]',
    'iframe[src*="captcha" i]',
    'iframe[title*="recaptcha" i]',
    'img[src*="captcha" i]',
    'img[id*="captcha" i]',
    ".g-recaptcha",
    "[data-sitekey]",
    '[aria-label*="captcha" i]',
    '[title*="captcha" i]',
    '[data-testid*="captcha" i]',
    '[class*="captcha" i]',
    '[id*="captcha" i]'
    ].join(", ");
    function visibleCaptcha() {
    return automationHost() && elements(captchaSelector).some(element => {
      if (element === captchaBanner || captchaBanner?.contains?.(element)) return false;
      // An invisible reCAPTCHA badge/token is not a challenge for the user.
      if (element.closest?.('.grecaptcha-badge, [data-size="invisible"]') ||
          (element.tagName === "IFRAME" && /[?&]size=invisible(?:&|$)/i.test(element.getAttribute("src") || ""))) return false;
      if (typeof getComputedStyle === "function") {
        for (let current = element; current; current = current.parentElement) {
          const style = getComputedStyle(current);
          if (style.visibility === "hidden" || style.visibility === "collapse" ||
              style.display === "none" || style.opacity === "0") return false;
        }
      }
      return true;
    });
    }
    function removeCaptchaBanner() {
    if (captchaBanner?.isConnected) captchaBanner.remove();
    captchaBanner = null;
    resumeInFlight = false;
    }
    // Privacy shield: while Veo Shio types the shared account's email,
    // password and code into Google's form, an opaque cover hides the form
    // visually. This is not a security boundary against the browser owner. It is
    // removed the moment the customer must act (CAPTCHA, security prompt,
    // error), or after a watchdog timeout so nobody is left staring at it.
    const SHIELD_MAX_MS = 90000;
    let shieldHost = null;
    let shieldShownAt = 0;
    function showShield() {
      // Privacy shield removed — keep Google Sign-in visible during auto-login.
    }
    function hideShield() {}
    function shieldExpired() {
      return false;
    }
    function showManualBanner(text) {
    if (resumeInFlight || captchaBanner?.isConnected) return;
    const parent = document.body || document.documentElement;
    if (!parent || typeof document.createElement !== "function") return;
    const banner = document.createElement("aside");
    banner.id = "flow-auto-login-captcha-banner";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    banner.style.cssText = [
      "position:relative",
      "z-index:2147483647",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "gap:10px",
      "box-sizing:border-box",
      "width:calc(100% - 16px)",
      "max-width:560px",
      "margin:8px auto",
      "padding:10px 12px",
      "border:1px solid #b7791f",
      "border-radius:6px",
      "background:#fffaf0",
      "color:#5f370e",
      "font:14px/1.4 Arial,sans-serif",
      "pointer-events:none"
    ].join(";");
    const message = document.createElement("span");
    message.textContent = text;
    const resume = document.createElement("button");
    resume.type = "button";
    resume.textContent = "Resume sign-in";
    resume.style.cssText = [
      "pointer-events:auto",
      "cursor:pointer",
      "white-space:nowrap",
      "padding:5px 9px",
      "border:1px solid #8a5a12",
      "border-radius:4px",
      "background:#fff",
      "color:#5f370e",
      "font:inherit"
    ].join(";");
    resume.addEventListener("click", () => void resumeLogin());
    banner.append(message, resume);
    // This is normal document flow rather than a fixed overlay: the prompt
    // and its controls remain visible and usable while the banner is present.
    parent.insertBefore(banner, parent.firstChild || null);
    captchaBanner = banner;
    }
    function showCaptchaBanner() {
      showManualBanner("Solve the CAPTCHA, then click Resume sign-in.");
    }
    function showAccountMismatchBanner() {
      showManualBanner("The wrong Google account is signed in. Use the assigned account, then click Resume sign-in.");
    }
    function showAccountUnverifiedBanner() {
      showManualBanner("Could not verify the signed-in Google account. Use the assigned account, then click Resume sign-in.");
    }
    function showBackupCodeBanner() {
      showManualBanner("The Google backup code could not be used. Check your remaining backup codes, then click Resume sign-in to continue manually.");
    }
    function showOtpUnavailableBanner() {
      showManualBanner("Google's authenticator form changed or is unavailable. Finish sign-in manually.");
    }
    async function resumeLogin() {
    if (resumeInFlight) return;
      const epoch = invalidate();
      if (!isCurrent(epoch)) return;
    resumeInFlight = true;
    try {
      await send("RESUME_LOGIN");
        if (!isCurrent(epoch)) return;
      // The background normally sends RESUME too. If that delivery was lost,
      // the acknowledged button action still needs to unpause this document.
      if (paused) resumeAutomation();
      else removeCaptchaBanner();
    } catch {
        if (!isCurrent(epoch)) return;
      // Keep the banner and its button available if the background rejects a
      // stale tab or the connection temporarily disappears.
      resumeInFlight = false;
      const message = captchaBanner?.querySelector?.("span");
      if (message) message.textContent = "Unable to resume. Open the extension and use Open / resume Flow to restart an expired attempt.";
    }
    }
    async function send(type, extra = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...extra });
    if (!response?.ok) throw new Error(response?.error || "The extension is not connected.");
    return response.data;
    }
    async function needManual(reason = null, epoch = lifecycleEpoch) {
      if (!isCurrent(epoch)) return;
    // The customer must see and use the page now (CAPTCHA, prompt, error).
    hideShield();
    if (paused) {
      if (reason === "captcha") showCaptchaBanner();
      if (reason === "account_mismatch") showAccountMismatchBanner();
      if (reason === "account_unverified") showAccountUnverifiedBanner();
      if (reason === "backup_code") showBackupCodeBanner();
      if (reason === "otp_form_unavailable") showOtpUnavailableBanner();
      return;
    }
    paused = true;
    if (reason === "captcha") showCaptchaBanner();
    if (reason === "account_mismatch") showAccountMismatchBanner();
    if (reason === "account_unverified") showAccountUnverifiedBanner();
    if (reason === "backup_code") showBackupCodeBanner();
    if (reason === "otp_form_unavailable") showOtpUnavailableBanner();
    await send("LOGIN_MANUAL", reason ? { reason } : {}).catch(() => {});
      if (!isCurrent(epoch)) return;
    }
    function fill(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("This sign-in field is not supported.");
    input.focus();
    setter.call(input, value);
    try {
      input.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: value }));
    } catch {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Unidentified" }));
    }
    function label(element) {
    const text = element.getAttribute?.("aria-label") || element.innerText || element.textContent || "";
    // Google renders icon-font ligatures ("arrow_forward") as text inside the
    // button. Drop those tokens so the visible label is compared, not the icon.
    return text.replace(/\b[a-z]+(?:_[a-z]+)+\b/g, " ").replace(/\s+/g, " ").trim();
    }
    function button(pattern) {
    return elements('button, [role="button"], a[href], [role="link"], [data-challengetype]')
      .find(element => pattern.test(label(element)));
    }
    function canonicalTotpPath(pathname = location.pathname) {
      return /\/challenge\/totp(?:\/|$)/.test(pathname || "");
    }
    function alternateAuthenticatorChallengePath(pathname = location.pathname) {
      // Keep this allowlist narrow. In particular, password, TOTP,
      // selection, backup-code and CAPTCHA routes retain their existing
      // handling. Unknown Google challenges stay manual rather than being
      // guessed into another method.
      return /\/challenge\/(?:skotp|dp|az|ipp|security[-_]?code|sms|phone|ootp|email|wa|u2f|security[-_]?key)(?:\/|$)/i.test(
        pathname || ""
      );
    }
    function otpInputText(input) {
      const values = [
        input?.getAttribute?.("name"),
        input?.getAttribute?.("id"),
        input?.getAttribute?.("type"),
        input?.getAttribute?.("inputmode"),
        input?.getAttribute?.("autocomplete"),
        input?.getAttribute?.("pattern"),
        input?.getAttribute?.("aria-label"),
        input?.getAttribute?.("placeholder"),
        input?.getAttribute?.("title"),
        input?.getAttribute?.("data-testid"),
        input?.getAttribute?.("class")
      ].filter(Boolean);
      // Container names such as "challenge" or password-manager decorations
      // describe the page, not this input's purpose.
      return values.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    }
    function forbiddenOtpInput(input) {
      return /sms|text[\s-]*message|recovery|backup|ootp|captcha|phone|pass(?:word|key)|security[\s-]*key/i.test(
        otpInputText(input)
      );
    }
    function usableInput(input) {
      if (!visible(input) || input?.isConnected === false ||
          (input?.tagName && input.tagName.toUpperCase() !== "INPUT")) return false;
      const type = input.getAttribute?.("type") || "";
      if (!/^(?:text|tel|number)?$/i.test(type) || input.readOnly ||
          input.getAttribute?.("readonly") != null ||
          input.getAttribute?.("aria-readonly") === "true") return false;
      for (let current = input; current; current = current.parentElement) {
        if (
          current.disabled ||
          current.getAttribute?.("disabled") != null ||
          current.getAttribute?.("aria-disabled") === "true" ||
          current.getAttribute?.("aria-busy") === "true" ||
          current.getAttribute?.("data-busy") === "true" ||
          current.getAttribute?.("inert") != null
        ) return false;
      }
      return true;
    }
    function safeOtpInput(input, canonical = false) {
      if (!usableInput(input) || forbiddenOtpInput(input)) return false;
      const text = otpInputText(input);
      const autocomplete = input.getAttribute?.("autocomplete") || "";
      const inputmode = input.getAttribute?.("inputmode") || "";
      const type = input.getAttribute?.("type") || "";
      const safeName = /(?:^|[\s_-])(?:totp|otp|one[\s_-]*time[\s_-]*code|verification[\s_-]*code)(?:$|[\s_-])/i.test(text) ||
        /(?:totp|otp|one[\s-]*time[\s-]*code|verification[\s-]*code)/i.test(text);
      const safeAttributes = safeName ||
        /^one-time-code$/i.test(autocomplete.trim()) ||
        /^numeric$/i.test(inputmode.trim()) ||
        /^(?:tel|number)$/i.test(type.trim());
      return canonical && /totpPin/i.test(text) || safeAttributes;
    }
    function authenticatorField() {
      if (!canonicalTotpPath()) return null;
      const explicit = elements('input[name="totpPin"], #totpPin')
        .filter(input => usableInput(input) && !forbiddenOtpInput(input));
      const allInputs = Array.from(document.querySelectorAll("input"))
        .filter(input => safeOtpInput(input));
      const candidates = [...new Set([...explicit, ...allInputs])];
      // A canonical totpPin is a strong signal, but another visible numeric
      // field makes the challenge ambiguous. Never guess between two controls.
      return candidates.length === 1 ? candidates[0] : null;
    }
    function methodText(element) {
      return [
        element?.getAttribute?.("aria-label"),
        element?.getAttribute?.("title"),
        element?.innerText,
        element?.textContent,
        element?.getAttribute?.("data-challengetype"),
        ...["data-state", "data-status", "data-unavailable", "data-disabled", "data-forbidden", "class", "id"]
          .map(name => element?.getAttribute?.(name))
      ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    }
    function usableMethod(element) {
      if (!visible(element)) return false;
      for (let current = element; current; current = current.parentElement) {
        if (
          current.disabled ||
          current.getAttribute?.("disabled") != null ||
          current.getAttribute?.("aria-disabled") === "true" ||
          current.getAttribute?.("aria-busy") === "true" ||
          current.getAttribute?.("data-busy") === "true" ||
          current.getAttribute?.("inert") != null
        ) return false;
      }
      return !/unavailable|not[\s-]*(?:available|allowed)|forbidden|disabled|can't[\s-]*use|cannot[\s-]*use|not[\s-]*(?:set[\s-]*up|configured)/i.test(
        methodText(element)
      );
    }
    function authenticatorMethod() {
      const controls = elements('button, [role="button"], a[href], [role="link"], [data-challengetype]')
        .filter(usableMethod);
      const semantic = controls.filter(element =>
        String(element.getAttribute?.("data-challengetype") || "").trim() === "6");
      if (semantic.length === 1) return semantic[0];
      if (semantic.length > 1) return null;
      const canonicalLinks = controls.filter(element => {
        const href = element.getAttribute?.("href") || "";
        return /(?:^|\/)challenge\/totp(?:[/?#]|$)/i.test(href);
      });
      if (canonicalLinks.length === 1) return canonicalLinks[0];
      if (canonicalLinks.length > 1) return null;
      const labelled = controls.filter(element => {
        const text = methodText(element);
        return text.length <= 180 &&
          /authenticator(?:[\s_-]+app)?|verification[\s_-]+code[\s_-]+from[\s_-]+(?:an?\s+)?authenticator/i.test(text) &&
          !/backup|sms|recovery|phone|ootp|captcha/i.test(text);
      });
      return labelled.length === 1 ? labelled[0] : null;
    }
    function ancestorUnavailable(element) {
      for (let current = element; current; current = current.parentElement) {
        if (
          current.disabled ||
          current.getAttribute?.("disabled") != null ||
          current.getAttribute?.("aria-disabled") === "true" ||
          current.getAttribute?.("aria-busy") === "true" ||
          current.getAttribute?.("data-busy") === "true" ||
          current.getAttribute?.("inert") != null
        ) return true;
      }
      return false;
    }
    function submitControl(element) {
      if (!element || element.isConnected === false || !visible(element) || ancestorUnavailable(element)) return false;
      const tag = String(element.tagName || "").toUpperCase();
      const role = element.getAttribute?.("role") || "";
      const type = element.getAttribute?.("type") || "";
      return tag === "BUTTON" || role === "button" ||
        (tag === "INPUT" && /^(?:submit|button)$/i.test(type));
    }
    function ancestorForm(input) {
      if (!input) return null;
      if (input.form) return input.form;
      if (typeof input.closest === "function") {
        const form = input.closest("form");
        if (form) return form;
      }
      for (let current = input.parentElement; current; current = current.parentElement) {
        if (String(current.tagName || "").toUpperCase() === "FORM") return current;
      }
      return null;
    }
    function formSubmitTarget(form) {
      if (!form || !visible(form) || ancestorUnavailable(form)) return null;
      return { form, submitter: null };
    }
    function otpSubmitTarget(input) {
      if (!canonicalTotpPath() || !input || !usableInput(input)) return null;
      const root = document.querySelector("#totpNext");
      if (root && visible(root) && !ancestorUnavailable(root)) {
        const descendants = Array.from(root.querySelectorAll?.("button, [role=\"button\"], input") || [])
          .filter(submitControl);
        if (descendants.length === 1) return { element: descendants[0] };
        if (submitControl(root)) return { element: root };
        if (descendants.length > 1) {
          const labelled = descendants.filter(element => /^(?:next|verify|submit)$/i.test(label(element)));
          if (labelled.length === 1) return { element: labelled[0] };
          return null;
        }
      }
      const form = ancestorForm(input);
      if (form && visible(form) && !ancestorUnavailable(form)) {
        const descendants = Array.from(form.querySelectorAll?.("button, [role=\"button\"], input") || [])
          .filter(submitControl);
        const labelled = descendants.filter(element => /^(?:next|verify|submit)$/i.test(label(element)));
        if (labelled.length === 1) return { element: labelled[0] };
        if (descendants.length === 1) return { element: descendants[0] };
        if (!descendants.length && (typeof form.requestSubmit === "function" || typeof form.submit === "function")) {
          return formSubmitTarget(form);
        }
      }
      // Some Google renders omit the #totpNext wrapper and the input's form
      // association. Keep the final fallback semantic and unique: never pick
      // an arbitrary visible control just because it is clickable.
      const globalLabelled = elements('button, [role="button"], input[type="submit"]')
        .filter(element => /^(?:next|verify)$/i.test(label(element)));
      if (globalLabelled.length === 1) return { element: globalLabelled[0] };
      return null;
    }
    function otpSubmitTargetUsable(target) {
      if (!target) return false;
      if (target.element) return submitControl(target.element);
      return !!target.form && visible(target.form) && !ancestorUnavailable(target.form) &&
        (typeof target.form.requestSubmit === "function" || typeof target.form.submit === "function");
    }
    function backupChallengeText(element) {
      return [
        element.getAttribute?.("aria-label"),
        label(element),
        element.innerText,
        element.textContent,
        element.getAttribute?.("title"),
        element.getAttribute?.("data-challengetype")
      ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    }
    function backupChallengeControl() {
      // Do not treat every numeric-looking challenge as a backup code.  Google
      // exposes SMS and phone challenges through the same generic control
      // shapes, so the visible control must explicitly say backup code(s) or
      // 8-digit backup code.
      return elements('button, [role="button"], a[href], [role="link"], [data-challengetype]')
        .find(element => /(?:backup\s+codes?|8[\s-]*digit\s+backup)/i.test(backupChallengeText(element)));
    }
    function backupChallengePage() {
      return /\/challenge\/(?:backup(?:[-_]?code)?|bc)(?:\/|$)/i.test(location.pathname);
    }
    function currentBackupEvidence() {
      if (backupChallengePage()) return true;
      // A generic challenge/bc input is accepted only when the current
      // document still exposes backup-code evidence. backupChallengeSelected
      // alone is intentionally insufficient: a SPA can retain that flag while
      // replacing the form with an SMS/phone challenge.
      const candidates = elements([
        'input[name="challenge"]',
        '#challenge',
        'input[name="bc"]',
        '#bc',
        'label',
        '[aria-label]',
        '[title]',
        'h1',
        'h2',
        'h3',
        '[role="heading"]',
        '[data-challengetype]'
      ].join(", "));
      return candidates.some(element =>
        /(?:backup\s+codes?|8[\s-]*digit\s+backup)/i.test(backupChallengeText(element)));
    }
    function backupCodeField() {
      // These are the names used by Google's backup-code challenge variants.
      // In particular, do not include an unqualified numeric/tel input: that
      // would risk putting an authenticator code into an SMS challenge.
      const canonical = elements('input[name="backupCodePin"], #backupCodePin')[0];
      if (canonical) return canonical;
      if (!currentBackupEvidence()) return null;
      return elements([
        'input[name="challenge"]',
        '#challenge',
        'input[name="bc"]',
        '#bc'
      ].join(", "))[0] || null;
    }
    function invalidBackupCode() {
      const input = backupCodeField();
      if (!input) return false;
      if (input.getAttribute?.("aria-invalid") === "true") return true;
      const described = (input.getAttribute?.("aria-describedby") || "").split(/\s+/)
        .map(id => document.getElementById?.(id)).filter(Boolean);
      return described
        .some(element => visible(element) &&
          /wrong|incorrect|invalid|expired|used|no longer available/i.test(element.innerText || element.textContent || ""));
    }
    function backupNavigationControl() {
      // "Back" is included only as a challenge navigation control.  It is
      // never clicked on password or account pages and only participates after
      // an authenticator failure/unavailability has made fallback eligible.
      return button(/try another way|choose another option|^back(?:\s+to\b.*)?$/i);
    }
    function tryAnotherWayControl() {
      // Non-Authenticator challenges must use this explicit Google control.
      // Do not treat a generic link or a guessed numeric field as a route.
      return button(/^try another way$/i);
    }
    function authenticatorLockoutVisible() {
      // Google can leave the TOTP field mounted while showing Account recovery
      // and "Unavailable because of too many failed attempts" (or "too many
      // requests"). Inspect only bounded heading/status nodes, not body text,
      // and require the canonical TOTP route plus Authenticator context so a
      // generic page rate-limit cannot authorize a backup-code request.
      if (!canonicalTotpPath()) return false;
      const statusNodes = elements(
        'h1, h2, h3, [role="heading"], [role="alert"], [aria-live="assertive"], [aria-live="polite"]'
      );
      const statusText = statusNodes.map(element => label(element)).filter(Boolean).join(" ");
      if (!/\btoo many (?:failed attempts?|requests?)\b/i.test(statusText)) return false;
      const recoveryHeading = statusNodes.some(element => /^account recovery$/i.test(label(element)));
      const alternate = backupNavigationControl();
      const authenticatorContext = /\b(?:authenticator|verification\s+code|2[-\s]?step)\b/i.test(statusText);
      return recoveryHeading || !!alternate || authenticatorContext;
    }
    function otpBudgetAvailable() {
      return otpAutomaticAttempts < 2;
    }
    function backupFallbackEligible(invalidOtp = false) {
      return invalidOtp ||
        (!authenticatorField() && (
          /\/challenge\/totp(?:\/|$)/.test(location.pathname) ||
          (/\/challenge\//.test(location.pathname) && !!backupChallengeControl())
        ));
    }
    function startBackupFallback(invalidOtp = false) {
      if (backupCodeAttempted || backupCodeRejected || backupFallbackStarted) return false;
      if (!backupFallbackEligible(invalidOtp)) return false;
      const option = backupChallengeControl();
      if (option) {
        backupFallbackStarted = true;
        backupChallengeSelected = true;
        return clickOnce("backup-challenge-option", option);
      }
      const navigation = backupNavigationControl();
      if (!navigation) return false;
      backupFallbackStarted = true;
      return clickOnce("backup-challenge-navigation", navigation);
    }
    function invalidAuthenticatorCode() {
      const input = authenticatorField();
      if (!input) return false;
      if (input.getAttribute?.("aria-invalid") === "true") return true;
      const described = (input.getAttribute?.("aria-describedby") || "").split(/\s+/)
        .map(id => document.getElementById?.(id)).filter(Boolean);
      return [...elements('[role="alert"], [aria-live]'), ...described]
        .some(element => visible(element) && /wrong code|incorrect code|invalid code|code.*expired/i.test(element.innerText || element.textContent || ""));
    }
    function otpRejectionErrorElements() {
      return elements('[role="alert"], [aria-live="assertive"]')
        .filter(element => /wrong|incorrect|invalid|expired|code.*failed/i.test(element.innerText || element.textContent || ""));
    }
    function flowProjectText(value) {
    let text = String(value || "").replace(/\s+/g, " ").trim();
    // Material Symbols can render the icon name ("add") or a plus sign as a
    // leading text node. Strip only those leading tokens; never search a
    // page/body string for a project phrase.
    while (true) {
      const icon = /^(?:add|plus|\+)/i.exec(text);
      const remainder = icon ? text.slice(icon[0].length) : "";
      if (!icon || !/^(?:\s|[A-Z]|$)/.test(remainder)) break;
      text = remainder.trim();
    }
    return text.toLowerCase();
    }
    function isFlowProjectLabel(element) {
    if (!visible(element)) return false;
    const accessible = element.getAttribute?.("aria-label");
    if (accessible && /^(?:new project|new flow|create a new project)$/i.test(accessible.trim())) return true;
    return /^(?:new project|new flow|create a new project)$/.test(
      flowProjectText(element.innerText || element.textContent || "")
    );
    }
    function flowAccountElements() {
    // Flow's account chip is an actionable control with an account-specific
    // accessible label. Do not treat an avatar image, URL, or arbitrary body
    // text as proof that the dashboard is authenticated.
      return Array.from(document.querySelectorAll(
      'button, [role="button"], a[href], [role="link"], [data-bf-flow-account-locked]'
      )).filter(element => visuallyVisible(element) && (() => {
        const labels = [element, ...(element.querySelectorAll?.("[aria-label], [title]") || [])];
        return labels.some(labelElement => {
          if (!visuallyVisible(labelElement)) return false;
          const accessible = labelElement.getAttribute?.("aria-label")?.trim() || "";
          const title = labelElement.getAttribute?.("title")?.trim() || "";
          if (labelElement.getAttribute?.("data-email") ||
              labelElement.getAttribute?.("data-identifier")) return true;
          if (/^google account\b/i.test(accessible) || /^google account\b/i.test(title)) return true;
          return /@/.test(accessible) && /(?:account|profile|google)/i.test(`${accessible} ${title}`);
        });
      })());
    }
    function flowAccountEmails() {
      return flowAccountElements().flatMap(element => {
        const labels = [
          element,
          ...(element.querySelectorAll?.("[aria-label], [title], [data-email], [data-identifier]") || [])
        ];
        return labels.flatMap(labelElement => {
          const values = [
            labelElement.getAttribute?.("data-email"),
            labelElement.getAttribute?.("data-identifier"),
            labelElement.getAttribute?.("aria-label"),
            labelElement.getAttribute?.("title"),
            labelElement.textContent
          ].filter(Boolean).join(" ");
          return values.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi) || [];
        });
      }).map(value => value.toLowerCase());
    }
    function flowAccountControl() {
      return flowAccountElements().length > 0;
    }
    function flowProjectReady() {
    const editor = elements('textarea, [contenteditable="true"], [role="textbox"]').length > 0;
    if (editor) return true;
    const semanticProject = elements('button, [role="button"], a[href], [role="link"]')
      .find(isFlowProjectLabel);
    const project = semanticProject || elements('div, [aria-label]')
      .find(isFlowProjectLabel);
    if (!project) return false;
    // A plain div is how the dashboard currently renders the New project
    // tile. Require the signed-in account control for that non-semantic
    // fallback so landing/help copy cannot complete login.
    const semantic = /^(?:BUTTON|A)$/.test(String(project.tagName || "").toUpperCase()) ||
      project.getAttribute?.("role") === "button" || project.getAttribute?.("role") === "link";
    return semantic || flowAccountControl();
    }
    function clickOnce(key, element) {
    if (!visible(element) || submitted.has(key)) return false;
    submitted.add(key);
    lastActionAt = Date.now();
    element.click();
    return true;
    }
    function accountChooserVisible() {
    if (!/accounts\.google\.com$/i.test(location.hostname)) return false;
    if (/accountchooser|signin\/chooser|\/AddSession(?:[/?#]|$)/i.test(location.href)) return true;
    // Google sometimes shows the remembered-account list without the chooser URL.
    return elements("h1, [role=\"heading\"]").some(element => /^choose an account$/i.test(label(element)));
    }
    function chooserText(pattern) {
    // Chooser rows and "Use another account" are plain divs/li in Google's v3
    // UI, so only match short leaf-ish text and never a large container.
    return elements('li, [role="link"], [role="button"], [data-identifier], [data-email]')
      .find(element => pattern.test(label(element)) && label(element).length <= 80);
    }
    function accountChooserRow(email) {
    if (!email) return null;
    const rows = elements("[data-identifier], [data-email]");
    const byAttribute = rows.find(element =>
      (element.getAttribute("data-identifier") || element.getAttribute("data-email") || "").trim().toLowerCase() === email);
    if (byAttribute) return byAttribute;
    const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^|\\s)${escaped}(\\s|$)`, "i");
    return elements('li, [role="link"], [role="button"]').find(element => pattern.test(label(element)) && label(element).length <= 160) || null;
    }
    async function getEmail(epoch = lifecycleEpoch) {
    if (!isCurrent(epoch)) return null;
    if (!expectedEmail) {
      const result = await send("STEP", { stage: "email" });
      if (!isCurrent(epoch)) return null;
      emailStepAttemptId = result?.attemptId || null;
      expectedEmail = String(result.value).trim().toLowerCase();
    }
    return expectedEmail;
    }
    async function accountMatches(epoch = lifecycleEpoch) {
    const expected = await getEmail(epoch);
    if (!isCurrent(epoch)) return null;
      const identifier = accountIdentifiers()
      // Only proceed if Google identifies the intended account. Never put a shared
      // password into an unknown or different Google account's password form.
      if (!identifier.length) return null;
      return identifier.every(value => value === expected);
    }
    function accountIdentifiers() {
      return elements('[data-email], [data-identifier], #profileIdentifier, [role="button"][aria-label*="@"], [role="link"][aria-label*="@"]')
      .flatMap(element => {
        const value = element.getAttribute("data-email") || element.getAttribute("data-identifier") ||
          element.getAttribute("aria-label") || element.textContent || "";
        // Google's account chip can include an icon label or accessibility copy.
        // Compare complete extracted addresses, never substring-match an email.
        return value.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi) || [];
      }).map(value => value.toLowerCase());
    }
    function accountMatchesSynchronously() {
      if (!expectedEmail) return false;
      const identifier = accountIdentifiers();
      return identifier.length > 0 && identifier.every(value => value === expectedEmail);
    }
    function otpStateCurrent(epoch, pathname) {
      return isCurrent(epoch) && location.pathname === pathname &&
        canonicalTotpPath(pathname) && !visibleCaptcha() && !paused;
    }
    async function waitForOtpForm(epoch, pathname, expiresAt) {
      const deadline = Date.now() + 4000;
      while (Date.now() <= deadline) {
        if (!otpStateCurrent(epoch, pathname) || !accountMatchesSynchronously()) return null;
        if (Date.parse(expiresAt) - Date.now() < 2000) return null;
        const input = authenticatorField();
        const target = input && otpSubmitTarget(input);
        if (input && target && otpSubmitTargetUsable(target)) return { input, target };
        await pause(100);
      }
      return null;
    }
    async function submitField(stage, input, next, epoch = lifecycleEpoch, slot = null) {
    if (!isCurrent(epoch)) return;
    const key = stage === "otp"
      ? `otp:${location.pathname}:${slot ?? otpAutomaticAttempts + 1}`
      : `${stage}:${location.pathname}`;
      if (submitted.has(key) || (stage !== "otp" && !visible(next))) return;
      const otpPathname = stage === "otp" ? location.pathname : null;
    if (stage !== "email") {
      const matches = await accountMatches(epoch);
      if (!isCurrent(epoch)) return;
      if (matches === false || (matches === null && settled("account-identity"))) {
        await needManual(null, epoch);
        if (!isCurrent(epoch)) return;
        return;
      }
      if (matches === null) return;
    }
    let result;
    if (stage === "email") {
      const value = await getEmail(epoch);
      if (!isCurrent(epoch)) return;
      result = { value, attemptId: emailStepAttemptId };
    } else {
      if (stage === "backup_code") {
        // Mark the request immediately before sending it, after account
        // identity and field checks have passed. A temporarily unavailable
        // identity must remain retryable; a sent request must not be repeated.
        backupCodeAttempted = true;
      }
      result = await send("STEP", { stage });
      if (!isCurrent(epoch)) return;
    }
      if (stage === "otp" && !otpStateCurrent(epoch, otpPathname)) return;
    if (stage === "otp" && (retryInvalidOtp || Date.parse(result.expiresAt) - Date.now() < 8000)) {
      // A user-requested retry must not immediately submit the same rejected
      // 30-second code. Wait for the server-provided window to end, then fetch
      // once more. Never guess a different authenticator or retry in a loop.
      const remaining = Date.parse(result.expiresAt) - Date.now();
      if (!Number.isFinite(remaining) || remaining > 35000) throw new Error("Verification code timing is unavailable.");
      result = null;
      await pause(Math.max(300, remaining + 500));
      if (!isCurrent(epoch)) return;
      result = await send("STEP", { stage });
      if (!isCurrent(epoch)) return;
       if (!otpStateCurrent(epoch, otpPathname)) return;
       const otpForm = await waitForOtpForm(epoch, otpPathname, result?.expiresAt);
       if (!otpForm) {
         if (otpStateCurrent(epoch, otpPathname) && accountMatchesSynchronously()) {
           await needManual("otp_form_unavailable", epoch);
         }
         return;
       }
       input = otpForm.input;
       next = otpForm.target;
    }
    const context = await send("CONTEXT");
    if (!isCurrent(epoch)) return;
      if (result?.attemptId !== context?.attemptId) {
        throw new Error("The sign-in attempt changed before the credential step completed.");
      }
    if (!context.active) return;
    if (stage === "otp") {
      const matches = await accountMatches(epoch);
      if (!isCurrent(epoch)) return;
      if (matches === false || (matches === null && settled("account-identity"))) {
        await needManual(null, epoch);
        if (!isCurrent(epoch)) return;
        return;
      }
      if (matches === null || !otpStateCurrent(epoch, otpPathname)) return;
      const otpForm = await waitForOtpForm(epoch, otpPathname, result?.expiresAt);
      if (!otpForm) {
        if (otpStateCurrent(epoch, otpPathname) && accountMatchesSynchronously()) {
          await needManual("otp_form_unavailable", epoch);
        }
        return;
      }
      input = otpForm.input;
      next = otpForm.target;
    } else if (!input.isConnected || !next.isConnected) return;
    if (stage === "otp") {
      if (!(Date.parse(result.expiresAt) - Date.now() >= 2000)) throw new Error("The verification code expired before it could be submitted.");
      // The worker owns the attempt budget and records only the code window.
      // Reserve immediately before filling/clicking so prefetches never
      // consume a submission and a navigation cannot replay this code window.
      await send("OTP_SUBMIT", {
        attemptId: context.attemptId,
        expiresAt: result.expiresAt
      });
      if (!isCurrent(epoch)) return;
      otpAutomaticAttempts = Math.max(otpAutomaticAttempts, Number(context.otpSubmissionCount) || 0) + 1;
       otpWaitingForFirstRejection = !authenticatorLockout && otpAutomaticAttempts === 1;
      otpLastExpiresAt = result.expiresAt;
      retryInvalidOtp = false;
      // OTP_SUBMIT reserves the window before the code is placed in Google's
      // DOM. Google may replace or disable both nodes while that reservation
      // is in flight; keep this exact code and reservation, then wait only for
      // a fresh usable form. There is intentionally no second STEP or reserve.
      const fresh = await waitForOtpForm(epoch, otpPathname, result.expiresAt);
      if (!fresh) {
        if (otpStateCurrent(epoch, otpPathname) && accountMatchesSynchronously()) {
          await needManual("otp_form_unavailable", epoch);
        }
        return;
      }
      input = fresh.input;
      next = fresh.target;
      if (otpAutomaticAttempts >= 2) {
        // Capture the rejection baseline only after the final replacement
        // wait. A stale first-code error must remain baseline feedback even
        // when Google swapped the input while OTP_SUBMIT was pending.
        otpAwaitingFreshRejection = true;
        otpPendingSince = Date.now();
        otpPendingInput = input;
        otpPendingErrorElements = new Set(otpRejectionErrorElements());
        otpPendingErrorCleared = false;
      }
      // Keep fill and submit adjacent: once the reservation is consumed, no
      // asynchronous operation may intervene or expose a second submission.
      submitted.add(key);
      lastActionAt = Date.now();
      fill(input, String(result.value));
      result = null;
      if (next.element) next.element.click();
      else if (typeof next.form.requestSubmit === "function") next.form.requestSubmit(next.submitter || undefined);
      else next.form.submit();
      return;
    }
    if (stage === "backup_code" && !/^\d{8}$/.test(String(result?.value ?? "").trim())) {
      throw new Error("The backup code is unavailable.");
    }
    // No Google credential is stored in extension storage, logs, URLs, or messages
    // to any unrelated page. Google receives it only through its own input.
    fill(input, String(result.value));
    result = null;
    await pause(700);
    if (!isCurrent(epoch)) return;
    const nextControl = (next && next.querySelector && next.querySelector("button")) || next ||
      document.querySelector(stage === "password" ? "#passwordNext button, #passwordNext" : "#identifierNext button, #identifierNext") ||
      button(/^next$/i);
    if (nextControl) {
      const disabled = nextControl.disabled === true ||
        nextControl.getAttribute("aria-disabled") === "true" ||
        nextControl.getAttribute("disabled") != null;
      if (!disabled) {
        clickOnce(key, nextControl);
      } else {
        // Retry once after Google's Lit model catches up
        await pause(600);
        if (!isCurrent(epoch)) return;
        clickOnce(key, nextControl);
      }
    } else {
      clickOnce(key, next);
    }
    }
    async function retryFreshAuthenticator(epoch, context) {
      if (otpRetryInFlight || otpAutomaticAttempts !== 1 || !otpBudgetAvailable()) return false;
      const expiresAt = Date.parse(context?.otpLastExpiresAt || otpLastExpiresAt || "");
      if (!Number.isFinite(expiresAt)) return false;
      otpRetryInFlight = true;
      try {
        const remaining = expiresAt - Date.now();
        if (!Number.isFinite(remaining) || remaining > 35000) throw new Error("Verification code timing is unavailable.");
        // Google will otherwise show the same TOTP for the rest of its
        // 30-second window. Waiting here is deliberate: no second STEP or
        // DOM submission is attempted until a fresh window is available.
        await pause(Math.max(300, remaining + 500));
        if (!isCurrent(epoch)) return true;
        const input = authenticatorField();
        const next = input && otpSubmitTarget(input);
        if (!input || !next) return false;
        await submitField("otp", input, next, epoch, 2);
        return true;
      } finally {
        otpRetryInFlight = false;
      }
    }
    async function confirmOtpRejection(epoch, context) {
      const attemptId = context?.attemptId;
      const expiresAt = context?.otpLastExpiresAt || otpLastExpiresAt;
      if (!attemptId || !expiresAt || !Number.isFinite(Date.parse(expiresAt))) return false;
      const metadata = await send("OTP_REJECTED", { attemptId, expiresAt });
      if (!isCurrent(epoch)) return false;
      if (Array.isArray(metadata?.otpRejectedWindows)) {
        otpConfirmedRejections = metadata.otpRejectedWindows;
      }
      return otpConfirmedRejections.includes(expiresAt);
    }
    async function inspect(epoch = lifecycleEpoch) {
    if (busy || resumeInFlight || document.hidden || Date.now() - lastActionAt < 1800) return;
    if (!isCurrent(epoch)) return;
    busy = true;
    try {
      const context = await send("CONTEXT");
      if (!isCurrent(epoch)) return;
       // The worker persists this attempt-level guard across full navigation,
       // content-script reinjection and worker restart. The flag is returned
       // only after the sender and attempt have been validated there.
       alternateAuthenticatorRouteStarted = context?.alternateAuthenticatorRouteAttempted === true;
       if (context?.backupCodeAttempted === true) backupCodeAttempted = true;
       if (context?.authenticatorLockout === true) {
         authenticatorLockout = true;
         otpWaitingForFirstRejection = false;
         if (!backupCodeAttempted) backupFallbackStarted = true;
       }
       if (Number.isInteger(context?.otpSubmissionCount) && context.otpSubmissionCount >= 0) {
         otpAutomaticAttempts = context.otpSubmissionCount;
       }
       if (typeof context?.otpLastExpiresAt === "string") otpLastExpiresAt = context.otpLastExpiresAt;
        if (Array.isArray(context?.otpRejectedWindows)) {
          otpConfirmedRejections = context.otpRejectedWindows.filter(item =>
            typeof item === "string" && Number.isFinite(Date.parse(item)));
        }
         otpWaitingForFirstRejection = !authenticatorLockout && otpAutomaticAttempts === 1;
        if (Number.isInteger(context?.otpFetchFailureCount) && context.otpFetchFailureCount >= 0) {
          otpFetchFailures = context.otpFetchFailureCount;
        }
      if (!context?.active || context?.phase === "manual") hideShield();
      if (context?.phase === "manual") paused = true;
      const captchaManual = context?.phase === "manual" && context?.manualReason === "captcha";
      if (captchaManual) {
        if (!isCurrent(epoch)) return;
        paused = true;
        showCaptchaBanner();
        return;
      }
      if (context?.phase === "manual" && context?.manualReason === "account_mismatch") {
        if (!isCurrent(epoch)) return;
        paused = true;
        showAccountMismatchBanner();
        return;
      }
      if (context?.phase === "manual" && context?.manualReason === "account_unverified") {
        if (!isCurrent(epoch)) return;
        paused = true;
        showAccountUnverifiedBanner();
        return;
      }
      if (context?.phase === "manual" && context?.manualReason === "backup_code") {
        if (!isCurrent(epoch)) return;
        paused = true;
        showBackupCodeBanner();
        return;
      }
      // A successful resume (or any non-manual state) removes a banner left
      // by an earlier render. Generic manual assistance remains supported,
      // but intentionally has no specialized banner.
      removeCaptchaBanner();
      const captcha = visibleCaptcha();
      // Keep this check ahead of Flow's editor/project success detection. A
      // CAPTCHA must never be mistaken for a logged-in Flow page.
      if (captcha && context?.active && automationHost()) {
        await needManual("captcha", epoch);
        if (!isCurrent(epoch)) return;
        return;
      }
      if (paused) return;
      if (location.hostname === "accounts.google.com" && context?.active && context.phase === "login") {
        if (shieldExpired()) {
          // Automation made no visible progress for a long time: give the
          // page back to the customer instead of hiding a stuck screen.
          await needManual(null, epoch);
          return;
        }
        showShield();
      } else hideShield();
      if (location.hostname === "flow.google.com") {
        if (!context.managed && !context.active) return;
        // Privacy may protect an already-open Flow page before pairing; that
        // does not authorize clicking its sign-in CTA before confirmation.
        if (!context.active && context.allowLaunch !== true) return;
        // The public landing CTA is safe in every managed Flow tab, including
        // after login has finished. Credential automation remains active-tab only.
        const launch = button(/\bcreate with (?:google )?flow\b/i) ||
          (context.active ? button(/^(try flow|sign in|sign in with google|get started)$/i) : null);
        if (launch) {
          if (clickOnce(`flow:${location.pathname}`, launch)) return;
          // The CTA was already clicked; give Google time to navigate before
          // falling back to a direct sign-in below.
          if (!context.active || !settled("flow-launch")) return;
        }
        if (!context.active) return;
        if (flowProjectReady()) {
          const expected = String(context.expectedEmail || "").trim().toLowerCase();
          const identifiers = flowAccountEmails();
          // A Flow dashboard/editor is not proof of the intended Google
          // identity. Only complete when Flow exposes an account control whose
          // full address is exactly the admin-assigned account. Missing identity
          // evidence waits for the page to settle, then fails closed.
          if (!expected || !identifiers.length) {
            if (settled("flow-account-identity")) await needManual("account_unverified", epoch);
            return;
          }
          if (!identifiers.every(value => value === expected)) {
            const switchAccount = await send("ACCOUNT_MISMATCH").catch(() => null);
            if (!isCurrent(epoch)) return;
            if (switchAccount?.redirect) {
              lastActionAt = Date.now();
              const addSession = "https://accounts.google.com/AddSession?continue=" +
                encodeURIComponent("https://flow.google.com/");
              try {
                if (typeof location.assign === "function") location.assign(addSession);
                else location.href = addSession;
              } catch {
                await needManual("account_mismatch", epoch);
              }
            } else {
              await needManual("account_mismatch", epoch);
            }
            if (!isCurrent(epoch)) return;
            return;
          }
          await send("LOGIN_SUCCESS");
          if (!isCurrent(epoch)) return;
          paused = true;
          return;
        }
        // Flow's landing page did not expose a usable sign-in CTA (changed
        // markup, a region/consent dialog, or a click that never navigated).
        // Go to Google sign-in directly in this same authorized tab instead of
        // waiting forever; the credential steps stay on accounts.google.com.
        if (settled("flow-launch") && !submitted.has("flow:direct-signin")) {
          submitted.add("flow:direct-signin");
          lastActionAt = Date.now();
          const signin = "https://accounts.google.com/ServiceLogin?hl=en&continue=" + encodeURIComponent("https://flow.google.com/");
          if (typeof location.assign === "function") location.assign(signin);
          else location.href = signin;
        }
        return;
      }
      if (!context.active) return;
      if (location.hostname !== "accounts.google.com") return;
      const invalidOtp = invalidAuthenticatorCode();
      const error = invalidOtp || elements('[role="alert"], [aria-live="assertive"]')
        .some(element => /wrong password|incorrect password|wrong code|incorrect code|too many|couldn.t sign|could not sign|try again later/i.test(element.innerText || ""));
      const otpPath = /\/challenge\/totp(?:\/|$)/.test(location.pathname);
      const otpInput = authenticatorField();
      const otpErrorElements = otpRejectionErrorElements();
      const otpLockout = authenticatorLockoutVisible() &&
        (otpAutomaticAttempts >= 1 || context?.authenticatorLockout !== true);
      if (otpLockout) {
        // This is a provider-confirmed authenticator lockout, not a transient
        // missing field. Record the worker-authoritative signal, then leave
        // Authenticator permanently and use the one-code backup path.
        authenticatorLockout = true;
        otpWaitingForFirstRejection = false;
        const currentWindow = context.otpLastExpiresAt || otpLastExpiresAt;
        if (context?.authenticatorLockout !== true) {
          try {
            await send("AUTHENTICATOR_LOCKOUT", { attemptId: context.attemptId });
          } catch {
            await needManual("otp_reservation_failed", epoch);
            if (!isCurrent(epoch)) return;
            return;
          }
        }
        if (currentWindow && !otpConfirmedRejections.includes(currentWindow) &&
            !await confirmOtpRejection(epoch, context)) {
          await needManual("invalid_code", epoch);
          if (!isCurrent(epoch)) return;
          return;
        }
        if (startBackupFallback(true)) return;
        // Let Google's chooser finish painting when it has not exposed a
        // method yet. If it remains absent, pause explicitly rather than
        // guessing a method or requesting a backup code.
        if (!settled("backup-challenge-choice")) return;
        await needManual("backup_code", epoch);
        if (!isCurrent(epoch)) return;
        return;
      }
      // A missing field is normal while Google's SPA replaces a challenge.
      // Only an explicit rejection attached to a live TOTP field advances the
      // bounded authenticator sequence.
      let otpRejected = otpPath && !!otpInput && otpAutomaticAttempts >= 1 &&
        (invalidOtp || otpErrorElements.length > 0);
      if (otpAwaitingFreshRejection) {
        // The first rejection can remain in aria-invalid/alert nodes while
        // Google processes the second click. Do not count that unchanged
        // feedback as a second rejection or select backup prematurely.
        if (!otpInput || !otpRejected) {
          otpPendingErrorCleared = true;
          return;
        }
        const newErrorNode = otpErrorElements.some(element => !otpPendingErrorElements.has(element));
        const newInput = otpInput !== otpPendingInput;
        if (!otpPendingErrorCleared && !newErrorNode && !newInput) {
          if (Date.now() - otpPendingSince < 800) return;
          await needManual("invalid_code", epoch);
          if (!isCurrent(epoch)) return;
          return;
        }
        if (Date.now() - otpPendingSince < 800) return;
        otpAwaitingFreshRejection = false;
        otpRejected = true;
      }
      // A visible TOTP form is not evidence that Google's first submission
      // failed. Wait for explicit rejection feedback before fetching/reserving
      // another code; this also survives Resume and reinjection via CONTEXT.
      if (otpWaitingForFirstRejection && !otpRejected) return;
      if (otpRejected) {
        const currentWindow = context.otpLastExpiresAt || otpLastExpiresAt;
        if (otpAutomaticAttempts >= 2 && !otpAwaitingFreshRejection && !otpPendingInput &&
            (!currentWindow || !otpConfirmedRejections.includes(currentWindow))) {
          // A reinjected document cannot prove that the visible error belongs
          // to the second submitted window. Persisted submission count alone
          // is never permission to select backup.
          await needManual("invalid_code", epoch);
          if (!isCurrent(epoch)) return;
          return;
        }
        if (!await confirmOtpRejection(epoch, context)) {
          await needManual("invalid_code", epoch);
          if (!isCurrent(epoch)) return;
          return;
        }
        if (otpAutomaticAttempts === 1 && otpBudgetAvailable()) {
          const hasTiming = Number.isFinite(Date.parse(context.otpLastExpiresAt || otpLastExpiresAt || ""));
          if (!hasTiming) {
            await needManual("invalid_code", epoch);
            if (!isCurrent(epoch)) return;
            return;
          }
          try {
            const retried = await retryFreshAuthenticator(epoch, context);
            if (retried || !isCurrent(epoch)) return;
          } catch {
            // A second bounded OTP fetch failure is handled by the catch path
            // below, which pauses for manual completion.
            throw new Error("The fresh verification code could not be loaded.");
          }
          // The field may have disappeared during the SPA transition. Wait for
          // a settled chooser/form; disappearance itself is not rejection.
          if (!authenticatorField()) return;
        }
        if (otpAutomaticAttempts >= 2 && !backupCodeAttempted) {
          const currentWindow = context.otpLastExpiresAt || otpLastExpiresAt;
          if (!currentWindow || otpConfirmedRejections.length < 2 ||
              !otpConfirmedRejections.includes(currentWindow)) {
            await needManual("invalid_code", epoch);
            if (!isCurrent(epoch)) return;
            return;
          }
          if (startBackupFallback(true)) return;
          if (!backupChallengeControl()) {
            await needManual("invalid_code", epoch);
            if (!isCurrent(epoch)) return;
            return;
          }
        }
      }
      // Google may first show a non-Authenticator method (for example the
      // skotp/security-code screen). Route only that known challenge through
      // its explicit Try another way control. After this one bounded click,
      // the selection page below is responsible for choosing Authenticator.
      // Never fill the security-code, SMS, phone, or other generic field.
      const pendingEmailOrPassword = elements('input[type="email"], input[name="identifier"]')[0] ||
        (!canonicalTotpPath() ? elements('input[type="password"]')[0] : null);
      if (!pendingEmailOrPassword && alternateAuthenticatorChallengePath() &&
          !alternateAuthenticatorRouteStarted) {
        const tryAnotherWay = tryAnotherWayControl();
        if (!tryAnotherWay) {
          if (!authenticatorMethod()) {
            if (!settled("alternate-authenticator-navigation")) return;
            await needManual(null, epoch);
            if (!isCurrent(epoch)) return;
            return;
          }
        } else {
          const route = await send("ALTERNATE_AUTHENTICATOR_ROUTE", {
            attemptId: context?.attemptId
          });
          if (!isCurrent(epoch)) return;
          if (route?.reserved !== true) {
            if (!authenticatorMethod()) {
              if (!settled("alternate-authenticator-navigation")) return;
              await needManual(null, epoch);
              if (!isCurrent(epoch)) return;
              return;
            }
          } else {
            alternateAuthenticatorRouteStarted = true;
            if (clickOnce("alternate-authenticator-navigation", tryAnotherWay)) return;
          }
        }
      }
      // Keep authenticator controls ahead of every backup-code control. A
      // stale fallback flag or an unavailable backup pool must not discard a
      // usable authenticator route while its two-attempt budget remains.
      const authenticator = !authenticatorLockout && authenticatorMethod();
      if (authenticator && otpBudgetAvailable()) {
        if (clickOnce(`authenticator:${location.pathname}`, authenticator)) {
          // The previous backup navigation may have been a stale SPA render.
          // Clearing only this local selection state lets the authenticator
          // sequence continue; the durable backup-issued marker is untouched.
          if (!backupCodeAttempted) {
            backupFallbackStarted = false;
            backupChallengeSelected = false;
          }
          return;
        }
      }
      if (backupFallbackStarted && !backupChallengeSelected && backupChallengePage()) {
        backupChallengeSelected = true;
      }
      if (backupFallbackStarted && !backupCodeAttempted && !backupChallengeSelected) {
        const option = backupChallengeControl();
        if (option) {
          backupChallengeSelected = true;
          if (clickOnce("backup-challenge-option", option)) return;
        }
        // The chooser can render after navigation and after the first
        // inspection. Wait for it before exposing a manual challenge.
        if (!settled("backup-challenge-choice")) return;
        await needManual("backup_code", epoch);
        if (!isCurrent(epoch)) return;
        return;
      }
      const currentOtpWindow = context.otpLastExpiresAt || otpLastExpiresAt;
      const lockoutBackupAuthorised = authenticatorLockout &&
        (otpAutomaticAttempts === 0 ||
          (!!currentOtpWindow && otpConfirmedRejections.includes(currentOtpWindow)));
      const backupAuthorised = (otpAutomaticAttempts >= 2 && otpConfirmedRejections.length >= 2 ||
        lockoutBackupAuthorised) &&
        (backupFallbackStarted || backupChallengeSelected || backupChallengePage() || !!backupChallengeControl());
      const backupInput = backupCodeField();
      if (backupInput && !backupAuthorised) {
        // A backup-only URL can be the tail of a user-selected SPA transition.
        // Do not consume a code before both bounded authenticator attempts.
        if (!settled("backup-only-form")) return;
        await needManual("backup_code", epoch);
        if (!isCurrent(epoch)) return;
        return;
      }
      if (backupInput) {
        if (backupCodeRejected || invalidBackupCode()) {
          backupCodeRejected = true;
          await needManual("backup_code", epoch);
          if (!isCurrent(epoch)) return;
          return;
        }
        if (!backupCodeAttempted) {
          await submitField(
            "backup_code",
            backupInput,
            document.querySelector("#backupCodeNext, #challengeNext, #bcNext") ||
              button(/^(next|verify|submit)$/i),
            epoch
          );
          if (!isCurrent(epoch)) return;
          return;
        }
      }
      // Once the one automatic code has been submitted, leave the live Google
      // challenge alone while it navigates (and allow a customer who resumes
      // to finish a manually-entered code without overwriting it).
      if (backupCodeAttempted && backupInput) return;
      if (backupChallengeSelected && !backupInput && !backupCodeAttempted) {
        // Selecting a challenge may navigate before Google's form is painted.
        // Do not pause during that short transition, but fail closed if the
        // backup form never appears.
        if (!settled("backup-code-form")) return;
        await needManual("backup_code", epoch);
        if (!isCurrent(epoch)) return;
        return;
      }
      if (backupCodeAttempted && (backupChallengePage() || backupChallengeSelected) &&
          (error || !backupInput)) {
        // A failed request or a challenge that disappeared is actionable
        // manual state, not a reason to ask for another backup code.
        if (error || settled("backup-code-form")) {
          await needManual("backup_code", epoch);
          if (!isCurrent(epoch)) return;
          return;
        }
      }
      // A stale inline error often remains until the replacement field is
      // submitted. Allow exactly that explicit retry, not automatic retries.
      const retryingOtp = invalidOtp && retryInvalidOtp && !submitted.has(`otp:${location.pathname}`);
      if (error && !retryingOtp) {
        await needManual(invalidOtp ? "invalid_code" : null, epoch);
        if (!isCurrent(epoch)) return;
        return;
      }

      const emailInput = elements('input[type="email"], input[name="identifier"]')[0];
      if (emailInput) {
        await submitField("email", emailInput, document.querySelector("#identifierNext") || button(/^next$/i), epoch);
        if (!isCurrent(epoch)) return;
        return;
      }
      // A canonical TOTP route may contain a masked OTP or password-manager
      // artifact. Never send a password STEP from this challenge; only a
      // positively identified authenticator field can request an OTP.
      const passwordInput = canonicalTotpPath() ? null : elements('input[type="password"]')[0];
      if (passwordInput) {
        await submitField("password", passwordInput, document.querySelector("#passwordNext") || button(/^next$/i), epoch);
        if (!isCurrent(epoch)) return;
        return;
      }
      // Never put an authenticator OTP into SMS, recovery-code, or phone fields.
      if (otpInput && /\/challenge\/totp(?:\/|$)/.test(location.pathname)) {
        if (otpFetchFailures >= 2) {
          await needManual("invalid_code", epoch);
          if (!isCurrent(epoch)) return;
          return;
        }
        if (!otpBudgetAvailable()) {
          const currentWindow = context.otpLastExpiresAt || otpLastExpiresAt;
          const fallbackAuthorized = otpConfirmedRejections.length >= 2 &&
            otpConfirmedRejections.includes(currentWindow);
          if (fallbackAuthorized && startBackupFallback(true)) return;
          if (settled("otp-exhausted")) {
            await needManual("invalid_code", epoch);
            if (!isCurrent(epoch)) return;
          }
          return;
        }
        await submitField("otp", otpInput, otpSubmitTarget(otpInput), epoch, otpAutomaticAttempts + 1);
        if (!isCurrent(epoch)) return;
        return;
      }
      if (accountChooserVisible()) {
        const email = await getEmail(epoch);
        if (!isCurrent(epoch)) return;
        const choice = accountChooserRow(email);
        if (choice) { clickOnce("choose-account", choice); return; }
        const another = button(/^use another account$/i) || chooserText(/^use another account$/i);
        if (another) { clickOnce("another-account", another); return; }
        // Chooser is loading or has no clickable rows yet; wait instead of pausing.
        if (!settled("account-chooser")) return;
      }
      const otherWay = backupNavigationControl();
      if (otherWay && otpAutomaticAttempts >= 2 && otpConfirmedRejections.length >= 2 &&
          otpConfirmedRejections.includes(otpLastExpiresAt) &&
          backupFallbackEligible(false)) {
        if (startBackupFallback(false)) return;
      }
      // Google changes the URL before rendering the password/TOTP form.
      // Do not permanently pause while that supported screen is still loading.
      if (/\/challenge\/(?:pwd|totp)(?:\/|$)/.test(location.pathname) && !settled("challenge-form")) return;
      if (/\/challenge\//.test(location.pathname)) {
        await needManual(null, epoch);
        if (!isCurrent(epoch)) return;
      }
    } catch (caught) {
      // Deliberately never include DOM contents, passwords, OTPs, or provider
      // response bodies in diagnostic text.
      if (isCurrent(epoch) && !paused) {
        if (visibleCaptcha()) {
          await needManual("captcha", epoch);
          if (!isCurrent(epoch)) return;
          return;
        }
        const otpFailure = /\/challenge\/totp(?:\/|$)/.test(location.pathname) &&
          !/verification-code attempt is no longer available/i.test(caught?.message || "");
        if (otpFailure && !backupFallbackStarted && !backupCodeAttempted) {
          let failureContext;
          try {
            failureContext = await send("CONTEXT");
            if (Number.isInteger(failureContext?.otpSubmissionCount)) {
              otpAutomaticAttempts = failureContext.otpSubmissionCount;
            }
            if (Number.isInteger(failureContext?.otpFetchFailureCount)) {
              otpFetchFailures = failureContext.otpFetchFailureCount;
            }
            if (typeof failureContext?.otpLastExpiresAt === "string") {
              otpLastExpiresAt = failureContext.otpLastExpiresAt;
            }
          } catch {
            failureContext = null;
          }
          if (failureContext?.active && otpFetchFailures === 1 && otpAutomaticAttempts < 2 &&
              otpBudgetAvailable()) {
            const input = authenticatorField();
            const next = input && otpSubmitTarget(input);
            if (input && next) {
              try {
                await submitField("otp", input, next, epoch, 2);
                return;
              } catch (retryError) {
                // The second bounded fetch failure is handled below using the
                // persisted count; it must never start an open request loop.
                if (/verification-code attempt is no longer available/i.test(retryError?.message || "")) {
                  await needManual("invalid_code", epoch);
                  if (!isCurrent(epoch)) return;
                  return;
                }
                try {
                  const afterRetry = await send("CONTEXT");
                  if (Number.isInteger(afterRetry?.otpSubmissionCount)) {
                    otpAutomaticAttempts = afterRetry.otpSubmissionCount;
                  }
                  if (Number.isInteger(afterRetry?.otpFetchFailureCount)) {
                    otpFetchFailures = afterRetry.otpFetchFailureCount;
                  }
                } catch {
                  await needManual(null, epoch);
                  if (!isCurrent(epoch)) return;
                  return;
                }
              }
            } else {
              // The field is temporarily absent during Google's SPA render.
              // Leave the attempt active and let the settled inspection pick
              // up the same bounded retry once the field returns.
              if (!settled("otp-fetch-form")) return;
            }
          }
          if (otpAutomaticAttempts < 2 && !authenticatorField()) {
            if (!settled("otp-fetch-form")) return;
          }
        }
        const backupActive = backupFallbackStarted || backupChallengeSelected ||
          backupChallengePage() || !!backupCodeField();
        await needManual(visibleCaptcha() ? "captcha" :
          (backupActive ? "backup_code" : null), epoch);
        if (!isCurrent(epoch)) return;
      }
    } finally {
      if (isCurrent(epoch)) busy = false;
    }
    }
    function resumeAutomation() {
    if (disposed) return;
    invalidate();
    retryInvalidOtp = invalidAuthenticatorCode();
    removeCaptchaBanner();
    hideShield();
    paused = false;
    submitted.clear();
    waitingSince.clear();
    expectedEmail = null;
    lastActionAt = 0;
    void inspect(lifecycleEpoch);
    }
    const onResume = (message, sender) => {
    if (sender.id !== chrome.runtime.id || message?.type !== "RESUME") return;
    resumeAutomation();
    };
    chrome.runtime.onMessage.addListener(onResume);
    let interval = null;
    const startInterval = () => {
      if (interval === null) interval = setInterval(() => void inspect(), 1000);
    };
    const stopInterval = () => {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    };
    const onPageHide = () => { stopInterval(); hideShield(); };
    const onPageShow = event => {
      if (!event?.persisted) return;
      startInterval();
      // A BFCache restore must not turn a manually paused login back on.
      if (!paused) void inspect();
    };
    startInterval();
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    globalThis.flowAutoLoginAutomationCleanup = () => {
      if (disposed) return;
      invalidate();
      disposed = true;
      stopInterval();
      removeCaptchaBanner();
      hideShield();
      chrome.runtime.onMessage.removeListener(onResume);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
    void inspect();
  };
  void start().catch(() => {});
})();