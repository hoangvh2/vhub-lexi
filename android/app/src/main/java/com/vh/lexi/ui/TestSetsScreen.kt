package com.vh.lexi.ui

import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.vh.lexi.LexiApp
import com.vh.lexi.cloud.Account
import com.vh.lexi.core.AiError
import com.vh.lexi.core.Attempt
import com.vh.lexi.core.Chunk
import com.vh.lexi.core.DAILY_QUOTA
import com.vh.lexi.core.Extracted
import com.vh.lexi.core.FieldValue
import com.vh.lexi.core.LETTERS
import com.vh.lexi.core.LC_LAYOUT
import com.vh.lexi.core.LC_PARTS
import com.vh.lexi.core.LcLayout
import com.vh.lexi.core.NumberRange
import com.vh.lexi.core.SetPicture
import com.vh.lexi.core.SetTrack
import com.vh.lexi.core.parseNumberRange
import com.vh.lexi.core.sortTracks
import com.vh.lexi.core.MergedSet
import com.vh.lexi.core.PdfPage
import com.vh.lexi.core.RC_PARTS
import com.vh.lexi.core.SetQuestion
import com.vh.lexi.core.SetSource
import com.vh.lexi.core.TestSet
import com.vh.lexi.core.WrongDrafts
import com.vh.lexi.core.chunkPages
import com.vh.lexi.core.cost
import com.vh.lexi.core.existingSentences
import com.vh.lexi.core.findKey
import com.vh.lexi.core.formatPages
import com.vh.lexi.core.grade
import com.vh.lexi.core.keyNote
import com.vh.lexi.core.keyPairs
import com.vh.lexi.core.letters
import com.vh.lexi.core.mergeExtracted
import com.vh.lexi.core.numbersIn
import com.vh.lexi.core.parsePageRange
import com.vh.lexi.core.reflow
import com.vh.lexi.core.resultFields
import com.vh.lexi.core.summary
import com.vh.lexi.core.wrongDrafts
import com.vh.lexi.ui.theme.Lexi
import com.vh.lexi.util.Pdf
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.util.UUID

/**
 * Bộ đề (web: ui/TestSets.tsx): a whole Reading test imported from a PDF, taken here with a clock, graded per part; the
 * result goes to "Kết quả bài" and the missed questions become cards through the same review as "Nhập câu sai". The
 * test itself stays on this phone (data/TestSets.kt).
 */
