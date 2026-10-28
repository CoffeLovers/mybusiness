package com.mybusiness.core.network.dto

import com.mybusiness.core.model.UserRole
import kotlinx.serialization.Serializable

@Serializable
data class UserDto(
    val id: String,
    val email: String,
    val firstName: String,
    val lastName: String,
    val role: UserRole,
    val tenantId: String,
    val companyName: String? = null
)

@Serializable
data class AuthResponse(
    val accessToken: String,
    val refreshToken: String,
    val user: UserDto
)
