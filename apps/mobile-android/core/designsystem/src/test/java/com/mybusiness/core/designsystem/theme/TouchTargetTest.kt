package com.mybusiness.core.designsystem.theme

import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Test

class TouchTargetTest {

    @Test
    fun `el tamano minimo es 48 dp`() {
        assertEquals(48.dp, TouchTarget.MinSize)
    }
}
