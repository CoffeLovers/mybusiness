package com.mybusiness

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.fragment.app.FragmentActivity
import com.mybusiness.core.designsystem.theme.MyBusinessTheme
import com.mybusiness.feature.banking.data.deeplink.BankLinkDeepLinkStore
import com.mybusiness.navigation.MyBusinessNavHost
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/**
 * Se extiende de [FragmentActivity] porque `BiometricPrompt` requiere un
 * `FragmentActivity` como host para anclar su fragmento interno.
 */
@AndroidEntryPoint
class MainActivity : FragmentActivity() {

    @Inject
    lateinit var deepLinkStore: BankLinkDeepLinkStore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleDeepLink(intent)
        enableEdgeToEdge()
        setContent {
            MyBusinessTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    MyBusinessNavHost()
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleDeepLink(intent)
    }

    /**
     * Publica el URI de retorno `mybusiness://banking/return?...` en el store de Hilt para
     * que el `BankingViewModel` lo consuma. Nunca se registra la URI completa: puede
     * contener tokens de vinculación.
     */
    private fun handleDeepLink(intent: Intent?) {
        val uri = intent?.data ?: return
        if (uri.scheme == SCHEME && uri.host == HOST) {
            deepLinkStore.publish(uri.toString())
        }
    }

    private companion object {
        const val SCHEME = "mybusiness"
        const val HOST = "banking"
    }
}
