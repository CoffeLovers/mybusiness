package com.mybusiness.feature.auth.data.repository

import com.mybusiness.core.common.result.Result
import com.mybusiness.core.datastore.UserSessionDataStore
import com.mybusiness.core.model.User
import com.mybusiness.core.network.api.AuthApiService
import com.mybusiness.core.network.dto.LoginRequest
import com.mybusiness.feature.auth.domain.repository.AuthRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepositoryImpl @Inject constructor(
    private val authApiService: AuthApiService,
    private val sessionDataStore: UserSessionDataStore
) : AuthRepository {

    override suspend fun login(email: String, password: String): Result<User> {
        return try {
            val response = authApiService.login(LoginRequest(email = email, password = password))
            if (response.isSuccessful && response.body() != null) {
                val authBody = response.body()!!
                val userDto = authBody.user

                // Persistir sesión de forma segura en DataStore Preferences
                sessionDataStore.saveSession(
                    accessToken = authBody.accessToken,
                    refreshToken = authBody.refreshToken,
                    userId = userDto.id,
                    tenantId = userDto.tenantId,
                    email = userDto.email
                )

                val user = User(
                    id = userDto.id,
                    email = userDto.email,
                    firstName = userDto.firstName,
                    lastName = userDto.lastName,
                    role = userDto.role,
                    tenantId = userDto.tenantId,
                    companyName = userDto.companyName
                )
                Result.Success(user)
            } else {
                val errorMsg = response.errorBody()?.string() ?: "Error de autenticación (${response.code()})"
                Timber.e("Error en login HTTP: $errorMsg")
                Result.Error(Exception(errorMsg), "Credenciales inválidas o servicio no disponible")
            }
        } catch (e: Exception) {
            Timber.e(e, "Excepción en login")
            Result.Error(e, e.localizedMessage ?: "Fallo de conexión con el servidor")
        }
    }

    override suspend fun logout(): Result<Unit> {
        return try {
            sessionDataStore.clearSession()
            Result.Success(Unit)
        } catch (e: Exception) {
            Timber.e(e, "Error al cerrar sesión")
            Result.Error(e)
        }
    }

    override fun isUserLoggedIn(): Flow<Boolean> {
        return sessionDataStore.isLoggedIn
    }

    override fun getCurrentUser(): Flow<User?> {
        return combine(
            sessionDataStore.userId,
            sessionDataStore.tenantId,
            sessionDataStore.userEmail
        ) { id, tenantId, email ->
            if (id != null && tenantId != null && email != null) {
                User(
                    id = id,
                    email = email,
                    firstName = "Usuario",
                    lastName = "MyBusiness",
                    role = com.mybusiness.core.model.UserRole.TENANT_ADMIN,
                    tenantId = tenantId
                )
            } else {
                null
            }
        }
    }
}
