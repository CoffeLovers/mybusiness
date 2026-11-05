package com.mybusiness.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.mybusiness.core.datastore.UserSessionDataStore
import com.mybusiness.core.designsystem.component.LoadingView
import com.mybusiness.core.navigation.Screen
import com.mybusiness.feature.auth.ui.LoginScreen
import com.mybusiness.feature.banking.ui.BankingScreen
import com.mybusiness.feature.dashboard.ui.DashboardScreen
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import javax.inject.Inject

@HiltViewModel
class SessionCheckViewModel @Inject constructor(
    private val sessionDataStore: UserSessionDataStore
) : ViewModel() {

    private val _isLoggedIn = MutableStateFlow<Boolean?>(null)
    val isLoggedIn: StateFlow<Boolean?> = _isLoggedIn.asStateFlow()

    suspend fun checkSession() {
        val token = sessionDataStore.accessToken.first()
        _isLoggedIn.value = !token.isNullOrBlank()
    }
}

@Composable
fun MyBusinessNavHost(
    modifier: Modifier = Modifier,
    navController: NavHostController = rememberNavController(),
    sessionViewModel: SessionCheckViewModel = hiltViewModel()
) {
    val isLoggedIn by sessionViewModel.isLoggedIn.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) {
        sessionViewModel.checkSession()
    }

    if (isLoggedIn == null) {
        LoadingView()
        return
    }

    val startDestination = if (isLoggedIn == true) Screen.Dashboard else Screen.Login

    NavHost(
        navController = navController,
        startDestination = startDestination,
        modifier = modifier
    ) {
        composable<Screen.Login> {
            LoginScreen(
                onLoginSuccess = {
                    navController.navigate(Screen.Dashboard) {
                        popUpTo(Screen.Login) { inclusive = true }
                    }
                }
            )
        }

        composable<Screen.Dashboard> {
            DashboardScreen(
                onLogoutSuccess = {
                    navController.navigate(Screen.Login) {
                        popUpTo(Screen.Dashboard) { inclusive = true }
                    }
                },
                onOpenBanking = { navController.navigate(Screen.Banking) }
            )
        }

        composable<Screen.Banking> {
            BankingScreen(
                onBack = { navController.popBackStack() },
                onSessionExpired = {
                    navController.navigate(Screen.Login) {
                        popUpTo(Screen.Dashboard) { inclusive = true }
                    }
                }
            )
        }
    }
}