@Composable
fun TestSetsScreen(app: LexiApp, onClose: () -> Unit) {
    val store = app.testSets
    val toast = LocalToaster.current
    val sets by store.sets.collectAsState()
    var ready by remember { mutableStateOf(false) }
    var running by rememberSaveable { mutableStateOf<String?>(null) }
    var cards by remember { mutableStateOf<Pair<String, WrongDrafts>?>(null) }
    LaunchedEffect(Unit) {
        try { store.load() } catch (e: CancellationException) { throw e } catch (_: Exception) { toast("Không mở được kho bộ đề trên máy này") }
        ready = true
    }

    val cardsFor = cards
    if (cardsFor != null) {
        ImportScreen(app, preset = cardsFor.second, presetTest = cardsFor.first) { cards = null }
        return
    }
    val current = sets.firstOrNull { it.id == running }
    if (current != null) {
        BackHandler { running = null }
        Runner(app, current, onExit = { running = null }, onCards = { cards = current.name to it })
        return
    }
    BackHandler(onBack = onClose)
    val c = Lexi.colors
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp).testTag("testsets-screen"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ScreenHeader("Bộ đề") { TextButton(onClick = onClose) { Text("Đóng") } }
        PdfImport(app) { s -> toast("Đã lưu bộ đề “${s.name}”") }
        Panel(Modifier.testTag("sets")) {
            // Title, then the pill under it: side by side they squeeze the title to three lines on a 320 dp phone.
            Text("Bộ đề của bạn", fontWeight = FontWeight.ExtraBold, fontSize = 16.sp)
            Pill("Riêng tư · chỉ trên máy này")
            if (ready && sets.isEmpty()) Text("Chưa có bộ đề nào. Nhập một file PDF đề Reading ở trên để làm bài ngay trong Lexi.", fontSize = 13.sp, color = c.muted, modifier = Modifier.testTag("sets-empty"))
            for (s in sets) SetRow(app, s) { running = s.id }
            Text("Nội dung đề là bản sao để bạn tự học: chỉ nằm trong máy này, không đồng bộ, không sao lưu. Kết quả bài và thẻ tạo từ câu sai thì đồng bộ như mọi thẻ khác.", fontSize = 12.sp, color = c.muted)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SetRow(app: LexiApp, set: TestSet, onOpen: () -> Unit) {
    val scope = rememberCoroutineScope()
    val sum = remember(set) { summary(set.questions) }
    val a = set.attempt
    val g = remember(set) { if (a?.finishedAt != null) grade(set.questions, a.answers) else null }
    var asking by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Lexi.colors.surface2).padding(12.dp).testTag("set-row"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(set.name, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (set.section == "lc") Pill("Listening" + if (set.tracks.isNotEmpty()) " · ${set.tracks.size} file nghe" else "", PillKind.OK, Modifier.testTag("set-lc"))
            for (p in LC_PARTS + RC_PARTS) if ((sum.byPart[p.key] ?: 0) > 0) Pill("${p.label}: ${sum.byPart[p.key]}")
            if ((sum.byPart["other"] ?: 0) > 0) Pill("Khác: ${sum.byPart["other"]}")
            when {
                g != null -> Pill("Đã làm: ${g.right}/${g.total}", PillKind.OK, Modifier.testTag("set-score"))
                a != null -> Pill("Đang làm · ${a.answers.size}/${sum.total} câu", PillKind.WARN)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = onOpen, Modifier.weight(1f).testTag("set-open")) { Text(if (g != null) "Xem kết quả" else if (a != null) "Làm tiếp" else "Làm bài") }
            IconButton(onClick = { asking = true }, Modifier.testTag("set-delete")) { Icon(Icons.Filled.Delete, "Xoá ${set.name}") }
        }
    }
    if (asking) ConfirmDialog(
        title = "Xoá bộ đề?",
        message = "“${set.name}”${if (set.tracks.isNotEmpty()) ", file nghe" else ""} và bài làm dở sẽ bị xoá khỏi máy này. Kết quả đã lưu và thẻ đã tạo vẫn giữ nguyên.",
        confirm = "Xoá", destructive = true,
        onConfirm = { asking = false; scope.launch { app.testSets.delete(set.id) } },
        onDismiss = { asking = false },
    )
}

// ------------------------------------------------------------------ import

private class PdfPicked(val fileName: String, val file: File, val pages: List<PdfPage>)

private class PdfDraft(val set: MergedSet, val failed: List<Int>, val stopped: String)

private class AudioPick(val uri: Uri, val name: String, val bytes: Long)

private fun mb(bytes: Long): String =
    if (bytes < 1024 * 1024) "${maxOf(1, Math.round(bytes / 1024.0))} KB"
    else String.format(java.util.Locale.ROOT, if (bytes < 10L * 1024 * 1024) "%.1f MB" else "%.0f MB", bytes / 1024.0 / 1024.0).replace(".", ",")

private fun displayName(context: android.content.Context, uri: Uri): String =
    runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
    }.getOrNull() ?: uri.lastPathSegment?.substringAfterLast('/') ?: "Bộ đề.pdf"

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PdfImport(app: LexiApp, onSaved: (TestSet) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val c = Lexi.colors
    val prefs by app.data.prefs.collectAsState()
    val account by app.cloud.account.collectAsState()
    val pending by app.pendingPdf.collectAsState()
    val available = app.extractOverride != null || (account is Account.SignedIn && prefs.aiEnabled)

    var open by remember { mutableStateOf(false) }
    var picked by remember { mutableStateOf<PdfPicked?>(null) }
    var loading by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var pastedKey by remember { mutableStateOf("") }
    var range by remember { mutableStateOf("") }
    /** Extra turn for scans fed into the copier upside down: 0 or 180. */
    var turn by remember { mutableStateOf(0) }
    var thumb by remember { mutableStateOf<Triple<Int, Int, ImageBitmap>?>(null) }
    var error by remember { mutableStateOf("") }
    var progress by remember { mutableStateOf<Pair<Int, Int>?>(null) }
    var saving by remember { mutableStateOf(false) }
    var draft by remember { mutableStateOf<PdfDraft?>(null) }
    // Listening: the parts printed with nothing but their numbers, the pages kept as photos, and the audio files.
    var section by remember { mutableStateOf("rc") }
    var p1 by remember { mutableStateOf("${LC_LAYOUT.p1!!.first}-${LC_LAYOUT.p1!!.last}") }
    var p2 by remember { mutableStateOf("${LC_LAYOUT.p2!!.first}-${LC_LAYOUT.p2!!.last}") }
    var photoRange by remember { mutableStateOf("") }
    var audio by remember { mutableStateOf(listOf<AudioPick>()) }
    val pendingAudio by app.pendingAudio.collectAsState()

    val p = picked
    // Only the chosen pages are read, and the answer key is looked for among them (a book's key restarts per unit).
    val chosen = remember(p, range) { p?.let { parsePageRange(range, it.pages.size) } }
    val pages = remember(p, chosen) { if (p != null && chosen != null) chosen.map { p.pages[it - 1] } else emptyList() }
    val found = remember(pages) { findKey(pages) }
    val key = remember(found, pastedKey) { LinkedHashMap(found.key).apply { putAll(keyPairs(pastedKey)) } }
    val layout = remember(p1, p2) {
        val a = parseNumberRange(p1)
        val b = parseNumberRange(p2)
        if (a is NumberRange.Invalid || b is NumberRange.Invalid) null else LcLayout((a as? NumberRange.Of)?.range, (b as? NumberRange.Of)?.range)
    }
    val photos = remember(p, photoRange) { if (p == null || photoRange.isBlank()) emptyList() else parsePageRange(photoRange, p.pages.size) }
    val lc = section == "lc"
    val lcReady = !lc || (layout != null && photos != null)
    // Photo pages are kept as pictures, not read: a Part 1 page has nothing but photos and numbers on it.
    val chunks = remember(pages, found, lc, photos) { chunkPages(pages, found.keyPages.toSet() + if (lc) photos.orEmpty() else emptyList()) }
    val units = cost(chunks)
    val scanned = pages.count { it.scanned }
    val firstScan = pages.firstOrNull { it.scanned }?.n
    val whole = p != null && pages.size == p.pages.size

    fun reset() {
        picked = null; draft = null; pastedKey = ""; range = ""; turn = 0; thumb = null; error = ""; open = false
        section = "rc"; photoRange = ""; audio = emptyList()
    }

    fun pick(uri: Uri) {
        if (loading.isNotEmpty()) return
        error = ""
        loading = "Đang mở PDF…"
        scope.launch {
            try {
                val fileName = withContext(Dispatchers.IO) { displayName(context, uri) }
                if (!fileName.endsWith(".pdf", ignoreCase = true) && context.contentResolver.getType(uri)?.contains("pdf") == false) {
                    error = "Chọn một file PDF."
                    return@launch
                }
                val r = withContext(Dispatchers.IO) {
                    val file = Pdf.copyToCache(context, uri)
                    PdfPicked(fileName, file, Pdf.readPages(context, file) { n, of -> loading = "Đang đọc trang $n/$of…" })
                }
                picked = r
                range = ""; turn = 0; thumb = null; draft = null
                name = fileName.replace(Regex("(?i)\\.pdf$"), "").replace(Regex("[_-]+"), " ").trim().take(60).ifEmpty { "Bộ đề" }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Pdf.TooLarge) {
                error = "File lớn quá 150 MB. Tách file thành vài phần rồi thử lại."
            } catch (_: Throwable) {
                error = "Không mở được file này. File có thể bị khoá mật khẩu hoặc hỏng."
            } finally {
                loading = ""
            }
        }
    }

    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) pick(uri) }

    fun pickAudio(uris: List<Uri>) {
        scope.launch {
            val list = withContext(Dispatchers.IO) {
                uris.map { u ->
                    val size = runCatching { context.contentResolver.openAssetFileDescriptor(u, "r")?.use { it.length } }.getOrNull() ?: -1L
                    AudioPick(u, displayName(context, u).take(120), size)
                }.filter { a -> a.name.contains(Regex("(?i)\\.(mp3|m4a|wav|ogg|aac)$")) || context.contentResolver.getType(a.uri)?.startsWith("audio/") == true }
            }
            audio = sortTracks(list) { it.name }
        }
    }
    val audioLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> if (uris.isNotEmpty()) pickAudio(uris) }
    LaunchedEffect(pendingAudio) {
        if (pendingAudio.isNotEmpty()) { val u = pendingAudio; app.pendingAudio.value = emptyList(); pickAudio(u) }
    }
    LaunchedEffect(pending) {
        pending?.let { app.pendingPdf.value = null; open = true; pick(it) }
    }

    // The first scanned page of the choice, small, the way the AI will see it: upside down shows at a glance.
    LaunchedEffect(p, firstScan, turn, draft) {
        if (p == null || firstScan == null || draft != null) return@LaunchedEffect
        thumb = runCatching { withContext(Dispatchers.IO) { Pdf.renderBitmap(p.file, firstScan, turn, 420).asImageBitmap() } }.getOrNull()?.let { Triple(firstScan, turn, it) }
    }

    suspend fun call(images: List<String>, text: String): Extracted = app.extractOverride?.invoke(images, text) ?: app.cloud.extractQuestions(images, text)

    fun read() {
        val pk = picked ?: return
        if (progress != null || !lcReady) return
        // Listening with only Part 1–2 chosen: nothing for the AI, the questions come from their numbers.
        if (chunks.isEmpty() && lc) {
            val set = mergeExtracted(emptyList(), key, layout)
            if (set.questions.isEmpty()) error = "Chưa có câu nào: điền khoảng số câu Part 1–2 hoặc chọn trang Part 3–4."
            else draft = PdfDraft(set, emptyList(), "")
            return
        }
        if (chunks.isEmpty()) return
        error = ""
        scope.launch {
            val results = mutableListOf<Extracted>()
            val failed = sortedSetOf<Int>()
            var stopped = ""
            progress = 0 to chunks.size
            for ((i, ch) in chunks.withIndex()) {
                try {
                    val (images, text) = when (ch) {
                        is Chunk.Text -> emptyList<String>() to (ch.text + keyNote(key, numbersIn(ch.text))).take(12_000)
                        is Chunk.Images -> withContext(Dispatchers.IO) { ch.pages.map { Pdf.renderBase64(pk.file, it, turn) } } to keyNote(key, null).trim()
                    }
                    var r: Extracted? = null
                    for (attempt in 0 until 2) {
                        try {
                            r = call(images, text)
                            break
                        } catch (e: AiError) {
                            if (e.kind == AiError.Kind.QUOTA || e.kind == AiError.Kind.AUTH || attempt == 1) throw e
                        }
                    }
                    results += r!!
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    failed += ch.pages
                    if (e is AiError && (e.kind == AiError.Kind.QUOTA || e.kind == AiError.Kind.AUTH)) {
                        stopped = if (e.kind == AiError.Kind.QUOTA) "Hết lượt AI hôm nay. Phần đã đọc được giữ lại, ngày mai đọc tiếp phần còn thiếu." else e.message.orEmpty()
                        chunks.drop(i + 1).forEach { failed += it.pages }
                        break
                    }
                }
                progress = (i + 1) to chunks.size
            }
            progress = null
            val set = withContext(Dispatchers.Default) { mergeExtracted(results, key, if (lc) layout else null) }
            if (set.questions.isEmpty()) error = stopped.ifEmpty { "Không thấy câu hỏi nào trong file này." }
            else draft = PdfDraft(set, failed.toList(), stopped)
        }
    }

    fun save() {
        val pk = picked ?: return
        val d = draft ?: return
        if (saving) return
        saving = true
        scope.launch {
            try {
                val now = System.currentTimeMillis()
                val id = UUID.randomUUID().toString()
                var questions = d.set.questions
                var tracks = emptyList<SetTrack>()
                var pictures = emptyList<SetPicture>()
                if (lc) {
                    val store = app.testSets
                    tracks = withContext(Dispatchers.IO) {
                        audio.mapIndexed { i, a ->
                            val k = "$id:a$i"
                            val out = store.mediaFile(k)
                            val n = context.contentResolver.openInputStream(a.uri)?.use { input -> out.outputStream().use { input.copyTo(it) } } ?: error("audio")
                            SetTrack(k, a.name, n)
                        }
                    }
                    pictures = withContext(Dispatchers.IO) {
                        photos.orEmpty().map { n ->
                            val k = "$id:p$n"
                            store.mediaFile(k).writeBytes(Pdf.renderJpeg(pk.file, n, turn))
                            SetPicture(1, n, k)
                        }
                    }
                    // As many files as questions (a book with one file per question): each question plays its own.
                    if (tracks.size > 1 && tracks.size == questions.size) questions = questions.mapIndexed { i, q -> q.copy(track = i) }
                }
                val set = TestSet(
                    id = id, name = name.trim().take(60).ifEmpty { "Bộ đề" }, createdAt = now, updatedAt = now, section = section,
                    source = SetSource(pk.fileName.take(120), pages.size, if (range.isNotBlank() && chosen != null) formatPages(chosen) else null),
                    passages = d.set.passages, questions = questions, tracks = tracks, pictures = pictures,
                )
                app.testSets.save(set)
                onSaved(set)
                reset()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                error = "Không lưu được: bộ nhớ máy có thể đã đầy, hoặc không đọc được file nghe."
            } finally {
                saving = false
            }
        }
    }

    Panel(Modifier.testTag("pdf-import")) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.UploadFile, null, tint = c.accent)
            Text("  Nhập đề từ PDF", Modifier.weight(1f), fontWeight = FontWeight.ExtraBold, fontSize = 16.sp)
            if (p == null) TextButton(onClick = { open = !open }, Modifier.testTag("pdf-toggle")) { Text(if (open) "Thu gọn" else "Mở") }
        }
        if (!open && p == null) Text("Một file PDF đề Reading (Part 5–7) hoặc Listening (Part 1–4, kèm file mp3): Lexi đọc chữ ngay trên máy, AI tách từng câu hỏi, bảng đáp án trong file được dò tự động. Xong là làm bài được ngay.", fontSize = 13.sp, color = c.muted)
        if (open && p == null) {
            OutlinedButton(onClick = { launcher.launch(arrayOf("application/pdf")) }, enabled = loading.isEmpty(), modifier = Modifier.fillMaxWidth().testTag("pdf-pick")) { Text("+ Chọn file PDF") }
            if (loading.isNotEmpty()) Text(loading, fontSize = 13.sp, color = c.muted, modifier = Modifier.testTag("pdf-loading"))
        }
        if (error.isNotEmpty()) Pill(error, PillKind.BAD, Modifier.testTag("pdf-error"), wrap = true)

        val dr = draft
        if (p != null && dr == null) {
            FlowRow(Modifier.testTag("pdf-facts"), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Pill(p.fileName)
                Pill(if (whole) "${p.pages.size} trang" else "${pages.size}/${p.pages.size} trang", modifier = Modifier.testTag("pdf-pages"))
                if (scanned > 0) Pill("$scanned trang scan: AI đọc từ ảnh", PillKind.WARN, Modifier.testTag("pdf-scanned"))
                if (found.key.isNotEmpty()) Pill("Bảng đáp án: ${found.key.size} câu (trang ${found.keyPages.joinToString(", ")})", PillKind.OK, Modifier.testTag("pdf-key"), wrap = true)
                else Pill(if (whole) "Không thấy bảng đáp án trong file" else "Không thấy bảng đáp án trong các trang đã chọn", PillKind.WARN, Modifier.testTag("pdf-nokey"), wrap = true)
            }
            OutlinedTextField(
                value = range, onValueChange = { range = it.take(200) }, singleLine = true,
                label = { Text("Trang cần đọc " + if (p.pages.size > 12) "(một bài hoặc một đề, kèm trang đáp án)" else "(để trống = cả file)") },
                placeholder = { Text("vd: 45-60, ${maxOf(1, p.pages.size - 2)}-${p.pages.size}") },
                modifier = Modifier.fillMaxWidth().keepVisibleWhileTyping().testTag("set-range"),
            )
            if (chosen == null) Pill("Trang không hợp lệ: file có ${p.pages.size} trang, viết như “45-60, 290”.", PillKind.BAD, Modifier.testTag("set-range-bad"), wrap = true)
            Row(Modifier.fillMaxWidth().testTag("set-section"), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for ((x, label) in listOf("rc" to "Reading (Part 5–7)", "lc" to "Listening (Part 1–4)")) {
                    FilterChip(selected = section == x, onClick = { section = x }, label = { Text(label, maxLines = 1) }, modifier = Modifier.weight(1f).testTag("set-section-$x"))
                }
            }
            if (lc) Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.surface2).padding(12.dp).testTag("lc-setup"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Part 1–2 chỉ in số câu: Lexi tạo sẵn các câu này, AI chỉ đọc trang Part 3–4. Ở “Trang cần đọc” nên chọn trang Part 3–4 và trang đáp án.", fontSize = 13.sp, color = c.muted)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(value = p1, onValueChange = { p1 = it.take(12) }, singleLine = true, label = { Text("Part 1: câu") }, placeholder = { Text("trống nếu không có") }, modifier = Modifier.weight(1f).keepVisibleWhileTyping().testTag("lc-p1"))
                    OutlinedTextField(value = p2, onValueChange = { p2 = it.take(12) }, singleLine = true, label = { Text("Part 2: câu") }, placeholder = { Text("trống nếu không có") }, modifier = Modifier.weight(1f).keepVisibleWhileTyping().testTag("lc-p2"))
                }
                if (layout == null) Pill("Khoảng số câu viết như “1-6”, hoặc để trống.", PillKind.BAD, Modifier.testTag("lc-layout-bad"), wrap = true)
                OutlinedTextField(value = photoRange, onValueChange = { photoRange = it.take(60) }, singleLine = true, label = { Text("Trang ảnh Part 1 (giữ ảnh để xem khi làm bài)") }, placeholder = { Text("vd: 3-4") }, modifier = Modifier.fillMaxWidth().keepVisibleWhileTyping().testTag("lc-photos"))
                if (photos == null) Pill("Trang không hợp lệ: file có ${p.pages.size} trang.", PillKind.BAD, wrap = true)
                OutlinedButton(onClick = { audioLauncher.launch(arrayOf("audio/*")) }, Modifier.fillMaxWidth().testTag("lc-audio-pick")) { Text(if (audio.isNotEmpty()) "Chọn lại file nghe" else "+ Chọn file mp3") }
                if (audio.isNotEmpty()) {
                    Pill("${audio.size} file · ${mb(audio.sumOf { maxOf(0L, it.bytes) })}", modifier = Modifier.testTag("lc-audio-count"))
                    Column(Modifier.testTag("lc-audio-list")) {
                        audio.take(8).forEachIndexed { i, a -> Text("${i + 1}. ${a.name}", fontSize = 12.sp, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                        if (audio.size > 8) Text("… ${audio.size - 8} file nữa", fontSize = 12.sp, color = c.muted)
                    }
                }
                Text("Phát theo thứ tự số trong tên file. Số file bằng số câu thì mỗi câu có file nghe riêng.", fontSize = 12.sp, color = c.muted)
            }
            if (firstScan != null) Row(Modifier.testTag("pdf-thumb"), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                val t = thumb
                Box(Modifier.size(width = 96.dp, height = 128.dp).clip(RoundedCornerShape(10.dp)).background(c.surface2).border(1.dp, c.line, RoundedCornerShape(10.dp))) {
                    if (t != null && t.first == firstScan && t.second == turn) {
                        Image(t.third, "Trang $firstScan như AI sẽ đọc", Modifier.fillMaxSize().testTag("pdf-thumb-img-$turn"), contentScale = ContentScale.Fit)
                    } else Text("Đang dựng trang $firstScan…", Modifier.padding(8.dp), fontSize = 11.sp, color = c.muted)
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Trang $firstScan như AI sẽ đọc. Chữ bị ngược thì xoay lại cho đúng chiều.", fontSize = 13.sp)
                    if (turn != 0) Text("Đã xoay 180°", fontSize = 12.sp, color = c.muted)
                    OutlinedButton(onClick = { turn = if (turn == 0) 180 else 0 }, Modifier.testTag("pdf-turn")) {
                        Icon(Icons.Filled.Refresh, null)
                        Text(if (turn != 0) " Bỏ xoay" else " Xoay 180°", maxLines = 1)
                    }
                }
            }
            OutlinedTextField(value = name, onValueChange = { name = it.take(60) }, singleLine = true, label = { Text("Tên bộ đề") }, modifier = Modifier.fillMaxWidth().keepVisibleWhileTyping().testTag("set-name"))
            OutlinedTextField(
                value = pastedKey, onValueChange = { pastedKey = it.take(4000) }, minLines = 2, maxLines = 4,
                label = { Text("Dán bảng đáp án " + if (found.key.isNotEmpty()) "(bổ sung, không bắt buộc)" else "(nên có để chấm điểm)") },
                placeholder = { Text("vd: 101 A 102 C 103 B …") }, modifier = Modifier.fillMaxWidth().keepVisibleWhileTyping().testTag("set-key"),
            )
            if (pastedKey.isNotBlank()) Text("Đọc được ${keyPairs(pastedKey).size} đáp án", fontSize = 12.sp, color = c.muted, modifier = Modifier.testTag("set-key-count"))
            if (units > DAILY_QUOTA) Pill("Chừng này trang cần ≈ $units lượt AI, quá hạn mức $DAILY_QUOTA lượt/ngày: chọn ít trang hơn (vd một bài), phần còn lại nhập ngày sau.", PillKind.WARN, Modifier.testTag("pdf-over-quota"), wrap = true)
            if (!available) Text("Cần đăng nhập Google và bật “Điền bằng AI” trong Cài đặt để AI tách câu hỏi.", fontSize = 13.sp, color = c.muted, modifier = Modifier.testTag("pdf-off"))
            val pr = progress
            if (pr != null) Column(Modifier.testTag("pdf-progress"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Đang đọc phần ${minOf(pr.first + 1, pr.second)}/${pr.second}…", fontSize = 13.sp, color = c.muted)
                LinearProgressIndicator(progress = { pr.first.toFloat() / pr.second }, modifier = Modifier.fillMaxWidth())
            } else {
                if (lc && chunks.isEmpty()) Button(onClick = ::read, enabled = lcReady, modifier = Modifier.fillMaxWidth().testTag("pdf-read")) {
                    Icon(Icons.Filled.Check, null); Text("  Tạo câu Part 1–2 (không cần AI)")
                } else Button(onClick = ::read, enabled = available && chunks.isNotEmpty() && units <= DAILY_QUOTA && lcReady, modifier = Modifier.fillMaxWidth().testTag("pdf-read")) {
                    Icon(Icons.Filled.AutoAwesome, null); Text("  Tách câu hỏi (${chunks.size} phần, ≈ $units lượt AI)")
                }
                TextButton(onClick = ::reset) { Text("Huỷ") }
            }
        }

        if (dr != null) {
            val sum = remember(dr) { summary(dr.set.questions) }
            Column(Modifier.testTag("pdf-preview"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Pill("${sum.total} câu", PillKind.OK, Modifier.testTag("pdf-total"))
                    for (x in LC_PARTS + RC_PARTS) if ((sum.byPart[x.key] ?: 0) > 0) Pill("${x.label}: ${sum.byPart[x.key]}", modifier = Modifier.testTag("pdf-total-${x.key}"))
                    if (dr.set.passages.isNotEmpty()) Pill("${dr.set.passages.size} đoạn đọc")
                    if (lc) Pill(
                        if (audio.isEmpty()) "Chưa có file nghe" else "${audio.size} file nghe" + if (audio.size > 1 && audio.size == sum.total) ", mỗi câu một file" else "",
                        modifier = Modifier.testTag("pdf-audio"),
                    )
                }
                if (dr.stopped.isNotEmpty()) Pill(dr.stopped, PillKind.WARN, wrap = true)
                if (dr.failed.isNotEmpty()) Pill("Chưa đọc được trang ${dr.failed.joinToString(", ")}. Có thể lưu phần đã có rồi nhập lại các trang này sau.", PillKind.WARN, Modifier.testTag("pdf-failed"), wrap = true)
                if (sum.missing.isNotEmpty()) Pill("Thiếu câu ${sum.missing.take(12).joinToString(", ")}${if (sum.missing.size > 12) "…" else ""}: đối chiếu với đề gốc", PillKind.WARN, Modifier.testTag("pdf-missing"), wrap = true)
                if (sum.noAnswer > 0) Text("${sum.noAnswer} câu chưa có đáp án: chọn bên dưới, hoặc để trống (câu đó không được chấm).", fontSize = 13.sp, color = c.muted, modifier = Modifier.testTag("pdf-noanswer"))
                for (q in dr.set.questions.filter { it.correct == null || "key-differs" in it.flags }.take(40)) {
                    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.surface2).padding(10.dp).testTag("pdf-fix"), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("Câu ${q.number ?: (q.i + 1)}. ${q.stem}", fontSize = 14.sp)
                        if ("key-differs" in q.flags) Pill("AI đọc khác bảng đáp án, Lexi dùng bảng đáp án", PillKind.WARN, wrap = true)
                        val allowed = q.letters()
                        for (l in LETTERS) {
                            val ok = l in allowed
                            Row(
                                Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable(enabled = ok) {
                                    draft = PdfDraft(dr.set.copy(questions = dr.set.questions.map { if (it.i == q.i) it.copy(correct = l) else it }), dr.failed, dr.stopped)
                                }.testTag("pdf-fix-$l"),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                RadioButton(selected = q.correct == l, onClick = null, enabled = ok, modifier = Modifier.padding(6.dp))
                                Text("$l  ${q.options[l].orEmpty().ifEmpty { if (q.kind == "listen") "" else "—" }}", fontSize = 14.sp, color = if (ok) c.ink else c.muted)
                            }
                        }
                    }
                }
                Button(onClick = ::save, enabled = !saving, modifier = Modifier.fillMaxWidth().testTag("pdf-save")) { Icon(Icons.Filled.Check, null); Text(if (saving) "  Đang lưu…" else "  Lưu bộ đề") }
                TextButton(onClick = ::reset) { Text("Bỏ") }
            }
        }
    }
}

