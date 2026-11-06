package com.mybusiness.feature.chat.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.mybusiness.core.common.result.Result
import com.mybusiness.core.model.ChatMessage
import com.mybusiness.core.model.ChatStreamEvent
import com.mybusiness.feature.chat.domain.repository.ChatRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

data class ChatUiState(
    val messages: List<ChatMessage> = emptyList(),
    val inputText: String = "",
    val isGenerating: Boolean = false,
    val activeTool: String? = null,
    val warningMessage: String? = null,
    val talkBackAnnouncement: String? = null
)

@HiltViewModel
class ChatViewModel @Inject constructor(
    private val repository: ChatRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    private var streamJob: Job? = null
    private val accumulatedTokens = StringBuilder()

    init {
        viewModelScope.launch {
            repository.messages.collect { messages ->
                _uiState.update { it.copy(messages = messages) }
            }
        }
    }

    fun onInputTextChanged(newText: String) {
        _uiState.update { it.copy(inputText = newText) }
    }

    fun sendMessage() {
        val text = _uiState.value.inputText.trim()
        if (text.isEmpty() || _uiState.value.isGenerating) return

        _uiState.update {
            it.copy(
                inputText = "",
                isGenerating = true,
                activeTool = null,
                warningMessage = null,
                talkBackAnnouncement = null
            )
        }
        accumulatedTokens.clear()

        repository.addUserMessage(text)

        streamJob = viewModelScope.launch {
            try {
                repository.sendMessageStream(text).collect { event ->
                    when (event) {
                        is ChatStreamEvent.Token -> {
                            accumulatedTokens.append(event.text)
                            repository.updateStreamingMessage(
                                content = accumulatedTokens.toString(),
                                activeTool = _uiState.value.activeTool,
                                isStreaming = true
                            )
                        }
                        is ChatStreamEvent.Tool -> {
                            _uiState.update { it.copy(activeTool = event.toolName) }
                            repository.updateStreamingMessage(
                                content = accumulatedTokens.toString(),
                                activeTool = event.toolName,
                                isStreaming = true
                            )
                        }
                        is ChatStreamEvent.Citation -> {
                            // Cita recibida
                        }
                        is ChatStreamEvent.Done -> {
                            val finalContent = if (accumulatedTokens.isNotEmpty()) {
                                accumulatedTokens.toString()
                            } else {
                                event.fullText
                            }
                            repository.finalizeStreamingMessage(finalContent, event.degraded)
                            _uiState.update {
                                it.copy(
                                    isGenerating = false,
                                    activeTool = null,
                                    talkBackAnnouncement = finalContent
                                )
                            }
                        }
                        is ChatStreamEvent.Error -> {
                            Timber.w("Error recibido en stream: %s (fallback=%b)", event.message, event.canFallback)
                            if (event.canFallback && accumulatedTokens.isEmpty()) {
                                triggerFallback(text)
                            } else {
                                val errorContent = accumulatedTokens.toString().ifEmpty {
                                    "Error al recibir la respuesta: ${event.message}"
                                }
                                repository.finalizeStreamingMessage(errorContent, degraded = true)
                                _uiState.update {
                                    it.copy(
                                        isGenerating = false,
                                        activeTool = null,
                                        talkBackAnnouncement = errorContent
                                    )
                                }
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                Timber.w(e, "Excepción durante consumo de streaming")
                if (accumulatedTokens.isEmpty()) {
                    triggerFallback(text)
                } else {
                    repository.finalizeStreamingMessage(accumulatedTokens.toString(), degraded = true)
                    _uiState.update {
                        it.copy(
                            isGenerating = false,
                            activeTool = null
                        )
                    }
                }
            }
        }
    }

    private suspend fun triggerFallback(originalMessage: String) {
        _uiState.update {
            it.copy(
                warningMessage = "Canal incremental no disponible. Obteniendo respuesta estándar...",
                activeTool = null
            )
        }
        when (val result = repository.sendMessageFallback(originalMessage)) {
            is Result.Success -> {
                _uiState.update {
                    it.copy(
                        isGenerating = false,
                        talkBackAnnouncement = result.data.content
                    )
                }
            }
            is Result.Error -> {
                val errorMsg = "No se pudo obtener respuesta del asistente: ${result.message}"
                _uiState.update {
                    it.copy(
                        isGenerating = false,
                        warningMessage = errorMsg,
                        talkBackAnnouncement = errorMsg
                    )
                }
            }
            Result.Loading -> {
                // Estado intermedio
            }
        }
    }

    fun cancelGeneration() {
        if (_uiState.value.isGenerating) {
            streamJob?.cancel()
            streamJob = null
            val partial = accumulatedTokens.toString()
            val finalContent = if (partial.isNotEmpty()) "$partial [Cancelado]" else "Respuesta cancelada"
            repository.finalizeStreamingMessage(finalContent, degraded = true)
            _uiState.update {
                it.copy(
                    isGenerating = false,
                    activeTool = null,
                    talkBackAnnouncement = finalContent
                )
            }
        }
    }

    fun dismissWarning() {
        _uiState.update { it.copy(warningMessage = null) }
    }

    fun clearTalkBackAnnouncement() {
        _uiState.update { it.copy(talkBackAnnouncement = null) }
    }

    override fun onCleared() {
        cancelGeneration()
        super.onCleared()
    }
}
