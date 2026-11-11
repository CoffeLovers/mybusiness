package com.mybusiness.core.designsystem.theme

import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.dp

object Radii {
    val sm = 4.dp
    val md = 8.dp
    val lg = 12.dp
    val xl = 16.dp
    val xxl = 24.dp
    val full = CircleShape
}

val Shapes = Shapes(
    extraSmall = RoundedCornerShape(Radii.sm),
    small = RoundedCornerShape(Radii.md),
    medium = RoundedCornerShape(Radii.lg),
    large = RoundedCornerShape(Radii.xl),
    extraLarge = RoundedCornerShape(Radii.xxl)
)
