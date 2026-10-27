package com.mybusiness.core.network.api

import com.mybusiness.core.network.dto.AuthResponse
import com.mybusiness.core.network.dto.LoginRequest
import com.mybusiness.core.network.dto.RefreshTokenRequest
import com.mybusiness.core.network.dto.RegisterRequest
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST

interface AuthApiService {

    @POST("auth/login")
    suspend fun login(
        @Body request: LoginRequest
    ): Response<AuthResponse>

    @POST("auth/register")
    suspend fun register(
        @Body request: RegisterRequest
    ): Response<AuthResponse>

    @POST("auth/refresh")
    suspend fun refreshToken(
        @Body request: RefreshTokenRequest
    ): Response<AuthResponse>
}
