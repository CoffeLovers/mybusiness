package com.mybusiness.core.designsystem.theme

import androidx.compose.foundation.layout.sizeIn
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

object TouchTarget {
    val MinSize = 48.dp
}

fun Modifier.minimumTouchTarget(): Modifier =
    this.sizeIn(minWidth = TouchTarget.MinSize, minHeight = TouchTarget.MinSize)
