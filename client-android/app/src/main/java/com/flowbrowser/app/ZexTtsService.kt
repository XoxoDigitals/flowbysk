package com.flowbrowser.app

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.SecureRandom
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.roundToInt

class ZexTtsService(private val context: Context? = null) {

    data class VoiceDto(
        val shortName: String,
        val name: String,
        val locale: String,
        val gender: String
    ) {
        fun toJson(): JSONObject = JSONObject()
            .put("shortName", shortName)
            .put("name", name)
            .put("locale", locale)
            .put("gender", gender)
    }

    private val workRoot: File
    private val previewsDir: File
    private val fallbackOutputDir: File
    private val defaultOutputDir: File

    @Volatile
    private var cachedVoices: List<VoiceDto>? = null

    private val ioExecutor = Executors.newCachedThreadPool()

    init {
        val baseDir = context?.filesDir
            ?: File(System.getProperty("java.io.tmpdir") ?: "/data/local/tmp")
        workRoot = File(baseDir, "zextts_work")
        previewsDir = File(workRoot, "previews")
        fallbackOutputDir = File(workRoot, "Output")

        val publicDownloads = try {
            File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                "FlowBrowser"
            )
        } catch (_: Exception) {
            fallbackOutputDir
        }
        defaultOutputDir = publicDownloads

        try {
            workRoot.mkdirs()
            previewsDir.mkdirs()
            fallbackOutputDir.mkdirs()
            defaultOutputDir.mkdirs()
        } catch (_: Exception) {
        }

