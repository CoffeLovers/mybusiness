package com.mybusiness.core.designsystem.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalContext

internal val LightColorScheme = lightColorScheme(
    primary = LightPrimary,
    onPrimary = LightOnPrimary,
    primaryContainer = LightSurfaceRaised,
    onPrimaryContainer = LightText,
    secondary = LightIncome,
    onSecondary = LightOnPrimary,
    secondaryContainer = LightSurfaceRaised,
    onSecondaryContainer = LightIncome,
    tertiary = LightAlert,
    onTertiary = LightOnPrimary,
    tertiaryContainer = LightSurfaceRaised,
    onTertiaryContainer = LightAlert,
    error = LightExpense,
    onError = LightOnPrimary,
    errorContainer = LightSurfaceRaised,
    onErrorContainer = LightExpense,
    background = LightSurface,
    onBackground = LightText,
    surface = LightSurface,
    onSurface = LightText,
    surfaceVariant = LightSurfaceRaised,
    onSurfaceVariant = LightTextMuted,
    outline = LightBorderStrong,
    outlineVariant = LightBorder,
    scrim = Scrim
)

internal val DarkColorScheme = darkColorScheme(
    primary = DarkPrimary,
    onPrimary = DarkOnPrimary,
    primaryContainer = DarkSurfaceRaised,
    onPrimaryContainer = DarkText,
    secondary = DarkIncome,
    onSecondary = DarkOnPrimary,
    secondaryContainer = DarkSurfaceRaised,
    onSecondaryContainer = DarkIncome,
    tertiary = DarkAlert,
    onTertiary = DarkOnPrimary,
    tertiaryContainer = DarkSurfaceRaised,
    onTertiaryContainer = DarkAlert,
    error = DarkExpense,
    onError = DarkOnPrimary,
    errorContainer = DarkSurfaceRaised,
    onErrorContainer = DarkExpense,
    background = DarkSurface,
    onBackground = DarkText,
    surface = DarkSurface,
    onSurface = DarkText,
    surfaceVariant = DarkSurfaceRaised,
    onSurfaceVariant = DarkTextMuted,
    outline = DarkBorderStrong,
    outlineVariant = DarkBorder,
    scrim = Scrim
)

@Composable
fun MyBusinessTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = false, // Mantenemos la paleta de marca consistente
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }
    val businessColors = if (darkTheme) DarkBusinessColors else LightBusinessColors

    CompositionLocalProvider(LocalBusinessColors provides businessColors) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = Typography,
            shapes = Shapes,
            content = content
        )
    }
}
