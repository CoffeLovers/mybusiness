package com.mybusiness.core.network.dto

import kotlinx.serialization.Serializable

@Serializable
data class RegisterRequest(
    val email: String,
    val password: String,
    val firstName: String,
    val lastName: String,
    val companyName: String,
    val taxId: String,
    val country: String? = null,
    val currency: String? = "COP"
)
