package com.mybusiness.feature.banking.ui

import com.mybusiness.core.common.extensions.ErrorKind
import com.mybusiness.core.model.LinkedAccount
import com.mybusiness.core.model.LinkedConnection
import com.mybusiness.core.model.LinkSession

data class BankingUiState(
    val isLoading: Boolean = false,
    val isSyncing: Boolean = false,
    val connections: List<LinkedConnection> = emptyList(),
    val accountsByConnection: Map<String, List<LinkedAccount>> = emptyMap(),
    val linkSession: LinkSession? = null,
    val errorMessage: String? = null,
    val infoMessage: String? = null,
    val hasLoadedOnce: Boolean = false,
    val errorKind: ErrorKind? = null
) {
    val isEmpty: Boolean get() = hasLoadedOnce && connections.isEmpty()

    val isUnauthorized: Boolean get() = errorKind == ErrorKind.Unauthorized
}
