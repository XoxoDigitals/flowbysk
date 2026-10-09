package com.flowbrowser.app

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.os.SystemClock
import android.util.Log
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.URLUtil
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.roundToInt

class MainActivity : AppCompatActivity() {
    companion object {
        private const val TAG = "FlowBrowser"
        private const val CHROME_HEIGHT_DP = 80f
    }

    private lateinit var shellView: WebView
    private lateinit var flowView: WebView
    private lateinit var flowPane: FrameLayout
    private lateinit var authCover: View
    private lateinit var captchaBanner: View
    private lateinit var root: FrameLayout
    private lateinit var config: AppConfig
    private lateinit var wwwServer: WwwServer
    private val credChannel = CredChannelHost()

    private val scope = CoroutineScope(Dispatchers.Main + Job())
    private var shellMode = "full"
    private var flowCredEmail: String? = null
    private var flowCredPassword: String? = null
    private var flowCredTarget: String? = null
    private val autofillGeneration = AtomicInteger(0)
    private var lastAutofillKickMs = 0L
    private var flowInjectScript: String = ""
    private var shellReady = false
    private var flowReady = false
    private var authLoginActive = false
    private var onGoogleAuth = false
    private var captchaActive = false
    private var authUiMode = 0 // 0 off, 1 cover, 2 captcha

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.activity_main)

        root = findViewById(R.id.root)
        shellView = findViewById(R.id.shellView)
        flowPane = findViewById(R.id.flowPane)
        flowView = findViewById(R.id.flowView)
        authCover = findViewById(R.id.authCover)
        captchaBanner = findViewById(R.id.captchaBanner)

        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            v.updatePadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        config = AppConfig(this).load()
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
        val s = flowView.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.allowFileAccess = false
        s.mediaPlaybackRequiresUserGesture = false
        s.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        s.userAgentString = s.userAgentString.replace("; wv", "")
        s.cacheMode = WebSettings.LOAD_DEFAULT
        s.setSupportMultipleWindows(false)
        CookieManager.getInstance().setAcceptThirdPartyCookies(flowView, true)

        if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
            @Suppress("DEPRECATION")
            WebSettingsCompat.setForceDark(s, WebSettingsCompat.FORCE_DARK_OFF)
        }

        flowView.addJavascriptInterface(FlowBridge(this), "FlowHost")
        flowView.webChromeClient = WebChromeClient()
        flowView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                return false
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                injectPolyfill(flowView, "FlowHost")
                if (flowInjectScript.isNotBlank()) {
                    flowView.evaluateJavascript(flowInjectScript, null)
                }
                val u = url ?: ""
                updateAuthOverlayFromUrl(u)
                postToShell(
                    JSONObject()
                        .put("type", "flow-event")
                        .put("event", "did-start-loading")
                        .put("url", u)
                )
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                injectPolyfill(flowView, "FlowHost")
                if (flowInjectScript.isNotBlank()) {
                    flowView.evaluateJavascript(flowInjectScript, null)
                }
                val u = url ?: view?.url ?: ""
                updateAuthOverlayFromUrl(u)
                postToShell(JSONObject().put("type", "flow-event").put("event", "did-navigate").put("url", u))
                postToShell(JSONObject().put("type", "flow-event").put("event", "did-finish-load").put("url", u))
                postToShell(JSONObject().put("type", "flow-event").put("event", "dom-ready").put("url", u))
                tryHostGoogleAutofill(u)
            }

            override fun doUpdateVisitedHistory(view: WebView?, url: String?, isReload: Boolean) {
                val u = (url ?: flowView.url ?: "").trim()
                if (u.isEmpty()) return
                updateAuthOverlayFromUrl(u)
                postToShell(JSONObject().put("type", "flow-event").put("event", "did-navigate-in-page").put("url", u))
                tryHostGoogleAutofill(u)
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
            val boot = BridgePolyfill.script("FlowHost") + "\n" + flowInjectScript
            WebViewCompat.addDocumentStartJavaScript(flowView, boot, setOf("*"))
        }
    }

    private fun injectPolyfill(webView: WebView, hostName: String) {
        webView.evaluateJavascript(BridgePolyfill.script(hostName), null)
    }

    private fun setShellMode(mode: String) {
        var m = mode
        if (m == "veo") m = "chrome"
        shellMode = m
        runOnUiThread {
            val chromePx = (CHROME_HEIGHT_DP * resources.displayMetrics.density).roundToInt()
            val shellLp = shellView.layoutParams as FrameLayout.LayoutParams
            val flowLp = flowPane.layoutParams as FrameLayout.LayoutParams
            if (m == "full") {
                flowPane.visibility = View.GONE
                shellLp.height = ViewGroup.LayoutParams.MATCH_PARENT
                shellLp.topMargin = 0
                flowLp.topMargin = 0
            } else {
                flowPane.visibility = View.VISIBLE
                shellLp.height = chromePx
                shellLp.topMargin = 0
                flowLp.topMargin = chromePx
            }
            shellView.layoutParams = shellLp
            flowPane.layoutParams = flowLp
            applyAuthOverlayState()
        }
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
                setShellMode("chrome")
                flowView.loadUrl(url)
                updateAuthOverlayFromUrl(url)
            }
            "authOverlay" -> {
                handleAuthOverlayCommand(
                    show = root.optBoolean("show", false),
                    captcha = root.optBoolean("captcha", false),
                    done = root.optBoolean("done", false)
                )
            }
            "reload" -> {
                val ignore = root.optBoolean("ignoreCache", false)
                if (ignore) flowView.clearCache(true)
                flowView.reload()
            }
            "stop" -> flowView.stopLoading()
            "zoom" -> {
                val factor = root.optDouble("factor", 1.0)
                // Android zoom is percent-based relative to 100
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
                dispatchFlowClick(root.optDouble("x", 0.0), root.optDouble("y", 0.0))
            }
            "fillOtp" -> {
                fillTotp(root.optString("otp"))
            }
            "shellMode" -> {
                val mode = root.optString("mode", "chrome")
                setShellMode(if (mode == "full") "full" else "chrome")
            }
        }
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
                    config.userJson = if (u is JSONObject) u.toString() else null
                }
                if (payload.has("activeServer")) {
                    val s = payload.opt("activeServer")
                    config.activeServerJson = if (s is JSONObject) {
                        AppConfig.sanitizeActiveServerJson(s.toString())
                    } else null
                }
                // vaultPassword is Windows-only; Android uses Keystore EncryptedSharedPreferences
                config.save()
                JSONObject().put("success", true)
            }
            "clearSession" -> {
                config.clearSessionFields()
                credChannel.clear()
                JSONObject().put("success", true)
            }
            "credGenerateKey" -> {
                JSONObject().put("clientPublicKey", credChannel.generateClientPublicKey())
            }
            "credEstablish" -> {
                val channelId = payload.optString("channelId")
                val serverPublicKey = payload.optString("serverPublicKey")
                if (channelId.isBlank() || serverPublicKey.isBlank()) {
                    throw IllegalArgumentException("channelId and serverPublicKey required")
                }
                credChannel.establish(channelId, serverPublicKey)
                JSONObject().put("success", true).put("channelId", credChannel.channelId)
            }
            "credMac" -> {
                credChannel.mac(payload.optString("attemptId"), payload.optString("stage"))
            }
            "credDecrypt" -> {
                val ct = payload.optString("ciphertext")
                val nonce = payload.optString("nonce")
                if (ct.isBlank() || nonce.isBlank()) {
                    throw IllegalArgumentException("ciphertext and nonce required")
                }
                JSONObject().put("plaintext", credChannel.decryptSealed(ct, nonce))
            }
            "credClear" -> {
                credChannel.clear()
                JSONObject().put("success", true)
            }
            "getDeviceId" -> {
                JSONObject()
                    .put("deviceId", getStableDeviceId())
                    .put("client", "android/6.0.2")
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

    private fun clearFlowSession() {
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
        val filename = URLUtil.guessFileName(url, contentDisposition, mimeType)
        postToShell(
            JSONObject()
                .put("type", "download")
                .put("phase", "started")
                .put(
                    "data",
                    JSONObject().put("filename", filename).put("totalBytes", contentLength)
                )
        )
        try {
            val request = android.app.DownloadManager.Request(Uri.parse(url))
            request.setMimeType(mimeType)
            request.addRequestHeader("User-Agent", userAgent)
            val cookie = CookieManager.getInstance().getCookie(url)
            if (!cookie.isNullOrBlank()) request.addRequestHeader("Cookie", cookie)
            request.setNotificationVisibility(
                android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
            )
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)
            val dm = getSystemService(DOWNLOAD_SERVICE) as android.app.DownloadManager
            val id = dm.enqueue(request)
            scope.launch {
                // Poll briefly for completion notification to shell
                delay(1500)
                postToShell(
                    JSONObject()
                        .put("type", "download")
                        .put("phase", "completed")
                        .put(
                            "data",
                            JSONObject()
                                .put("filename", filename)
                                .put(
                                    "savePath",
                                    File(
                                        Environment.getExternalStoragePublicDirectory(
                                            Environment.DIRECTORY_DOWNLOADS
                                        ),
                                        filename
                                    ).absolutePath
                                )
                                .put("downloadId", id)
                        )
                )
            }
        } catch (e: Exception) {
            Log.e(TAG, "Download failed", e)
            postToShell(
                JSONObject()
                    .put("type", "download")
                    .put("phase", "failed")
                    .put("data", JSONObject().put("filename", filename).put("state", "error"))
            )
        }
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
        val src = flowView.url ?: ""
        if (!src.contains("challenge/totp", true)) return
        val code = jsString(otp)
        val script = """
(() => {
  const otp = $code;
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  };
  const el = document.querySelector('input[name="totpPin"], input#totpPin') ||
    Array.from(document.querySelectorAll('input')).find(i => {
      if (!visible(i) || i.type === 'hidden' || i.type === 'checkbox') return false;
      const b = ((i.getAttribute('aria-label')||'') + ' ' + (i.placeholder||'') + ' ' + (i.name||'')).toLowerCase();
      return /code|totp|otp/.test(b);
    });
  if (!el) return 'no-input';
  if ((el.value || '') === otp) return 'already';
  const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  const setter = desc && desc.set;
  try { el.focus(); } catch (e) {}
  if (setter) setter.call(el, otp); else el.value = otp;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  setTimeout(() => {
    const btn = document.querySelector('#totpNext button, #totpNext') ||
      Array.from(document.querySelectorAll('button')).find(b => /^\s*next\s*$/i.test((b.innerText || '').trim()));
    if (btn) { try { btn.click(); } catch (e) {} }
  }, 500);
  return 'filled:' + (el.value || '').length;
})()
""".trimIndent()
        flowView.evaluateJavascript(script, null)
    }

    private fun tryHostGoogleAutofill(url: String?) {
        val email = flowCredEmail ?: return
        val u = url ?: flowView.url ?: return
        if (!u.contains("accounts.google.com", true)) return
        val now = System.currentTimeMillis()
        if (now - lastAutofillKickMs < 1200) return
        lastAutofillKickMs = now
        injectGoogleAutofillOnce(email, flowCredPassword ?: "")
        val gen = autofillGeneration.incrementAndGet()
        scope.launch {
            for (delayMs in listOf(400L, 900L, 1600L, 2600L)) {
                delay(delayMs)
                if (gen != autofillGeneration.get()) return@launch
                injectGoogleAutofillOnce(email, flowCredPassword ?: "")
            }
        }
    }

    private fun handleAuthOverlayCommand(show: Boolean, captcha: Boolean, done: Boolean) {
        if (done) {
            val cur = flowView.url ?: ""
            if (isFlowWorkspaceUrl(cur)) {
                clearAuthCoverSession()
                return
            }
            if (isGoogleAuthRelatedUrl(cur)) {
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
            captchaActive = true
            onGoogleAuth = true
            authLoginActive = true
            applyAuthOverlayState()
            return
        }
        if (show) {
            captchaActive = false
            onGoogleAuth = true
            authLoginActive = true
            applyAuthOverlayState()
        }
    }

    private fun clearAuthCoverSession() {
        captchaActive = false
        onGoogleAuth = false
        authLoginActive = false
        applyAuthOverlayState()
    }

    private fun updateAuthOverlayFromUrl(url: String?) {
        if (isGoogleRecaptchaChallengeUrl(url)) {
            authLoginActive = true
            onGoogleAuth = true
            captchaActive = true
            applyAuthOverlayState()
            return
        }
        if (isGoogleAuthRelatedUrl(url)) {
            authLoginActive = true
            onGoogleAuth = true
            captchaActive = false
            applyAuthOverlayState()
            return
        }
        if (isFlowWorkspaceUrl(url)) {
            if (authLoginActive) {
                // Keep cover briefly, then clear once Flow workspace is up
                onGoogleAuth = true
                applyAuthOverlayState()
                scope.launch {
                    delay(1600)
                    val cur = flowView.url ?: return@launch
                    if (isFlowWorkspaceUrl(cur) && !isGoogleAuthRelatedUrl(cur)) {
                        clearAuthCoverSession()
                    }
                }
                return
            }
            clearAuthCoverSession()
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

    private fun applyAuthOverlayState() {
        runOnUiThread {
            val want = when {
                (authLoginActive || onGoogleAuth) && captchaActive -> 2
                authLoginActive || onGoogleAuth -> 1
                else -> 0
            }
            if (want == authUiMode) return@runOnUiThread
            authUiMode = want
            when (want) {
                2 -> {
                    authCover.visibility = View.GONE
                    captchaBanner.visibility = View.VISIBLE
                }
                1 -> {
                    captchaBanner.visibility = View.GONE
                    authCover.visibility = View.VISIBLE
                    authCover.bringToFront()
                }
                else -> {
                    authCover.visibility = View.GONE
                    captchaBanner.visibility = View.GONE
                }
            }
        }
    }

    private fun isGoogleAuthRelatedUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        val u = url.lowercase()
        if (u.contains("accounts.google.com") || u.contains("accounts.youtube.com")) return true
        if ((u.contains("google.com") || u.contains("youtube.com")) &&
            (u.contains("/signin") || u.contains("/accountchooser") || u.contains("servicelogin") || u.contains("/oauth"))
        ) return true
        return false
    }

    private fun isGoogleRecaptchaChallengeUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        val u = url.lowercase()
        return u.contains("recaptcha") || u.contains("challenge/recaptcha") || u.contains("hcaptcha")
    }

    private fun isFlowWorkspaceUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        val u = url.lowercase()
        return u.contains("flow.google.com") || u.contains("labs.google")
    }

    private fun injectGoogleAutofillOnce(emailRaw: String, passwordRaw: String) {
        val src = flowView.url ?: return
        if (!src.contains("accounts.google.com", true) && !src.contains("accounts.youtube.com", true)) return
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
  const clickNextFor = (kind) => {
    let next = null;
    if (kind === 'password') next = document.querySelector('#passwordNext button, #passwordNext');
    else if (kind === 'identifier') next = document.querySelector('#identifierNext button, #identifierNext');
    if (!next || !visible(next)) {
      next = Array.from(document.querySelectorAll('button')).find(b => /^\s*next\s*$/i.test((b.innerText || b.textContent || '')));
    }
    if (!next || !visible(next)) return false;
    try { next.removeAttribute('disabled'); next.setAttribute('aria-disabled','false'); } catch (e) {}
    try { next.click(); } catch (e) {}
    return true;
  };

  const pageTxt = ((document.body && document.body.innerText) || '').slice(0, 1500);
  const totpEl = document.querySelector('input[name="totpPin"], input#totpPin, input[autocomplete="one-time-code"]');
  const onTotp = /\/challenge\/totp/i.test(path) ||
    (totpEl && visible(totpEl)) ||
    (/Authenticator|2-Step Verification/i.test(pageTxt) && /Enter code|verification code/i.test(pageTxt));
  if (onTotp) return { ok:true, step:'totp-wait' };

  const onPwdPath = /\/challenge\/pwd/i.test(path);
  const pwd = Array.from(document.querySelectorAll(
    'input[name="Passwd"], input[type="password"], input[autocomplete*="current-password"]'
  )).find(el => visible(el));

  if (pwd && password && (onPwdPath || !document.querySelector('input#identifierId'))) {
    const pwdKey = 'pwd:' + stepKey;
    if (st[pwdKey] === 'submitted') return { ok:true, step:'password-done' };
    const already = (pwd.value || '') === password;
    const ok = already || fill(pwd, password);
    if (!ok) return { ok:false, step:'password', reason:'fill-failed', valLen:(pwd.value||'').length };
    if (st[pwdKey] !== 'filled' && st[pwdKey] !== 'submitted') {
      st[pwdKey] = 'filled';
      setTimeout(() => {
        if (st[pwdKey] === 'submitted') return;
        if (!pwd.isConnected) { delete st[pwdKey]; return; }
        // Never click Next on an empty/cleared password field
        if ((pwd.value || '') !== password) {
          const again = fill(pwd, password);
          if (!again || (pwd.value || '') !== password) { delete st[pwdKey]; return; }
        }
        if (document.querySelector('input[name="totpPin"], input#totpPin')) return;
        if (clickNextFor('password')) st[pwdKey] = 'submitted';
        else delete st[pwdKey];
      }, 900);
    }
    return { ok:true, step:'password', already };
  }

  // SPA lag: password URL but field not mounted — do not click email Next
  if (onPwdPath) return { ok:false, reason:'awaiting-password', path };

  const em = document.querySelector('input#identifierId, input[type="email"], input[name="identifier"], input[autocomplete="username"]');
  if (em && visible(em) && email && (!pwd || !visible(pwd))) {
    const emKey = 'email:' + stepKey;
    if (st[emKey] === 'submitted') return { ok:true, step:'email-done' };
    const already = (em.value || '').toLowerCase() === email.toLowerCase();
    const ok = already || fill(em, email);
    if (!ok) return { ok:false, step:'email', reason:'fill-failed' };
    if (st[emKey] !== 'filled' && st[emKey] !== 'submitted') {
      st[emKey] = 'filled';
      setTimeout(() => {
        if (st[emKey] === 'submitted') return;
        if (!em.isConnected) { delete st[emKey]; return; }
        // Already moved to password — never fire identifier Next there
        if (/\/challenge\/pwd/i.test(location.pathname || '')) return;
        if (document.querySelector('input[name="Passwd"], input[type="password"]')) {
          const p = document.querySelector('input[name="Passwd"], input[type="password"]');
          if (p && visible(p)) return;
        }
        if ((em.value || '').toLowerCase() !== email.toLowerCase()) { delete st[emKey]; return; }
        if (clickNextFor('identifier')) st[emKey] = 'submitted';
        else delete st[emKey];
      }, 1100);
    }
    return { ok:true, step:'email', already };
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

    private fun getStableDeviceId(): String {
        val androidId = try {
            android.provider.Settings.Secure.getString(
                contentResolver,
                android.provider.Settings.Secure.ANDROID_ID
            )
        } catch (_: Exception) {
            null
        }
        val raw = when {
            !androidId.isNullOrBlank() && androidId != "9774d56d682e549c" -> androidId
            else -> "${android.os.Build.MODEL}|${android.os.Build.FINGERPRINT}|${packageName}"
        }
        val digest = java.security.MessageDigest.getInstance("SHA-256")
            .digest(raw.toByteArray(Charsets.UTF_8))
        val hex = digest.joinToString("") { b -> "%02x".format(b) }
        return "and-" + hex.take(32)
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
