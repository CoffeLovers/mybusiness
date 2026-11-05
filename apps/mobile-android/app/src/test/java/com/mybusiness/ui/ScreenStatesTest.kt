package com.mybusiness.ui

import com.mybusiness.core.common.extensions.ErrorKind
import com.mybusiness.core.model.AccountType
import com.mybusiness.core.model.BankAccount
import com.mybusiness.core.model.BankProvider
import com.mybusiness.core.model.ConnectionStatus
import com.mybusiness.core.model.DashboardSummary
import com.mybusiness.core.model.LinkedConnection
import com.mybusiness.feature.auth.ui.AuthUiState
import com.mybusiness.feature.banking.ui.BankingUiState
import com.mybusiness.feature.dashboard.ui.DashboardUiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ScreenStatesTest {

    private fun emptySummary(): DashboardSummary = DashboardSummary(
        totalBalance = 0.0,
        monthlyIncome = 0.0,
        monthlyExpenses = 0.0,
        netCashFlow = 0.0,
        accounts = emptyList(),
        recentTransactions = emptyList()
    )

    private fun account(): BankAccount = BankAccount(
        id = "acc-1",
        institutionName = "Banco Demo",
        accountType = AccountType.CHECKING,
        accountNumberMasked = "•••• 1234"
    )

    @Test
    fun `auth vacio es estado inicial`() {
        assertTrue(AuthUiState().isEmpty)
    }

    @Test
    fun `auth cargando no es estado vacio`() {
        assertFalse(AuthUiState(isLoading = true).isEmpty)
    }

    @Test
    fun `auth con sesion expirada expone errorKind`() {
        val state = AuthUiState(
            generalError = "Correo o contraseña incorrectos.",
            errorKind = ErrorKind.Unauthorized
        )
        assertFalse(state.isEmpty)
        assertEquals(ErrorKind.Unauthorized, state.errorKind)
    }

    @Test
    fun `dashboard sin cuentas ni movimientos es vacio`() {
        val state = DashboardUiState(isLoading = false, summary = emptySummary())
        assertTrue(state.isEmpty)
    }

    @Test
    fun `dashboard con una cuenta no es vacio`() {
        val state = DashboardUiState(
            isLoading = false,
            summary = emptySummary().copy(accounts = listOf(account()))
        )
        assertFalse(state.isEmpty)
    }

    @Test
    fun `dashboard con sesion expirada expone errorKind`() {
        val state = DashboardUiState(
            isLoading = false,
            summary = emptySummary(),
            errorKind = ErrorKind.Unauthorized
        )
        assertEquals(ErrorKind.Unauthorized, state.errorKind)
    }

    @Test
    fun `banking cargado sin conexiones es vacio`() {
        assertTrue(BankingUiState(hasLoadedOnce = true).isEmpty)
    }

    @Test
    fun `banking con sesion expirada es unauthorized`() {
        assertTrue(BankingUiState(errorKind = ErrorKind.Unauthorized).isUnauthorized)
    }

    @Test
    fun `banking con conexion no es vacio`() {
        val state = BankingUiState(
            hasLoadedOnce = true,
            connections = listOf(
                LinkedConnection(
                    id = "1",
                    provider = BankProvider.PLAID,
                    status = ConnectionStatus.ACTIVE
                )
            )
        )
        assertFalse(state.isEmpty)
    }
}
