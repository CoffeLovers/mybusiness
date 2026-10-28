package com.mybusiness.feature.auth.domain.usecase

import com.mybusiness.core.common.result.Result
import com.mybusiness.core.model.User
import com.mybusiness.feature.auth.domain.repository.AuthRepository
import javax.inject.Inject

class LoginUseCase @Inject constructor(
    private val authRepository: AuthRepository
) {
    suspend operator fun invoke(email: String, password: String): Result<User> {
        val trimmedEmail = email.trim()
        if (trimmedEmail.isBlank()) {
            return Result.Error(IllegalArgumentException("El correo electrónico no puede estar vacío"))
        }
        if (!android.util.Patterns.EMAIL_ADDRESS.matcher(trimmedEmail).matches()) {
            return Result.Error(IllegalArgumentException("El formato del correo electrónico es inválido"))
        }
        if (password.isBlank()) {
            return Result.Error(IllegalArgumentException("La contraseña no puede estar vacía"))
        }
        if (password.length < 8) {
            return Result.Error(IllegalArgumentException("La contraseña debe tener al menos 8 caracteres"))
        }
        return authRepository.login(trimmedEmail, password)
    }
}
