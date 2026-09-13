package ai.narrately.collector

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

@Service(Service.Level.APP)
class NarratelyActivityTracker {

    private data class Burst(
        val project: String?,
        val file: String?,
        val absolutePath: String?,
        val language: String?,
        val basePath: String?,
        var linesAdded: Long = 0,
        var linesRemoved: Long = 0,
        var charsChanged: Long = 0,
    )

    private val bursts = ConcurrentHashMap<String, Burst>()
    private val lastActivityMs = AtomicLong(System.currentTimeMillis())

    @Volatile
    private var focused: FocusRef? = null

    @Volatile
    private var idle = false

    private data class FocusRef(
        val project: String?,
        val file: String?,
        val absolutePath: String?,
        val language: String?,
        val basePath: String?,
    )

    private val scheduler = Executors.newSingleThreadScheduledExecutor { runnable ->
        Thread(runnable, "narrately-activity").apply { isDaemon = true }
    }

    init {
        scheduler.scheduleWithFixedDelay(::emitBursts, BURST_SECONDS, BURST_SECONDS, TimeUnit.SECONDS)
        scheduler.scheduleWithFixedDelay(::checkIdle, IDLE_CHECK_SECONDS, IDLE_CHECK_SECONDS, TimeUnit.SECONDS)
    }

    private fun sink(): NarratelyEventSink =
        ApplicationManager.getApplication().getService(NarratelyEventSink::class.java)

    fun onFocus(project: String?, file: String?, absolutePath: String?, language: String?, basePath: String?) {
        focused = if (file == null) null else FocusRef(project, file, absolutePath, language, basePath)
        idle = false
        markActivity()
    }

    fun markActivity() {
        val wasIdle = idle
        lastActivityMs.set(System.currentTimeMillis())
        if (!wasIdle) return

        idle = false
        focused?.let { ref ->
            sink().record(
                project = ref.project,
                file = ref.file,
                absolutePath = ref.absolutePath,
                language = ref.language,
                event = "editor_focus_start",
                basePath = ref.basePath,
            )
        }
    }

    fun recordChange(
        project: String?,
        file: String?,
        absolutePath: String?,
        language: String?,
        basePath: String?,
        linesRemoved: Long,
        linesAdded: Long,
        charsChanged: Long,
    ) {
        markActivity()
        val key = absolutePath ?: file ?: return
        val burst = bursts.computeIfAbsent(key) {
            Burst(project, file, absolutePath, language, basePath)
        }
        synchronized(burst) {
            burst.linesAdded += linesAdded
            burst.linesRemoved += linesRemoved
            burst.charsChanged += charsChanged
        }
    }

    fun emitBursts() {
        if (bursts.isEmpty()) return
        val snapshot = bursts.keys.toList()
        for (key in snapshot) {
            val burst = bursts.remove(key) ?: continue
            if (burst.linesAdded == 0L && burst.linesRemoved == 0L && burst.charsChanged == 0L) continue
            sink().record(
                project = burst.project,
                file = burst.file,
                absolutePath = burst.absolutePath,
                language = burst.language,
                event = "edit",
                basePath = burst.basePath,
                metrics = mapOf(
                    "linesAdded" to burst.linesAdded,
                    "linesRemoved" to burst.linesRemoved,
                    "charsChanged" to burst.charsChanged,
                ),
            )
        }
    }

    private fun checkIdle() {
        if (idle) return
        val ref = focused ?: return
        val lastActivity = lastActivityMs.get()
        val sinceMs = System.currentTimeMillis() - lastActivity
        if (sinceMs < IDLE_THRESHOLD_MS) return

        emitBursts()
        idle = true

        sink().record(
            project = ref.project,
            file = ref.file,
            absolutePath = ref.absolutePath,
            language = ref.language,
            event = "editor_focus_end",
            basePath = ref.basePath,
            timestamp = Instant.ofEpochMilli(lastActivity),
        )
        sink().record(
            project = ref.project,
            file = ref.file,
            absolutePath = ref.absolutePath,
            language = ref.language,
            event = "idle",
            basePath = ref.basePath,
            durationSec = sinceMs / 1000,
        )
    }

    companion object {
        private const val BURST_SECONDS = 60L
        private const val IDLE_CHECK_SECONDS = 30L
        private const val IDLE_THRESHOLD_MS = 300_000L
    }
}
