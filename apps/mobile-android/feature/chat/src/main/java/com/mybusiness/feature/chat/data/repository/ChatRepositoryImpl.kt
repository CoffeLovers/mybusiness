package com.mybusiness.feature.chat.data.repository

import com.mybusiness.core.common.result.Result
import com.mybusiness.core.model.ChatMessage
import com.mybusiness.core.model.ChatStreamEvent
import com.mybusiness.core.network.api.AgentApiService
import com.mybusiness.core.network.dto.AgentChatRequest
import com.mybusiness.core.network.sse.ChatSseClient
import com.mybusiness.feature.chat.domain.repository.ChatRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import timber.log.Timber
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ChatRepositoryImpl @Inject constructor(
    private val sseClient: ChatSseClient,
    private val agentApiService: AgentApiService
) : ChatRepository {

    private val _messages = MutableStateFlow<List<ChatMessage>>(emptyList())
    override val messages: StateFlow<List<ChatMessage>> = _messages.asStateFlow()

    private var currentAssistantMessageId: String? = null

    override fun sendMessageStream(message: String, conversationId: String?): Flow<ChatStreamEvent> {
        return sseClient.streamChat(message, conversationId)
    }

    override suspend fun sendMessageFallback(message: String, conversationId: String?): Result<ChatMessage> {
        return try {
            val response = agentApiService.sendMessage(AgentChatRequest(message = message, conversationId = conversationId))
            if (response.isSuccessful && response.body() != null) {
                val body = response.body()!!
                val assistantMsg = ChatMessage(
                    id = UUID.randomUUID().toString(),
                    content = body.answer,
                    isFromUser = false,
                    isStreaming = false,
                    citations = body.citations.map { it.toDomain() },
                    isDegraded = body.degraded
                )
                _messages.update { current -> current + assistantMsg }
                Result.Success(assistantMsg)
            } else {
                val errorMsg = "Error en el servidor: HTTP ${response.code()}"
                Timber.w("Fallback no exitoso: %s", errorMsg)
                Result.Error(Exception(errorMsg))
            }
        } catch (e: Exception) {
            Timber.e(e, "Excepción en fallback de chat")
            Result.Error(e)
        }
    }

    override fun addUserMessage(content: String): ChatMessage {
        val userMsg = ChatMessage(
            id = UUID.randomUUID().toString(),
            content = content,
            isFromUser = true
        )
        _messages.update { current -> current + userMsg }
        currentAssistantMessageId = UUID.randomUUID().toString()
        return userMsg
    }

    override fun updateStreamingMessage(content: String, activeTool: String?, isStreaming: Boolean) {
        val id = currentAssistantMessageId ?: UUID.randomUUID().toString().also { currentAssistantMessageId = it }
        _messages.update { list ->
            val index = list.indexOfFirst { it.id == id }
            val updated = ChatMessage(
                id = id,
                content = content,
                isFromUser = false,
                isStreaming = isStreaming,
                activeTool = activeTool
            )
            if (index >= 0) {
                list.toMutableList().apply { set(index, updated) }
            } else {
                list + updated
            }
        }
    }

    override fun finalizeStreamingMessage(content: String, degraded: Boolean) {
        val id = currentAssistantMessageId ?: return
        _messages.update { list ->
            val index = list.indexOfFirst { it.id == id }
            if (index >= 0) {
                val existing = list[index]
                val finalized = existing.copy(
                    content = content.ifEmpty { existing.content },
                    isStreaming = false,
                    activeTool = null,
                    isDegraded = degraded
                )
                list.toMutableList().apply { set(index, finalized) }
            } else {
                list
            }
        }
        currentAssistantMessageId = null
    }

    override fun clearHistory() {
        _messages.value = emptyList()
        currentAssistantMessageId = null
    }
}
