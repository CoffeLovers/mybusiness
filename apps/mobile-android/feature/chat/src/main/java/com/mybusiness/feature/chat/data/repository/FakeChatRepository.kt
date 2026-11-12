package com.mybusiness.feature.chat.data.repository

import com.mybusiness.core.common.result.Result
import com.mybusiness.core.model.ChatMessage
import com.mybusiness.core.model.ChatStreamEvent
import com.mybusiness.feature.chat.domain.repository.ChatRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.util.UUID

class FakeChatRepository : ChatRepository {

    private val _messages = MutableStateFlow<List<ChatMessage>>(emptyList())
    override val messages: StateFlow<List<ChatMessage>> = _messages.asStateFlow()

    var streamToEmit: Flow<ChatStreamEvent>? = null
    var fallbackResult: Result<ChatMessage> = Result.Success(
        ChatMessage(
            id = "fake-fallback-id",
            content = "Respuesta fallback no-streaming",
            isFromUser = false
        )
    )

    var fallbackCalledCount = 0
    var streamCalledCount = 0
    private var currentAssistantMessageId: String? = null

    override fun sendMessageStream(message: String, conversationId: String?): Flow<ChatStreamEvent> {
        streamCalledCount++
        return streamToEmit ?: MutableSharedFlow()
    }

    override suspend fun sendMessageFallback(message: String, conversationId: String?): Result<ChatMessage> {
        fallbackCalledCount++
        if (fallbackResult is Result.Success) {
            val msg = (fallbackResult as Result.Success).data
            _messages.update { it + msg }
        }
        return fallbackResult
    }

    override fun addUserMessage(content: String): ChatMessage {
        val userMsg = ChatMessage(
            id = UUID.randomUUID().toString(),
            content = content,
            isFromUser = true
        )
        _messages.update { it + userMsg }
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
