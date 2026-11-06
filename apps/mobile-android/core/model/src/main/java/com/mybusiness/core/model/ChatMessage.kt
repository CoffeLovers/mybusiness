package com.mybusiness.core.model

import kotlinx.serialization.Serializable

@Serializable
data class ChatCitation(
    val source: String,
    val ref: String,
    val tool: String? = null,
    val period: String? = null,
    val label: String? = null
)

@Serializable
data class ChatMessage(
    val id: String,
    val content: String,
    val isFromUser: Boolean,
    val timestamp: Long = System.currentTimeMillis(),
    val isStreaming: Boolean = false,
    val activeTool: String? = null,
    val citations: List<ChatCitation> = emptyList(),
    val isDegraded: Boolean = false
)

sealed interface ChatStreamEvent {
    data class Token(val text: String, val index: Int = 0) : ChatStreamEvent
    data class Tool(val toolName: String, val status: String = "running") : ChatStreamEvent
    data class Citation(val citation: ChatCitation) : ChatStreamEvent
    data class Done(val fullText: String, val degraded: Boolean = false) : ChatStreamEvent
    data class Error(val message: String, val canFallback: Boolean = true) : ChatStreamEvent
}
