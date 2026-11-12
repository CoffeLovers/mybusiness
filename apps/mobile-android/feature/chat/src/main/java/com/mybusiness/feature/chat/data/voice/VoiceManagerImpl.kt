package com.mybusiness.feature.chat.data.voice

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import com.mybusiness.feature.chat.domain.model.VoiceError
import com.mybusiness.feature.chat.domain.model.VoiceState
import com.mybusiness.feature.chat.domain.voice.VoiceManager
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import timber.log.Timber
import java.util.Locale
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class VoiceManagerImpl @Inject constructor(
    @ApplicationContext private val context: Context
) : VoiceManager {

    private val mainHandler = Handler(Looper.getMainLooper())

    private val _state = MutableStateFlow<VoiceState>(VoiceState.Idle)
    override val state: StateFlow<VoiceState> = _state.asStateFlow()

    private val _partialTranscription = MutableStateFlow("")
    override val partialTranscription: StateFlow<String> = _partialTranscription.asStateFlow()

    private var speechRecognizer: SpeechRecognizer? = null
    private var onTranscriptionCompleteCallback: ((String) -> Unit)? = null

    private var textToSpeech: TextToSpeech? = null
    private var isTtsInitialized = false
    private var pendingTtsText: String? = null
    private var onTtsCompleteCallback: (() -> Unit)? = null

    init {
        initializeTts()
    }

    private fun initializeTts() {
        mainHandler.post {
            textToSpeech = TextToSpeech(context) { status ->
                if (status == TextToSpeech.SUCCESS) {
                    isTtsInitialized = true
                    textToSpeech?.language = Locale.getDefault()
                    textToSpeech?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                        override fun onStart(utteranceId: String?) {
                            // No loguear contenido sensible ni audio
                        }

                        override fun onDone(utteranceId: String?) {
                            mainHandler.post {
                                _state.value = VoiceState.Idle
                                onTtsCompleteCallback?.invoke()
                                onTtsCompleteCallback = null
                            }
                        }

                        override fun onError(utteranceId: String?) {
                            mainHandler.post {
                                _state.value = VoiceState.Idle
                                onTtsCompleteCallback = null
                            }
                        }
                    })
                    pendingTtsText?.let { text ->
                        pendingTtsText = null
                        speak(text, onTtsCompleteCallback ?: {})
                    }
                } else {
                    Timber.w("TextToSpeech initialization failed with status: %d", status)
                }
            }
        }
    }

    override fun startListening(onTranscriptionComplete: (String) -> Unit) {
        mainHandler.post {
            stopSpeaking()

            if (!SpeechRecognizer.isRecognitionAvailable(context)) {
                _state.value = VoiceState.Error(VoiceError.RecognitionUnavailable)
                return@post
            }

            cancelCurrentSpeechRecognizer()

            onTranscriptionCompleteCallback = onTranscriptionComplete
            _partialTranscription.value = ""
            _state.value = VoiceState.Listening

            try {
                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(context).apply {
                    setRecognitionListener(createRecognitionListener())
                }

                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                }

                speechRecognizer?.startListening(intent)
            } catch (e: Exception) {
                Timber.w(e, "Error al iniciar SpeechRecognizer")
                _state.value = VoiceState.Error(VoiceError.Unknown(message = e.localizedMessage))
            }
        }
    }

    override fun stopListening() {
        mainHandler.post {
            _state.value = VoiceState.Processing
            speechRecognizer?.stopListening()
        }
    }

    override fun cancelListening() {
        mainHandler.post {
            cancelCurrentSpeechRecognizer()
            _partialTranscription.value = ""
            _state.value = VoiceState.Idle
        }
    }

    override fun speak(text: String, onComplete: () -> Unit) {
        mainHandler.post {
            cancelListening()

            if (text.isBlank()) {
                _state.value = VoiceState.Idle
                onComplete()
                return@post
            }

            onTtsCompleteCallback = onComplete

            if (!isTtsInitialized || textToSpeech == null) {
                pendingTtsText = text
                _state.value = VoiceState.Speaking(text)
                return@post
            }

            _state.value = VoiceState.Speaking(text)
            val utteranceId = UUID.randomUUID().toString()
            textToSpeech?.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId)
        }
    }

    override fun stopSpeaking() {
        mainHandler.post {
            textToSpeech?.stop()
            pendingTtsText = null
            onTtsCompleteCallback = null
            if (_state.value is VoiceState.Speaking) {
                _state.value = VoiceState.Idle
            }
        }
    }

    override fun onPermissionDenied() {
        mainHandler.post {
            cancelListening()
            _state.value = VoiceState.Error(VoiceError.PermissionDenied)
        }
    }

    override fun resetState() {
        mainHandler.post {
            _state.value = VoiceState.Idle
            _partialTranscription.value = ""
        }
    }

    override fun destroy() {
        mainHandler.post {
            cancelCurrentSpeechRecognizer()
            stopSpeaking()
            textToSpeech?.shutdown()
            textToSpeech = null
            isTtsInitialized = false
        }
    }

    private fun cancelCurrentSpeechRecognizer() {
        try {
            speechRecognizer?.cancel()
            speechRecognizer?.destroy()
        } catch (_: Exception) {
        } finally {
            speechRecognizer = null
        }
    }

    private fun createRecognitionListener(): RecognitionListener {
        return object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {
                _state.value = VoiceState.Listening
            }

            override fun onBeginningOfSpeech() {
                _state.value = VoiceState.Listening
            }

            override fun onRmsChanged(rmsdB: Float) {
                // No loguear rms ni almacenar audio
            }

            override fun onBufferReceived(buffer: ByteArray?) {
                // Privacidad estricta: No almacenar ni persistir buffer de audio
            }

            override fun onEndOfSpeech() {
                _state.value = VoiceState.Processing
            }

            override fun onError(error: Int) {
                val voiceError = when (error) {
                    SpeechRecognizer.ERROR_AUDIO -> VoiceError.AudioError
                    SpeechRecognizer.ERROR_NO_MATCH,
                    SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> VoiceError.NoSpeechDetected
                    SpeechRecognizer.ERROR_NETWORK,
                    SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> VoiceError.NetworkError
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> VoiceError.PermissionDenied
                    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> VoiceError.AudioError
                    else -> VoiceError.Unknown(errorCode = error)
                }
                _state.value = VoiceState.Error(voiceError)
                cancelCurrentSpeechRecognizer()
            }

            override fun onResults(results: Bundle?) {
                val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                val recognizedText = matches?.firstOrNull().orEmpty()
                _partialTranscription.value = recognizedText
                _state.value = VoiceState.Idle
                cancelCurrentSpeechRecognizer()
                if (recognizedText.isNotBlank()) {
                    onTranscriptionCompleteCallback?.invoke(recognizedText)
                }
            }

            override fun onPartialResults(partialResults: Bundle?) {
                val matches = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                val partialText = matches?.firstOrNull().orEmpty()
                if (partialText.isNotBlank()) {
                    _partialTranscription.value = partialText
                }
            }

            override fun onEvent(eventType: Int, params: Bundle?) {
            }
        }
    }
}
