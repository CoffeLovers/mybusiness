package com.mybusiness.feature.dashboard.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mybusiness.core.common.extensions.ErrorKind
import com.mybusiness.core.common.extensions.formatCurrency
import com.mybusiness.core.designsystem.component.ErrorCard
import com.mybusiness.core.designsystem.component.LoadingView
import com.mybusiness.core.designsystem.component.MyBusinessTopAppBar
import com.mybusiness.core.designsystem.component.PrimaryButton
import com.mybusiness.core.designsystem.theme.AccentCoral
import com.mybusiness.core.designsystem.theme.AccentMint
import com.mybusiness.core.designsystem.theme.businessColors
import com.mybusiness.core.designsystem.theme.minimumTouchTarget
import com.mybusiness.core.model.BankAccount
import com.mybusiness.core.model.DashboardSummary
import com.mybusiness.core.model.Transaction
import com.mybusiness.core.model.TransactionType

@Composable
fun DashboardScreen(
    onLogoutSuccess: () -> Unit,
    onOpenBanking: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: DashboardViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    LaunchedEffect(uiState.isLoggedOut) {
        if (uiState.isLoggedOut) {
            onLogoutSuccess()
        }
    }

    Scaffold(
        topBar = {
            MyBusinessTopAppBar(
                title = "MyBusiness",
                actions = {
                    IconButton(
                        onClick = onOpenBanking,
                        modifier = Modifier.minimumTouchTarget()
                    ) {
                        Icon(
                            imageVector = Icons.Default.AccountBalance,
                            contentDescription = "Cuentas bancarias"
                        )
                    }
                    IconButton(
                        onClick = { viewModel.loadDashboard() },
                        modifier = Modifier.minimumTouchTarget()
                    ) {
                        Icon(
                            imageVector = Icons.Default.Refresh,
                            contentDescription = "Actualizar"
                        )
                    }
                    IconButton(
                        onClick = { viewModel.logout() },
                        modifier = Modifier.minimumTouchTarget()
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ExitToApp,
                            contentDescription = "Cerrar Sesión",
                            tint = MaterialTheme.colorScheme.error
                        )
                    }
                }
            )
        },
        modifier = modifier.fillMaxSize()
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .background(MaterialTheme.colorScheme.background)
        ) {
            val errorMessage = uiState.errorMessage
            val summary = uiState.summary
            when {
                uiState.isLoading -> {
                    LoadingView()
                }
                uiState.errorKind == ErrorKind.Unauthorized -> {
                    SessionExpiredState(
                        onLogin = onLogoutSuccess,
                        modifier = Modifier.align(Alignment.Center)
                    )
                }
                errorMessage != null -> {
                    ErrorCard(
                        message = errorMessage,
                        onRetry = { viewModel.loadDashboard() },
                        modifier = Modifier.align(Alignment.Center)
                    )
                }
                summary != null && uiState.isEmpty -> {
                    EmptyState(
                        title = "Aún no hay información",
                        message = "Vincula una cuenta bancaria para empezar a ver tus finanzas.",
                        actionText = "Vincular cuenta",
                        onAction = onOpenBanking,
                        modifier = Modifier.align(Alignment.Center)
                    )
                }
                summary != null -> {
                    DashboardContent(
                        summary = summary,
                        userEmail = uiState.userEmail.orEmpty(),
                        onOpenBanking = onOpenBanking
                    )
                }
                else -> {
                    EmptyState(
                        title = "Aún no hay información",
                        message = "Actualiza para volver a intentarlo.",
                        actionText = "Actualizar",
                        onAction = { viewModel.loadDashboard() },
                        modifier = Modifier.align(Alignment.Center)
                    )
                }
            }
        }
    }
}

@Composable
private fun SessionExpiredState(
    onLogin: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(24.dp),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = "Tu sesión expiró",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface,
                textAlign = TextAlign.Center
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "Vuelve a iniciar sesión para continuar.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )
            Spacer(modifier = Modifier.height(16.dp))
            PrimaryButton(
                text = "Iniciar sesión",
                onClick = onLogin
            )
        }
    }
}

@Composable
private fun EmptyState(
    title: String,
    message: String,
    actionText: String,
    onAction: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(24.dp),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface,
                textAlign = TextAlign.Center
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )
            Spacer(modifier = Modifier.height(16.dp))
            PrimaryButton(
                text = actionText,
                onClick = onAction
            )
        }
    }
}

