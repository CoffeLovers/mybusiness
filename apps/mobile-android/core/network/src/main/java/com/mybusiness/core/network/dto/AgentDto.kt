package com.mybusiness.core.network.dto

import com.mybusiness.core.model.ChatCitation
import kotlinx.serialization.Serializable

@Serializable
data class AgentChatRequest(
    val message: String,
    val conversationId: String? = null
)

@Serializable
data class ChatCitationDto(
    val source: String,
    val ref: String,
    val tool: String? = null,
    val period: String? = null,
    val label: String? = null
) {
    fun toDomain(): ChatCitation = ChatCitation(
        source = source,
        ref = ref,
        tool = tool,
        period = period,
        label = label
    )
}

@Serializable
data class AgentChatResponse(
    val answer: String,
    val citations: List<ChatCitationDto> = emptyList(),
    val degraded: Boolean = false,
    val reason: String? = null
)
