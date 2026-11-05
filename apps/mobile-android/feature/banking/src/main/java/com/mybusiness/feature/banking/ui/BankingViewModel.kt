package com.mybusiness.feature.banking.ui

import android.net.Uri
import androidx.annotation.VisibleForTesting
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.mybusiness.core.biometric.BiometricGate
import com.mybusiness.core.biometric.BiometricResult
import com.mybusiness.core.biometric.SensitiveAction
import com.mybusiness.core.common.extensions.ErrorKind
import com.mybusiness.core.common.extensions.toErrorKind
import com.mybusiness.core.common.extensions.toUserMessage
import com.mybusiness.core.common.result.Result
import com.mybusiness.core.model.BankProvider
import com.mybusiness.feature.banking.data.deeplink.BankLinkDeepLinkStore
import com.mybusiness.feature.banking.domain.repository.CompleteBankLinkUseCase
import com.mybusiness.feature.banking.domain.repository.DisconnectBankConnectionUseCase
import com.mybusiness.feature.banking.domain.repository.GetBankingOverviewUseCase
import com.mybusiness.feature.banking.domain.repository.StartBankLinkUseCase
import com.mybusiness.feature.banking.domain.repository.SyncBankConnectionUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import java.net.URLDecoder
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Estado y acciones de la pantalla de cuentas bancarias vinculadas.
 *
 * Nota de seguridad: los tokens de vinculación y los URI de retorno nunca se registran en logs.
 */
