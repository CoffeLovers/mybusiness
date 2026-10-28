package com.mybusiness.feature.auth.domain.usecase

import com.mybusiness.core.common.result.Result
import com.mybusiness.feature.auth.domain.repository.AuthRepository
import javax.inject.Inject

class LogoutUseCase @Inject constructor(
    private val authRepository: AuthRepository
) {
    suspend operator fun invoke(): Result<Unit> {
        return authRepository.logout()
    }
}
