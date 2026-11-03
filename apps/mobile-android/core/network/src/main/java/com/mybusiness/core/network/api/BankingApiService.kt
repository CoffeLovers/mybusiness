package com.mybusiness.core.network.api

import com.mybusiness.core.network.dto.AccountDto
import com.mybusiness.core.network.dto.ConnectionDto
import com.mybusiness.core.network.dto.ExchangeConnectionRequest
import com.mybusiness.core.network.dto.LinkTokenRequest
import com.mybusiness.core.network.dto.LinkTokenResponse
import com.mybusiness.core.network.dto.SyncResponseDto
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

interface BankingApiService {

    @POST("banking/link-token")
    suspend fun createLinkToken(@Body body: LinkTokenRequest): Response<LinkTokenResponse>

    @POST("banking/exchange")
    suspend fun exchangeConnection(@Body body: ExchangeConnectionRequest): Response<ConnectionDto>

    @GET("banking/connections")
    suspend fun getConnections(): Response<List<ConnectionDto>>

    @GET("banking/connections/{id}/accounts")
    suspend fun getConnectionAccounts(@Path("id") connectionId: String): Response<List<AccountDto>>

    @POST("banking/connections/{id}/sync")
    suspend fun syncConnection(@Path("id") connectionId: String): Response<SyncResponseDto>
}
