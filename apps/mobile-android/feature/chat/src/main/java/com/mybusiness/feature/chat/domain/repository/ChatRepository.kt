package com.mybusiness.feature.chat.domain.repository

import com.mybusiness.core.common.result.Result
import com.mybusiness.core.model.ChatMessage
import com.mybusiness.core.model.ChatStreamEvent
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

interface ChatRepository {
    val messages: StateFlow<List<ChatMessage>>
    fun sendMessageStream(message: String, conversationId: String? = null): Flow<ChatStreamEvent>
    suspend fun sendMessageFallback(message: String, conversationId: String? = null): Result<ChatMessage>
    fun addUserMessage(content: String): ChatMessage
    fun updateStreamingMessage(content: String, activeTool: String? = null, isStreaming: Boolean = true)
    fun finalizeStreamingMessage(content: String, degraded: Boolean = false)
    fun clearHistory()
}
