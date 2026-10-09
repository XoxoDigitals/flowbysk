package com.flowbrowser.app

import android.util.Base64
import org.bouncycastle.crypto.agreement.X25519Agreement
import org.bouncycastle.crypto.params.X25519PrivateKeyParameters
import org.bouncycastle.crypto.params.X25519PublicKeyParameters
import org.bouncycastle.jce.provider.BouncyCastleProvider
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.Security
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * X25519 + AES-GCM credential channel (matches server/credChannel.js flow-cred-v1).
 * Used when WebView crypto.subtle is unavailable.
 */
class CredChannelHost {
    private var privateKey: X25519PrivateKeyParameters? = null
    private var aesKey: ByteArray? = null
    var channelId: String? = null
        private set

    fun generateClientPublicKey(): String {
        clear()
        val priv = X25519PrivateKeyParameters(SecureRandom())
        privateKey = priv
        val pub = ByteArray(32)
        priv.generatePublicKey().encode(pub, 0)
        return toB64Url(pub)
    }

    fun establish(channelId: String, serverPublicKeySpkiB64: String) {
        val priv = privateKey ?: throw IllegalStateException("Generate client key first")
        require(channelId.isNotBlank()) { "channelId required" }
        val spki = fromB64Url(serverPublicKeySpkiB64)
        require(spki.size >= 32) { "Invalid serverPublicKey" }
        val serverRaw = spki.copyOfRange(spki.size - 32, spki.size)
        val agreement = X25519Agreement()
        agreement.init(priv)
        val shared = ByteArray(agreement.agreementSize)
        agreement.calculateAgreement(X25519PublicKeyParameters(serverRaw, 0), shared, 0)
        val material = shared + INFO
        aesKey = MessageDigest.getInstance("SHA-256").digest(material)
        this.channelId = channelId
        shared.fill(0)
    }

    fun mac(attemptId: String, stage: String): JSONObject {
        val key = aesKey ?: throw IllegalStateException("Channel not established")
        val ch = channelId ?: throw IllegalStateException("Channel not established")
        val ts = System.currentTimeMillis()
        val msg = "$ch|$attemptId|$stage|$ts".toByteArray(Charsets.UTF_8)
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        val sig = mac.doFinal(msg)
        return JSONObject().put("ts", ts).put("mac", toB64Url(sig))
    }

    fun decryptSealed(ciphertextB64: String, nonceB64: String): String {
        val key = aesKey ?: throw IllegalStateException("Channel not established")
        val packed = fromB64Url(ciphertextB64)
        val nonce = fromB64Url(nonceB64)
        require(packed.size >= 17) { "Ciphertext too short" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        val plain = cipher.doFinal(packed)
        return String(plain, Charsets.UTF_8)
    }

    fun clear() {
        aesKey?.fill(0)
        aesKey = null
        channelId = null
        privateKey = null
    }

    companion object {
        private val INFO = "flow-cred-v1".toByteArray(Charsets.UTF_8)

        init {
            if (Security.getProvider(BouncyCastleProvider.PROVIDER_NAME) == null) {
                Security.insertProviderAt(BouncyCastleProvider(), 1)
            }
        }

        fun toB64Url(data: ByteArray): String =
            Base64.encodeToString(data, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

        fun fromB64Url(s: String): ByteArray {
            var t = (s).replace('-', '+').replace('_', '/')
            when (t.length % 4) {
                2 -> t += "=="
                3 -> t += "="
            }
            return Base64.decode(t, Base64.DEFAULT)
        }
    }
}