// ------------------------------------------------------------------ taking the test

private fun clock(ms: Long): String {
    val s = ms / 1000
    val h = s / 3600
    val mm = ((s % 3600) / 60).toString().padStart(2, '0')
    val ss = (s % 60).toString().padStart(2, '0')
    return if (h > 0) "$h:$mm:$ss" else "$mm:$ss"
}

/** One row of the test: a part heading, a passage, or a question. */
private sealed class Line {
    data class Head(val part: Int?) : Line()
    data class Passage(val index: Int) : Line()
    data class Question(val q: SetQuestion) : Line()
}

/** The test in order: a part heading where the part changes, each passage once above its first question. */
private fun linesOf(questions: List<SetQuestion>): List<Line> {
    val out = mutableListOf<Line>()
    var lastPart: Int? = -1
    var lastPassage: Int? = null
    for (q in questions) {
        if (q.part != lastPart) out += Line.Head(q.part)
        val passage = q.passage
        if (passage != null && passage != lastPassage) out += Line.Passage(passage)
        lastPart = q.part
        lastPassage = q.passage
        out += Line.Question(q)
    }
    return out
}

@Composable
private fun Runner(app: LexiApp, set: TestSet, onExit: () -> Unit, onCards: (WrongDrafts) -> Unit) {
    val scope = rememberCoroutineScope()
    val c = Lexi.colors
    var attempt by remember(set.id) { mutableStateOf(set.attempt ?: Attempt(System.currentTimeMillis(), 0, emptyMap())) }
    val finished = attempt.finishedAt != null
    var resumed by remember(set.id) { mutableLongStateOf(System.currentTimeMillis()) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val elapsed = attempt.elapsedMs + if (finished) 0 else now - resumed
    var submitting by remember { mutableStateOf(false) }
    var restarting by remember { mutableStateOf(false) }
    val toast = LocalToaster.current
    val player = remember(set.id) { if (set.tracks.isEmpty()) null else ListenPlayer(set.tracks, app.testSets::mediaFile) { toast(it) } }
    val perQuestion = set.questions.any { it.track != null }
    if (player != null) {
        LaunchedEffect(player) { while (true) { player.tick(); delay(250) } }
        DisposableEffect(player) { onDispose { player.release() } }
    }

    fun persist(a: Attempt, rebase: Boolean = false) {
        if (rebase) resumed = System.currentTimeMillis()
        attempt = a
        // The app's scope, not the screen's: the last answer is still written when the screen closes.
        app.testSets.saveSoon(app.scope, set.copy(attempt = a))
    }
    // Leaving the screen (or the app) pauses the clock and keeps the answers.
    fun pause() {
        if (attempt.finishedAt == null) persist(attempt.copy(elapsedMs = attempt.elapsedMs + (System.currentTimeMillis() - resumed)), rebase = true)
    }
    LaunchedEffect(finished) { while (!finished) { now = System.currentTimeMillis(); delay(1000) } }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, finished) {
        val obs = LifecycleEventObserver { _, e ->
            if (e == Lifecycle.Event.ON_STOP) { player?.pause(); pause() } else if (e == Lifecycle.Event.ON_START) { resumed = System.currentTimeMillis(); now = resumed }
        }
        lifecycle.addObserver(obs)
        onDispose { lifecycle.removeObserver(obs); pause() }
    }

    Column(Modifier.fillMaxSize().testTag("runner")) {
        // Two rows: on a narrow phone the name, the clock, the count and "Nộp bài" do not fit on one.
        Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 16.dp, top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onExit, Modifier.testTag("runner-exit")) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Bộ đề") }
            Text(set.name, Modifier.weight(1f), fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Pill(clock(elapsed), modifier = Modifier.testTag("runner-clock"))
            if (!finished) Pill("${attempt.answers.size}/${set.questions.size} câu", modifier = Modifier.testTag("runner-count"))
            Box(Modifier.weight(1f))
            if (!finished) Button(onClick = { submitting = true }, Modifier.testTag("runner-submit")) { Text("Nộp bài") }
        }
        if (player != null && !perQuestion) ListenBar(set, player)
        if (finished) Result(app, set, attempt, player, onCards = onCards, onAgain = { restarting = true }, onSaved = { id -> persist(attempt.copy(resultNoteId = id)) })
        else Questions(app, set, attempt.answers, review = false, player = player) { q, l -> persist(attempt.copy(answers = attempt.answers + (q.i to l))) }
    }
    if (submitting) {
        val left = set.questions.size - attempt.answers.size
        ConfirmDialog(
            title = "Nộp bài?", message = if (left > 0) "Còn $left câu chưa làm, sẽ tính là sai." else "Lexi chấm ngay theo bảng đáp án.", confirm = "Nộp bài",
            onConfirm = { submitting = false; player?.pause(); persist(attempt.copy(elapsedMs = elapsed, finishedAt = System.currentTimeMillis()), rebase = true) },
            onDismiss = { submitting = false },
        )
    }
    if (restarting) ConfirmDialog(
        title = "Làm lại từ đầu?", message = "Các lựa chọn của lần này bị xoá. Kết quả đã lưu vào “Kết quả bài” vẫn giữ.", confirm = "Làm lại", destructive = true,
        onConfirm = { restarting = false; persist(Attempt(System.currentTimeMillis(), 0, emptyMap()), rebase = true) },
        onDismiss = { restarting = false },
    )
}

