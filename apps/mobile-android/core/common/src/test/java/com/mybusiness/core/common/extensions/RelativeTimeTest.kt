package com.mybusiness.core.common.extensions

import java.time.Instant
import java.time.temporal.ChronoUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RelativeTimeTest {

    private val now: Instant = Instant.parse("2026-11-04T12:00:00Z")

    private fun before(amount: Long, unit: ChronoUnit): String =
        now.minus(amount, unit).toString()

    @Test
    fun `null devuelve null`() {
        assertNull((null as String?).formatRelativeTime(now))
    }

    @Test
    fun `vacio devuelve null`() {
        assertNull("".formatRelativeTime(now))
        assertNull("   ".formatRelativeTime(now))
    }

    @Test
    fun `fecha sin hora se devuelve tal cual`() {
        assertEquals("2026-10-30", "2026-10-30".formatRelativeTime(now))
    }

    @Test
    fun `menos de un minuto`() {
        assertEquals("Hace un momento", now.minusSeconds(30).toString().formatRelativeTime(now))
    }

    @Test
    fun `cinco minutos`() {
        assertEquals("Hace 5 min", before(5, ChronoUnit.MINUTES).formatRelativeTime(now))
    }

    @Test
    fun `una hora`() {
        assertEquals("Hace 1 h", before(1, ChronoUnit.HOURS).formatRelativeTime(now))
    }

    @Test
    fun `tres horas`() {
        assertEquals("Hace 3 h", before(3, ChronoUnit.HOURS).formatRelativeTime(now))
    }

    @Test
    fun `ayer`() {
        assertEquals("Ayer", before(30, ChronoUnit.HOURS).formatRelativeTime(now))
    }

    @Test
    fun `tres dias`() {
        assertEquals("Hace 3 días", before(3, ChronoUnit.DAYS).formatRelativeTime(now))
    }

    @Test
    fun `fecha antigua usa formato corto`() {
        assertEquals("15 ene 2020", "2020-01-15T08:30:00Z".formatRelativeTime(now))
    }

    @Test
    fun `fecha invalida devuelve null`() {
        assertNull("no-es-una-fecha".formatRelativeTime(now))
    }

    @Test
    fun `fecha futura es ahora mismo`() {
        assertEquals("Ahora mismo", now.plusSeconds(120).toString().formatRelativeTime(now))
    }
}
