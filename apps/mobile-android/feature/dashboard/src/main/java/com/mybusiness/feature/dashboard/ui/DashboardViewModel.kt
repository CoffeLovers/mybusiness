package com.mybusiness.feature.dashboard.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.mybusiness.core.common.extensions.toErrorKind
import com.mybusiness.core.common.extensions.toUserMessage
import com.mybusiness.core.common.result.Result
import com.mybusiness.core.datastore.UserSessionDataStore
import com.mybusiness.feature.dashboard.domain.usecase.GetDashboardSummaryUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class DashboardViewModel @Inject constructor(
    private val getDashboardSummaryUseCase: GetDashboardSummaryUseCase,
    private val sessionDataStore: UserSessionDataStore
) : ViewModel() {

    private val _uiState = MutableStateFlow(DashboardUiState())
    val uiState: StateFlow<DashboardUiState> = _uiState.asStateFlow()

    init {
        observeUserEmail()
        loadDashboard()
    }

    private fun observeUserEmail() {
        viewModelScope.launch {
            sessionDataStore.userEmail.collect { email ->
                _uiState.update { it.copy(userEmail = email) }
            }
        }
    }

    fun loadDashboard() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null, errorKind = null) }
            when (val result = getDashboardSummaryUseCase()) {
                is Result.Success -> {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            summary = result.data,
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
                            errorMessage = result.toUserMessage(
                                "No pudimos cargar tu resumen. Inténtalo de nuevo."
                            ),
                            errorKind = kind
                        )
                    }
                }
                is Result.Loading -> {
                    _uiState.update { it.copy(isLoading = true) }
                }
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            sessionDataStore.clearSession()
            _uiState.update { it.copy(isLoggedOut = true) }
        }
    }
}
