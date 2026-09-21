package com.flowbrowser.app

import android.content.res.AssetManager
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Tiny localhost HTTP server that serves assets/www for the shell WebView.
 * Avoids file:// CORS / mixed-content issues (same role as Windows flowbrowser.local).
 */
class WwwServer(
    private val assets: AssetManager,
    private val assetRoot: String = "www"
) {
    private var serverSocket: ServerSocket? = null
    private val running = AtomicBoolean(false)
    private val pool = Executors.newCachedThreadPool()

    @Volatile
    var port: Int = 0
        private set

    val baseUrl: String
        get() = "http://127.0.0.1:$port"

    fun start(): Int {
        if (running.get()) return port
        val ss = ServerSocket(0)
        serverSocket = ss
        port = ss.localPort
        running.set(true)
        pool.execute {
            while (running.get()) {
                try {
                    val socket = ss.accept()
                    pool.execute { handleClient(socket) }
                } catch (_: Exception) {
                    if (!running.get()) break
                }
            }
        }
        return port
    }

    fun stop() {
        running.set(false)
        try {
            serverSocket?.close()
        } catch (_: Exception) {
        }
        serverSocket = null
        pool.shutdownNow()
    }

    private fun handleClient(socket: Socket) {
        socket.use { sock ->
            val input = BufferedReader(InputStreamReader(sock.getInputStream()))
            val requestLine = input.readLine() ?: return
            // Drain headers
            while (true) {
                val line = input.readLine() ?: break
                if (line.isEmpty()) break
            }

            val parts = requestLine.split(" ")
            if (parts.size < 2 || parts[0] != "GET") {
                writeResponse(sock.getOutputStream(), 405, "text/plain", "Method Not Allowed".toByteArray())
                return
            }

            var path = parts[1].substringBefore('?')
            if (path == "/" || path.isEmpty()) path = "/ui/app-shell.html"
            path = path.trimStart('/')
            // Prevent path traversal
            if (path.contains("..")) {
                writeResponse(sock.getOutputStream(), 403, "text/plain", "Forbidden".toByteArray())
                return
            }

            val assetPath = "$assetRoot/$path"
            try {
                val bytes = assets.open(assetPath).use { stream ->
                    stream.readBytes()
                }
                writeResponse(sock.getOutputStream(), 200, mimeFor(path), bytes)
            } catch (_: Exception) {
                writeResponse(sock.getOutputStream(), 404, "text/plain", "Not Found".toByteArray())
            }
        }
    }

    private fun writeResponse(out: OutputStream, code: Int, mime: String, body: ByteArray) {
        val status = when (code) {
            200 -> "OK"
            403 -> "Forbidden"
            404 -> "Not Found"
            405 -> "Method Not Allowed"
            else -> "Error"
        }
        val headers = buildString {
            append("HTTP/1.1 $code $status\r\n")
            append("Content-Type: $mime\r\n")
            append("Content-Length: ${body.size}\r\n")
            append("Access-Control-Allow-Origin: *\r\n")
            append("Cache-Control: no-cache\r\n")
            append("Connection: close\r\n")
            append("\r\n")
        }
        out.write(headers.toByteArray(Charsets.US_ASCII))
        out.write(body)
        out.flush()
    }

    private fun mimeFor(path: String): String {
        val lower = path.lowercase()
        return when {
            lower.endsWith(".html") -> "text/html; charset=utf-8"
            lower.endsWith(".js") -> "application/javascript; charset=utf-8"
            lower.endsWith(".css") -> "text/css; charset=utf-8"
            lower.endsWith(".json") -> "application/json; charset=utf-8"
            lower.endsWith(".png") -> "image/png"
            lower.endsWith(".jpg") || lower.endsWith(".jpeg") -> "image/jpeg"
            lower.endsWith(".svg") -> "image/svg+xml"
            lower.endsWith(".woff") -> "font/woff"
            lower.endsWith(".woff2") -> "font/woff2"
            lower.endsWith(".ttf") -> "font/ttf"
            lower.endsWith(".eot") -> "application/vnd.ms-fontobject"
            else -> "application/octet-stream"
        }
    }
}
