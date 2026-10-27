package com.mybusiness.core.common.constants

object Constants {
    // URL por defecto del API Gateway cuando se ejecuta en el emulador de Android (10.0.2.2 es el alias del host)
    const val DEFAULT_API_BASE_URL = "http://10.0.2.2:3000/api/v1/"
    
    // Nombres de preferencias y DataStore
    const val DATASTORE_USER_PREFERENCES = "mybusiness_user_preferences"
    
    // Claves de cabecera HTTP
    const val HEADER_AUTHORIZATION = "Authorization"
    const val TOKEN_PREFIX = "Bearer "
}
