package com.flowbrowser.app

import android.content.Context
import org.json.JSONObject
import java.io.File

/**
 * Persistent client config — mirrors Windows AppConfig.cs
 */
class AppConfig(private val context: Context) {
    var serverUrl: String = BuildConfig.DEFAULT_SERVER_URL
    var authToken: String? = null
    var userJson: String? = null
    var activeServerJson: String? = null
    var zoomLevel: Double = 0.0

    private val file: File
        get() = File(context.filesDir, "flow_client_config.json")

    fun load(): AppConfig {
        try {
            if (file.exists()) {
                val root = JSONObject(file.readText())
                serverUrl = root.optString("serverUrl", BuildConfig.DEFAULT_SERVER_URL)
                    .ifBlank { BuildConfig.DEFAULT_SERVER_URL }
                authToken = if (root.has("authToken") && !root.isNull("authToken")) {
                    root.optString("authToken").takeIf { it.isNotBlank() }
                } else null
                userJson = root.optJSONObject("user")?.toString()
                activeServerJson = root.optJSONObject("activeServer")?.toString()
                zoomLevel = root.optDouble("zoomLevel", 0.0)
            }
        } catch (_: Exception) {
            // keep defaults
        }
        return this
    }

    fun save() {
        try {
            val root = JSONObject()
            root.put("serverUrl", serverUrl)
            root.put("authToken", authToken ?: JSONObject.NULL)
            root.put("user", if (userJson != null) JSONObject(userJson!!) else JSONObject.NULL)
            root.put(
                "activeServer",
                if (activeServerJson != null) JSONObject(activeServerJson!!) else JSONObject.NULL
            )
            root.put("zoomLevel", zoomLevel)
            file.writeText(root.toString(2))
        } catch (_: Exception) {
            // ignore
        }
    }

    fun toJsonObject(): JSONObject {
        val root = JSONObject()
        root.put("serverUrl", serverUrl)
        root.put("authToken", authToken ?: JSONObject.NULL)
        root.put("user", if (userJson != null) JSONObject(userJson!!) else JSONObject.NULL)
        root.put(
            "activeServer",
            if (activeServerJson != null) JSONObject(activeServerJson!!) else JSONObject.NULL
        )
        root.put("zoomLevel", zoomLevel)
        return root
    }
}
