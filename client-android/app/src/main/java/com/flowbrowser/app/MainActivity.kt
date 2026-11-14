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
import android.provider.OpenableColumns
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
import android.webkit.WebResourceResponse
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
import java.io.BufferedInputStream
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
        var target = (window.__flowCredTarget || (window.__flowHostCreds && window.__flowHostCreds.targetUrl) || 'https://flow.google.com/');
        try { location.replace(target); } catch (e) { location.href = target; }
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
    private val zexTtsService by lazy { ZexTtsService(this) }

    private val scope = CoroutineScope(Dispatchers.Main + Job())
    private var shellMode = "full"
    private var lastLayoutChromePx = 0
    /** Only allow chrome (split) layout after Flow has been navigated at least once. */
    private var flowEverOpened = false
    private var flowCredEmail: String? = null
    private var flowCredPassword: String? = null
    private var flowCredTarget: String? = null
    private var flowCredImageOnly: Boolean = false
    private var activeFlowServerId: String = ""
    private var flowCredServerId: String = ""
    private var activeCookieServerId: String = ""
    @Volatile
    private var switchingCookieProfile: Boolean = false
    @Volatile
    private var lastTargetFlowUrl: String = ""
    private val serverCookieSnapshots = ConcurrentHashMap<String, Map<String, List<String>>>()
    private val workspaceReadyGeneration = AtomicInteger(0)
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
    /** Google Flow / Gemini / ZexTTS "upload from device" — WebView file input callback. */
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var pendingGalleryMultiple = false
    private var pendingGalleryImage = true
    private var pendingGalleryVideo = true
    private var pendingFileAcceptTypes: List<String> = emptyList()
    private var pendingUseUniversalFilePicker: Boolean = false
    private val uploadSeq = AtomicInteger(0)
    private val pendingBlobDownloads = ConcurrentHashMap<String, PendingBlobDownload>()

    private data class PendingBlobDownload(
        val filename: String,
        val mime: String,
        val temp: File,
        val out: BufferedOutputStream,
        val totalBytes: Long = 0L,
        var receivedBytes: Long = 0L
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
        try {
            val fqbId = resources.getIdentifier("floatingQuickBar", "id", packageName)
            if (fqbId != 0) findViewById<View?>(fqbId)?.visibility = View.GONE
        } catch (_: Exception) {
        }
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
        s.allowFileAccess = true
        s.allowContentAccess = true
        s.mediaPlaybackRequiresUserGesture = false
        s.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        s.cacheMode = WebSettings.LOAD_DEFAULT
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(shellView, true)

        shellView.setBackgroundColor(Color.TRANSPARENT)
        shellView.addJavascriptInterface(ShellBridge(this), "ShellHost")
        shellView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                return handleWebViewFileChooser(webView, filePathCallback, fileChooserParams)
            }
        }
        shellView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                injectPolyfill(shellView, "ShellHost")
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                injectPolyfill(shellView, "ShellHost")
            }

            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                return interceptLocalAppAsset(request) ?: super.shouldInterceptRequest(view, request)
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
        s.allowFileAccess = true
        s.allowContentAccess = true
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
                return handleWebViewFileChooser(webView, filePathCallback, fileChooserParams)
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
                if (u.isNotBlank() && !u.equals("about:blank", ignoreCase = true)) {
                    lastTargetFlowUrl = u
                }
                applyFlowViewport(u)
                // Never inject bridge/automation into Google auth — triggers secure-browser blocks
                if (!isGoogleAuthRelatedUrl(u) && !isGoogleRecaptchaChallengeUrl(u)) {
                    injectPolyfill(flowView, "FlowHost")
                    pushImageOnlyModeToFlow()
                }
                postFlowUrl(u, "did-start-loading")
                updateAuthOverlayFromUrl(u)
                ensureCaptchaProbeTimer()
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                val u = flowView.url ?: url ?: view?.url ?: ""
                if (u.isNotBlank() && !u.equals("about:blank", ignoreCase = true)) {
                    lastTargetFlowUrl = u
                }
                if (!isGoogleAuthRelatedUrl(u) && !isGoogleRecaptchaChallengeUrl(u)) {
                    injectPolyfill(flowView, "FlowHost")
                    pushImageOnlyModeToFlow()
                }
                applyFlowViewport(u)
                postFlowUrl(u, "did-navigate")
                postFlowUrl(u, "did-finish-load")
                postFlowUrl(u, "dom-ready")
                updateAuthOverlayFromUrl(u)
                if (isFlowWorkspaceUrl(u) && !isGoogleAuthRelatedUrl(u)) {
                    verifyAndCompleteWorkspaceLoad(u, workspaceReadyGeneration.incrementAndGet())
                    val curSid = activeCookieServerId.ifBlank { activeFlowServerId }
                    if (curSid.isNotBlank() && !switchingCookieProfile) {
                        snapshotLiveCookiesForServer(curSid)
                    }
                }
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
                if (!isGoogleAuthRelatedUrl(u) && !isGoogleRecaptchaChallengeUrl(u)) {
                    pushImageOnlyModeToFlow()
                }
                applyFlowViewport(u)
                // Always push live URL to shell; throttle heavy autofill so SPA ticks
                // cannot re-submit password while OTP is mounting.
                postFlowUrl(u, "did-navigate-in-page")
                updateAuthOverlayFromUrl(u)
                if (isFlowWorkspaceUrl(u) && !isGoogleAuthRelatedUrl(u)) {
                    verifyAndCompleteWorkspaceLoad(u, workspaceReadyGeneration.incrementAndGet())
                }
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
            ): WebResourceResponse? {
                interceptLocalAppAsset(request)?.let { return it }
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

        setupFlowLoadListeners()
    }

    private fun setupFlowLoadListeners() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return
        // Register FlowHost bridge polyfill & blob download hook across all FlowView origins
        WebViewCompat.addDocumentStartJavaScript(
            flowView,
            BridgePolyfill.script("FlowHost"),
            setOf("*")
        )
        // Lock viewport to 538px CSS width ONLY on Flow / labs.google
        val flowOnlyOrigins = setOf(
            "https://flow.google.com",
            "https://*.flow.google.com",
            "https://labs.google",
            "https://*.labs.google"
        )
        WebViewCompat.addDocumentStartJavaScript(flowView, FLOW_VIEWPORT_JS, flowOnlyOrigins)
        // Run flow-inject.js on Flow, labs.google, Gemini, and Google Auth
        val flowAndGeminiOrigins = setOf(
            "https://flow.google.com",
            "https://*.flow.google.com",
            "https://labs.google",
            "https://*.labs.google",
            "https://gemini.google.com",
            "https://*.gemini.google.com",
            "https://accounts.google.com",
            "https://*.accounts.google.com",
            "https://accounts.youtube.com"
        )
        if (flowInjectScript.isNotBlank()) {
            WebViewCompat.addDocumentStartJavaScript(flowView, flowInjectScript, flowAndGeminiOrigins)
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

    /** Intercept https://app.flowbrowser.localhost/... and https://flowbrowser.local/... from assets/www/. */
    private fun interceptLocalAppAsset(request: WebResourceRequest?): WebResourceResponse? {
        val uri = request?.url ?: return null
        val host = (uri.host ?: "").lowercase()
        if (host != "app.flowbrowser.localhost" && host != "flowbrowser.local") return null
        var relPath = (uri.path ?: "/").trimStart('/')
        if (relPath.isEmpty()) relPath = "ui/app-shell.html"
        return try {
            val stream = assets.open("www/$relPath")
            val mime = when {
                relPath.endsWith(".html", true) -> "text/html"
                relPath.endsWith(".js", true) || relPath.endsWith(".mjs", true) -> "application/javascript"
                relPath.endsWith(".css", true) -> "text/css"
                relPath.endsWith(".json", true) -> "application/json"
                relPath.endsWith(".svg", true) -> "image/svg+xml"
                relPath.endsWith(".png", true) -> "image/png"
                relPath.endsWith(".jpg", true) || relPath.endsWith(".jpeg", true) -> "image/jpeg"
                relPath.endsWith(".webp", true) -> "image/webp"
                relPath.endsWith(".woff2", true) -> "font/woff2"
                relPath.endsWith(".woff", true) -> "font/woff"
                relPath.endsWith(".ttf", true) -> "font/ttf"
                relPath.endsWith(".mp3", true) -> "audio/mpeg"
                relPath.endsWith(".wav", true) -> "audio/wav"
                else -> "application/octet-stream"
            }
            WebResourceResponse(
                mime,
                "UTF-8",
                200,
                "OK",
                mapOf(
                    "Access-Control-Allow-Origin" to "*",
                    "Access-Control-Allow-Methods" to "GET, HEAD, OPTIONS",
                    "Access-Control-Allow-Headers" to "*",
                    "Cache-Control" to "no-store"
                ),
                stream
            )
        } catch (e: Exception) {
            Log.w(TAG, "Local asset not found: www/$relPath (${e.message})")
            null
        }
    }

    /** Flow workspace only — lock CSS layout width to 538px and scale to fill the WebView; reset scale on Gemini & ZexTTS. */
    private fun applyFlowViewport(url: String) {
        val u = url.ifBlank { lastTargetFlowUrl.ifBlank { flowView.url ?: "" } }.lowercase()
        val s = flowView.settings
        if (u.contains("flow.google.com") || u.contains("labs.google")) {
            s.useWideViewPort = true
            s.loadWithOverviewMode = true
            s.builtInZoomControls = true
            s.setSupportZoom(true)
            flowView.evaluateJavascript(FLOW_VIEWPORT_JS, null)
            applyFlowLayoutScale()
        } else if (
            u.contains("gemini.google.com") ||
                u.contains("bard.google.com") ||
                u.contains("aistudio.google.com") ||
                u.contains("app.flowbrowser.localhost") ||
                u.contains("flowbrowser.local") ||
                u.contains("/zextts/") ||
                u.contains("127.0.0.1")
        ) {
            s.useWideViewPort = false
            s.loadWithOverviewMode = false
            s.builtInZoomControls = false
            s.setSupportZoom(false)
            lastFlowScalePct = 0
            flowView.setInitialScale(0)
            if (u.contains("zextts") || u.contains("app.flowbrowser.localhost") || u.contains("flowbrowser.local")) {
                flowView.evaluateJavascript(
                    "(function(){try{var m=document.querySelector('meta[name=\"viewport\"]');if(!m){m=document.createElement('meta');m.name='viewport';document.head.appendChild(m);}m.setAttribute('content','width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');}catch(e){}})();",
                    null
                )
            }
        }
    }

    private fun applyFlowLayoutScale() {
        val u = (lastTargetFlowUrl.ifBlank { flowView.url ?: "" }).lowercase()
        if (!u.contains("flow.google.com") && !u.contains("labs.google")) {
            if (
                u.contains("gemini.google.com") ||
                    u.contains("bard.google.com") ||
                    u.contains("aistudio.google.com") ||
                    u.contains("app.flowbrowser.localhost") ||
                    u.contains("flowbrowser.local") ||
                    u.contains("/zextts/") ||
                    u.contains("127.0.0.1")
            ) {
                flowView.settings.useWideViewPort = false
                flowView.settings.loadWithOverviewMode = false
                if (lastFlowScalePct != 0) {
                    lastFlowScalePct = 0
                    flowView.setInitialScale(0)
                }
            }
            return
        }
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
            val resolvedUrl = url.trim()
            if (resolvedUrl.isNotBlank() && !resolvedUrl.equals("about:blank", ignoreCase = true)) {
                lastTargetFlowUrl = resolvedUrl
            }
            applyFlowViewport(resolvedUrl)
            // Strip WebView APK id on the initial navigation into Google / Flow / Gemini
            flowView.loadUrl(resolvedUrl, FLOW_EXTRA_HEADERS)
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
            val target = flowCredTarget?.ifBlank { null } ?: "https://flow.google.com/"
            val continueUrl = Uri.encode(target)
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
                val msgType = root.optString("type")
                if (msgType == "zextts-invoke") {
                    val id = root.opt("id")?.toString() ?: "0"
                    val cmd = root.optString("cmd")
                    val payload = root.optJSONObject("payload")
                    zexTtsService.handleInvoke(
                        id = id,
                        cmd = cmd,
                        payload = payload,
                        sendToFlow = { rawJson -> postRawToFlow(rawJson) },
                        onFileSaved = { savedPath, _ ->
                            val name = File(savedPath).name
                            runOnUiThread {
                                notifyDownloadCompleted(name, savedPath)
                                Toast.makeText(
                                    this@MainActivity,
                                    "Saved audio: $name",
                                    Toast.LENGTH_SHORT
                                ).show()
                            }
                        }
                    )
                    return@runOnUiThread
                }
                if (msgType != "toHost") return@runOnUiThread
                val channel = root.optString("channel")
                val data = root.opt("data")

                if (channel.equals("request-credentials", true)) {
                    pushCredentialsToFlow()
                    pushImageOnlyModeToFlow()
                } else if (channel.equals("cdp-click", true) && data is JSONObject) {
                    val x = data.optDouble("x", 0.0)
                    val y = data.optDouble("y", 0.0)
                    dispatchFlowClick(x, y)
                } else if (channel.equals("auth:captcha", true) && data is JSONObject) {
                    val active = data.optBoolean("active", false)
                    if (active) {
                        if (!totpAutoActive || isGoogleRecaptchaChallengeUrl(flowView.url)) {
                            captchaActive = true
                            authLoginActive = true
                            onGoogleAuth = true
                            applyAuthOverlayState()
                        }
                    } else if (captchaActive) {
                        captchaActive = false
                        applyAuthOverlayState()
                        tryHostGoogleAutofill(flowView.url)
                    }
                } else if (channel.equals("auth:auto-login", true) && data is JSONObject) {
                    val st = data.optString("status")
                    if (st == "starting" || st == "filling-email" || st == "filling-password" ||
                        st == "selecting-2fa" || st == "waiting-otp"
                    ) {
                        authLoginActive = true
                        onGoogleAuth = true
                        applyAuthOverlayState()
                    }
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

    private fun pushCredentialsToFlow() {
        val email = flowCredEmail
        if (email.isNullOrBlank()) return
        val effSid = flowCredServerId.ifBlank { activeFlowServerId }
        val payload = JSONObject()
            .put("email", email)
            .put("password", flowCredPassword ?: "")
            .put("targetUrl", flowCredTarget ?: "https://flow.google.com/")
            .put("imageOnly", flowCredImageOnly)
            .put("serverId", effSid)
        postToFlow(
            JSONObject()
                .put("type", "toGuest")
                .put("channel", "apply-credentials")
                .put("data", payload)
        )
    }

    private fun pushImageOnlyModeToFlow() {
        val sidLit = JSONObject.quote(flowCredServerId.ifBlank { activeFlowServerId })
        val targetLit = JSONObject.quote(flowCredTarget ?: "https://flow.google.com/")
        flowView.evaluateJavascript(
            "(function(){try{window.__flowCredTarget=$targetLit;if(typeof window.__flowSetImageOnlyMode==='function')window.__flowSetImageOnlyMode($flowCredImageOnly,$sidLit);}catch(e){}})();",
            null
        )
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
                if (channel.equals("apply-credentials", true) && data is JSONObject) {
                    val em = data.optString("email")
                    val pw = data.optString("password")
                    val tg = data.optString("targetUrl")
                    if (em.isNotBlank()) flowCredEmail = em
                    if (pw.isNotBlank()) flowCredPassword = pw
                    if (tg.isNotBlank()) flowCredTarget = tg
                    if (data.has("imageOnly")) flowCredImageOnly = data.optBoolean("imageOnly", false)
                    val sid = data.optString("serverId")
                    if (sid.isNotBlank()) {
                        flowCredServerId = sid
                        if (activeFlowServerId.isBlank()) activeFlowServerId = sid
                    }
                    data.put("imageOnly", flowCredImageOnly)
                    data.put("serverId", flowCredServerId.ifBlank { activeFlowServerId })
                    pushImageOnlyModeToFlow()
                    tryHostGoogleAutofill(flowView.url)
                }
                postToFlow(
                    JSONObject()
                        .put("type", "toGuest")
                        .put("channel", channel)
                        .put("data", data ?: JSONObject.NULL)
                )
            }
            "setFlowCreds" -> {
                val em = root.optString("email")
                val pw = root.optString("password")
                val tg = root.optString("targetUrl")
                if (em.isNotBlank()) flowCredEmail = em
                if (pw.isNotBlank()) flowCredPassword = pw
                if (tg.isNotBlank()) flowCredTarget = tg
                if (root.has("imageOnly")) flowCredImageOnly = root.optBoolean("imageOnly", false)
                val sid = root.optString("serverId")
                if (sid.isNotBlank()) {
                    flowCredServerId = sid
                    if (activeFlowServerId.isBlank()) activeFlowServerId = sid
                }
                pushCredentialsToFlow()
                pushImageOnlyModeToFlow()
                tryHostGoogleAutofill(flowView.url)
            }
            "openDownloadedFile" -> {
                val path = root.optString("filePath").ifBlank { root.optString("savePath") }
                val mime = root.optString("mimeType")
                if (path.isNotBlank()) openDownloadedFile(path, mime)
            }
            "showInFolder" -> {
                val path = root.optString("filePath").ifBlank { root.optString("savePath") }
                openInFolder(path)
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
                val path = payload.optString("filePath").ifBlank { payload.optString("savePath") }
                openInFolder(path)
                JSONObject().put("success", true)
            }
            "openDownloadedFile" -> {
                val path = payload.optString("filePath").ifBlank { payload.optString("savePath") }
                val mime = payload.optString("mimeType")
                val ok = openDownloadedFile(path, mime)
                JSONObject().put("success", ok)
            }
            "executeFlow" -> {
                val code = payload.optString("code", "null")
                evaluateFlowAsync(code)
            }
            "credSetServerTime" -> {
                val st = payload.optLong("serverTime", 0L)
                if (st > 0L) {
                    serverClockOffsetMs = st - System.currentTimeMillis()
                }
                JSONObject().put("success", true)
            }
            "switchFlowCookieProfile" -> {
                switchFlowCookieProfileImpl(payload)
            }
            "getDeviceId" -> {
                createClientAttestation()
            }
            else -> throw IllegalArgumentException("Unknown command: $cmd")
        }
    }

    private val cookieProfileUrls = listOf(
        "https://.google.com",
        "https://accounts.google.com",
        "https://flow.google.com",
        "https://labs.google",
        "https://gemini.google.com",
        "https://accounts.youtube.com"
    )

    private fun hasGoogleAuthSessionCookies(snapshot: Map<String, List<String>>?): Boolean {
        if (snapshot.isNullOrEmpty()) return false
        return snapshot.values.flatten().any { c ->
            c.contains("SID=") || c.contains("__Secure-1PSID=") || c.contains("__Host-GAPS=")
        }
    }

    private fun saveCookieSnapshotToPrefs(serverId: String, snapshot: Map<String, List<String>>) {
        try {
            val root = JSONObject()
            for ((url, list) in snapshot) {
                val arr = JSONArray()
                list.forEach { arr.put(it) }
                root.put(url, arr)
            }
            getSharedPreferences("flow_cookie_profiles", MODE_PRIVATE)
                .edit()
                .putString("srv_$serverId", root.toString())
                .apply()
        } catch (_: Exception) {
        }
    }

    private fun loadCookieSnapshotFromPrefs(serverId: String): Map<String, List<String>>? {
        return try {
            val raw = getSharedPreferences("flow_cookie_profiles", MODE_PRIVATE)
                .getString("srv_$serverId", null) ?: return null
            val root = JSONObject(raw)
            val map = mutableMapOf<String, List<String>>()
            val keys = root.keys()
            while (keys.hasNext()) {
                val k = keys.next()
                val arr = root.optJSONArray(k) ?: continue
                val list = mutableListOf<String>()
                for (i in 0 until arr.length()) {
                    val v = arr.optString(i)
                    if (v.isNotBlank()) list.add(v)
                }
                if (list.isNotEmpty()) map[k] = list
            }
            map.ifEmpty { null }
        } catch (_: Exception) {
            null
        }
    }

    private fun snapshotLiveCookiesForServer(serverId: String) {
        if (serverId.isBlank() || switchingCookieProfile) return
        try {
            val cm = CookieManager.getInstance()
            val snap = mutableMapOf<String, List<String>>()
            for (u in cookieProfileUrls) {
                val raw = cm.getCookie(u) ?: continue
                val parts = raw.split(";")
                    .map { it.trim() }
                    .filter { it.isNotEmpty() && it.contains("=") }
                if (parts.isNotEmpty()) {
                    snap[u] = parts
                }
            }
            if (hasGoogleAuthSessionCookies(snap)) {
                serverCookieSnapshots[serverId] = snap
                saveCookieSnapshotToPrefs(serverId, snap)
            }
        } catch (_: Exception) {
        }
    }

    private suspend fun switchFlowCookieProfileImpl(payload: JSONObject): JSONObject {
        switchingCookieProfile = true
        try {
            val toServerId = payload.optString("toServerId", payload.optString("serverId", "")).trim()
            val fromServerId = payload.optString("fromServerId", activeCookieServerId).trim()
                .ifBlank { activeCookieServerId.ifBlank { activeFlowServerId } }
            val cm = CookieManager.getInstance()

            if (toServerId.isNotEmpty() && toServerId == activeCookieServerId) {
                val liveAuth = cookieProfileUrls.any { u ->
                    val c = cm.getCookie(u) ?: ""
                    c.contains("SID=") || c.contains("__Secure-1PSID=")
                }
                if (liveAuth) {
                    activeFlowServerId = toServerId
                    flowCredServerId = toServerId
                    return JSONObject().put("success", true).put("restored", true).put("sameServer", true)
                }
            }

            // 1. Snapshot outgoing server's cookies if it has an active Google session
            if (fromServerId.isNotEmpty()) {
                val snap = mutableMapOf<String, List<String>>()
                for (u in cookieProfileUrls) {
                    val raw = cm.getCookie(u) ?: continue
                    val parts = raw.split(";")
                        .map { it.trim() }
                        .filter { it.isNotEmpty() && it.contains("=") }
                    if (parts.isNotEmpty()) {
                        snap[u] = parts
                    }
                }
                if (hasGoogleAuthSessionCookies(snap)) {
                    serverCookieSnapshots[fromServerId] = snap
                    saveCookieSnapshotToPrefs(fromServerId, snap)
                    Log.i(TAG, "Saved Google cookie snapshot for server=$fromServerId (${snap.size} origins)")
                }
            }

            // 2. Clear all live cookies in WebView before switching to target server
            kotlinx.coroutines.suspendCancellableCoroutine<Unit> { cont ->
                runOnUiThread {
                    try {
                        cm.removeAllCookies {
                            try { cm.flush() } catch (_: Exception) {}
                            if (cont.isActive) cont.resume(Unit, null)
                        }
                    } catch (_: Exception) {
                        if (cont.isActive) cont.resume(Unit, null)
                    }
                }
            }

            activeCookieServerId = toServerId
            activeFlowServerId = toServerId
            flowCredServerId = toServerId

            // 3. Restore target server's cookie snapshot if available
            val targetSnap = if (toServerId.isNotEmpty()) {
                serverCookieSnapshots[toServerId] ?: loadCookieSnapshotFromPrefs(toServerId)?.also {
                    serverCookieSnapshots[toServerId] = it
                }
            } else null

            if (hasGoogleAuthSessionCookies(targetSnap) && targetSnap != null) {
                for ((u, pairs) in targetSnap) {
                    val host = try { Uri.parse(u).host ?: ".google.com" } catch (_: Exception) { ".google.com" }
                    val domainAttr = if (host.startsWith(".")) host else if (host == "google.com") ".google.com" else host
                    for (pair in pairs) {
                        val setCookieStr = if (domainAttr.startsWith(".")) {
                            "$pair; Domain=$domainAttr; Path=/; Secure"
                        } else {
                            "$pair; Path=/; Secure"
                        }
                        cm.setCookie(u, setCookieStr)
                    }
                }
                try { cm.flush() } catch (_: Exception) {}
                Log.i(TAG, "Restored Google cookie snapshot for server=$toServerId")
                return JSONObject().put("success", true).put("restored", true)
            }

            Log.i(TAG, "No saved cookie snapshot for server=$toServerId — clean Google sign-in required")
            return JSONObject().put("success", true).put("restored", false)
        } finally {
            switchingCookieProfile = false
        }
    }

    @Volatile
    private var serverClockOffsetMs: Long = 0L

    /** Reconstruct 32-byte master seed via XOR mask for v11 cryptographic attestation */
    private fun deriveMasterSeed(): ByteArray {
        val mask = intArrayOf(
            0x93, 0x4A, 0xE7, 0x12, 0xC8, 0x55, 0x3B, 0xF0,
            0x6D, 0xA1, 0x29, 0x84, 0x7E, 0xDF, 0x16, 0x43,
            0xB2, 0x0C, 0x89, 0xE5, 0x31, 0x74, 0xFA, 0x68,
            0x9C, 0x5E, 0xD0, 0x27, 0x4B, 0xA6, 0x1F, 0x82
        )
        val xored = intArrayOf(
            0xF5, 0x26, 0x88, 0x65, 0x97, 0x16, 0x49, 0x95,
            0x0C, 0xD5, 0x46, 0xF6, 0x53, 0xBE, 0x7F, 0x6E,
            0xC4, 0x3D, 0xB8, 0xBA, 0x52, 0x1B, 0x9E, 0x0D,
            0xEB, 0x37, 0xBA, 0x49, 0x38, 0xC9, 0x71, 0xF1
        )
        val out = ByteArray(32)
        for (i in 0 until 32) {
            out[i] = (mask[i] xor xored[i]).toByte()
        }
        return out
    }

    @Suppress("DEPRECATION")
    private fun apkSigningCertSha256(): String {
        return try {
            val certBytes = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val info = packageManager.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES)
                val sigs = info.signingInfo?.apkContentsSigners ?: info.signingInfo?.signingCertificateHistory
                sigs?.firstOrNull()?.toByteArray()
            } else {
                val info = packageManager.getPackageInfo(packageName, PackageManager.GET_SIGNATURES)
                info.signatures?.firstOrNull()?.toByteArray()
            } ?: return ""
            val md = java.security.MessageDigest.getInstance("SHA-256")
            md.digest(certBytes).joinToString("") { "%02x".format(it) }
        } catch (_: Exception) {
            ""
        }
    }

    private fun createClientAttestation(): JSONObject {
        val ver = appVersionName()
        val wireVer = "2.7.0"
        val client = "android/$wireVer"
        val deviceId = stableDeviceId()
        val certSha256 = apkSigningCertSha256()
        val expectedCert = "40bfe6b4a46fb01f570fbd33a028d5b0c24d2b5959b33d46978faeccef83208e"
        val debuggerAttached = android.os.Debug.isDebuggerConnected() || android.os.Debug.waitingForDebugger()
        val untampered = !debuggerAttached && certSha256.equals(expectedCert, ignoreCase = true)

        val binHash = if (untampered) {
            "and:" + certSha256.take(32)
        } else {
            "TAMPERED:" + (if (debuggerAttached) "DEBUGGER" else certSha256.take(16))
        }

        val ts = System.currentTimeMillis() + serverClockOffsetMs
        val nonceBytes = ByteArray(16)
        java.security.SecureRandom().nextBytes(nonceBytes)
        val nonce = nonceBytes.joinToString("") { "%02x".format(it) }

        val seed = deriveMasterSeed()
        val suffix = ("|and|" + certSha256.lowercase()).toByteArray(Charsets.UTF_8)
        val combined = ByteArray(seed.size + suffix.size)
        System.arraycopy(seed, 0, combined, 0, seed.size)
        System.arraycopy(suffix, 0, combined, seed.size, suffix.size)
        val signingKey = java.security.MessageDigest.getInstance("SHA-256").digest(combined)

        val payloadStr = "v12|$client|$deviceId|$binHash|$ts|$nonce"
        val mac = javax.crypto.Mac.getInstance("HmacSHA256")
        mac.init(javax.crypto.spec.SecretKeySpec(signingKey, "HmacSHA256"))
        val sigBytes = mac.doFinal(payloadStr.toByteArray(Charsets.UTF_8))
        val signature = Base64.encodeToString(
            sigBytes,
            Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
        )

        return JSONObject()
            .put("deviceId", deviceId)
            .put("client", client)
            .put("version", ver)
            .put("binHash", binHash)
            .put("ts", ts)
            .put("nonce", nonce)
            .put("signature", signature)
    }

    /** App version from the APK (shown in the toolbar and sent as X-Flow-Client). */
    private fun appVersionName(): String = try {
        packageManager.getPackageInfo(packageName, 0).versionName ?: "0.0.0"
    } catch (_: Exception) {
        "0.0.0"
    }

    /**
     * Stable per-install device id for login attestation (server needs 16-128 chars).
     * ANDROID_ID when usable, otherwise a random id persisted once.
     */
    @android.annotation.SuppressLint("HardwareIds")
    private fun stableDeviceId(): String {
        val androidId = try {
            android.provider.Settings.Secure.getString(
                contentResolver,
                android.provider.Settings.Secure.ANDROID_ID
            )
        } catch (_: Exception) {
            null
        }
        if (!androidId.isNullOrBlank() && androidId.length >= 8 && androidId != "9774d56d682e549c") {
            return "and-$androidId"
        }
        val prefs = getSharedPreferences("flow_device", MODE_PRIVATE)
        var id = prefs.getString("id", null)
        if (id.isNullOrBlank()) {
            id = "and-" + java.util.UUID.randomUUID().toString()
            prefs.edit().putString("id", id).apply()
        }
        return id
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
        serverCookieSnapshots.clear()
        activeCookieServerId = ""
        activeFlowServerId = ""
        flowCredServerId = ""
        try {
            getSharedPreferences("flow_cookie_profiles", MODE_PRIVATE).edit().clear().apply()
        } catch (_: Exception) {
        }
        clearGoogleCredsInMemory()
        // Keep sticky Google auth cover pinned during wipe if in workspace/login mode
        // so the browser/login page is never exposed for a few seconds during cookie clearing.
        val keepCoverDuringWipe = shellMode != "full" || authLoginActive || onGoogleAuth
        captchaActive = false
        totpAutoActive = false
        lastHistoryUrl = ""
        if (keepCoverDuringWipe) {
            authLoginActive = true
            onGoogleAuth = true
        } else {
            authLoginActive = false
            onGoogleAuth = false
        }
        applyAuthOverlayState()
        flowView.stopLoading()
        flowView.loadUrl("about:blank")
        flowView.clearHistory()
        flowView.clearCache(true)
        flowView.clearFormData()
        CookieManager.getInstance().apply {
            try {
                removeAllCookies {
                    try { flush() } catch (_: Exception) {}
                }
            } catch (_: Exception) {
            }
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

    /** After login lands on Flow, drop the sticky cover (max 10s so overlay never sticks). */
    private fun scheduleAuthCoverClearOnFlow() {
        flowSettleClearJob?.cancel()
        flowSettleClearJob = scope.launch {
            delay(10_000)
            val cur = flowView.url ?: return@launch
            if (!isFlowWorkspaceUrl(cur)) return@launch
            if (isGoogleAuthRelatedUrl(cur)) return@launch
            Log.i(TAG, "Flow page held 10s after login — clearing sticky auth cover")
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
                // Keep cover up until verifyAndCompleteWorkspaceLoad confirms DOM ready + 650ms settle
                onGoogleAuth = true
                applyAuthOverlayState()
                scheduleAuthCoverClearOnFlow()
                verifyAndCompleteWorkspaceLoad(url ?: "", workspaceReadyGeneration.incrementAndGet())
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

    /**
     * Hold the native auth cover on workspace URLs after Google login until
     * document.readyState === 'complete' and workspace DOM is rendered + 650ms paint-settle delay,
     * matching Windows v8.0.15 so the Google login screen never flashes!
     */
    private fun verifyAndCompleteWorkspaceLoad(url: String, gen: Int) {
        if (!authLoginActive && !totpAutoActive && !onGoogleAuth) return
        if (!isFlowWorkspaceUrl(url) || isGoogleAuthRelatedUrl(url)) return
        scope.launch {
            for (attempt in 0 until 28) {
                if (gen != workspaceReadyGeneration.get()) return@launch
                val cur = flowView.url ?: url
                if (isGoogleAuthRelatedUrl(cur) || isGoogleRecaptchaChallengeUrl(cur)) {
                    // Bounced back to Google auth — keep cover up
                    authLoginActive = true
                    onGoogleAuth = true
                    applyAuthOverlayState()
                    return@launch
                }
                if (!isFlowWorkspaceUrl(cur)) return@launch

                val state = evaluateFlowAsync(
                    """
                    (function(){
                      try {
                        var rs = document.readyState || '';
                        var b = document.body;
                        var len = (b && b.innerHTML) ? b.innerHTML.length : 0;
                        var h = (b && b.getBoundingClientRect) ? b.getBoundingClientRect().height : 0;
                        return (rs === 'complete' && len > 120 && h > 20) ? 'ready' : 'loading';
                      } catch (e) { return 'loading'; }
                    })()
                    """.trimIndent()
                )?.toString() ?: "loading"

                if (state.contains("ready")) {
                    // 650ms paint-settle delay so WebView finishes compositing the workspace frame
                    delay(650)
                    if (gen != workspaceReadyGeneration.get()) return@launch
                    val afterUrl = flowView.url ?: cur
                    if (isFlowWorkspaceUrl(afterUrl) && !isGoogleAuthRelatedUrl(afterUrl)) {
                        Log.i(TAG, "Workspace ready & settled ($afterUrl) — lifting auth cover")
                        clearAuthCoverSession()
                        postToShell(
                            JSONObject()
                                .put("type", "flow-event")
                                .put("event", "ipc-message")
                                .put("channel", "auth:auto-login")
                                .put("args", JSONArray().put(JSONObject().put("status", "completed")))
                        )
                    }
                    return@launch
                }
                delay(300)
            }
        }
    }

    private fun isFlowWorkspaceUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        return try {
            val host = (Uri.parse(url).host ?: "").lowercase()
            host == "flow.google.com" ||
                host.endsWith(".flow.google.com") ||
                host == "labs.google" ||
                host.endsWith(".labs.google") ||
                host == "gemini.google.com" ||
                host.endsWith(".gemini.google.com") ||
                host == "bard.google.com" ||
                host == "aistudio.google.com" ||
                host == "app.flowbrowser.localhost" ||
                host == "flowbrowser.local" ||
                host == "127.0.0.1"
        } catch (_: Exception) {
            val u = url.lowercase()
            u.contains("flow.google.com") ||
                u.contains("labs.google") ||
                u.contains("gemini.google.com") ||
                u.contains("bard.google.com") ||
                u.contains("aistudio.google.com") ||
                u.contains("app.flowbrowser.localhost") ||
                u.contains("flowbrowser.local") ||
                u.contains("127.0.0.1")
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
                path.contains("/challenge/skotp") ||
                path.contains("/challenge/dp") ||
                path.contains("/challenge/iap") ||
                path.contains("/challenge/ootp") ||
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

    private fun openDownloadedFile(pathOrUri: String, mimeHint: String = ""): Boolean {
        if (pathOrUri.isBlank()) return false
        return try {
            val uri: Uri
            val resolvedMime: String
            if (pathOrUri.startsWith("content://", ignoreCase = true)) {
                uri = Uri.parse(pathOrUri)
                resolvedMime = mimeHint.ifBlank { contentResolver.getType(uri) ?: "*/*" }
            } else {
                val cleaned = if (pathOrUri.startsWith("file://", ignoreCase = true)) {
                    Uri.parse(pathOrUri).path ?: pathOrUri.removePrefix("file://")
                } else {
                    pathOrUri
                }
                val file = File(cleaned)
                if (!file.exists()) {
                    Toast.makeText(this, "File not found: ${file.name}", Toast.LENGTH_SHORT).show()
                    return false
                }
                uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
                resolvedMime = mimeHint.ifBlank {
                    guessMimeFromName(file.name).let { if (it == "application/octet-stream") "*/*" else it }
                }
            }
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, resolvedMime.ifBlank { "*/*" })
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(Intent.createChooser(intent, "Open file"))
            true
        } catch (e: Exception) {
            Log.w(TAG, "openDownloadedFile failed ($pathOrUri): ${e.message}")
            try {
                startActivity(Intent(android.app.DownloadManager.ACTION_VIEW_DOWNLOADS))
                true
            } catch (_: Exception) {
                Toast.makeText(this, "Saved: $pathOrUri", Toast.LENGTH_SHORT).show()
                false
            }
        }
    }

    private fun openInFolder(path: String) {
        if (path.isNotBlank()) {
            if (openDownloadedFile(path)) return
        }
        try {
            startActivity(Intent(android.app.DownloadManager.ACTION_VIEW_DOWNLOADS))
        } catch (e: Exception) {
            Log.w(TAG, "openInFolder fallback: ${e.message}")
            Toast.makeText(this, if (path.isNotBlank()) "Saved: $path" else "Check Downloads / Gallery", Toast.LENGTH_SHORT).show()
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
        when {
            url.startsWith("blob:", ignoreCase = true) || url.startsWith("data:", ignoreCase = true) -> {
                downloadBlobViaJs(url, filename, mime)
            }
            url.startsWith("http://", ignoreCase = true) || url.startsWith("https://", ignoreCase = true) -> {
                postToShell(
                    JSONObject()
                        .put("type", "download")
                        .put("phase", "started")
                        .put(
                            "data",
                            JSONObject().put("filename", filename).put("totalBytes", contentLength)
                        )
                )
                downloadHttpToGallery(url, userAgent, filename, mime, contentDisposition)
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
    if (typeof window.__flowStreamBlobToHost === 'function') {
      await window.__flowStreamBlobToHost(url, filename, mimeHint);
      return;
    }
    var blob = (window.__flowBlobStore && window.__flowBlobStore.get(url)) || null;
    if (!blob) {
      var res = await fetch(url);
      blob = await res.blob();
    }
    var mime = (blob && blob.type) || mimeHint || 'application/octet-stream';
    var name = filename;
    if (!name || /^download(\.bin)?$/i.test(name) || /\.bin$/i.test(name)) {
      var ext = 'bin';
      if (/mp4|mpeg4/i.test(mime)) ext = 'mp4';
      else if (/webm/i.test(mime)) ext = 'webm';
      else if (/quicktime/i.test(mime)) ext = 'mov';
      else if (/audio\/mpeg|mp3/i.test(mime)) ext = 'mp3';
      else if (/audio\/wav|wave/i.test(mime)) ext = 'wav';
      else if (/audio\/ogg/i.test(mime)) ext = 'ogg';
      else if (/audio\/mp4|audio\/x-m4a/i.test(mime)) ext = 'm4a';
      else if (/png/i.test(mime)) ext = 'png';
      else if (/jpe?g/i.test(mime)) ext = 'jpg';
      else if (/webp/i.test(mime)) ext = 'webp';
      else if (/gif/i.test(mime)) ext = 'gif';
      else if (/^video\//i.test(mime)) ext = 'mp4';
      else if (/^image\//i.test(mime)) ext = 'png';
      else if (/^audio\//i.test(mime)) ext = 'mp3';
      name = 'flow_' + Date.now() + '.' + ext;
    }
    var buf = await blob.arrayBuffer();
    var bytes = new Uint8Array(buf);
    if (!window.FlowHost || !window.FlowHost.downloadBegin) throw new Error('FlowHost missing');
    window.FlowHost.downloadBegin(id, name, mime, bytes.length);
    var CHUNK = 196608;
    for (var offset = 0; offset < bytes.length; offset += CHUNK) {
      var slice = bytes.subarray(offset, Math.min(offset + CHUNK, bytes.length));
      var binary = '';
      var step = 8192;
      for (var j = 0; j < slice.length; j += step) {
        binary += String.fromCharCode.apply(null, slice.subarray(j, Math.min(j + step, slice.length)));
      }
      window.FlowHost.downloadChunk(id, btoa(binary));
    }
    window.FlowHost.downloadEnd(id);
  } catch (e) {
    try {
      if (window.FlowHost && window.FlowHost.downloadFail) {
        window.FlowHost.downloadFail($idLit, $nameLit, String(e && e.message || e));
      }
    } catch (e2) {}
  }
})();
""".trimIndent()
        flowView.evaluateJavascript(script, null)
    }

    private fun parseContentDispositionFilename(cd: String?): String? {
        if (cd.isNullOrBlank()) return null
        try {
            val utf8Match = Regex("""filename\*\s*=\s*UTF-8''([^;\r\n]+)""", RegexOption.IGNORE_CASE).find(cd)
            if (utf8Match != null) {
                val decoded = Uri.decode(utf8Match.groupValues[1].trim().trim('"', '\''))
                if (decoded.isNotBlank()) return decoded
            }
            val quotedMatch = Regex("""filename\s*=\s*"([^"]+)"""", RegexOption.IGNORE_CASE).find(cd)
            if (quotedMatch != null) {
                val v = quotedMatch.groupValues[1].trim()
                if (v.isNotBlank()) return v
            }
            val plainMatch = Regex("""filename\s*=\s*([^;\r\n]+)""", RegexOption.IGNORE_CASE).find(cd)
            if (plainMatch != null) {
                val v = plainMatch.groupValues[1].trim().trim('"', '\'')
                if (v.isNotBlank()) return v
            }
        } catch (_: Exception) {
        }
        return null
    }

    private fun downloadHttpToGallery(
        url: String,
        userAgent: String,
        filename: String,
        mime: String,
        initialContentDisposition: String = ""
    ) {
        val ua = userAgent.ifBlank { flowView.settings.userAgentString ?: "" }
        val referer = flowView.url ?: "https://flow.google.com/"
        scope.launch(Dispatchers.IO) {
            var conn: HttpURLConnection? = null
            try {
                var currentUrl = url
                var redirects = 0
                while (true) {
                    val uObj = URL(currentUrl)
                    conn = (uObj.openConnection() as HttpURLConnection).apply {
                        instanceFollowRedirects = false
                        connectTimeout = 30000
                        readTimeout = 120000
                        setRequestProperty("User-Agent", ua)
                        val lowerUrl = currentUrl.lowercase()
                        val isPresignedGcs = lowerUrl.contains("storage.googleapis.com") &&
                            (lowerUrl.contains("x-goog-signature=") || lowerUrl.contains("signature="))
                        if (!isPresignedGcs && !lowerUrl.contains("storage.googleapis.com")) {
                            val cookie = CookieManager.getInstance().getCookie(currentUrl)
                                ?: CookieManager.getInstance().getCookie("https://flow.google.com")
                            if (!cookie.isNullOrBlank()) setRequestProperty("Cookie", cookie)
                        }
                        setRequestProperty("Referer", referer)
                        setRequestProperty("Accept", "*/*")
                    }
                    val code = conn.responseCode
                    if (code in listOf(301, 302, 303, 307, 308)) {
                        val loc = conn.getHeaderField("Location")
                        conn.disconnect()
                        if (loc.isNullOrBlank() || redirects >= 8) {
                            throw IllegalStateException("Too many redirects or empty Location (HTTP $code)")
                        }
                        currentUrl = URL(uObj, loc).toString()
                        redirects++
                        continue
                    }
                    if (code !in 200..299) throw IllegalStateException("HTTP $code")
                    break
                }

                val activeConn = conn ?: throw IllegalStateException("Connection failed")
                val resolvedMime = activeConn.contentType?.substringBefore(';')?.trim().orEmpty()
                    .ifBlank { mime }
                val cdHeader = activeConn.getHeaderField("Content-Disposition").orEmpty()
                    .ifBlank { initialContentDisposition }
                val cdName = parseContentDispositionFilename(cdHeader)
                val baseFilename = if (!cdName.isNullOrBlank()) cdName else filename
                val totalLength = if (Build.VERSION.SDK_INT >= 24) {
                    activeConn.contentLengthLong
                } else {
                    activeConn.contentLength.toLong()
                }

                BufferedInputStream(activeConn.inputStream, 65536).use { bis ->
                    bis.mark(64)
                    val header = ByteArray(32)
                    val headerRead = bis.read(header)
                    bis.reset()
                    val headerSlice = if (headerRead > 0) header.copyOf(headerRead) else ByteArray(0)
                    val sniffed = sniffMime(headerSlice) ?: resolvedMime
                    val finalName = sanitizeDownloadFilename(baseFilename, sniffed)
                    val outUri = openGalleryOutput(finalName, sniffed)
                        ?: throw IllegalStateException("MediaStore insert failed")

                    var received = 0L
                    var lastProgressEmit = 0L
                    contentResolver.openOutputStream(outUri)?.use { rawOut ->
                        BufferedOutputStream(rawOut, 65536).use { out ->
                            val buf = ByteArray(65536)
                            while (true) {
                                val n = bis.read(buf)
                                if (n <= 0) break
                                out.write(buf, 0, n)
                                received += n
                                val now = SystemClock.elapsedRealtime()
                                if (now - lastProgressEmit >= 120L) {
                                    lastProgressEmit = now
                                    notifyDownloadProgress(finalName, received, totalLength)
                                }
                            }
                            out.flush()
                        }
                    } ?: throw IllegalStateException("openOutputStream failed")

                    finalizeGalleryPending(outUri)
                    withContext(Dispatchers.Main) {
                        notifyDownloadCompleted(finalName, outUri.toString())
                        Toast.makeText(this@MainActivity, "Saved: $finalName", Toast.LENGTH_SHORT).show()
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "HTTP download failed", e)
                withContext(Dispatchers.Main) { notifyDownloadFailed(filename) }
            } finally {
                try { conn?.disconnect() } catch (_: Exception) {}
            }
        }
    }

    fun onBlobDownloadBegin(id: String, filename: String, mime: String, total: Int) {
        try {
            val cleanName = sanitizeDownloadFilename(filename, mime)
            val temp = File(cacheDir, "flow_dl_$id.bin")
            if (temp.exists()) temp.delete()
            val out = BufferedOutputStream(FileOutputStream(temp), 65536)
            pendingBlobDownloads[id] = PendingBlobDownload(
                filename = cleanName,
                mime = mime,
                temp = temp,
                out = out,
                totalBytes = total.toLong(),
                receivedBytes = 0L
            )
            Log.i(TAG, "Blob download begin $cleanName ($total bytes)")
            runOnUiThread {
                postToShell(
                    JSONObject()
                        .put("type", "download")
                        .put("phase", "started")
                        .put(
                            "data",
                            JSONObject().put("filename", cleanName).put("totalBytes", total.toLong())
                        )
                )
            }
        } catch (e: Exception) {
            Log.e(TAG, "downloadBegin failed", e)
            runOnUiThread { notifyDownloadFailed(filename) }
        }
    }

    fun onBlobDownloadChunk(id: String, base64Chunk: String) {
        val pending = pendingBlobDownloads[id] ?: return
        try {
            val bytes = Base64.decode(base64Chunk, Base64.DEFAULT)
            pending.out.write(bytes)
            pending.receivedBytes += bytes.size
            notifyDownloadProgress(pending.filename, pending.receivedBytes, pending.totalBytes)
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
                    pending.temp.inputStream().use { it.copyTo(out, 65536) }
                } ?: throw IllegalStateException("openOutputStream failed")
                finalizeGalleryPending(outUri)
                pending.temp.delete()
                withContext(Dispatchers.Main) {
                    notifyDownloadCompleted(finalName, outUri.toString())
                    Toast.makeText(
                        this@MainActivity,
                        "Saved: $finalName",
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

    fun onBlobDownloadFail(id: String, filename: String, error: String) {
        Log.e(TAG, "Blob download fail $id ($filename): $error")
        val name = pendingBlobDownloads[id]?.filename ?: filename.ifBlank { "download" }
        cleanupBlobDownload(id, failed = false)
        runOnUiThread { notifyDownloadFailed(name) }
    }

    fun onBlobDownloadFail(id: String, error: String) {
        onBlobDownloadFail(id, "", error)
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
            n.endsWith(".mkv") -> "video/x-matroska"
            n.endsWith(".mp3") -> "audio/mpeg"
            n.endsWith(".wav") -> "audio/wav"
            n.endsWith(".ogg") -> "audio/ogg"
            n.endsWith(".m4a") -> "audio/mp4"
            n.endsWith(".png") -> "image/png"
            n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".jpe") -> "image/jpeg"
            n.endsWith(".webp") -> "image/webp"
            n.endsWith(".gif") -> "image/gif"
            n.endsWith(".heic") || n.endsWith(".hvic") -> "image/heic"
            n.endsWith(".heif") -> "image/heif"
            n.endsWith(".bmp") -> "image/bmp"
            n.endsWith(".tif") || n.endsWith(".tiff") -> "image/tiff"
            n.endsWith(".avif") -> "image/avif"
            n.endsWith(".svg") -> "image/svg+xml"
            n.endsWith(".pdf") -> "application/pdf"
            n.endsWith(".txt") -> "text/plain"
            n.endsWith(".csv") -> "text/csv"
            n.endsWith(".json") -> "application/json"
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
            m == "video/x-matroska" -> "mkv"
            m == "audio/mpeg" || m == "audio/mp3" -> "mp3"
            m == "audio/wav" || m == "audio/x-wav" || m == "audio/wave" -> "wav"
            m == "audio/ogg" || m == "application/ogg" -> "ogg"
            m == "audio/mp4" || m == "audio/x-m4a" || m == "audio/m4a" -> "m4a"
            m == "image/png" -> "png"
            m == "image/jpeg" || m == "image/jpg" -> "jpg"
            m == "image/webp" -> "webp"
            m == "image/gif" -> "gif"
            m == "image/heic" -> "heic"
            m == "image/heif" -> "heif"
            m == "image/bmp" || m == "image/x-ms-bmp" -> "bmp"
            m == "image/tiff" -> "tiff"
            m == "image/avif" -> "avif"
            m == "image/svg+xml" -> "svg"
            m == "application/pdf" -> "pdf"
            m == "text/plain" -> "txt"
            m == "text/csv" -> "csv"
            m == "application/json" -> "json"
            m.startsWith("video/") -> "mp4"
            m.startsWith("image/") -> "jpg"
            m.startsWith("audio/") -> "mp3"
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
        // RIFF: WEBP or WAV
        if (header.size >= 12 &&
            header[0] == 'R'.code.toByte() && header[1] == 'I'.code.toByte() &&
            header[2] == 'F'.code.toByte() && header[3] == 'F'.code.toByte()
        ) {
            if (header[8] == 'W'.code.toByte() && header[9] == 'E'.code.toByte() &&
                header[10] == 'B'.code.toByte() && header[11] == 'P'.code.toByte()
            ) return "image/webp"
            if (header[8] == 'W'.code.toByte() && header[9] == 'A'.code.toByte() &&
                header[10] == 'V'.code.toByte() && header[11] == 'E'.code.toByte()
            ) return "audio/wav"
        }
        // OGG: OggS
        if (header.size >= 4 &&
            header[0] == 'O'.code.toByte() && header[1] == 'g'.code.toByte() &&
            header[2] == 'g'.code.toByte() && header[3] == 'S'.code.toByte()
        ) return "audio/ogg"
        // MP3: ID3 tag (49 44 33) or MPEG audio frame sync (FF FB, FF F3, FF F2)
        if (header.size >= 3 &&
            header[0] == 0x49.toByte() && header[1] == 0x44.toByte() && header[2] == 0x33.toByte()
        ) return "audio/mpeg"
        if (header.size >= 2 && header[0] == 0xFF.toByte() &&
            (header[1] == 0xFB.toByte() || header[1] == 0xF3.toByte() || header[1] == 0xF2.toByte())
        ) return "audio/mpeg"
        // PDF: %PDF
        if (header.size >= 4 &&
            header[0] == '%'.code.toByte() && header[1] == 'P'.code.toByte() &&
            header[2] == 'D'.code.toByte() && header[3] == 'F'.code.toByte()
        ) return "application/pdf"
        // ISO BMFF (MP4 / MOV / M4A / HEIC / AVIF): ....ftyp
        if (header.size >= 12 &&
            header[4] == 'f'.code.toByte() && header[5] == 't'.code.toByte() &&
            header[6] == 'y'.code.toByte() && header[7] == 'p'.code.toByte()
        ) {
            val brand = String(header, 8, minOf(4, header.size - 8), Charsets.US_ASCII).lowercase()
            return when {
                brand.startsWith("qt") -> "video/quicktime"
                brand.startsWith("m4a") -> "audio/mp4"
                brand.startsWith("heic") || brand.startsWith("heix") || brand.startsWith("mif1") -> "image/heic"
                brand.startsWith("avif") || brand.startsWith("avis") -> "image/avif"
                else -> "video/mp4"
            }
        }
        // WebM / Matroska EBML
        if (header.size >= 4 &&
            header[0] == 0x1A.toByte() && header[1] == 0x45.toByte() &&
            header[2] == 0xDF.toByte() && header[3] == 0xA3.toByte()
        ) return "video/webm"
        return null
    }

    private fun queryDisplayName(uri: Uri): String? {
        return try {
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (idx >= 0) cursor.getString(idx)?.trim()?.ifBlank { null } else null
                } else null
            }
        } catch (_: Exception) {
            null
        }
    }

    /** Copy content:// URIs into app cache with unique sequence + preserved filename/extension for WebView upload. */
    private fun uriForWebViewUpload(uri: Uri): Uri {
        return try {
            val seq = uploadSeq.incrementAndGet()
            val displayName = queryDisplayName(uri)
            val resolverMime = contentResolver.getType(uri).orEmpty()
            val guessedMime = if (!displayName.isNullOrBlank()) guessMimeFromName(displayName) else ""
            val mime = resolverMime.ifBlank { guessedMime.ifBlank { "application/octet-stream" } }
            val extFromDisplay = displayName?.substringAfterLast('.', "")?.lowercase()?.ifBlank { null }
            val ext = extFromDisplay ?: extensionForMime(mime) ?: "bin"
            val baseStem = displayName
                ?.substringBeforeLast('.')
                ?.replace(Regex("[^a-zA-Z0-9._-]"), "_")
                ?.take(48)
                ?.ifBlank { null }
                ?: "upload"
            val outDir = File(cacheDir, "webview_uploads").apply { mkdirs() }
            val out = File(outDir, "${baseStem}_${System.currentTimeMillis()}_${seq}.$ext")
            contentResolver.openInputStream(uri)?.use { input ->
                FileOutputStream(out).use { input.copyTo(it, 65536) }
            } ?: return uri
            FileProvider.getUriForFile(this, "$packageName.fileprovider", out)
        } catch (e: Exception) {
            Log.w(TAG, "uriForWebViewUpload fallback: ${e.message}")
            uri
        }
    }

    private fun handleWebViewFileChooser(
        webView: WebView?,
        callback: ValueCallback<Array<Uri>>?,
        fileChooserParams: WebChromeClient.FileChooserParams?
    ): Boolean {
        this.filePathCallback?.onReceiveValue(null)
        this.filePathCallback = callback
        return try {
            val accept = fileChooserParams?.acceptTypes
                ?.flatMap { it.split(',', ' ').map { t -> t.trim() } }
                ?.filter { it.isNotBlank() }
                ?: emptyList()
            pendingFileAcceptTypes = accept
            pendingGalleryMultiple =
                fileChooserParams?.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE

            val currentUrl = (webView?.url ?: flowView.url ?: "").lowercase()
            val isGeminiOrZex = webView === shellView ||
                currentUrl.contains("gemini.google.com") ||
                currentUrl.contains("bard.google.com") ||
                currentUrl.contains("aistudio.google.com") ||
                currentUrl.contains("app.flowbrowser.localhost") ||
                currentUrl.contains("flowbrowser.local") ||
                currentUrl.contains("127.0.0.1")

            val wantsAudioOrDocs = accept.any { isAudioOrDocAccept(it) }
            val wantsImage = accept.isEmpty() || accept.any { isImageAccept(it) }
            val wantsVideo = accept.isEmpty() || accept.any { isVideoAccept(it) }

            pendingUseUniversalFilePicker = wantsAudioOrDocs ||
                (isGeminiOrZex && (accept.isEmpty() || accept.any { it == "*/*" || it == "*" } || !wantsImage && !wantsVideo))

            if (pendingUseUniversalFilePicker) {
                openUniversalFilePicker()
                return true
            }

            pendingGalleryImage = wantsImage || (!wantsImage && !wantsVideo)
            pendingGalleryVideo = wantsVideo || (!wantsImage && !wantsVideo)
            ensureMediaAccessThenOpenGallery()
            true
        } catch (e: Exception) {
            Log.e(TAG, "File chooser failed", e)
            this.filePathCallback = null
            callback?.onReceiveValue(null)
            Toast.makeText(this, "Could not open file picker", Toast.LENGTH_SHORT).show()
            false
        }
    }

    private fun isAudioOrDocAccept(token: String): Boolean {
        val t = token.lowercase().trim().removePrefix(".")
        return t.startsWith("audio/") || t.startsWith("application/") || t.startsWith("text/") ||
            t in setOf("mp3", "wav", "ogg", "m4a", "flac", "aac", "opus", "pdf", "txt", "csv", "json", "doc", "docx") ||
            t.endsWith(".mp3") || t.endsWith(".wav") || t.endsWith(".ogg") || t.endsWith(".m4a") ||
            t.endsWith(".pdf") || t.endsWith(".txt") || t.endsWith(".csv") || t.endsWith(".json")
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
        // System Photo Picker (API 33+) needs no permission — still request so fallback
        // and FileProvider copies work on all OEMs.
        if (hasMediaAccess()) {
            openGalleryPickerNow()
            return
        }
        mediaPermissionLauncher.launch(mediaPermissionsNeeded())
    }

    private fun openUniversalFilePicker() {
        try {
            val resolvedMimes = pendingFileAcceptTypes
                .mapNotNull { token ->
                    val t = token.trim()
                    when {
                        t.contains("/") && t != "*/*" -> t
                        t.startsWith(".") -> extensionToMime(t.removePrefix("."))
                        else -> extensionToMime(t)
                    }
                }
                .distinct()
                .toTypedArray()

            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = if (resolvedMimes.size == 1) resolvedMimes[0] else "*/*"
                if (resolvedMimes.size > 1) {
                    putExtra(Intent.EXTRA_MIME_TYPES, resolvedMimes)
                }
                if (pendingGalleryMultiple) {
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                }
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
            }
            fileChooserLauncher.launch(Intent.createChooser(intent, "Select file"))
        } catch (e: Exception) {
            Log.w(TAG, "ACTION_OPEN_DOCUMENT failed, falling back to ACTION_GET_CONTENT: ${e.message}")
            openClassicGalleryPicker()
        }
    }

    private fun extensionToMime(ext: String): String? {
        return when (ext.lowercase()) {
            "mp3" -> "audio/mpeg"
            "wav" -> "audio/wav"
            "ogg" -> "audio/ogg"
            "m4a" -> "audio/mp4"
            "mp4" -> "video/mp4"
            "webm" -> "video/webm"
            "mov" -> "video/quicktime"
            "mkv" -> "video/x-matroska"
            "png" -> "image/png"
            "jpg", "jpeg", "jpe" -> "image/jpeg"
            "webp" -> "image/webp"
            "gif" -> "image/gif"
            "heic", "hvic" -> "image/heic"
            "heif" -> "image/heif"
            "avif" -> "image/avif"
            "bmp" -> "image/bmp"
            "svg" -> "image/svg+xml"
            "pdf" -> "application/pdf"
            "txt" -> "text/plain"
            "csv" -> "text/csv"
            "json" -> "application/json"
            else -> null
        }
    }

    private fun openGalleryPickerNow() {
        try {
            if (pendingUseUniversalFilePicker) {
                openUniversalFilePicker()
                return
            }
            val mediaType = when {
                pendingGalleryImage && pendingGalleryVideo ->
                    ActivityResultContracts.PickVisualMedia.ImageAndVideo
                pendingGalleryVideo && !pendingGalleryImage ->
                    ActivityResultContracts.PickVisualMedia.VideoOnly
                else -> ActivityResultContracts.PickVisualMedia.ImageOnly
            }
            // Prefer system Photo Picker (gallery UI) for Flow media uploads
            if (ActivityResultContracts.PickVisualMedia.isPhotoPickerAvailable(this)) {
                val req = androidx.activity.result.PickVisualMediaRequest(mediaType)
                if (pendingGalleryMultiple) pickMultipleMediaLauncher.launch(req)
                else pickMediaLauncher.launch(req)
                return
            }
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
        val videoMimes = arrayOf("video/*", "video/mp4", "video/webm", "video/quicktime", "video/x-matroska")
        val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            when {
                pendingGalleryVideo && !pendingGalleryImage -> {
                    type = "video/*"
                    putExtra(Intent.EXTRA_MIME_TYPES, videoMimes)
                }
                pendingGalleryImage && !pendingGalleryVideo -> {
                    type = "image/*"
                    putExtra(Intent.EXTRA_MIME_TYPES, imageMimes)
                }
                else -> {
                    type = "*/*"
                    putExtra(Intent.EXTRA_MIME_TYPES, imageMimes + videoMimes)
                }
            }
            if (pendingGalleryMultiple) {
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            }
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        fileChooserLauncher.launch(Intent.createChooser(intent, "Choose file"))
    }

    private fun deliverFileChooserResult(resultCode: Int, data: Intent?) {
        val cb = filePathCallback
        filePathCallback = null
        if (cb == null) return
        if (resultCode != Activity.RESULT_OK || data == null) {
            cb.onReceiveValue(null)
            return
        }
        val rawUris = mutableListOf<Uri>()
        data.clipData?.let { clip ->
            for (i in 0 until clip.itemCount) {
                clip.getItemAt(i)?.uri?.let { rawUris.add(it) }
            }
        }
        if (rawUris.isEmpty()) {
            data.data?.let { rawUris.add(it) }
        }
        rawUris.forEach { uri ->
            try {
                contentResolver.takePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            } catch (_: Exception) {
            }
        }
        val uris = rawUris.map { uriForWebViewUpload(it) }
        cb.onReceiveValue(if (uris.isEmpty()) null else uris.toTypedArray())
    }

    private fun notifyDownloadProgress(filename: String, receivedBytes: Long, totalBytes: Long) {
        postToShell(
            JSONObject()
                .put("type", "download")
                .put("phase", "progress")
                .put(
                    "data",
                    JSONObject()
                        .put("filename", filename)
                        .put("receivedBytes", receivedBytes)
                        .put("totalBytes", totalBytes)
                )
        )
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
        // Convert CSS viewport coordinates (from getBoundingClientRect) to Android WebView physical pixels!
        // Without multiplying by webScale (~2.75x-3.5x on phones), touches land ~3x higher on screen
        // and hit the top challenge option (e.g. "Tap Yes on your phone" -> /challenge/dp) instead of Authenticator!
        @Suppress("DEPRECATION")
        val webScale = flowView.scale.takeIf { it > 0.1f } ?: resources.displayMetrics.density
        val ix = (x * webScale).toFloat()
        val iy = (y * webScale).toFloat()
        val down = SystemClock.uptimeMillis()
        val downEv = MotionEvent.obtain(down, down, MotionEvent.ACTION_DOWN, ix, iy, 0)
        val upEv = MotionEvent.obtain(down, down + 45, MotionEvent.ACTION_UP, ix, iy, 0)
        flowView.dispatchTouchEvent(downEv)
        flowView.dispatchTouchEvent(upEv)
        downEv.recycle()
        upEv.recycle()
        // JS fallback at CSS coordinates (x, y) — guarded against tapping non-Authenticator challenge rows
        flowView.evaluateJavascript(
            """
            (function(){
              var raw = document.elementFromPoint($x, $y);
              if (!raw) return;
              var typed = raw.closest && raw.closest('[data-challengetype]');
              if (typed) {
                var ct = String(typed.getAttribute('data-challengetype') || '').trim();
                if (ct && ct !== '6' && !/totp|auth/i.test(ct)) return;
              }
              var el = (raw.closest && raw.closest('[role="link"], [role="button"], [data-action="selectchallenge"], [data-challengetype="6"], [data-challengeid="6"], button, a, li')) || raw;
              try {
                var opts = { bubbles: true, cancelable: true, view: window, clientX: $x, clientY: $y, button: 0, buttons: 1 };
                el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', clientX: $x, clientY: $y }));
                el.dispatchEvent(new MouseEvent('mousedown', opts));
                el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'touch', clientX: $x, clientY: $y }));
                el.dispatchEvent(new MouseEvent('mouseup', opts));
                el.dispatchEvent(new MouseEvent('click', opts));
                if (typeof el.click === 'function') el.click();
              } catch (e) {
                try { el.click(); } catch (e2) {}
              }
            })();
            """.trimIndent(),
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
  const txt = (el) => ((el && (el.innerText || el.textContent || (el.getAttribute && el.getAttribute('aria-label')))) || '')
    .replace(/\s+/g, ' ').trim();
  const fireClick = (el) => {
    if (!el) return;
    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      el.focus && el.focus();
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      try {
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, cancelable:true, pointerType:'touch', isPrimary:true, clientX:cx, clientY:cy }));
        el.dispatchEvent(new PointerEvent('pointerup', { bubbles:true, cancelable:true, pointerType:'touch', isPrimary:true, clientX:cx, clientY:cy }));
      } catch (e) {}
      const mOpts = { bubbles:true, cancelable:true, view:window, clientX:cx, clientY:cy, button:0, buttons:1 };
      el.dispatchEvent(new MouseEvent('mousedown', mOpts));
      el.dispatchEvent(new MouseEvent('mouseup', mOpts));
      el.dispatchEvent(new MouseEvent('click', mOpts));
      if (typeof el.click === 'function') el.click();
      try {
        const kOpts = { key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true, cancelable:true };
        el.dispatchEvent(new KeyboardEvent('keydown', kOpts));
        el.dispatchEvent(new KeyboardEvent('keypress', kOpts));
        el.dispatchEvent(new KeyboardEvent('keyup', kOpts));
      } catch (e) {}
    } catch (e) {}
  };
  const activateChallengeNode = (node) => {
    const row = (node.closest && node.closest('li[data-challengetype], li[data-challengeid], [data-challengetype="6"], [data-challengeid="6"], li')) || node;
    const link = (row.querySelector && row.querySelector('[role="link"], [role="button"], [data-action="selectchallenge"], a, button, [tabindex="0"]')) ||
      (node.closest && node.closest('[role="link"], [role="button"], [data-action="selectchallenge"], a, button')) ||
      row;
    fireClick(link);
    if (row !== link) fireClick(row);
    const r = link.getBoundingClientRect();
    return { el: link, x: r.left + r.width / 2, y: r.top + r.height / 2, label: txt(row).slice(0, 60) };
  };

  const path = (location.pathname || '').toLowerCase();
  const page = ((document.body && document.body.innerText) || '').slice(0, 4500);

  // Strict single-row Authenticator matcher — never matches a parent wrapper containing multiple options
  const isAuth = (raw) => {
    const t = String(raw || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!t || t.length > 200) return false;
    if (/one-time security code|security key|tap yes|check your|pull down|notification|use your passkey|can.?t find an eligible|g\.co\/sc|phone or tablet|your phone|eligible device|passkey|sms|text message|voice call|backup code|try another way|more ways to sign in|choose how you want/i.test(t)) {
      return false;
    }
    return /google authenticator/i.test(t) ||
      /authenticator app/i.test(t) ||
      /authentication app/i.test(t) ||
      (/authenticator/i.test(t) && /code|verification|app|get/i.test(t)) ||
      (/verification code/i.test(t) && /authenticator/i.test(t)) ||
      (/code from/i.test(t) && /authenticator/i.test(t)) ||
      /^authenticator$/i.test(t);
  };

  const isAllowedChallengeAncestry = (el) => {
    const typed = el && el.closest && el.closest('[data-challengetype]');
    if (typed) {
      const ct = String(typed.getAttribute('data-challengetype') || '').trim().toLowerCase();
      if (ct && ct !== '6' && !/totp|auth/.test(ct)) return false;
    }
    return true;
  };

  // STEP 1: Always search for Google Authenticator option FIRST (works whether URL is /challenge/selection or /challenge/dp)
  const exactTypeNodes = Array.from(document.querySelectorAll(
    '[data-challengetype="6"], [data-challengeid="6"], [data-challengetype="totp" i], [data-challengeid="totp" i]'
  )).filter(visible);
  if (exactTypeNodes[0]) {
    const res = activateChallengeNode(exactTypeNodes[0]);
    return JSON.stringify({ hit: 'auth-app', label: res.label, x: res.x, y: res.y });
  }

  const sels = '[data-challengeid], [data-challengetype], [data-action="selectchallenge"], ' +
    'li[jsname], li, div[role="link"], div[role="button"], button, a[role="link"], a';
  let cands = Array.from(document.querySelectorAll(sels)).filter((el) => {
    if (!visible(el) || !isAllowedChallengeAncestry(el)) return false;
    const ctype = String(el.getAttribute('data-challengetype') || '').trim().toLowerCase();
    const cid = String(el.getAttribute('data-challengeid') || '').trim().toLowerCase();
    if (ctype && ctype !== '6' && !/totp|auth/.test(ctype)) return false;
    if (ctype === '6' || cid === '6' || ctype === 'totp' || cid === 'totp') return true;
    const label = el.getAttribute('aria-label') || '';
    const own = txt(el);
    if (own.length > 200) return false;
    return isAuth(label) || isAuth(own);
  });
  cands.sort((a, b) => txt(a).length - txt(b).length);
  if (cands[0]) {
    const res = activateChallengeNode(cands[0]);
    return JSON.stringify({ hit: 'auth-app', label: res.label, x: res.x, y: res.y });
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
      for (let i = 0; i < 10 && el; i++) {
        if (!isAllowedChallengeAncestry(el)) break;
        if (el.matches && el.matches('[data-challengeid], [data-challengetype], [data-action], [role="link"], [role="button"], li, button, a')) {
          if (visible(el)) {
            const res = activateChallengeNode(el);
            return JSON.stringify({ hit: 'auth-text', label: res.label, x: res.x, y: res.y });
          }
        }
        el = el.parentElement;
      }
    }
  } catch (e) {}

  // STEP 2: Authenticator option is not visible yet — if on Device Prompt (/challenge/dp), Security Key (/challenge/sk),
  // IAP, or OOTP screen, click "Try another way" to open the challenge selection list!
  const onNonTotpChallenge =
    /\/challenge\/(dp|iap|ootp|sk|skotp)(?:\/|$|\?)/i.test(path) ||
    /g\.co\/sc|get a code to sign in|security key|check your|tap yes|google sent a notification|pull down the notification|confirm it.?s you|verify it.?s you|use your passkey/i.test(page);
  if (onNonTotpChallenge) {
    const tryAnother = Array.from(document.querySelectorAll(
      '[data-action="tryanotherway"], [jsname="Pr7Yme"] button, [jsname="Pr7Yme"], [jsname="rwl3qc"] button, [jsname="rwl3qc"], button, a, [role="button"], [role="link"], span, div'
    )).find((el) => visible(el) && /^(try another way|more ways to sign in|use another way|other ways to sign in)$/i.test(txt(el)));
    if (tryAnother) {
      const btn = (tryAnother.closest && tryAnother.closest('button, a, [role="button"], [role="link"]')) || tryAnother;
      fireClick(btn);
      if (btn !== tryAnother) fireClick(tryAnother);
      const r = btn.getBoundingClientRect();
      return JSON.stringify({ hit: 'try-another', label: txt(btn).slice(0, 60), x: r.left + r.width / 2, y: r.top + r.height / 2 });
    }
  }

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
        val targetUrl = jsString(flowCredTarget ?: "https://flow.google.com/")
        val code = """
(() => {
  const email = $email;
  const password = $password;
  const targetUrl = $targetUrl;
  if (!email) return { ok:false, reason:'no-email' };
  window.__flowCredTarget = targetUrl;
  window.__flowHostCreds = { email, password, targetUrl };
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

    private fun postRawToFlow(rawJson: String) {
        if (!flowReady) return
        val json = JSONObject.quote(rawJson)
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
