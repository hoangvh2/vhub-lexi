package com.vh.lexi.core

import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** A failure of the `enrich` call, sorted by what a batch should do about it. */
class AiError(val kind: Kind, message: String) : Exception(message) {
    enum class Kind { QUOTA, AUTH, INVALID, TEMPORARY }
}

/** Why a batch ended early. */
enum class StopReason { CANCEL, QUOTA, AUTH }

data class BatchProgress(val running: Boolean, val total: Int, val done: Int = 0, val failed: Int = 0, val stopped: StopReason? = null)

/** Has AI already filled this note's meaning? Used to skip or filter notes in a batch. */
fun hasAi(aiFields: Collection<String>): Boolean = "vi" in aiFields

/**
 * Port of web/src/lib/batch.ts: fills the selected notes with AI, [concurrency] calls at a time, saving each note as
 * soon as its answer arrives. Ends early, keeping what was saved, when stopped, when the daily allowance runs out, or
 * when the account is refused. A note that fails twice (or once with an invalid word) is counted and skipped.
 */
class AiBatch(
    private val call: suspend (word: String, pos: String?, en: String?, examples: List<String>) -> Enriched,
    /** The note as it is now: the learner may edit it while the batch runs. */
    private val getNote: (Id) -> Note?,
    private val save: suspend (Note, Map<String, FieldValue>, Set<String>) -> Unit,
    private val concurrency: Int = 3,
    private val retryDelayMs: Long = 4_000,
) {
    private val state = MutableStateFlow<BatchProgress?>(null)
    /** The batch on screen; null once dismissed. */
    val progress: StateFlow<BatchProgress?> = state

    @Volatile private var cancelled = false
    private val lock = Any()

    /** Stops after the calls already in flight; their answers are still saved. */
    fun stop() { cancelled = true }

    fun dismiss() { if (state.value?.running != true) state.value = null }

    private fun update(f: (BatchProgress) -> BatchProgress) = synchronized(lock) { state.value = f(state.value!!) }

    suspend fun run(ids: List<Id>, overwriteVi: Boolean = false): BatchProgress {
        synchronized(lock) {
            check(state.value?.running != true) { "A batch is already running" }
            cancelled = false
            state.value = BatchProgress(running = true, total = ids.size)
        }
        val queue = ArrayDeque(ids)
        fun next(): Id? = synchronized(lock) { if (cancelled || state.value!!.stopped != null) null else queue.removeFirstOrNull() }

        suspend fun one(id: Id) {
            val before = getNote(id)
            val word = before?.takeIf { it.type == "vocab" }?.fields?.get("word").str()
            if (before == null || word.isEmpty()) return update { it.copy(failed = it.failed + 1) }
            var attempt = 0
            while (true) {
                try {
                    val r = call(word, before.fields["pos"].str().ifEmpty { null }, before.fields["en"].str().ifEmpty { null }, before.fields["examples"].items())
                    val now = getNote(id) ?: return update { it.copy(failed = it.failed + 1) }
                    val m = mergeEnrich(now.fields, now.aiFields.toSet(), r, overwriteVi)
                    save(now, m.fields, m.aiFields)
                    return update { it.copy(done = it.done + 1) }
                } catch (e: AiError) {
                    when (e.kind) {
                        AiError.Kind.QUOTA -> return update { it.copy(stopped = StopReason.QUOTA) }
                        AiError.Kind.AUTH -> return update { it.copy(stopped = StopReason.AUTH) }
                        AiError.Kind.INVALID -> return update { it.copy(failed = it.failed + 1) }
                        AiError.Kind.TEMPORARY -> Unit
                    }
                } catch (e: kotlinx.coroutines.CancellationException) {
                    throw e
                } catch (e: Exception) {
                    // Anything unexpected is treated as temporary: one retry, then the note is skipped.
                }
                if (++attempt > 1 || cancelled) return update { it.copy(failed = it.failed + 1) }
                delay(retryDelayMs)
            }
        }

        coroutineScope { repeat(concurrency.coerceAtLeast(1)) { launch { while (true) one(next() ?: break) } } }
        return synchronized(lock) {
            val p = state.value!!
            state.value = p.copy(running = false, stopped = p.stopped ?: if (cancelled && queue.isNotEmpty()) StopReason.CANCEL else null)
            state.value!!
        }
    }

    /**
     * Replacing meanings the learner or a dictionary wrote cannot be undone, so that choice asks first (CLAUDE.md);
     * filling only empty or AI-written fields starts straight away. Null when the learner says no.
     */
    suspend fun confirmAndRun(ids: List<Id>, overwriteVi: Boolean, confirm: suspend (title: String, message: String) -> Boolean): BatchProgress? {
        if (overwriteVi && !confirm(
                "Thay nghĩa tiếng Việt của ${ids.size} từ?",
                "Nghĩa bạn hoặc từ điển đã ghi sẽ bị thay bằng nghĩa theo ngữ cảnh do AI viết. Không hoàn tác được.",
            )
        ) return null
        return run(ids, overwriteVi)
    }
}

/** One line for a toast or the progress card once a batch has ended. */
fun batchSummary(b: BatchProgress): String {
    val tail = if (b.failed > 0) ", ${b.failed} từ lỗi" else ""
    return when (b.stopped) {
        StopReason.QUOTA -> "Hết lượt AI hôm nay: đã điền ${b.done}/${b.total} từ$tail. Mai lọc “Chưa có AI” để chạy tiếp."
        StopReason.AUTH -> "AI cần đăng nhập Google bằng tài khoản được cấp quyền."
        StopReason.CANCEL -> "Đã dừng: điền xong ${b.done}/${b.total} từ$tail."
        null -> "Đã điền AI cho ${b.done}/${b.total} từ$tail."
    }
}
