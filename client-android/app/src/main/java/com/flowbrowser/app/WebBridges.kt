package com.flowbrowser.app

import android.webkit.JavascriptInterface

class ShellBridge(private val activity: MainActivity) {
    @JavascriptInterface
    fun postMessage(json: String) {
        activity.onShellMessage(json)
    }
}

class FlowBridge(private val activity: MainActivity) {
    @JavascriptInterface
    fun postMessage(json: String) {
        activity.onFlowMessage(json)
    }

    /** Chunked blob/data downloads from Flow WebView → gallery. */
    @JavascriptInterface
    fun downloadBegin(id: String, filename: String, mime: String, total: Int) {
        activity.runOnUiThread {
            activity.onBlobDownloadBegin(id, filename, mime, total)
        }
    }

    @JavascriptInterface
    fun downloadChunk(id: String, base64Chunk: String) {
        // Off main thread — may be large
        activity.onBlobDownloadChunk(id, base64Chunk)
    }

    @JavascriptInterface
    fun downloadEnd(id: String) {
        activity.onBlobDownloadEnd(id)
    }

    @JavascriptInterface
    fun downloadFail(id: String, error: String) {
        activity.onBlobDownloadFail(id, error)
    }
}
