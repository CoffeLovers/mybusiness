package com.mybusiness.core.common.constants

object Constants {
    // Tiempos de espera de red (segundos)
    const val NETWORK_TIMEOUT_SECONDS = 15L

    // Nombres de preferencias y DataStore
    const val DATASTORE_USER_PREFERENCES = "mybusiness_user_preferences"

    // Claves de cabecera HTTP
    const val HEADER_AUTHORIZATION = "Authorization"
    const val HEADER_REFRESH_TOKEN = "x-refresh-token"
    const val TOKEN_PREFIX = "Bearer "
}
