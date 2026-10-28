package com.mybusiness.core.network.dto

import kotlinx.serialization.Serializable

@Serializable
data class ApiErrorResponse(
    val statusCode: Int = 0,
    val message: String = "",
    val error: String? = null
)
