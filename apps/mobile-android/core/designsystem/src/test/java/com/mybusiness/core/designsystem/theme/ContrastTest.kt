package com.mybusiness.core.designsystem.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.ui.graphics.Color
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifica que los pares de color del sistema de diseño cumplen
 * los mínimos de contraste WCAG 2.1 (AA):
 * texto 4.5:1 y elementos de interfaz 3.0:1.
 */
class ContrastTest {

    private data class Pair(
        val role: String,
        val foreground: Color,
        val background: Color,
        val minRatio: Double
    )

    @Test
    fun lightThemeMeetsContrast() {
        assertTheme("light", LightColorScheme, LightBusinessColors)
    }

    @Test
    fun darkThemeMeetsContrast() {
        assertTheme("dark", DarkColorScheme, DarkBusinessColors)
    }

    private fun assertTheme(themeName: String, scheme: ColorScheme, business: BusinessColors) {
        val textMin = 4.5
        val uiMin = 3.0

        val pairs = listOf(
            // 15 pares de texto (>= 4.5:1)
            Pair("text/surface", scheme.onSurface, scheme.surface, textMin),
            Pair("text/surfaceRaised", scheme.onSurface, scheme.surfaceVariant, textMin),
            Pair("textMuted/surface", scheme.onSurfaceVariant, scheme.surface, textMin),
            Pair("textMuted/surfaceRaised", scheme.onSurfaceVariant, scheme.surfaceVariant, textMin),
            Pair("onPrimary/primary", scheme.onPrimary, scheme.primary, textMin),
            Pair("primary/surface", scheme.primary, scheme.surface, textMin),
            Pair("primary/surfaceRaised", scheme.primary, scheme.surfaceVariant, textMin),
            Pair("income/surface", business.income, scheme.surface, textMin),
            Pair("income/surfaceRaised", business.income, scheme.surfaceVariant, textMin),
            Pair("expense/surface", business.expense, scheme.surface, textMin),
            Pair("expense/surfaceRaised", business.expense, scheme.surfaceVariant, textMin),
            Pair("neutral/surface", business.neutral, scheme.surface, textMin),
            Pair("neutral/surfaceRaised", business.neutral, scheme.surfaceVariant, textMin),
            Pair("alert/surface", business.alert, scheme.surface, textMin),
            Pair("alert/surfaceRaised", business.alert, scheme.surfaceVariant, textMin),
            // 7 pares de interfaz (>= 3.0:1)
            Pair("focusRing/surface", business.focusRing, scheme.surface, uiMin),
            Pair("focusRing/surfaceRaised", business.focusRing, scheme.surfaceVariant, uiMin),
            Pair("borderStrong/surface", scheme.outline, scheme.surface, uiMin),
            Pair("borderStrong/surfaceRaised", scheme.outline, scheme.surfaceVariant, uiMin),
            Pair("text/surface", scheme.onSurface, scheme.surface, uiMin),
            Pair("textMuted/surface", scheme.onSurfaceVariant, scheme.surface, uiMin),
            Pair("onPrimary/primary", scheme.onPrimary, scheme.primary, uiMin)
        )

        pairs.forEach { pair ->
            val ratio = contrastRatio(pair.foreground, pair.background)
            assertTrue(
                "$themeName ${pair.role}: ratio=${format(ratio)} < ${pair.minRatio}",
                ratio >= pair.minRatio
            )
        }
    }

    private fun format(value: Double): String = String.format(java.util.Locale.ROOT, "%.2f", value)

    private fun linearize(channel: Float): Double {
        val c = channel.toDouble()
        return if (c <= 0.04045) c / 12.92 else ((c + 0.055) / 1.055).pow(2.4)
    }

    private fun relativeLuminance(color: Color): Double =
        0.2126 * linearize(color.red) +
            0.7152 * linearize(color.green) +
            0.0722 * linearize(color.blue)

    private fun contrastRatio(foreground: Color, background: Color): Double {
        val fg = relativeLuminance(foreground)
        val bg = relativeLuminance(background)
        return (max(fg, bg) + 0.05) / (min(fg, bg) + 0.05)
    }
}
