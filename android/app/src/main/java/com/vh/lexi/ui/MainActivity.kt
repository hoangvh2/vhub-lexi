package com.vh.lexi.ui

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle
import android.graphics.Color as AndroidColor
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.LibraryBooks
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.School
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vh.lexi.LexiApp
import com.vh.lexi.cloud.Account
import com.vh.lexi.core.QueueInput
import com.vh.lexi.core.buildQueue
import com.vh.lexi.core.deckWeights
import com.vh.lexi.core.meaningsByNote
import com.vh.lexi.core.dayId
import com.vh.lexi.data.SyncState
import com.vh.lexi.ui.theme.Lexi
import com.vh.lexi.ui.theme.LexiTheme
import com.vh.lexi.ui.theme.Quicksand
import com.vh.lexi.ui.theme.clay
import com.vh.lexi.ui.theme.gradientPill
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val app = application as LexiApp
        handleShare(intent)
        setContent {
            val prefs by app.data.prefs.collectAsState()
            // The status bar icons follow the app's theme, not the system one: with "Tối" chosen on a phone in light
            // mode they were dark on the dark background.
            val dark = when (prefs.theme) { "dark" -> true; "light" -> false; else -> isSystemInDarkTheme() }
            DisposableEffect(dark) {
                val bars = if (dark) SystemBarStyle.dark(AndroidColor.TRANSPARENT)
                else SystemBarStyle.light(AndroidColor.TRANSPARENT, AndroidColor.TRANSPARENT)
                enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)
                onDispose {}
            }
            LexiTheme(prefs.theme, prefs.accent) { Main(app) }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleShare(intent)
    }
}

/** Screenshots shared into Lexi (share sheet) wait in [LexiApp.pendingShare] until the import screen takes them. */
private fun MainActivity.handleShare(intent: Intent?) {
    @Suppress("DEPRECATION")
    val uris: List<Uri> = when (intent?.action) {
        Intent.ACTION_SEND -> listOfNotNull(intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
        Intent.ACTION_SEND_MULTIPLE -> intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM) ?: emptyList()
        else -> emptyList()
    }
    if (uris.isNotEmpty()) (application as LexiApp).pendingShare.value = uris.take(6)
}

private enum class Tab(val label: String, val icon: ImageVector) {
    STUDY("Ôn tập", Icons.Filled.School),
    ADD("Thêm từ", Icons.Filled.Add),
    LIBRARY("Thư viện", Icons.AutoMirrored.Filled.LibraryBooks),
    STATS("Thống kê", Icons.Filled.BarChart),
    SETTINGS("Cài đặt", Icons.Filled.Settings),
}

