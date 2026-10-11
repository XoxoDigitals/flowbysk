package com.flowbrowser.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.SystemClock
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.view.MotionEvent
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import android.Manifest
import android.content.pm.PackageManager
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import androidx.webkit.UserAgentMetadata
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.roundToInt

class MainActivity : AppCompatActivity() {
    companion object {
        private const val TAG = "FlowBrowser"
        private const val DEFAULT_CHROME_HEIGHT_DP = 72f
        private const val AUTH_UI_OFF = 0
        private const val AUTH_UI_COVER = 1
        private const val AUTH_UI_CAPTCHA = 2
        /** Auth cover ON — masks Google automation; lifts for real captcha. */
        private const val DISABLE_AUTH_COVER = false
        /** Autoclick Next / 2FA enabled (production). */
        private const val DISABLE_GOOGLE_AUTO_NEXT = false
        /** Force Flow workspace to lay out at this CSS width (then scale to fit). */
        private const val FLOW_LAYOUT_WIDTH_CSS = 538
        /** Pretend to be Chrome so Google does not see the embedding APK name. */
        private val FLOW_EXTRA_HEADERS: Map<String, String> = mapOf(
            "X-Requested-With" to "com.android.chrome"
        )

        /** Lock layout viewport to FLOW_LAYOUT_WIDTH_CSS on Flow/labs only (not Google login). */
        private val FLOW_VIEWPORT_JS = """
(function(){
  try {
    var w = $FLOW_LAYOUT_WIDTH_CSS;
    var content = 'width=' + w + ', initial-scale=1, maximum-scale=5, user-scalable=yes';
    var m = document.querySelector('meta[name="viewport"]');
    if (!m) {
      m = document.createElement('meta');
      m.setAttribute('name', 'viewport');
      (document.head || document.documentElement).appendChild(m);
    }
    if (m.getAttribute('content') !== content) m.setAttribute('content', content);
  } catch (e) {}
})();
""".trimIndent()

        /**
         * Dismiss Google recovery / home-address interstitials and the Flow app banner.
         * NEVER force-navigate away from accounts.google.com (especially TOTP) — that
         * aborted Google's session handoff and looked like an instant logout.
         */
        private val GOOGLE_DISMISS_NAGS_JS = """
(function(){
  function txt(el){
    return ((el && (el.innerText || el.textContent || el.getAttribute && el.getAttribute('aria-label'))) || '')
      .replace(/\s+/g,' ').trim();
  }
  function visible(el){
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    var s = window.getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) !== 0;
  }
  function click(el){
    try {
      el.focus && el.focus();
      el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,view:window}));
      el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true,view:window}));
      el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
      if (typeof el.click === 'function') el.click();
    } catch (e) {}
  }
  function hide(el){
    if (!el || el === document.body || el === document.documentElement) return;
    try {
      el.style.setProperty('display','none','important');
      el.style.setProperty('visibility','hidden','important');
      el.style.setProperty('pointer-events','none','important');
      el.style.setProperty('height','0','important');
      el.style.setProperty('max-height','0','important');
      el.style.setProperty('overflow','hidden','important');
      el.style.setProperty('opacity','0','important');
      el.setAttribute('data-flow-hidden','1');
    } catch (e) {}
  }
  function dismissOnce(){
    var host = (location.hostname || '').toLowerCase();
    var path = (location.pathname || '').toLowerCase();
    var body = ((document.body && document.body.innerText) || '').slice(0, 3200);
    var onAccounts = host.indexOf('accounts.google.com') >= 0 || host.indexOf('accounts.youtube.com') >= 0;
    var onGds = host.indexOf('gds.google.com') >= 0;
    // Real credential steps — do not skip / bounce these
    var onHardAuth = /\/identifier|\/challenge\/(totp|pwd|selection|sk|iap|dp|ootp)|CheckCookie|LoginDone/i.test(path) ||
      !!(document.querySelector('input[name="totpPin"], input#totpPin, input[name="Passwd"], input#identifierId'));
    // Optional nags during login — ALWAYS click Not now / Skip / Later
    var onSkipInterstitial =
      /verification\/selfie|\/selfie\/|precollection|speedbump|idvreenable|phoneverification|confirmidentifier|privacyreminder|accountrecovery|homeaddress|\/web\/homeaddress|passkeyenrollment|sk\/register|touchid|\/rejected/i.test(path) ||
      /take a selfie|confirm it.?s you|verify it.?s you|use your selfie|add a recovery phone|set a home address|home and work addresses|save a backup code|create a passkey|turn on .*passkey|skip for now/i.test(body);

    document.querySelectorAll('div, section, aside, [role="banner"]').forEach(function(el){
      var t = txt(el);
      if (!t || t.length > 140) return;
      if (!(/open in the google flow app/i.test(t) || (/google flow/i.test(t) && /open in/i.test(t)))) return;
      var closer = null;
      el.querySelectorAll('button, a, [role="button"], [aria-label]').forEach(function(b){
        var bt = txt(b), al = b.getAttribute('aria-label') || '';
        if (/^(×|✕|x|close|dismiss)$/i.test(bt) || /close|dismiss|cancel/i.test(al)) closer = closer || b;
      });
      if (closer && visible(closer)) click(closer);
      hide(el);
    });

    function clickNotNowOrSkip(){
      var skip = document.querySelector(
        '#recoverySkip, button[jsname="j6LnO"], [data-id="skip"], ' +
        '[aria-label*="Not now" i], [aria-label*="Skip" i], [aria-label*="Cancel" i], ' +
        '[aria-label*="Later" i], [aria-label*="No thanks" i], [aria-label*="Remind" i]'
      );
      if (skip && visible(skip)) { click(skip); return 'clicked'; }
      var re = /^(not now|skip|no thanks|cancel|remind me later|maybe later|later|close|dismiss|not interested|skip for now)$/i;
      var cands = [];
      document.querySelectorAll('button, a, [role="button"], div[role="link"], span[role="button"]').forEach(function(el){
        if (!visible(el)) return;
        var t = txt(el);
        if (!t || t.length > 48) return;
        if (!re.test(t)) return;
        if (/^(save|next|continue|done|submit|add|confirm|verify|start|take photo|allow)$/i.test(t)) return;
        cands.push(el);
      });
      if (!cands.length) return null;
      cands.sort(function(a,b){
        function score(el){
          var t = txt(el).toLowerCase();
          if (t === 'not now' || t === 'skip for now') return 0;
          if (t === 'skip' || t === 'no thanks' || t === 'not interested') return 1;
          if (t === 'later' || t === 'remind me later' || t === 'maybe later') return 2;
          if (t === 'cancel') return 3;
          return 4;
        }
        return score(a) - score(b);
      });
      click(cands[0]);
      return 'clicked';
    }

    // Selfie / precollection / passkey / recovery nags — click Not now even under /signin/
    if (onSkipInterstitial) {
      var r0 = clickNotNowOrSkip();
      if (r0) return r0;
      if (onGds && !onAccounts) return 'bounce';
      return 'ok';
    }

    if (onHardAuth) return 'ok';

    var pageRec = /make sure you can always sign in|add a recovery phone|your recovery email|set a home address|home and work addresses|recovery options|confirm it.?s you|take a selfie/i.test(body);
    var pathRec = /recoveryoptions|\/web\/recovery|\/web\/homeaddress|homeaddress|selfie|precollection|verification/i.test(path);
    var onHomeAddress = onGds && /homeaddress|home.?address|home and work/i.test(path + ' ' + body);

    if (!onGds && !pageRec && !pathRec && !onHomeAddress) {
      var skip0 = document.querySelector('#recoverySkip, button[jsname="j6LnO"]');
      if (skip0 && visible(skip0)) { click(skip0); return 'clicked'; }
      // Still auto-click a lone Not now on accounts interstitials
      if (onAccounts) {
        var r1 = clickNotNowOrSkip();
        if (r1) return r1;
      }
      return 'ok';
    }

    var r2 = clickNotNowOrSkip();
    if (r2) return r2;
    // Only gds recovery may request a soft bounce — NEVER accounts.google.com (kills OTP session)
    if (onGds && !onAccounts) return 'bounce';
    return 'ok';
  }
  if (!window.__flowDismissNagsIv) {
    var n = 0;
    window.__flowDismissNagsIv = setInterval(function(){
      n++;
      var r = dismissOnce();
      var host = (location.hostname || '').toLowerCase();
      // Hard rule: never location.replace away from Google accounts / youtube accounts
      if (r === 'bounce' && n >= 10 && host.indexOf('gds.google.com') >= 0 &&
          host.indexOf('accounts.') < 0) {
        clearInterval(window.__flowDismissNagsIv);
        window.__flowDismissNagsIv = null;
        try { location.replace('https://flow.google.com/'); } catch (e) { location.href = 'https://flow.google.com/'; }
        return;
      }
      if (n >= 30) {
        clearInterval(window.__flowDismissNagsIv);
        window.__flowDismissNagsIv = null;
      }
    }, 350);
  }
  return dismissOnce();
})();
""".trimIndent()
    }

    private lateinit var shellView: WebView
    private lateinit var flowView: WebView
    private lateinit var flowPane: FrameLayout
    private lateinit var authCover: View
    private lateinit var captchaBanner: View
    private lateinit var root: LinearLayout
    private var chromeHeightPx: Int = 0
    private var lastFlowScalePct: Int = -1
    private lateinit var config: AppConfig
    private lateinit var wwwServer: WwwServer

    private val scope = CoroutineScope(Dispatchers.Main + Job())
    private var shellMode = "full"
    private var lastLayoutChromePx = 0
    /** Only allow chrome (split) layout after Flow has been navigated at least once. */
    private var flowEverOpened = false
    private var flowCredEmail: String? = null
    private var flowCredPassword: String? = null
    private var flowCredTarget: String? = null
    private val autofillGeneration = AtomicInteger(0)
    private var lastAutofillKickMs = 0L
    private var lastTotpDetectMs = 0L
    private var totpAutoActive = false
    private var lastHistoryUrl = ""
    private var flowSettleClearJob: Job? = null
    private var flowInjectScript: String = ""
    private var shellReady = false
    private var flowReady = false
    /** Prevents shouldOverrideUrlLoading ↔ loadUrl recursion when injecting clean headers. */
    private var flowHeaderLoadActive = false
    private var authLoginActive = false
    private var onGoogleAuth = false
    private var captchaActive = false
    private var authUiMode = AUTH_UI_OFF
    /** Host DOM probe for identifier image/text captcha (mirrors Windows ProbeGoogleCaptchaAsync). */
    private var captchaProbeJob: Job? = null
    private var lastCaptchaProbeMs = 0L
    private var captchaProbeHits = 0
    private var captchaProbeMisses = 0
    private var flowChromeMajor = "131"
    private var flowChromeFull = "131.0.6778.135"
    private var flowUaDesktop = true
    private var googleSecureRecoveries = 0
    /** Google Flow "upload from device" — WebView file input callback. */
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var pendingGalleryMultiple = false
    private var pendingGalleryImage = true
    private var pendingGalleryVideo = true
    private val pendingBlobDownloads = ConcurrentHashMap<String, PendingBlobDownload>()

    private data class PendingBlobDownload(
        val filename: String,
        val mime: String,
        val temp: File,
        val out: BufferedOutputStream
    )

