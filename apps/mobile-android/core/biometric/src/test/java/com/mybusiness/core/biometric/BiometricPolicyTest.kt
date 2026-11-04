package com.mybusiness.core.biometric

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BiometricPolicyTest {

    @Test
    fun `device credential only combinable from api 30`() {
        assertFalse(BiometricPolicy.canCombineBiometricAndCredential(29))
        assertTrue(BiometricPolicy.canCombineBiometricAndCredential(30))
        assertTrue(BiometricPolicy.canCombineBiometricAndCredential(34))
    }

    @Test
    fun `isUsable only for success code`() {
        assertTrue(BiometricPolicy.isUsable(BiometricManager.BIOMETRIC_SUCCESS))
        assertFalse(BiometricPolicy.isUsable(BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED))
    }

    @Test
    fun `cancellation codes map to cancelled`() {
        assertEquals(
            BiometricResult.Cancelled,
            BiometricPolicy.fromErrorCode(BiometricPrompt.ERROR_USER_CANCELED)
        )
        assertEquals(
            BiometricResult.Cancelled,
            BiometricPolicy.fromErrorCode(BiometricPrompt.ERROR_CANCELED)
        )
        assertEquals(
            BiometricResult.Cancelled,
            BiometricPolicy.fromErrorCode(BiometricPrompt.ERROR_NEGATIVE_BUTTON)
        )
    }

    @Test
    fun `unusable hardware codes map to unavailable`() {
        assertEquals(
            BiometricResult.Unavailable,
            BiometricPolicy.fromErrorCode(BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED)
        )
        assertEquals(
            BiometricResult.Unavailable,
            BiometricPolicy.fromErrorCode(BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE)
        )
        assertEquals(
            BiometricResult.Unavailable,
            BiometricPolicy.fromErrorCode(BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE)
        )
    }

    @Test
    fun `unknown code maps to failure mentioning the code`() {
        val result = BiometricPolicy.fromErrorCode(4242)
        assertTrue(result is BiometricResult.Failure)
        assertTrue((result as BiometricResult.Failure).message.contains("4242"))
    }

    @Test
    fun `every sensitive action exposes non blank copy`() {
        SensitiveAction.entries.forEach { action ->
            assertTrue(action.name, action.title.isNotBlank())
            assertTrue(action.name, action.subtitle.isNotBlank())
        }
        assertEquals(4, SensitiveAction.entries.size)
    }
}
