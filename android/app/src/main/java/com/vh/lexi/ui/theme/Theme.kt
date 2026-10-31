package com.vh.lexi.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.vh.lexi.R

/** Same palette as the web app (web/src/styles.css): warm neutrals, one accent, semantic rating colours. */
data class LexiColors(
    val bg: Color, val surface: Color, val surface2: Color, val ink: Color, val muted: Color, val line: Color,
    val accent: Color, val onAccent: Color, val accentSoft: Color,
    val again: Color, val againSoft: Color, val hard: Color, val hardSoft: Color,
    val good: Color, val goodSoft: Color, val easy: Color, val easySoft: Color,
    /** Listening cards; the marker-pen highlight of a word in its example; the memory-tip box. */
    val listen: Color, val listenSoft: Color, val mark: Color, val memo: Color,
    /** Today screen: tile colours (new words, streak, due) and the hero card's gradient. */
    val sun: Color, val sunSoft: Color, val fire: Color, val fireSoft: Color, val sky: Color, val skySoft: Color,
    val hero: List<Color>,
)

val BeVietnam = FontFamily(
    Font(R.font.be_vietnam_pro_regular, FontWeight.Normal),
    Font(R.font.be_vietnam_pro_medium, FontWeight.Medium),
    Font(R.font.be_vietnam_pro_semibold, FontWeight.SemiBold),
    Font(R.font.be_vietnam_pro_bold, FontWeight.Bold),
)

private fun accentOf(name: String, dark: Boolean): Pair<Color, Color> = when (name) {
    "blue" -> if (dark) Color(0xFF8FB2FF) to Color(0xFF16264A) else Color(0xFF2457C5) to Color(0xFFE3EBFB)
    "orange" -> if (dark) Color(0xFFFB923C) to Color(0xFF3A210D) else Color(0xFFC2410C) to Color(0xFFFDE6D8)
    "violet" -> if (dark) Color(0xFFB794F6) to Color(0xFF2A1D4A) else Color(0xFF7C3AED) to Color(0xFFECE4FD)
    else -> if (dark) Color(0xFF4FD1A1) to Color(0xFF143528) else Color(0xFF157A55) to Color(0xFFDCEFE3)
}

fun lexiColors(accent: String, dark: Boolean): LexiColors {
    val (a, soft) = accentOf(accent, dark)
    return if (dark) LexiColors(
        bg = Color(0xFF0F1513), surface = Color(0xFF17201C), surface2 = Color(0xFF1F2A25), ink = Color(0xFFE8EFE9), muted = Color(0xFF9CAA9F), line = Color(0xFF2A3731),
        accent = a, onAccent = Color(0xFF06241A), accentSoft = soft,
        again = Color(0xFFFF8F84), againSoft = Color(0xFF47201C), hard = Color(0xFFF2B558), hardSoft = Color(0xFF3A2A0E),
        good = Color(0xFF4FD1A1), goodSoft = Color(0xFF143528), easy = Color(0xFF8FB2FF), easySoft = Color(0xFF16264A),
        listen = Color(0xFFB39DFA), listenSoft = Color(0xFF2A2148), mark = Color(0xFF6B5414), memo = Color(0xFF2E2611),
        sun = Color(0xFFF2C25B), sunSoft = Color(0xFF3A2F12), fire = Color(0xFFFF9A5C), fireSoft = Color(0xFF3D2216), sky = Color(0xFF8FB2FF), skySoft = Color(0xFF17284A),
        hero = listOf(Color(0xFF17382C), Color(0xFF1A2620), Color(0xFF2B2619)),
    ) else LexiColors(
        bg = Color(0xFFF5F2EA), surface = Color(0xFFFFFDF9), surface2 = Color(0xFFF0EBE0), ink = Color(0xFF1B2A23), muted = Color(0xFF5F6B60), line = Color(0xFFE4DCCB),
        accent = a, onAccent = Color.White, accentSoft = soft,
        again = Color(0xFFB42318), againSoft = Color(0xFFFBE4E1), hard = Color(0xFF9A5B00), hardSoft = Color(0xFFFBEBD0),
        good = Color(0xFF0E7C66), goodSoft = Color(0xFFDCF2EB), easy = Color(0xFF2457C5), easySoft = Color(0xFFE3EBFB),
        listen = Color(0xFF6D4FD1), listenSoft = Color(0xFFECE6FB), mark = Color(0xFFFFE08A), memo = Color(0xFFFDF4DC),
        sun = Color(0xFFB7790A), sunSoft = Color(0xFFFBEFD2), fire = Color(0xFFC4510F), fireSoft = Color(0xFFFDE6D6), sky = Color(0xFF2860C4), skySoft = Color(0xFFE3ECFB),
        hero = listOf(Color(0xFFE3F1E6), Color(0xFFF6EFDC)),
    )
}

val LocalLexi = staticCompositionLocalOf { lexiColors("teal", false) }

/** Convenience: `Lexi.colors` inside composables. */
object Lexi {
    val colors: LexiColors @Composable get() = LocalLexi.current
}

private fun scheme(c: LexiColors, dark: Boolean): ColorScheme =
    (if (dark) darkColorScheme() else lightColorScheme()).copy(
        primary = c.accent, onPrimary = c.onAccent, primaryContainer = c.accentSoft, onPrimaryContainer = c.accent,
        secondary = c.accent, onSecondary = c.onAccent, secondaryContainer = c.accentSoft, onSecondaryContainer = c.accent,
        background = c.bg, onBackground = c.ink, surface = c.surface, onSurface = c.ink,
        surfaceVariant = c.surface2, onSurfaceVariant = c.muted, outline = c.line, outlineVariant = c.line,
        error = c.again, onError = Color.White, errorContainer = c.againSoft, onErrorContainer = c.again,
        surfaceContainer = c.surface, surfaceContainerHigh = c.surface2, surfaceContainerLow = c.surface, surfaceContainerHighest = c.surface2,
    )

private val typography = Typography().let { t ->
    fun TextStyle.f() = copy(fontFamily = BeVietnam)
    Typography(
        displayLarge = t.displayLarge.f(), displayMedium = t.displayMedium.f(), displaySmall = t.displaySmall.f(),
        headlineLarge = t.headlineLarge.f(), headlineMedium = t.headlineMedium.f(), headlineSmall = t.headlineSmall.f(),
        titleLarge = t.titleLarge.f().copy(fontWeight = FontWeight.Bold), titleMedium = t.titleMedium.f().copy(fontWeight = FontWeight.SemiBold), titleSmall = t.titleSmall.f(),
        bodyLarge = t.bodyLarge.f().copy(fontSize = 16.sp), bodyMedium = t.bodyMedium.f().copy(fontSize = 15.sp), bodySmall = t.bodySmall.f(),
        labelLarge = t.labelLarge.f().copy(fontWeight = FontWeight.SemiBold), labelMedium = t.labelMedium.f(), labelSmall = t.labelSmall.f(),
    )
}

@Composable
fun LexiTheme(themePref: String, accent: String, content: @Composable () -> Unit) {
    val dark = when (themePref) { "dark" -> true; "light" -> false; else -> isSystemInDarkTheme() }
    val c = lexiColors(accent, dark)
    CompositionLocalProvider(LocalLexi provides c) {
        MaterialTheme(colorScheme = scheme(c, dark), typography = typography, content = content)
    }
}