@Composable
private fun Main(app: LexiApp) {
    var tab by rememberSaveable { mutableStateOf(Tab.STUDY) }
    // "Nhập từ đề thi" is a screen over the tabs, opened from Today or by sharing a screenshot to Lexi.
    var importing by rememberSaveable { mutableStateOf(false) }
    var testSets by rememberSaveable { mutableStateOf(false) }
    var forgot by rememberSaveable { mutableStateOf(false) }
    // A study session left with a card on screen: coming back to the tab resumes it instead of opening Today.
    // Tapping the tab while already on it goes back to Today (studyHome remounts the screen).
    var studyResume by rememberSaveable { mutableStateOf(false) }
    var studyHome by rememberSaveable { mutableStateOf(0) }
    val shared by app.pendingShare.collectAsState()
    LaunchedEffect(shared) { if (shared.isNotEmpty()) importing = true }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val toaster = remember {
        Toaster { message, action, onAction ->
            scope.launch {
                snackbar.currentSnackbarData?.dismiss()
                val r = snackbar.showSnackbar(message, actionLabel = action)
                if (r == SnackbarResult.ActionPerformed) onAction?.invoke()
            }
        }
    }

    val cards by app.data.cards.collectAsState()
    val notes by app.data.notes.collectAsState()
    val decks by app.data.decks.collectAsState()
    val daily by app.data.daily.collectAsState()
    val prefs by app.data.prefs.collectAsState()
    val account by app.cloud.account.collectAsState()
    val sync by (app.cloud.sync?.state ?: remember { MutableStateFlow(SyncState.OFF) }).collectAsState()

    // Per version of the notes, not per rating: the badge's queue is rebuilt each time a card changes.
    val eligible = remember(notes) { eligibility(notes.associateBy { it.id }) }
    val meanings = remember(notes) { meaningsByNote(notes) }
    val due = remember(cards, notes, decks, daily, prefs) {
        val now = System.currentTimeMillis()
        val q = buildQueue(
            QueueInput(
                cards = cards, eligible = eligible,
                today = daily.firstOrNull { it.id == dayId(now, prefs.dayStartHour) }, prefs = prefs, now = now,
                meanings = meanings, deckWeights = deckWeights(decks),
            ),
        )
        q.counts.new + q.counts.learning + q.counts.review
    }

    val c = Lexi.colors
    CompositionLocalProvider(LocalToaster provides toaster) {
      // Two soft light blobs behind everything, as on the web.
      Box(
          Modifier.fillMaxSize().background(c.bg).drawBehind {
              drawCircle(Brush.radialGradient(listOf(c.accent2.copy(alpha = 0.24f), Color.Transparent), Offset(size.width, 0f), size.width * 0.8f), size.width * 0.8f, Offset(size.width, 0f))
              drawCircle(Brush.radialGradient(listOf(c.peach.copy(alpha = if (c.dark) 0.08f else 0.22f), Color.Transparent), Offset(0f, size.height), size.width * 0.8f), size.width * 0.8f, Offset(0f, size.height))
          },
      ) {
        Scaffold(
            // A transparent container has no matching content colour, so Material falls back to black: say it here.
            containerColor = Color.Transparent,
            contentColor = c.ink,
            bottomBar = {
                // Floating tab bar: a soft clay pill above the bottom edge.
                Box(Modifier.navigationBarsPadding().padding(start = 12.dp, end = 12.dp, bottom = 10.dp)) {
                    NavigationBar(
                        Modifier.clay(c, RoundedCornerShape(24.dp), color = c.surface.copy(alpha = 0.94f)).clip(RoundedCornerShape(24.dp)),
                        containerColor = Color.Transparent, tonalElevation = 0.dp, windowInsets = WindowInsets(0, 0, 0, 0),
                    ) {
                        for (t in Tab.entries) NavigationBarItem(
                            selected = tab == t && !importing && !testSets && !forgot, onClick = {
                                if (t == Tab.STUDY && tab == Tab.STUDY && !importing && !testSets && !forgot) { studyResume = false; studyHome++ }
                                tab = t; importing = false; testSets = false; forgot = false
                            }, modifier = Modifier.testTag("nav-${t.name.lowercase()}"),
                            label = { Text(t.label, fontSize = 11.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = c.accent, selectedTextColor = c.accent, indicatorColor = c.accentSoft, unselectedIconColor = c.muted, unselectedTextColor = c.muted,
                            ),
                            icon = {
                                if (t == Tab.STUDY && due > 0) BadgedBox(badge = { Badge(containerColor = c.accent, contentColor = c.onAccent) { Text("$due") } }) { Icon(t.icon, t.label) } else Icon(t.icon, t.label)
                            },
                        )
                    }
                }
            },
        ) { padding ->
            // Edge-to-edge: the window no longer shrinks for the keyboard (adjustResize only dispatches insets), and
            // Scaffold's default insets leave the IME out. Pad the content by the part of the keyboard that is not
            // already covered by the bottom bar, so every tab ends right above the keyboard and its scroll
            // containers can bring the focused field (and sticky actions) into view.
            Box(Modifier.padding(padding).consumeWindowInsets(padding).imePadding().fillMaxSize()) {
                androidx.compose.foundation.layout.Column(Modifier.fillMaxSize()) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Box(Modifier.size(28.dp).gradientPill(c, RoundedCornerShape(topStartPercent = 42, topEndPercent = 58, bottomEndPercent = 54, bottomStartPercent = 46)), contentAlignment = Alignment.Center) {
                            Text("L", fontFamily = Quicksand, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.onAccent)
                        }
                        Text("VH Lexi", fontFamily = Quicksand, fontWeight = FontWeight.Bold, fontSize = 20.sp, color = c.ink, modifier = Modifier.weight(1f))
                        if (account is Account.SignedIn) Pill(syncLabel(sync), when (sync) { SyncState.SYNCED -> PillKind.OK; SyncState.DENIED, SyncState.ERROR -> PillKind.BAD; else -> PillKind.WARN })
                        else Pill(syncLabel(SyncState.OFF))
                    }
                    Box(Modifier.weight(1f)) {
                        if (importing) ImportScreen(app) { importing = false } else if (testSets) TestSetsScreen(app) { testSets = false } else if (forgot) ForgotScreen(app) { forgot = false } else when (tab) {
                            Tab.STUDY -> key(studyHome) { StudyScreen(app, onAdd = { tab = Tab.ADD }, onImport = { importing = true }, onTestSets = { testSets = true }, onForgot = { forgot = true }, resume = studyResume, onResume = { studyResume = it }) }
                            Tab.ADD -> AddScreen(app)
                            Tab.LIBRARY -> LibraryScreen(app) { tab = Tab.ADD }
                            Tab.STATS -> StatsScreen(app)
                            Tab.SETTINGS -> SettingsScreen(app)
                        }
                    }
                }
                // At the top, over the title row, like the web on phones: a toast at the bottom covered the study
                // rating buttons and the typing field.
                SnackbarHost(snackbar, Modifier.align(Alignment.TopCenter))
            }
        }
      }
    }
}
