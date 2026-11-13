package com.fieldtools.armeasure.ar

import android.opengl.GLES20
import java.nio.FloatBuffer

/** 측정점(원형 포인트)·측정선·레티클(원) 렌더러 */
class ShapeRenderer {
    private var program = 0
    private var aPos = 0
    private var uMvp = 0
    private var uColor = 0
    private var uPointSize = 0
    private var uRound = 0
    private var buf: FloatBuffer = GlUtil.floatBuffer(3 * 256)

    fun createOnGlThread() {
        program = GlUtil.program(VS, FS)
        aPos = GLES20.glGetAttribLocation(program, "a_Position")
        uMvp = GLES20.glGetUniformLocation(program, "u_MVP")
        uColor = GLES20.glGetUniformLocation(program, "u_Color")
        uPointSize = GLES20.glGetUniformLocation(program, "u_PointSize")
        uRound = GLES20.glGetUniformLocation(program, "u_Round")
    }

    private fun upload(xyz: FloatArray) {
        if (buf.capacity() < xyz.size) buf = GlUtil.floatBuffer(xyz.size * 2)
        buf.clear(); buf.put(xyz); buf.position(0)
    }

    /** mode: GL_LINES / GL_LINE_LOOP / GL_LINE_STRIP / GL_POINTS */
    fun draw(vp: FloatArray, xyz: FloatArray, mode: Int, color: FloatArray, width: Float = 4f, onTop: Boolean = true) {
        if (xyz.isEmpty()) return
        upload(xyz)
        GLES20.glUseProgram(program)
        GLES20.glUniformMatrix4fv(uMvp, 1, false, vp, 0)
        GLES20.glUniform4fv(uColor, 1, color, 0)
        GLES20.glUniform1f(uPointSize, width)
        GLES20.glUniform1i(uRound, if (mode == GLES20.GL_POINTS) 1 else 0)
        if (onTop) GLES20.glDisable(GLES20.GL_DEPTH_TEST)
        GLES20.glEnable(GLES20.GL_BLEND)
        GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA)
        GLES20.glLineWidth(width)
        GLES20.glVertexAttribPointer(aPos, 3, GLES20.GL_FLOAT, false, 0, buf)
        GLES20.glEnableVertexAttribArray(aPos)
        GLES20.glDrawArrays(mode, 0, xyz.size / 3)
        GLES20.glDisableVertexAttribArray(aPos)
        GLES20.glDisable(GLES20.GL_BLEND)
        if (onTop) GLES20.glEnable(GLES20.GL_DEPTH_TEST)
    }

    companion object {
        private const val VS = """
            uniform mat4 u_MVP;
            uniform float u_PointSize;
            attribute vec4 a_Position;
            void main() { gl_Position = u_MVP * a_Position; gl_PointSize = u_PointSize; }
        """
        private const val FS = """
            precision mediump float;
            uniform vec4 u_Color;
            uniform int u_Round;
            void main() {
                if (u_Round == 1) {
                    vec2 d = gl_PointCoord - vec2(0.5);
                    float r = length(d);
                    if (r > 0.5) discard;
                    // 흰 테두리가 있는 원형 점
                    gl_FragColor = r > 0.36 ? vec4(1.0, 1.0, 1.0, u_Color.a) : u_Color;
                } else {
                    gl_FragColor = u_Color;
                }
            }
        """
    }
}