@Composable
private fun Questions(app: LexiApp, set: TestSet, answers: Map<Int, String>, review: Boolean, player: ListenPlayer?, shown: List<SetQuestion> = set.questions, header: @Composable () -> Unit = {}, onChoose: (SetQuestion, String) -> Unit = { _, _ -> }) {
    val c = Lexi.colors
    val lines = remember(shown) { linesOf(shown) }
    LazyColumn(Modifier.fillMaxSize().testTag("runner-list"), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { header() }
        items(lines) { l ->
            when (l) {
                is Line.Head -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(l.part?.let { "Part $it" } ?: "Câu khác", fontWeight = FontWeight.ExtraBold, fontSize = 17.sp, modifier = Modifier.padding(top = 6.dp))
                    val part = l.part
                    if (part != null && part <= 4) Pictures(app, set, part)
                }
                is Line.Passage -> Panel(Modifier.testTag("runner-passage")) {
                    val p = set.passages[l.index]
                    if (p.label.isNotEmpty()) Text(p.label, fontSize = 12.sp, color = c.muted, fontWeight = FontWeight.Bold)
                    Text(reflow(p.text), fontSize = 15.sp, lineHeight = 22.sp)
                }
                is Line.Question -> QuestionCard(l.q, answers[l.q.i], review, player) { onChoose(l.q, it) }
            }
        }
    }
}

