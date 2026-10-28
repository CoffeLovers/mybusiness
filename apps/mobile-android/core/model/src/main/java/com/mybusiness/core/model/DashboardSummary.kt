package com.mybusiness.core.model

import kotlinx.serialization.Serializable

@Serializable
data class DashboardSummary(
    val totalBalance: Double,
    val monthlyIncome: Double,
    val monthlyExpenses: Double,
    val netCashFlow: Double,
    val currency: String = "COP",
    val accounts: List<BankAccount> = emptyList(),
    val recentTransactions: List<Transaction> = emptyList()
)
