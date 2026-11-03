package com.mybusiness.feature.banking.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mybusiness.core.designsystem.component.MyBusinessTopAppBar

/**
 * Pantalla de cuentas bancarias vinculadas.
 *
 * Versión mínima compilable: la UI completa (vinculación con Custom Tabs, biometría para
 * desvincular, sincronización manual) se implementa en la siguiente iteración.
 */
@Composable
fun BankingScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: BankingViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    Scaffold(
        topBar = {
            MyBusinessTopAppBar(
                title = "Cuentas bancarias",
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Volver"
                        )
                    }
                }
            )
        },
        modifier = modifier.fillMaxSize()
    ) { padding ->
        Text(
            text = if (uiState.isLoading) "Cargando…" else "Cuentas vinculadas: ${uiState.connections.size}",
            modifier = Modifier
                .padding(padding)
                .padding(16.dp)
        )
    }
}
