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
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vh.lexi.R

/**
 * Same palette as the web app (web/src/styles.css, "Bong bóng mềm"): lavender mist, clay surfaces, one lavender accent
 * and four pastels that each mean one thing (peach = due, mint = new/progress, butter = streak/highlight, rose = forgotten).
 * Each pastel has a soft fill and a deep tone for text and icons on it.
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

// Variable fonts, shipped unmodified (OFL, licenses/); each weight is an instance of the wght axis.
@OptIn(ExperimentalTextApi::class)
private fun variable(res: Int, weight: Int) = Font(res, FontWeight(weight), variationSettings = FontVariation.Settings(FontVariation.weight(weight)))

/** Text: rounded and friendly, with Vietnamese. */
val Nunito = FontFamily(variable(R.font.nunito, 400), variable(R.font.nunito, 600), variable(R.font.nunito, 700), variable(R.font.nunito, 800))

/** Headings and numbers. */
val Quicksand = FontFamily(variable(R.font.quicksand, 500), variable(R.font.quicksand, 600), variable(R.font.quicksand, 700))

/** Accent keys are historical names kept for stored settings: teal is the default lavender. Returns accent, accent2, soft. */
private fun accentOf(name: String, dark: Boolean): Triple<Color, Color, Color> = when (name) {
    "blue" -> if (dark) Triple(Color(0xFF8AB4FF), Color(0xFF4F84F0), Color(0xFF1D2D55)) else Triple(Color(0xFF2F6FE4), Color(0xFF7FB0FF), Color(0xFFE2EDFF))
    "orange" -> if (dark) Triple(Color(0xFFFFA587), Color(0xFFE2673F), Color(0xFF46271D)) else Triple(Color(0xFFD4532C), Color(0xFFFFA587), Color(0xFFFFE8DE))
    "violet" -> if (dark) Triple(Color(0xFFFF9FCA), Color(0xFFD64B8A), Color(0xFF48223A)) else Triple(Color(0xFFC23A78), Color(0xFFFF8FBF), Color(0xFFFFE3EF))
    else -> if (dark) Triple(Color(0xFFA892FF), Color(0xFF8467FF), Color(0xFF332A66)) else Triple(Color(0xFF6A4CF0), Color(0xFFA58BFF), Color(0xFFEBE5FF))
}

fun lexiColors(accent: String, dark: Boolean): LexiColors {
    val (a, a2, soft) = accentOf(accent, dark)
    return if (dark) {
        val peachSoft = Color(0xFF46302D); val peachDeep = Color(0xFFFFBFA7)
        val mintSoft = Color(0xFF1E3D38); val mintDeep = Color(0xFF7FE8C6)
        val butterSoft = Color(0xFF413722); val butterDeep = Color(0xFFFFD77A)
        val roseSoft = Color(0xFF4A2939); val roseDeep = Color(0xFFFFA9BC)
        val easy = if (accent == "blue") a else Color(0xFFB6A4FF)
        val easySoft = if (accent == "blue") soft else Color(0xFF30285F)
        LexiColors(
            bg = Color(0xFF17132E), surface = Color(0xFF221C42), surface2 = Color(0xFF2B2451), ink = Color(0xFFF1EDFF), muted = Color(0xFFB2A8DA), line = Color(0xFF372F68),
            accent = a, accent2 = a2, onAccent = Color(0xFF160F33), accentSoft = soft,
            peach = Color(0xFFFFB59A), peachSoft = peachSoft, peachDeep = peachDeep,
            mint = Color(0xFF6EE3BD), mintSoft = mintSoft, mintDeep = mintDeep,
            butter = Color(0xFFFFD56B), butterSoft = butterSoft, butterDeep = butterDeep,
            rose = Color(0xFFFF9DB2), roseSoft = roseSoft, roseDeep = roseDeep,
            again = roseDeep, againSoft = roseSoft, hard = butterDeep, hardSoft = butterSoft, good = mintDeep, goodSoft = mintSoft, easy = easy, easySoft = easySoft,
            listen = Color(0xFFB39DFA), listenSoft = Color(0xFF2E2557), mark = Color(0xFF6B5418), memo = mintSoft,
            sun = butterDeep, sunSoft = butterSoft, fire = peachDeep, fireSoft = peachSoft, sky = a, skySoft = soft,
            hero = listOf(a, a2), hi = Color.White.copy(alpha = 0.07f), shadow = Color.Black.copy(alpha = 0.6f), dark = true,
        )
    } else {
        val peachSoft = Color(0xFFFFE6DC); val peachDeep = Color(0xFFB24D2A)
        val mintSoft = Color(0xFFD8F6EB); val mintDeep = Color(0xFF17805F)
        val butterSoft = Color(0xFFFFF1C7); val butterDeep = Color(0xFF8A5F00)
        val roseSoft = Color(0xFFFFE2E8); val roseDeep = Color(0xFFBF3358)
        val easy = if (accent == "blue") a else Color(0xFF5A3FE0)
        val easySoft = if (accent == "blue") soft else Color(0xFFE7E1FF)
        LexiColors(
            bg = Color(0xFFF3EFFF), surface = Color(0xFFFDFCFF), surface2 = Color(0xFFF0EBFE), ink = Color(0xFF2B1F4F), muted = Color(0xFF6F6496), line = Color(0xFFE2DBF8),
            accent = a, accent2 = a2, onAccent = Color.White, accentSoft = soft,
            peach = Color(0xFFFFB59A), peachSoft = peachSoft, peachDeep = peachDeep,
            mint = Color(0xFF5FD8B0), mintSoft = mintSoft, mintDeep = mintDeep,
            butter = Color(0xFFFFD56B), butterSoft = butterSoft, butterDeep = butterDeep,
            rose = Color(0xFFFF8AA3), roseSoft = roseSoft, roseDeep = roseDeep,
            again = roseDeep, againSoft = roseSoft, hard = butterDeep, hardSoft = butterSoft, good = mintDeep, goodSoft = mintSoft, easy = easy, easySoft = easySoft,
            listen = Color(0xFF7B5CFF), listenSoft = Color(0xFFECE6FF), mark = Color(0xFFFFE08F), memo = mintSoft,
            sun = butterDeep, sunSoft = butterSoft, fire = peachDeep, fireSoft = peachSoft, sky = a, skySoft = soft,
            hero = listOf(a2, a), hi = Color.White.copy(alpha = 0.95f), shadow = Color(0xFF5C40C4).copy(alpha = 0.35f), dark = false,
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

/** Primary actions: the lavender gradient pill. */
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
