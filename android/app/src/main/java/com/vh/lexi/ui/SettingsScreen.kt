package com.vh.lexi.ui

import android.app.Activity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vh.lexi.BuildConfig
import com.vh.lexi.LexiApp
import com.vh.lexi.cloud.Account
import com.vh.lexi.core.CardLayout
import com.vh.lexi.core.NOTE_TYPES
import com.vh.lexi.core.Prefs
import com.vh.lexi.data.SyncState
import com.vh.lexi.ui.theme.Lexi
import kotlinx.coroutines.launch

fun syncLabel(s: SyncState): String = when (s) {
    SyncState.OFF -> "Chỉ lưu trên máy này"
    SyncState.LOADING -> "Đang tải…"
    SyncState.SYNCED -> "Đã đồng bộ"
    SyncState.PENDING -> "Đang đồng bộ…"
    SyncState.OFFLINE -> "Offline · sẽ đồng bộ khi có mạng"
    SyncState.DENIED -> "Tài khoản chưa được cấp quyền"
    SyncState.ERROR -> "Lỗi đồng bộ"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(app: LexiApp) {
    val data = app.data
    val scope = rememberCoroutineScope()
    val toast = LocalToaster.current
    val context = LocalContext.current
    val p by data.prefs.collectAsState()
    val account by app.cloud.account.collectAsState()
    val problem by app.cloud.problem.collectAsState()
    val sync by (app.cloud.sync?.state ?: kotlinx.coroutines.flow.MutableStateFlow(SyncState.OFF)).collectAsState()
    var confirmSignOut by remember { mutableStateOf(false) }
    var pendingImport by remember { mutableStateOf<String?>(null) }
    val c = Lexi.colors

    fun set(next: Prefs) { scope.launch { data.savePrefs(next) } }

    val exportLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null) scope.launch {
            val text = data.exportJson()
            runCatching { context.contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray()) } }
                .onSuccess { toast("Đã xuất bản sao lưu") }.onFailure { toast("Không ghi được file") }
        }
    }
    val importLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            val text = runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes().decodeToString() } }.getOrNull()
            if (text == null) toast("Không đọc được file") else pendingImport = text
        }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ScreenHeader("Cài đặt")

        Panel {
            Text("Học tập", style = MaterialTheme.typography.titleMedium)
            Text("Mức nhớ mục tiêu: ${Math.round(p.desiredRetention * 100)}%", fontWeight = FontWeight.SemiBold)
            RetentionSlider(p.desiredRetention) { set(p.copy(desiredRetention = it)) }
            Text("Cao hơn = nhớ chắc hơn nhưng ôn nhiều hơn. 90% là điểm cân bằng thường dùng; 85% nếu muốn ít thẻ hơn.", color = c.muted, fontSize = 13.sp)
            NumberField("Từ mới mỗi ngày", p.newPerDay) { set(p.copy(newPerDay = it.coerceIn(0, 200))) }
            NumberField("Tối đa thẻ ôn mỗi ngày", p.maxReviewsPerDay) { set(p.copy(maxReviewsPerDay = it.coerceIn(0, 9999))) }
            NumberField("Ngày mới bắt đầu lúc (giờ)", p.dayStartHour, Modifier.testTag("day-start-input")) { set(p.copy(dayStartHour = it.coerceIn(0, 23))) }
            Text("Tự đọc phát âm", fontWeight = FontWeight.SemiBold)
            Segments(listOf("off" to "Tắt", "front" to "Khi hiện thẻ", "back" to "Khi lật thẻ"), p.autoSpeak) { set(p.copy(autoSpeak = it)) }
        }

        // Fitted on the web (Settings → "Tối ưu theo lịch sử ôn"); this phone schedules with them once they sync.
        Panel(Modifier.testTag("fsrs")) {
            Text("Thuật toán ôn tập (FSRS)", style = MaterialTheme.typography.titleMedium)
            val on = p.fsrsWeights != null
            Text(
                if (on) "Đang dùng tham số tối ưu ngày ${java.time.Instant.ofEpochMilli(p.fsrsOptimizedAt).atZone(java.time.ZoneId.systemDefault()).toLocalDate().format(java.time.format.DateTimeFormatter.ofPattern("dd/MM/yyyy"))} trên ${"%,d".format(p.fsrsOptimizedReviews).replace(',', '.')} lượt ôn."
                else "Đang dùng tham số mặc định của FSRS.",
                Modifier.testTag("fsrs-status"),
            )
            Text("Tối ưu tham số theo lịch sử ôn của bạn trong Cài đặt của bản web; điện thoại dùng kết quả sau khi đồng bộ.", color = c.muted, fontSize = 13.sp)
        }

        Panel {
            Text("Loại thẻ tạo cho mỗi từ", style = MaterialTheme.typography.titleMedium)
            val vocab = NOTE_TYPES.getValue("vocab")
            val chosen = p.templates["vocab"].orEmpty().toSet()
            for (t in vocab.templates) {
                Row(Modifier.fillMaxWidth().clickable {
                    val next = if (t.id in chosen) chosen - t.id else chosen + t.id
                    if (next.isEmpty()) toast("Cần giữ ít nhất một loại thẻ")
                    else set(p.copy(templates = p.templates + ("vocab" to vocab.templates.map { it.id }.filter { it in next })))
                }, verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(t.label, fontWeight = FontWeight.Bold)
                        Text(t.description, color = c.muted, fontSize = 13.sp)
                    }
                    Checkbox(checked = t.id in chosen, onCheckedChange = null)
                }
            }
            Text("Đổi lựa chọn sẽ tạo thêm thẻ cho các từ đã có. Thẻ đã tắt nhưng chưa học sẽ bị gỡ; thẻ đã học được giữ lại.", color = c.muted, fontSize = 13.sp)
        }

        Panel {
            Text("Hiển thị", style = MaterialTheme.typography.titleMedium)
            fun layout(l: CardLayout) = set(p.copy(layout = l))
            SwitchRow("Phiên âm IPA", p.layout.showIpa) { layout(p.layout.copy(showIpa = it)) }
            SwitchRow("Loại từ", p.layout.showPos) { layout(p.layout.copy(showPos = it)) }
            SwitchRow("Nghĩa tiếng Việt", p.layout.showVi) { layout(p.layout.copy(showVi = it)) }
            SwitchRow("Định nghĩa tiếng Anh", p.layout.showEn) { layout(p.layout.copy(showEn = it)) }
            SwitchRow("Ví dụ", p.layout.showExamples) { layout(p.layout.copy(showExamples = it)) }
            SwitchRow("Mẹo nhớ", p.layout.showMnemonic) { layout(p.layout.copy(showMnemonic = it)) }
            Text("Giao diện", fontWeight = FontWeight.SemiBold)
            Segments(listOf("system" to "Theo hệ thống", "light" to "Sáng", "dark" to "Tối"), p.theme) { set(p.copy(theme = it)) }
            Text("Màu nhấn", fontWeight = FontWeight.SemiBold)
            // Stored keys are kept; the colours are the ones Theme.kt draws (teal is the default jade, violet the earlier lavender).
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                for ((k, col, name) in listOf(Triple("teal", 0xFF0F766E, "Ngọc đá"), Triple("blue", 0xFF2563EB, "Biển"), Triple("orange", 0xFFC2502A, "Đào"), Triple("violet", 0xFF6A4CF0, "Oải hương"))) {
                    androidx.compose.foundation.layout.Box(
                        Modifier.size(44.dp).border(if (p.accent == k) 2.5.dp else 0.dp, if (p.accent == k) c.ink else Color.Transparent, CircleShape).padding(4.dp)
                            .background(Color(col), CircleShape)
                            .clickable(onClickLabel = name) { set(p.copy(accent = k)) }.semantics { contentDescription = name },
                    )
                }
            }
        }

        Panel {
            Text("Tài khoản và đồng bộ", style = MaterialTheme.typography.titleMedium)
            when (val a = account) {
                Account.Off -> Text("Bản cài này chưa cấu hình Firebase, nên dữ liệu chỉ lưu trên máy. Xem docs/SETUP.md để bật đồng bộ với web.", color = c.muted)
                Account.SignedOut -> {
                    Text("Đăng nhập Google để đồng bộ với web (lexi.vhub.id.vn) và dùng AI điền nghĩa.", color = c.muted)
                    problem?.let { Text(it, color = c.again) }
                    Button(onClick = {
                        scope.launch { app.cloud.signIn(context as Activity)?.let { toast(it) } }
                    }) { Text("Đăng nhập với Google") }
                }
                is Account.SignedIn -> {
                    Text(a.email, fontWeight = FontWeight.SemiBold)
                    Pill(syncLabel(sync), when (sync) { SyncState.SYNCED -> PillKind.OK; SyncState.DENIED, SyncState.ERROR -> PillKind.BAD; else -> PillKind.WARN })
                    SwitchRow("Điền nghĩa và ví dụ bằng AI", p.aiEnabled) { set(p.copy(aiEnabled = it)) }
                    OutlinedButton(onClick = { confirmSignOut = true }) { Text("Đăng xuất", color = MaterialTheme.colorScheme.error) }
                }
            }
        }

        Panel {
            Text("Dữ liệu", style = MaterialTheme.typography.titleMedium)
            Text("Sao lưu là file JSON dùng được cho cả bản web.", color = c.muted, fontSize = 13.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { exportLauncher.launch("vh-lexi-${java.time.LocalDate.now()}.json") }) { Text("Xuất JSON") }
                OutlinedButton(onClick = { importLauncher.launch(arrayOf("application/json", "text/plain", "*/*")) }) { Text("Nhập JSON") }
            }
        }

        Panel {
            Text("Về VH Lexi", style = MaterialTheme.typography.titleMedium)
            Text(
                (if (app.hasDictionary) "Từ điển offline đã có trong ứng dụng. " else "Bản cài này chưa kèm từ điển offline. ") +
                    "Phiên âm từ CMU Pronouncing Dictionary; loại từ, định nghĩa và ví dụ từ Princeton WordNet 3.1 (© Princeton University, WordNet License); nghĩa tiếng Việt gợi ý từ Wiktionary (CC BY-SA 4.0). Lập lịch ôn tập: FSRS.",
                color = c.muted, fontSize = 13.sp,
            )
            Text("Phiên bản ${BuildConfig.VERSION_NAME}", color = c.muted, fontSize = 12.sp)
        }
    }

    if (confirmSignOut) {
        ConfirmDialog(
            title = "Đăng xuất?", message = "Dữ liệu đã đồng bộ vẫn an toàn trên Firebase và dữ liệu trên máy được giữ nguyên. Bạn cần đăng nhập lại để tiếp tục đồng bộ.",
            confirm = "Đăng xuất", destructive = true,
            onConfirm = { confirmSignOut = false; scope.launch { app.cloud.signOut() } }, onDismiss = { confirmSignOut = false },
        )
    }
    pendingImport?.let { text ->
        ConfirmDialog(
            title = "Nhập bản sao lưu?", message = "Mục trùng mã sẽ bị ghi đè bằng bản trong file.", confirm = "Nhập",
            onConfirm = {
                pendingImport = null
                scope.launch {
                    val r = data.importJson(text)
                    toast(if (r == null) "File không phải bản sao lưu của VH Lexi" else "Đã nhập ${r.first} từ, ${r.second} thẻ")
                }
            },
            onDismiss = { pendingImport = null },
        )
    }
}

@Composable
private fun RetentionSlider(value: Double, onChange: (Double) -> Unit) {
    var local by remember(value) { mutableStateOf(value.toFloat()) }
    Slider(value = local, onValueChange = { local = it }, onValueChangeFinished = { onChange((Math.round(local * 100) / 100.0)) }, valueRange = 0.8f..0.97f)
}

@Composable
private fun NumberField(label: String, value: Int, modifier: Modifier = Modifier, onChange: (Int) -> Unit) {
    var text by remember(value) { mutableStateOf(value.toString()) }
    OutlinedTextField(
        value = text, onValueChange = { t -> text = t.filter { it.isDigit() }.take(4); text.toIntOrNull()?.let(onChange) },
        label = { Text(label) }, singleLine = true, modifier = modifier.fillMaxWidth().keepVisibleWhileTyping(),
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number),
    )
}

@Composable
private fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Segments(options: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit) {
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
        options.forEachIndexed { i, (k, label) ->
            SegmentedButton(selected = selected == k, onClick = { onSelect(k) }, shape = SegmentedButtonDefaults.itemShape(i, options.size)) { Text(label, fontSize = 12.sp, maxLines = 1) }
        }
    }
}
