package com.mybusiness.feature.banking.data.repository

import com.mybusiness.core.common.result.Result
import com.mybusiness.core.model.BankProvider
import com.mybusiness.core.model.ConnectionStatus
import com.mybusiness.core.model.LinkSession
import com.mybusiness.core.model.LinkedAccount
import com.mybusiness.core.model.LinkedConnection
import com.mybusiness.core.model.SyncSummary
import com.mybusiness.core.network.api.BankingApiService
import com.mybusiness.core.network.dto.AccountDto
import com.mybusiness.core.network.dto.ConnectionDto
import com.mybusiness.core.network.dto.ExchangeConnectionRequest
import com.mybusiness.core.network.dto.LinkTokenRequest
import com.mybusiness.core.network.dto.SyncResponseDto
import com.mybusiness.feature.banking.domain.repository.BankingRepository
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton
import retrofit2.Response
import timber.log.Timber

@Singleton
class BankingRepositoryImpl @Inject constructor(
    private val api: BankingApiService
) : BankingRepository {

    override suspend fun createLinkSession(provider: BankProvider): Result<LinkSession> {
        val response = when (val call = safeCall { api.createLinkToken(LinkTokenRequest(provider = provider.toApiValue())) }) {
            is Result.Success -> call.data
            is Result.Error -> return call
            Result.Loading -> return Result.Error(IllegalStateException("Solicitud en curso"))
        }

        if (!response.isSuccessful) {
            Timber.w("Fallo al crear link token: HTTP %d", response.code())
            return Result.Error(
                Exception("HTTP ${response.code()}"),
                "No se pudo iniciar la vinculación (HTTP ${response.code()})"
            )
        }

        val body = response.body()
        val linkToken = body?.linkToken?.takeIf { it.isNotBlank() }
        if (linkToken == null) {
            Timber.w("Respuesta de link token sin token")
            return Result.Error(
                IllegalStateException("Link token ausente"),
                "El proveedor no devolvió un token de vinculación"
            )
        }

        return Result.Success(
            LinkSession(
                provider = provider,
                linkToken = linkToken,
                expiration = body.expiration
            )
        )
    }

    override suspend fun exchangeConnection(
        provider: BankProvider,
        publicToken: String
    ): Result<LinkedConnection> {
        val body = ExchangeConnectionRequest(provider = provider.toApiValue(), publicToken = publicToken)
        val response = when (val call = safeCall { api.exchangeConnection(body) }) {
            is Result.Success -> call.data
            is Result.Error -> return call
            Result.Loading -> return Result.Error(IllegalStateException("Solicitud en curso"))
        }

        if (!response.isSuccessful) {
            Timber.w("Fallo al intercambiar conexión: HTTP %d", response.code())
            return Result.Error(
                Exception("HTTP ${response.code()}"),
                "No se pudo completar la vinculación (HTTP ${response.code()})"
            )
        }

        val dto = response.body()
            ?: return Result.Error(
                IllegalStateException("Cuerpo vacío en exchange"),
                "El servidor no devolvió la conexión vinculada"
            )

        return Result.Success(dto.toModel())
    }

    override suspend fun getConnections(): Result<List<LinkedConnection>> {
        val response = when (val call = safeCall { api.getConnections() }) {
            is Result.Success -> call.data
            is Result.Error -> return call
            Result.Loading -> return Result.Error(IllegalStateException("Solicitud en curso"))
        }

        if (!response.isSuccessful) {
            Timber.w("Fallo al obtener conexiones: HTTP %d", response.code())
            return Result.Error(
                Exception("HTTP ${response.code()}"),
                "No se pudieron cargar las conexiones bancarias (HTTP ${response.code()})"
            )
        }

        val dtos = response.body()
            ?: return Result.Error(
                IllegalStateException("Cuerpo vacío en conexiones"),
                "El servidor no devolvió conexiones bancarias"
            )

        return Result.Success(dtos.map { it.toModel() })
    }

    override suspend fun getAccounts(connectionId: String): Result<List<LinkedAccount>> {
        val response = when (val call = safeCall { api.getConnectionAccounts(connectionId) }) {
            is Result.Success -> call.data
            is Result.Error -> return call
            Result.Loading -> return Result.Error(IllegalStateException("Solicitud en curso"))
        }

        if (!response.isSuccessful) {
            Timber.w("Fallo al obtener cuentas: HTTP %d", response.code())
            return Result.Error(
                Exception("HTTP ${response.code()}"),
                "No se pudieron cargar las cuentas de la conexión (HTTP ${response.code()})"
            )
        }

        val dtos = response.body()
            ?: return Result.Error(
                IllegalStateException("Cuerpo vacío en cuentas"),
                "El servidor no devolvió cuentas bancarias"
            )

        return Result.Success(dtos.map { it.toModel() })
    }

    override suspend fun syncConnection(connectionId: String): Result<SyncSummary> {
        val response = when (val call = safeCall { api.syncConnection(connectionId) }) {
            is Result.Success -> call.data
            is Result.Error -> return call
            Result.Loading -> return Result.Error(IllegalStateException("Solicitud en curso"))
        }

        if (!response.isSuccessful) {
            Timber.w("Fallo al sincronizar conexión: HTTP %d", response.code())
            return Result.Error(
                Exception("HTTP ${response.code()}"),
                "No se pudo sincronizar la conexión (HTTP ${response.code()})"
            )
        }

        val dto = response.body()
            ?: return Result.Error(
                IllegalStateException("Cuerpo vacío en sincronización"),
                "El servidor no devolvió el resultado de la sincronización"
            )

        return Result.Success(dto.toModel())
    }

    override suspend fun disconnectConnection(connectionId: String): Result<Unit> {
        val response = when (val call = safeCall { api.disconnectConnection(connectionId) }) {
            is Result.Success -> call.data
            is Result.Error -> return call
            Result.Loading -> return Result.Error(IllegalStateException("Solicitud en curso"))
        }

        // El gateway puede responder 200, 202 (aceptado) o 204 (sin contenido) al desconectar.
        if (response.code() in SUCCESSFUL_DISCONNECT_CODES) {
            return Result.Success(Unit)
        }

        Timber.w("Fallo al desconectar conexión: HTTP %d", response.code())
        return Result.Error(
            Exception("HTTP ${response.code()}"),
            "No se pudo desconectar la conexión (HTTP ${response.code()})"
        )
    }

    /**
     * Ejecuta una llamada Retrofit capturando fallos de red y errores inesperados.
     * Los mensajes al usuario son genéricos; el log solo incluye la excepción, nunca tokens ni cuerpos.
     */
    private inline fun <T> safeCall(block: () -> Response<T>): Result<Response<T>> {
        return try {
            Result.Success(block())
        } catch (e: IOException) {
            Timber.w(e, "Error de red en la llamada bancaria")
            Result.Error(e, "Sin conexión con el servidor")
        } catch (e: Exception) {
            Timber.w(e, "Error inesperado en la llamada bancaria")
            Result.Error(e, "Error inesperado al comunicarse con el servidor")
        }
    }

    private fun BankProvider.toApiValue(): String = when (this) {
        BankProvider.PLAID -> "plaid"
        BankProvider.BELVO -> "belvo"
    }

    private fun String.toBankProvider(): BankProvider =
        runCatching { BankProvider.valueOf(trim().uppercase()) }
            // Un proveedor desconocido no debe romper la lista; se asume PLAID como fallback.
            .getOrDefault(BankProvider.PLAID)

    private fun String.toConnectionStatus(): ConnectionStatus =
        runCatching { ConnectionStatus.valueOf(trim().uppercase()) }
            // Estado desconocido: se trata como PENDING para que la UI pueda reintentar.
            .getOrDefault(ConnectionStatus.PENDING)

    private fun ConnectionDto.toModel(): LinkedConnection = LinkedConnection(
        id = id,
        provider = provider.toBankProvider(),
        institutionId = null,
        institutionName = institutionName,
        status = status.toConnectionStatus(),
        lastSuccessfulSyncAt = lastSuccessfulSyncAt
    )

    private fun AccountDto.toModel(): LinkedAccount = LinkedAccount(
        id = id,
        connectionId = connectionId,
        name = name,
        mask = mask,
        isoCurrencyCode = isoCurrencyCode,
        balanceCurrentMinor = balanceCurrentMinor,
        balanceAvailableMinor = balanceAvailableMinor,
        status = status,
        lastSyncedAt = lastSyncedAt
    )

    private fun SyncResponseDto.toModel(): SyncSummary = SyncSummary(
        connectionId = connectionId,
        added = added,
        modified = modified,
        removed = removed,
        hasMore = hasMore
    )

    private companion object {
        val SUCCESSFUL_DISCONNECT_CODES = setOf(200, 202, 204)
    }
}
