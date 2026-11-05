package com.mybusiness.core.designsystem.theme

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.TweenSpec
import androidx.compose.animation.core.tween

/**
 * Tokens de movimiento — docs/design/tokens.json §motion.
 */
object Motion {
    const val FastMs = 150
    const val BaseMs = 200
    const val SlowMs = 300

    val enter = CubicBezierEasing(0f, 0f, 0.2f, 1f)
    val exit = CubicBezierEasing(0.4f, 0f, 1f, 1f)
    val standard = CubicBezierEasing(0.4f, 0f, 0.2f, 1f)

    fun <T> fast(): TweenSpec<T> = tween(FastMs, easing = standard)

    fun <T> base(): TweenSpec<T> = tween(BaseMs, easing = standard)

    fun <T> slow(): TweenSpec<T> = tween(SlowMs, easing = standard)
}
