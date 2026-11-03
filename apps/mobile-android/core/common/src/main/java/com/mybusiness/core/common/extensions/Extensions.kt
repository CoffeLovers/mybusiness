package com.mybusiness.core.common.extensions

import java.text.NumberFormat
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

fun Double.formatCurrency(currencyCode: String = "COP"): String {
    val format = NumberFormat.getCurrencyInstance(Locale("es", "CO"))
    return format.format(this).replace("COP", "").trim() + " " + currencyCode
}

/**
 * Convierte una marca ISO 8601 (`2026-11-03T05:15:37.000Z`) en texto local legible.
 * Devuelve null si está vacía o no se puede interpretar (nunca lanza).
 */
fun String?.formatIsoDateTime(): String? {
    val value = this?.trim().takeUnless { it.isNullOrEmpty() } ?: return null
    // Fecha sin hora (`YYYY-MM-DD`): se devuelve tal cual.
    if (value.length == DATE_ONLY_LENGTH) return value

    val zoned: ZonedDateTime = runCatching { OffsetDateTime.parse(value).toZonedDateTime() }
        .getOrNull()
        ?: runCatching { Instant.parse(value).atZone(ZoneId.systemDefault()) }.getOrNull()
        ?: return null

    return runCatching {
        zoned.withZoneSameInstant(ZoneId.systemDefault()).format(DATE_TIME_FORMATTER)
    }.getOrNull()
}

private const val DATE_ONLY_LENGTH = 10

private val DATE_TIME_FORMATTER: DateTimeFormatter =
    DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm", Locale("es", "ES"))
