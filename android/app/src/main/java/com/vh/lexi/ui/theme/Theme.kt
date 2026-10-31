package com.vh.lexi.ui.theme

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vh.lexi.R

/**
 * Same palette as the web app (web/src/styles.css, "Bong bóng mềm"): cool stone neutrals, clay surfaces, one jade
 * (ngọc đá) accent that also fills progress, and four pastels that each mean one thing (peach = due, "mint" = pistachio
 * for new/known, butter = streak/highlight, rose = forgotten). Each pastel has a soft fill and a deep tone for text on it.
 */
data class LexiColors(
    val bg: Color, val surface: Color, val surface2: Color, val ink: Color, val muted: Color, val line: Color,
    val accent: Color, val accent2: Color, val onAccent: Color, val accentSoft: Color,
    val peach: Color, val peachSoft: Color, val peachDeep: Color,
    val mint: Color, val mintSoft: Color, val mintDeep: Color,
    val butter: Color, val butterSoft: Color, val butterDeep: Color,
    val rose: Color, val roseSoft: Color, val roseDeep: Color,
    val again: Color, val againSoft: Color, val hard: Color, val hardSoft: Color,
    val good: Color, val goodSoft: Color, val easy: Color, val easySoft: Color,
    /** Listening cards; the marker-pen highlight of a word in its example; the memory-tip box. */
    val listen: Color, val listenSoft: Color, val mark: Color, val memo: Color,
    /** Older names still used by some screens: streak, new words, due. */
    val sun: Color, val sunSoft: Color, val fire: Color, val fireSoft: Color, val sky: Color, val skySoft: Color,
    /** Primary buttons and the progress orb's water, top to bottom. */
    val hero: List<Color>,
    /** Clay: the light rim on top and the tinted shadow below. */
    val hi: Color, val shadow: Color,
    val dark: Boolean,
)

// Static instances cut from the OFL variable fonts (licenses/) with fontTools, subset to Latin + Vietnamese.
// Variable-axis instancing at runtime left headings at the default thin weight on some devices.
// Quicksand is a Reserved Font Name, so the modified files are renamed "Lexi Rounded"; Nunito ones "Lexi Nunito".

/** Text: rounded and friendly, with Vietnamese. */
val Nunito = FontFamily(
    Font(R.font.lexi_text_400, FontWeight.Normal),
    Font(R.font.lexi_text_600, FontWeight.SemiBold),
    Font(R.font.lexi_text_700, FontWeight.Bold),
    Font(R.font.lexi_text_800, FontWeight.ExtraBold),
)

/** Headings and numbers. */
val Quicksand = FontFamily(
    Font(R.font.lexi_rounded_600, FontWeight.SemiBold),
    Font(R.font.lexi_rounded_700, FontWeight.Bold),
)

/** Accent keys kept for stored settings: teal is the default jade, violet the earlier lavender. Returns accent, accent2, soft. */
private fun accentOf(name: String, dark: Boolean): Triple<Color, Color, Color> = when (name) {
    "blue" -> if (dark) Triple(Color(0xFF7CB2FF), Color(0xFF3B82F6), Color(0xFF1B2C4F)) else Triple(Color(0xFF2563EB), Color(0xFF60A5FA), Color(0xFFE0EBFF))
    "orange" -> if (dark) Triple(Color(0xFFFFA587), Color(0xFFE2673F), Color(0xFF46271D)) else Triple(Color(0xFFC2502A), Color(0xFFF59A76), Color(0xFFFDE6DC))
    "violet" -> if (dark) Triple(Color(0xFFA892FF), Color(0xFF8467FF), Color(0xFF332A66)) else Triple(Color(0xFF6A4CF0), Color(0xFFA58BFF), Color(0xFFEBE5FF))
    else -> if (dark) Triple(Color(0xFF5EEAD4), Color(0xFF14B8A6), Color(0xFF173B37)) else Triple(Color(0xFF0F766E), Color(0xFF2BB3A3), Color(0xFFDCF1EE))
}

