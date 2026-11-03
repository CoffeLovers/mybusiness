package com.mybusiness.feature.banking.ui

import androidx.fragment.app.FragmentActivity
import com.mybusiness.core.biometric.BiometricGate
import com.mybusiness.core.biometric.BiometricResult
import com.mybusiness.core.biometric.SensitiveAction
import com.mybusiness.core.common.result.Result
import com.mybusiness.core.model.BankProvider
import com.mybusiness.core.model.ConnectionStatus
import com.mybusiness.core.model.LinkSession
import com.mybusiness.core.model.LinkedAccount
import com.mybusiness.core.model.LinkedConnection
import com.mybusiness.core.model.SyncSummary
import com.mybusiness.feature.banking.data.deeplink.BankLinkDeepLinkStore
import com.mybusiness.feature.banking.domain.repository.BankingRepository
import com.mybusiness.feature.banking.domain.repository.CompleteBankLinkUseCase
import com.mybusiness.feature.banking.domain.repository.DisconnectBankConnectionUseCase
import com.mybusiness.feature.banking.domain.repository.GetBankingOverviewUseCase
import com.mybusiness.feature.banking.domain.repository.StartBankLinkUseCase
import com.mybusiness.feature.banking.domain.repository.SyncBankConnectionUseCase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestWatcher
import org.junit.runner.Description

