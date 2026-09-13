package ai.narrately.collector

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.Document
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileDocumentManagerListener
import com.intellij.openapi.project.ProjectLocator

class NarratelySaveListener : FileDocumentManagerListener {

    override fun beforeDocumentSaving(document: Document) {
        val file = FileDocumentManager.getInstance().getFile(document) ?: return
        if (!file.isInLocalFileSystem) return

        val project = ProjectLocator.getInstance().guessProjectForFile(file)
        val sink = ApplicationManager.getApplication().getService(NarratelyEventSink::class.java)

        sink.record(
            project = project?.name,
            file = if (project != null) relativePath(project, file) else file.name,
            absolutePath = file.path,
            language = file.extension,
            event = "save",
        )

        if (sink.shouldCaptureSaveDiffs(file.path)) {
            val content = document.text
            if (content.toByteArray(Charsets.UTF_8).size <= MAX_SAVE_DIFF_CONTENT_BYTES) {
                sink.record(
                    project = project?.name,
                    file = if (project != null) relativePath(project, file) else file.name,
                    absolutePath = file.path,
                    language = file.extension,
                    event = "save_diff",
                    content = content,
                )
            }
        }
    }

    companion object {
        private const val MAX_SAVE_DIFF_CONTENT_BYTES = 500 * 1024
    }
}
