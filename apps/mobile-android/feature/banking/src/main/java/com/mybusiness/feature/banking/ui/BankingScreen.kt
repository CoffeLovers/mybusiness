package com.mybusiness.feature.banking.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mybusiness.core.common.extensions.formatRelativeTime
import com.mybusiness.core.designsystem.component.ErrorCard
import com.mybusiness.core.designsystem.component.LoadingView
import com.mybusiness.core.designsystem.component.MyBusinessTopAppBar
import com.mybusiness.core.designsystem.component.PrimaryButton
import com.mybusiness.core.designsystem.theme.minimumTouchTarget
import com.mybusiness.core.model.BankProvider
import com.mybusiness.core.model.ConnectionStatus
import com.mybusiness.core.model.LinkedAccount
import com.mybusiness.core.model.LinkedConnection
import com.mybusiness.core.model.minorToDecimalString
import kotlinx.coroutines.launch

/**
 * Pantalla de cuentas bancarias vinculadas.
 *
 * Flujo: vincular (Custom Tabs + deep link de retorno), sincronizar manualmente y desvincular
 * con autenticación fuerte (biometría).
 */
@Composable
fun BankingScreen(
    onBack: () -> Unit,
    onSessionExpired: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: BankingViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var showProviderDialog by remember { mutableStateOf(false) }
    var pendingDisconnect by remember { mutableStateOf<LinkedConnection?>(null) }

    LaunchedEffect(uiState.errorMessage) {
        val message = uiState.errorMessage ?: return@LaunchedEffect
        // Con conexiones visibles el error es transitorio (snackbar); sin conexiones
        // se mantiene la tarjeta de estado para que la acción de reintento siga disponible.
        if (uiState.connections.isEmpty()) return@LaunchedEffect
        snackbarHostState.showSnackbar(message)
        viewModel.clearMessages()
    }

    LaunchedEffect(uiState.infoMessage) {
        val message = uiState.infoMessage ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(message)
        viewModel.clearMessages()
    }

    LaunchedEffect(uiState.linkSession) {
        val session = uiState.linkSession ?: return@LaunchedEffect
        BankLinkLauncher.open(context, session)
        viewModel.consumeLinkSession()
    }

    Scaffold(
        topBar = {
            MyBusinessTopAppBar(
                title = "Cuentas bancarias",
                navigationIcon = {
                    IconButton(
                        onClick = onBack,
                        modifier = Modifier.minimumTouchTarget()
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Volver"
                        )
                    }
                }
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                text = { Text("Vincular cuenta") },
                icon = {
                    Icon(
                        imageVector = Icons.Default.Add,
                        contentDescription = null
                    )
                },
                onClick = { showProviderDialog = true }
            )
        },
        snackbarHost = { SnackbarHost(hostState = snackbarHostState) },
        modifier = modifier.fillMaxSize()
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            HeaderRow(
                isSyncing = uiState.isSyncing,
                onRefresh = { viewModel.loadOverview() }
            )

            when {
                uiState.isLoading && !uiState.hasLoadedOnce -> LoadingView()
                uiState.isUnauthorized && uiState.connections.isEmpty() -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    SessionExpiredState(onLogin = onSessionExpired)
                }
                uiState.errorMessage != null && uiState.connections.isEmpty() -> ErrorCard(
                    message = uiState.errorMessage.orEmpty(),
                    onRetry = { viewModel.loadOverview() }
                )

                uiState.isEmpty -> EmptyState(onLink = { showProviderDialog = true })

                else -> ConnectionsList(
                    uiState = uiState,
                    onSync = { connectionId -> viewModel.sync(connectionId) },
                    onDisconnect = { connection -> pendingDisconnect = connection }
                )
            }
        }
    }

    if (showProviderDialog) {
        ProviderDialog(
            onDismiss = { showProviderDialog = false },
            onSelect = { provider ->
                showProviderDialog = false
                viewModel.startLink(provider)
            }
        )
    }

    pendingDisconnect?.let { connection ->
        AlertDialog(
            onDismissRequest = { pendingDisconnect = null },
            title = { Text("Desvincular cuenta") },
            text = {
                Text(
                    "Para continuar, confirma tu identidad con huella o con la credencial del dispositivo."
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        pendingDisconnect = null
                        val activity = BankLinkLauncher.run { context.findFragmentActivity() }
                        if (activity == null) {
                            scope.launch {
                                snackbarHostState.showSnackbar(
                                    "No pudimos verificar tu identidad. Inténtalo de nuevo."
                                )
                            }
                        } else {
                            viewModel.disconnect(activity, connection.id)
                        }
                    },
                    modifier = Modifier.minimumTouchTarget()
                ) {
                    Text("Usar huella")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { pendingDisconnect = null },
                    modifier = Modifier.minimumTouchTarget()
                ) {
                    Text("Cancelar")
                }
            }
        )
    }
}

@Composable
private fun SessionExpiredState(onLogin: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = "Tu sesión expiró",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "Vuelve a iniciar sesión para continuar.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(16.dp))
            PrimaryButton(text = "Iniciar sesión", onClick = onLogin)
        }
    }
}

@Composable
private fun HeaderRow(
    isSyncing: Boolean,
    onRefresh: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            text = if (isSyncing) "Sincronizando…" else "Tus conexiones",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface
        )
        IconButton(
            onClick = onRefresh,
            enabled = !isSyncing,
            modifier = Modifier.minimumTouchTarget()
        ) {
            Icon(
                imageVector = Icons.Default.Refresh,
                contentDescription = "Actualizar"
            )
        }
    }
}

