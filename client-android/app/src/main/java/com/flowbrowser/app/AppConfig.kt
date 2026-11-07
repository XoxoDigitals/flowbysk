package com.flowbrowser.app

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject
import java.io.File

/**
 * Persistent client config — mirrors Windows AppConfig DPAPI session:
 * EncryptedSharedPreferences for JWT + sanitized server only (no Google email/password).
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

    fun load(): AppConfig {
        try {
            migrateLegacyPlaintextIfNeeded()
            serverUrl = prefs.getString(KEY_SERVER_URL, null)
                ?.takeIf { it.isNotBlank() }
                ?: BuildConfig.DEFAULT_SERVER_URL
            authToken = prefs.getString(KEY_AUTH_TOKEN, null)?.takeIf { it.isNotBlank() }
            userJson = prefs.getString(KEY_USER, null)?.takeIf { it.isNotBlank() }
            activeServerJson = sanitizeActiveServerJson(
                prefs.getString(KEY_ACTIVE_SERVER, null)?.takeIf { it.isNotBlank() }
            )
            zoomLevel = java.lang.Double.longBitsToDouble(
                prefs.getLong(KEY_ZOOM, java.lang.Double.doubleToRawLongBits(0.0))
            )
        } catch (e: Exception) {
            Log.w(TAG, "load failed, using defaults", e)
        }
        return this
    }

    fun save() {
        try {
            sanitizeSecrets()
            prefs.edit()
                .putString(KEY_SERVER_URL, serverUrl)
                .putString(KEY_AUTH_TOKEN, authToken)
                .putString(KEY_USER, userJson)
                .putString(KEY_ACTIVE_SERVER, activeServerJson)
                .putLong(KEY_ZOOM, java.lang.Double.doubleToRawLongBits(zoomLevel))
                .apply()
            deleteLegacyPlaintext()
        } catch (e: Exception) {
            Log.w(TAG, "save failed", e)
        }
    }

    /** Strip Google secrets before anything hits disk. */
    fun sanitizeSecrets() {
        activeServerJson = sanitizeActiveServerJson(activeServerJson)
        userJson = sanitizeUserJson(userJson)
    }

    fun toJsonObject(): JSONObject {
        sanitizeSecrets()
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

    private fun migrateLegacyPlaintextIfNeeded() {
        if (!legacyFile.exists()) return
        try {
            val root = JSONObject(legacyFile.readText())
            val migratedServer = root.optString("serverUrl", BuildConfig.DEFAULT_SERVER_URL)
                .ifBlank { BuildConfig.DEFAULT_SERVER_URL }
            val migratedToken = if (root.has("authToken") && !root.isNull("authToken")) {
                root.optString("authToken").takeIf { it.isNotBlank() }
            } else null
            val migratedUser = root.optJSONObject("user")?.toString()
            val migratedActive = sanitizeActiveServerJson(root.optJSONObject("activeServer")?.toString())
            val migratedZoom = root.optDouble("zoomLevel", 0.0)

            // Only seed encrypted prefs if they are empty (first migration).
            if (!prefs.contains(KEY_SERVER_URL) && !prefs.contains(KEY_AUTH_TOKEN)) {
                prefs.edit()
                    .putString(KEY_SERVER_URL, migratedServer)
                    .putString(KEY_AUTH_TOKEN, migratedToken)
                    .putString(KEY_USER, migratedUser)
                    .putString(KEY_ACTIVE_SERVER, migratedActive)
                    .putLong(KEY_ZOOM, java.lang.Double.doubleToRawLongBits(migratedZoom))
                    .apply()
                Log.i(TAG, "Migrated plaintext session → EncryptedSharedPreferences")
            }
        } catch (e: Exception) {
            Log.w(TAG, "legacy migrate failed", e)
        } finally {
            deleteLegacyPlaintext()
        }
    }

    private fun deleteLegacyPlaintext() {
        try {
            if (legacyFile.exists()) {
                legacyFile.delete()
            }
        } catch (_: Exception) {
        }
    }

    companion object {
        private const val TAG = "AppConfig"
        private const val PREFS_NAME = "flow_secure_session"
        private const val KEY_SERVER_URL = "serverUrl"
        private const val KEY_AUTH_TOKEN = "authToken"
        private const val KEY_USER = "user"
        private const val KEY_ACTIVE_SERVER = "activeServer"
        private const val KEY_ZOOM = "zoomLevel"

        private val SECRET_KEYS = listOf("email", "password", "totpSecret", "totp", "secret")

        fun sanitizeActiveServerJson(raw: String?): String? {
            if (raw.isNullOrBlank()) return null
            return try {
                val obj = JSONObject(raw)
                for (key in SECRET_KEYS) {
                    if (obj.has(key)) obj.remove(key)
                }
                obj.toString()
            } catch (_: Exception) {
                null
            }
        }

        fun sanitizeUserJson(raw: String?): String? {
            if (raw.isNullOrBlank()) return null
            return try {
                val obj = JSONObject(raw)
                for (key in listOf("activeServerEmail", "email", "password")) {
                    if (obj.has(key)) obj.remove(key)
                }
                obj.toString()
            } catch (_: Exception) {
                null
            }
        }
    }
}
