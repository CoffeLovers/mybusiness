package com.mybusiness.feature.widget

import com.mybusiness.core.model.DashboardSummary
import com.mybusiness.core.model.Transaction
import com.mybusiness.core.model.TransactionStatus
import com.mybusiness.core.model.TransactionType
import com.mybusiness.feature.widget.data.DashboardWidgetState
import com.mybusiness.feature.widget.data.calculateDailyFlow
import com.mybusiness.feature.widget.data.effectiveIntervalMinutes
import com.mybusiness.feature.widget.data.widgetStateFrom
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DashboardWidgetLogicTest {

    // --- widgetStateFrom -----------------------------------------------------

    @Test
    fun `sin status devuelve Loading`() {
        val state = widgetStateFrom(
            status = null,
            totalBalance = null,
            dailyFlow = null,
            currency = null,
            updatedAt = null,
            errorMessage = null
        )

        assertEquals(DashboardWidgetState.Loading, state)
    }

    @Test
    fun `status desconocido devuelve Loading`() {
        val state = widgetStateFrom(
            status = "OTRO",
            totalBalance = "100",
            dailyFlow = "5",
            currency = "COP",
            updatedAt = 1L,
            errorMessage = null
        )

        assertEquals(DashboardWidgetState.Loading, state)
    }

    @Test
    fun `SUCCESS con valores validos devuelve Success`() {
        val state = widgetStateFrom(
            status = "SUCCESS",
            totalBalance = "1500.5",
            dailyFlow = "-25.0",
            currency = "USD",
            updatedAt = 1234L,
            errorMessage = "ignorado"
        )

        assertEquals(
            DashboardWidgetState.Success(
                totalBalance = 1500.5,
                dailyFlow = -25.0,
                currency = "USD",
                updatedAt = 1234L
            ),
            state
        )
    }

    @Test
    fun `SUCCESS con nulls aplica fallbacks`() {
        val state = widgetStateFrom(
            status = "SUCCESS",
            totalBalance = null,
            dailyFlow = null,
            currency = null,
            updatedAt = null,
            errorMessage = null
        )

        assertEquals(
            DashboardWidgetState.Success(
                totalBalance = 0.0,
                dailyFlow = 0.0,
                currency = "COP",
                updatedAt = 0L
            ),
            state
        )
    }

    @Test
    fun `SUCCESS con valores no numericos cae a cero`() {
        val state = widgetStateFrom(
            status = "SUCCESS",
            totalBalance = "no-es-numero",
            dailyFlow = "",
            currency = "COP",
            updatedAt = 10L,
            errorMessage = null
        )

        assertEquals(
            DashboardWidgetState.Success(
                totalBalance = 0.0,
                dailyFlow = 0.0,
                currency = "COP",
                updatedAt = 10L
            ),
            state
        )
    }

    @Test
    fun `ERROR devuelve el mensaje persistido`() {
        val state = widgetStateFrom(
            status = "ERROR",
            totalBalance = null,
            dailyFlow = null,
            currency = null,
            updatedAt = null,
            errorMessage = "Sin conexión"
        )

        assertEquals(DashboardWidgetState.Error("Sin conexión"), state)
    }

    @Test
    fun `ERROR sin mensaje usa el fallback`() {
        val state = widgetStateFrom(
            status = "ERROR",
            totalBalance = null,
            dailyFlow = null,
            currency = null,
            updatedAt = null,
            errorMessage = null
        )

        assertTrue(state is DashboardWidgetState.Error)
        assertEquals(
            "No se pudo actualizar el widget",
            (state as DashboardWidgetState.Error).message
        )
    }

    @Test
    fun `EMPTY devuelve Empty`() {
        val state = widgetStateFrom(
            status = "EMPTY",
            totalBalance = "100",
            dailyFlow = "10",
            currency = "COP",
            updatedAt = 1L,
            errorMessage = "ignorado"
        )

        assertEquals(DashboardWidgetState.Empty, state)
    }

    // --- calculateDailyFlow --------------------------------------------------

    private fun summaryOf(vararg transactions: Transaction): DashboardSummary = DashboardSummary(
        totalBalance = 1000.0,
        monthlyIncome = 0.0,
        monthlyExpenses = 0.0,
        netCashFlow = 0.0,
        currency = "COP",
        accounts = emptyList(),
        recentTransactions = transactions.toList()
    )

    private fun transaction(
        id: String,
        amount: Double,
        type: TransactionType,
        date: String
    ): Transaction = Transaction(
        id = id,
        bankAccountId = "acc-1",
        description = "test",
        amount = amount,
        currency = "COP",
        type = type,
        status = TransactionStatus.COMPLETED,
        date = date
    )

    @Test
    fun `calculateDailyFlow suma ingresos y resta egresos de hoy`() {
        val summary = summaryOf(
            transaction("1", 100.0, TransactionType.INCOME, "Hoy 09:15"),
            transaction("2", 40.0, TransactionType.EXPENSE, "Hoy 11:00"),
            transaction("3", 25.0, TransactionType.INCOME, "hoy 12:00"),
            transaction("4", 500.0, TransactionType.INCOME, "Ayer 10:00"),
            transaction("5", 999.0, TransactionType.EXPENSE, "Ayer 18:00")
        )

        assertEquals(85.0, summary.calculateDailyFlow(), 0.0001)
    }

    @Test
    fun `calculateDailyFlow ignora transferencias`() {
        val summary = summaryOf(
            transaction("1", 100.0, TransactionType.INCOME, "Hoy"),
            transaction("2", 300.0, TransactionType.TRANSFER, "Hoy"),
            transaction("3", 50.0, TransactionType.EXPENSE, "Hoy")
        )

        assertEquals(50.0, summary.calculateDailyFlow(), 0.0001)
    }

    @Test
    fun `calculateDailyFlow sin transacciones de hoy es cero`() {
        val summary = summaryOf(
            transaction("1", 100.0, TransactionType.INCOME, "Ayer"),
            transaction("2", 50.0, TransactionType.EXPENSE, "Semana pasada")
        )

        assertEquals(0.0, summary.calculateDailyFlow(), 0.0001)
    }

    // --- effectiveIntervalMinutes -------------------------------------------

    @Test
    fun `intervalo por debajo del minimo se eleva a 15 minutos`() {
        assertEquals(15L, effectiveIntervalMinutes(5L))
        assertEquals(15L, effectiveIntervalMinutes(0L))
    }

    @Test
    fun `intervalo valido se mantiene`() {
        assertEquals(30L, effectiveIntervalMinutes(30L))
    }
}
