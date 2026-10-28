package com.mybusiness.core.common.result

sealed interface Result<out T> {
    data class Success<T>(val data: T) : Result<T>
    data class Error(val exception: Throwable, val message: String = exception.localizedMessage ?: "Error desconocido") : Result<Nothing>
    data object Loading : Result<Nothing>
}

inline fun <T> Result<T>.onSuccess(action: (value: T) -> Unit): Result<T> {
    if (this is Result.Success) action(data)
    return this
}

inline fun <T> Result<T>.onError(action: (exception: Throwable, message: String) -> Unit): Result<T> {
    if (this is Result.Error) action(exception, message)
    return this
}
