package com.mybusiness.feature.widget.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import timber.log.Timber
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dashboardWidgetDataStore: DataStore<Preferences> by preferencesDataStore(
    name = "dashboard_widget_cache"
)

/**
 * Estado consumible por el widget de dashboard.
 *
 * [Empty] queda disponible para cuando no existan datos de negocio (tenant sin movimientos);
 * la cache sólo persiste [Success] y [Error], el resto son estados derivados/efímeros.
 */
sealed interface DashboardWidgetState {
    data object Loading : DashboardWidgetState
    data object Empty : DashboardWidgetState
    data class Error(val message: String) : DashboardWidgetState
    data class Success(
        val totalBalance: Double,
        val dailyFlow: Double,
        val currency: String,
        val updatedAt: Long
    ) : DashboardWidgetState
}

interface DashboardWidgetCache {
    val state: Flow<DashboardWidgetState>
    suspend fun read(): DashboardWidgetState
    suspend fun saveSuccess(
        totalBalance: Double,
        dailyFlow: Double,
        currency: String,
        updatedAt: Long
    )

    suspend fun saveError(message: String)
    suspend fun saveEmpty()
    suspend fun clear()
}

@Singleton
class DashboardWidgetCacheImpl @Inject constructor(
    @ApplicationContext private val context: Context
) : DashboardWidgetCache {

    private object PreferencesKeys {
        val STATUS = stringPreferencesKey("status")
        val ERROR_MESSAGE = stringPreferencesKey("error_message")
        val TOTAL_BALANCE = stringPreferencesKey("total_balance")
        val DAILY_FLOW = stringPreferencesKey("daily_flow")
        val CURRENCY = stringPreferencesKey("currency")
        val UPDATED_AT = longPreferencesKey("updated_at")
    }

    private val dataStore = context.dashboardWidgetDataStore

    override val state: Flow<DashboardWidgetState> = dataStore.data
        .catch { exception ->
            if (exception is IOException) {
                emit(emptyPreferences())
            } else {
                throw exception
            }
        }
        .map { preferences -> preferences.toWidgetState() }

    override suspend fun read(): DashboardWidgetState = runCatching { state.first() }
        .getOrElse { throwable ->
            Timber.w(throwable, "No se pudo leer la cache del widget; se devuelve Loading")
            DashboardWidgetState.Loading
        }

    override suspend fun saveSuccess(
        totalBalance: Double,
        dailyFlow: Double,
        currency: String,
        updatedAt: Long
    ) {
        dataStore.edit { preferences ->
            preferences[PreferencesKeys.STATUS] = STATUS_SUCCESS
            preferences[PreferencesKeys.TOTAL_BALANCE] = totalBalance.toString()
            preferences[PreferencesKeys.DAILY_FLOW] = dailyFlow.toString()
            preferences[PreferencesKeys.CURRENCY] = currency
            preferences[PreferencesKeys.UPDATED_AT] = updatedAt
            preferences.remove(PreferencesKeys.ERROR_MESSAGE)
        }
    }

    override suspend fun saveError(message: String) {
        dataStore.edit { preferences ->
            preferences[PreferencesKeys.STATUS] = STATUS_ERROR
            preferences[PreferencesKeys.ERROR_MESSAGE] = message
        }
    }

    override suspend fun saveEmpty() {
        dataStore.edit { preferences ->
            preferences[PreferencesKeys.STATUS] = STATUS_EMPTY
            preferences.remove(PreferencesKeys.ERROR_MESSAGE)
            preferences.remove(PreferencesKeys.TOTAL_BALANCE)
            preferences.remove(PreferencesKeys.DAILY_FLOW)
            preferences.remove(PreferencesKeys.UPDATED_AT)
        }
    }

    override suspend fun clear() {
        dataStore.edit { preferences -> preferences.clear() }
    }

    private fun Preferences.toWidgetState(): DashboardWidgetState = widgetStateFrom(
        status = this[PreferencesKeys.STATUS],
        totalBalance = this[PreferencesKeys.TOTAL_BALANCE],
        dailyFlow = this[PreferencesKeys.DAILY_FLOW],
        currency = this[PreferencesKeys.CURRENCY],
        updatedAt = this[PreferencesKeys.UPDATED_AT],
        errorMessage = this[PreferencesKeys.ERROR_MESSAGE]
    )
}

private const val STATUS_SUCCESS = "SUCCESS"
private const val STATUS_ERROR = "ERROR"
private const val STATUS_EMPTY = "EMPTY"
private const val DEFAULT_CURRENCY = "COP"
private const val DEFAULT_ERROR_MESSAGE = "No se pudo actualizar el widget"

/**
 * Mapea los valores persistidos en Preferences al estado consumible por el widget.
 *
 * Se aísla como función pura (sin DataStore) para poder testear la semántica de
 * fallbacks sin infraestructura de Android.
 */
internal fun widgetStateFrom(
    status: String?,
    totalBalance: String?,
    dailyFlow: String?,
    currency: String?,
    updatedAt: Long?,
    errorMessage: String?
): DashboardWidgetState {
    val statusValue = status ?: return DashboardWidgetState.Loading
    return when (statusValue) {
        STATUS_SUCCESS -> DashboardWidgetState.Success(
            totalBalance = totalBalance?.toDoubleOrNull() ?: 0.0,
            dailyFlow = dailyFlow?.toDoubleOrNull() ?: 0.0,
            currency = currency ?: DEFAULT_CURRENCY,
            updatedAt = updatedAt ?: 0L
        )

        STATUS_ERROR -> DashboardWidgetState.Error(
            message = errorMessage ?: DEFAULT_ERROR_MESSAGE
        )

        STATUS_EMPTY -> DashboardWidgetState.Empty

        else -> DashboardWidgetState.Loading
    }
}
