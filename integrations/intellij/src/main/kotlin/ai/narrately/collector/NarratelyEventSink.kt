package ai.narrately.collector

import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.logger
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URI
import java.nio.file.Files
import java.nio.file.Path
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@Service(Service.Level.APP)
class NarratelyEventSink {

    private val log = logger<NarratelyEventSink>()
    private val queue = ConcurrentLinkedQueue<Map<String, Any?>>()
    private val scheduler = Executors.newSingleThreadScheduledExecutor { runnable ->
        Thread(runnable, "narrately-collector").apply { isDaemon = true }
    }

    private val branchCache = ConcurrentHashMap<String, Pair<String?, Long>>()

    @Volatile
    private var port: Int = DEFAULT_PORT

    @Volatile
    private var captureConfigRoots: List<CaptureConfigRoot> = emptyList()

    private data class CaptureConfigRoot(val path: String, val captureSaveDiffs: Boolean)

    init {
        scheduler.scheduleWithFixedDelay(::flush, FLUSH_SECONDS, FLUSH_SECONDS, TimeUnit.SECONDS)
        scheduler.scheduleWithFixedDelay(::refreshCaptureConfig, 0, CAPTURE_CONFIG_SECONDS, TimeUnit.SECONDS)
    }

    private fun refreshCaptureConfig() {
        try {
            val connection = URI("http://127.0.0.1:$port/capture-config").toURL()
                .openConnection() as HttpURLConnection
            connection.requestMethod = "GET"
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS

            val status = connection.responseCode
            if (status !in 200..299) {
                connection.disconnect()
                return
            }
            val body = connection.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
            connection.disconnect()
            captureConfigRoots = parseCaptureConfig(body)
        } catch (error: Exception) {
            log.debug("Narrately capture-config unreachable: ${error.message}")
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun parseCaptureConfig(body: String): List<CaptureConfigRoot> {
        return try {
            val parsed = MinimalJsonParser(body).parse() as? Map<String, Any?> ?: return emptyList()
            val roots = parsed["roots"] as? List<Any?> ?: return emptyList()
            roots.mapNotNull { entry ->
                val map = entry as? Map<String, Any?> ?: return@mapNotNull null
                val path = map["path"] as? String ?: return@mapNotNull null
                CaptureConfigRoot(path, map["captureSaveDiffs"] as? Boolean ?: false)
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun shouldCaptureSaveDiffs(absolutePath: String?): Boolean {
        if (absolutePath == null) return false
        val normalized = absolutePath.replace('\\', '/').lowercase()
        var best: CaptureConfigRoot? = null
        var bestLen = -1
        for (root in captureConfigRoots) {
            val rootPath = root.path.replace('\\', '/').lowercase()
            if (normalized == rootPath || normalized.startsWith("$rootPath/")) {
                if (rootPath.length > bestLen) {
                    bestLen = rootPath.length
                    best = root
                }
            }
        }
        return best?.captureSaveDiffs ?: false
    }

    fun record(
        project: String?,
        file: String?,
        absolutePath: String?,
        language: String?,
        event: String,
        basePath: String? = null,
        durationSec: Long? = null,
        metrics: Map<String, Long>? = null,
        label: String? = null,
        timestamp: Instant = Instant.now(),
        content: String? = null,
    ) {
        if (queue.size >= MAX_QUEUE) {
            queue.poll()
        }
        queue.add(
            buildMap {
                put("timestamp", timestamp.toString())
                put("source", "intellij")
                put("project", project)
                put("file", file)
                put("absolutePath", absolutePath)
                put("language", language)
                put("event", event)
                put("branch", currentBranch(basePath))
                if (durationSec != null) put("duration_sec", durationSec)
                if (label != null) put("label", label)
                if (metrics != null) put("metrics", metrics)
                if (content != null) put("content", content)
            }
        )
    }

    private fun currentBranch(basePath: String?): String? {
        if (basePath == null) return null
        val cached = branchCache[basePath]
        if (cached != null && System.currentTimeMillis() - cached.second < BRANCH_TTL_MS) {
            return cached.first
        }

        val branch = try {
            val head = Files.readString(Path.of(basePath, ".git", "HEAD")).trim()
            val match = Regex("^ref:\\s*refs/heads/(.+)$").find(head)
            match?.groupValues?.get(1) ?: head.take(8)
        } catch (_: Exception) {
            null
        }
        branchCache[basePath] = branch to System.currentTimeMillis()
        return branch
    }

    fun flush() {
        if (queue.isEmpty()) return

        val batch = ArrayList<Map<String, Any?>>()
        while (batch.size < MAX_BATCH) {
            batch.add(queue.poll() ?: break)
        }
        if (batch.isEmpty()) return

        val payload = """{"events":[${batch.joinToString(",") { encode(it) }}]}"""

        try {
            val connection = URI("http://127.0.0.1:$port/events").toURL()
                .openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.setRequestProperty("Content-Type", "application/json")

            OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { it.write(payload) }

            val status = connection.responseCode
            connection.inputStream?.use { it.readBytes() }
            connection.disconnect()

            if (status !in 200..299) {
                log.debug("Narrately daemon returned $status; re-queueing ${batch.size} event(s)")
                batch.asReversed().forEach { queue.offer(it) }
            }
        } catch (error: Exception) {
            log.debug("Narrately daemon unreachable: ${error.message}")
            batch.asReversed().forEach { queue.offer(it) }
        }
    }

    private fun encode(event: Map<String, Any?>): String =
        event.entries.joinToString(",", prefix = "{", postfix = "}") { (key, value) ->
            "${quote(key)}:${encodeValue(value)}"
        }

    private fun encodeValue(value: Any?): String = when (value) {
        null -> "null"
        is Number -> value.toString()
        is Boolean -> value.toString()
        is Map<*, *> -> value.entries.joinToString(",", prefix = "{", postfix = "}") { (k, v) ->
            "${quote(k.toString())}:${encodeValue(v)}"
        }
        else -> quote(value.toString())
    }

    private fun quote(value: String): String {
        val out = StringBuilder(value.length + 2)
        out.append('"')
        for (char in value) {
            when (char) {
                '"' -> out.append("\\\"")
                '\\' -> out.append("\\\\")
                '\n' -> out.append("\\n")
                '\r' -> out.append("\\r")
                '\t' -> out.append("\\t")
                else -> if (char < ' ') out.append("\\u%04x".format(char.code)) else out.append(char)
            }
        }
        out.append('"')
        return out.toString()
    }

    companion object {
        private const val DEFAULT_PORT = 47821
        private const val FLUSH_SECONDS = 10L
        private const val CAPTURE_CONFIG_SECONDS = 60L
        private const val MAX_QUEUE = 500
        private const val MAX_BATCH = 100
        private const val TIMEOUT_MS = 3000
        private const val BRANCH_TTL_MS = 30_000L
    }
}

private class MinimalJsonParser(private val text: String) {
    private var pos = 0

    fun parse(): Any? {
        skipWhitespace()
        return parseValue()
    }

    private fun parseValue(): Any? {
        skipWhitespace()
        return when (text.getOrNull(pos)) {
            '{' -> parseObject()
            '[' -> parseArray()
            '"' -> parseString()
            't', 'f' -> parseBoolean()
            'n' -> { pos += 4; null }
            else -> parseNumber()
        }
    }

    private fun parseObject(): Map<String, Any?> {
        val map = LinkedHashMap<String, Any?>()
        pos++
        skipWhitespace()
        if (text.getOrNull(pos) == '}') { pos++; return map }
        while (true) {
            skipWhitespace()
            val key = parseString()
            skipWhitespace()
            pos++
            map[key] = parseValue()
            skipWhitespace()
            when (text.getOrNull(pos)) {
                ',' -> { pos++; continue }
                '}' -> { pos++; break }
                else -> break
            }
        }
        return map
    }

    private fun parseArray(): List<Any?> {
        val list = mutableListOf<Any?>()
        pos++
        skipWhitespace()
        if (text.getOrNull(pos) == ']') { pos++; return list }
        while (true) {
            list.add(parseValue())
            skipWhitespace()
            when (text.getOrNull(pos)) {
                ',' -> { pos++; continue }
                ']' -> { pos++; break }
                else -> break
            }
        }
        return list
    }

    private fun parseString(): String {
        pos++
        val sb = StringBuilder()
        while (pos < text.length && text[pos] != '"') {
            val c = text[pos]
            if (c == '\\' && pos + 1 < text.length) {
                pos++
                when (text[pos]) {
                    '"' -> sb.append('"')
                    '\\' -> sb.append('\\')
                    '/' -> sb.append('/')
                    'n' -> sb.append('\n')
                    'r' -> sb.append('\r')
                    't' -> sb.append('\t')
                    'u' -> {
                        val hex = text.substring(pos + 1, pos + 5)
                        sb.append(hex.toInt(16).toChar())
                        pos += 4
                    }
                    else -> sb.append(text[pos])
                }
            } else {
                sb.append(c)
            }
            pos++
        }
        pos++
        return sb.toString()
    }

    private fun parseBoolean(): Boolean =
        if (text.startsWith("true", pos)) { pos += 4; true } else { pos += 5; false }

    private fun parseNumber(): Double {
        val start = pos
        while (pos < text.length && (text[pos].isDigit() || text[pos] in "-+.eE")) pos++
        return text.substring(start, pos).toDouble()
    }

    private fun skipWhitespace() {
        while (pos < text.length && text[pos].isWhitespace()) pos++
    }
}
