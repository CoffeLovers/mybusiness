package com.mybusiness.feature.auth.ui

data class AuthUiState(
    val email: String = "admin@mybusiness.demo",
    val password: String = "Demo1234!",
    val isPasswordVisible: Boolean = false,
    val emailError: String? = null,
    val passwordError: String? = null,
    val isLoading: Boolean = false,
    val isSuccess: Boolean = false,
    val generalError: String? = null
) {
    val canSubmit: Boolean
        get() = email.isNotBlank() && password.isNotBlank() && !isLoading
}