@Composable
private fun EmptyState(onLink: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = "Aún no has vinculado ninguna cuenta",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(16.dp))
            PrimaryButton(text = "Vincular cuenta", onClick = onLink)
        }
    }
}

@Composable
private fun ConnectionsList(
    uiState: BankingUiState,
    onSync: (String) -> Unit,
    onDisconnect: (LinkedConnection) -> Unit
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = 16.dp,
            end = 16.dp,
            bottom = 96.dp
        ),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        items(items = uiState.connections, key = { it.id }) { connection ->
            ConnectionCard(
                connection = connection,
                accounts = uiState.accountsByConnection[connection.id].orEmpty(),
                isSyncing = uiState.isSyncing,
                onSync = { onSync(connection.id) },
                onDisconnect = { onDisconnect(connection) }
            )
        }
    }
}

@Composable
private fun ConnectionCard(
    connection: LinkedConnection,
    accounts: List<LinkedAccount>,
    isSyncing: Boolean,
    onSync: () -> Unit,
    onDisconnect: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
        ),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
    ) {
        Column(modifier = Modifier.padding(18.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = connection.institutionName ?: connection.provider.displayName(),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f, fill = false)
                )
                StatusChip(status = connection.status)
            }

            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "Última sincronización: " +
                    (connection.lastSuccessfulSyncAt.formatRelativeTime() ?: "Sin sincronizar"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            if (accounts.isNotEmpty()) {
                Spacer(modifier = Modifier.height(14.dp))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    accounts.forEach { account ->
                        AccountRow(account = account)
                    }
                }
            }

            Spacer(modifier = Modifier.height(10.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically
            ) {
                TextButton(
                    onClick = onSync,
                    enabled = !isSyncing,
                    modifier = Modifier.minimumTouchTarget()
                ) {
                    Text("Sincronizar")
                }
                TextButton(
                    onClick = onDisconnect,
                    modifier = Modifier.minimumTouchTarget()
                ) {
                    Text(
                        text = "Desvincular",
                        color = MaterialTheme.colorScheme.error
                    )
                }
            }
        }
    }
}

@Composable
private fun AccountRow(account: LinkedAccount) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(0.5.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 10.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = buildString {
                        append(account.name)
                        val mask = account.mask
                        if (!mask.isNullOrBlank()) {
                            append(" •••• $mask")
                        }
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f)
                )
                Text(
                    text = "${account.isoCurrencyCode} " +
                        (minorToDecimalString(account.balanceCurrentMinor) ?: "—"),
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface
                )
            }
            Spacer(modifier = Modifier.height(2.dp))
            Text(
                text = "Sincronizada: " + (account.lastSyncedAt.formatRelativeTime() ?: "Sin datos"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun StatusChip(status: ConnectionStatus) {
    val label = status.label()
    val containerColor = when (status) {
        ConnectionStatus.ACTIVE -> MaterialTheme.colorScheme.secondaryContainer
        ConnectionStatus.NEEDS_REAUTH -> MaterialTheme.colorScheme.tertiaryContainer
        ConnectionStatus.PENDING -> MaterialTheme.colorScheme.surfaceVariant
        ConnectionStatus.ERROR -> MaterialTheme.colorScheme.errorContainer
        ConnectionStatus.DISCONNECTED -> MaterialTheme.colorScheme.surfaceVariant
    }
    val contentColor = when (status) {
        ConnectionStatus.ACTIVE -> MaterialTheme.colorScheme.onSecondaryContainer
        ConnectionStatus.NEEDS_REAUTH -> MaterialTheme.colorScheme.onTertiaryContainer
        ConnectionStatus.PENDING -> MaterialTheme.colorScheme.onSurfaceVariant
        ConnectionStatus.ERROR -> MaterialTheme.colorScheme.onErrorContainer
        ConnectionStatus.DISCONNECTED -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    AssistChip(
        onClick = {},
        enabled = false,
        label = { Text(text = label) },
        colors = AssistChipDefaults.assistChipColors(
            disabledContainerColor = containerColor,
            disabledLabelColor = contentColor
        )
    )
}

@Composable
private fun ProviderDialog(
    onDismiss: () -> Unit,
    onSelect: (BankProvider) -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Elige tu banco o proveedor") },
        text = {
            Column {
                Text(
                    text = "Selecciona cómo quieres conectar tu cuenta.",
                    style = MaterialTheme.typography.bodyMedium
                )
                Spacer(modifier = Modifier.height(8.dp))
                TextButton(
                    onClick = { onSelect(BankProvider.PLAID) },
                    modifier = Modifier.minimumTouchTarget()
                ) {
                    Text("Plaid")
                }
                TextButton(
                    onClick = { onSelect(BankProvider.BELVO) },
                    modifier = Modifier.minimumTouchTarget()
                ) {
                    Text("Belvo")
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = onDismiss,
                modifier = Modifier.minimumTouchTarget()
            ) {
                Text("Cancelar")
            }
        }
    )
}

private fun BankProvider.displayName(): String = when (this) {
    BankProvider.PLAID -> "Plaid"
    BankProvider.BELVO -> "Belvo"
}

private fun ConnectionStatus.label(): String = when (this) {
    ConnectionStatus.ACTIVE -> "Activa"
    ConnectionStatus.NEEDS_REAUTH -> "Necesita reconectar"
    ConnectionStatus.PENDING -> "Conectando"
    ConnectionStatus.ERROR -> "No se pudo conectar"
    ConnectionStatus.DISCONNECTED -> "Desconectada"
}
