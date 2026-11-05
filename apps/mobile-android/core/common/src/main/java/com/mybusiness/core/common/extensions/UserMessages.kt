package com.mybusiness.core.common.extensions

import com.mybusiness.core.common.result.Result

enum class ErrorKind { Unauthorized, Network, Generic }

/**
 * Clasifica un error de dominio en una categoria estable para la UI.
 * No depende del texto exacto mostrado al usuario.
 */
fun Result.Error.toErrorKind(): ErrorKind {
    val haystack = buildString {
        append(message)
        append(' ')
        append(exception::class.simpleName.orEmpty())
    }.lowercase()

    return when {
        UNAUTHORIZED_HINTS.any { haystack.contains(it) } -> ErrorKind.Unauthorized
        NETWORK_HINTS.any { haystack.contains(it) } -> ErrorKind.Network
        else -> ErrorKind.Generic
    }
}

/**
 * Devuelve un mensaje apto para UI. Nunca expone el mensaje crudo ni codigos HTTP.
 */
fun Result.Error.toUserMessage(fallback: String): String = when (toErrorKind()) {
    ErrorKind.Unauthorized -> "Tu sesión expiró. Vuelve a iniciar sesión."
    ErrorKind.Network -> "No pudimos conectar. Revisa tu conexión e inténtalo de nuevo."
    ErrorKind.Generic -> fallback
}

private val UNAUTHORIZED_HINTS = listOf(
    "401",
    "unauthorized",
    "no autorizado",
    "session",
    "sesión",
)

private val NETWORK_HINTS = listOf(
    "timeout",
    "network",
    "connection",
    "conexión",
    "unable to resolve host",
    "failed to connect",
)
