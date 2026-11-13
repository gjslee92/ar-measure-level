package com.fieldtools.armeasure.level

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Shader
import android.util.AttributeSet
import android.view.View
import androidx.core.content.ContextCompat
import com.fieldtools.armeasure.R
import kotlin.math.hypot
import kotlin.math.min

/** 디지털 버블 수평계(평면) / 세움 다이얼 + 원통 버블 표시 */
class LevelView @JvmOverloads constructor(context: Context, attrs: AttributeSet? = null) : View(context, attrs) {
    var mode = "flat"
    var a = 0.0          // 평면: 좌우(+ 오른쪽 낮음) / 세움: 편차(+ 시계방향)
    var b = 0.0          // 평면: 전후(+ 아래쪽 낮음)
    var k = 0            // 세움: 기준 방향(0..3)
    var state = "bad"
    var hasData = false

    private val cOk = ContextCompat.getColor(context, R.color.ok)
    private val cNear = ContextCompat.getColor(context, R.color.near)
    private val cBad = ContextCompat.getColor(context, R.color.bad)
    private val cLine = ContextCompat.getColor(context, R.color.line)
    private val cMuted = ContextCompat.getColor(context, R.color.muted)
    private val cBg2 = ContextCompat.getColor(context, R.color.bg2)
    private val cAccent = ContextCompat.getColor(context, R.color.accent)

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }

    fun update(mode: String, a: Double, b: Double, k: Int, state: String) {
        this.mode = mode; this.a = a; this.b = b; this.k = k; this.state = state; hasData = true
        invalidate()
    }

    private fun stateColor() = when (state) { "ok" -> cOk; "near" -> cNear; else -> cBad }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (mode == "flat") drawFlat(canvas) else drawEdge(canvas)
    }

    private fun drawFlat(c: Canvas) {
        val cx = width / 2f; val cy = height / 2f
        val r = min(width, height) / 2f * 0.92f
        fill.shader = null; fill.color = cBg2
        c.drawCircle(cx, cy, r, fill)
        stroke.strokeWidth = if (state == "ok" && hasData) 6f else 3f
        stroke.color = if (state == "ok" && hasData) cOk else cLine
        stroke.pathEffect = null
        c.drawCircle(cx, cy, r, stroke)
        stroke.strokeWidth = 2f; stroke.color = cMuted; stroke.pathEffect = DashPathEffect(floatArrayOf(10f, 10f), 0f)
        c.drawCircle(cx, cy, r * 0.75f, stroke); c.drawCircle(cx, cy, r * 0.45f, stroke)
        stroke.pathEffect = null; stroke.color = cOk
        c.drawCircle(cx, cy, r * 0.17f, stroke)
        stroke.color = cLine
        c.drawLine(cx - r, cy, cx + r, cy, stroke); c.drawLine(cx, cy - r, cx, cy + r, stroke)
        if (!hasData) return
        // 버블은 높은 쪽으로: 오른쪽이 낮으면(a>0) 왼쪽으로, 아래쪽이 낮으면(b>0) 위쪽으로
        val lim = 12.0
        var bx = -a / lim; var by = -b / lim
        val n = hypot(bx, by); if (n > 1) { bx /= n; by /= n }
        val px = cx + (bx * r * 0.82).toFloat(); val py = cy + (by * r * 0.82).toFloat()
        val br = r * 0.15f
        fill.shader = RadialGradient(px - br * 0.3f, py - br * 0.4f, br * 1.2f, Color.WHITE, stateColor(), Shader.TileMode.CLAMP)
        c.drawCircle(px, py, br, fill)
        fill.shader = null
    }

    private fun drawEdge(c: Canvas) {
        val cx = width / 2f
        val dialR = min(width, height * 0.72f) / 2f * 0.9f
        val dialCy = dialR + 8f
        c.save()
        // 기기 방향을 상쇄해 다이얼이 실제 세계 기준으로 똑바로 보이도록 회전
        c.rotate(-(k * 90f), cx, dialCy)
        fill.color = cBg2; fill.shader = null
        c.drawCircle(cx, dialCy, dialR, fill)
        stroke.pathEffect = null; stroke.strokeWidth = if (state == "ok") 6f else 3f; stroke.color = if (state == "ok") cOk else cLine
        c.drawCircle(cx, dialCy, dialR, stroke)
        stroke.strokeWidth = 2f; stroke.color = cMuted
        c.drawLine(cx - dialR * 0.85f, dialCy, cx + dialR * 0.85f, dialCy, stroke)   // 기기 모서리 기준
        c.drawLine(cx, dialCy - dialR * 0.85f, cx, dialCy + dialR * 0.85f, stroke)
        if (hasData) {
            // 실제 수평선(기준): 기기 모서리 십자선과 겹치면 수평/수직
            c.save(); c.rotate((-a).toFloat(), cx, dialCy)
            stroke.strokeWidth = 8f; stroke.color = stateColor()
            c.drawLine(cx - dialR * 0.88f, dialCy, cx + dialR * 0.88f, dialCy, stroke)
            c.restore()
        }
        c.restore()
        // 원통 버블 (화면 하단)
        val tubeTop = dialCy + dialR + 32f
        val tw = width * 0.8f; val th = 64f
        val left = cx - tw / 2
        fill.color = cBg2
        c.drawRoundRect(left, tubeTop, left + tw, tubeTop + th, th / 2, th / 2, fill)
        stroke.strokeWidth = 3f; stroke.color = cLine
        c.drawRoundRect(left, tubeTop, left + tw, tubeTop + th, th / 2, th / 2, stroke)
        stroke.color = cMuted
        c.drawLine(cx - 56f, tubeTop, cx - 56f, tubeTop + th, stroke); c.drawLine(cx + 56f, tubeTop, cx + 56f, tubeTop + th, stroke)
        if (hasData) {
            val off = (-a / 5.0).coerceIn(-1.0, 1.0) * (tw / 2 - 60f)
            fill.color = stateColor()
            val bxc = cx + off.toFloat()
            c.drawRoundRect(bxc - 48f, tubeTop + 10f, bxc + 48f, tubeTop + th - 10f, 22f, 22f, fill)
        }
        fill.color = cAccent
    }
}
