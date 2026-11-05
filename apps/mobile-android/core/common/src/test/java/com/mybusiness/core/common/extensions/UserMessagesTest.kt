package com.mybusiness.core.common.extensions

import com.mybusiness.core.common.result.Result
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class UserMessagesTest {

    private fun error(message: String, exception: Throwable = IllegalStateException(message)) =
        Result.Error(exception = exception, message = message)

    @Test
    fun `401 es Unauthorized`() {
        assertEquals(ErrorKind.Unauthorized, error("HTTP 401").toErrorKind())
    }

    @Test
    fun `unauthorized es Unauthorized`() {
        assertEquals(ErrorKind.Unauthorized, error("Unauthorized access").toErrorKind())
    }

    @Test
    fun `no autorizado es Unauthorized`() {
        assertEquals(ErrorKind.Unauthorized, error("Usuario no autorizado").toErrorKind())
    }

    @Test
    fun `session es Unauthorized`() {
        assertEquals(ErrorKind.Unauthorized, error("Invalid session token").toErrorKind())
    }

    @Test
    fun `sesion es Unauthorized`() {
        assertEquals(ErrorKind.Unauthorized, error("Sesión expirada").toErrorKind())
    }

    @Test
    fun `timeout es Network`() {
        assertEquals(ErrorKind.Network, error("Request timeout").toErrorKind())
    }

    @Test
    fun `network es Network`() {
        assertEquals(ErrorKind.Network, error("Network error").toErrorKind())
    }

    @Test
    fun `connection es Network`() {
        assertEquals(ErrorKind.Network, error("Connection refused").toErrorKind())
    }

    @Test
    fun `conexion es Network`() {
        assertEquals(ErrorKind.Network, error("Falló la conexión").toErrorKind())
    }

    @Test
    fun `unable to resolve host es Network`() {
        assertEquals(ErrorKind.Network, error("Unable to resolve host").toErrorKind())
    }

    @Test
    fun `failed to connect es Network`() {
        assertEquals(ErrorKind.Network, error("Failed to connect to server").toErrorKind())
    }

    @Test
    fun `otro error es Generic`() {
        assertEquals(ErrorKind.Generic, error("Algo salió mal").toErrorKind())
    }

    @Test
    fun `usa simpleName de la excepcion`() {
        class SessionExpiredException : RuntimeException("boom")
        assertEquals(
            ErrorKind.Unauthorized,
            Result.Error(SessionExpiredException(), "boom").toErrorKind()
        )
    }

    @Test
    fun `mensaje Unauthorized es claro`() {
        assertEquals(
            "Tu sesión expiró. Vuelve a iniciar sesión.",
            error("HTTP 401").toUserMessage("fallback")
        )
    }

    @Test
    fun `mensaje Network es claro`() {
        assertEquals(
            "No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.",
            error("timeout").toUserMessage("fallback")
        )
    }

    @Test
    fun `mensaje Generic usa fallback`() {
        assertEquals("fallback", error("Algo salió mal").toUserMessage("fallback"))
    }

    @Test
    fun `nunca devuelve el mensaje crudo`() {
        val raw = "HTTP 401 unauthorized: token abc123"
        val shown = error(raw).toUserMessage("fallback")
        assertFalse(shown.contains(raw))
        assertFalse(shown.contains("401"))
        assertFalse(shown.contains("abc123"))
    }
}
