package com.mybusiness.feature.widget.widget

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import com.mybusiness.feature.widget.data.DashboardWidgetState
import dagger.hilt.android.EntryPointAccessors
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import timber.log.Timber

/**
 * Quick Settings Tile que resume el estado del dashboard.
 *
 * El tile no consulta la red: lee la cache persistida por [DashboardWidgetWorker] y
 * se limita a reflejar si hay datos disponibles (ACTIVE) o no (INACTIVE).
 */
class DashboardTileService : TileService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun onStartListening() {
        super.onStartListening()
        scope.launch {
            val cache = EntryPointAccessors.fromApplication(
                applicationContext,
                DashboardWidgetEntryPoint::class.java
            ).dashboardWidgetCache()

            val widgetState = withContext(Dispatchers.IO) { cache.read() }

            qsTile?.apply {
                label = "Resumen"
                state = when (widgetState) {
                    is DashboardWidgetState.Success -> Tile.STATE_ACTIVE
                    DashboardWidgetState.Loading,
                    DashboardWidgetState.Empty,
                    is DashboardWidgetState.Error -> Tile.STATE_INACTIVE
                }
                updateTile()
            }
        }
    }

    override fun onClick() {
        super.onClick()
        val intent = Intent(
            Intent.ACTION_VIEW,
            Uri.parse("mybusiness://dashboard")
        ).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val pendingIntent = PendingIntent.getActivity(
                this,
                0,
                intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
            startActivityAndCollapse(pendingIntent)
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
