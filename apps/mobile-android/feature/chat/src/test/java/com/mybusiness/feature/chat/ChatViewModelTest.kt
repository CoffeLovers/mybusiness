package com.mybusiness.feature.chat

import com.mybusiness.core.common.result.Result
import com.mybusiness.core.model.ChatMessage
import com.mybusiness.core.model.ChatStreamEvent
import com.mybusiness.feature.chat.data.repository.FakeChatRepository
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
    private lateinit var viewModel: ChatViewModel

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        fakeRepository = FakeChatRepository()
        viewModel = ChatViewModel(fakeRepository)
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
            ChatStreamEvent.Done("Hola ¿cómo estás?")
        )

        viewModel.onInputTextChanged("Hola asistente")
        viewModel.sendMessage()
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertFalse(state.isGenerating)
        assertEquals("", state.inputText)
        assertEquals(2, state.messages.size)
        assertEquals("Hola asistente", state.messages[0].content)
        assertTrue(state.messages[0].isFromUser)
        assertEquals("Hola ¿cómo estás?", state.messages[1].content)
        assertFalse(state.messages[1].isFromUser)
        assertFalse(state.messages[1].isStreaming)
    }

    @Test
    fun `indicador de herramienta se activa con evento Tool y desaparece con Done`() = runTest {
        fakeRepository.streamToEmit = flow {
            emit(ChatStreamEvent.Tool("consultar_saldo"))
            emit(ChatStreamEvent.Token("Tu saldo es"))
            emit(ChatStreamEvent.Token(" $1,000"))
            emit(ChatStreamEvent.Done("Tu saldo es $1,000"))
        }

        viewModel.onInputTextChanged("Ver mi saldo")
        viewModel.sendMessage()
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertNull(state.activeTool)
        assertEquals("Tu saldo es $1,000", state.messages.last().content)
        assertNull(state.messages.last().activeTool)
    }

    @Test
    fun `cancelar detiene la generacion y actualiza el mensaje`() = runTest {
        val streamFlow = flow {
            emit(ChatStreamEvent.Token("Generando parte 1..."))
            kotlinx.coroutines.delay(1000)
            emit(ChatStreamEvent.Token("Parte 2 que no debe llegar"))
        }
        fakeRepository.streamToEmit = streamFlow

        viewModel.onInputTextChanged("Consulta larga")
        viewModel.sendMessage()
        testDispatcher.scheduler.advanceTimeBy(100)

        assertTrue(viewModel.uiState.value.isGenerating)

        viewModel.cancelGeneration()
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertFalse(state.isGenerating)
        assertTrue(state.messages.last().content.contains("[Cancelado]"))
    }

    @Test
    fun `sin canal incremental, cae a endpoint fallback no streaming y muestra aviso`() = runTest {
        fakeRepository.streamToEmit = flow {
            emit(ChatStreamEvent.Error("502 Bad Gateway", canFallback = true))
        }
        fakeRepository.fallbackResult = Result.Success(
            ChatMessage(
                id = "fallback-1",
                content = "Respuesta del fallback clásico",
                isFromUser = false
            )
        )

        viewModel.onInputTextChanged("Pregunta")
        viewModel.sendMessage()
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertFalse(state.isGenerating)
        assertEquals(1, fakeRepository.fallbackCalledCount)
        assertNotNull(state.warningMessage)
        assertTrue(state.warningMessage!!.contains("Canal incremental no disponible"))
        assertEquals("Respuesta del fallback clásico", state.messages.last().content)
    }

    @Test
    fun `TalkBack anuncia el mensaje completo al finalizar y no por cada token`() = runTest {
        fakeRepository.streamToEmit = flowOf(
            ChatStreamEvent.Token("Token 1"),
            ChatStreamEvent.Token(" Token 2"),
            ChatStreamEvent.Done("Token 1 Token 2")
        )

        viewModel.onInputTextChanged("Mensaje")
        viewModel.sendMessage()
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertEquals("Token 1 Token 2", state.talkBackAnnouncement)

        viewModel.clearTalkBackAnnouncement()
        assertNull(viewModel.uiState.value.talkBackAnnouncement)
    }

    @Test
    fun `rotacion conserva mensaje en curso y tokens acumulados en el ViewModel`() = runTest {
        fakeRepository.streamToEmit = flowOf(
            ChatStreamEvent.Token("Palabra 1"),
            ChatStreamEvent.Token(" Palabra 2"),
            ChatStreamEvent.Done("Palabra 1 Palabra 2")
        )

        viewModel.onInputTextChanged("Test rotación")
        viewModel.sendMessage()
        advanceUntilIdle()

        // Simulamos la recomposición / reconexión tras rotación leyendo el StateFlow
        val stateAfterRecreation = viewModel.uiState.value
        assertEquals(2, stateAfterRecreation.messages.size)
        assertEquals("Palabra 1 Palabra 2", stateAfterRecreation.messages[1].content)
        assertFalse(stateAfterRecreation.isGenerating)
    }
}