fun lexiColors(accent: String, dark: Boolean): LexiColors {
    val (a, a2, soft) = accentOf(accent, dark)
    return if (dark) {
        val peachSoft = Color(0xFF46302D); val peachDeep = Color(0xFFFFBFA7)
        val mintSoft = Color(0xFF26361C); val mintDeep = Color(0xFFB7E68C)
        val butterSoft = Color(0xFF413722); val butterDeep = Color(0xFFFFD77A)
        val roseSoft = Color(0xFF4A2939); val roseDeep = Color(0xFFFFA9BC)
        val easy = if (accent == "blue") Color(0xFF5EEAD4) else Color(0xFF8AB4FF)
        val easySoft = if (accent == "blue") Color(0xFF173B37) else Color(0xFF1D2D55)
        LexiColors(
            bg = Color(0xFF0E1716), surface = Color(0xFF172321), surface2 = Color(0xFF1F2E2B), ink = Color(0xFFE6F1EF), muted = Color(0xFF9BB3AE), line = Color(0xFF253532),
            accent = a, accent2 = a2, onAccent = Color(0xFF06201D), accentSoft = soft,
            peach = Color(0xFFFFB59A), peachSoft = peachSoft, peachDeep = peachDeep,
            mint = Color(0xFFA8DC78), mintSoft = mintSoft, mintDeep = mintDeep,
            butter = Color(0xFFFFD56B), butterSoft = butterSoft, butterDeep = butterDeep,
            rose = Color(0xFFFF9DB2), roseSoft = roseSoft, roseDeep = roseDeep,
            again = roseDeep, againSoft = roseSoft, hard = butterDeep, hardSoft = butterSoft, good = mintDeep, goodSoft = mintSoft, easy = easy, easySoft = easySoft,
            listen = Color(0xFFB39DFA), listenSoft = Color(0xFF2E2557), mark = Color(0xFF6B5418), memo = mintSoft,
            sun = butterDeep, sunSoft = butterSoft, fire = peachDeep, fireSoft = peachSoft, sky = a, skySoft = soft,
            hero = listOf(a, a2), hi = Color.White.copy(alpha = 0.06f), shadow = Color.Black.copy(alpha = 0.6f), dark = true,
        )
    } else {
        val peachSoft = Color(0xFFFFE6DC); val peachDeep = Color(0xFFB24D2A)
        val mintSoft = Color(0xFFE9F6DC); val mintDeep = Color(0xFF3F7A17)
        val butterSoft = Color(0xFFFFF1C7); val butterDeep = Color(0xFF8A5F00)
        val roseSoft = Color(0xFFFFE2E8); val roseDeep = Color(0xFFBF3358)
        val easy = if (accent == "blue") Color(0xFF0F766E) else Color(0xFF2F6FE4)
        val easySoft = if (accent == "blue") Color(0xFFDCF1EE) else Color(0xFFE2EDFF)
        LexiColors(
            bg = Color(0xFFF1F5F4), surface = Color(0xFFFFFFFF), surface2 = Color(0xFFEAF1EF), ink = Color(0xFF18302C), muted = Color(0xFF566B67), line = Color(0xFFDCE6E3),
            accent = a, accent2 = a2, onAccent = Color.White, accentSoft = soft,
            peach = Color(0xFFFFB59A), peachSoft = peachSoft, peachDeep = peachDeep,
            mint = Color(0xFF9ED36A), mintSoft = mintSoft, mintDeep = mintDeep,
            butter = Color(0xFFFFD56B), butterSoft = butterSoft, butterDeep = butterDeep,
            rose = Color(0xFFFF8AA3), roseSoft = roseSoft, roseDeep = roseDeep,
            again = roseDeep, againSoft = roseSoft, hard = butterDeep, hardSoft = butterSoft, good = mintDeep, goodSoft = mintSoft, easy = easy, easySoft = easySoft,
            listen = Color(0xFF7B5CFF), listenSoft = Color(0xFFECE6FF), mark = Color(0xFFFFE08F), memo = mintSoft,
            sun = butterDeep, sunSoft = butterSoft, fire = peachDeep, fireSoft = peachSoft, sky = a, skySoft = soft,
            hero = listOf(a2, a), hi = Color.White.copy(alpha = 0.95f), shadow = Color(0xFF0A3C37).copy(alpha = 0.32f), dark = false,
        )
    }
}

