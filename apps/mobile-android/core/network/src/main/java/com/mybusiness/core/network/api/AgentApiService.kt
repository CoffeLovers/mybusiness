package com.mybusiness.core.network.api

import com.mybusiness.core.network.dto.AgentChatRequest
import com.mybusiness.core.network.dto.AgentChatResponse
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST

interface AgentApiService {

    @POST("agent/chat")
    suspend fun sendMessage(@Body body: AgentChatRequest): Response<AgentChatResponse>
}
