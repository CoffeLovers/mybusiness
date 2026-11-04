package com.mybusiness.feature.banking.data.deeplink

import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Punto de encuentro entre la actividad y el `BankingViewModel` para el retorno del flujo
 * de vinculación bancaria (`mybusiness://banking/return?public_token=...`).
 *
 * La actividad entrega aquí el `Uri` recibido en `onNewIntent`/`onCreate` y el ViewModel
 * lo consume. Al vivir en el grafo de Hilt como singleton, el URI pendiente sobrevive a
 * recreaciones de la actividad (rotación, proceso restaurado), evitando perder el token.
 *
 * Nunca se registra en logs el contenido del URI ni el token.
 */
@Singleton
class BankLinkDeepLinkStore @Inject constructor() {

    private val _pendingUri = MutableStateFlow<String?>(null)
    val pendingUri: StateFlow<String?> = _pendingUri.asStateFlow()

    /** Publica el URI de retorno del deep link. Los valores en blanco se ignoran. */
    fun publish(uri: String) {
        if (uri.isBlank()) return
        _pendingUri.value = uri
    }

    /** Marca el URI pendiente como consumido. */
    fun consume() {
        _pendingUri.value = null
    }
}
