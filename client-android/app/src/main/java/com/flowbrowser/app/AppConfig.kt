package com.flowbrowser.app

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject
import java.io.File

/**
 * Persistent client config — EncryptedSharedPreferences (Android Keystore).
 * Never stores Google password / TOTP.
 */
class AppConfig(private val context: Context) {
    var serverUrl: String = BuildConfig.DEFAULT_SERVER_URL
    var authToken: String? = null
    var userJson: String? = null
    var activeServerJson: String? = null
    var zoomLevel: Double = 0.0

    private val legacyFile: File
        get() = File(context.filesDir, "flow_client_config.json")

    private val prefs: SharedPreferences by lazy { openEncryptedPrefs() }

    fun load(): AppConfig {
        try {
            migrateLegacyPlaintextIfNeeded()
            val p = prefs
            serverUrl = p.getString(KEY_SERVER_URL, BuildConfig.DEFAULT_SERVER_URL)
                ?.ifBlank { BuildConfig.DEFAULT_SERVER_URL }
                ?: BuildConfig.DEFAULT_SERVER_URL
            authToken = p.getString(KEY_AUTH_TOKEN, null)?.takeIf { it.isNotBlank() }
            userJson = p.getString(KEY_USER, null)
            activeServerJson = p.getString(KEY_ACTIVE_SERVER, null)?.let { sanitizeActiveServerJson(it) }
            zoomLevel = java.lang.Double.longBitsToDouble(
                p.getLong(KEY_ZOOM, java.lang.Double.doubleToRawLongBits(0.0))
            )
        } catch (e: Exception) {
            Log.w(TAG, "load failed: ${e.message}")
        }
        return this
    }

    fun save() {
        try {
            activeServerJson = activeServerJson?.let { sanitizeActiveServerJson(it) }
            prefs.edit()
                .putString(KEY_SERVER_URL, serverUrl)
                .putString(KEY_AUTH_TOKEN, authToken)
                .putString(KEY_USER, userJson)
                .putString(KEY_ACTIVE_SERVER, activeServerJson)
                .putLong(KEY_ZOOM, java.lang.Double.doubleToRawLongBits(zoomLevel))
                .apply()
        } catch (e: Exception) {
            Log.w(TAG, "save failed: ${e.message}")
        }
    }

    fun clearSessionFields() {
        authToken = null
        userJson = null
        activeServerJson = null
        save()
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

    private fun openEncryptedPrefs(): SharedPreferences {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            context,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    private fun migrateLegacyPlaintextIfNeeded() {
        if (!legacyFile.exists()) return
        try {
            val root = JSONObject(legacyFile.readText())
            serverUrl = root.optString("serverUrl", BuildConfig.DEFAULT_SERVER_URL)
                .ifBlank { BuildConfig.DEFAULT_SERVER_URL }
            authToken = if (root.has("authToken") && !root.isNull("authToken")) {
                root.optString("authToken").takeIf { it.isNotBlank() }
            } else null
            userJson = root.optJSONObject("user")?.toString()
            activeServerJson = root.optJSONObject("activeServer")?.toString()
                ?.let { sanitizeActiveServerJson(it) }
            zoomLevel = root.optDouble("zoomLevel", 0.0)
            save()
            legacyFile.delete()
            Log.i(TAG, "Migrated plaintext config → EncryptedSharedPreferences")
        } catch (e: Exception) {
            Log.w(TAG, "Legacy migrate failed: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "AppConfig"
        private const val PREFS_NAME = "flow_session_enc"
        private const val KEY_SERVER_URL = "serverUrl"
        private const val KEY_AUTH_TOKEN = "authToken"
        private const val KEY_USER = "user"
        private const val KEY_ACTIVE_SERVER = "activeServer"
        private const val KEY_ZOOM = "zoomLevel"

        fun sanitizeActiveServerJson(raw: String): String {
            return try {
                val obj = JSONObject(raw)
                val drop = setOf("password", "totpSecret", "totp", "secret")
                val keys = obj.keys().asSequence().toList()
                for (k in keys) {
                    if (drop.any { it.equals(k, ignoreCase = true) }) obj.remove(k)
                }
                obj.toString()
            } catch (_: Exception) {
                raw
            }
        }
    }
}
