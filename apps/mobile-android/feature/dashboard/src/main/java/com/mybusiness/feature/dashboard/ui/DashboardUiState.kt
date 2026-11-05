package com.mybusiness.feature.dashboard.ui

import com.mybusiness.core.common.extensions.ErrorKind
import com.mybusiness.core.model.DashboardSummary

data class DashboardUiState(
    val isLoading: Boolean = true,
    val summary: DashboardSummary? = null,
    val userEmail: String? = null,
    val errorMessage: String? = null,
    val isLoggedOut: Boolean = false,
    val errorKind: ErrorKind? = null
) {
    val isEmpty: Boolean
        get() = !isLoading &&
            errorMessage == null &&
            summary != null &&
            summary.accounts.isEmpty() &&
            summary.recentTransactions.isEmpty()
}