@Composable
private fun DashboardContent(
    summary: DashboardSummary,
    userEmail: String,
    onOpenBanking: () -> Unit,
    modifier: Modifier = Modifier
) {
    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp),
        contentPadding = PaddingValues(top = 8.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // 1. Saludo y contexto
        item {
            GreetingSection(userEmail = userEmail)
        }

        // 2. Tarjeta principal de Saldo Total (Estilo Balance UIKit: montos destacados y botones píldora)
        item {
            BalanceHeroCard(
                summary = summary,
                onOpenBanking = onOpenBanking
            )
        }

        // 3. Indicadores de Ingresos vs Egresos del mes
        item {
            IncomeExpenseRow(
                income = summary.monthlyIncome,
                expenses = summary.monthlyExpenses,
                currency = summary.currency
            )
        }

        // 4. Salud Financiera — Gráfico semanal de barras segmentadas (Balance UIKit frame 1:17)
        item {
            FinancialHealthCard(
                netFlow = summary.netCashFlow,
                currency = summary.currency
            )
        }

        // 5. Sección de Cuentas Bancarias / Tarjetas
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Cuentas y Tarjetas",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.padding(top = 4.dp, bottom = 2.dp)
                )
                Text(
                    text = "Ver todas",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.clickable { onOpenBanking() }
                )
            }
        }

        item {
            AccountsHorizontalList(
                accounts = summary.accounts,
                currency = summary.currency,
                onAddAccount = onOpenBanking
            )
        }

        // 6. Sección de Últimas Transacciones (Tarjetas píldora con iconos circulares)
        item {
            Text(
                text = "Movimientos Recientes",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(top = 4.dp, bottom = 2.dp)
            )
        }

        items(summary.recentTransactions, key = { it.id }) { transaction ->
            TransactionItem(transaction = transaction)
        }
    }
}

