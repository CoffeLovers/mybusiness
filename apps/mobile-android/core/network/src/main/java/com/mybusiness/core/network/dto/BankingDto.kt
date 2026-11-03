package com.mybusiness.core.network.dto

import kotlinx.serialization.Serializable

/** Solicitud de link token para iniciar la vinculación bancaria. */
@Serializable
data class LinkTokenRequest(
    val provider: String,
    val institutionId: String? = null
)

/** Respuesta con el link token del proveedor. */
@Serializable
data class LinkTokenResponse(
    val provider: String,
    val linkToken: String? = null,
    val expiration: String? = null
)

/** Intercambio del token público del proveedor por una conexión persistida. */
@Serializable
data class ExchangeConnectionRequest(
    val provider: String,
    val publicToken: String? = null,
    val institution: String? = null,
    val linkId: String? = null
)

/** Conexión bancaria tal como la expone el gateway. */
@Serializable
data class ConnectionDto(
    val id: String,
    val provider: String,
    val institutionName: String? = null,
    val status: String,
    val lastSuccessfulSyncAt: String? = null
)

/** Cuenta bancaria vinculada; los importes viajan como string en unidad menor. */
@Serializable
data class AccountDto(
    val id: String,
    val connectionId: String,
    val name: String,
    val mask: String? = null,
    val isoCurrencyCode: String,
    val balanceCurrentMinor: String? = null,
    val balanceAvailableMinor: String? = null,
    val status: String? = null,
    val lastSyncedAt: String? = null
)

/** Resultado de una sincronización de movimientos. */
@Serializable
data class SyncResponseDto(
    val connectionId: String,
    val added: Int,
    val modified: Int,
    val removed: Int,
    val hasMore: Boolean
)
