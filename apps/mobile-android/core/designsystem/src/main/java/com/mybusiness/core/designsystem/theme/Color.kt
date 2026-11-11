package com.mybusiness.core.designsystem.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

// Paleta canónica — light (Balance Finance UIKit / docs/design/tokens.json)
internal val LightSurface = Color(0xFFFFFFFF)
internal val LightSurfaceRaised = Color(0xFFF4F3FE)
internal val LightBorder = Color(0xFFE5E3FC)
internal val LightBorderStrong = Color(0xFF847EC7)
internal val LightText = Color(0xFF101720)
internal val LightTextMuted = Color(0xFF55606F)
internal val LightPrimary = Color(0xFF5844ED)
internal val LightOnPrimary = Color(0xFFFFFFFF)
internal val LightIncome = Color(0xFF047857)
internal val LightExpense = Color(0xFFB91C1C)
internal val LightNeutral = Color(0xFF4B5563)
internal val LightAlert = Color(0xFF92400E)
internal val LightFocusRing = Color(0xFF7966F3)

// Acentos especiales del UIKit Balance
val AccentMint = Color(0xFF2AD19B)
val AccentCoral = Color(0xFFFF6B50)
val BalanceLavender = Color(0xFFA79AFE)
val BalanceLavenderText = Color(0xFF101720)
val BalanceGradientLightTop = Color(0xFFDAD5FB)
val BalanceGradientLightBottom = Color(0xFFFFFFFF)

// Paleta canónica — dark (Balance Finance UIKit / docs/design/tokens.json)
internal val DarkSurface = Color(0xFF03034A)
internal val DarkSurfaceRaised = Color(0xFF0D1354)
internal val DarkBorder = Color(0xFF1E2563)
internal val DarkBorderStrong = Color(0xFF6371D6)
internal val DarkText = Color(0xFFF2F5F8)
internal val DarkTextMuted = Color(0xFFA3AEBD)
internal val DarkPrimary = Color(0xFFB4A9FE)
internal val DarkOnPrimary = Color(0xFF03034A)
internal val DarkIncome = Color(0xFF2AD19B)
internal val DarkExpense = Color(0xFFFF6B50)
internal val DarkNeutral = Color(0xFF9AA5B4)
internal val DarkAlert = Color(0xFFFBBF24)
internal val DarkFocusRing = Color(0xFFB4A9FE)

val BalanceGradientDarkTop = Color(0xFF060A30)
val BalanceGradientDarkBottom = Color(0xFF03034A)

internal val Scrim = Color(0xFF000000)

/**
 * Colores semánticos de negocio que M3 no expone como slots.
 * Se distribuyen vía [LocalBusinessColors].
 */
@Immutable
data class BusinessColors(
    val income: Color,
    val expense: Color,
    val alert: Color,
    val neutral: Color,
    val focusRing: Color,
    val accentMint: Color = AccentMint,
    val accentCoral: Color = AccentCoral,
)

internal val LightBusinessColors = BusinessColors(
    income = LightIncome,
    expense = LightExpense,
    alert = LightAlert,
    neutral = LightNeutral,
    focusRing = LightFocusRing,
    accentMint = AccentMint,
    accentCoral = AccentCoral,
)

internal val DarkBusinessColors = BusinessColors(
    income = DarkIncome,
    expense = DarkExpense,
    alert = DarkAlert,
    neutral = DarkNeutral,
    focusRing = DarkFocusRing,
    accentMint = AccentMint,
    accentCoral = AccentCoral,
)

val LocalBusinessColors = staticCompositionLocalOf { LightBusinessColors }

val MaterialTheme.businessColors: BusinessColors
    @Composable
    @ReadOnlyComposable
    get() = LocalBusinessColors.current

/**
 * Subconjunto de tokens del design system consumible desde fuera de una
 * composición (por ejemplo, un widget de Glance, que no participa del
 * CompositionLocal de MaterialTheme).
 *
 * Todos los valores provienen de la paleta canónica definida en este archivo;
 * no introduce colores nuevos.
 */
@Immutable
data class WidgetTokenColors(
    val surface: Color,
    val onSurface: Color,
    val surfaceVariant: Color,
    val onSurfaceVariant: Color,
    val background: Color,
    val onBackground: Color,
    val primary: Color,
    val onPrimary: Color,
    val error: Color,
    val onError: Color,
    val income: Color,
    val expense: Color,
)

object WidgetDesignTokens {

    val light: WidgetTokenColors = WidgetTokenColors(
        surface = LightSurface,
        onSurface = LightText,
        surfaceVariant = LightSurfaceRaised,
        onSurfaceVariant = LightTextMuted,
        background = LightSurface,
        onBackground = LightText,
        primary = LightPrimary,
        onPrimary = LightOnPrimary,
        error = LightExpense,
        onError = LightOnPrimary,
        income = LightIncome,
        expense = LightExpense,
    )

    val dark: WidgetTokenColors = WidgetTokenColors(
        surface = DarkSurface,
        onSurface = DarkText,
        surfaceVariant = DarkSurfaceRaised,
        onSurfaceVariant = DarkTextMuted,
        background = DarkSurface,
        onBackground = DarkText,
        primary = DarkPrimary,
        onPrimary = DarkOnPrimary,
        error = DarkExpense,
        onError = DarkSurface,
        income = DarkIncome,
        expense = DarkExpense,
    )
}
