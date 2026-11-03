package com.mybusiness.core.datastore.security

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.inject.Inject

/**
 * Cifra los tokens de sesión con una clave AES-256 GCM generada y custodiada por el
 * Android Keystore: la clave nunca sale del hardware/keystore del dispositivo.
 *
 * No se registra en logs ni el contenido en claro, ni el texto cifrado, ni el IV.
 */
class AndroidKeystoreSessionCipher @Inject constructor() : SessionCipher {

    override fun encrypt(plainText: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        // El proveedor del Keystore genera el IV; no hay que fijarlo manualmente.
        val cipherText = cipher.doFinal(plainText.toByteArray(Charsets.UTF_8))
        return SessionCipherCodec.encode(cipher.iv, cipherText)
    }

    override fun decrypt(encoded: String): String? {
        val decoded = SessionCipherCodec.decode(encoded) ?: return null
        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(
                Cipher.DECRYPT_MODE,
                secretKey(),
                GCMParameterSpec(GCM_TAG_LENGTH_BITS, decoded.iv)
            )
            String(cipher.doFinal(decoded.cipherText), Charsets.UTF_8)
        } catch (exception: GeneralSecurityException) {
            // Tag inválido, clave rotada o dato corrupto: se trata como no descifrable.
            null
        } catch (exception: IllegalArgumentException) {
            null
        }
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        val existing = keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry
        if (existing != null) return existing.secretKey

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(KEY_SIZE_BITS)
                // Deliberadamente sin setUserAuthenticationRequired: los tokens deben poder
                // descifrarse en segundo plano (refresco silencioso, sincronización).
                .build()
        )
        return generator.generateKey()
    }

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "mybusiness_session_key_v1"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_TAG_LENGTH_BITS = 128
        const val KEY_SIZE_BITS = 256
    }
}
