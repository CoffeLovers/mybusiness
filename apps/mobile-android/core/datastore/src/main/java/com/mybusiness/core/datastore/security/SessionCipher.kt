package com.mybusiness.core.datastore.security

import java.util.Base64

/** Cifra/descifra cadenas sensibles antes de persistirlas. */
interface SessionCipher {
    fun encrypt(plainText: String): String

    /** Devuelve null si el dato no se puede descifrar (p. ej. legado en claro o clave rotada). */
    fun decrypt(encoded: String): String?
}

/**
 * Formato persistido: `v1:<ivBase64>:<cipherBase64>`. La versión permite migrar el esquema.
 */
object SessionCipherCodec {
    const val PREFIX = "v1"

    private const val SEPARATOR = ":"
    private const val PART_COUNT = 3

    fun encode(iv: ByteArray, cipherText: ByteArray): String {
        val encoder = Base64.getEncoder()
        return buildString {
            append(PREFIX)
            append(SEPARATOR)
            append(encoder.encodeToString(iv))
            append(SEPARATOR)
            append(encoder.encodeToString(cipherText))
        }
    }

    /** Devuelve null si el formato no es válido o la versión es desconocida. */
    fun decode(encoded: String): Decoded? {
        val parts = encoded.split(SEPARATOR)
        if (parts.size != PART_COUNT) return null
        if (parts[0] != PREFIX) return null

        val ivPart = parts[1]
        val cipherPart = parts[2]
        if (ivPart.isEmpty() || cipherPart.isEmpty()) return null

        val decoder = Base64.getDecoder()
        return try {
            val iv = decoder.decode(ivPart)
            val cipherText = decoder.decode(cipherPart)
            if (iv.isEmpty() || cipherText.isEmpty()) return null
            Decoded(iv = iv, cipherText = cipherText)
        } catch (exception: IllegalArgumentException) {
            // Base64 malformado: mismo tratamiento que un formato inválido.
            null
        }
    }

    data class Decoded(val iv: ByteArray, val cipherText: ByteArray)
}
