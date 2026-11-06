package com.mybusiness.feature.widget.data

import android.content.Context
import androidx.glance.appwidget.updateAll
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.mybusiness.core.common.result.Result as DomainResult
import com.mybusiness.core.model.DashboardSummary
import com.mybusiness.core.model.TransactionType
import com.mybusiness.feature.dashboard.domain.usecase.GetDashboardSummaryUseCase
import com.mybusiness.feature.widget.BuildConfig
import com.mybusiness.feature.widget.widget.DashboardWidget
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import timber.log.Timber
import java.util.concurrent.TimeUnit

@EntryPoint
@InstallIn(SingletonComponent::class)
interface DashboardWidgetWorkerEntryPoint {
    fun getDashboardSummaryUseCase(): GetDashboardSummaryUseCase
    fun dashboardWidgetCache(): DashboardWidgetCache
}

/**
 * Refresca la cache del widget y repinta todas las instancias instaladas.
 *
 * Política de reintentos: un error de red/API se reintenta hasta 3 veces; si se
 * agotan, se marca failure pero la cache conserva el último mensaje para que el
 * widget muestre el estado de error en lugar de datos obsoletos.
 */
class DashboardWidgetWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        Timber.d("DashboardWidgetWorker: inicio (intento=%d)", runAttemptCount)

        val entryPoint = EntryPointAccessors.fromApplication(
            applicationContext,
            DashboardWidgetWorkerEntryPoint::class.java
        )
        val cache = entryPoint.dashboardWidgetCache()
        val useCase = entryPoint.getDashboardSummaryUseCase()

        val result: Result = when (val summaryResult = useCase()) {
            is DomainResult.Success -> {
                val summary = summaryResult.data
                if (summary.accounts.isEmpty()) {
                    cache.saveEmpty()
                    DashboardWidget().updateAll(applicationContext)
                    Timber.d("DashboardWidgetWorker: sin cuentas, cache marcada como Empty")
                } else {
                    val dailyFlow = summary.calculateDailyFlow()
                    cache.saveSuccess(
                        totalBalance = summary.totalBalance,
                        dailyFlow = dailyFlow,
                        currency = summary.currency,
                        updatedAt = System.currentTimeMillis()
                    )
                    DashboardWidget().updateAll(applicationContext)
                    Timber.d(
                        "DashboardWidgetWorker: cache actualizada con éxito, dailyFlow=%s",
                        dailyFlow
                    )
                }
                Result.success()
            }

            is DomainResult.Error -> {
                cache.saveError(summaryResult.message)
                DashboardWidget().updateAll(applicationContext)
                if (runAttemptCount < MAX_ATTEMPTS) {
                    Timber.w(
                        "DashboardWidgetWorker: error '%s', reintentando (%d/%d)",
                        summaryResult.message,
                        runAttemptCount,
                        MAX_ATTEMPTS
                    )
                    Result.retry()
                } else {
                    Timber.e(
                        "DashboardWidgetWorker: error '%s', sin reintentos disponibles",
                        summaryResult.message
                    )
                    Result.failure()
                }
            }

            DomainResult.Loading -> {
                Timber.w("DashboardWidgetWorker: respuesta en Loading, se reintenta")
                Result.retry()
            }
        }

        Timber.d("DashboardWidgetWorker: fin con %s", result)
        return result
    }

    private companion object {
        const val MAX_ATTEMPTS = 3
    }
}

private const val TODAY_PREFIX = "Hoy"

/**
 * Flujo del día: sólo transacciones cuya fecha empieza por "Hoy" (case-insensitive).
 * Ingresos suman, egresos restan y las transferencias se ignoran.
 */
internal fun DashboardSummary.calculateDailyFlow(): Double =
    recentTransactions
        .filter { it.date.startsWith(TODAY_PREFIX, ignoreCase = true) }
        .sumOf { transaction ->
            when (transaction.type) {
                TransactionType.INCOME -> transaction.amount
                TransactionType.EXPENSE -> -transaction.amount
                TransactionType.TRANSFER -> 0.0
            }
        }

/** WorkManager no admite intervalos periódicos por debajo de 15 minutos. */
internal fun effectiveIntervalMinutes(requested: Long): Long =
    requested.coerceAtLeast(MIN_INTERVAL_MINUTES)

private const val MIN_INTERVAL_MINUTES = 15L

/**
 * Programación del refresco del widget.
 *
 * WorkManager no admite intervalos periódicos inferiores a 15 minutos, por lo que
 * el valor solicitado se acota a ese mínimo antes de encolar el trabajo.
 */
object WidgetRefreshScheduler {

    private const val UNIQUE_PERIODIC_WORK = "dashboard-widget-refresh"
    private const val UNIQUE_IMMEDIATE_WORK = "dashboard-widget-refresh-immediate"
    private const val TAG = "dashboard-widget"

    fun schedule(
        context: Context,
        intervalMinutes: Long = BuildConfig.WIDGET_REFRESH_INTERVAL_MINUTES
    ) {
        val effectiveInterval = effectiveIntervalMinutes(intervalMinutes)
        Timber.d(
            "WidgetRefreshScheduler: intervalo solicitado=%d min, efectivo=%d min",
            intervalMinutes,
            effectiveInterval
        )

        val request = PeriodicWorkRequestBuilder<DashboardWidgetWorker>(
            effectiveInterval,
            TimeUnit.MINUTES
        )
            .setConstraints(networkConstraints())
            .addTag(TAG)
            .build()

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            UNIQUE_PERIODIC_WORK,
            ExistingPeriodicWorkPolicy.UPDATE,
            request
        )
    }

    fun enqueueImmediate(context: Context) {
        val request = OneTimeWorkRequestBuilder<DashboardWidgetWorker>()
            .setConstraints(networkConstraints())
            .addTag(TAG)
            .build()

        WorkManager.getInstance(context).enqueueUniqueWork(
            UNIQUE_IMMEDIATE_WORK,
            ExistingWorkPolicy.REPLACE,
            request
        )
    }

    fun cancel(context: Context) {
        val workManager = WorkManager.getInstance(context)
        workManager.cancelUniqueWork(UNIQUE_PERIODIC_WORK)
        workManager.cancelUniqueWork(UNIQUE_IMMEDIATE_WORK)
        Timber.d("WidgetRefreshScheduler: trabajos periódico e inmediato cancelados")
    }

    private fun networkConstraints(): Constraints = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()
}
