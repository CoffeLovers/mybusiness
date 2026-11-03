package com.mybusiness.feature.banking.ui

import android.content.Context
import android.content.ContextWrapper
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.fragment.app.FragmentActivity
import com.mybusiness.core.model.LinkSession
import com.mybusiness.core.network.BuildConfig
import java.util.Locale

/**
 * Apertura del widget alojado del proveedor bancario (Plaid/Belvo) en Custom Tabs.
 *
 * Nota de seguridad: el token de vinculación viaja solo dentro de la URL del widget; nunca se
 * registra en logs ni se persiste en la app.
 */
object BankLinkLauncher {

    private const val PARAM_PROVIDER = "provider"
    private const val PARAM_TOKEN = "token"
    private const val PARAM_REDIRECT_URI = "redirect_uri"

    /** Construye la URL del widget alojado (Custom Tab) con el token y el redirect de retorno. */
    fun buildLinkUrl(session: LinkSession): String =
        Uri.parse(BuildConfig.BANK_LINK_URL)
            .buildUpon()
            .appendQueryParameter(PARAM_PROVIDER, session.provider.name.lowercase(Locale.ROOT))
            .appendQueryParameter(PARAM_TOKEN, session.linkToken)
            .appendQueryParameter(PARAM_REDIRECT_URI, BuildConfig.BANK_REDIRECT_URI)
            .build()
            .toString()

    /** Abre el widget en Custom Tabs. La sesión no se registra en logs. */
    fun open(context: Context, session: LinkSession) {
        val intent = CustomTabsIntent.Builder()
            .setShowTitle(true)
            .build()
        intent.launchUrl(context, Uri.parse(buildLinkUrl(session)))
    }

    /** Busca la FragmentActivity que envuelve el contexto de Compose (necesaria para BiometricPrompt). */
    fun Context.findFragmentActivity(): FragmentActivity? {
        var current: Context? = this
        while (current != null) {
            if (current is FragmentActivity) return current
            current = (current as? ContextWrapper)?.baseContext
        }
        return null
    }
}
