package com.mybusiness.feature.chat

import com.mybusiness.core.common.result.Result
import com.mybusiness.core.model.ChatMessage
import com.mybusiness.core.model.ChatStreamEvent
import com.mybusiness.feature.chat.data.repository.FakeChatRepository
import com.mybusiness.feature.chat.data.voice.FakeVoiceManager
import com.mybusiness.feature.chat.domain.model.VoiceError
import com.mybusiness.feature.chat.domain.model.VoiceState
import com.mybusiness.feature.chat.ui.ChatViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ChatViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var fakeRepository: FakeChatRepository
    private lateinit var fakeVoiceManager: FakeVoiceManager
    private lateinit var viewModel: ChatViewModel

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        fakeRepository = FakeChatRepository()
        fakeVoiceManager = FakeVoiceManager()
        viewModel = ChatViewModel(fakeRepository, fakeVoiceManager)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `envio de mensaje renderiza tokens de forma incremental`() = runTest {
        fakeRepository.streamToEmit = flowOf(
            ChatStreamEvent.Token("Hola"),
            ChatStreamEvent.Token(" ¿cómo"),
            ChatStreamEvent.Token(" estás?"),
            ChatStreamEvent.Done(fullText = "Hola ¿cómo estás?", degraded = false)
        )

        viewModel.onInputTextChanged("Hola asistente")
        viewModel.sendMessage()
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertFalse(state.isGenerating)
        assertEquals("Hola ¿cómo estás?", state.talkBackAnnouncement)

        val assistantMessage = state.messages.find { !it.isFromUser }
        assertNotNull(assistantMessage)
        assertEquals("Hola ¿cómo estás?", assistantMessage?.content)
        assertFalse(assistantMessage?.isStreaming ?: true)
    }

    @Test
    fun `indicador de herramienta se activa durante evento Tool y se limpia al finalizar`() = runTest {
        fakeRepository.streamToEmit = flowOf(
            ChatStreamEvent.Tool("consultar_saldo"),
            ChatStreamEvent.Token("Tu saldo es 100 USD"),
            ChatStreamEvent.Done(fullText = "Tu saldo es 100 USD", degraded = false)
        )

        viewModel.onInputTextChanged("¿cuál es mi saldo?")
        viewModel.sendMessage()
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertNull(state.activeTool)
        val assistantMessage = state.messages.find { !it.isFromUser }
        assertNull(assistantMessage?.activeTool)
        assertEquals("Tu saldo es 100 USD", assistantMessage?.content)
    }

    @Test
    fun `fallback automatico a endpoint REST cuando el canal SSE falla sin tokens acumulados`() = runTest {
        fakeRepository.streamToEmit = flowOf(
            ChatStreamEvent.Error(message = "SSE stream broken", canFallback = true)
        )
        fakeRepository.fallbackResult = Result.Success(
            ChatMessage(id = "fb-1", content = "Respuesta de respaldo clásica", isFromUser = false)
        )

        viewModel.onInputTextChanged("Consulta con fallback")
        viewModel.sendMessage()
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertFalse(state.isGenerating)
        assertEquals("Canal incremental no disponible. Obteniendo respuesta estándar...", state.warningMessage)
        assertEquals("Respuesta de respaldo clásica", state.talkBackAnnouncement)
    }

    @Test
    fun `cancelacion explicita marca el mensaje como cancelado y detiene la generacion`() = runTest {
        fakeRepository.streamToEmit = flow {
            emit(ChatStreamEvent.Token("Generando"))
            kotlinx.coroutines.delay(1000)
            emit(ChatStreamEvent.Token(" más texto"))
        }

        viewModel.onInputTextChanged("Mensaje largo")
        viewModel.sendMessage()
        testDispatcher.scheduler.advanceTimeBy(100)

        assertTrue(viewModel.uiState.value.isGenerating)

        viewModel.cancelGeneration()
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertFalse(state.isGenerating)
        val assistantMessage = state.messages.find { !it.isFromUser }
        assertTrue(assistantMessage?.content?.contains("[Cancelado]") ?: false)
    }

    @Test
    fun `supervivencia de estado ante recreacion retiene historial y texto ingresado`() = runTest {
        fakeRepository.addUserMessage("Mensaje previo")
        viewModel.onInputTextChanged("Borrador en curso")
        advanceUntilIdle()

        val retainedInput = viewModel.uiState.value.inputText
        val retainedMessages = viewModel.uiState.value.messages
        assertEquals("Borrador en curso", retainedInput)
        assertEquals(1, retainedMessages.size)
    }

    @Test
    fun `TalkBack solo anuncia el mensaje consolidado al recibir el evento Done`() = runTest {
        fakeRepository.streamToEmit = flowOf(
            ChatStreamEvent.Token("Token1 "),
            ChatStreamEvent.Token("Token2 "),
            ChatStreamEvent.Done(fullText = "Token1 Token2 ", degraded = false)
        )

        viewModel.onInputTextChanged("Mensaje")
        viewModel.sendMessage()
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertEquals("Token1 Token2 ", state.talkBackAnnouncement)
    }

    // --- Tests de Voice-to-Text y TTS (Issue #61) ---

    @Test
    fun `permiso RECORD_AUDIO denegado muestra advertencia y la app sigue usable con texto`() = runTest {
        viewModel.requestPermissionRationale()
        assertTrue(viewModel.uiState.value.showPermissionRationale)

        viewModel.onPermissionDenied()
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertFalse(state.showPermissionRationale)
        assertFalse(state.isVoiceModeActive)
        assertTrue(state.voiceState is VoiceState.Error)
        assertEquals(VoiceError.PermissionDenied, (state.voiceState as VoiceState.Error).error)
        assertTrue(state.voiceErrorMessage?.contains("Permiso de micrófono denegado") ?: false)

        // Comprobar que sigue usable escribiendo por texto
        viewModel.onInputTextChanged("Mensaje manual")
        assertEquals("Mensaje manual", viewModel.uiState.value.inputText)
    }

    @Test
    fun `transcripcion por voz parcial y final actualiza el campo de texto antes de enviar para permitir correccion`() = runTest {
        viewModel.startVoicePrompt()
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.voiceState is VoiceState.Listening)
        assertTrue(viewModel.uiState.value.isVoiceModeActive)

        // Transcripción parcial en tiempo real
        fakeVoiceManager.emitPartialTranscription("¿cuál es mi")
        advanceUntilIdle()
        assertEquals("¿cuál es mi", viewModel.uiState.value.inputText)

        // Transcripción final
        fakeVoiceManager.emitFinalTranscription("¿cuál es mi saldo actual?")
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertEquals("¿cuál es mi saldo actual?", state.inputText)
        assertTrue(state.voiceState is VoiceState.Idle)

        // El usuario puede editar el texto antes de enviarlo
        viewModel.onInputTextChanged("¿cuál es mi saldo actual en dólares?")
        assertEquals("¿cuál es mi saldo actual en dólares?", viewModel.uiState.value.inputText)
    }

    @Test
    fun `silencio detectado emite VoiceError NoSpeechDetected y permite reintentar`() = runTest {
        viewModel.startVoicePrompt()
        advanceUntilIdle()

        fakeVoiceManager.emitError(VoiceError.NoSpeechDetected)
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state.voiceState is VoiceState.Error)
        assertEquals(VoiceError.NoSpeechDetected, (state.voiceState as VoiceState.Error).error)
        assertTrue(state.voiceErrorMessage?.contains("No se detectó audio") ?: false)

        // Descartar error y reintentar
        viewModel.dismissVoiceError()
        advanceUntilIdle()
        assertNull(viewModel.uiState.value.voiceErrorMessage)
        assertTrue(viewModel.uiState.value.voiceState is VoiceState.Idle)
    }

    @Test
    fun `error de red en reconocimiento de voz muestra mensaje claro sin colgar el servicio`() = runTest {
        viewModel.startVoicePrompt()
        advanceUntilIdle()

        fakeVoiceManager.emitError(VoiceError.NetworkError)
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state.voiceState is VoiceState.Error)
        assertEquals(VoiceError.NetworkError, (state.voiceState as VoiceState.Error).error)
        assertTrue(state.voiceErrorMessage?.contains("Sin conexión") ?: false)
    }

    @Test
    fun `al finalizar respuesta tras un prompt por voz se invoca TTS de respuesta y es cancelable`() = runTest {
        fakeRepository.streamToEmit = flowOf(
            ChatStreamEvent.Token("Tu saldo es 500 USD"),
            ChatStreamEvent.Done(fullText = "Tu saldo es 500 USD", degraded = false)
        )

        // Iniciar flujo por voz
        viewModel.startVoicePrompt()
        fakeVoiceManager.emitFinalTranscription("Saldo por voz")
        advanceUntilIdle()

        // Enviar consulta originada por voz
        viewModel.sendMessage()
        advanceUntilIdle()

        // TTS debió invocarse con la respuesta final
        assertEquals("Tu saldo es 500 USD", fakeVoiceManager.lastSpokenText)
        assertTrue(fakeVoiceManager.state.value is VoiceState.Speaking)

        // Cancelar TTS
        viewModel.stopSpeaking()
        advanceUntilIdle()

        assertTrue(fakeVoiceManager.state.value is VoiceState.Idle)
    }
}
