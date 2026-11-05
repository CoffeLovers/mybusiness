package com.mybusiness.feature.auth.ui

import com.mybusiness.core.common.extensions.ErrorKind

data class AuthUiState(
    val email: String = "",
    val password: String = "",
    val isPasswordVisible: Boolean = false,
    val emailError: String? = null,
    val passwordError: String? = null,
    val isLoading: Boolean = false,
    val isSuccess: Boolean = false,
    val generalError: String? = null,
    val errorKind: ErrorKind? = null
) {
    val canSubmit: Boolean
        get() = email.isNotBlank() && password.isNotBlank() && !isLoading

    val isEmpty: Boolean
        get() = email.isBlank() && password.isBlank() && !isLoading && generalError == null
}
