package com.mybusiness.feature.chat.data.voice

import com.mybusiness.feature.chat.domain.model.VoiceError
import com.mybusiness.feature.chat.domain.model.VoiceState
import com.mybusiness.feature.chat.domain.voice.VoiceManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class FakeVoiceManager : VoiceManager {

    private val _state = MutableStateFlow<VoiceState>(VoiceState.Idle)
    override val state: StateFlow<VoiceState> = _state.asStateFlow()

    private val _partialTranscription = MutableStateFlow("")
    override val partialTranscription: StateFlow<String> = _partialTranscription.asStateFlow()

    private var onTranscriptionCallback: ((String) -> Unit)? = null
    private var onTtsCallback: (() -> Unit)? = null

    var lastSpokenText: String? = null
        private set
    var isDestroyed: Boolean = false
        private set

    override fun startListening(onTranscriptionComplete: (String) -> Unit) {
        onTranscriptionCallback = onTranscriptionComplete
        _partialTranscription.value = ""
        _state.value = VoiceState.Listening
    }

    override fun stopListening() {
        _state.value = VoiceState.Processing
    }

    override fun cancelListening() {
        _state.value = VoiceState.Idle
        _partialTranscription.value = ""
        onTranscriptionCallback = null
    }

    override fun speak(text: String, onComplete: () -> Unit) {
        lastSpokenText = text
        onTtsCallback = onComplete
        _state.value = VoiceState.Speaking(text)
    }

    override fun stopSpeaking() {
        if (_state.value is VoiceState.Speaking) {
            _state.value = VoiceState.Idle
        }
        onTtsCallback = null
    }

    override fun onPermissionDenied() {
        _state.value = VoiceState.Error(VoiceError.PermissionDenied)
    }

    override fun resetState() {
        _state.value = VoiceState.Idle
        _partialTranscription.value = ""
    }

    override fun destroy() {
        isDestroyed = true
        _state.value = VoiceState.Idle
    }

    // Métodos utilitarios de prueba
    fun emitPartialTranscription(text: String) {
        _partialTranscription.value = text
    }

    fun emitFinalTranscription(text: String) {
        _partialTranscription.value = text
        _state.value = VoiceState.Idle
        onTranscriptionCallback?.invoke(text)
    }

    fun emitError(error: VoiceError) {
        _state.value = VoiceState.Error(error)
    }

    fun emitTtsComplete() {
        _state.value = VoiceState.Idle
        onTtsCallback?.invoke()
        onTtsCallback = null
    }
}
