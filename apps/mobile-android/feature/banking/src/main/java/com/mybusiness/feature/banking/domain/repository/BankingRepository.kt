package com.mybusiness.feature.banking.domain.repository

import com.mybusiness.core.common.result.Result
import com.mybusiness.core.model.BankProvider
import com.mybusiness.core.model.ConnectionStatus
import com.mybusiness.core.model.LinkSession
import com.mybusiness.core.model.LinkedAccount
import com.mybusiness.core.model.LinkedConnection
import com.mybusiness.core.model.SyncSummary
import javax.inject.Inject

/** Contrato de datos bancarios. La UI consume estos casos de uso. */
interface BankingRepository {

    suspend fun createLinkSession(provider: BankProvider): Result<LinkSession>

    suspend fun exchangeConnection(provider: BankProvider, publicToken: String): Result<LinkedConnection>

    suspend fun getConnections(): Result<List<LinkedConnection>>

    suspend fun getAccounts(connectionId: String): Result<List<LinkedAccount>>

    suspend fun syncConnection(connectionId: String): Result<SyncSummary>

    suspend fun disconnectConnection(connectionId: String): Result<Unit>
}

/** Resumen agregado de conexiones y sus cuentas. */
data class BankingOverview(
    val connections: List<LinkedConnection>,
    val accounts: List<LinkedAccount>
)

class StartBankLinkUseCase @Inject constructor(
    private val repository: BankingRepository
) {
    suspend operator fun invoke(provider: BankProvider): Result<LinkSession> =
        repository.createLinkSession(provider)
}

class CompleteBankLinkUseCase @Inject constructor(
    private val repository: BankingRepository
) {
    suspend operator fun invoke(provider: BankProvider, publicToken: String): Result<LinkedConnection> =
        repository.exchangeConnection(provider, publicToken)
}

/**
 * Obtiene conexiones y, para cada conexión utilizable (`ACTIVE` o `NEEDS_REAUTH`), sus cuentas.
 *
 * Degradación deliberada: si la carga de cuentas de una conexión falla, se omite esa conexión
 * y se devuelve `Result.Success` con las cuentas obtenidas del resto, en lugar de abortar todo
 * el resumen por un único fallo parcial.
 */
class GetBankingOverviewUseCase @Inject constructor(
    private val repository: BankingRepository
) {
    suspend operator fun invoke(): Result<BankingOverview> {
        val connections = when (val result = repository.getConnections()) {
            is Result.Success -> result.data
            is Result.Error -> return result
            Result.Loading -> return Result.Error(IllegalStateException("Carga de conexiones en curso"))
        }

        val accounts = mutableListOf<LinkedAccount>()
        connections
            .filter { it.status == ConnectionStatus.ACTIVE || it.status == ConnectionStatus.NEEDS_REAUTH }
            .forEach { connection ->
                when (val result = repository.getAccounts(connection.id)) {
                    is Result.Success -> accounts.addAll(result.data)
                    // Degradación: un fallo parcial no invalida el resto del resumen.
                    is Result.Error -> Unit
                    Result.Loading -> Unit
                }
            }

        return Result.Success(BankingOverview(connections = connections, accounts = accounts))
    }
}

class SyncBankConnectionUseCase @Inject constructor(
    private val repository: BankingRepository
) {
    suspend operator fun invoke(connectionId: String): Result<SyncSummary> =
        repository.syncConnection(connectionId)
}

class DisconnectBankConnectionUseCase @Inject constructor(
    private val repository: BankingRepository
) {
    suspend operator fun invoke(connectionId: String): Result<Unit> =
        repository.disconnectConnection(connectionId)
}
