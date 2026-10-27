package com.mybusiness.feature.auth.domain.repository

import com.mybusiness.core.common.result.Result
import com.mybusiness.core.model.User
import kotlinx.coroutines.flow.Flow

interface AuthRepository {
    suspend fun login(email: String, password: String): Result<User>
    suspend fun logout(): Result<Unit>
    fun isUserLoggedIn(): Flow<Boolean>
    fun getCurrentUser(): Flow<User?>
}
