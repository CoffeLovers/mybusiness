package com.mybusiness.core.biometric

/** Acciones que exigen autenticación fuerte del usuario antes de ejecutarse. */
enum class SensitiveAction(val title: String, val subtitle: String) {
    CAPTURE("Confirmar captura", "Autoriza el cobro con tu huella o credencial del dispositivo."),
    REFUND("Confirmar reembolso", "Autoriza el reembolso con tu huella o credencial del dispositivo."),
    APPROVE("Aprobar operación", "Autoriza la operación con tu huella o credencial del dispositivo."),
    DISCONNECT_BANK("Desvincular cuenta", "Confirma que quieres quitar el acceso a esta cuenta bancaria.")
}

sealed interface BiometricResult {
    data object Success : BiometricResult
    data object Cancelled : BiometricResult
    data object Unavailable : BiometricResult
    data class Failure(val message: String) : BiometricResult
}

/** Puerto de autenticación; permite sustituirlo en pruebas sin Android Keystore ni UI. */
interface BiometricGate {
    /** true si hay biometría o credencial de dispositivo configurada y utilizable. */
    fun isAvailable(): Boolean
    suspend fun authenticate(
        activity: androidx.fragment.app.FragmentActivity,
        action: SensitiveAction
    ): BiometricResult
}

/**
 * Decisiones puras (testeables en JVM) sobre el fallback a credencial del dispositivo
 * y la traducción de códigos de error de `BiometricPrompt`.
 *
 * Nota: `androidx.biometric.BiometricManager` no expone constantes de cancelación;
 * esas viven en `androidx.biometric.BiometricPrompt.ERROR_*`.
 */
object BiometricPolicy {
    /** En API < 30 no se pueden combinar biometría y credencial: se usa solo biometría + fallback legacy. */
    fun canCombineBiometricAndCredential(sdkInt: Int): Boolean = sdkInt >= 30

    fun isUsable(canAuthenticateResult: Int): Boolean =
        canAuthenticateResult == androidx.biometric.BiometricManager.BIOMETRIC_SUCCESS

    fun fromErrorCode(errorCode: Int): BiometricResult = when (errorCode) {
        androidx.biometric.BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED,
        androidx.biometric.BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE,
        androidx.biometric.BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE,
        androidx.biometric.BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED -> BiometricResult.Unavailable

        // Códigos de cancelación de BiometricPrompt (no existen en BiometricManager).
        androidx.biometric.BiometricPrompt.ERROR_USER_CANCELED,
        androidx.biometric.BiometricPrompt.ERROR_CANCELED,
        androidx.biometric.BiometricPrompt.ERROR_NEGATIVE_BUTTON -> BiometricResult.Cancelled

        else -> BiometricResult.Failure("No se pudo verificar tu identidad (código $errorCode).")
    }
}
