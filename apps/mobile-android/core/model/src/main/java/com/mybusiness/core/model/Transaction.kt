package com.mybusiness.core.model

import kotlinx.serialization.Serializable

@Serializable
enum class TransactionType {
    INCOME,
    EXPENSE,
    TRANSFER
}

@Serializable
enum class TransactionStatus {
    PENDING,
    COMPLETED,
    FAILED,
    CANCELLED
}

@Serializable
data class Transaction(
    val id: String,
    val bankAccountId: String,
    val description: String,
    val amount: Double,
    val currency: String = "COP",
    val type: TransactionType,
    val status: TransactionStatus = TransactionStatus.COMPLETED,
    val category: String? = null,
    val date: String
)
