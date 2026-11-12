package com.mybusiness.feature.chat.domain.voice

import com.mybusiness.feature.chat.domain.model.VoiceError
import com.mybusiness.feature.chat.domain.model.VoiceState
import kotlinx.coroutines.flow.StateFlow

interface VoiceManager {
    val state: StateFlow<VoiceState>
    val partialTranscription: StateFlow<String>

    fun startListening(onTranscriptionComplete: (String) -> Unit = {})
    fun stopListening()
    fun cancelListening()

    fun speak(text: String, onComplete: () -> Unit = {})
    fun stopSpeaking()

    fun onPermissionDenied()

    fun resetState()
    fun destroy()
}
