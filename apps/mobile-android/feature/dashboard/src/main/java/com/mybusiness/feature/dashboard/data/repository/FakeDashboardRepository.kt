package com.mybusiness.feature.dashboard.data.repository

import com.mybusiness.core.common.result.Result
import com.mybusiness.core.model.AccountType
import com.mybusiness.core.model.BankAccount
import com.mybusiness.core.model.DashboardSummary
import com.mybusiness.core.model.Transaction
import com.mybusiness.core.model.TransactionStatus
import com.mybusiness.core.model.TransactionType
import com.mybusiness.feature.dashboard.domain.repository.DashboardRepository
import kotlinx.coroutines.delay
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class FakeDashboardRepository @Inject constructor() : DashboardRepository {

    override suspend fun getDashboardSummary(): Result<DashboardSummary> {
        delay(400) // Simular respuesta rápida

        val accounts = listOf(
            BankAccount(
                id = "acc-001",
                institutionName = "Bancolombia",
                accountType = AccountType.CHECKING,
                accountNumberMasked = "**** 4589",
                currency = "COP",
                balance = 98_350_000.0
            ),
            BankAccount(
                id = "acc-002",
                institutionName = "Davivienda",
                accountType = AccountType.SAVINGS,
                accountNumberMasked = "**** 1204",
                currency = "COP",
                balance = 56_500_000.0
            )
        )

        val transactions = listOf(
            Transaction(
                id = "tx-101",
                bankAccountId = "acc-001",
                description = "Cobro Factura #1042 - TechCorp",
                amount = 18_500_000.0,
                currency = "COP",
                type = TransactionType.INCOME,
                status = TransactionStatus.COMPLETED,
                category = "Ventas",
                date = "Hoy, 10:45 AM"
            ),
            Transaction(
                id = "tx-102",
                bankAccountId = "acc-001",
                description = "Pago Nómina Octubre",
                amount = 12_400_000.0,
                currency = "COP",
                type = TransactionType.EXPENSE,
                status = TransactionStatus.COMPLETED,
                category = "Recursos Humanos",
                date = "Ayer, 04:30 PM"
            ),
            Transaction(
                id = "tx-103",
                bankAccountId = "acc-002",
                description = "Servicios AWS Cloud Hosting",
                amount = 1_850_000.0,
                currency = "COP",
                type = TransactionType.EXPENSE,
                status = TransactionStatus.COMPLETED,
                category = "Infraestructura",
                date = "24 Oct 2026"
            ),
            Transaction(
                id = "tx-104",
                bankAccountId = "acc-002",
                description = "Anticipo Contrato Consultoría",
                amount = 8_200_000.0,
                currency = "COP",
                type = TransactionType.INCOME,
                status = TransactionStatus.COMPLETED,
                category = "Servicios",
                date = "22 Oct 2026"
            )
        )

        val summary = DashboardSummary(
            totalBalance = 154_850_000.0,
            monthlyIncome = 42_500_000.0,
            monthlyExpenses = 18_200_000.0,
            netCashFlow = 24_300_000.0,
            currency = "COP",
            accounts = accounts,
            recentTransactions = transactions
        )

        return Result.Success(summary)
    }
}