@HiltViewModel
class BankingViewModel @Inject constructor(
    private val startBankLinkUseCase: StartBankLinkUseCase,
    private val completeBankLinkUseCase: CompleteBankLinkUseCase,
    private val getBankingOverviewUseCase: GetBankingOverviewUseCase,
    private val syncBankConnectionUseCase: SyncBankConnectionUseCase,
    private val disconnectBankConnectionUseCase: DisconnectBankConnectionUseCase,
    private val biometricGate: BiometricGate,
    private val deepLinkStore: BankLinkDeepLinkStore
) : ViewModel() {

    private val _uiState = MutableStateFlow(BankingUiState())
    val uiState: StateFlow<BankingUiState> = _uiState.asStateFlow()

    /** Proveedor de la vinculación en curso; el retorno del deep link no lo transporta. */
    private var activeProvider: BankProvider = BankProvider.PLAID

    init {
        observeDeepLinks()
        loadOverview()
    }

    fun loadOverview() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null, errorKind = null) }
            when (val result = getBankingOverviewUseCase()) {
                is Result.Success -> {
                    val overview = result.data
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            connections = overview.connections,
                            accountsByConnection = overview.accounts.groupBy { account -> account.connectionId },
                            hasLoadedOnce = true,
                            errorMessage = null,
                            errorKind = null
                        )
                    }
                }

                is Result.Error -> {
                    val kind = result.toErrorKind()
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            errorMessage = when (kind) {
                                ErrorKind.Unauthorized -> "Tu sesión expiró. Vuelve a iniciar sesión."
                                ErrorKind.Network, ErrorKind.Generic -> result.toUserMessage(
                                    "No pudimos cargar tus cuentas. Inténtalo de nuevo."
                                )
                            },
                            errorKind = kind
                        )
                    }
                }

                is Result.Loading -> _uiState.update { it.copy(isLoading = true) }
            }
        }
    }

    fun startLink(provider: BankProvider) {
        viewModelScope.launch {
            _uiState.update { it.copy(errorMessage = null, errorKind = null) }
            when (val result = startBankLinkUseCase(provider)) {
                is Result.Success -> {
                    activeProvider = provider
                    _uiState.update { it.copy(linkSession = result.data, errorKind = null) }
                }

                is Result.Error -> {
                    val kind = result.toErrorKind()
                    _uiState.update {
                        it.copy(
                            errorMessage = result.toUserMessage(
                                "No pudimos iniciar la vinculación. Inténtalo de nuevo."
                            ),
                            errorKind = kind
                        )
                    }
                }

                is Result.Loading -> Unit
            }
        }
    }

    /** La UI cierra el estado de sesión de vinculación después de abrir las Custom Tabs. */
    fun consumeLinkSession() {
        _uiState.update { it.copy(linkSession = null) }
    }

    fun completeLink(publicToken: String) {
        viewModelScope.launch {
            try {
                when (val result = completeBankLinkUseCase(activeProvider, publicToken)) {
                    is Result.Success -> {
                        _uiState.update {
                            it.copy(
                                infoMessage = "Cuenta vinculada correctamente.",
                                errorMessage = null,
                                errorKind = null
                            )
                        }
                        loadOverview()
                    }

                    is Result.Error -> {
                        val kind = result.toErrorKind()
                        _uiState.update {
                            it.copy(
                                errorMessage = result.toUserMessage(
                                    "No pudimos completar la vinculación. Inténtalo de nuevo."
                                ),
                                errorKind = kind
                            )
                        }
                    }

                    is Result.Loading -> Unit
                }
            } finally {
                deepLinkStore.consume()
            }
        }
    }

    fun sync(connectionId: String) {
        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    isSyncing = true,
                    errorMessage = null,
                    infoMessage = null,
                    errorKind = null
                )
            }
            when (val result = syncBankConnectionUseCase(connectionId)) {
                is Result.Success -> {
                    _uiState.update {
                        it.copy(
                            isSyncing = false,
                            infoMessage = "Sincronización completada.",
                            errorKind = null
                        )
                    }
                    loadOverview()
                }

                is Result.Error -> {
                    val kind = result.toErrorKind()
                    _uiState.update {
                        it.copy(
                            isSyncing = false,
                            errorMessage = result.toUserMessage(
                                "No pudimos sincronizar la cuenta. Inténtalo de nuevo."
                            ),
                            errorKind = kind
                        )
                    }
                }

                is Result.Loading -> _uiState.update { it.copy(isSyncing = true) }
            }
        }
    }

    /**
     * Desvincula una cuenta solo si la autenticación fuerte se supera. Si el usuario cancela
     * o la biometría no está disponible, no se invoca el caso de uso.
     */
    fun disconnect(activity: FragmentActivity, connectionId: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(errorMessage = null, infoMessage = null, errorKind = null) }
            when (val auth = biometricGate.authenticate(activity, SensitiveAction.DISCONNECT_BANK)) {
                is BiometricResult.Success -> {
                    when (val result = disconnectBankConnectionUseCase(connectionId)) {
                        is Result.Success -> {
                            _uiState.update {
                                it.copy(
                                    infoMessage = "Cuenta desvinculada correctamente.",
                                    errorMessage = null,
                                    errorKind = null
                                )
                            }
                            loadOverview()
                        }

                        is Result.Error -> {
                            val kind = result.toErrorKind()
                            _uiState.update {
                                it.copy(
                                    errorMessage = result.toUserMessage(
                                        "No pudimos desvincular la cuenta. Inténtalo de nuevo."
                                    ),
                                    errorKind = kind
                                )
                            }
                        }

                        is Result.Loading -> Unit
                    }
                }

                is BiometricResult.Unavailable -> _uiState.update {
                    it.copy(
                        errorMessage = "Para desvincular, configura la huella o la credencial del dispositivo.",
                        errorKind = ErrorKind.Generic
                    )
                }

                is BiometricResult.Cancelled -> _uiState.update {
                    it.copy(infoMessage = "Desvinculación cancelada.", errorMessage = null, errorKind = null)
                }

                is BiometricResult.Failure -> _uiState.update {
                    it.copy(
                        errorMessage = "No pudimos verificar tu identidad. Inténtalo de nuevo.",
                        errorKind = ErrorKind.Generic
                    )
                }
            }
        }
    }

    fun clearMessages() {
        _uiState.update { it.copy(errorMessage = null, infoMessage = null, errorKind = null) }
    }

    private fun observeDeepLinks() {
        viewModelScope.launch {
            deepLinkStore.pendingUri.filterNotNull().collect { uri ->
                val publicToken = parsePublicToken(uri)
                deepLinkStore.consume()
                if (publicToken != null) completeLink(publicToken)
            }
        }
    }

    /**
     * Extrae `public_token` (o su alias `link_token`) del URI de retorno
     * `mybusiness://banking/return?...`. Devuelve `null` si el esquema/host no son los
     * esperados o el parámetro falta.
     *
     * Se usa `Uri` de la plataforma; si el parser no está disponible (entorno JVM de
     * pruebas unitarias) se aplica un parser puro equivalente sobre la misma semántica.
     */
    @VisibleForTesting
    internal fun parsePublicToken(uri: String): String? {
        val trimmed = uri.trim()
        if (trimmed.isEmpty()) return null

        val parsed = runCatching { Uri.parse(trimmed) }.getOrNull()
        if (parsed != null) {
            if (!SCHEME.equals(parsed.scheme, ignoreCase = true)) return null
            if (!HOST.equals(parsed.host, ignoreCase = true)) return null
            val fromPublic = parsed.getQueryParameter(KEY_PUBLIC_TOKEN)?.takeIf { it.isNotBlank() }
            val fromLink = parsed.getQueryParameter(KEY_LINK_TOKEN)?.takeIf { it.isNotBlank() }
            return fromPublic ?: fromLink
        }
        return parsePublicTokenFallback(trimmed)
    }

    private fun parsePublicTokenFallback(uri: String): String? {
        val parsed = runCatching { java.net.URI(uri) }.getOrNull() ?: return null
        if (!SCHEME.equals(parsed.scheme, ignoreCase = true)) return null
        if (!HOST.equals(parsed.host, ignoreCase = true)) return null

        val query = parsed.rawQuery ?: return null
        val params = query.split('&')
            .mapNotNull { pair ->
                val separator = pair.indexOf('=')
                if (separator <= 0) return@mapNotNull null
                val key = decode(pair.substring(0, separator))
                val value = decode(pair.substring(separator + 1))
                key to value
            }
            .toMap()

        return params[KEY_PUBLIC_TOKEN]?.takeIf { it.isNotBlank() }
            ?: params[KEY_LINK_TOKEN]?.takeIf { it.isNotBlank() }
    }

    private fun decode(value: String): String =
        runCatching { URLDecoder.decode(value, Charsets.UTF_8.name()) }.getOrDefault(value)

    private companion object {
        const val SCHEME = "mybusiness"
        const val HOST = "banking"
        const val KEY_PUBLIC_TOKEN = "public_token"
        const val KEY_LINK_TOKEN = "link_token"
    }
}
