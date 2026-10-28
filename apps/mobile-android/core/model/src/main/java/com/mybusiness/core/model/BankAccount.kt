package com.mybusiness.core.model

import kotlinx.serialization.Serializable

@Serializable
enum class AccountType {
    CHECKING,
    SAVINGS,
    CREDIT,
    INVESTMENT
}

@Serializable
data class BankAccount(
    val id: String,
    val institutionName: String,
    val accountType: AccountType,
    val accountNumberMasked: String,
    val currency: String = "COP",
    val balance: Double = 0.0
)