@OptIn(ExperimentalCoroutinesApi::class)
class MainDispatcherRule(
    val testDispatcher: TestDispatcher = StandardTestDispatcher()
) : TestWatcher() {

    override fun starting(description: Description) {
        Dispatchers.setMain(testDispatcher)
    }

    override fun finished(description: Description) {
        Dispatchers.resetMain()
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class BankingViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private lateinit var repository: FakeBankingRepository
    private lateinit var biometricGate: FakeBiometricGate
    private lateinit var deepLinkStore: BankLinkDeepLinkStore

    @Before
    fun setUp() {
        repository = FakeBankingRepository()
        biometricGate = FakeBiometricGate()
        deepLinkStore = BankLinkDeepLinkStore()
    }

    @Test
    fun `loadOverview agrupa cuentas por conexion y conserva lastSyncedAt`() =
        runTest(mainDispatcherRule.testDispatcher) {
            repository.connections = listOf(
                connection("c1", ConnectionStatus.ACTIVE, "2024-10-01T10:00:00Z"),
                connection("c2", ConnectionStatus.ACTIVE, "2024-10-02T10:00:00Z")
            )
            repository.accountsByConnectionId["c1"] = listOf(
                account("a1", "c1", lastSyncedAt = "2024-10-01T11:00:00Z")
            )
            repository.accountsByConnectionId["c2"] = listOf(
                account("a2", "c2"),
                account("a3", "c2")
            )

            val viewModel = createViewModel()
            advanceUntilIdle()

            val state = viewModel.uiState.value
            assertEquals(2, state.connections.size)
            assertEquals(2, state.accountsByConnection["c2"]?.size)
            assertEquals(
                "2024-10-01T11:00:00Z",
                state.accountsByConnection["c1"]?.first()?.lastSyncedAt
            )
            assertTrue(state.hasLoadedOnce)
            assertFalse(state.isLoading)
            assertEquals(1, repository.connectionsRequests.size)
        }

    @Test
    fun `startLink guarda la sesion y consumeLinkSession la limpia`() =
        runTest(mainDispatcherRule.testDispatcher) {
            repository.linkSessionResult = Result.Success(
                LinkSession(provider = BankProvider.BELVO, linkToken = "link-abc")
            )
            val viewModel = createViewModel()
            advanceUntilIdle()

            viewModel.startLink(BankProvider.BELVO)
            advanceUntilIdle()

            assertNotNull(viewModel.uiState.value.linkSession)
            assertEquals(BankProvider.BELVO, viewModel.uiState.value.linkSession?.provider)
            assertEquals(listOf(BankProvider.BELVO), repository.linkSessionProviders)

            viewModel.consumeLinkSession()

            assertNull(viewModel.uiState.value.linkSession)
        }

    @Test
    fun `deep link valido dispara exchangeConnection y limpia el store`() =
        runTest(mainDispatcherRule.testDispatcher) {
            val viewModel = createViewModel()
            advanceUntilIdle()

            deepLinkStore.publish("mybusiness://banking/return?public_token=tok_123")
            advanceUntilIdle()

            assertEquals(1, repository.exchangeCalls.size)
            assertEquals("tok_123", repository.exchangeCalls.first().second)
            assertNull(deepLinkStore.pendingUri.value)
            assertEquals("Cuenta vinculada correctamente", viewModel.uiState.value.infoMessage)
        }

    @Test
    fun `deep link invalido no llama al repositorio`() =
        runTest(mainDispatcherRule.testDispatcher) {
            val viewModel = createViewModel()
            advanceUntilIdle()

            deepLinkStore.publish("https://malicioso.example/return?public_token=tok_123")
            advanceUntilIdle()

            assertTrue(repository.exchangeCalls.isEmpty())
            assertNull(viewModel.uiState.value.infoMessage)

            deepLinkStore.publish("mybusiness://banking/return?otro=1")
            advanceUntilIdle()

            assertTrue(repository.exchangeCalls.isEmpty())
        }

    @Test
    fun `sync publica infoMessage y recarga el overview`() =
        runTest(mainDispatcherRule.testDispatcher) {
            repository.connections = listOf(connection("c1", ConnectionStatus.ACTIVE, null))
            repository.accountsByConnectionId["c1"] = listOf(account("a1", "c1"))
            repository.syncResult = Result.Success(
                SyncSummary(connectionId = "c1", added = 2, modified = 1, removed = 0, hasMore = false)
            )
            val viewModel = createViewModel()
            advanceUntilIdle()
            assertEquals(1, repository.connectionsRequests.size)

            viewModel.sync("c1")
            advanceUntilIdle()

            assertEquals(
                "Sincronización completada (2 nuevas, 1 actualizadas)",
                viewModel.uiState.value.infoMessage
            )
            assertFalse(viewModel.uiState.value.isSyncing)
            assertEquals(listOf("c1"), repository.syncCalls)
            assertEquals(2, repository.connectionsRequests.size)
        }

    @Test
    fun `disconnect con biometria cancelada no invoca el caso de uso`() =
        runTest(mainDispatcherRule.testDispatcher) {
            biometricGate.result = BiometricResult.Cancelled
            val viewModel = createViewModel()
            advanceUntilIdle()

            viewModel.disconnect(newFragmentActivity(), "c1")
            advanceUntilIdle()

            assertTrue(repository.disconnectCalls.isEmpty())
            assertEquals(
                "No se desvinculó la cuenta: autenticación no superada",
                viewModel.uiState.value.errorMessage
            )
        }

    @Test
    fun `disconnect con biometria correcta invoca el repositorio`() =
        runTest(mainDispatcherRule.testDispatcher) {
            biometricGate.result = BiometricResult.Success
            val viewModel = createViewModel()
            advanceUntilIdle()

            viewModel.disconnect(newFragmentActivity(), "c1")
            advanceUntilIdle()

            assertEquals(listOf("c1"), repository.disconnectCalls)
            assertEquals(SensitiveAction.DISCONNECT_BANK, biometricGate.lastAction)
            assertNull(viewModel.uiState.value.errorMessage)
        }

    @Test
    fun `error del repositorio se refleja en errorMessage`() =
        runTest(mainDispatcherRule.testDispatcher) {
            repository.connectionsResult = Result.Error(Exception("boom"), "Fallo de red")
            val viewModel = createViewModel()
            advanceUntilIdle()

            assertEquals("Fallo de red", viewModel.uiState.value.errorMessage)
            assertFalse(viewModel.uiState.value.isLoading)
            assertFalse(viewModel.uiState.value.hasLoadedOnce)

            viewModel.clearMessages()

            assertNull(viewModel.uiState.value.errorMessage)
        }

    @Test
    fun `parsePublicToken tolera link_token como alias y rechaza URIs ajenas`() {
        val viewModel = createViewModel()

        assertEquals(
            "tok_public",
            viewModel.parsePublicToken("mybusiness://banking/return?public_token=tok_public")
        )
        assertEquals(
            "tok_link",
            viewModel.parsePublicToken("mybusiness://banking/return?link_token=tok_link")
        )
        assertEquals(
            "tok_encoded",
            viewModel.parsePublicToken("mybusiness://banking/return?public_token=tok%5Fencoded")
        )
        assertNull(viewModel.parsePublicToken("mybusiness://otro/return?public_token=x"))
        assertNull(viewModel.parsePublicToken("mybusiness://banking/return?public_token="))
        assertNull(viewModel.parsePublicToken("mybusiness://banking/return"))
        assertNull(viewModel.parsePublicToken(""))
    }

    // region helpers

    private fun createViewModel(): BankingViewModel = BankingViewModel(
        startBankLinkUseCase = StartBankLinkUseCase(repository),
        completeBankLinkUseCase = CompleteBankLinkUseCase(repository),
        getBankingOverviewUseCase = GetBankingOverviewUseCase(repository),
        syncBankConnectionUseCase = SyncBankConnectionUseCase(repository),
        disconnectBankConnectionUseCase = DisconnectBankConnectionUseCase(repository),
        biometricGate = biometricGate,
        deepLinkStore = deepLinkStore
    )

    private fun connection(id: String, status: ConnectionStatus, lastSync: String?) =
        LinkedConnection(
            id = id,
            provider = BankProvider.PLAID,
            institutionName = "Banco $id",
            status = status,
            lastSuccessfulSyncAt = lastSync
        )

    private fun account(id: String, connectionId: String, lastSyncedAt: String? = null) =
        LinkedAccount(
            id = id,
            connectionId = connectionId,
            name = "Cuenta $id",
            mask = "1234",
            isoCurrencyCode = "COP",
            balanceCurrentMinor = "100000",
            lastSyncedAt = lastSyncedAt
        )

    /** Instancia sin ejecutar el constructor: `FragmentActivity` no es instanciable en JVM. */
    private fun newFragmentActivity(): FragmentActivity {
        val unsafeClass = Class.forName("sun.misc.Unsafe")
        val unsafe = unsafeClass.getDeclaredField("theUnsafe").apply { isAccessible = true }.get(null)
        val allocate = unsafeClass.getMethod("allocateInstance", Class::class.java)
        return allocate.invoke(unsafe, FragmentActivity::class.java) as FragmentActivity
    }

    // endregion

    private class FakeBankingRepository : BankingRepository {

        var connections: List<LinkedConnection> = emptyList()
        val accountsByConnectionId = mutableMapOf<String, List<LinkedAccount>>()

        var linkSessionResult: Result<LinkSession> =
            Result.Success(LinkSession(BankProvider.PLAID, "link-token"))
        var exchangeResult: Result<LinkedConnection> =
            Result.Success(
                LinkedConnection(
                    id = "c-new",
                    provider = BankProvider.PLAID,
                    status = ConnectionStatus.ACTIVE
                )
            )
        var connectionsResult: Result<List<LinkedConnection>>? = null
        var syncResult: Result<SyncSummary> = Result.Success(
            SyncSummary("c1", added = 0, modified = 0, removed = 0, hasMore = false)
        )
        var disconnectResult: Result<Unit> = Result.Success(Unit)

        val linkSessionProviders = mutableListOf<BankProvider>()
        val exchangeCalls = mutableListOf<Pair<BankProvider, String>>()
        val syncCalls = mutableListOf<String>()
        val disconnectCalls = mutableListOf<String>()
        val connectionsRequests = mutableListOf<Unit>()

        override suspend fun createLinkSession(provider: BankProvider): Result<LinkSession> {
            linkSessionProviders.add(provider)
            return linkSessionResult
        }

        override suspend fun exchangeConnection(
            provider: BankProvider,
            publicToken: String
        ): Result<LinkedConnection> {
            exchangeCalls.add(provider to publicToken)
            return exchangeResult
        }

        override suspend fun getConnections(): Result<List<LinkedConnection>> {
            connectionsRequests.add(Unit)
            return connectionsResult ?: Result.Success(connections)
        }

        override suspend fun getAccounts(connectionId: String): Result<List<LinkedAccount>> =
            Result.Success(accountsByConnectionId[connectionId] ?: emptyList())

        override suspend fun syncConnection(connectionId: String): Result<SyncSummary> {
            syncCalls.add(connectionId)
            return syncResult
        }

        override suspend fun disconnectConnection(connectionId: String): Result<Unit> {
            disconnectCalls.add(connectionId)
            return disconnectResult
        }
    }

    private class FakeBiometricGate : BiometricGate {

        var result: BiometricResult = BiometricResult.Success
        var lastAction: SensitiveAction? = null

        override fun isAvailable(): Boolean = true

        override suspend fun authenticate(
            activity: FragmentActivity,
            action: SensitiveAction
        ): BiometricResult {
            lastAction = action
            return result
        }
    }
}
