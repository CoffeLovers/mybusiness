package com.mybusiness.core.biometric

import android.content.Context
import android.os.Build
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * Implementación de [BiometricGate] sobre ``BiometricPrompt``.
 *
 * No registra ni expone datos del intento de autenticación: solo se traduce el
 * resultado a [BiometricResult].
 */
@Singleton
class AndroidBiometricGate @Inject constructor(
    @ApplicationContext private val context: Context
) : BiometricGate {

    override fun isAvailable(): Boolean =
        BiometricManager.from(context).canAuthenticate(allowedAuthenticators()) ==
            BiometricManager.BIOMETRIC_SUCCESS

    override suspend fun authenticate(
        activity: FragmentActivity,
        action: SensitiveAction
    ): BiometricResult {
        if (!isAvailable()) return BiometricResult.Unavailable

        return suspendCancellableCoroutine { continuation ->
            val prompt = BiometricPrompt(
                activity,
                ContextCompat.getMainExecutor(context),
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                        if (continuation.isActive) continuation.resume(BiometricResult.Success)
                    }

                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                        if (continuation.isActive) {
                            continuation.resume(BiometricPolicy.fromErrorCode(errorCode))
                        }
                    }

                    override fun onAuthenticationFailed() {
                        // El usuario puede reintentar: no se resuelve la corrutina.
                    }
                }
            )

            prompt.authenticate(buildPromptInfo(action))

            continuation.invokeOnCancellation {
                runCatching { prompt.cancelAuthentication() }
            }
        }
    }

    private fun allowedAuthenticators(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            BiometricManager.Authenticators.BIOMETRIC_WEAK or
                BiometricManager.Authenticators.DEVICE_CREDENTIAL
        } else {
            BiometricManager.Authenticators.BIOMETRIC_WEAK
        }

    private fun buildPromptInfo(action: SensitiveAction): BiometricPrompt.PromptInfo {
        val builder = BiometricPrompt.PromptInfo.Builder()
            .setTitle(action.title)
            .setSubtitle(action.subtitle)
            .setAllowedAuthenticators(allowedAuthenticators())

        // En API < 30 la credencial del dispositivo va por el fallback legacy.
        // En API >= 30 no debe llamarse a setNegativeButtonText junto con
        // DEVICE_CREDENTIAL: lanza IllegalArgumentException.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            builder.setDeviceCredentialAllowed(true)
            builder.setNegativeButtonText("Cancelar")
        }

        return builder.build()
    }
}
