package com.fieldtools.armeasure.util

import java.util.Locale
import kotlin.math.abs
import kotlin.math.pow

/** 길이 단위 변환 (내부 값은 항상 미터) */
object Units {
    val ALL = listOf("mm", "cm", "m")

    fun factor(unit: String) = when (unit) { "mm" -> 1000.0; "cm" -> 100.0; else -> 1.0 }

    fun convert(meters: Double, unit: String) = meters * factor(unit)

    fun format(meters: Double, unit: String, decimals: Int): String =
        String.format(Locale.US, "%.${decimals}f %s", convert(meters, unit), unit)

    fun next(unit: String) = ALL[(ALL.indexOf(unit) + 1) % ALL.size]

    fun angle(deg: Double, decimals: Int = 1): String {
        if (deg.isNaN()) return "--"
        val v = if (abs(deg) < 0.5 * 10.0.pow(-decimals)) 0.0 else deg
        return String.format(Locale.US, "%.${decimals}f°", v)
    }
}
