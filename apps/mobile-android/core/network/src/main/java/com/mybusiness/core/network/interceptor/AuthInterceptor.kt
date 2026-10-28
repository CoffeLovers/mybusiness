package com.mybusiness.core.network.interceptor

import com.mybusiness.core.common.constants.Constants
import com.mybusiness.core.datastore.UserSessionDataStore
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Response
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthInterceptor @Inject constructor(
    private val sessionDataStore: UserSessionDataStore
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()

        // Si la petición es hacia auth/login o auth/register, no adjuntamos token
        val path = originalRequest.url.encodedPath
        if (path.contains("auth/login") || path.contains("auth/register")) {
            return chain.proceed(originalRequest)
        }

        val token = runBlocking {
            sessionDataStore.accessToken.firstOrNull()
        }

        val requestBuilder = originalRequest.newBuilder()
        if (!token.isNullOrBlank()) {
            requestBuilder.header(
                Constants.HEADER_AUTHORIZATION,
                "${Constants.TOKEN_PREFIX}$token"
            )
        }

        val response = chain.proceed(requestBuilder.build())

        // Si recibimos 401 Unauthorized, limpiamos la sesión de manera segura
        if (response.code == 401) {
            Timber.w("Sesión expirada (HTTP 401). Limpiando credenciales locales...")
            runBlocking {
                sessionDataStore.clearSession()
            }
        }

        return response
    }
}
