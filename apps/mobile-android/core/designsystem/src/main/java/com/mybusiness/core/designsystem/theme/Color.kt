package com.mybusiness.core.designsystem.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

// Paleta canónica — light (docs/design/tokens.json)
internal val LightSurface = Color(0xFFFFFFFF)
internal val LightSurfaceRaised = Color(0xFFF4F6F8)
internal val LightBorder = Color(0xFFC3CCD6)
internal val LightBorderStrong = Color(0xFF6B7280)
internal val LightText = Color(0xFF101720)
internal val LightTextMuted = Color(0xFF55606F)
internal val LightPrimary = Color(0xFF1D4ED8)
internal val LightOnPrimary = Color(0xFFFFFFFF)
internal val LightIncome = Color(0xFF047857)
internal val LightExpense = Color(0xFFB91C1C)
internal val LightNeutral = Color(0xFF4B5563)
internal val LightAlert = Color(0xFF92400E)
internal val LightFocusRing = Color(0xFF1D4ED8)

// Paleta canónica — dark (docs/design/tokens.json)
internal val DarkSurface = Color(0xFF0B0F16)
internal val DarkSurfaceRaised = Color(0xFF151B24)
internal val DarkBorder = Color(0xFF3F4B5C)
internal val DarkBorderStrong = Color(0xFF7C8BA1)
internal val DarkText = Color(0xFFF2F5F8)
internal val DarkTextMuted = Color(0xFFA3AEBD)
internal val DarkPrimary = Color(0xFF7AA2FF)
internal val DarkOnPrimary = Color(0xFF0B0F16)
internal val DarkIncome = Color(0xFF34D399)
internal val DarkExpense = Color(0xFFF87171)
internal val DarkNeutral = Color(0xFF9AA5B4)
internal val DarkAlert = Color(0xFFFBBF24)
internal val DarkFocusRing = Color(0xFF7AA2FF)

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
)

internal val LightBusinessColors = BusinessColors(
    income = LightIncome,
    expense = LightExpense,
    alert = LightAlert,
    neutral = LightNeutral,
    focusRing = LightFocusRing,
)

internal val DarkBusinessColors = BusinessColors(
    income = DarkIncome,
    expense = DarkExpense,
    alert = DarkAlert,
    neutral = DarkNeutral,
    focusRing = DarkFocusRing,
)

val LocalBusinessColors = staticCompositionLocalOf { LightBusinessColors }

val MaterialTheme.businessColors: BusinessColors
    @Composable
    @ReadOnlyComposable
    get() = LocalBusinessColors.current
