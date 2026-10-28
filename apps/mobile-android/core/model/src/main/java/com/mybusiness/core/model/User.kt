package com.mybusiness.core.model

import kotlinx.serialization.Serializable

@Serializable
enum class UserRole {
    SUPER_ADMIN,
    TENANT_ADMIN,
    ACCOUNTANT,
    AUDITOR,
    VIEWER,
    EMPLOYEE
}

@Serializable
data class User(
    val id: String,
    val email: String,
    val firstName: String,
    val lastName: String,
    val role: UserRole,
    val tenantId: String,
    val companyName: String? = null
) {
    val fullName: String
        get() = "$firstName $lastName".trim()
}
