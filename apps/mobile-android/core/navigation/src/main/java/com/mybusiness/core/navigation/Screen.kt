package com.mybusiness.core.navigation

import kotlinx.serialization.Serializable

sealed interface Screen {

    @Serializable
    data object Splash : Screen

    @Serializable
    data object Login : Screen

    @Serializable
    data object Dashboard : Screen

    @Serializable
    data object Banking : Screen
}
