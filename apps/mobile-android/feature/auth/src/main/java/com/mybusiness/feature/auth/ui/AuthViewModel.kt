package com.mybusiness.feature.auth.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.mybusiness.core.common.extensions.ErrorKind
import com.mybusiness.core.common.extensions.toErrorKind
import com.mybusiness.core.common.extensions.toUserMessage
import com.mybusiness.core.common.result.Result
import com.mybusiness.feature.auth.domain.usecase.LoginUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val loginUseCase: LoginUseCase
) : ViewModel() {

    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    fun onEmailChanged(newEmail: String) {
        _uiState.update {
            it.copy(
                email = newEmail,
                emailError = null,
                generalError = null,
                errorKind = null
            )
        }
    }

    fun onPasswordChanged(newPassword: String) {
        _uiState.update {
            it.copy(
                password = newPassword,
                passwordError = null,
                generalError = null,
                errorKind = null
            )
        }
    }

    fun togglePasswordVisibility() {
        _uiState.update { it.copy(isPasswordVisible = !it.isPasswordVisible) }
    }

    fun clearError() {
        _uiState.update { it.copy(generalError = null, errorKind = null) }
    }

    fun login() {
        val currentState = _uiState.value
        val email = currentState.email.trim()
        val password = currentState.password

        // Validaciones locales rápidas
        var hasError = false
        if (email.isBlank()) {
            _uiState.update { it.copy(emailError = "Ingresa tu correo electrónico") }
            hasError = true
        } else if (!android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches()) {
            _uiState.update { it.copy(emailError = "Formato de correo no válido") }
            hasError = true
        }

        if (password.isBlank()) {
            _uiState.update { it.copy(passwordError = "Ingresa tu contraseña") }
            hasError = true
        } else if (password.length < 8) {
            _uiState.update { it.copy(passwordError = "Mínimo 8 caracteres") }
            hasError = true
        }

        if (hasError) return

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, generalError = null, errorKind = null) }
            when (val result = loginUseCase(email, password)) {
                is Result.Success -> {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            isSuccess = true,
                            generalError = null,
                            errorKind = null
                        )
                    }
                }
                is Result.Error -> {
                    val kind = result.toErrorKind()
                    val message = when (kind) {
                        ErrorKind.Unauthorized -> "Correo o contraseña incorrectos."
                        ErrorKind.Network, ErrorKind.Generic ->
                            result.toUserMessage("No pudimos iniciar sesión. Inténtalo de nuevo.")
                    }
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            isSuccess = false,
                            generalError = message,
                            errorKind = kind
                        )
                    }
                }
                is Result.Loading -> {
                    _uiState.update { it.copy(isLoading = true) }
                }
            }
        }
    }
}
