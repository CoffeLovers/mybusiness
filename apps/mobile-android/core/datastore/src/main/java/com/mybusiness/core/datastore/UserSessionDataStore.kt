package com.mybusiness.core.datastore

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.mybusiness.core.common.constants.Constants
import com.mybusiness.core.datastore.security.SessionCipher
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

val Context.userDataStore: DataStore<Preferences> by preferencesDataStore(name = Constants.DATASTORE_USER_PREFERENCES)

interface UserSessionDataStore {
    val accessToken: Flow<String?>
    val refreshToken: Flow<String?>
    val userId: Flow<String?>
    val tenantId: Flow<String?>
    val userEmail: Flow<String?>
    val isLoggedIn: Flow<Boolean>

    suspend fun saveTokens(accessToken: String, refreshToken: String)
    suspend fun saveSession(
        accessToken: String,
        refreshToken: String,
        userId: String,
        tenantId: String,
        email: String
    )
    suspend fun clearSession()
}

@Singleton
class UserSessionDataStoreImpl @Inject constructor(
    private val context: Context,
    private val cipher: SessionCipher
) : UserSessionDataStore {

    private object PreferencesKeys {
        val ACCESS_TOKEN = stringPreferencesKey("access_token")
        val REFRESH_TOKEN = stringPreferencesKey("refresh_token")
        val USER_ID = stringPreferencesKey("user_id")
        val TENANT_ID = stringPreferencesKey("tenant_id")
        val USER_EMAIL = stringPreferencesKey("user_email")
    }

    private val dataStore = context.userDataStore

    override val accessToken: Flow<String?> = dataStore.data
        .catch { exception ->
            if (exception is IOException) emit(emptyPreferences()) else throw exception
        }
        .map { preferences -> decryptOrNull(preferences[PreferencesKeys.ACCESS_TOKEN]) }

    override val refreshToken: Flow<String?> = dataStore.data
        .catch { exception ->
            if (exception is IOException) emit(emptyPreferences()) else throw exception
        }
        .map { preferences -> decryptOrNull(preferences[PreferencesKeys.REFRESH_TOKEN]) }

    override val userId: Flow<String?> = dataStore.data
        .catch { exception ->
            if (exception is IOException) emit(emptyPreferences()) else throw exception
        }
        .map { preferences -> preferences[PreferencesKeys.USER_ID] }

    override val tenantId: Flow<String?> = dataStore.data
        .catch { exception ->
            if (exception is IOException) emit(emptyPreferences()) else throw exception
        }
        .map { preferences -> preferences[PreferencesKeys.TENANT_ID] }

    override val userEmail: Flow<String?> = dataStore.data
        .catch { exception ->
            if (exception is IOException) emit(emptyPreferences()) else throw exception
        }
        .map { preferences -> preferences[PreferencesKeys.USER_EMAIL] }

    override val isLoggedIn: Flow<Boolean> = accessToken.map { token ->
        !token.isNullOrBlank()
    }

    override suspend fun saveTokens(accessToken: String, refreshToken: String) {
        val encryptedAccess = cipher.encrypt(accessToken)
        val encryptedRefresh = cipher.encrypt(refreshToken)
        dataStore.edit { preferences ->
            preferences[PreferencesKeys.ACCESS_TOKEN] = encryptedAccess
            preferences[PreferencesKeys.REFRESH_TOKEN] = encryptedRefresh
        }
    }

    override suspend fun saveSession(
        accessToken: String,
        refreshToken: String,
        userId: String,
        tenantId: String,
        email: String
    ) {
        val encryptedAccess = cipher.encrypt(accessToken)
        val encryptedRefresh = cipher.encrypt(refreshToken)
        dataStore.edit { preferences ->
            preferences[PreferencesKeys.ACCESS_TOKEN] = encryptedAccess
            preferences[PreferencesKeys.REFRESH_TOKEN] = encryptedRefresh
            preferences[PreferencesKeys.USER_ID] = userId
            preferences[PreferencesKeys.TENANT_ID] = tenantId
            // El email se guarda en claro: no es un token ni un secreto reutilizable, y se
            // necesita para mostrarlo en UI/telemetría sin desbloquear la clave.
            preferences[PreferencesKeys.USER_EMAIL] = email
        }
    }

    override suspend fun clearSession() {
        dataStore.edit { preferences ->
            preferences.clear()
        }
    }

    /**
     * Descifra un valor persistido. Devuelve null si el valor no se puede descifrar (sesión
     * legada guardada en claro o clave rotada).
     *
     * No se limpia la sesión aquí porque `map` no puede invocar `edit`; el flujo emite null,
     * `isLoggedIn` pasa a false y el `AuthInterceptor` limpia la sesión al recibir el 401
     * derivado de la petición sin token.
     */
    private fun decryptOrNull(value: String?): String? {
        if (value.isNullOrBlank()) return null
        return cipher.decrypt(value)
    }
}
