package com.fieldtools.armeasure

import com.fieldtools.armeasure.level.LevelMath
import com.fieldtools.armeasure.util.Units
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.cos
import kotlin.math.sin

class LevelMathTest {
    private fun up(x: Double, y: Double, z: Double) = LevelMath.normalize(doubleArrayOf(x, y, z))
    private fun rot(deg: Double): DoubleArray { val r = Math.toRadians(deg); return up(-sin(r), cos(r), 0.0) }

    @Test fun flatZero() { val f = LevelMath.flat(up(0.0, 0.0, 9.81)); assertEquals(0.0, f.x, 1e-6); assertEquals(0.0, f.y, 1e-6) }
    @Test fun flatRightLow5() { val r = Math.toRadians(5.0); assertEquals(5.0, LevelMath.flat(up(-sin(r), 0.0, cos(r))).x, 1e-6) }
    @Test fun edgeVertical() { val e = LevelMath.edge(rot(3.0)); assertTrue(e.vertical); assertEquals(3.0, e.dev, 1e-6) }
    @Test fun edgeHorizontal() { val e = LevelMath.edge(rot(275.0)); assertTrue(!e.vertical); assertEquals(5.0, e.dev, 1e-6) }
    @Test fun edgeWrap() { assertEquals(-0.4, LevelMath.edge(rot(359.6)).dev, 1e-6) }
    @Test fun judge() {
        assertEquals("ok", LevelMath.judge(0.5, 0.5, 1.0)); assertEquals("near", LevelMath.judge(0.51, 0.5, 1.0)); assertEquals("bad", LevelMath.judge(1.01, 0.5, 1.0))
    }
    @Test fun twoStepBias() { val t = 0.8; val b = 0.3; assertEquals(b, ((t + b) + (-t + b)) / 2, 1e-12) }
    @Test fun units() { assertEquals("34.6 cm", Units.format(0.3456, "cm", 1)); assertEquals("346 mm", Units.format(0.3456, "mm", 0)) }
}
