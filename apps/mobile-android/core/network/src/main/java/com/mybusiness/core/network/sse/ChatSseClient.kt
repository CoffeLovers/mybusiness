package com.mybusiness.core.network.sse

import com.mybusiness.core.model.ChatCitation
import com.mybusiness.core.model.ChatStreamEvent
import com.mybusiness.core.network.BuildConfig
import com.mybusiness.core.network.dto.AgentChatRequest
import com.mybusiness.core.network.dto.ChatCitationDto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flowOn
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import timber.log.Timber
import java.io.BufferedReader
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

@Serializable
private data class TokenPayload(val text: String = "", val token: String = "", val index: Int = 0)

@Serializable
private data class ToolPayload(val tool: String = "", val toolName: String = "", val status: String = "running")

@Serializable
private data class DonePayload(val answer: String = "", val text: String = "", val degraded: Boolean = false)

@Serializable
private data class ErrorPayload(val message: String = "Error en el stream")

interface ChatSseClient {
    fun streamChat(message: String, conversationId: String? = null): Flow<ChatStreamEvent>
}

@Singleton
class ChatSseClientImpl @Inject constructor(
    private val okHttpClient: OkHttpClient,
    private val json: Json
) : ChatSseClient {

    override fun streamChat(message: String, conversationId: String?): Flow<ChatStreamEvent> = callbackFlow {
        val endpoint = BuildConfig.API_BASE_URL.trimEnd('/') + "/agent/chat/stream"
        val requestDto = AgentChatRequest(message = message, conversationId = conversationId)
        val bodyJson = json.encodeToString(AgentChatRequest.serializer(), requestDto)
        val requestBody = bodyJson.toRequestBody("application/json".toMediaType())

        val request = Request.Builder()
            .url(endpoint)
            .addHeader("Accept", "text/event-stream")
            .addHeader("Cache-Control", "no-cache")
            .post(requestBody)
            .build()

        val call = okHttpClient.newCall(request)

        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (!call.isCanceled()) {
                    Timber.w("SSE onFailure: %s", e.javaClass.simpleName)
                    trySend(ChatStreamEvent.Error(e.message ?: "Error de conexión", canFallback = true))
                    close(e)
                }
            }

            override fun onResponse(call: Call, response: Response) {
                if (!response.isSuccessful) {
                    val code = response.code
                    Timber.w("SSE no exitoso: HTTP %d", code)
                    trySend(ChatStreamEvent.Error("HTTP $code", canFallback = true))
                    close()
                    return
                }

                val responseBody = response.body
                if (responseBody == null) {
                    trySend(ChatStreamEvent.Error("Cuerpo de respuesta vacío", canFallback = true))
                    close()
                    return
                }

                try {
                    responseBody.byteStream().bufferedReader().use { reader ->
                        parseSseStream(reader)
                    }
                    close()
                } catch (e: Exception) {
                    if (!call.isCanceled()) {
                        Timber.w("SSE error al leer stream: %s", e.javaClass.simpleName)
                        trySend(ChatStreamEvent.Error(e.message ?: "Lectura interrumpida", canFallback = true))
                        close(e)
                    }
                }
            }

            private fun parseSseStream(reader: BufferedReader) {
                var currentEvent: String? = null
                var line: String? = reader.readLine()

                while (line != null) {
                    val trimmed = line.trim()
                    if (trimmed.isEmpty()) {
                        currentEvent = null
                    } else if (trimmed.startsWith("event:")) {
                        currentEvent = trimmed.removePrefix("event:").trim()
                    } else if (trimmed.startsWith("data:")) {
                        val data = trimmed.removePrefix("data:").trim()
                        dispatchEvent(currentEvent, data)
                    }
                    line = reader.readLine()
                }
            }

            private fun dispatchEvent(event: String?, data: String) {
                if (data.isEmpty()) return
                when (event) {
                    "token" -> {
                        val tokenText = parseToken(data)
                        if (tokenText.isNotEmpty()) {
                            trySend(ChatStreamEvent.Token(tokenText))
                        }
                    }
                    "tool" -> {
                        val toolName = parseTool(data)
                        trySend(ChatStreamEvent.Tool(toolName))
                    }
                    "citation" -> {
                        val citation = parseCitation(data)
                        if (citation != null) {
                            trySend(ChatStreamEvent.Citation(citation))
                        }
                    }
                    "done" -> {
                        val (text, degraded) = parseDone(data)
                        trySend(ChatStreamEvent.Done(fullText = text, degraded = degraded))
                    }
                    "error" -> {
                        val msg = parseError(data)
                        trySend(ChatStreamEvent.Error(msg, canFallback = true))
                    }
                    else -> {
                        // Si no hay evento explícito, intentar inferir
                        val token = parseToken(data)
                        if (token.isNotEmpty()) {
                            trySend(ChatStreamEvent.Token(token))
                        }
                    }
                }
            }

            private fun parseToken(data: String): String {
                return runCatching {
                    val payload = json.decodeFromString(TokenPayload.serializer(), data)
                    payload.text.ifEmpty { payload.token }
                }.getOrElse { data }
            }

            private fun parseTool(data: String): String {
                return runCatching {
                    val payload = json.decodeFromString(ToolPayload.serializer(), data)
                    payload.toolName.ifEmpty { payload.tool }
                }.getOrElse { "procesando" }
            }

            private fun parseCitation(data: String): ChatCitation? {
                return runCatching {
                    json.decodeFromString(ChatCitationDto.serializer(), data).toDomain()
                }.getOrNull()
            }

            private fun parseDone(data: String): Pair<String, Boolean> {
                return runCatching {
                    val payload = json.decodeFromString(DonePayload.serializer(), data)
                    Pair(payload.answer.ifEmpty { payload.text }, payload.degraded)
                }.getOrElse { Pair(data, false) }
            }

            private fun parseError(data: String): String {
                return runCatching {
                    json.decodeFromString(ErrorPayload.serializer(), data).message
                }.getOrElse { data }
            }
        })

        awaitClose {
            if (!call.isCanceled()) {
                call.cancel()
            }
        }
    }.flowOn(Dispatchers.IO)
}
