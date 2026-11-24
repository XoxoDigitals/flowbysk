package com.flowbrowser.app

import android.webkit.JavascriptInterface

class ShellBridge(private val activity: MainActivity) {
    @JavascriptInterface
    fun postMessage(json: String) {
        activity.onShellMessage(json)
    }

    /**
     * Native store for the "My Projects" list. On Android, clearing the Flow/Google
     * session calls WebStorage.deleteAllData(), which is app-wide and also wipes the
     * shell's own localStorage — so the list cannot live there (on Windows the shell
     * and Flow views use separate profiles, which is why it survives there).
     */
    @JavascriptInterface
    fun savedProjectsGet(key: String): String {
        return activity.getSharedPreferences(SAVED_PROJECTS_PREFS, android.content.Context.MODE_PRIVATE)
            .getString(key, null) ?: ""
    }

    @JavascriptInterface
    fun savedProjectsSet(key: String, json: String) {
        activity.getSharedPreferences(SAVED_PROJECTS_PREFS, android.content.Context.MODE_PRIVATE)
            .edit()
            .putString(key, json)
            .apply()
    }

    companion object {
        private const val SAVED_PROJECTS_PREFS = "flow_saved_projects"
    }
}

class FlowBridge(private val activity: MainActivity) {
    @JavascriptInterface
    fun postMessage(json: String) {
        activity.onFlowMessage(json)
    }

    /**
     * Chunked blob/data downloads from Flow WebView → gallery / Downloads.
     * IMPORTANT: downloadBegin, downloadChunk, and downloadEnd MUST all run synchronously
     * on the JavaBridge thread so chunks never arrive before downloadBegin creates the entry!
     */
    @JavascriptInterface
    fun downloadBegin(id: String, filename: String, mime: String, total: Int) {
        activity.onBlobDownloadBegin(id, filename, mime, total)
    }

    @JavascriptInterface
    fun downloadChunk(id: String, base64Chunk: String) {
        activity.onBlobDownloadChunk(id, base64Chunk)
    }

    @JavascriptInterface
    fun downloadEnd(id: String) {
        activity.onBlobDownloadEnd(id)
    }

    @JavascriptInterface
    fun downloadFail(id: String, filename: String, error: String) {
        activity.onBlobDownloadFail(id, filename, error)
    }

    @JavascriptInterface
    fun downloadFail(id: String, error: String) {
        activity.onBlobDownloadFail(id, "", error)
    }

    @JavascriptInterface
    fun setClipboardText(text: String) {
        activity.setClipboardTextFromJs(text)
    }

    @JavascriptInterface
    fun getClipboardText(): String {
        return activity.getClipboardTextForJs()
    }
}
