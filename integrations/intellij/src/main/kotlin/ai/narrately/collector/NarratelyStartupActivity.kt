package ai.narrately.collector

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorManagerEvent
import com.intellij.openapi.fileEditor.FileEditorManagerListener
import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.xdebugger.XDebugProcess
import com.intellij.xdebugger.XDebuggerManager
import com.intellij.xdebugger.XDebuggerManagerListener

class NarratelyStartupActivity : ProjectActivity {

    override suspend fun execute(project: Project) {
        val app = ApplicationManager.getApplication()
        val sink = app.getService(NarratelyEventSink::class.java)
        val tracker = app.getService(NarratelyActivityTracker::class.java)

        val connection = project.messageBus.connect()

        connection.subscribe(
            FileEditorManagerListener.FILE_EDITOR_MANAGER,
            NarratelyFileEditorListener(project, sink, tracker),
        )

        connection.subscribe(
            XDebuggerManager.TOPIC,
            object : XDebuggerManagerListener {
                override fun processStarted(debugProcess: XDebugProcess) {
                    tracker.markActivity()
                    sink.record(
                        project = project.name,
                        file = null,
                        absolutePath = project.basePath,
                        language = null,
                        event = "debug_start",
                        basePath = project.basePath,
                        label = debugProcess.session?.sessionName ?: "debug session",
                    )
                }

                override fun processStopped(debugProcess: XDebugProcess) {
                    sink.record(
                        project = project.name,
                        file = null,
                        absolutePath = project.basePath,
                        language = null,
                        event = "debug_end",
                        basePath = project.basePath,
                        label = debugProcess.session?.sessionName ?: "debug session",
                    )
                }
            },
        )

        EditorFactory.getInstance().eventMulticaster.addDocumentListener(
            object : DocumentListener {
                override fun documentChanged(event: DocumentEvent) {
                    val file = FileDocumentManager.getInstance().getFile(event.document) ?: return
                    if (!file.isInLocalFileSystem) return

                    val delta = event.newLength - event.oldLength
                    tracker.recordChange(
                        project = project.name,
                        file = relativePath(project, file),
                        absolutePath = file.path,
                        language = file.extension,
                        basePath = project.basePath,
                        linesRemoved = event.oldFragment.count { it == '\n' }.toLong(),
                        linesAdded = event.newFragment.count { it == '\n' }.toLong(),
                        charsChanged = if (delta < 0) -delta.toLong() else delta.toLong(),
                    )
                }
            },
            project,
        )

        val manager = FileEditorManager.getInstance(project)
        manager.selectedEditor?.file?.let { file ->
            sink.record(
                project = project.name,
                file = relativePath(project, file),
                absolutePath = file.path,
                language = file.extension,
                event = "editor_focus_start",
                basePath = project.basePath,
            )
            tracker.onFocus(
                project.name,
                relativePath(project, file),
                file.path,
                file.extension,
                project.basePath,
            )
        }
    }
}

internal fun relativePath(project: Project, file: VirtualFile): String {
    val base = project.basePath ?: return file.name
    val path = file.path
    return if (path.startsWith(base)) path.removePrefix(base).trimStart('/', '\\') else file.name
}

private class NarratelyFileEditorListener(
    private val project: Project,
    private val sink: NarratelyEventSink,
    private val tracker: NarratelyActivityTracker,
) : FileEditorManagerListener {

    override fun selectionChanged(event: FileEditorManagerEvent) {
        tracker.emitBursts()

        event.oldFile?.let { old ->
            sink.record(
                project = project.name,
                file = relativePath(project, old),
                absolutePath = old.path,
                language = old.extension,
                event = "editor_focus_end",
                basePath = project.basePath,
            )
        }

        val newFile = event.newFile
        if (newFile != null) {
            sink.record(
                project = project.name,
                file = relativePath(project, newFile),
                absolutePath = newFile.path,
                language = newFile.extension,
                event = "editor_focus_start",
                basePath = project.basePath,
            )
            tracker.onFocus(
                project.name,
                relativePath(project, newFile),
                newFile.path,
                newFile.extension,
                project.basePath,
            )
        } else {
            tracker.onFocus(project.name, null, null, null, project.basePath)
        }
    }

    override fun fileClosed(source: FileEditorManager, file: VirtualFile) {
        tracker.emitBursts()
        sink.record(
            project = project.name,
            file = relativePath(project, file),
            absolutePath = file.path,
            language = file.extension,
            event = "editor_focus_end",
            basePath = project.basePath,
        )
    }
}
