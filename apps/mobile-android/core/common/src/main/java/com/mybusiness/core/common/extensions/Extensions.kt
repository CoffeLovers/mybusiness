package com.mybusiness.core.common.extensions

import java.text.NumberFormat
import java.util.Locale

fun Double.formatCurrency(currencyCode: String = "COP"): String {
    val format = NumberFormat.getCurrencyInstance(Locale("es", "CO"))
    return format.format(this).replace("COP", "").trim() + " " + currencyCode
}