    private val fileChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            deliverFileChooserResult(result.resultCode, result.data)
        }

    private val mediaPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { _ ->
            // Photo Picker / gallery still opens even if user denies — limited access on API 34+
            openGalleryPickerNow()
        }

    private val pickMediaLauncher =
        registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            val cb = filePathCallback
            filePathCallback = null
            if (cb == null) return@registerForActivityResult
            if (uri != null) {
                cb.onReceiveValue(arrayOf(uriForWebViewUpload(uri)))
            } else {
                cb.onReceiveValue(null)
            }
        }

    private val pickMultipleMediaLauncher =
        registerForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(10)) { uris ->
            val cb = filePathCallback
            filePathCallback = null
            if (cb == null) return@registerForActivityResult
            if (uris.isNullOrEmpty()) {
                cb.onReceiveValue(null)
            } else {
                cb.onReceiveValue(uris.map { uriForWebViewUpload(it) }.toTypedArray())
            }
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.activity_main)

        root = findViewById(R.id.root)
        shellView = findViewById(R.id.shellView)
        flowView = findViewById(R.id.flowView)
        flowPane = findViewById(R.id.flowPane)
        authCover = findViewById(R.id.authCover)
        captchaBanner = findViewById(R.id.captchaBanner)
        chromeHeightPx = (DEFAULT_CHROME_HEIGHT_DP * resources.displayMetrics.density).roundToInt()

        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime()
            )
            v.updatePadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        // Ensure resize when keyboard opens (WebView + adjustResize)
        WindowCompat.getInsetsController(window, window.decorView)?.let { /* keep default */ }

        config = AppConfig(this).load()
        if (config.serverUrl.contains("localhost") || config.serverUrl.contains("10.0.2.2")) {
            config.serverUrl = BuildConfig.DEFAULT_SERVER_URL
            config.save()
        }

        wwwServer = WwwServer(assets)
        wwwServer.start()

        flowInjectScript = try {
            assets.open("www/scripts/flow-inject.js").bufferedReader().use { it.readText() }
                .trimStart('\uFEFF')
        } catch (e: Exception) {
            Log.e(TAG, "Missing flow-inject.js", e)
            ""
        }

        configureShellWebView()
        configureFlowWebView()
        flowView.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
            applyFlowLayoutScale()
        }
        setShellMode("full")

        shellReady = true
        flowReady = true

        val shellUrl = "${wwwServer.baseUrl}/ui/app-shell.html"
        shellView.loadUrl(shellUrl)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    flowPane.visibility == View.VISIBLE && flowView.canGoBack() -> flowView.goBack()
                    shellView.canGoBack() -> shellView.goBack()
                    else -> moveTaskToBack(true)
                }
            }
        })
    }

    override fun onDestroy() {
        try {
            wwwServer.stop()
        } catch (_: Exception) {
        }
        shellView.destroy()
        flowView.destroy()
        super.onDestroy()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureShellWebView() {
        val s = shellView.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.allowFileAccess = false
        s.mediaPlaybackRequiresUserGesture = false
        s.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        s.cacheMode = WebSettings.LOAD_DEFAULT
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(shellView, true)

        shellView.setBackgroundColor(Color.TRANSPARENT)
        shellView.addJavascriptInterface(ShellBridge(this), "ShellHost")
        shellView.webChromeClient = WebChromeClient()
        shellView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                injectPolyfill(shellView, "ShellHost")
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                injectPolyfill(shellView, "ShellHost")
            }
        }

        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(
                shellView,
                BridgePolyfill.script("ShellHost"),
                setOf("*")
            )
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureFlowWebView() {
        flowView.setBackgroundColor(Color.WHITE)
        val s = flowView.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.allowFileAccess = false
        s.mediaPlaybackRequiresUserGesture = false
        s.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        s.cacheMode = WebSettings.LOAD_DEFAULT
        s.setSupportMultipleWindows(false)
        s.loadWithOverviewMode = true
        s.useWideViewPort = true
        s.builtInZoomControls = true
        s.displayZoomControls = false
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(flowView, true)

        applyFlowBrowserIdentity(s, preferDesktop = false)

        try {
            val pkg = WebViewCompat.getCurrentWebViewPackage(this)
            Log.i(TAG, "System WebView: ${pkg?.packageName} ${pkg?.versionName}")
        } catch (e: Exception) {
            Log.w(TAG, "WebView package probe failed", e)
        }

        if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
            @Suppress("DEPRECATION")
            WebSettingsCompat.setForceDark(s, WebSettingsCompat.FORCE_DARK_OFF)
        }

        flowView.addJavascriptInterface(FlowBridge(this), "FlowHost")
        flowView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback
                return try {
                    val accept = fileChooserParams?.acceptTypes
                        ?.flatMap { it.split(',', ' ').map { t -> t.trim() } }
                        ?.filter { it.isNotBlank() }
                        ?: emptyList()
                    // Flow often sends ".png,.jpg,.mp4" — treat extensions as media too
                    pendingGalleryImage = accept.isEmpty() || accept.any { isImageAccept(it) }
                    pendingGalleryVideo = accept.isEmpty() || accept.any { isVideoAccept(it) }
                    if (!pendingGalleryImage && !pendingGalleryVideo) {
                        // Unknown accept — still open gallery (Flow upload is always media)
                        pendingGalleryImage = true
                        pendingGalleryVideo = true
                    }
                    pendingGalleryMultiple =
                        fileChooserParams?.mode == FileChooserParams.MODE_OPEN_MULTIPLE

                    ensureMediaAccessThenOpenGallery()
                    true
                } catch (e: Exception) {
                    Log.e(TAG, "File chooser failed", e)
                    this@MainActivity.filePathCallback = null
                    filePathCallback?.onReceiveValue(null)
                    Toast.makeText(this@MainActivity, "Could not open gallery", Toast.LENGTH_SHORT).show()
                    false
                }
            }
        }
        flowView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                // Do NOT cancel+reload every navigation — that breaks Google sign-in SPA and
                // looks like an embedded WebView. UA is already set on WebSettings.
                return false
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                val u = url ?: ""
                // Never inject bridge/automation into Google auth — triggers secure-browser blocks
                if (!isGoogleAuthRelatedUrl(u) && !isGoogleRecaptchaChallengeUrl(u)) {
                    injectPolyfill(flowView, "FlowHost")
                }
                postFlowUrl(u, "did-start-loading")
                updateAuthOverlayFromUrl(u)
                ensureCaptchaProbeTimer()
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                val u = flowView.url ?: url ?: view?.url ?: ""
                if (!isGoogleAuthRelatedUrl(u) && !isGoogleRecaptchaChallengeUrl(u)) {
                    injectPolyfill(flowView, "FlowHost")
                }
                applyFlowViewport(u)
                postFlowUrl(u, "did-navigate")
                postFlowUrl(u, "did-finish-load")
                postFlowUrl(u, "dom-ready")
                updateAuthOverlayFromUrl(u)
                ensureCaptchaProbeTimer()
                probeGoogleCaptcha()
                tryHostGoogleAutofill(u)
                detectTotpAndFill()
                dismissGoogleNags(u)
                verifyFlowPagePainted(u)
                maybeRecoverGoogleSecureBrowserBlock(u)
            }

            /**
             * Google sign-in is a SPA — URL often changes via history without a full reload.
             * Without this, the shell URL bar stays stuck on /identifier and overlay logic lags.
             */
            override fun doUpdateVisitedHistory(view: WebView?, url: String?, isReload: Boolean) {
                val u = (url ?: flowView.url ?: "").trim()
                if (u.isEmpty()) return
                // Always push live URL to shell; throttle heavy autofill so SPA ticks
                // cannot re-submit password while OTP is mounting.
                postFlowUrl(u, "did-navigate-in-page")
                updateAuthOverlayFromUrl(u)
                ensureCaptchaProbeTimer()
                probeGoogleCaptcha()
                if (u != lastHistoryUrl) {
                    lastHistoryUrl = u
                    // URL step changed — allow a fresh autofill kick for the new step
                    lastAutofillKickMs = 0L
                }
                tryHostGoogleAutofill(u)
                detectTotpAndFill()
                dismissGoogleNags(u)
            }

            override fun onPageCommitVisible(view: WebView?, url: String?) {
                flowView.post { flowView.invalidate() }
            }

            override fun onRenderProcessGone(
                view: WebView?,
                detail: android.webkit.RenderProcessGoneDetail?
            ): Boolean {
                Log.e(TAG, "Flow renderer gone — reloading")
                flowView.post {
                    try {
                        loadFlowUrl(flowView.url ?: "https://flow.google.com/")
                    } catch (_: Exception) {
                    }
                }
                return true
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: android.webkit.WebResourceError?
            ) {
                if (request?.isForMainFrame != true) return
                postToShell(
                    JSONObject()
                        .put("type", "flow-event")
                        .put("event", "did-fail-load")
                        .put("url", request.url?.toString() ?: "")
                        .put("errorCode", error?.errorCode ?: -1)
                        .put("errorDescription", error?.description?.toString() ?: "error")
                )
            }

            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): android.webkit.WebResourceResponse? {
                val uri = request?.url?.toString() ?: return null
                val u = uri.lowercase()
                val looksGen =
                    u.contains("batchgenerate") ||
                        u.contains("batch_generate") ||
                        u.contains("generatevideo") ||
                        u.contains("generateimage") ||
                        u.contains("aisandbox") ||
                        (u.contains("/operations/") && request.method.equals("GET", true))
                if (looksGen) {
                    postToFlow(
                        JSONObject()
                            .put("type", "toGuest")
                            .put("channel", "flow:generation-network-completed")
                            .put(
                                "data",
                                JSONObject().put("url", uri).put("method", request.method ?: "GET")
                            )
                    )
                }
                return null
            }
        }

        flowView.setDownloadListener(DownloadListener { url, userAgent, contentDisposition, mimeType, contentLength ->
            handleDownload(url, userAgent, contentDisposition, mimeType, contentLength)
        })

        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            // Only Flow workspace — never run inject/polyfill on accounts.google.com
            val flowOrigins = setOf(
                "https://flow.google.com",
                "https://*.flow.google.com",
                "https://labs.google",
                "https://*.labs.google"
            )
            WebViewCompat.addDocumentStartJavaScript(
                flowView,
                BridgePolyfill.script("FlowHost"),
                flowOrigins
            )
            WebViewCompat.addDocumentStartJavaScript(flowView, FLOW_VIEWPORT_JS, flowOrigins)
            if (flowInjectScript.isNotBlank()) {
                WebViewCompat.addDocumentStartJavaScript(flowView, flowInjectScript, flowOrigins)
            }
            // Recovery / home-address / selfie interstitial — dismiss-only (accounts + gds)
            val nagOrigins = setOf(
                "https://gds.google.com",
                "https://*.gds.google.com",
                "https://accounts.google.com",
                "https://*.accounts.google.com",
                "https://accounts.youtube.com"
            )
            WebViewCompat.addDocumentStartJavaScript(flowView, GOOGLE_DISMISS_NAGS_JS, nagOrigins)
        }
    }

    /** Flow workspace only — lock CSS layout width to 538px and scale to fill the WebView. */
    private fun applyFlowViewport(url: String) {
        val u = url.lowercase()
        if (!u.contains("flow.google.com") && !u.contains("labs.google")) return
        flowView.evaluateJavascript(FLOW_VIEWPORT_JS, null)
        applyFlowLayoutScale()
    }

    private fun applyFlowLayoutScale() {
        val physical = flowView.width
        if (physical <= 0) return
        val pct = ((physical.toDouble() / FLOW_LAYOUT_WIDTH_CSS) * 100.0)
            .roundToInt()
            .coerceIn(25, 400)
        if (pct == lastFlowScalePct) return
        lastFlowScalePct = pct
        flowView.setInitialScale(pct)
        Log.i(TAG, "Flow layout ${FLOW_LAYOUT_WIDTH_CSS}css → scale ${pct}% (view=${physical}px)")
    }

    /** Auto-cancel Google recovery phone/email + home address; hide Flow app banner. */
    private fun dismissGoogleNags(url: String) {
        val u = url.lowercase()
        val worth =
            u.contains("gds.google.com") ||
                u.contains("recoveryoptions") ||
                u.contains("accounts.google.com") ||
                u.contains("accounts.youtube.com") ||
                u.contains("selfie") ||
                u.contains("precollection") ||
                u.contains("verification") ||
                u.contains("homeaddress") ||
                u.contains("flow.google.com") ||
                u.contains("labs.google")
        if (!worth) return
        flowView.evaluateJavascript(GOOGLE_DISMISS_NAGS_JS, null)
        // Retry — Not now / Skip often mount after first paint
        flowView.postDelayed({ flowView.evaluateJavascript(GOOGLE_DISMISS_NAGS_JS, null) }, 500)
        flowView.postDelayed({ flowView.evaluateJavascript(GOOGLE_DISMISS_NAGS_JS, null) }, 1200)
        flowView.postDelayed({ flowView.evaluateJavascript(GOOGLE_DISMISS_NAGS_JS, null) }, 2400)
        flowView.postDelayed({ flowView.evaluateJavascript(GOOGLE_DISMISS_NAGS_JS, null) }, 4000)
    }

    private fun postFlowUrl(url: String, event: String) {
        postToShell(
            JSONObject()
                .put("type", "flow-event")
                .put("event", event)
                .put("url", url)
        )
    }

    private var blankRecoveries = 0

    private fun verifyFlowPagePainted(url: String) {
        if (url.isBlank() || url.equals("about:blank", true)) return
        if (!url.contains("flow.google") && !url.contains("labs.google") && !url.contains("google.com")) return
        flowView.postDelayed({
            flowView.evaluateJavascript(
                """
                (function(){
                  var b = document.body;
                  if (!b) return 'empty';
                  var h = b.innerHTML || '';
                  if (h.length < 80) return 'empty';
                  var r = b.getBoundingClientRect();
                  if (r.height < 8) return 'empty';
                  return 'ok';
                })()
                """.trimIndent()
            ) { result ->
                val ok = result?.contains("ok") == true
                if (!ok && blankRecoveries < 2) {
                    blankRecoveries++
                    Log.w(TAG, "Blank Flow page ($url) — soft reload #$blankRecoveries")
                    flowView.reload()
                } else if (ok) {
                    blankRecoveries = 0
                }
            }
        }, 1200)
    }

    private fun loadFlowUrl(url: String) {
        flowHeaderLoadActive = true
        try {
            // Strip WebView APK id on the initial navigation into Google / Flow
            flowView.loadUrl(url, FLOW_EXTRA_HEADERS)
        } finally {
            flowView.postDelayed({ flowHeaderLoadActive = false }, 400)
        }
    }

    private fun applyFlowBrowserIdentity(settings: WebSettings, preferDesktop: Boolean) {
        flowUaDesktop = preferDesktop
        val systemUa = try {
            WebSettings.getDefaultUserAgent(this)
        } catch (_: Exception) {
            settings.userAgentString ?: ""
        }
        val chromeMatch = Regex("""Chrome/([\d.]+)""").find(systemUa)
        flowChromeFull = chromeMatch?.groupValues?.getOrNull(1) ?: "131.0.0.0"
        flowChromeMajor = flowChromeFull.substringBefore('.')

        // Mobile Chrome without "; wv" is the usual fix for Google's WebView block on Android.
        // Desktop UA is the fallback when that still fails.
        val ua = if (preferDesktop) {
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$flowChromeFull Safari/537.36"
        } else {
            systemUa
                .replace("; wv", "")
                .replace(";wv", "")
                .replace(Regex("""Version/[\d.]+ """), "")
        }
        settings.userAgentString = ua
        applyChromeUserAgentMetadata(settings, preferDesktop)
        Log.i(TAG, "Flow UA (${if (preferDesktop) "desktop" else "mobile-no-wv"}): $ua")
    }

    private fun applyChromeUserAgentMetadata(settings: WebSettings, desktop: Boolean) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.USER_AGENT_METADATA)) return
        try {
            val brands = listOf(
                UserAgentMetadata.BrandVersion.Builder()
                    .setBrand("Not_A Brand")
                    .setMajorVersion("8")
                    .setFullVersion("8.0.0.0")
                    .build(),
                UserAgentMetadata.BrandVersion.Builder()
                    .setBrand("Chromium")
                    .setMajorVersion(flowChromeMajor)
                    .setFullVersion(flowChromeFull)
                    .build(),
                UserAgentMetadata.BrandVersion.Builder()
                    .setBrand("Google Chrome")
                    .setMajorVersion(flowChromeMajor)
                    .setFullVersion(flowChromeFull)
                    .build()
            )
            val metaBuilder = UserAgentMetadata.Builder()
                .setBrandVersionList(brands)
                .setFullVersion(flowChromeFull)
                .setMobile(!desktop)
                .setBitness(if (desktop) 64 else UserAgentMetadata.BITNESS_DEFAULT)
                .setWow64(false)
            if (desktop) {
                metaBuilder
                    .setPlatform("Windows")
                    .setPlatformVersion("15.0.0")
                    .setArchitecture("x86")
                    .setModel("")
            } else {
                metaBuilder
                    .setPlatform("Android")
                    .setPlatformVersion("14.0.0")
                    .setArchitecture("arm")
                    .setModel("")
            }
            WebSettingsCompat.setUserAgentMetadata(settings, metaBuilder.build())
        } catch (e: Exception) {
            Log.w(TAG, "UA metadata override skipped", e)
        }
    }

    private fun maybeRecoverGoogleSecureBrowserBlock(url: String) {
        val u = url.lowercase()
        if (!u.contains("accounts.google.com")) return
        val urlLooksBlocked = u.contains("signin/rejected") || u.contains("disallowed_useragent") ||
            u.contains("autherror") || u.contains("browser-not-secure")

        fun retryWithAltUa() {
            if (googleSecureRecoveries >= 2) return
            googleSecureRecoveries++
            val nextDesktop = !flowUaDesktop
            Log.w(TAG, "Google secure-browser block — switching UA desktop=$nextDesktop (try #$googleSecureRecoveries)")
            applyFlowBrowserIdentity(flowView.settings, preferDesktop = nextDesktop)
            CookieManager.getInstance().flush()
            val continueUrl = Uri.encode("https://flow.google.com/")
            // Fresh sign-in entry that often works after UA change
            loadFlowUrl(
                "https://accounts.google.com/v3/signin/identifier?hl=en&continue=$continueUrl&flowName=GlifWebSignIn&flowEntry=ServiceLogin"
            )
        }

        if (urlLooksBlocked) {
            retryWithAltUa()
            return
        }

        flowView.evaluateJavascript(
            """
            (function(){
              var t = (document.body && document.body.innerText) || '';
              return /may not be secure|Couldn't sign you in|disallowed_useragent/i.test(t) ? 'blocked' : 'ok';
            })()
            """.trimIndent()
        ) { result ->
            if (result?.contains("blocked") == true) retryWithAltUa()
        }
    }

    private fun injectPolyfill(webView: WebView, hostName: String) {
        webView.evaluateJavascript(BridgePolyfill.script(hostName), null)
    }

    private fun setShellMode(mode: String) {
        var m = mode
        if (m == "veo") m = "chrome"
        // Never clip the login UI — keep shell full-screen until Flow opens
        if (m == "chrome" && !flowEverOpened) {
            m = "full"
        }
        val height = chromeHeightPx.coerceAtLeast(
            (56 * resources.displayMetrics.density).roundToInt()
        )
        if (m == shellMode && (m != "chrome" || height == lastLayoutChromePx)) {
            return
        }
        shellMode = m
        lastLayoutChromePx = if (m == "chrome") height else 0
        runOnUiThread {
            val shellLp = shellView.layoutParams as LinearLayout.LayoutParams
            val flowLp = flowPane.layoutParams as LinearLayout.LayoutParams
            if (m == "full") {
                flowPane.visibility = View.GONE
                shellLp.height = 0
                shellLp.weight = 1f
                flowLp.height = 0
                flowLp.weight = 0f
                applyAuthOverlayState()
            } else {
                flowPane.visibility = View.VISIBLE
                shellLp.height = height
                shellLp.weight = 0f
                flowLp.height = 0
                flowLp.weight = 1f
                applyAuthOverlayState()
            }
            shellView.layoutParams = shellLp
            flowPane.layoutParams = flowLp
        }
    }

    private fun applyChromeHeight(cssPx: Int) {
        if (cssPx <= 0) return
        val physical = (cssPx * resources.displayMetrics.density).roundToInt()
        val next = physical.coerceIn(
            (56 * resources.displayMetrics.density).roundToInt(),
            (resources.displayMetrics.heightPixels * 0.5f).roundToInt()
        )
        if (kotlin.math.abs(next - chromeHeightPx) < 2) return
        chromeHeightPx = next
        if (shellMode == "chrome") setShellMode("chrome")
    }

    fun onShellMessage(json: String) {
        runOnUiThread {
            try {
                val root = JSONObject(json)
                when (root.optString("type")) {
                    "cmd" -> handleShellCmd(root)
                    "invoke" -> {
                        val id = root.getInt("id")
                        val cmd = root.optString("cmd")
                        val payload = root.optJSONObject("payload") ?: JSONObject()
                        scope.launch {
                            try {
                                val result = handleInvoke(cmd, payload)
                                postToShell(
                                    JSONObject()
                                        .put("type", "invoke-result")
                                        .put("id", id)
                                        .put("result", result ?: JSONObject.NULL)
                                )
                            } catch (e: Exception) {
                                postToShell(
                                    JSONObject()
                                        .put("type", "invoke-result")
                                        .put("id", id)
                                        .put("error", e.message ?: "error")
                                )
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Shell message parse failed", e)
            }
        }
    }

    fun onFlowMessage(json: String) {
        runOnUiThread {
            try {
                val root = JSONObject(json)
                if (root.optString("type") != "toHost") return@runOnUiThread
                val channel = root.optString("channel")
                val data = root.opt("data")

                if (channel.equals("cdp-click", true) && data is JSONObject) {
                    val x = data.optDouble("x", 0.0)
                    val y = data.optDouble("y", 0.0)
                    dispatchFlowClick(x, y)
                }

                val args = JSONArray()
                if (data != null && data != JSONObject.NULL) args.put(data)
                postToShell(
                    JSONObject()
                        .put("type", "flow-event")
                        .put("event", "ipc-message")
                        .put("channel", channel)
                        .put("args", args)
                )
            } catch (e: Exception) {
                Log.e(TAG, "Flow message parse failed", e)
            }
        }
    }

    private fun handleShellCmd(root: JSONObject) {
        when (root.optString("cmd")) {
            "navigate" -> {
                var url = root.optString("url", "about:blank")
                if (url.isBlank() || url.contains("demo-flow") || url.startsWith("file:", true)) {
                    url = "https://flow.google.com/"
                }
                if (url.equals("about:blank", ignoreCase = true)) {
                    Log.d(TAG, "Skip about:blank navigate")
                    return
                }
                flowEverOpened = true
                setShellMode("chrome")
                flowPane.visibility = View.VISIBLE
                Log.i(TAG, "Flow navigate: $url")
                loadFlowUrl(url)
                updateAuthOverlayFromUrl(url)
            }
            "flowBack" -> {
                if (flowView.canGoBack()) flowView.goBack()
            }
            "reload" -> {
                val ignore = root.optBoolean("ignoreCache", false)
                if (ignore) flowView.clearCache(true)
                flowView.reload()
            }
            "stop" -> flowView.stopLoading()
            "zoom" -> {
                val factor = root.optDouble("factor", 1.0)
                flowView.setInitialScale((factor * 100).roundToInt())
                config.zoomLevel = factor
                config.save()
            }
            "sendToFlow" -> {
                val channel = root.optString("channel")
                val data = root.opt("data")
                postToFlow(
                    JSONObject()
                        .put("type", "toGuest")
                        .put("channel", channel)
                        .put("data", data ?: JSONObject.NULL)
                )
                if (channel.equals("apply-credentials", true) && data is JSONObject) {
                    flowCredEmail = data.optString("email").ifBlank { null }
                    flowCredPassword = data.optString("password").ifBlank { null }
                    flowCredTarget = data.optString("targetUrl").ifBlank { null }
                    tryHostGoogleAutofill(flowView.url)
                }
            }
            "setFlowCreds" -> {
                flowCredEmail = root.optString("email").ifBlank { null }
                flowCredPassword = root.optString("password").ifBlank { null }
                flowCredTarget = root.optString("targetUrl").ifBlank { null }
                tryHostGoogleAutofill(flowView.url)
            }
            "cdpClick" -> {
                // DEBUG: skip auto 2FA / Next clicks — user taps manually
                if (DISABLE_GOOGLE_AUTO_NEXT) return
                dispatchFlowClick(root.optDouble("x", 0.0), root.optDouble("y", 0.0))
            }
            "fillOtp" -> {
                fillTotp(root.optString("otp"))
            }
            "shellMode" -> {
                val mode = root.optString("mode", "chrome")
                setShellMode(if (mode == "full") "full" else "chrome")
            }
            "chromeHeight" -> {
                applyChromeHeight(root.optInt("height", 0))
            }
            "authOverlay" -> {
                handleAuthOverlayCommand(
                    show = root.optBoolean("show", false),
                    captcha = root.optBoolean("captcha", false),
                    done = root.optBoolean("done", false)
                )
            }
            "flushCookies" -> {
                flushWebViewCookies("shell-cmd")
            }
        }
    }

    /** Persist WebView cookies to disk — required so phones don't drop Google session on process kill. */
    private fun flushWebViewCookies(reason: String) {
        try {
            CookieManager.getInstance().flush()
            Log.d(TAG, "CookieManager.flush ($reason)")
        } catch (e: Exception) {
            Log.w(TAG, "CookieManager.flush failed ($reason)", e)
        }
    }

    override fun onPause() {
        flushWebViewCookies("onPause")
        super.onPause()
    }

    override fun onStop() {
        flushWebViewCookies("onStop")
        super.onStop()
    }

    private suspend fun handleInvoke(cmd: String, payload: JSONObject): Any? {
        return when (cmd) {
            "getConfig" -> config.toJsonObject()
            "saveServerUrl" -> {
                val url = payload.optString("url")
                if (url.isNotBlank()) {
                    config.serverUrl = url
                    config.save()
                }
                JSONObject().put("success", true)
            }
            "saveSession" -> {
                if (payload.has("token")) {
                    config.authToken = payload.optString("token").ifBlank { null }
                }
                if (payload.has("user")) {
                    val u = payload.opt("user")
                    config.userJson = if (u is JSONObject) {
                        AppConfig.sanitizeUserJson(u.toString())
                    } else null
                }
                if (payload.has("activeServer")) {
                    val s = payload.opt("activeServer")
                    config.activeServerJson = if (s is JSONObject) {
                        AppConfig.sanitizeActiveServerJson(s.toString())
                    } else null
                }
                config.sanitizeSecrets()
                config.save()
                JSONObject().put("success", true)
            }
            "clearSession" -> {
                clearGoogleCredsInMemory()
                config.authToken = null
                config.userJson = null
                config.activeServerJson = null
                config.save()
                JSONObject().put("success", true)
            }
            "clearPartitionSession" -> {
                clearFlowSession()
                JSONObject().put("success", true)
            }
            "minimize" -> {
                moveTaskToBack(true)
                JSONObject().put("success", true)
            }
            "maximize" -> {
                // No window chrome on Android — no-op success
                JSONObject().put("success", true)
            }
            "close" -> {
                finish()
                JSONObject().put("success", true)
            }
            "showInFolder" -> {
                val path = payload.optString("filePath")
                if (path.isNotBlank()) {
                    openInFolder(path)
                } else {
                    try {
                        startActivity(Intent(android.app.DownloadManager.ACTION_VIEW_DOWNLOADS))
                    } catch (_: Exception) {
                        val downloads =
                            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                        openInFolder(downloads.absolutePath)
                    }
                }
                JSONObject().put("success", true)
            }
            "executeFlow" -> {
                val code = payload.optString("code", "null")
                evaluateFlowAsync(code)
            }
            else -> throw IllegalArgumentException("Unknown command: $cmd")
        }
    }

    /** Drop Google password from RAM + injected page state (never persist). */
    private fun clearGoogleCredsInMemory(clearEmail: Boolean = true) {
        flowCredPassword = null
        if (clearEmail) {
            flowCredEmail = null
            flowCredTarget = null
        }
        val wipeAll = if (clearEmail) "true" else "false"
        try {
            flowView.evaluateJavascript(
                """
                (function(){
                  try {
                    var wipeAll = $wipeAll;
                    if (window.__flowHostCreds) {
                      window.__flowHostCreds.password = '';
                      delete window.__flowHostCreds.password;
                      if (wipeAll) {
                        delete window.__flowHostCreds;
                        delete window.__flowHostAuto;
                      }
                    }
                  } catch (e) {}
                })();
                """.trimIndent(),
                null
            )
        } catch (_: Exception) {
        }
    }

    private fun clearFlowSession() {
        flowSettleClearJob?.cancel()
        flowSettleClearJob = null
        captchaProbeJob?.cancel()
        captchaProbeJob = null
        captchaProbeHits = 0
        captchaProbeMisses = 0
        clearGoogleCredsInMemory()
        authLoginActive = false
        onGoogleAuth = false
        captchaActive = false
        totpAutoActive = false
        lastHistoryUrl = ""
        applyAuthOverlayState()
        flowView.stopLoading()
        flowView.loadUrl("about:blank")
        flowView.clearHistory()
        flowView.clearCache(true)
        flowView.clearFormData()
        CookieManager.getInstance().apply {
            // Remove Google-related cookies best-effort
            for (host in listOf(
                "https://accounts.google.com",
                "https://flow.google.com",
                "https://www.google.com",
                "https://labs.google"
            )) {
                val cookies = getCookie(host) ?: continue
                cookies.split(";").forEach { part ->
                    val name = part.substringBefore("=").trim()
                    if (name.isNotEmpty()) {
                        setCookie(host, "$name=; Max-Age=0; Path=/")
                    }
                }
            }
            flush()
        }
        WebStorageClearHelper.clear(flowView)
    }

    private fun handleAuthOverlayCommand(show: Boolean, captcha: Boolean, done: Boolean) {
        if (done) {
            val cur = flowView.url ?: ""
            // Login finished on Flow workspace — always clear, even if TOTP flag still set
            if (isFlowWorkspaceUrl(cur)) {
                Log.i(TAG, "AuthOverlay done on Flow — clearing cover")
                clearAuthCoverSession()
                return
            }
            // Ignore premature done while still on Google auth pages
            if (isGoogleAuthRelatedUrl(cur)) {
                Log.d(TAG, "AuthOverlay ignore done — still on Google auth")
                authLoginActive = true
                onGoogleAuth = true
                if (isGoogleRecaptchaChallengeUrl(cur)) captchaActive = true
                applyAuthOverlayState()
                return
            }
            clearAuthCoverSession()
            return
        }
        if (captcha) {
            // Real captcha needs lift. Auto-TOTP must keep the opaque cover.
            if (totpAutoActive && !isGoogleRecaptchaChallengeUrl(flowView.url)) {
                captchaActive = false
                authLoginActive = true
                onGoogleAuth = true
                applyAuthOverlayState()
                return
            }
            captchaActive = true
            onGoogleAuth = true
            authLoginActive = true
            applyAuthOverlayState()
            ensureCaptchaProbeTimer()
            return
        }
        val live = flowView.url ?: ""
        if (isGoogleRecaptchaChallengeUrl(live)) {
            captchaActive = true
            onGoogleAuth = true
            authLoginActive = true
            applyAuthOverlayState()
            ensureCaptchaProbeTimer()
            return
        }
        // Sticky captcha: shell overlay:true must not re-cover while challenge DOM still present
        if (captchaActive) {
            onGoogleAuth = true
            authLoginActive = true
            applyAuthOverlayState()
            ensureCaptchaProbeTimer()
            probeGoogleCaptcha()
            return
        }
        if (show) {
            captchaActive = false
            onGoogleAuth = true
            authLoginActive = true
            applyAuthOverlayState()
            ensureCaptchaProbeTimer()
        }
    }

    private fun clearAuthCoverSession() {
        flowSettleClearJob?.cancel()
        flowSettleClearJob = null
        captchaProbeJob?.cancel()
        captchaProbeJob = null
        captchaProbeHits = 0
        captchaProbeMisses = 0
        captchaActive = false
        onGoogleAuth = false
        authLoginActive = false
        totpAutoActive = false
        // Login finished — drop Google email/password from RAM (never persisted)
        clearGoogleCredsInMemory(clearEmail = true)
        applyAuthOverlayState()
        // Google sign-in just finished — write cookies before phone may kill the process
        flushWebViewCookies("auth-cover-cleared")
    }

    /** After login lands on Flow, drop the sticky cover once the page has settled. */
    private fun scheduleAuthCoverClearOnFlow() {
        flowSettleClearJob?.cancel()
        flowSettleClearJob = scope.launch {
            delay(1600)
            val cur = flowView.url ?: return@launch
            if (!isFlowWorkspaceUrl(cur)) return@launch
            if (isGoogleAuthRelatedUrl(cur)) return@launch
            Log.i(TAG, "Flow settled after login — clearing sticky auth cover")
            clearAuthCoverSession()
        }
    }

    private fun updateAuthOverlayFromUrl(url: String?) {
        if (isGoogleLogoutUrl(url) || isAboutBlank(url)) {
            if (!authLoginActive) {
                onGoogleAuth = false
                captchaActive = false
                applyAuthOverlayState()
                return
            }
        }

        if (isGoogleRecaptchaChallengeUrl(url)) {
            flowSettleClearJob?.cancel()
            authLoginActive = true
            onGoogleAuth = true
            captchaActive = true
            totpAutoActive = false
            applyAuthOverlayState()
            return
        }

        // Stay covered through password ↔ OTP SPA transitions (do not lift)
        if (isGoogleAuthRelatedUrl(url) && !isGoogleLogoutUrl(url)) {
            flowSettleClearJob?.cancel()
            authLoginActive = true
            onGoogleAuth = true
            val u = (url ?: "").lowercase()
            // If Google sent us back to password, unlock TOTP mode so we can re-fill once
            if (totpAutoActive && u.contains("/challenge/pwd")) {
                totpAutoActive = false
                flowView.evaluateJavascript(
                    """
                    (function(){try{
                      var st=window.__flowHostAuto=window.__flowHostAuto||{};
                      Object.keys(st).forEach(function(k){
                        if(k.indexOf('pwd:')===0||k.indexOf('totp:')===0) delete st[k];
                      });
                    }catch(e){}})();
                    """.trimIndent(),
                    null
                )
            }
            // Back on method chooser — unlock so authenticator can be selected again
            if (u.contains("/challenge/selection") || u.contains("/challenge/sk")) {
                totpAutoActive = false
                last2faSelectMs = 0L
            }
            // Do NOT clear captchaActive on /identifier|/pwd — image captcha often
            // stays on those URLs; probeGoogleCaptcha owns lift/resume.
            if (totpAutoActive) {
                captchaActive = false
            }
            applyAuthOverlayState()
            ensureCaptchaProbeTimer()
            probeGoogleCaptcha()
            return
        }

        if (isGoogleLogoutUrl(url) && authLoginActive) {
            onGoogleAuth = true
            applyAuthOverlayState()
            return
        }

        if (isFlowWorkspaceUrl(url)) {
            if (authLoginActive || totpAutoActive) {
                // Keep cover briefly (avoids flicker on Flow→Google bounce), then clear
                onGoogleAuth = true
                applyAuthOverlayState()
                scheduleAuthCoverClearOnFlow()
                return
            }
            onGoogleAuth = false
            captchaActive = false
            applyAuthOverlayState()
            return
        }

        if (authLoginActive) {
            onGoogleAuth = true
            applyAuthOverlayState()
            return
        }

        onGoogleAuth = false
        captchaActive = false
        applyAuthOverlayState()
    }

    private fun ensureCaptchaProbeTimer() {
        if (captchaProbeJob?.isActive == true) return
        if (!authLoginActive && !onGoogleAuth) return
        captchaProbeJob = scope.launch {
            while (authLoginActive || onGoogleAuth) {
                probeGoogleCaptcha()
                delay(600)
            }
            captchaProbeJob = null
        }
    }

    /**
     * Host DOM probe for identifier image/text captcha and recaptcha widgets.
     * Lifts native cover (AUTH_UI_CAPTCHA) while present; resumes cover when gone.
     */
    private fun probeGoogleCaptcha() {
        val src = flowView.url ?: return
        if (!src.contains("accounts.google.com", ignoreCase = true) &&
            !src.contains("accounts.youtube.com", ignoreCase = true)
        ) {
            return
        }
        if (isGoogleRecaptchaChallengeUrl(src)) {
            if (!captchaActive) {
                captchaActive = true
                authLoginActive = true
                onGoogleAuth = true
                applyAuthOverlayState()
            }
            return
        }
        val now = SystemClock.elapsedRealtime()
        if (now - lastCaptchaProbeMs < 400L) return
        lastCaptchaProbeMs = now

        val probe = """
(() => {
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  };
  const frames = Array.from(document.querySelectorAll(
    'iframe[src*="recaptcha" i], iframe[src*="Recaptcha"], iframe[title*="reCAPTCHA" i], ' +
    'iframe[src*="challenges.cloudflare.com" i], iframe[src*="hcaptcha" i]'
  )).filter((f) => {
    const src = (f.getAttribute('src') || '').toLowerCase();
    if (src.includes('badge')) return false;
    const r = f.getBoundingClientRect();
    return r.width >= 80 && r.height >= 40 && r.bottom > 0 && r.top < innerHeight;
  });
  if (frames.length) return { captcha: true, via: 'iframe' };

  const imgs = Array.from(document.querySelectorAll(
    '#captchaimg, img#captchaimg, img[src*="Captcha" i], img[src*="captcha" i], img[alt*="captcha" i]'
  )).filter(visible);
  if (imgs.length) return { captcha: true, via: 'img', imgs: imgs.length };

  const named = Array.from(document.querySelectorAll(
    'input[name="ca"], input#ca, input[name="captcha"], input[id*="captcha" i], ' +
    'input[aria-label*="Type the text" i], input[aria-label*="hear or see" i], ' +
    'input[placeholder*="Type the text" i], input[placeholder*="hear or see" i], ' +
    'input[placeholder*="characters" i]'
  )).filter(visible);
  if (named.length) return { captcha: true, via: 'named-input', inputs: named.length };

  const path = location.pathname || '';
  const textInputs = Array.from(document.querySelectorAll('input')).filter((el) => {
    if (!visible(el)) return false;
    const t = String(el.getAttribute('type') || 'text').toLowerCase();
    return !['hidden','password','submit','button','checkbox','radio','file','image','reset'].includes(t);
  });
  const isPrimary = (el) => {
    const typ = String(el.getAttribute('type') || '').toLowerCase();
    const meta = [el.name, el.id, el.autocomplete, el.getAttribute('aria-label'), el.placeholder]
      .map((x) => String(x || '').toLowerCase()).join(' ');
    return typ === 'email' ||
      /^(email|identifier|username)$/i.test(String(el.name || el.id || '')) ||
      /identifierid|\bidentifier\b|\bemail\b|\busername\b|account name|phone number/i.test(meta);
  };
  const extras = textInputs.filter((el) => !isPrimary(el));
  if (extras.length >= 1 && /identifier/i.test(path)) {
    return { captcha: true, via: 'extra-text-field', extras: extras.length, total: textInputs.length };
  }
  if (/identifier|challenge\/pwd/i.test(path) && textInputs.length >= 2) {
    return { captcha: true, via: 'multi-text', total: textInputs.length };
  }
  if (textInputs.some((el) => /type the text|hear or see|enter the characters|captcha/i.test(
    [el.placeholder, el.getAttribute('aria-label'), el.name, el.id].map((x) => String(x || '')).join(' ')
  ))) {
    return { captcha: true, via: 'placeholder' };
  }

  const text = ((document.body && document.body.innerText) || '').slice(0, 3000);
  if (/type the text you hear or see|type the text|enter the characters/i.test(text)) {
    return { captcha: true, via: 'copy' };
  }
  const widgets = Array.from(document.querySelectorAll('.g-recaptcha, #recaptcha, [data-sitekey]')).filter(visible);
  if (widgets.length) return { captcha: true, via: 'widget' };
  return { captcha: false };
})()
""".trimIndent()

        try {
            flowView.evaluateJavascript(probe) { raw ->
                try {
                    var inner = raw?.trim().orEmpty()
                    if (inner.isEmpty() || inner == "null") return@evaluateJavascript
                    // WebView wraps object results as a JSON string literal
                    if (inner.startsWith("\"")) {
                        inner = JSONObject("{\"v\":$inner}").optString("v", "")
                    }
                    if (inner.isBlank() || inner == "null") return@evaluateJavascript
                    val result = JSONObject(inner)
                    val found = result.optBoolean("captcha", false)
                    if (found) {
                        captchaProbeHits++
                        captchaProbeMisses = 0
                    } else {
                        captchaProbeMisses++
                        captchaProbeHits = 0
                    }
                    if (captchaProbeHits >= 1 && !captchaActive) {
                        Log.i(TAG, "CaptchaProbe lift cover — captcha present via=${result.optString("via")}")
                        captchaActive = true
                        authLoginActive = true
                        onGoogleAuth = true
                        applyAuthOverlayState()
                        postToShell(
                            JSONObject()
                                .put("type", "flow-event")
                                .put("event", "ipc-message")
                                .put("channel", "auth:captcha")
                                .put("args", JSONArray().put(JSONObject().put("active", true)))
                        )
                    } else if (captchaActive && captchaProbeMisses >= 3) {
                        Log.i(TAG, "CaptchaProbe resume cover — captcha cleared")
                        captchaActive = false
                        authLoginActive = true
                        onGoogleAuth = true
                        applyAuthOverlayState()
                        postToShell(
                            JSONObject()
                                .put("type", "flow-event")
                                .put("event", "ipc-message")
                                .put("channel", "auth:captcha")
                                .put("args", JSONArray().put(JSONObject().put("active", false)))
                        )
                        val live = flowView.url ?: ""
                        tryHostGoogleAutofill(live)
                    }
                } catch (e: Exception) {
                    Log.d(TAG, "CaptchaProbe parse: ${e.message}")
                }
            }
        } catch (e: Exception) {
            Log.d(TAG, "CaptchaProbe: ${e.message}")
        }
    }

    private fun applyAuthOverlayState() {
        runOnUiThread {
            if (DISABLE_AUTH_COVER) {
                authUiMode = AUTH_UI_OFF
                authCover.visibility = View.GONE
                captchaBanner.visibility = View.GONE
                setFlowKeyboardBlocked(false)
                return@runOnUiThread
            }
            val want = when {
                shellMode == "full" -> AUTH_UI_OFF
                (authLoginActive || onGoogleAuth) && captchaActive -> AUTH_UI_CAPTCHA
                authLoginActive || onGoogleAuth -> AUTH_UI_COVER
                else -> AUTH_UI_OFF
            }
            if (want == authUiMode) {
                // Keep keyboard suppressed while cover is up (IME can reappear under it)
                if (want == AUTH_UI_COVER) setFlowKeyboardBlocked(true)
                else if (want == AUTH_UI_CAPTCHA) setFlowKeyboardBlocked(false)
                return@runOnUiThread
            }
            authUiMode = want
            when (want) {
                AUTH_UI_CAPTCHA -> {
                    authCover.visibility = View.GONE
                    captchaBanner.visibility = View.VISIBLE
                    setFlowKeyboardBlocked(false)
                    setCaptchaBannerText("Please solve the captcha below — we will continue signing you in automatically")
                }
                AUTH_UI_COVER -> {
                    authCover.visibility = View.VISIBLE
                    captchaBanner.visibility = View.GONE
                    setFlowKeyboardBlocked(true)
                }
                else -> {
                    authCover.visibility = View.GONE
                    captchaBanner.visibility = View.GONE
                    setFlowKeyboardBlocked(false)
                }
            }
        }
    }

    /**
     * While the opaque "Signing you in…" cover is showing, the guest WebView must not
     * take IME focus (recovery phone / OTP fields under the cover open the keyboard).
     * Captcha / TOTP lift turns this off so the user can type when needed.
     */
    private fun setFlowKeyboardBlocked(blocked: Boolean) {
        if (blocked) {
            flowView.isFocusable = false
            flowView.isFocusableInTouchMode = false
            flowView.clearFocus()
            try {
                flowView.evaluateJavascript(
                    "(function(){try{var a=document.activeElement;if(a&&a.blur)a.blur();"+
                        "document.querySelectorAll('input,textarea').forEach(function(i){try{i.blur();}catch(e){}});}catch(e){}})();",
                    null
                )
            } catch (_: Exception) {
            }
            authCover.isFocusable = true
            authCover.isFocusableInTouchMode = true
            authCover.requestFocus()
            hideSoftKeyboard()
        } else {
            flowView.isFocusable = true
            flowView.isFocusableInTouchMode = true
            try {
                window.setSoftInputMode(
                    android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_UNSPECIFIED or
                        android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
                )
            } catch (_: Exception) {
            }
        }
    }

    private fun hideSoftKeyboard() {
        try {
            val imm = getSystemService(INPUT_METHOD_SERVICE) as? InputMethodManager ?: return
            val token = currentFocus?.windowToken
                ?: authCover.windowToken
                ?: flowView.windowToken
                ?: window.decorView.windowToken
            imm.hideSoftInputFromWindow(token, 0)
            window.setSoftInputMode(
                android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN or
                    android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
            )
        } catch (_: Exception) {
        }
    }

    private fun setCaptchaBannerText(text: String) {
        runOnUiThread {
            (captchaBanner as? android.widget.TextView)?.text = text
        }
    }

    private fun isAboutBlank(url: String?): Boolean =
        !url.isNullOrBlank() && url.startsWith("about:", ignoreCase = true)

    private fun isGoogleAuthUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        return try {
            val host = Uri.parse(url).host ?: return false
            host.equals("accounts.google.com", true) ||
                host.endsWith(".accounts.google.com", true) ||
                host.equals("accounts.youtube.com", true)
        } catch (_: Exception) {
            url.contains("accounts.google.com", true)
        }
    }

    private fun isFlowWorkspaceUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        return try {
            val host = (Uri.parse(url).host ?: "").lowercase()
            host == "flow.google.com" ||
                host.endsWith(".flow.google.com") ||
                host == "labs.google" ||
                host.endsWith(".labs.google")
        } catch (_: Exception) {
            val u = url.lowercase()
            u.contains("flow.google.com") || u.contains("labs.google")
        }
    }

    private fun isGoogleAuthRelatedUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        if (isGoogleAuthUrl(url)) return true
        return try {
            val uri = Uri.parse(url)
            val host = (uri.host ?: "").lowercase()
            val path = (uri.path ?: "").lowercase()
            if (host == "google.com" || host == "www.google.com") {
                return path.startsWith("/accountchooser") ||
                    path.startsWith("/signin") ||
                    path.startsWith("/accounts") ||
                    path.startsWith("/servicelogin") ||
                    path.startsWith("/logout") ||
                    path.startsWith("/oauth") ||
                    path.contains("signin") ||
                    path.contains("recaptcha")
            }
            if (host.contains("gstatic.com") && path.contains("recaptcha")) return true
            // Recovery phone/email + home address interstitials (auto-cancelled)
            if (host == "gds.google.com" || host.endsWith(".gds.google.com")) return true
            false
        } catch (_: Exception) {
            url.contains("gds.google.com", true)
        }
    }

    private fun isGoogleRecaptchaChallengeUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        val u = url.lowercase()
        if (u.contains("recaptcha") || u.contains("hcaptcha")) return true
        if (u.contains("/captcha") || u.contains("captcha?") || u.contains("captcha&") || u.contains("captcha=")) {
            return true
        }
        if (u.contains("challenge/recaptcha") || u.contains("challenge/ipp") ||
            u.contains("challenge/az") || u.contains("challenge/bc") || u.contains("challenge/wp")
        ) {
            return true
        }
        if (u.contains("/challenge/") &&
            !u.contains("/challenge/pwd") &&
            !u.contains("/challenge/totp") &&
            !u.contains("/challenge/selection") &&
            !u.contains("/challenge/sk") &&
            !u.contains("/challenge/iap") &&
            !u.contains("/challenge/dp") &&
            !u.contains("/challenge/ootp")
        ) {
            return true
        }
        return false
    }

    private fun isGoogleCredentialStepUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        return try {
            val path = (Uri.parse(url).path ?: "").lowercase()
            path.contains("/identifier") ||
                path.contains("/challenge/pwd") ||
                path.contains("/challenge/totp") ||
                path.contains("/challenge/ipp") ||
                path.contains("/challenge/sk") ||
                path.contains("/challenge/selection") ||
                path.contains("/rejected") ||
                path.contains("/speedbump")
        } catch (_: Exception) {
            false
        }
    }

    private fun isGoogleLogoutUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        return try {
            val uri = Uri.parse(url)
            val host = (uri.host ?: "").lowercase()
            val path = (uri.path ?: "").lowercase()
            (host.contains("accounts.google.com") && path.contains("logout")) ||
                ((host == "google.com" || host == "www.google.com") && path.startsWith("/logout"))
        } catch (_: Exception) {
            url.contains("logout", true) && url.contains("google", true)
        }
    }

    private fun openInFolder(path: String) {
        try {
            val file = File(path)
            val uri = if (file.isFile) {
                FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
            } else {
                Uri.fromFile(file)
            }
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "*/*")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivity(Intent.createChooser(intent, "Open"))
        } catch (e: Exception) {
            Log.w(TAG, "showInFolder failed: ${e.message}")
            Toast.makeText(this, "Saved: $path", Toast.LENGTH_SHORT).show()
        }
    }

    private fun handleDownload(
        url: String,
        userAgent: String,
        contentDisposition: String,
        mimeType: String,
        contentLength: Long
    ) {
        val guessed = URLUtil.guessFileName(url, contentDisposition, mimeType.ifBlank { null })
        val mime = mimeType.ifBlank { guessMimeFromName(guessed) }
        val filename = sanitizeDownloadFilename(guessed, mime)
        postToShell(
            JSONObject()
                .put("type", "download")
                .put("phase", "started")
                .put(
                    "data",
                    JSONObject().put("filename", filename).put("totalBytes", contentLength)
                )
        )
        when {
            url.startsWith("blob:", ignoreCase = true) || url.startsWith("data:", ignoreCase = true) -> {
                downloadBlobViaJs(url, filename, mime)
            }
            url.startsWith("http://", ignoreCase = true) || url.startsWith("https://", ignoreCase = true) -> {
                downloadHttpToGallery(url, userAgent, filename, mime)
            }
            else -> {
                Log.e(TAG, "Unsupported download URL: $url")
                notifyDownloadFailed(filename)
            }
        }
    }

    private fun downloadBlobViaJs(url: String, filename: String, mime: String) {
        val id = "dl_${System.currentTimeMillis()}_${(Math.random() * 1e6).toInt()}"
        val urlLit = JSONObject.quote(url)
        val nameLit = JSONObject.quote(filename)
        val mimeLit = JSONObject.quote(mime)
        val idLit = JSONObject.quote(id)
        val script = """
(async function(){
  try {
    var url = $urlLit;
    var filename = $nameLit;
    var mimeHint = $mimeLit;
    var id = $idLit;
    var res = await fetch(url);
    var blob = await res.blob();
    var mime = blob.type || mimeHint || 'application/octet-stream';
    var name = filename;
    if (!name || /^download(\.bin)?$/i.test(name) || /\.bin$/i.test(name)) {
      var ext = 'bin';
      if (/mp4|mpeg/i.test(mime)) ext = 'mp4';
      else if (/webm/i.test(mime)) ext = 'webm';
      else if (/quicktime/i.test(mime)) ext = 'mov';
      else if (/png/i.test(mime)) ext = 'png';
      else if (/jpe?g/i.test(mime)) ext = 'jpg';
      else if (/webp/i.test(mime)) ext = 'webp';
      else if (/gif/i.test(mime)) ext = 'gif';
      else if (/^video\//i.test(mime)) ext = 'mp4';
      else if (/^image\//i.test(mime)) ext = 'png';
      name = 'flow_' + Date.now() + '.' + ext;
    }
    var buf = await blob.arrayBuffer();
    var bytes = new Uint8Array(buf);
    if (!window.FlowHost || !window.FlowHost.downloadBegin) throw new Error('FlowHost missing');
    window.FlowHost.downloadBegin(id, name, mime, bytes.length);
    var CHUNK = 240000;
    var binary = '';
    for (var i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
      if (binary.length >= CHUNK || i === bytes.length - 1) {
        window.FlowHost.downloadChunk(id, btoa(binary));
        binary = '';
      }
    }
    window.FlowHost.downloadEnd(id);
  } catch (e) {
    try {
      if (window.FlowHost && window.FlowHost.downloadFail) {
        window.FlowHost.downloadFail($idLit, String(e && e.message || e));
      }
    } catch (e2) {}
  }
})();
""".trimIndent()
        flowView.evaluateJavascript(script, null)
    }

    private fun downloadHttpToGallery(url: String, userAgent: String, filename: String, mime: String) {
        val ua = userAgent.ifBlank { flowView.settings.userAgentString ?: "" }
        val referer = flowView.url ?: "https://flow.google.com/"
        scope.launch(Dispatchers.IO) {
            try {
                val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                    instanceFollowRedirects = true
                    connectTimeout = 30000
                    readTimeout = 120000
                    setRequestProperty("User-Agent", ua)
                    val cookie = CookieManager.getInstance().getCookie(url)
                        ?: CookieManager.getInstance().getCookie("https://flow.google.com")
                    if (!cookie.isNullOrBlank()) setRequestProperty("Cookie", cookie)
                    setRequestProperty("Referer", referer)
                    setRequestProperty("Accept", "*/*")
                }
                val code = conn.responseCode
                if (code !in 200..299) throw IllegalStateException("HTTP $code")
                val resolvedMime = conn.contentType?.substringBefore(';')?.trim().orEmpty()
                    .ifBlank { mime }
                // Peek magic bytes so we don't save as .bin when server omits content-type
                val bytes = conn.inputStream.use { it.readBytes() }
                val sniffed = sniffMime(bytes) ?: resolvedMime
                val finalName = sanitizeDownloadFilename(filename, sniffed)
                val outUri = openGalleryOutput(finalName, sniffed)
                    ?: throw IllegalStateException("MediaStore insert failed")
                contentResolver.openOutputStream(outUri)?.use { out -> out.write(bytes) }
                    ?: throw IllegalStateException("openOutputStream failed")
                finalizeGalleryPending(outUri)
                withContext(Dispatchers.Main) {
                    notifyDownloadCompleted(finalName, outUri.toString())
                    Toast.makeText(this@MainActivity, "Saved to gallery: $finalName", Toast.LENGTH_SHORT).show()
                }
            } catch (e: Exception) {
                Log.e(TAG, "HTTP download failed", e)
                withContext(Dispatchers.Main) { notifyDownloadFailed(filename) }
            }
        }
    }

    fun onBlobDownloadBegin(id: String, filename: String, mime: String, total: Int) {
        try {
            val temp = File(cacheDir, "flow_dl_$id.bin")
            if (temp.exists()) temp.delete()
            val out = BufferedOutputStream(FileOutputStream(temp))
            pendingBlobDownloads[id] = PendingBlobDownload(filename, mime, temp, out)
            Log.i(TAG, "Blob download begin $filename ($total bytes)")
        } catch (e: Exception) {
            Log.e(TAG, "downloadBegin failed", e)
            notifyDownloadFailed(filename)
        }
    }

    fun onBlobDownloadChunk(id: String, base64Chunk: String) {
        val pending = pendingBlobDownloads[id] ?: return
        try {
            val bytes = Base64.decode(base64Chunk, Base64.DEFAULT)
            pending.out.write(bytes)
        } catch (e: Exception) {
            Log.e(TAG, "downloadChunk failed", e)
            cleanupBlobDownload(id, failed = true)
        }
    }

    fun onBlobDownloadEnd(id: String) {
        val pending = pendingBlobDownloads.remove(id) ?: return
        scope.launch(Dispatchers.IO) {
            try {
                pending.out.flush()
                pending.out.close()
                val header = pending.temp.inputStream().use { input ->
                    val buf = ByteArray(32)
                    val n = input.read(buf)
                    if (n > 0) buf.copyOf(n) else ByteArray(0)
                }
                val sniffed = sniffMime(header) ?: pending.mime
                val finalName = sanitizeDownloadFilename(pending.filename, sniffed)
                val outUri = openGalleryOutput(finalName, sniffed)
                    ?: throw IllegalStateException("MediaStore insert failed")
                contentResolver.openOutputStream(outUri)?.use { out ->
                    pending.temp.inputStream().use { it.copyTo(out) }
                } ?: throw IllegalStateException("openOutputStream failed")
                finalizeGalleryPending(outUri)
                pending.temp.delete()
                withContext(Dispatchers.Main) {
                    notifyDownloadCompleted(finalName, outUri.toString())
                    Toast.makeText(
                        this@MainActivity,
                        "Saved to gallery: $finalName",
                        Toast.LENGTH_SHORT
                    ).show()
                }
            } catch (e: Exception) {
                Log.e(TAG, "Blob download end failed", e)
                try { pending.temp.delete() } catch (_: Exception) {}
                withContext(Dispatchers.Main) { notifyDownloadFailed(pending.filename) }
            }
        }
    }

    fun onBlobDownloadFail(id: String, error: String) {
        Log.e(TAG, "Blob download fail $id: $error")
        val name = pendingBlobDownloads[id]?.filename ?: "download"
        cleanupBlobDownload(id, failed = true)
        runOnUiThread { notifyDownloadFailed(name) }
    }

    private fun cleanupBlobDownload(id: String, failed: Boolean) {
        val pending = pendingBlobDownloads.remove(id) ?: return
        try { pending.out.close() } catch (_: Exception) {}
        try { pending.temp.delete() } catch (_: Exception) {}
        if (failed) runOnUiThread { notifyDownloadFailed(pending.filename) }
    }

    private fun openGalleryOutput(filename: String, mimeRaw: String): Uri? {
        val mime = mimeRaw.ifBlank { guessMimeFromName(filename) }
        val isVideo = mime.startsWith("video/") || filename.matches(Regex(".*\\.(mp4|webm|mov|mkv)$", RegexOption.IGNORE_CASE))
                val isImage = mime.startsWith("image/") || filename.matches(
                    Regex(
                        ".*\\.(png|jpe?g|jpe|webp|gif|heic|heif|hvic|bmp|tif{1,2}|avif|svg)$",
                        RegexOption.IGNORE_CASE
                    )
                )
        val collection = when {
            isVideo -> if (Build.VERSION.SDK_INT >= 29) {
                MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            } else MediaStore.Video.Media.EXTERNAL_CONTENT_URI
            isImage -> if (Build.VERSION.SDK_INT >= 29) {
                MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            } else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
            else -> if (Build.VERSION.SDK_INT >= 29) {
                MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            } else MediaStore.Files.getContentUri("external")
        }
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
            put(
                MediaStore.MediaColumns.MIME_TYPE,
                when {
                    mime.isNotBlank() -> mime
                    isVideo -> "video/mp4"
                    isImage -> "image/png"
                    else -> "application/octet-stream"
                }
            )
            if (Build.VERSION.SDK_INT >= 29) {
                put(
                    MediaStore.MediaColumns.RELATIVE_PATH,
                    when {
                        isVideo -> Environment.DIRECTORY_MOVIES + "/Flow Creator"
                        isImage -> Environment.DIRECTORY_PICTURES + "/Flow Creator"
                        else -> Environment.DIRECTORY_DOWNLOADS + "/Flow Creator"
                    }
                )
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
        }
        return contentResolver.insert(collection, values)
    }

    private fun finalizeGalleryPending(uri: Uri) {
        if (Build.VERSION.SDK_INT < 29) return
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.IS_PENDING, 0)
        }
        try {
            contentResolver.update(uri, values, null, null)
        } catch (e: Exception) {
            Log.w(TAG, "finalizeGalleryPending: ${e.message}")
        }
    }

    private fun guessMimeFromName(name: String): String {
        val n = name.lowercase()
        return when {
            n.endsWith(".mp4") -> "video/mp4"
            n.endsWith(".webm") -> "video/webm"
            n.endsWith(".mov") -> "video/quicktime"
            n.endsWith(".png") -> "image/png"
            n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".jpe") -> "image/jpeg"
            n.endsWith(".webp") -> "image/webp"
            n.endsWith(".gif") -> "image/gif"
            n.endsWith(".heic") || n.endsWith(".hvic") -> "image/heic"
            n.endsWith(".heif") -> "image/heif"
            n.endsWith(".bmp") -> "image/bmp"
            n.endsWith(".tif") || n.endsWith(".tiff") -> "image/tiff"
            n.endsWith(".avif") -> "image/avif"
            else -> "application/octet-stream"
        }
    }

    /** Fix download.bin / missing extensions from blob: URLs. */
    private fun sanitizeDownloadFilename(raw: String, mime: String): String {
        var name = raw.substringAfterLast('/').substringAfterLast('\\').trim()
        if (name.isBlank() ||
            name.equals("download", true) ||
            name.equals("download.bin", true) ||
            name.equals("bin", true) ||
            name.matches(Regex("^download\\d*$", RegexOption.IGNORE_CASE))
        ) {
            name = "flow_${System.currentTimeMillis()}"
        }
        name = name.replace(Regex("[\\\\/:*?\"<>|]"), "_")
        val ext = extensionForMime(mime)
        val lower = name.lowercase()
        if (ext != null) {
            if (lower.endsWith(".bin") || !lower.contains('.')) {
                name = name.replace(Regex("\\.bin$", RegexOption.IGNORE_CASE), "")
                if (!name.lowercase().endsWith(".$ext")) name = "$name.$ext"
            } else if (lower.endsWith(".bin.$ext")) {
                name = name.replace(Regex("\\.bin\\.", RegexOption.IGNORE_CASE), ".")
            }
        }
        return name
    }

    private fun extensionForMime(mime: String): String? {
        val m = mime.lowercase().substringBefore(';').trim()
        return when {
            m == "video/mp4" || m == "video/mpeg" -> "mp4"
            m == "video/webm" -> "webm"
            m == "video/quicktime" -> "mov"
            m == "image/png" -> "png"
            m == "image/jpeg" || m == "image/jpg" -> "jpg"
            m == "image/webp" -> "webp"
            m == "image/gif" -> "gif"
            m == "image/heic" -> "heic"
            m == "image/heif" -> "heif"
            m == "image/bmp" || m == "image/x-ms-bmp" -> "bmp"
            m == "image/tiff" -> "tiff"
            m == "image/avif" -> "avif"
            m.startsWith("video/") -> "mp4"
            m.startsWith("image/") -> "jpg"
            else -> null
        }
    }

    private fun sniffMime(header: ByteArray): String? {
        if (header.isEmpty()) return null
        // PNG
        if (header.size >= 8 &&
            header[0] == 0x89.toByte() && header[1] == 0x50.toByte() &&
            header[2] == 0x4E.toByte() && header[3] == 0x47.toByte()
        ) return "image/png"
        // JPEG
        if (header.size >= 3 && header[0] == 0xFF.toByte() && header[1] == 0xD8.toByte()) {
            return "image/jpeg"
        }
        // GIF
        if (header.size >= 6 &&
            header[0] == 'G'.code.toByte() && header[1] == 'I'.code.toByte() && header[2] == 'F'.code.toByte()
        ) return "image/gif"
        // WEBP: RIFF....WEBP
        if (header.size >= 12 &&
            header[0] == 'R'.code.toByte() && header[1] == 'I'.code.toByte() &&
            header[8] == 'W'.code.toByte() && header[9] == 'E'.code.toByte()
        ) return "image/webp"
        // MP4 / MOV: ....ftyp
        if (header.size >= 12 &&
            header[4] == 'f'.code.toByte() && header[5] == 't'.code.toByte() &&
            header[6] == 'y'.code.toByte() && header[7] == 'p'.code.toByte()
        ) {
            val brand = String(header, 8, minOf(4, header.size - 8), Charsets.US_ASCII)
            return if (brand.startsWith("qt")) "video/quicktime" else "video/mp4"
        }
        // WebM / Matroska EBML
        if (header.size >= 4 &&
            header[0] == 0x1A.toByte() && header[1] == 0x45.toByte() &&
            header[2] == 0xDF.toByte() && header[3] == 0xA3.toByte()
        ) return "video/webm"
        return null
    }

    /** Copy content:// gallery URIs into app cache so WebView can always read them. */
    private fun uriForWebViewUpload(uri: Uri): Uri {
        return try {
            val mime = contentResolver.getType(uri) ?: "application/octet-stream"
            val ext = extensionForMime(mime) ?: "bin"
            val out = File(cacheDir, "upload_${System.currentTimeMillis()}.$ext")
            contentResolver.openInputStream(uri)?.use { input ->
                FileOutputStream(out).use { input.copyTo(it) }
            } ?: return uri
            FileProvider.getUriForFile(this, "$packageName.fileprovider", out)
        } catch (e: Exception) {
            Log.w(TAG, "uriForWebViewUpload fallback: ${e.message}")
            uri
        }
    }

    private fun isImageAccept(token: String): Boolean {
        val t = token.lowercase().trim().removePrefix(".")
        // Accept MIME, extensions, and Flow-style lists (png / jpg / jpeg / heic / hvic typo)
        return t == "*/*" || t == "*" || t.startsWith("image/") || t == "image" ||
            t == "png" || t == "jpg" || t == "jpeg" || t == "jpe" ||
            t == "webp" || t == "gif" || t == "heic" || t == "heif" || t == "hvic" ||
            t == "bmp" || t == "tif" || t == "tiff" || t == "avif" || t == "svg" ||
            t.endsWith(".png") || t.endsWith(".jpg") || t.endsWith(".jpeg") || t.endsWith(".jpe") ||
            t.endsWith(".webp") || t.endsWith(".gif") || t.endsWith(".heic") || t.endsWith(".heif") ||
            t.endsWith(".hvic") || t.endsWith(".bmp") || t.endsWith(".tif") || t.endsWith(".tiff") ||
            t.endsWith(".avif") || t.contains("image") || t.contains("photo") || t.contains("picture")
    }

    private fun isVideoAccept(token: String): Boolean {
        val t = token.lowercase().trim().removePrefix(".")
        return t == "*/*" || t == "*" || t.startsWith("video/") || t == "video" ||
            t == "mp4" || t == "webm" || t == "mov" || t == "mkv" || t == "m4v" ||
            t.endsWith(".mp4") || t.endsWith(".webm") || t.endsWith(".mov") ||
            t.endsWith(".mkv") || t.endsWith(".m4v") || t.contains("video")
    }

    private fun mediaPermissionsNeeded(): Array<String> {
        return if (Build.VERSION.SDK_INT >= 33) {
            buildList {
                if (pendingGalleryImage) add(Manifest.permission.READ_MEDIA_IMAGES)
                if (pendingGalleryVideo) add(Manifest.permission.READ_MEDIA_VIDEO)
                if (isEmpty()) {
                    add(Manifest.permission.READ_MEDIA_IMAGES)
                    add(Manifest.permission.READ_MEDIA_VIDEO)
                }
            }.toTypedArray()
        } else {
            arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
    }

    private fun hasMediaAccess(): Boolean {
        return mediaPermissionsNeeded().all {
            ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
        }
    }

    private fun ensureMediaAccessThenOpenGallery() {
        // System Photo Picker (API 33+) needs no permission — still request so ACTION_PICK
        // gallery fallback and FileProvider copies work on all OEMs.
        if (hasMediaAccess()) {
            openGalleryPickerNow()
            return
        }
        mediaPermissionLauncher.launch(mediaPermissionsNeeded())
    }

    private fun openGalleryPickerNow() {
        try {
            val mediaType = when {
                pendingGalleryImage && pendingGalleryVideo ->
                    ActivityResultContracts.PickVisualMedia.ImageAndVideo
                pendingGalleryVideo && !pendingGalleryImage ->
                    ActivityResultContracts.PickVisualMedia.VideoOnly
                else -> ActivityResultContracts.PickVisualMedia.ImageOnly
            }
            // Prefer system Photo Picker (gallery UI) — never Documents/Files
            if (ActivityResultContracts.PickVisualMedia.isPhotoPickerAvailable(this)) {
                val req = androidx.activity.result.PickVisualMediaRequest(mediaType)
                if (pendingGalleryMultiple) pickMultipleMediaLauncher.launch(req)
                else pickMediaLauncher.launch(req)
                return
            }
            // Fallback: classic Gallery / Photos via ACTION_PICK (not Files)
            openClassicGalleryPicker()
        } catch (e: Exception) {
            Log.e(TAG, "openGalleryPickerNow failed, trying classic gallery", e)
            try {
                openClassicGalleryPicker()
            } catch (e2: Exception) {
                Log.e(TAG, "classic gallery failed", e2)
                filePathCallback?.onReceiveValue(null)
                filePathCallback = null
                Toast.makeText(this, "Could not open gallery", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun openClassicGalleryPicker() {
        val imageMimes = arrayOf(
            "image/*",
            "image/png",
            "image/jpeg",
            "image/jpg",
            "image/webp",
            "image/gif",
            "image/heic",
            "image/heif",
            "image/bmp",
            "image/tiff",
            "image/avif"
        )
        val videoMimes = arrayOf("video/*", "video/mp4", "video/webm", "video/quicktime")
        val intent = when {
            pendingGalleryVideo && !pendingGalleryImage ->
                Intent(Intent.ACTION_PICK, MediaStore.Video.Media.EXTERNAL_CONTENT_URI).apply {
                    type = "video/*"
                    putExtra(Intent.EXTRA_MIME_TYPES, videoMimes)
                }
            pendingGalleryImage && !pendingGalleryVideo ->
                Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI).apply {
                    type = "image/*"
                    putExtra(Intent.EXTRA_MIME_TYPES, imageMimes)
                }
            else -> Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI).apply {
                // Default: photos gallery (png/jpg/jpeg/heic/…) + allow video too
                type = "*/*"
                putExtra(Intent.EXTRA_MIME_TYPES, imageMimes + videoMimes)
            }
        }
        if (pendingGalleryMultiple) {
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        fileChooserLauncher.launch(Intent.createChooser(intent, "Choose from gallery"))
    }

    private fun deliverFileChooserResult(resultCode: Int, data: Intent?) {
        val cb = filePathCallback
        filePathCallback = null
        if (cb == null) return
        if (resultCode != Activity.RESULT_OK || data == null) {
            cb.onReceiveValue(null)
            return
        }
        val uris = mutableListOf<Uri>()
        data.clipData?.let { clip ->
            for (i in 0 until clip.itemCount) {
                clip.getItemAt(i)?.uri?.let { uris.add(uriForWebViewUpload(it)) }
            }
        }
        if (uris.isEmpty()) {
            data.data?.let { uris.add(uriForWebViewUpload(it)) }
        }
        uris.forEach { uri ->
            try {
                contentResolver.takePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            } catch (_: Exception) {
            }
        }
        cb.onReceiveValue(if (uris.isEmpty()) null else uris.toTypedArray())
    }

    private fun notifyDownloadCompleted(filename: String, savePath: String) {
        postToShell(
            JSONObject()
                .put("type", "download")
                .put("phase", "completed")
                .put(
                    "data",
                    JSONObject()
                        .put("filename", filename)
                        .put("savePath", savePath)
                )
        )
    }

    private fun notifyDownloadFailed(filename: String) {
        postToShell(
            JSONObject()
                .put("type", "download")
                .put("phase", "failed")
                .put("data", JSONObject().put("filename", filename).put("state", "error"))
        )
        Toast.makeText(this, "Download failed: $filename", Toast.LENGTH_SHORT).show()
    }

    private fun dispatchFlowClick(x: Double, y: Double) {
        if (x <= 0 || y <= 0) return
        val ix = x.toFloat()
        val iy = y.toFloat()
        val down = SystemClock.uptimeMillis()
        val downEv = MotionEvent.obtain(down, down, MotionEvent.ACTION_DOWN, ix, iy, 0)
        val upEv = MotionEvent.obtain(down, down + 40, MotionEvent.ACTION_UP, ix, iy, 0)
        flowView.dispatchTouchEvent(downEv)
        flowView.dispatchTouchEvent(upEv)
        downEv.recycle()
        upEv.recycle()
        // JS fallback
        flowView.evaluateJavascript(
            "(function(){var el=document.elementFromPoint($x,$y); if(el){try{el.click();}catch(e){}}})();",
            null
        )
    }

    private fun fillTotp(otp: String?) {
        if (otp.isNullOrBlank()) return
        totpAutoActive = true
        // Keep opaque cover while auto-filling OTP (do not lift for captcha mode)
        captchaActive = false
        authLoginActive = true
        onGoogleAuth = true
        applyAuthOverlayState()
        val code = jsString(otp)
        // Fill OTP only — do NOT click Next. Google completes the session after the code
        // settles; premature Next was logging users out / bouncing back to password.
        val script = """
(() => {
  const otp = $code;
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  };
  const el = document.querySelector('input[name="totpPin"], input#totpPin, input[autocomplete="one-time-code"]') ||
    Array.from(document.querySelectorAll('input')).find(i => {
      if (!visible(i) || i.type === 'hidden' || i.type === 'checkbox' || i.type === 'password') return false;
      const b = ((i.getAttribute('aria-label')||'') + ' ' + (i.placeholder||'') + ' ' + (i.name||'') + ' ' + (i.id||'')).toLowerCase();
      return /code|totp|otp|pin/.test(b);
    });
  if (!el) return 'no-input';
  const st = window.__flowHostAuto = window.__flowHostAuto || {};
  const totpKey = 'totp:' + (location.pathname || '').split('/').slice(0, 5).join('/');
  if (st[totpKey] === 'filled' && (el.value || '') === otp) return 'already';
  const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  const setter = desc && desc.set;
  try { el.focus(); } catch (e) {}
  if (setter) setter.call(el, otp); else el.value = otp;
  try {
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: otp, inputType: 'insertText' }));
  } catch (e) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  el.dispatchEvent(new Event('change', { bubbles: true }));
  try { el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' })); } catch (e) {}
  st[totpKey] = 'filled';
  // DEBUG skip Next if flag set; otherwise settle then click Next and let Google finish session
  if (${if (DISABLE_GOOGLE_AUTO_NEXT) "true" else "false"}) {
    return 'filled-manual-next:' + (el.value || '').length;
  }
  setTimeout(() => {
    if (st[totpKey] === 'submitted') return;
    if (!el.isConnected) return;
    if ((el.value || '') !== otp) return;
    var btn = document.querySelector('#totpNext button, #totpNext') ||
      Array.from(document.querySelectorAll('button')).find(b => /^\s*next\s*$/i.test((b.innerText || '').trim()));
    if (btn) {
      try { btn.click(); st[totpKey] = 'submitted'; } catch (e) {}
    }
  }, 1800);
  return 'filled-next:' + (el.value || '').length;
})()
""".trimIndent()
        flowView.evaluateJavascript(script, null)
    }

    /** Google SPA often keeps /identifier in the URL while showing Authenticator TOTP UI. */
    private fun detectTotpAndFill() {
        val src = flowView.url ?: return
        if (!src.contains("accounts.google.com", true)) return
        val now = System.currentTimeMillis()
        if (now - lastTotpDetectMs < 1800) return
        lastTotpDetectMs = now
        flowView.evaluateJavascript(
            """
            (function(){
              var t = ((document.body && document.body.innerText) || '').slice(0, 2500);
              var hasInput = !!(document.querySelector('input[name="totpPin"], input#totpPin, input[autocomplete="one-time-code"]') ||
                Array.from(document.querySelectorAll('input')).some(function(i){
                  if (i.type === 'hidden' || i.type === 'password' || i.type === 'checkbox') return false;
                  var r = i.getBoundingClientRect();
                  if (r.width < 2 || r.height < 2) return false;
                  var b = ((i.getAttribute('aria-label')||'')+' '+(i.placeholder||'')+' '+(i.name||'')+' '+(i.id||'')).toLowerCase();
                  return /code|totp|otp|pin/.test(b);
                }));
              var looksTotp = hasInput && /Authenticator|verification code|2-Step Verification|Enter code/i.test(t);
              var pathTotp = /\/challenge\/totp/i.test(location.pathname || '');
              return (looksTotp || pathTotp) ? 'totp' : 'other';
            })()
            """.trimIndent()
        ) { result ->
            if (result?.contains("totp") != true) return@evaluateJavascript
            Log.i(TAG, "Authenticator TOTP step detected — keep cover, request OTP (no overlay lift)")
            totpAutoActive = true
            // Do NOT lift cover for auto OTP — lifting caused password↔OTP bounce flicker
            captchaActive = false
            authLoginActive = true
            onGoogleAuth = true
            applyAuthOverlayState()
            postToShell(
                JSONObject()
                    .put("type", "flow-event")
                    .put("event", "ipc-message")
                    .put("channel", "auth:need-otp")
                    .put("args", JSONArray().put(JSONObject().put("reason", "totp")))
            )
            postFlowUrl(flowView.url ?: src, "did-navigate")
            scope.launch {
                delay(600)
                repeat(3) {
                    if (!totpAutoActive) return@launch
                    postToShell(
                        JSONObject()
                            .put("type", "flow-event")
                            .put("event", "ipc-message")
                            .put("channel", "auth:need-otp")
                            .put("args", JSONArray().put(JSONObject().put("reason", "totp")))
                    )
                    delay(2200)
                }
            }
        }
    }

    private fun tryHostGoogleAutofill(url: String?) {
        val email = flowCredEmail ?: return
        val u = url ?: flowView.url ?: return
        if (!u.contains("accounts.google.com", true) && !u.contains("accounts.youtube.com", true)) return
        // Never autofill over a live captcha challenge
        if (isGoogleRecaptchaChallengeUrl(u)) return
        if (captchaActive) return

        // 2FA method list / security-key prompts — always drive these (never skip for TOTP flag)
        if (isGoogle2faNavUrl(u)) {
            driveGoogle2faSelection(u)
            return
        }

        // While TOTP autofill is active, never re-drive email/password fills
        if (totpAutoActive && !u.contains("/challenge/pwd", true) && !u.contains("/identifier", true)) {
            detectTotpAndFill()
            return
        }
        if (totpAutoActive && u.contains("/challenge/totp", true)) {
            detectTotpAndFill()
            return
        }
        val now = System.currentTimeMillis()
        if (now - lastAutofillKickMs < 800) return
        lastAutofillKickMs = now
        injectGoogleAutofillOnce(email, flowCredPassword ?: "")
        val gen = autofillGeneration.incrementAndGet()
        scope.launch {
            for (delayMs in listOf(400L, 900L, 1600L)) {
                delay(delayMs)
                if (gen != autofillGeneration.get()) return@launch
                val cur = flowView.url ?: return@launch
                if (isGoogle2faNavUrl(cur)) {
                    driveGoogle2faSelection(cur)
                    return@launch
                }
                if (totpAutoActive) {
                    detectTotpAndFill()
                    return@launch
                }
                injectGoogleAutofillOnce(email, flowCredPassword ?: "")
                detectTotpAndFill()
            }
        }
    }

    private fun isGoogle2faNavUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        val u = url.lowercase()
        if (u.contains("/challenge/totp")) return false
        if (u.contains("/challenge/pwd")) return false
        return u.contains("/challenge/selection") ||
            u.contains("/challenge/sk") ||
            u.contains("/challenge/skotp") ||
            u.contains("/challenge/iap") ||
            u.contains("/challenge/dp") ||
            u.contains("/challenge/ootp") ||
            (u.contains("/challenge/") && u.contains("selection"))
    }

    private var last2faSelectMs = 0L
    private var selectionLoopGen = AtomicInteger(0)

    /** Click Authenticator / Try another way on Google 2FA chooser pages. */
    private fun driveGoogle2faSelection(url: String?) {
        if (DISABLE_GOOGLE_AUTO_NEXT) return
        val u = url ?: flowView.url ?: return
        if (!isGoogle2faNavUrl(u) && !u.contains("accounts.google.com", true)) return
        val now = System.currentTimeMillis()
        if (now - last2faSelectMs < 500) return
        last2faSelectMs = now
        authLoginActive = true
        onGoogleAuth = true
        captchaActive = false
        totpAutoActive = false
        applyAuthOverlayState()

        val script = """
(() => {
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) !== 0;
  };
  const txt = (el) => ((el && (el.innerText || el.textContent || el.getAttribute && el.getAttribute('aria-label'))) || '')
    .replace(/\s+/g, ' ').trim();
  const click = (el) => {
    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      el.focus && el.focus();
      try {
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, cancelable:true, pointerType:'touch' }));
        el.dispatchEvent(new PointerEvent('pointerup', { bubbles:true, cancelable:true, pointerType:'touch' }));
      } catch (e) {}
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles:true, cancelable:true, view:window }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles:true, cancelable:true, view:window }));
      el.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true, view:window }));
      if (typeof el.click === 'function') el.click();
    } catch (e) {}
  };
  const path = (location.pathname || '').toLowerCase();
  const page = ((document.body && document.body.innerText) || '').slice(0, 4500);
  const onChooser = /\/challenge\/selection/i.test(path) || /choose how you want to sign in|choose a way/i.test(page);

  if (/\/challenge\/sk/i.test(path) || (/g\.co\/sc|get a code to sign in|security key/i.test(page) && !onChooser)) {
    const tryAnother = Array.from(document.querySelectorAll('button, a, [role="button"], [role="link"], span, div'))
      .find((el) => visible(el) && /^try another way$/i.test(txt(el)));
    if (tryAnother) { click(tryAnother); return 'try-another'; }
  }

  if (!onChooser && !/authenticator/i.test(page) && !/\/challenge\/selection/i.test(path)) {
    return 'skip:' + path;
  }

  const isAuth = (raw) => {
    const t = String(raw || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!t || t.length > 240) return false;
    if (/one-time security code|tap yes|use your passkey|can.?t find an eligible|g\.co\/sc|phone or tablet|eligible device|passkey|sms|text message/i.test(t) &&
        !/authenticator/i.test(t)) return false;
    return /google authenticator/i.test(t) ||
      /authenticator app/i.test(t) ||
      (/authenticator/i.test(t) && /code|verification|app|get/i.test(t)) ||
      (/verification code/i.test(t) && /authenticator/i.test(t)) ||
      (/code from/i.test(t) && /authenticator/i.test(t)) ||
      /^authenticator$/i.test(t);
  };

  const sels = '[data-challengetype="6"], [data-challengeid="6"], [data-challengeid], [data-challengetype], [data-action="selectchallenge"], ' +
    'li[jsname], li, div[role="link"], div[role="button"], button, a[role="link"], a, div[jsname]';
  let cands = Array.from(document.querySelectorAll(sels)).filter((el) => {
    if (!visible(el)) return false;
    const ctype = String(el.getAttribute('data-challengetype') || '');
    const cid = String(el.getAttribute('data-challengeid') || '');
    if (ctype === '6' || cid === '6') return true;
    const label = el.getAttribute('aria-label') || '';
    const own = txt(el);
    if (own.length > 240) return false;
    return isAuth(label) || isAuth(own);
  });
  cands.sort((a, b) => txt(a).length - txt(b).length);
  if (cands[0]) {
    const el = cands[0].closest('[data-challengeid], [data-challengetype], [data-action="selectchallenge"], li, [role="link"], [role="button"], button, a') || cands[0];
    click(el);
    const r = el.getBoundingClientRect();
    return JSON.stringify({ hit: 'auth-app', label: txt(el).slice(0, 60), x: r.left + r.width/2, y: r.top + r.height/2 });
  }

  try {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = (node.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 160) continue;
      if (!/authenticator/i.test(t)) continue;
      if (!isAuth(t) && !/google authenticator/i.test(t)) continue;
      let el = node.parentElement;
      for (let i = 0; i < 12 && el; i++) {
        if (el.matches && el.matches('[data-challengeid], [data-challengetype], [data-action], [role="link"], [role="button"], li, button, a')) {
          if (visible(el)) {
            click(el);
            const r = el.getBoundingClientRect();
            return JSON.stringify({ hit: 'auth-text', label: t.slice(0, 60), x: r.left + r.width/2, y: r.top + r.height/2 });
          }
        }
        el = el.parentElement;
      }
    }
  } catch (e) {}
  return 'none:' + path;
})()
""".trimIndent()
        flowView.evaluateJavascript(script) { result ->
            Log.i(TAG, "2FA selection: $result")
            val hit = result != null && (
                result.contains("auth-app") ||
                    result.contains("auth-text") ||
                    result.contains("try-another")
                )
            if (hit) {
                try {
                    var cleaned = result?.trim()?.trim('"') ?: ""
                    cleaned = cleaned.replace("\\\"", "\"")
                    if (cleaned.startsWith("{")) {
                        val o = JSONObject(cleaned)
                        val x = o.optDouble("x", 0.0)
                        val y = o.optDouble("y", 0.0)
                        if (x > 2 && y > 2) dispatchFlowClick(x, y)
                    }
                } catch (_: Exception) {
                }
                scope.launch {
                    delay(350)
                    val still = flowView.url ?: return@launch
                    if (isGoogle2faNavUrl(still)) {
                        flowView.evaluateJavascript(
                            """
                            (() => {
                              const els = Array.from(document.querySelectorAll('[data-challengetype="6"], [data-challengeid], li, div[role="link"], button, a'));
                              const el = els.find(e => {
                                const t = ((e.innerText||'')+(e.getAttribute('aria-label')||'')+(e.getAttribute('data-challengetype')||''));
                                return t === '6' || /authenticator/i.test(t);
                              });
                              if (!el) return null;
                              try { el.click(); } catch (e) {}
                              const r = el.getBoundingClientRect();
                              return JSON.stringify({ x: r.left + r.width/2, y: r.top + r.height/2 });
                            })()
                            """.trimIndent()
                        ) { coords ->
                            try {
                                var cleaned = coords?.trim()?.trim('"') ?: return@evaluateJavascript
                                if (cleaned == "null" || cleaned.isBlank()) return@evaluateJavascript
                                cleaned = cleaned.replace("\\\"", "\"")
                                val o = JSONObject(cleaned)
                                dispatchFlowClick(o.optDouble("x"), o.optDouble("y"))
                            } catch (e: Exception) {
                                Log.w(TAG, "2FA coord click parse: ${e.message}")
                            }
                        }
                    }
                }
            }
            val gen = selectionLoopGen.incrementAndGet()
            scope.launch {
                delay(650)
                if (gen != selectionLoopGen.get()) return@launch
                val cur = flowView.url ?: return@launch
                if (isGoogle2faNavUrl(cur)) driveGoogle2faSelection(cur)
            }
        }
    }

    private fun injectGoogleAutofillOnce(emailRaw: String, passwordRaw: String) {
        val src = flowView.url ?: return
        if (!src.contains("accounts.google.com", true)) return
        val email = jsString(emailRaw)
        val password = jsString(passwordRaw)
        val code = """
(() => {
  const email = $email;
  const password = $password;
  if (!email) return { ok:false, reason:'no-email' };
  window.__flowHostCreds = { email, password };
  const st = window.__flowHostAuto = window.__flowHostAuto || {};
  const path = location.pathname || '';
  const stepKey = path.split('/').slice(0, 5).join('/');
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden';
  };
  const fill = (el, val) => {
    if (!el || !val) return false;
    if ((el.value || '') === val || (el.value || '').toLowerCase() === String(val).toLowerCase()) return true;
    try { el.removeAttribute('readonly'); el.readOnly = false; } catch (e) {}
    try { el.focus(); } catch (e) {}
    const proto = window.HTMLInputElement && window.HTMLInputElement.prototype;
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    const setter = desc && desc.set;
    if (setter) setter.call(el, val); else el.value = val;
    try { el.dispatchEvent(new InputEvent('input', { bubbles:true, cancelable:true, data:val, inputType:'insertText' })); }
    catch (e) { el.dispatchEvent(new Event('input', { bubbles:true })); }
    el.dispatchEvent(new Event('change', { bubbles:true }));
    return (el.value || '') === val || (el.value || '').toLowerCase() === String(val).toLowerCase();
  };
  const skipAutoNext = ${if (DISABLE_GOOGLE_AUTO_NEXT) "true" else "false"};
  const clickNextFor = (kind) => {
    if (skipAutoNext) return false;
    let next = null;
    if (kind === 'password') {
      next = document.querySelector('#passwordNext button, #passwordNext');
    } else if (kind === 'identifier') {
      next = document.querySelector('#identifierNext button, #identifierNext');
    }
    if (!next || !visible(next)) {
      next = Array.from(document.querySelectorAll('button')).find(b => /^\s*next\s*$/i.test((b.innerText || b.textContent || '')));
    }
    if (!next || !visible(next)) return false;
    try { next.removeAttribute('disabled'); next.setAttribute('aria-disabled','false'); } catch (e) {}
    try { next.click(); } catch (e) {}
    return true;
  };
  try {
    const ol = document.getElementById('__flow_host_ol__');
    if (ol) ol.remove();
    const ols = document.getElementById('__flow_host_ol_style__');
    if (ols) ols.remove();
  } catch (e) {}

  const pageTxt = ((document.body && document.body.innerText) || '').slice(0, 1500);
  const totpEl = document.querySelector('input[name="totpPin"], input#totpPin, input[autocomplete="one-time-code"]');
  const onTotp = /\/challenge\/totp/i.test(path) ||
    (totpEl && visible(totpEl)) ||
    (/Google Authenticator|2-Step Verification/i.test(pageTxt) && /Enter code|verification code/i.test(pageTxt));
  if (onTotp) {
    // Never touch email/password while OTP UI is showing — that causes pwd↔otp bounce
    return { ok:true, step:'totp-wait' };
  }

  const onPwdPath = /\/challenge\/pwd/i.test(path);
  const pwd = Array.from(document.querySelectorAll('input[name="Passwd"], input[type="password"], input[autocomplete*="current-password"]')).find(el => visible(el));
  if (pwd && password && (onPwdPath || !document.querySelector('input#identifierId'))) {
    const pwdKey = 'pwd:' + stepKey;
    if (st[pwdKey] === 'submitted') return { ok:true, step:'password-done' };
    const already = (pwd.value || '') === password;
    const ok = already || fill(pwd, password);
    if (ok && st[pwdKey] !== 'filled' && st[pwdKey] !== 'submitted') {
      st[pwdKey] = 'filled';
      if (!skipAutoNext) {
        setTimeout(() => {
          if (st[pwdKey] === 'submitted') return;
          if (!pwd.isConnected) return;
          if ((pwd.value || '') !== password) return;
          if (document.querySelector('input[name="totpPin"], input#totpPin')) return;
          if (clickNextFor('password')) st[pwdKey] = 'submitted';
        }, 700);
      }
    }
    return { ok, step: skipAutoNext ? 'password-filled-manual-next' : 'password', already };
  }

  // SPA lag: URL already /challenge/pwd but password input not mounted — do not re-submit email
  if (onPwdPath) return { ok:false, reason:'awaiting-password', path };

  const em = document.querySelector('input#identifierId, input[type="email"], input[name="identifier"], input[autocomplete="username"]');
  if (em && visible(em) && email) {
    const emKey = 'email:' + stepKey;
    if (st[emKey] === 'submitted') return { ok:true, step:'email-done' };
    const already = (em.value || '').toLowerCase() === email.toLowerCase();
    const ok = already || fill(em, email);
    if (ok && st[emKey] !== 'filled' && st[emKey] !== 'submitted') {
      st[emKey] = 'filled';
      if (!skipAutoNext) {
        setTimeout(() => {
          if (st[emKey] === 'submitted') return;
          if (!em.isConnected) return;
          if (/\/challenge\/pwd/i.test(location.pathname)) return;
          if ((em.value || '').toLowerCase() !== email.toLowerCase()) return;
          if (clickNextFor('identifier')) st[emKey] = 'submitted';
        }, 700);
      }
    }
    return { ok, step: skipAutoNext ? 'email-filled-manual-next' : 'email', already };
  }
  return { ok:false, reason:'no-field', path };
})()
""".trimIndent()
        flowView.evaluateJavascript(code, null)
    }

    private fun postToShell(payload: JSONObject) {
        if (!shellReady) return
        val json = JSONObject.quote(payload.toString())
        runOnUiThread {
            shellView.evaluateJavascript(
                "(function(){try{if(window.__flowDeliverHostMessage)window.__flowDeliverHostMessage(JSON.parse($json));}catch(e){}})();",
                null
            )
        }
    }

    private fun postToFlow(payload: JSONObject) {
        if (!flowReady) return
        val json = JSONObject.quote(payload.toString())
        runOnUiThread {
            flowView.evaluateJavascript(
                "(function(){try{if(window.__flowDeliverHostMessage)window.__flowDeliverHostMessage(JSON.parse($json));}catch(e){}})();",
                null
            )
        }
    }

    private suspend fun evaluateFlowAsync(code: String): Any? {
        return kotlinx.coroutines.suspendCancellableCoroutine { cont ->
            flowView.evaluateJavascript(code) { result ->
                try {
                    if (result == null || result == "null") {
                        cont.resume(null, null)
                    } else {
                        val trimmed = result.trim()
                        val value: Any? = when {
                            trimmed.startsWith("{") || trimmed.startsWith("[") ->
                                try {
                                    if (trimmed.startsWith("[")) JSONArray(trimmed) else JSONObject(trimmed)
                                } catch (_: Exception) {
                                    org.json.JSONTokener(trimmed).nextValue()
                                }
                            else -> {
                                try {
                                    org.json.JSONTokener(trimmed).nextValue()
                                } catch (_: Exception) {
                                    trimmed.trim('"')
                                }
                            }
                        }
                        cont.resume(value, null)
                    }
                } catch (_: Exception) {
                    cont.resume(result, null)
                }
            }
        }
    }

    private fun jsString(value: String?): String {
        if (value == null) return "''"
        return "'" + value
            .replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace("\r", "\\r")
            .replace("\n", "\\n")
            .replace("\u2028", "\\u2028")
            .replace("\u2029", "\\u2029") + "'"
    }
}

/** Clears WebView DOM/HTML5 storage without requiring API-specific imports in MainActivity. */
object WebStorageClearHelper {
    fun clear(webView: WebView) {
        try {
            android.webkit.WebStorage.getInstance().deleteAllData()
        } catch (_: Exception) {
        }
        try {
            webView.clearCache(true)
        } catch (_: Exception) {
        }
    }
}
