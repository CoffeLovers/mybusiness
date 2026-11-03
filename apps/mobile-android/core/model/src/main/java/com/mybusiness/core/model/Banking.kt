package com.mybusiness.core.model

import java.math.BigDecimal
import kotlinx.serialization.Serializable

@Serializable
enum class BankProvider { PLAID, BELVO }

@Serializable
enum class ConnectionStatus { PENDING, ACTIVE, NEEDS_REAUTH, ERROR, DISCONNECTED }

/** Sesión de vinculación devuelta por el backend (link token del proveedor). */
data class LinkSession(
    val provider: BankProvider,
    val linkToken: String,
    val expiration: String? = null
)

@Serializable
data class LinkedConnection(
    val id: String,
    val provider: BankProvider,
    val institutionId: String? = null,
    val institutionName: String? = null,
    val status: ConnectionStatus,
    /** Última sincronización exitosa, ISO 8601, tal como la envía el backend. */
    val lastSuccessfulSyncAt: String? = null
)

/**
 * Cuenta bancaria vinculada según `GET /banking/connections/:id/accounts`.
 * Los importes viajan como string en unidad menor; nunca se convierten a Double.
 */
@Serializable
data class LinkedAccount(
    val id: String,
    val connectionId: String,
    val name: String,
    val mask: String? = null,
    val isoCurrencyCode: String,
    val balanceCurrentMinor: String? = null,
    val balanceAvailableMinor: String? = null,
    val status: String? = null,
    /** Última sincronización exitosa de esta cuenta (ISO 8601). */
    val lastSyncedAt: String? = null
)

data class SyncSummary(
    val connectionId: String,
    val added: Int,
    val modified: Int,
    val removed: Int,
    val hasMore: Boolean
)

/** Convierte un importe en unidad menor a texto decimal sin usar Double. Null si no es numérico. */
fun minorToDecimalString(minor: String?, fractionDigits: Int = 2): String? {
    val value = minor?.trim().takeUnless { it.isNullOrEmpty() } ?: return null
    return try {
        BigDecimal(value).movePointLeft(fractionDigits).stripTrailingZeros().toPlainString()
    } catch (e: NumberFormatException) {
        null
    }
}
