package com.fieldtools.armeasure.level

import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * 수평기 계산 (웹앱 levelmath.js와 동일한 규약)
 * 기기 좌표: x=오른쪽, y=화면 위쪽, z=화면 바깥.
 * u = '하늘 방향(up)' 단위벡터 = 정규화된 중력 센서 값(Android 중력/가속도 센서는 정지 시 위쪽을 가리키는 값을 반환)
 */
object LevelMath {
    private const val R2D = 180.0 / Math.PI

    fun normalize(v: DoubleArray): DoubleArray {
        val n = sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).takeIf { it > 1e-9 } ?: 1.0
        return doubleArrayOf(v[0] / n, v[1] / n, v[2] / n)
    }

    fun wrap180(d: Double): Double {
        var x = ((d + 180.0) % 360.0 + 360.0) % 360.0 - 180.0
        if (x == -180.0) x = 180.0
        return x
    }

    fun wrap360(d: Double): Double = ((d % 360.0) + 360.0) % 360.0

    data class Flat(val x: Double, val y: Double, val total: Double)
    /** x>0: 오른쪽이 낮음, y>0: 위쪽(먼 쪽)이 높음 = 아래쪽(가까운 쪽)이 낮음 */
    fun flat(u: DoubleArray): Flat {
        val ax = atan2(-u[0], u[2]) * R2D
        val ay = atan2(u[1], u[2]) * R2D
        val total = acos(u[2].coerceIn(-1.0, 1.0)) * R2D
        return Flat(ax, ay, total)
    }

    data class Edge(val rot: Double, val k: Int, val dev: Double, val vertical: Boolean, val outOfPlane: Double)
    /** 화면 평면 내 회전각(0~360°, 0=세로로 세움, 시계방향 +) 과 가장 가까운 기준각과의 편차 */
    fun edge(u: DoubleArray, calib: Double = 0.0): Edge {
        val rot = wrap360(atan2(-u[0], u[1]) * R2D - calib)
        val k = (rot / 90.0).roundToInt() % 4
        val dev = wrap180(rot - k * 90.0)
        val oop = asin(u[2].coerceIn(-1.0, 1.0)) * R2D
        return Edge(rot, k, dev, k % 2 == 0, oop)
    }

    fun pickMode(u: DoubleArray, prev: String?): String {
        val az = abs(u[2])
        return when (prev) {
            "flat" -> if (az < 0.62) "edge" else "flat"
            "edge" -> if (az > 0.78) "flat" else "edge"
            else -> if (az > 0.707) "flat" else "edge"
        }
    }

    fun judge(absDeg: Double, t1: Double, t2: Double) = when {
        absDeg <= t1 -> "ok"
        absDeg <= t2 -> "near"
        else -> "bad"
    }

    val STATE_LABEL = mapOf("ok" to "매우 정확한 수평", "near" to "거의 수평", "bad" to "기울어짐")

    fun alpha(smoothing: String) = when (smoothing) { "low" -> 0.35; "high" -> 0.06; else -> 0.15 }

    /** 낮은 쪽 방향(평면 모드, 화면 위쪽=0°, 시계방향) */
    fun lowDirection(x: Double, y: Double): Double = if (hypot(x, y) < 0.1) Double.NaN else wrap360(atan2(x, -y) * R2D)
}

/** 지수 이동 평균 벡터 필터 */
class VectorFilter(var alpha: Double) {
    var v: DoubleArray? = null
        private set

    fun push(u: DoubleArray): DoubleArray {
        val cur = v
        val out = if (cur == null) u.copyOf() else LevelMath.normalize(
            doubleArrayOf(cur[0] + alpha * (u[0] - cur[0]), cur[1] + alpha * (u[1] - cur[1]), cur[2] + alpha * (u[2] - cur[2]))
        )
        v = out
        return out
    }

    fun reset() { v = null }
}

/** 최근 값 표준편차로 안정 여부 판단 */
class StabilityMeter(private val n: Int = 30) {
    private val buf = ArrayDeque<Double>()
    fun push(x: Double) { buf.addLast(x); if (buf.size > n) buf.removeFirst() }
    fun std(): Double {
        if (buf.size < 5) return Double.POSITIVE_INFINITY
        val m = buf.average()
        return sqrt(buf.sumOf { (it - m) * (it - m) } / buf.size)
    }
    fun reset() = buf.clear()
}
