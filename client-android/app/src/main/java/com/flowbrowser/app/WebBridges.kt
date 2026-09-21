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
}