@Composable
private fun QuestionCard(q: SetQuestion, pick: String?, review: Boolean, player: ListenPlayer?, onChoose: (String) -> Unit) {
    val c = Lexi.colors
    val wrong = review && q.correct != null && pick != q.correct
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(c.surface).border(if (wrong) 2.dp else 1.dp, if (wrong) c.againSoft else c.line, RoundedCornerShape(22.dp)).padding(14.dp).testTag("runner-q"),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        val own = q.track
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("${q.number ?: (q.i + 1)}. " + q.stem.ifEmpty { "Nghe và chọn đáp án" }, Modifier.weight(1f), fontSize = 15.sp, lineHeight = 21.sp)
            if (player != null && own != null) {
                val on = player.track == own && player.playing
                TextButton(onClick = { if (on) player.pause() else player.play(own) }, Modifier.testTag("q-play")) {
                    Icon(if (on) Icons.Filled.Pause else Icons.Filled.PlayArrow, null)
                    Text(if (on) " Dừng" else " Nghe")
                }
            }
        }
        for (l in q.letters()) {
            val right = review && l == q.correct
            val bad = review && l == pick && l != q.correct
            val on = !review && pick == l
            val bg = when { right -> c.mintSoft; bad -> c.againSoft; on -> c.accentSoft; else -> c.surface2 }
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(bg).clickable(enabled = !review) { onChoose(l) }.padding(horizontal = 6.dp, vertical = 2.dp).testTag("opt-$l"),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RadioButton(selected = pick == l, onClick = null, enabled = !review, modifier = Modifier.padding(6.dp))
                Text(l, fontWeight = FontWeight.Bold)
                Text("  " + q.options[l].orEmpty(), fontSize = 14.sp)
            }
        }
        if (review && q.correct == null) Pill("Chưa có đáp án, không chấm")
        if (wrong && pick == null) Pill("Bỏ trống", PillKind.BAD)
        if (review && q.rule.isNotEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Pill("AI", PillKind.AI)
            Text(q.rule, fontSize = 13.sp, color = c.muted)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Result(app: LexiApp, set: TestSet, attempt: Attempt, player: ListenPlayer?, onCards: (WrongDrafts) -> Unit, onAgain: () -> Unit, onSaved: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    val toast = LocalToaster.current
    val c = Lexi.colors
    val notes by app.data.notes.collectAsState()
    val g = remember(set, attempt) { grade(set.questions, attempt.answers) }
    val existing = remember(notes) { existingSentences(notes) }
    var onlyWrong by remember { mutableStateOf(true) }
    val saved = attempt.resultNoteId != null && notes.any { it.id == attempt.resultNoteId }
    val wrongSet = g.wrong.toSet()
    val shown = if (onlyWrong) set.questions.filter { it.i in wrongSet } else set.questions

    fun saveResult() {
        scope.launch {
            val date = Instant.ofEpochMilli(attempt.finishedAt ?: System.currentTimeMillis()).atZone(ZoneId.systemDefault()).toLocalDate().toString()
            val n = app.data.addNote("test", resultFields(set.name, date, g, attempt.elapsedMs).mapValues { FieldValue.Text(it.value) })
            onSaved(n.id)
            toast("Đã lưu vào Kết quả bài")
        }
    }

    Questions(app, set, attempt.answers, review = true, player = player, shown = shown, header = {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Panel(Modifier.testTag("runner-result")) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Đúng", fontSize = 12.sp, color = c.muted)
                        Text("${g.right}/${g.total}", fontSize = 30.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.testTag("result-score"))
                    }
                    Pill(clock(attempt.elapsedMs), modifier = Modifier.testTag("result-time"))
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    g.lc?.let { Pill("LC: $it", PillKind.OK, Modifier.testTag("result-lc")) }
                    for (p in LC_PARTS) g.lcParts[p.key]?.let { Pill("${p.label}: $it", modifier = Modifier.testTag("result-${p.key}")) }
                    for (p in RC_PARTS) g.parts[p.key]?.let { Pill("${p.label}: $it", modifier = Modifier.testTag("result-${p.key}")) }
                    if (g.ungraded > 0) Pill("${g.ungraded} câu không chấm")
                }
                Button(onClick = ::saveResult, enabled = !saved, modifier = Modifier.fillMaxWidth().testTag("result-save")) {
                    if (saved) { Icon(Icons.Filled.Check, null); Text("  Đã lưu vào Kết quả bài") } else Text("Lưu vào Kết quả bài")
                }
                OutlinedButton(
                    onClick = {
                        val w = wrongDrafts(set, g, existing)
                        if (w.drafts.isEmpty() && w.passages.isEmpty()) toast("Không có câu sai nào để tạo thẻ") else onCards(w)
                    },
                    enabled = g.wrong.isNotEmpty(), modifier = Modifier.fillMaxWidth().testTag("result-cards"),
                ) { Icon(Icons.Filled.AutoAwesome, null); Text("  Tạo thẻ từ ${g.wrong.size} câu sai") }
                TextButton(onClick = onAgain, Modifier.testTag("result-again")) { Text("Làm lại") }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(if (onlyWrong) "Câu sai (${g.wrong.size})" else "Tất cả (${set.questions.size})", Modifier.weight(1f), fontWeight = FontWeight.ExtraBold, fontSize = 16.sp)
                TextButton(onClick = { onlyWrong = !onlyWrong }, Modifier.testTag("result-toggle")) { Text(if (onlyWrong) "Xem cả bài" else "Chỉ câu sai") }
            }
        }
    })
}

