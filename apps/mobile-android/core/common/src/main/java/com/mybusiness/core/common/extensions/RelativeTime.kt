package com.mybusiness.core.common.extensions

import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

/**
 * Convierte una marca ISO 8601 en un texto relativo legible (`Hace 5 min`).
 *
 * - `null` o vacío -> `null`.
 * - Fecha sin hora (`YYYY-MM-DD`) -> se devuelve tal cual.
 * - Si el texto no se puede interpretar -> `null` (nunca lanza).
 */
fun String?.formatRelativeTime(now: Instant = Instant.now()): String? {
    val value = this?.trim().takeUnless { it.isNullOrEmpty() } ?: return null
    if (value.length == DATE_ONLY_LENGTH) return value

    val instant: Instant = parseInstantOrNull(value) ?: return null
    val elapsed: Long = ChronoUnit.SECONDS.between(instant, now)

    return when {
        elapsed < 0 -> "Ahora mismo"
        elapsed < SECONDS_PER_MINUTE -> "Hace un momento"
        elapsed < SECONDS_PER_HOUR -> "Hace ${elapsed / SECONDS_PER_MINUTE} min"
        elapsed < SECONDS_PER_DAY -> "Hace ${elapsed / SECONDS_PER_HOUR} h"
        elapsed < 2 * SECONDS_PER_DAY -> "Ayer"
        elapsed < 7 * SECONDS_PER_DAY -> {
            val days = elapsed / SECONDS_PER_DAY
            if (days == 1L) "Hace 1 día" else "Hace $days días"
        }
        else -> runCatching {
            instant.atZone(ZoneId.systemDefault()).format(DATE_FORMATTER)
        }.getOrNull()
    }
}

private fun parseInstantOrNull(value: String): Instant? =
    runCatching { OffsetDateTime.parse(value).toInstant() }.getOrNull()
        ?: runCatching { Instant.parse(value) }.getOrNull()

private const val DATE_ONLY_LENGTH = 10
private const val SECONDS_PER_MINUTE = 60L
private const val SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE
private const val SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR

private val DATE_FORMATTER: DateTimeFormatter =
    DateTimeFormatter.ofPattern("d MMM yyyy", Locale("es", "ES"))
