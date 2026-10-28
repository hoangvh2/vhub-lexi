package com.vh.lexi.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vh.lexi.LexiApp
import com.vh.lexi.cloud.Account
import com.vh.lexi.core.QueueInput
import com.vh.lexi.core.buildQueue
import com.vh.lexi.core.dayId
import com.vh.lexi.core.template
import com.vh.lexi.data.SyncState
import com.vh.lexi.ui.theme.Lexi
import com.vh.lexi.ui.theme.LexiTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val app = application as LexiApp
        setContent {
            val prefs by app.data.prefs.collectAsState()
            LexiTheme(prefs.theme, prefs.accent) { Main(app) }
        }
    }
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
    val daily by app.data.daily.collectAsState()
    val prefs by app.data.prefs.collectAsState()
    val account by app.cloud.account.collectAsState()
    val sync by (app.cloud.sync?.state ?: remember { MutableStateFlow(SyncState.OFF) }).collectAsState()

    val due = remember(cards, notes, daily, prefs) {
        val now = System.currentTimeMillis()
        val byId = notes.associateBy { it.id }
        val q = buildQueue(
            QueueInput(
                cards = cards, eligible = { c -> byId[c.noteId]?.let { n -> template(n.type, c.template)?.applies(n) == true } == true },
                today = daily.firstOrNull { it.id == dayId(now, prefs.dayStartHour) }, prefs = prefs, now = now,
            ),
        )
        q.counts.new + q.counts.learning + q.counts.review
    }

    CompositionLocalProvider(LocalToaster provides toaster) {
        Scaffold(
            containerColor = Lexi.colors.bg,
            snackbarHost = { SnackbarHost(snackbar) },
            bottomBar = {
                NavigationBar(containerColor = Lexi.colors.surface) {
                    for (t in Tab.entries) NavigationBarItem(
                        selected = tab == t, onClick = { tab = t }, modifier = Modifier.testTag("nav-${t.name.lowercase()}"), label = { Text(t.label, fontSize = 11.sp, maxLines = 1) },
                        icon = {
                            if (t == Tab.STUDY && due > 0) BadgedBox(badge = { Badge { Text("$due") } }) { Icon(t.icon, t.label) } else Icon(t.icon, t.label)
                        },
                    )
                }
            },
        ) { padding ->
            Box(Modifier.padding(padding).fillMaxSize()) {
                androidx.compose.foundation.layout.Column(Modifier.fillMaxSize()) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("VH Lexi", fontWeight = FontWeight.ExtraBold, fontSize = 18.sp, color = Lexi.colors.ink, modifier = Modifier.weight(1f))
                        if (account is Account.SignedIn) Pill(syncLabel(sync), when (sync) { SyncState.SYNCED -> PillKind.OK; SyncState.DENIED, SyncState.ERROR -> PillKind.BAD; else -> PillKind.WARN })
                        else Pill(syncLabel(SyncState.OFF))
                    }
                    Box(Modifier.weight(1f)) {
                        when (tab) {
                            Tab.STUDY -> StudyScreen(app) { tab = Tab.ADD }
                            Tab.ADD -> AddScreen(app)
                            Tab.LIBRARY -> LibraryScreen(app) { tab = Tab.ADD }
                            Tab.STATS -> StatsScreen(app)
                            Tab.SETTINGS -> SettingsScreen(app)
                        }
                    }
                }
            }
        }
    }
}