@Composable
private fun GreetingSection(userEmail: String) {
    Column {
        Text(
            text = "Bienvenido de nuevo",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurface
        )
        if (userEmail.isNotBlank()) {
            Text(
                text = userEmail,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun BalanceHeroCard(
    summary: DashboardSummary,
    onOpenBanking: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(28.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Tu Saldo",
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontWeight = FontWeight.Medium
                )
                // Badge de rendimiento estilo Figma UIKit (+8%)
                Box(
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(AccentMint)
                        .padding(horizontal = 10.dp, vertical = 4.dp)
                ) {
                    val isPositive = summary.netCashFlow >= 0
                    val sign = if (isPositive) "+" else ""
                    val percentage = if (summary.totalBalance > 0) ((summary.netCashFlow / summary.totalBalance) * 100).toInt() else 8
                    Text(
                        text = "$sign$percentage%",
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFF101720)
                    )
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            // Cifra con decimales sutiles
            val formatted = summary.totalBalance.formatCurrency(summary.currency)
            val parts = formatted.split(".", ",")
            Row(
                verticalAlignment = Alignment.Bottom
            ) {
                Text(
                    text = parts.firstOrNull() ?: formatted,
                    style = MaterialTheme.typography.headlineLarge,
                    fontWeight = FontWeight.ExtraBold,
                    color = MaterialTheme.colorScheme.onSurface
                )
                if (parts.size > 1) {
                    Text(
                        text = ".${parts[1]}",
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                        modifier = Modifier.padding(bottom = 2.dp)
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Fila de 3 botones píldora (Cobrar, Cuentas, Vincular)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                // Cobrar (Primary Violet Pill)
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primary)
                        .clickable { onOpenBanking() }
                        .padding(vertical = 12.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.Send,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onPrimary,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "Cobrar",
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onPrimary
                        )
                    }
                }

                // Cuentas (Surface Pill)
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.surface)
                        .clickable { onOpenBanking() }
                        .padding(vertical = 12.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.CreditCard,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurface,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "Cuentas",
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                    }
                }

                // Vincular (Surface Pill)
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.surface)
                        .clickable { onOpenBanking() }
                        .padding(vertical = 12.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Add,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurface,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = "Vincular",
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun FinancialHealthCard(
    netFlow: Double,
    currency: String,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp)
        ) {
            Column {
                Text(
                    text = "Salud Financiera",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface
                )
                Text(
                    text = "Últimos 7 días • Flujo neto: ${if (netFlow >= 0) "+" else ""}${netFlow.formatCurrency(currency)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Gráfico de barras segmentadas (7 días) estilo Figma Balance UIKit
            val days = listOf("Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom")
            val activeLevels = listOf(5, 7, 3, 8, 6, 2, 4)
            val isExpenseDay = listOf(false, false, true, false, true, false, false)

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Bottom
            ) {
                days.forEachIndexed { index, day ->
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.weight(1f)
                    ) {
                        Column(
                            verticalArrangement = Arrangement.spacedBy(3.dp),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            for (segment in 8 downTo 1) {
                                val isActive = segment <= activeLevels[index]
                                val segmentColor = when {
                                    !isActive -> MaterialTheme.colorScheme.surface.copy(alpha = 0.5f)
                                    isExpenseDay[index] -> AccentCoral
                                    else -> MaterialTheme.colorScheme.primary
                                }
                                Box(
                                    modifier = Modifier
                                        .width(26.dp)
                                        .height(5.dp)
                                        .clip(RoundedCornerShape(3.dp))
                                        .background(segmentColor)
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = day,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun IncomeExpenseRow(
    income: Double,
    expenses: Double,
    currency: String
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Ingresos
        Card(
            modifier = Modifier.weight(1f),
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant
            )
        ) {
            Row(
                modifier = Modifier.padding(14.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .size(38.dp)
                        .clip(CircleShape)
                        .background(AccentMint.copy(alpha = 0.2f)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.ArrowDownward,
                        contentDescription = "Ingresos",
                        tint = MaterialTheme.businessColors.income,
                        modifier = Modifier.size(20.dp)
                    )
                }
                Spacer(modifier = Modifier.width(10.dp))
                Column {
                    Text(
                        text = "Ingresos",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = income.formatCurrency(currency),
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.businessColors.income
                    )
                }
            }
        }

        // Gastos
        Card(
            modifier = Modifier.weight(1f),
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant
            )
        ) {
            Row(
                modifier = Modifier.padding(14.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .size(38.dp)
                        .clip(CircleShape)
                        .background(AccentCoral.copy(alpha = 0.2f)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.ArrowUpward,
                        contentDescription = "Gastos",
                        tint = MaterialTheme.businessColors.expense,
                        modifier = Modifier.size(20.dp)
                    )
                }
                Spacer(modifier = Modifier.width(10.dp))
                Column {
                    Text(
                        text = "Egresos",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = expenses.formatCurrency(currency),
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.businessColors.expense
                    )
                }
            }
        }
    }
}

@Composable
private fun AccountsHorizontalList(
    accounts: List<BankAccount>,
    currency: String,
    onAddAccount: () -> Unit
) {
    LazyRow(
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        items(accounts, key = { it.id }) { account ->
            Card(
                modifier = Modifier.width(220.dp),
                shape = RoundedCornerShape(20.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                )
            ) {
                Column(
                    modifier = Modifier.padding(16.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier
                                .size(32.dp)
                                .clip(CircleShape)
                                .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.2f)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = Icons.Default.AccountBalance,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = account.institutionName,
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Bold
                        )
                    }
                    Spacer(modifier = Modifier.height(10.dp))
                    Text(
                        text = "${account.accountType} • ${account.accountNumberMasked}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                    Text(
                        text = account.balance.formatCurrency(account.currency),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                }
            }
        }

        // Tarjeta rápida "+ Agregar Cuenta" estilo UIKit
        item {
            Card(
                modifier = Modifier
                    .width(140.dp)
                    .clickable { onAddAccount() },
                shape = RoundedCornerShape(20.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
                )
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Box(
                        modifier = Modifier
                            .size(36.dp)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.primary),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Add,
                            contentDescription = "Agregar cuenta",
                            tint = MaterialTheme.colorScheme.onPrimary,
                            modifier = Modifier.size(20.dp)
                        )
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "+ Vincular",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                }
            }
        }
    }
}

@Composable
private fun TransactionItem(transaction: Transaction) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.weight(1f)
            ) {
                val isIncome = transaction.type == TransactionType.INCOME
                val iconBg = if (isIncome) AccentMint.copy(alpha = 0.2f) else AccentCoral.copy(alpha = 0.2f)
                val iconTint = if (isIncome) MaterialTheme.businessColors.income else MaterialTheme.businessColors.expense
                val icon = if (isIncome) Icons.Default.ArrowDownward else Icons.Default.ArrowUpward

                Box(
                    modifier = Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(iconBg),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = icon,
                        contentDescription = null,
                        tint = iconTint,
                        modifier = Modifier.size(20.dp)
                    )
                }

                Spacer(modifier = Modifier.width(12.dp))

                Column {
                    Text(
                        text = transaction.description,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Text(
                        text = "${transaction.date} • ${transaction.category ?: "General"}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            val sign = if (transaction.type == TransactionType.INCOME) "+" else "-"
            val color = if (transaction.type == TransactionType.INCOME) MaterialTheme.businessColors.income else MaterialTheme.colorScheme.onSurface

            Text(
                text = "$sign${transaction.amount.formatCurrency(transaction.currency)}",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = color
            )
        }
    }
}