private fun mmss(ms: Int): String { val s = ms / 1000; return "${s / 60}:${(s % 60).toString().padStart(2, '0')}" }

/** The test's audio played straight through, as in the exam room: play and pause, no seeking. */
@Composable
private fun ListenBar(set: TestSet, player: ListenPlayer) {
    val n = set.tracks.size
    val at = player.track
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp).testTag("listen-bar"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Button(onClick = player::toggle, Modifier.testTag("listen-toggle")) {
            Icon(if (player.playing) Icons.Filled.Pause else Icons.Filled.PlayArrow, null)
            Text(if (player.playing) " Tạm dừng" else if (at == null) " Bắt đầu nghe" else " Nghe tiếp")
        }
        Text(
            if (at == null) "$n file nghe" else "File ${at + 1}/$n · ${mmss(player.atMs)} / ${mmss(player.durationMs)}",
            Modifier.weight(1f).testTag("listen-pos"), fontSize = 13.sp, color = Lexi.colors.muted, maxLines = 2,
        )
    }
}

/** Part 1 photos, the pages kept as pictures at import, read from the set's own folder. */
@Composable
private fun Pictures(app: LexiApp, set: TestSet, part: Int) {
    val list = remember(set.id, part) { set.pictures.filter { it.part == part } }
    if (list.isEmpty()) return
    Column(Modifier.testTag("runner-pictures"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (p in list) {
            val img by produceState<ImageBitmap?>(null, p.key) {
                val b = withContext(Dispatchers.IO) { runCatching { android.graphics.BitmapFactory.decodeFile(app.testSets.mediaFile(p.key).path)?.asImageBitmap() }.getOrNull() }
                value = b
            }
            val b = img
            if (b != null) Image(b, "Trang ${p.page}", Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).border(1.dp, Lexi.colors.line, RoundedCornerShape(14.dp)).testTag("runner-picture"), contentScale = ContentScale.FillWidth)
            else Text("Trang ${p.page}…", fontSize = 13.sp, color = Lexi.colors.muted)
        }
    }
}