val LocalLexi = staticCompositionLocalOf { lexiColors("teal", false) }

/** Convenience: `Lexi.colors` inside composables. */
object Lexi {
    val colors: LexiColors @Composable get() = LocalLexi.current
}

/**
 * A clay surface: soft tinted shadow below, a light rim fading down from the top edge, and the fill. The web app draws
 * the same thing with an inset highlight and two box-shadows.
 */
fun Modifier.clay(c: LexiColors, shape: Shape = RoundedCornerShape(26.dp), color: Color = c.surface, elevation: Dp = 10.dp): Modifier =
    this.shadow(elevation, shape, clip = false, ambientColor = c.shadow, spotColor = c.shadow)
        .background(color, shape)
        .border(BorderStroke(1.5.dp, Brush.verticalGradient(0f to c.hi, 0.35f to Color.Transparent)), shape)

/** Primary actions: the accent gradient pill. */
fun Modifier.gradientPill(c: LexiColors, shape: Shape = RoundedCornerShape(50)): Modifier =
    this.shadow(12.dp, shape, clip = false, ambientColor = c.accent, spotColor = c.accent)
        .background(Brush.verticalGradient(c.hero), shape)

private fun scheme(c: LexiColors, dark: Boolean): ColorScheme =
    (if (dark) darkColorScheme() else lightColorScheme()).copy(
        primary = c.accent, onPrimary = c.onAccent, primaryContainer = c.accentSoft, onPrimaryContainer = c.accent,
        secondary = c.accent, onSecondary = c.onAccent, secondaryContainer = c.accentSoft, onSecondaryContainer = c.accent,
        background = c.bg, onBackground = c.ink, surface = c.surface, onSurface = c.ink,
        surfaceVariant = c.surface2, onSurfaceVariant = c.muted, outline = c.line, outlineVariant = c.line,
        error = c.again, onError = if (dark) c.onAccent else Color.White, errorContainer = c.againSoft, onErrorContainer = c.again,
        surfaceContainer = c.surface, surfaceContainerHigh = c.surface2, surfaceContainerLow = c.surface, surfaceContainerHighest = c.surface2,
    )

private val typography = Typography().let { t ->
    fun TextStyle.body() = copy(fontFamily = Nunito)
    fun TextStyle.head() = copy(fontFamily = Quicksand, fontWeight = FontWeight.Bold)
    Typography(
        displayLarge = t.displayLarge.head(), displayMedium = t.displayMedium.head(), displaySmall = t.displaySmall.head(),
        headlineLarge = t.headlineLarge.head(), headlineMedium = t.headlineMedium.head(), headlineSmall = t.headlineSmall.head(),
        titleLarge = t.titleLarge.head(), titleMedium = t.titleMedium.head(), titleSmall = t.titleSmall.body().copy(fontWeight = FontWeight.Bold),
        bodyLarge = t.bodyLarge.body().copy(fontSize = 16.sp), bodyMedium = t.bodyMedium.body().copy(fontSize = 15.sp), bodySmall = t.bodySmall.body(),
        labelLarge = t.labelLarge.body().copy(fontWeight = FontWeight.ExtraBold), labelMedium = t.labelMedium.body().copy(fontWeight = FontWeight.Bold), labelSmall = t.labelSmall.body().copy(fontWeight = FontWeight.Bold),
    )
}

private val shapes = Shapes(
    extraSmall = RoundedCornerShape(10.dp), small = RoundedCornerShape(14.dp), medium = RoundedCornerShape(20.dp),
    large = RoundedCornerShape(26.dp), extraLarge = RoundedCornerShape(32.dp),
)

@Composable
fun LexiTheme(themePref: String, accent: String, content: @Composable () -> Unit) {
    val dark = when (themePref) { "dark" -> true; "light" -> false; else -> isSystemInDarkTheme() }
    val c = lexiColors(accent, dark)
    CompositionLocalProvider(LocalLexi provides c) {
        MaterialTheme(colorScheme = scheme(c, dark), typography = typography, shapes = shapes, content = content)
    }
}
