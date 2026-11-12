package com.mybusiness.feature.chat.domain.model

sealed interface VoiceError {
    data object PermissionDenied : VoiceError
    data object RecognitionUnavailable : VoiceError
    data object NoSpeechDetected : VoiceError
    data object NetworkError : VoiceError
    data object AudioError : VoiceError
    data class Unknown(val errorCode: Int? = null, val message: String? = null) : VoiceError
}

sealed interface VoiceState {
    data object Idle : VoiceState
    data object Listening : VoiceState
    data object Processing : VoiceState
    data class Speaking(val text: String) : VoiceState
    data class Error(val error: VoiceError) : VoiceState
}
