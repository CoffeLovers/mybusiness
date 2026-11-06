package com.mybusiness.feature.widget.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.color.ColorProvider as DayNightColorProvider
import androidx.glance.color.ColorProviders
import androidx.glance.color.colorProviders
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.mybusiness.core.common.extensions.formatCurrency
import com.mybusiness.core.designsystem.theme.WidgetDesignTokens
import com.mybusiness.core.designsystem.theme.WidgetTokenColors
import com.mybusiness.feature.widget.data.DashboardWidgetCache
import com.mybusiness.feature.widget.data.DashboardWidgetState
import com.mybusiness.feature.widget.data.WidgetRefreshScheduler
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import kotlin.math.abs

/**
 * Punto de acceso Hilt para resolver dependencias desde un [GlanceAppWidget],
 * que no participa del ciclo de vida de inyección de Activities/Fragments.
 */
@EntryPoint
@InstallIn(SingletonComponent::class)
interface DashboardWidgetEntryPoint {
    fun dashboardWidgetCache(): DashboardWidgetCache
}

/**
 * Widget de resumen del dashboard.
 *
 * La composición de Glance se genera a partir del último estado persistido en
 * [DashboardWidgetCache]; la actualización real la dispara [WidgetRefreshScheduler].
 */
class DashboardWidget : GlanceAppWidget() {

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val cache = EntryPointAccessors.fromApplication(
            context.applicationContext,
            DashboardWidgetEntryPoint::class.java
        ).dashboardWidgetCache()

        val state = cache.read()

        provideContent {
            GlanceTheme(colors = WidgetColors) {
                DashboardWidgetContent(state)
            }
        }
    }
}

@Composable
private fun DashboardWidgetContent(state: DashboardWidgetState) {
    Column(
        modifier = GlanceModifier
            .fillMaxSize()
            .background(GlanceTheme.colors.surface)
            .clickable(actionStartActivity(dashboardIntent()))
            .padding(start = 16.dp, top = 16.dp, end = 16.dp, bottom = 16.dp),
        verticalAlignment = Alignment.Vertical.Top,
        horizontalAlignment = Alignment.Horizontal.Start
    ) {
        when (state) {
            is DashboardWidgetState.Success -> SuccessContent(state)
            is DashboardWidgetState.Error -> ErrorContent(state.message)
            DashboardWidgetState.Empty -> MessageContent(
                text = "Sin datos todavía",
                color = GlanceTheme.colors.onSurface
            )

            DashboardWidgetState.Loading -> MessageContent(
                text = "Actualizando…",
                color = GlanceTheme.colors.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun SuccessContent(state: DashboardWidgetState.Success) {
    Text(
        text = "Saldo total",
        style = TextStyle(
            color = GlanceTheme.colors.onSurfaceVariant,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium
        )
    )
    Text(
        text = state.totalBalance.formatCurrency(state.currency),
        style = TextStyle(
            color = GlanceTheme.colors.onSurface,
            fontSize = 26.sp,
            fontWeight = FontWeight.Bold
        )
    )
    Spacer(modifier = GlanceModifier.padding(top = 8.dp))
    Text(
        text = "Flujo de hoy: ${state.dailyFlow.toSignedCurrency(state.currency)}",
        style = TextStyle(
            color = if (state.dailyFlow < 0) {
                GlanceTheme.colors.error
            } else {
                GlanceTheme.colors.primary
            },
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium
        )
    )
}

@Composable
private fun ErrorContent(message: String) {
    Text(
        text = message,
        style = TextStyle(
            color = GlanceTheme.colors.error,
            fontSize = 14.sp,
            fontWeight = FontWeight.Medium
        )
    )
    Spacer(modifier = GlanceModifier.padding(top = 6.dp))
    Text(
        text = "Toca para abrir la app",
        style = TextStyle(
            color = GlanceTheme.colors.onSurfaceVariant,
            fontSize = 12.sp
        )
    )
}

@Composable
private fun MessageContent(text: String, color: androidx.glance.unit.ColorProvider) {
    Text(
        text = text,
        style = TextStyle(
            color = color,
            fontSize = 14.sp,
            fontWeight = FontWeight.Medium
        )
    )
}

private fun Double.toSignedCurrency(currencyCode: String): String {
    val prefix = if (this < 0) "-" else "+"
    return prefix + abs(this).formatCurrency(currencyCode)
}

private fun dashboardIntent(): Intent = Intent(
    Intent.ACTION_VIEW,
    Uri.parse("mybusiness://dashboard")
).apply {
    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}

/**
 * Paleta clara/oscura del widget.
 *
 * Se construye a partir de [WidgetDesignTokens] (paleta canónica del design
 * system) para garantizar contraste AA en cualquier fabricante y en API 26+,
 * donde el color dinámico del sistema no está disponible. Los slots que el
 * design system no expone (containers, secondary/tertiary) se derivan de los
 * tokens `surfaceVariant`, `primary` y `error`.
 */
private fun tokenColor(selector: (WidgetTokenColors) -> Color): ColorProvider =
    DayNightColorProvider(
        selector(WidgetDesignTokens.light),
        selector(WidgetDesignTokens.dark)
    )

private val WidgetColors: ColorProviders = colorProviders(
    primary = tokenColor { it.primary },
    onPrimary = tokenColor { it.onPrimary },
    primaryContainer = tokenColor { it.surfaceVariant },
    onPrimaryContainer = tokenColor { it.onSurface },
    secondary = tokenColor { it.onSurfaceVariant },
    onSecondary = tokenColor { it.surface },
    secondaryContainer = tokenColor { it.surfaceVariant },
    onSecondaryContainer = tokenColor { it.onSurfaceVariant },
    tertiary = tokenColor { it.onSurfaceVariant },
    onTertiary = tokenColor { it.surface },
    tertiaryContainer = tokenColor { it.surfaceVariant },
    onTertiaryContainer = tokenColor { it.onSurfaceVariant },
    error = tokenColor { it.error },
    errorContainer = tokenColor { it.surfaceVariant },
    onError = tokenColor { it.onError },
    onErrorContainer = tokenColor { it.onError },
    background = tokenColor { it.background },
    onBackground = tokenColor { it.onBackground },
    surface = tokenColor { it.surface },
    onSurface = tokenColor { it.onSurface },
    surfaceVariant = tokenColor { it.surfaceVariant },
    onSurfaceVariant = tokenColor { it.onSurfaceVariant },
    outline = tokenColor { it.onSurfaceVariant },
    inverseOnSurface = tokenColor { it.surface },
    inverseSurface = tokenColor { it.onSurface },
    inversePrimary = tokenColor { it.primary },
    widgetBackground = tokenColor { it.background }
)

/**
 * Receiver declarado en el manifest del módulo. Tras pintar el estado actual
 * encola una actualización inmediata para no esperar al ciclo periódico.
 */
class DashboardWidgetReceiver : GlanceAppWidgetReceiver() {

    override val glanceAppWidget: GlanceAppWidget = DashboardWidget()

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        super.onUpdate(context, appWidgetManager, appWidgetIds)
        WidgetRefreshScheduler.enqueueImmediate(context)
    }

    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        WidgetRefreshScheduler.schedule(context)
    }

    override fun onDisabled(context: Context) {
        super.onDisabled(context)
        WidgetRefreshScheduler.cancel(context)
    }
}
