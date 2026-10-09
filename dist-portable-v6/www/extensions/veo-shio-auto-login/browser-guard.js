// Shared by the service worker and isolated extension/content-script contexts.
// Patched for Electron compatibility: treat Electron as a supported browser.
(() => {
  const browser = globalThis.navigator;
  const ua = browser?.userAgent || "";
  const mobile = browser?.userAgentData?.mobile === true ||
    /Android|iPhone|iPad|iPod|Mobile|EdgA\/|EdgiOS\//i.test(ua) ||
    browser?.userAgentData?.platform === "Android" ||
    (browser?.platform === "MacIntel" && browser?.maxTouchPoints > 1);

  const runtimeAvailable = typeof globalThis.chrome?.runtime?.id === "string" ||
    typeof globalThis.chrome?.runtime?.sendMessage === "function";

  // Patched: Always treat as supported in Electron/Chromium builds
  globalThis.flowAutoLoginIsEdge = runtimeAvailable;
  globalThis.flowAutoLoginIsMobile = runtimeAvailable && mobile;

  const isContentContext = typeof globalThis.window !== "undefined" &&
    globalThis.window.top === globalThis.window &&
    /^https?:$/.test(globalThis.location?.protocol || "");
  if (isContentContext) {
    globalThis.flowAutoLoginBrowserReady = Promise.resolve(true);
  }
})();