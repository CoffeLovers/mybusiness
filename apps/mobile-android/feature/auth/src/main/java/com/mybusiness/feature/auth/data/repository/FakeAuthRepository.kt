package com.mybusiness.feature.auth.data.repository

import com.mybusiness.core.common.result.Result
import com.mybusiness.core.datastore.UserSessionDataStore
import com.mybusiness.core.model.User
import com.mybusiness.core.model.UserRole
import com.mybusiness.feature.auth.domain.repository.AuthRepository
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class FakeAuthRepository @Inject constructor(
    private val sessionDataStore: UserSessionDataStore
) : AuthRepository {

    override suspend fun login(email: String, password: String): Result<User> {
        Timber.d("Simulando login con FakeAuthRepository para: $email")
        // Simular latencia de red
        delay(600)

        // Simulación: acepta credenciales demo o cualquier contraseña de 8+ caracteres
        val mockUser = User(
            id = "mock-user-12345",
            email = email,
            firstName = "Alejandro",
            lastName = "Demo",
            role = UserRole.TENANT_ADMIN,
            tenantId = "mock-tenant-9999",
            companyName = "MyBusiness Demo S.A.S."
        )

        // Guardar sesión mock en DataStore para mantener el estado reactivo
        sessionDataStore.saveSession(
            accessToken = "mock-jwt-access-token-${System.currentTimeMillis()}",
            refreshToken = "mock-jwt-refresh-token-${System.currentTimeMillis()}",
            userId = mockUser.id,
            tenantId = mockUser.tenantId,
            email = mockUser.email
        )

        return Result.Success(mockUser)
    }

    override suspend fun logout(): Result<Unit> {
        Timber.d("Cerrando sesión en FakeAuthRepository")
        delay(200)
        sessionDataStore.clearSession()
        return Result.Success(Unit)
    }

    override fun isUserLoggedIn(): Flow<Boolean> {
        return sessionDataStore.isLoggedIn
    }

    override fun getCurrentUser(): Flow<User?> {
        return sessionDataStore.userEmail.map { email ->
            if (!email.isNullOrBlank()) {
                User(
                    id = "mock-user-12345",
                    email = email,
                    firstName = "Alejandro",
                    lastName = "Demo",
                    role = UserRole.TENANT_ADMIN,
                    tenantId = "mock-tenant-9999",
                    companyName = "MyBusiness Demo S.A.S."
                )
            } else {
                null
            }
        }
    }
}