        // Pre-warm neural voice catalog + clock skew in background so TTS STUDIO opens in 0ms
        ioExecutor.execute {
            try {
                ensureClockSkewSynced(false)
                listVoices(false)
            } catch (_: Exception) {
            }
        }
    }

    fun handleInvoke(
        id: Any,
        cmd: String,
        payload: JSONObject?,
        sendToFlow: (String) -> Unit,
        onFileSaved: ((String, String) -> Unit)? = null
    ) {
        handleInvoke(id.toString(), cmd, payload, sendToFlow, onFileSaved)
    }

    fun handleInvoke(
        id: String,
        cmd: String,
        payload: JSONObject?,
        sendToFlow: (String) -> Unit,
        onFileSaved: ((String, String) -> Unit)? = null
    ) {
        ioExecutor.execute {
            val numericId = id.toLongOrNull()
            val emitProgress: (String, JSONObject) -> Unit = { eventName, detail ->
                try {
                    val ev = JSONObject()
                        .put("type", "zextts-event")
                        .put("eventName", eventName)
                        .put("event", eventName)
                        .put("detail", detail)
                        .put("payload", detail)
                    sendToFlow(ev.toString())
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to emit ZexTTS progress event: ${e.message}")
                }
            }

            try {
                val res = executeCommand(cmd, payload ?: JSONObject(), emitProgress, onFileSaved)
                val ok = res.optBoolean("ok", true)
                if (numericId != null) {
                    val envNum = JSONObject()
                        .put("type", "zextts-result")
                        .put("id", numericId)
                        .put("ok", ok)
                        .put("result", res)
                        .put("data", res)
                    sendToFlow(envNum.toString())
                }
                val envStr = JSONObject()
                    .put("type", "zextts-result")
                    .put("id", id)
                    .put("ok", ok)
                    .put("result", res)
                    .put("data", res)
                if (numericId == null) {
                    sendToFlow(envStr.toString())
                } else {
                    // Also dispatch string id in case any caller keyed _pending by string
                    sendToFlow(envStr.toString())
                }
            } catch (e: Exception) {
                Log.e(TAG, "ZexTTS command failed ($cmd)", e)
                val errMsg = e.message ?: "Speech synthesis failed"
                val errRes = JSONObject().put("ok", false).put("error", errMsg)
                if (numericId != null) {
                    val envNum = JSONObject()
                        .put("type", "zextts-result")
                        .put("id", numericId)
                        .put("ok", false)
                        .put("error", errMsg)
                        .put("result", errRes)
                        .put("data", errRes)
                    sendToFlow(envNum.toString())
                }
                val envStr = JSONObject()
                    .put("type", "zextts-result")
                    .put("id", id)
                    .put("ok", false)
                    .put("error", errMsg)
                    .put("result", errRes)
                    .put("data", errRes)
                sendToFlow(envStr.toString())
            }
        }
    }

    private fun executeCommand(
        cmd: String,
        payload: JSONObject,
        emitProgress: (String, JSONObject) -> Unit,
        onFileSaved: ((String, String) -> Unit)?
    ): JSONObject {
        return when (cmd.trim().lowercase(Locale.ROOT)) {
            "check_access", "check-access" -> {
                JSONObject()
                    .put("ok", true)
                    .put("access", "tox")
            }

            "check_internet", "check-internet" -> {
                JSONObject()
                    .put("ok", true)
                    .put("online", true)
            }

            "get_default_output_folder", "get-default-output-folder" -> {
                JSONObject()
                    .put("ok", true)
                    .put("path", resolveDisplayOutputDir(null))
            }

            "choose_output_folder", "choose-output-folder" -> {
                JSONObject()
                    .put("ok", true)
                    .put("path", resolveDisplayOutputDir(null))
            }

            "get-bootstrap", "get_bootstrap" -> {
                val voices = listVoices(false)
                val arr = JSONArray()
                voices.forEach { arr.put(it.toJson()) }
                JSONObject()
                    .put("ok", true)
                    .put("access", "tox")
                    .put("online", true)
                    .put("outputDir", resolveDisplayOutputDir(null))
                    .put("voices", arr)
            }

            "list_voices", "list-voices", "refresh-voices", "refresh_voices" -> {
                val force = payload.optBoolean("force", false) ||
                    cmd.startsWith("refresh", ignoreCase = true)
                val voices = listVoices(force)
                val arr = JSONArray()
                voices.forEach { arr.put(it.toJson()) }
                JSONObject()
                    .put("ok", true)
                    .put("voices", arr)
            }

            "preview_voice", "preview-voice" -> {
                previewVoice(payload)
            }

            "generate_audio", "generate-audio", "generate-single", "generate_single" -> {
                generateAudio(payload, emitProgress, onFileSaved)
            }

            "generate_podcast", "generate-podcast" -> {
                generatePodcast(payload, emitProgress, onFileSaved)
            }

            "open_external_url", "open-external-url" -> {
                val url = payload.optString("url").trim()
                if (url.isNotEmpty() && context != null) {
                    try {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                        context.startActivity(intent)
                    } catch (_: Exception) {
                    }
                }
                JSONObject().put("ok", true)
            }

            "open-output-folder", "open_output_folder", "open-file", "open_file" -> {
                JSONObject().put("ok", true)
            }

            else -> {
                JSONObject()
                    .put("ok", false)
                    .put("error", "Unknown ZexTTS command: $cmd")
            }
        }
    }

    private fun resolveDisplayOutputDir(requestedDir: String?): String {
        if (!requestedDir.isNullOrBlank()) return requestedDir.trim()
        return defaultOutputDir.absolutePath
    }

    private fun resolveWritableOutputDir(requestedDir: String?): File {
        val candidates = mutableListOf<File>()
        if (!requestedDir.isNullOrBlank()) {
            candidates.add(File(requestedDir.trim()))
        }
        candidates.add(defaultOutputDir)
        context?.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)?.let {
            candidates.add(File(it, "FlowBrowser"))
        }
        context?.getExternalFilesDir(Environment.DIRECTORY_MUSIC)?.let {
            candidates.add(File(it, "FlowBrowser"))
        }
        candidates.add(fallbackOutputDir)

        for (dir in candidates) {
            try {
                if (!dir.exists()) dir.mkdirs()
                val probe = File(dir, ".write_probe_${UUID.randomUUID().toString().replace("-", "")}.tmp")
                probe.writeBytes(ByteArray(0))
                probe.delete()
                return dir
            } catch (_: Exception) {
            }
        }
        fallbackOutputDir.mkdirs()
        return fallbackOutputDir
    }

    private fun saveAudioFile(
        requestedDir: String?,
        fileName: String,
        bytes: ByteArray,
        onFileSaved: ((String, String) -> Unit)?
    ): String {
        val writableDir = resolveWritableOutputDir(requestedDir)
        var outFile = File(writableDir, fileName)
        var savedDirectToPublicDownloads = false
        try {
            outFile.writeBytes(bytes)
            if (writableDir.absolutePath.equals(defaultOutputDir.absolutePath, ignoreCase = true)) {
                savedDirectToPublicDownloads = true
            }
        } catch (_: Exception) {
            fallbackOutputDir.mkdirs()
            outFile = File(fallbackOutputDir, fileName)
            outFile.writeBytes(bytes)
        }

        // Also publish to Android MediaStore Downloads/FlowBrowser on Android 10+ if not already directly in public Downloads
        if (context != null) {
            if (!savedDirectToPublicDownloads && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                try {
                    val values = ContentValues().apply {
                        put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
                        put(MediaStore.MediaColumns.MIME_TYPE, "audio/mpeg")
                        put(
                            MediaStore.MediaColumns.RELATIVE_PATH,
                            Environment.DIRECTORY_DOWNLOADS + "/FlowBrowser"
                        )
                        put(MediaStore.MediaColumns.IS_PENDING, 1)
                    }
                    val collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                    val uri = context.contentResolver.insert(collection, values)
                    if (uri != null) {
                        context.contentResolver.openOutputStream(uri)?.use { out ->
                            out.write(bytes)
                        }
                        val doneValues = ContentValues().apply {
                            put(MediaStore.MediaColumns.IS_PENDING, 0)
                        }
                        context.contentResolver.update(uri, doneValues, null, null)
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "MediaStore audio save fallback warning: ${e.message}")
                }
            }

            try {
                MediaScannerConnection.scanFile(
                    context,
                    arrayOf(outFile.absolutePath),
                    arrayOf("audio/mpeg"),
                    null
                )
            } catch (_: Exception) {
            }
        }

        val displayPath = if (savedDirectToPublicDownloads) {
            outFile.absolutePath
        } else {
            File(defaultOutputDir, fileName).absolutePath
        }

        try {
            onFileSaved?.invoke(outFile.absolutePath, "audio/mpeg")
        } catch (_: Exception) {
        }

        return displayPath
    }

    private fun tryLoadBundledFallbackVoices(): List<VoiceDto>? {
        val ctx = context ?: return null
        val assetPaths = listOf(
            "www/zextts/voices_fallback.json",
            "zextts/voices_fallback.json"
        )
        for (path in assetPaths) {
            try {
                val raw = ctx.assets.open(path).bufferedReader(Charsets.UTF_8).use { it.readText() }
                val parsed = parseVoiceListJson(raw)
                if (parsed.isNotEmpty()) return parsed
            } catch (_: Exception) {
            }
        }
        return null
    }

    private fun parseVoiceListJson(raw: String): List<VoiceDto> {
        val list = mutableListOf<VoiceDto>()
        try {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val item = arr.optJSONObject(i) ?: continue
                val shortName = item.optString("shortName").ifBlank { item.optString("ShortName") }.trim()
                if (shortName.isEmpty()) continue
                val friendly = item.optString("friendlyName").ifBlank { item.optString("FriendlyName") }.trim()
                val rawName = item.optString("name").ifBlank { item.optString("Name") }.trim()
                val locale = item.optString("locale").ifBlank { item.optString("Locale") }.trim()
                val gender = item.optString("gender").ifBlank { item.optString("Gender") }.trim()
                list.add(
                    VoiceDto(
                        shortName = shortName,
                        name = friendly.ifEmpty { rawName },
                        locale = locale,
                        gender = gender
                    )
                )
            }
        } catch (_: Exception) {
        }
        return list
    }

    private fun serializeVoiceList(voices: List<VoiceDto>): String {
        val arr = JSONArray()
        voices.forEach { arr.put(it.toJson()) }
        return arr.toString()
    }

    private fun listVoices(force: Boolean): List<VoiceDto> {
        val mem = cachedVoices
        if (!force && !mem.isNullOrEmpty()) {
            ioExecutor.execute { ensureClockSkewSynced(false) }
            return mem
        }

        val cacheFile = File(workRoot, "voices_cache_v2.json")
        if (!force && cacheFile.exists()) {
            try {
                val cachedJson = cacheFile.readText(Charsets.UTF_8)
                val loaded = parseVoiceListJson(cachedJson)
                if (loaded.isNotEmpty()) {
                    cachedVoices = loaded
                    ioExecutor.execute { ensureClockSkewSynced(false) }
                    return loaded
                }
            } catch (_: Exception) {
            }
        }

        // Try fetching fresh voice catalog from Microsoft (up to 2 attempts with clock-skew sync)
        for (attempt in 1..2) {
            try {
                val url =
                    "https://$BASE_URL/voices/list?trustedclienttoken=$TRUSTED_CLIENT_TOKEN&Sec-MS-GEC=${generateSecMsGecV2()}&Sec-MS-GEC-Version=$SEC_MS_GEC_VERSION"
                val reqBuilder = Request.Builder().url(url).get()
                addVoiceHeaders(reqBuilder)
                httpClient.newCall(reqBuilder.build()).execute().use { resp ->
                    syncClockSkewFromHeaders(resp)
                    if (!resp.isSuccessful && attempt == 1) {
                        return@use
                    }
                    if (!resp.isSuccessful) {
                        throw IllegalStateException("HTTP ${resp.code}")
                    }
                    val raw = resp.body?.string() ?: ""
                    val list = parseVoiceListJson(raw)
                    if (list.isNotEmpty()) {
                        cachedVoices = list
                        try {
                            cacheFile.writeText(serializeVoiceList(list), Charsets.UTF_8)
                        } catch (_: Exception) {
                        }
                        return list
                    }
                }
            } catch (_: Exception) {
                if (attempt == 1) {
                    ensureClockSkewSynced(true)
                }
            }
        }

        // Fallback to bundled 322-voice catalog so TTS models ALWAYS load even if Microsoft list endpoint is blocked
        val fallback = tryLoadBundledFallbackVoices()
        if (!fallback.isNullOrEmpty()) {
            cachedVoices = fallback
            try {
                cacheFile.writeText(serializeVoiceList(fallback), Charsets.UTF_8)
            } catch (_: Exception) {
            }
            return fallback
        }

        return cachedVoices ?: emptyList()
    }

    private fun previewVoice(payload: JSONObject): JSONObject {
        val voice = payload.optString("voice").trim()
        if (voice.isEmpty()) {
            return JSONObject().put("ok", false).put("error", "No voice selected")
        }

        val rate = getDouble(payload, "rate", 1.0)
        val pitch = getDouble(payload, "pitch", 1.0)
        val volume = getDouble(payload, "volume", 1.0)
        val force = payload.optBoolean("force", false)

        val safeVoice = voice.replace(Regex("[^a-zA-Z0-9_-]"), "_")
        val isDefaultProsody =
            abs(rate - 1.0) < 0.001 && abs(pitch - 1.0) < 0.001 && abs(volume - 1.0) < 0.001
        val previewFile = File(previewsDir, "${safeVoice}_zextts_v1.mp3")

        if (!force && isDefaultProsody && previewFile.exists()) {
            try {
                val cachedBytes = previewFile.readBytes()
                if (cachedBytes.size > 256) {
                    val dataUrl = "data:audio/mpeg;base64," +
                        Base64.encodeToString(cachedBytes, Base64.NO_WRAP)
                    return JSONObject()
                        .put("ok", true)
                        .put("audioUrl", dataUrl)
                        .put("dataUrl", dataUrl)
                        .put("previewPath", previewFile.absolutePath)
                        .put("outputPath", previewFile.absolutePath)
                        .put("source", "cache")
                }
            } catch (_: Exception) {
            }
        }

        val sampleText = "Hello! This is a preview of how I sound in TTS Studio."
        val mp3 = synthesizeChunk(sampleText, voice, rate, pitch, volume)
        if (isDefaultProsody) {
            try {
                previewFile.writeBytes(mp3)
            } catch (_: Exception) {
            }
        }
        val dataUrl = "data:audio/mpeg;base64," + Base64.encodeToString(mp3, Base64.NO_WRAP)
        return JSONObject()
            .put("ok", true)
            .put("audioUrl", dataUrl)
            .put("dataUrl", dataUrl)
            .put("previewPath", previewFile.absolutePath)
            .put("outputPath", previewFile.absolutePath)
            .put("source", "generated")
    }

    private fun generateAudio(
        payload: JSONObject,
        emitProgress: (String, JSONObject) -> Unit,
        onFileSaved: ((String, String) -> Unit)?
    ): JSONObject {
        val text = payload.optString("text")
        val voice = payload.optString("voice").trim()
        val outputDir = payload.optString("outputDir").trim()
        val rate = getDouble(payload, "rate", 1.0)
        val pitch = getDouble(payload, "pitch", 1.0)
        val volume = getDouble(payload, "volume", 1.0)

        if (text.isBlank()) {
            return JSONObject().put("ok", false).put("error", "Enter text first")
        }
        if (voice.isEmpty()) {
            return JSONObject().put("ok", false).put("error", "Select a voice")
        }

        val startMs = System.currentTimeMillis()
        val chunks = splitTextIntoChunks(text.trim(), 2000)
        emitProgress(
            "generation-progress",
            JSONObject()
                .put("phase", "start")
                .put("progress", 0.01)
                .put("currentChunk", 0)
                .put("totalChunks", chunks.size)
        )

        val chunkResults = arrayOfNulls<ByteArray>(chunks.size)
        val completedCount = AtomicInteger(0)
        val sem = Semaphore(3)

        val futures = chunks.indices.map { idx ->
            ioExecutor.submit(Callable {
                sem.acquire()
                try {
                    val bytes = synthesizeChunk(chunks[idx], voice, rate, pitch, volume)
                    chunkResults[idx] = bytes
                    val doneNow = completedCount.incrementAndGet()
                    emitProgress(
                        "generation-progress",
                        JSONObject()
                            .put("phase", "chunk")
                            .put("currentChunk", doneNow)
                            .put("totalChunks", chunks.size)
                            .put("progress", doneNow.toDouble() / chunks.size.toDouble())
                    )
                } finally {
                    sem.release()
                }
            })
        }

        for (f in futures) {
            f.get()
        }

        val combined = ByteArrayOutputStream()
        for (i in chunkResults.indices) {
            val part = chunkResults[i] ?: continue
            combined.write(part)
        }

        val finalBytes = combined.toByteArray()
        val safeVoice = voice.replace(Regex("[^a-zA-Z0-9_-]"), "_")
        val stamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
        val fileName = "tts_studio_${safeVoice}_$stamp.mp3"
        val outPath = saveAudioFile(outputDir, fileName, finalBytes, onFileSaved)
        val elapsedMs = System.currentTimeMillis() - startMs

        emitProgress(
            "generation-progress",
            JSONObject()
                .put("phase", "done")
                .put("progress", 1.0)
                .put("currentChunk", chunks.size)
                .put("totalChunks", chunks.size)
        )

        val dataUrl = "data:audio/mpeg;base64," + Base64.encodeToString(finalBytes, Base64.NO_WRAP)
        return JSONObject()
            .put("ok", true)
            .put("audioUrl", dataUrl)
            .put("dataUrl", dataUrl)
            .put("outputPath", outPath)
            .put("totalChunks", chunks.size)
            .put("elapsedMs", elapsedMs)
    }

    private fun generatePodcast(
        payload: JSONObject,
        emitProgress: (String, JSONObject) -> Unit,
        onFileSaved: ((String, String) -> Unit)?
    ): JSONObject {
        val outputDir = payload.optString("outputDir").trim()
        val rate = getDouble(payload, "rate", 1.0)
        val pitch = getDouble(payload, "pitch", 1.0)
        val volume = getDouble(payload, "volume", 1.0)

        val charVoices = LinkedHashMap<String, String>()
        val charsArr = payload.optJSONArray("characters")
        if (charsArr != null) {
            for (i in 0 until charsArr.length()) {
                val c = charsArr.optJSONObject(i) ?: continue
                val name = c.optString("name").trim()
                val voiceId = c.optString("voiceId").trim()
                if (name.isNotEmpty() && voiceId.isNotEmpty()) {
                    charVoices[name.lowercase(Locale.ROOT)] = voiceId
                }
            }
        }

        val lines = mutableListOf<Pair<String, String>>()
        val diagArr = payload.optJSONArray("dialogue")
        if (diagArr != null) {
            for (i in 0 until diagArr.length()) {
                val l = diagArr.optJSONObject(i) ?: continue
                val spk = l.optString("character").trim()
                val txt = l.optString("text").trim()
                if (txt.isNotEmpty()) {
                    lines.add(spk to txt)
                }
            }
        }

        if (lines.isEmpty()) {
            return JSONObject().put("ok", false).put("error", "Add dialogue lines first")
        }

        val startMs = System.currentTimeMillis()
        val jobId = UUID.randomUUID().toString().replace("-", "").take(8)
        emitProgress(
            "podcast-progress",
            JSONObject()
                .put("phase", "start")
                .put("progress", 0.01)
                .put("current", 0)
                .put("total", lines.size)
        )

        val lineResults = arrayOfNulls<ByteArray>(lines.size)
        val completedCount = AtomicInteger(0)
        val sem = Semaphore(3)

        val futures = lines.indices.map { idx ->
            ioExecutor.submit(Callable {
                sem.acquire()
                try {
                    val (speaker, lineText) = lines[idx]
                    val voiceId = charVoices[speaker.lowercase(Locale.ROOT)]
                        ?.takeIf { it.isNotBlank() }
                        ?: charVoices.values.firstOrNull()
                        ?: "en-US-AriaNeural"
                    val bytes = synthesizeChunk(lineText, voiceId, rate, pitch, volume)
                    lineResults[idx] = bytes
                    val doneNow = completedCount.incrementAndGet()
                    emitProgress(
                        "podcast-progress",
                        JSONObject()
                            .put("phase", "line")
                            .put("speaker", speaker)
                            .put("current", doneNow)
                            .put("total", lines.size)
                            .put("progress", doneNow.toDouble() / lines.size.toDouble())
                    )
                } finally {
                    sem.release()
                }
            })
        }

        for (f in futures) {
            f.get()
        }

        val combined = ByteArrayOutputStream()
        for (i in lineResults.indices) {
            val part = lineResults[i] ?: continue
            combined.write(part)
        }

        val finalBytes = combined.toByteArray()
        val stamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
        val fileName = "podcast_${jobId}_$stamp.mp3"
        val outPath = saveAudioFile(outputDir, fileName, finalBytes, onFileSaved)
        val elapsedMs = System.currentTimeMillis() - startMs

        emitProgress(
            "podcast-progress",
            JSONObject()
                .put("phase", "done")
                .put("progress", 1.0)
                .put("current", lines.size)
                .put("total", lines.size)
        )

        val dataUrl = "data:audio/mpeg;base64," + Base64.encodeToString(finalBytes, Base64.NO_WRAP)
        return JSONObject()
            .put("ok", true)
            .put("jobId", jobId)
            .put("audioUrl", dataUrl)
            .put("dataUrl", dataUrl)
            .put("outputPath", outPath)
            .put("elapsedMs", elapsedMs)
    }

    private fun synthesizeChunk(
        text: String,
        voice: String,
        rate: Double,
        pitch: Double,
        volume: Double
    ): ByteArray {
        ensureClockSkewSynced(false)
        var lastErr: Exception? = null
        for (attempt in 1..3) {
            try {
                return synthesizeChunkCore(text, voice, rate, pitch, volume)
            } catch (e: Exception) {
                lastErr = e
                if (attempt < 3) {
                    ensureClockSkewSynced(true)
                    try {
                        Thread.sleep(350L * attempt)
                    } catch (_: InterruptedException) {
                    }
                }
            }
        }
        throw lastErr ?: IllegalStateException("Speech synthesis failed.")
    }

    private fun synthesizeChunkCore(
        text: String,
        voice: String,
        rate: Double,
        pitch: Double,
        volume: Double
    ): ByteArray {
        val ratePct = ((rate - 1.0) * 100.0).roundToInt()
        val pitchHz = ((pitch - 1.0) * 50.0).roundToInt()
        val volPct = ((volume - 1.0) * 100.0).roundToInt()

        val rateStr = "${if (ratePct >= 0) "+" else ""}$ratePct%"
        val pitchStr = "${if (pitchHz >= 0) "+" else ""}${pitchHz}Hz"
        val volStr = "${if (volPct >= 0) "+" else ""}$volPct%"

        val fullVoice = formatFullVoiceName(voice)
        val escapedText = escapeXml(sanitizeXmlChars(text))

        val ssml =
            "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
                "<voice name='$fullVoice'>" +
                "<prosody pitch='$pitchStr' rate='$rateStr' volume='$volStr'>" +
                escapedText +
                "</prosody></voice></speak>"

        val connectId = UUID.randomUUID().toString().replace("-", "")
        val secMsGec = generateSecMsGecV2()
        val wssUrl =
            "wss://$BASE_URL/edge/v1?TrustedClientToken=$TRUSTED_CLIENT_TOKEN&ConnectionId=$connectId&Sec-MS-GEC=$secMsGec&Sec-MS-GEC-Version=$SEC_MS_GEC_VERSION"

        val sdf = SimpleDateFormat(
            "EEE MMM dd yyyy HH:mm:ss 'GMT+0000 (Coordinated Universal Time)'",
            Locale.US
        ).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
        val ts = sdf.format(Date())

        val configMsg =
            "X-Timestamp:$ts\r\n" +
                "Content-Type:application/json; charset=utf-8\r\n" +
                "Path:speech.config\r\n\r\n" +
                "{\"context\":{\"synthesis\":{\"audio\":{\"metadataoptions\":{\"sentenceBoundaryEnabled\":\"true\",\"wordBoundaryEnabled\":\"false\"},\"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}\r\n"

        val requestId = UUID.randomUUID().toString().replace("-", "")
        val ssmlMsg =
            "X-RequestId:$requestId\r\n" +
                "Content-Type:application/ssml+xml\r\n" +
                "X-Timestamp:${ts}Z\r\n" +
                "Path:ssml\r\n\r\n" +
                ssml

        val req = Request.Builder()
            .url(wssUrl)
            .header("Pragma", "no-cache")
            .header("Cache-Control", "no-cache")
            .header("Origin", "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold")
            .header("User-Agent", USER_AGENT)
            .header("Accept-Language", "en-US,en;q=0.9")
            .header("Cookie", "muid=${generateMuid()};")
            .build()

        val audioOut = ByteArrayOutputStream()
        val latch = CountDownLatch(1)
        val errorRef = AtomicReference<Throwable?>(null)

        val ws = httpClient.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                syncClockSkewFromHeaders(response)
                webSocket.send(configMsg)
                webSocket.send(ssmlMsg)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (text.contains("Path:turn.end")) {
                    try {
                        webSocket.close(1000, null)
                    } catch (_: Exception) {
                    }
                    latch.countDown()
                }
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                val msgBytes = bytes.toByteArray()
                if (msgBytes.size < 2) return
                val headerLen = ((msgBytes[0].toInt() and 0xFF) shl 8) or (msgBytes[1].toInt() and 0xFF)
                if (2 + headerLen > msgBytes.size) return
                val headerText = String(msgBytes, 2, headerLen, Charsets.UTF_8)
                if (headerText.contains("Path:audio")) {
                    val audioOffset = 2 + headerLen
                    val audioCount = msgBytes.size - audioOffset
                    if (audioCount > 0) {
                        synchronized(audioOut) {
                            audioOut.write(msgBytes, audioOffset, audioCount)
                        }
                    }
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                try {
                    webSocket.close(1000, null)
                } catch (_: Exception) {
                }
                latch.countDown()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                latch.countDown()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (response != null) {
                    syncClockSkewFromHeaders(response)
                }
                errorRef.compareAndSet(null, t)
                latch.countDown()
            }
        })

        val finished = latch.await(45, TimeUnit.SECONDS)
        if (!finished) {
            try {
                ws.cancel()
            } catch (_: Exception) {
            }
            throw IllegalStateException("Speech synthesis timed out.")
        }

        val output = synchronized(audioOut) { audioOut.toByteArray() }
        if (output.isEmpty()) {
            val err = errorRef.get()
            if (err != null) throw IllegalStateException(err.message ?: "WebSocket failure", err)
            throw IllegalStateException("No audio received from speech service.")
        }
        return output
    }

    companion object {
        private const val TAG = "ZexTtsService"
        private const val BASE_URL = "speech.platform.bing.com/consumer/speech/synthesize/readaloud"
        private const val TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"
        private const val CHROMIUM_FULL_VERSION = "143.0.3650.75"
        private const val CHROMIUM_MAJOR_VERSION = "143"
        private const val SEC_MS_GEC_VERSION = "2-$CHROMIUM_FULL_VERSION"
        private const val WIN_EPOCH = 11644473600L
        private const val USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$CHROMIUM_MAJOR_VERSION.0.0.0 Safari/537.36 Edg/$CHROMIUM_MAJOR_VERSION.0.0.0"

        @Volatile
        private var clockSkewSeconds: Double = 0.0

        @Volatile
        private var clockSkewSyncedAtMs: Long = 0L

        private val httpClient: OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(25, TimeUnit.SECONDS)
            .readTimeout(45, TimeUnit.SECONDS)
            .writeTimeout(25, TimeUnit.SECONDS)
            .followRedirects(true)
            .build()

        private fun addVoiceHeaders(req: Request.Builder) {
            req.header("Authority", "speech.platform.bing.com")
            req.header("User-Agent", USER_AGENT)
            req.header("Accept-Language", "en-US,en;q=0.9")
            req.header(
                "Sec-CH-UA",
                "\" Not;A Brand\";v=\"99\", \"Microsoft Edge\";v=\"$CHROMIUM_MAJOR_VERSION\", \"Chromium\";v=\"$CHROMIUM_MAJOR_VERSION\""
            )
            req.header("Sec-CH-UA-Mobile", "?0")
            req.header("Accept", "*/*")
            req.header("Sec-Fetch-Site", "none")
            req.header("Sec-Fetch-Mode", "cors")
            req.header("Sec-Fetch-Dest", "empty")
            req.header("Cookie", "muid=${generateMuid()};")
        }

        private fun ensureClockSkewSynced(force: Boolean) {
            val now = System.currentTimeMillis()
            if (!force && now - clockSkewSyncedAtMs < 10 * 60 * 1000L) return
            try {
                val req = Request.Builder()
                    .url("https://$BASE_URL/voices/list?trustedclienttoken=$TRUSTED_CLIENT_TOKEN")
                    .get()
                addVoiceHeaders(req)
                httpClient.newCall(req.build()).execute().use { resp ->
                    syncClockSkewFromHeaders(resp)
                }
            } catch (_: Exception) {
                try {
                    val req2 = Request.Builder()
                        .url("https://www.bing.com/")
                        .head()
                        .build()
                    httpClient.newCall(req2).execute().use { resp2 ->
                        syncClockSkewFromHeaders(resp2)
                    }
                } catch (_: Exception) {
                }
            }
        }

        private fun syncClockSkewFromHeaders(resp: Response) {
            try {
                val serverDate = resp.headers.getDate("Date") ?: return
                val serverSec = serverDate.time / 1000.0
                val localSec = System.currentTimeMillis() / 1000.0
                clockSkewSeconds = serverSec - localSec
                clockSkewSyncedAtMs = System.currentTimeMillis()
            } catch (_: Exception) {
            }
        }

        private fun splitTextIntoChunks(text: String, maxChars: Int): List<String> {
            val result = mutableListOf<String>()
            if (text.isBlank()) return result
            if (text.length <= maxChars) {
                result.add(text)
                return result
            }

            val sentences = text.split(Regex("(?<=[.!?;\\r\\n])\\s+"))
            val current = StringBuilder()
            for (s in sentences) {
                if (s.isBlank()) continue
                if (current.length + s.length + 1 > maxChars && current.isNotEmpty()) {
                    result.add(current.toString().trim())
                    current.clear()
                }
                if (s.length > maxChars) {
                    var i = 0
                    while (i < s.length) {
                        result.add(s.substring(i, min(s.length, i + maxChars)))
                        i += maxChars
                    }
                } else {
                    if (current.isNotEmpty()) current.append(' ')
                    current.append(s)
                }
            }
            if (current.isNotEmpty()) {
                result.add(current.toString().trim())
            }
            return result
        }

        private fun formatFullVoiceName(voice: String): String {
            val trimmed = voice.trim()
            val m = Regex("^([a-z]{2,3}(?:-[A-Za-z]{2,4})?)-([A-Z]{2}|\\d{3})-(.+Neural)$")
                .matchEntire(trimmed)
            if (m != null) {
                val lang = m.groupValues[1]
                var region = m.groupValues[2]
                var name = m.groupValues[3]
                val dashIdx = name.indexOf('-')
                if (dashIdx >= 0) {
                    region = "$region-${name.substring(0, dashIdx)}"
                    name = name.substring(dashIdx + 1)
                }
                return "Microsoft Server Speech Text to Speech Voice ($lang-$region, $name)"
            }
            return trimmed
        }

        private fun sanitizeXmlChars(s: String): String {
            val sb = StringBuilder(s.length)
            for (ch in s) {
                val code = ch.code
                if (code == 9 || code == 10 || code == 13 || code >= 32) {
                    sb.append(ch)
                } else {
                    sb.append(' ')
                }
            }
            return sb.toString()
        }

        private fun escapeXml(s: String): String {
            val sb = StringBuilder(s.length + 16)
            for (ch in s) {
                when (ch) {
                    '&' -> sb.append("&amp;")
                    '<' -> sb.append("&lt;")
                    '>' -> sb.append("&gt;")
                    '"' -> sb.append("&quot;")
                    '\'' -> sb.append("&apos;")
                    else -> sb.append(ch)
                }
            }
            return sb.toString()
        }

        private fun getDouble(obj: JSONObject, prop: String, fallback: Double): Double {
            if (!obj.has(prop)) return fallback
            val raw = obj.opt(prop) ?: return fallback
            if (raw is Number) return raw.toDouble()
            if (raw is String) return raw.toDoubleOrNull() ?: fallback
            return fallback
        }

        private fun generateMuid(): String {
            val buf = ByteArray(16)
            SecureRandom().nextBytes(buf)
            return bytesToHexUpper(buf)
        }

        private fun bytesToHexUpper(bytes: ByteArray): String {
            val hexChars = "0123456789ABCDEF"
            val out = CharArray(bytes.size * 2)
            for (i in bytes.indices) {
                val v = bytes[i].toInt() and 0xFF
                out[i * 2] = hexChars[v ushr 4]
                out[i * 2 + 1] = hexChars[v and 0x0F]
            }
            return String(out)
        }

        // =====================================================================
        // Sec-MS-GEC v2 Token Generator (Port of edge-tts 7.3.1 drm.py)
        // =====================================================================
        private val SHA256_INITIAL = uintArrayOf(
            0x6A09E667u, 0xBB67AE85u, 0x3C6EF372u, 0xA54FF53Au,
            0x510E527Fu, 0x9B05688Cu, 0x1F83D9ABu, 0x5BE0CD19u
        )

        private val SHA256_STATE = uintArrayOf(
            0xFD9FBEA2u, 0x91243CE7u, 0xBE499094u, 0xCD2E1E0Au,
            0x6C006F49u, 0x04BD35ABu, 0xFEB0A7E4u, 0x03EFFBD2u
        )

        private val SHA256_SCHEDULE = uintArrayOf(
            0xEB24BF9Eu, 0x1558691Fu, 0xA0C09EE2u, 0x0CFA32BAu,
            0xA622EE8Cu, 0xD1DD9491u, 0xC0DD25A0u, 0xF9E70AB6u,
            0xF0C31573u, 0x7058CE4Eu, 0x7188E606u, 0x00E5AB33u,
            0xD258B060u, 0x72766564u
        )

        private val SHA256_ROUND_CONSTANTS = uintArrayOf(
            0x428A2F98u, 0x71374491u, 0xB5C0FBCFu, 0xE9B5DBA5u, 0x3956C25Bu, 0x59F111F1u, 0x923F82A4u, 0xAB1C5ED5u,
            0xD807AA98u, 0x12835B01u, 0x243185BEu, 0x550C7DC3u, 0x72BE5D74u, 0x80DEB1FEu, 0x9BDC06A7u, 0xC19BF174u,
            0xE49B69C1u, 0xEFBE4786u, 0x0FC19DC6u, 0x240CA1CCu, 0x2DE92C6Fu, 0x4A7484AAu, 0x5CB0A9DCu, 0x76F988DAu,
            0x983E5152u, 0xA831C66Du, 0xB00327C8u, 0xBF597FC7u, 0xC6E00BF3u, 0xD5A79147u, 0x06CA6351u, 0x14292967u,
            0x27B70A85u, 0x2E1B2138u, 0x4D2C6DFCu, 0x53380D13u, 0x650A7354u, 0x766A0ABBu, 0x81C2C92Eu, 0x92722C85u,
            0xA2BFE8A1u, 0xA81A664Bu, 0xC24B8B70u, 0xC76C51A3u, 0xD192E819u, 0xD6990624u, 0xF40E3585u, 0x106AA070u,
            0x19A4C116u, 0x1E376C08u, 0x2748774Cu, 0x34B0BCB5u, 0x391C0CB3u, 0x4ED8AA4Au, 0x5B9CCA4Fu, 0x682E6FF3u,
            0x748F82EEu, 0x78A5636Fu, 0x84C87814u, 0x8CC70208u, 0x90BEFFFAu, 0xA4506CEBu, 0xBEF9A3F7u, 0xC67178F2u
        )

        private const val SHA256_ADJUSTMENT = 0xC9DC06A7u
        private const val SHA256_SIGMA0_ADJUSTMENT = 0x059C0B80u
        private const val SHA256_SIGMA1_ADJUSTMENT = 0x000B92C0u

        private val CS64_COEFFICIENTS = arrayOf(
            0xE82E91B1u to 0xB32700D0u,
            0x44DE24C6u to 0x88DFF51Du,
            0x3BEB65BCu to 0x29514038u,
            0xC89C5933u to 0xB328CBDFu,
            0x8D1EC211u to 0xD405B4D5u,
            0x314EF5D5u to 0x26E55F3Cu,
            0xE92491B1u to 0x607801C6u,
            0xF0A5B9D5u to 0x82B2C1FBu,
            0x06064CF3u to 0xFA51A3DAu,
            0xDA79FA60u to 0x207CC464u,
            0xBED20560u to 0x3C3C74F3u,
            0x89F9C9F8u to 0xD2D14B61u,
            0x35FA38C6u to 0xBB04A2C1u,
            0xCB49E3C6u to 0xC5626167u
        )

        private const val CS64_FACTOR = 0x82893933u
        private const val CS64_ADJUSTMENT0 = 0xF2F90B1Au
        private const val CS64_ADJUSTMENT1 = 0x0B1A0000u

        private fun rol16(value: UInt): UInt = (value shl 16) or (value shr 16)

        private fun sigma0(v: UInt): UInt =
            (v shr 7) xor (v shl 25) xor (v shr 18) xor (v shl 14) xor (v shr 3)

        private fun sigma1(v: UInt): UInt =
            (v shr 17) xor (v shl 15) xor (v shr 19) xor (v shl 13) xor (v shr 10)

        private fun readUInt32BigEndian(bytes: ByteArray, offset: Int): UInt {
            val b0 = (bytes[offset].toInt() and 0xFF).toUInt()
            val b1 = (bytes[offset + 1].toInt() and 0xFF).toUInt()
            val b2 = (bytes[offset + 2].toInt() and 0xFF).toUInt()
            val b3 = (bytes[offset + 3].toInt() and 0xFF).toUInt()
            return (b0 shl 24) or (b1 shl 16) or (b2 shl 8) or b3
        }

        private fun readUInt32LittleEndian(bytes: ByteArray, offset: Int): UInt {
            val b0 = (bytes[offset].toInt() and 0xFF).toUInt()
            val b1 = (bytes[offset + 1].toInt() and 0xFF).toUInt()
            val b2 = (bytes[offset + 2].toInt() and 0xFF).toUInt()
            val b3 = (bytes[offset + 3].toInt() and 0xFF).toUInt()
            return b0 or (b1 shl 8) or (b2 shl 16) or (b3 shl 24)
        }

        private fun writeUInt32BigEndian(bytes: ByteArray, offset: Int, value: UInt) {
            bytes[offset] = ((value shr 24) and 0xFFu).toByte()
            bytes[offset + 1] = ((value shr 16) and 0xFFu).toByte()
            bytes[offset + 2] = ((value shr 8) and 0xFFu).toByte()
            bytes[offset + 3] = (value and 0xFFu).toByte()
        }

        private fun writeUInt32LittleEndian(bytes: ByteArray, offset: Int, value: UInt) {
            bytes[offset] = (value and 0xFFu).toByte()
            bytes[offset + 1] = ((value shr 8) and 0xFFu).toByte()
            bytes[offset + 2] = ((value shr 16) and 0xFFu).toByte()
            bytes[offset + 3] = ((value shr 24) and 0xFFu).toByte()
        }

        private fun writeUInt64BigEndian(bytes: ByteArray, offset: Int, value: ULong) {
            for (i in 0 until 8) {
                val shift = (7 - i) * 8
                bytes[offset + i] = ((value shr shift) and 0xFFuL).toByte()
            }
        }

        fun generateSecMsGecV2(): String {
            val unixTs = (System.currentTimeMillis() / 1000L).toDouble() + clockSkewSeconds
            var ticks = floor(unixTs).toLong() + WIN_EPOCH
            ticks -= ticks % 300L
            val fileTimeTicks = ticks * 10_000_000L
            val strToHash = "$fileTimeTicks$TRUSTED_CLIENT_TOKEN"
            val data = strToHash.toByteArray(Charsets.US_ASCII)

            val digest = sha256Digest(data)
            val (cs0, cs1) = cs64Digest(data, digest)
            val csBytes = ByteArray(8)
            writeUInt32LittleEndian(csBytes, 0, cs0)
            writeUInt32LittleEndian(csBytes, 4, cs1)

            return "${bytesToHexUpper(csBytes)}-${bytesToHexUpper(digest)}"
        }

        private fun sha256Rounds(state: UIntArray, words: UIntArray, firstRound: Int = 0): UIntArray {
            var a = state[0]
            var b = state[1]
            var c = state[2]
            var d = state[3]
            var e = state[4]
            var f = state[5]
            var g = state[6]
            var h = state[7]

            for (index in firstRound until 64) {
                val k = if (firstRound == 14 && index == 14) {
                    SHA256_ADJUSTMENT
                } else {
                    SHA256_ROUND_CONSTANTS[index]
                }
                val rotE = e.toULong() * 0x100000001uL
                val rotA = a.toULong() * 0x100000001uL
                val s1 = ((rotE shr 6) xor (rotE shr 11) xor (rotE shr 25)).toUInt()
                val ch = g xor (e and (f xor g))
                val t1 = h + s1 + ch + k + words[index]
                val s0 = ((rotA shr 2) xor (rotA shr 13) xor (rotA shr 22)).toUInt()
                val maj = (a and b) or (c and (a or b))
                val t2 = s0 + maj

                h = g
                g = f
                f = e
                e = d + t1
                d = c
                c = b
                b = a
                a = t1 + t2
            }

            return uintArrayOf(a, b, c, d, e, f, g, h)
        }

        private fun expandSha256Schedule(words: UIntArray, firstWord: Int = 16) {
            for (i in firstWord until 64) {
                val x = words[i - 2]
                val y = words[i - 15]
                val s1 = sigma1(x)
                val s0 = sigma0(y)
                words[i] = s1 + words[i - 7] + s0 + words[i - 16]
            }
        }

        private fun sha256Init(first7: ByteArray): UIntArray {
            val words = UIntArray(64)
            val b0 = (first7[0].toInt() and 0xFF).toUInt()
            val b1 = (first7[1].toInt() and 0xFF).toUInt()
            val b2 = (first7[2].toInt() and 0xFF).toUInt()
            words[14] = (b0 shl 16) or (b1 shl 8) or b2
            words[15] = readUInt32BigEndian(first7, 3)

            for (index in 16 until 30) {
                var value = SHA256_SCHEDULE[index - 16]
                if (index - 2 >= 14) {
                    value += if (index == 16) {
                        sigma1(words[index - 2]) xor SHA256_SIGMA1_ADJUSTMENT
                    } else {
                        sigma1(words[index - 2])
                    }
                }
                if (index - 7 >= 14) {
                    value += words[index - 7]
                }
                if (index - 15 >= 14) {
                    value += if (index == 29) {
                        sigma0(words[index - 15]) xor SHA256_SIGMA0_ADJUSTMENT
                    } else {
                        sigma0(words[index - 15])
                    }
                }
                words[index] = value
            }

            words[30] = sigma1(words[28]) + words[23] + sigma0(words[15]) + words[14] +
                SHA256_ADJUSTMENT - SHA256_ROUND_CONSTANTS[14]
            expandSha256Schedule(words, 31)
            val working = sha256Rounds(SHA256_STATE, words, 14)
            val res = UIntArray(8)
            for (i in 0 until 8) {
                res[i] = SHA256_INITIAL[i] + working[i]
            }
            return res
        }

        private fun sha256Digest(data: ByteArray): ByteArray {
            val length = 57 + data.size
            val tailLen = data.size - 7
            val zeroPad = ((55 - length) % 64 + 64) % 64
            val padded = ByteArray(tailLen + 1 + zeroPad + 8)
            System.arraycopy(data, 7, padded, 0, tailLen)
            padded[tailLen] = 0x80.toByte()
            writeUInt64BigEndian(padded, padded.size - 8, length.toULong() * 8uL)

            val first7 = data.copyOfRange(0, 7)
            val state = sha256Init(first7)
            val words = UIntArray(64)
            var offset = 0
            while (offset < padded.size) {
                for (i in 0 until 16) {
                    words[i] = readUInt32BigEndian(padded, offset + i * 4)
                }
                expandSha256Schedule(words, 16)
                val working = sha256Rounds(state, words, 0)
                for (i in 0 until 8) {
                    state[i] = state[i] + working[i]
                }
                offset += 64
            }

            val outBytes = ByteArray(32)
            for (i in 0 until 8) {
                writeUInt32BigEndian(outBytes, i * 4, state[i])
            }
            return outBytes
        }

        private fun wordsLe4Even(dataWithZeroPrefix: ByteArray): List<UInt> {
            val rem = dataWithZeroPrefix.size % 4
            val pad = if (rem == 0) 0 else (4 - rem)
            val padded = ByteArray(dataWithZeroPrefix.size + pad)
            System.arraycopy(dataWithZeroPrefix, 0, padded, 0, dataWithZeroPrefix.size)
            val words = ArrayList<UInt>(padded.size / 4 + 1)
            var i = 0
            while (i < padded.size) {
                words.add(readUInt32LittleEndian(padded, i))
                i += 4
            }
            if (words.size % 2 != 0) {
                words.add(0u)
            }
            return words
        }

        private fun cs64Digest(data: ByteArray, digest: ByteArray): Pair<UInt, UInt> {
            val keyA = readUInt32LittleEndian(digest, 0) or 1u
            val keyB = readUInt32LittleEndian(digest, 4) or 1u
            val factor0 = keyA * CS64_FACTOR
            val factor1 = keyB * CS64_FACTOR

            val terms = ArrayList<UInt>()
            val offsets = ArrayList<UInt>()
            for (i in CS64_COEFFICIENTS.indices) {
                val (coeff, offset) = CS64_COEFFICIENTS[i]
                terms.add(coeff * (if (i % 2 == 0) factor0 else factor1))
                offsets.add(offset)
            }

            val prefixed = ByteArray(1 + data.size)
            System.arraycopy(data, 0, prefixed, 1, data.size)
            val dataWords = wordsLe4Even(prefixed)
            for (index in dataWords.indices) {
                val word = dataWords[index]
                var term = word * (if (index % 2 == 0) keyA else keyB)
                var offset = rol16(word) * (if (index % 2 == 0) 0xEF0569FBu else 0xC31713DBu)
                if (index == 0) {
                    term += CS64_ADJUSTMENT0 * factor0
                    offset += CS64_ADJUSTMENT1
                }
                terms.add(term)
                offsets.add(offset)
            }

            var swapAcc = 0u
            var swapLast = 0u
            var state = 0u
            var acc = 0u
            var index = 0
            while (index < terms.size) {
                val x = terms[index]
                val y = terms[index + 1]
                var t = rol16(offsets[index] + x)
                var q = t * 0x76F50F34u
                swapAcc += rol16(q) * 0xC3EFEA97u + q

                t = rol16(offsets[index + 1] + y)
                q = t * 0x1881CE3Cu
                swapLast = rol16(q) * 0x35BD1EC9u + q
                swapAcc += swapLast

                state = state * keyA + x
                state = rol16(state) * 0xCF98B111u
                state = rol16(state) * 0x87085B9Fu
                state = rol16(state) * 0x12CEB96Du
                state = rol16(state) * 0x257E1D83u
                acc += state

                t = state * keyB + y
                t = rol16(t) * 0xA27416F5u
                t = rol16(t) * 0xD38396FFu
                state = rol16(rol16(t) * 0x7C932B89u) * 0xBFA49F69u
                acc += state

                index += 2
            }

            return (swapLast xor state) to (swapAcc xor acc)
        }
    }
}
