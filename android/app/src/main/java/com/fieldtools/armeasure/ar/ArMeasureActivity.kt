package com.fieldtools.armeasure.ar

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.net.Uri
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.opengl.Matrix as GLMatrix
import android.os.Bundle
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.fieldtools.armeasure.R
import com.fieldtools.armeasure.data.MeasureRecord
import com.fieldtools.armeasure.data.RecordRepository
import com.fieldtools.armeasure.databinding.ActivityArMeasureBinding
import com.fieldtools.armeasure.util.Feedback
import com.fieldtools.armeasure.util.Prefs
import com.fieldtools.armeasure.util.Units
import com.google.ar.core.Anchor
import com.google.ar.core.ArCoreApk
import com.google.ar.core.Config
import com.google.ar.core.Frame
import com.google.ar.core.HitResult
import com.google.ar.core.DepthPoint
import com.google.ar.core.Plane
import com.google.ar.core.Session
import com.google.ar.core.TrackingFailureReason
import com.google.ar.core.TrackingState
import com.google.ar.core.exceptions.CameraNotAvailableException
import com.google.ar.core.exceptions.UnavailableApkTooOldException
import com.google.ar.core.exceptions.UnavailableArcoreNotInstalledException
import com.google.ar.core.exceptions.UnavailableDeviceNotCompatibleException
import com.google.ar.core.exceptions.UnavailableSdkTooOldException
import com.google.ar.core.exceptions.UnavailableUserDeclinedInstallationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.text.DateFormat
import java.util.Date
import java.util.concurrent.ConcurrentLinkedQueue
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * ARCore 기반 길이 측정.
 * - 화면 중앙 표적이 '추적 중인 평면' 위에 있을 때만 점을 찍을 수 있다(평면 미인식 시 측정값 미출력).
 * - 각 점은 ARCore Anchor로 고정되어 추적 보정에 따라 위치가 갱신된다.
 * - 모든 점은 같은 ARCore 월드 좌표계이며, 거리는 3차원 유클리드 거리로 계산한다.
 */
class ArMeasureActivity : AppCompatActivity(), GLSurfaceView.Renderer {

    private lateinit var b: ActivityArMeasureBinding
    private lateinit var prefs: Prefs
    private lateinit var feedback: Feedback
    private lateinit var repo: RecordRepository

    private var session: Session? = null
    private var installRequested = false
    private val background = BackgroundRenderer()
    private val shapes = ShapeRenderer()
    private var viewW = 1
    private var viewH = 1
    private var viewportChanged = false

    // GL 스레드 전용 상태
    private class MPoint(val anchor: Anchor, val pos: FloatArray)
    private val chains = mutableListOf(mutableListOf<MPoint>())
    private var lastHit: HitResult? = null
    private var lastHitPos: FloatArray? = null
    private var readyFrames = 0
    private var noHitFrames = 0
    @Volatile private var depthEnabled = false   // 깊이 인식(Depth API) 사용 여부
    private var hitOnSurface = false
    /** 측정 방식: dist = 직선거리, vert = 수직 높이, horiz = 수평 거리 (ARCore 월드 Y축 = 중력 반대 방향) */
    @Volatile private var mode = "dist"
    private val recentHits = ArrayDeque<FloatArray>()  // 최근 표적 위치(안정도 판정)
    private var prevCam: FloatArray? = null
    private var prevTs = 0L
    private var speed = 0f
    private val glTasks = ConcurrentLinkedQueue<() -> Unit>()
    @Volatile private var wantCapture = false

    private val proj = FloatArray(16)
    private val view = FloatArray(16)
    private val vp = FloatArray(16)

    // UI 스레드에서 쓰는 마지막 스냅샷
    @Volatile private var ready = false
    private var lastStatus = ""
    private var lastHint = ""
    private val labelPool = mutableListOf<TextView>()

    private val requestCamera = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) showError(
            "AR 길이 측정에는 카메라 권한이 필요합니다.\n권한을 허용하지 않으면 길이 측정을 사용할 수 없습니다. (수평기는 권한 없이 사용 가능)",
            "앱 설정 열기"
        ) { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null))) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityArMeasureBinding.inflate(layoutInflater)
        setContentView(b.root)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        prefs = Prefs(this)
        feedback = Feedback(this)
        repo = RecordRepository(this)

        b.surface.preserveEGLContextOnPause = true
        b.surface.setEGLContextClientVersion(2)
        b.surface.setEGLConfigChooser(8, 8, 8, 8, 16, 0)
        b.surface.setRenderer(this)
        b.surface.renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
        b.surface.setWillNotDraw(false)
        b.surface.setOnTouchListener { v, e ->
            if (e.action == MotionEvent.ACTION_UP) { v.performClick(); addPoint() }
            true
        }

        b.btnClose.setOnClickListener { finish() }
        b.btnErrorBack.setOnClickListener { finish() }
        b.btnAdd.setOnClickListener { addPoint() }
        b.btnUndo.setOnClickListener { glTasks.add { undoGl() } }
        b.btnNewSeg.setOnClickListener { glTasks.add { newChainGl() } }
        b.btnReset.setOnClickListener { glTasks.add { resetGl() } }
        mode = prefs.measureMode
        b.btnMode.text = modeLabel()
        b.btnMode.setOnClickListener {
            mode = when (mode) { "dist" -> "vert"; "vert" -> "horiz"; else -> "dist" }
            prefs.measureMode = mode
            b.btnMode.text = modeLabel()
            toast(when (mode) {
                "vert" -> "높이 모드: 두 점의 수직 높이만 잽니다 (바닥 점이 옆으로 벗어나도 OK)"
                "horiz" -> "수평 모드: 높이 차이를 빼고 바닥 기준 수평 거리만 잽니다"
                else -> "거리 모드: 두 점 사이 직선거리"
            })
        }
        b.btnUnit.setOnClickListener { prefs.unit = Units.next(prefs.unit); toast("단위: ${prefs.unit}") }
        b.btnSave.setOnClickListener { requestSave() }
    }

    override fun onResume() {
        super.onResume()
        if (session == null) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                requestCamera.launch(Manifest.permission.CAMERA)
                return
            }
            try {
                when (ArCoreApk.getInstance().requestInstall(this, !installRequested)) {
                    ArCoreApk.InstallStatus.INSTALL_REQUESTED -> { installRequested = true; return }
                    ArCoreApk.InstallStatus.INSTALLED -> Unit
                    else -> Unit
                }
                val s = Session(this)
                val config = Config(s).apply {
                    planeFindingMode = Config.PlaneFindingMode.HORIZONTAL_AND_VERTICAL
                    focusMode = Config.FocusMode.AUTO
                    updateMode = Config.UpdateMode.LATEST_CAMERA_IMAGE
                    lightEstimationMode = Config.LightEstimationMode.AMBIENT_INTENSITY
                    // 깊이 인식: 지원 기기 + 설정 ON이면 물체 윗면 등 실제 표면에 점을 찍는다
                    depthEnabled = prefs.useDepth && s.isDepthModeSupported(Config.DepthMode.AUTOMATIC)
                    depthMode = if (depthEnabled) Config.DepthMode.AUTOMATIC else Config.DepthMode.DISABLED
                }
                if (prefs.useDepth && !depthEnabled) toast("이 기기는 깊이 인식을 지원하지 않아 평면 기준으로 측정합니다.")
                s.configure(config)
                session = s
            } catch (e: UnavailableUserDeclinedInstallationException) {
                showError("AR 측정을 사용하려면 'Google Play 서비스 AR(ARCore)' 설치가 필요합니다.", "다시 시도") { recreate() }; return
            } catch (e: UnavailableArcoreNotInstalledException) {
                showError("'Google Play 서비스 AR(ARCore)'이 설치되어 있지 않습니다. Play 스토어에서 설치한 뒤 다시 시도하세요.", "Play 스토어 열기") { openArcoreStore() }; return
            } catch (e: UnavailableApkTooOldException) {
                showError("'Google Play 서비스 AR(ARCore)'이 오래되었습니다. Play 스토어에서 업데이트해 주세요.", "Play 스토어 열기") { openArcoreStore() }; return
            } catch (e: UnavailableSdkTooOldException) {
                showError("이 앱의 AR 라이브러리가 오래되었습니다. 앱을 최신 버전으로 업데이트해 주세요.", null, null); return
            } catch (e: UnavailableDeviceNotCompatibleException) {
                showError("이 기기는 ARCore를 지원하지 않아 AR 길이 측정을 사용할 수 없습니다.\n디지털 수평기와 측정 기록 기능은 정상적으로 사용할 수 있습니다.", null, null); return
            } catch (e: Exception) {
                showError("AR을 시작하지 못했습니다: ${e.message}", "다시 시도") { recreate() }; return
            }
        }
        try {
            session?.resume()
        } catch (e: CameraNotAvailableException) {
            session = null
            showError("카메라를 열 수 없습니다. 다른 앱이 카메라를 사용 중인지 확인한 뒤 다시 시도하세요.", "다시 시도") { recreate() }
            return
        } catch (e: Exception) {
            showError("AR 세션을 재개하지 못했습니다: ${e.message}", "다시 시도") { recreate() }
            return
        }
        b.surface.onResume()
    }

    override fun onPause() {
        super.onPause()
        b.surface.onPause()
        session?.pause()
    }

    override fun onDestroy() {
        session?.close()
        session = null
        feedback.release()
        super.onDestroy()
    }

    private fun openArcoreStore() {
        try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.google.ar.core"))) }
        catch (_: Exception) { toast("Play 스토어를 열 수 없습니다.") }
    }

    private fun showError(msg: String, action: String?, onAction: (() -> Unit)?) {
        runOnUiThread {
            b.errorPanel.visibility = View.VISIBLE
            b.errorText.text = msg
            if (action != null && onAction != null) {
                b.btnErrorAction.visibility = View.VISIBLE
                b.btnErrorAction.text = action
                b.btnErrorAction.setOnClickListener { onAction() }
            } else b.btnErrorAction.visibility = View.GONE
        }
    }

    // ---------------- GLSurfaceView.Renderer ----------------
    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        GLES20.glClearColor(0f, 0f, 0f, 1f)
        try {
            background.createOnGlThread()
            shapes.createOnGlThread()
        } catch (e: Exception) {
            showError("그래픽 초기화 실패: ${e.message}", null, null)
        }
    }

    override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
        viewW = width; viewH = height
        GLES20.glViewport(0, 0, width, height)
        viewportChanged = true
    }

    @Suppress("DEPRECATION")
    private fun displayRotation(): Int = windowManager.defaultDisplay.rotation

    override fun onDrawFrame(gl: GL10?) {
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)
        val s = session ?: return
        if (viewportChanged) { s.setDisplayGeometry(displayRotation(), viewW, viewH); viewportChanged = false }
        if (background.textureId < 0) return
        s.setCameraTextureName(background.textureId)
        val frame: Frame = try { s.update() } catch (e: CameraNotAvailableException) {
            showError("카메라 연결이 끊겼습니다. 다시 시도해 주세요.", "다시 시도") { recreate() }; return
        } catch (e: Exception) { return }

        // UI에서 요청한 작업(되돌리기 등)을 GL 스레드에서 처리
        while (true) { val t = glTasks.poll() ?: break; t() }

        background.draw(frame)
        val camera = frame.camera

        // 1) 추적 상태
        if (camera.trackingState != TrackingState.TRACKING) {
            ready = false; readyFrames = 0; lastHit = null; lastHitPos = null
            val reason = when (camera.trackingFailureReason) {
                TrackingFailureReason.INSUFFICIENT_LIGHT -> "조명이 너무 어둡습니다 — 밝은 곳에서 측정하세요"
                TrackingFailureReason.EXCESSIVE_MOTION -> "카메라가 너무 빠르게 움직입니다 — 천천히 움직이세요"
                TrackingFailureReason.INSUFFICIENT_FEATURES -> "표면 특징점이 부족합니다 — 무늬가 있는 표면을 비추세요"
                TrackingFailureReason.CAMERA_UNAVAILABLE -> "카메라를 사용할 수 없습니다"
                TrackingFailureReason.BAD_STATE -> "AR 추적 오류 — 앱을 다시 시작해 주세요"
                else -> if (camera.trackingState == TrackingState.PAUSED) "공간 인식 중… 휴대폰을 천천히 좌우로 움직이세요" else "추적이 중지되었습니다"
            }
            postStatus(reason, false, "")
            postOverlay(emptyList(), null)
            return
        }

        camera.getProjectionMatrix(proj, 0, 0.01f, 50f)
        camera.getViewMatrix(view, 0)
        GLMatrix.multiplyMM(vp, 0, proj, 0, view, 0)

        // 2) 흔들림 감지
        val cp = camera.pose.translation
        val ts = frame.timestamp
        prevCam?.let { pc ->
            val dt = ((ts - prevTs) / 1e9f).coerceAtLeast(1e-3f)
            val v = dist(pc, cp) / dt
            speed = speed * 0.85f + v * 0.15f
        }
        prevCam = cp; prevTs = ts

        // 3) 앵커 위치 갱신
        for (c in chains) for (p in c) {
            if (p.anchor.trackingState == TrackingState.TRACKING) {
                val t = p.anchor.pose.translation
                p.pos[0] = t[0]; p.pos[1] = t[1]; p.pos[2] = t[2]
            }
        }

        // 4) 화면 중앙 hit-test
        //  - 평면: 추적 중 + 다른 평면에 병합되지 않음 + 다각형 내부
        //  - 깊이(표면): 같은 시선에 평면이 있고, 그 평면보다 0~1 m 앞(=물체 윗면)일 때만 채택.
        //    무늬 없는 바닥 등에서 깊이 값이 카메라 바로 앞으로 튀는 오류를 걸러낸다.
        //  - 카메라 20 cm 이내 결과는 버림
        var planeHit: HitResult? = null
        var depthHit: HitResult? = null
        for (h in frame.hitTest(viewW / 2f, viewH / 2f)) {
            if (h.distance < MIN_HIT_DIST) continue
            val tr = h.trackable
            if (planeHit == null && tr is Plane && tr.trackingState == TrackingState.TRACKING && tr.subsumedBy == null && tr.isPoseInPolygon(h.hitPose)) planeHit = h
            if (depthEnabled && depthHit == null && tr is DepthPoint && tr.trackingState == TrackingState.TRACKING) depthHit = h
        }
        val ph = planeHit; val dh = depthHit
        val hit: HitResult? = if (ph != null && dh != null && (ph.distance - dh.distance) in -0.03f..1.0f) dh else ph
        if (hit != null) {
            val t = hit.hitPose.translation
            recentHits.addLast(t); if (recentHits.size > STABLE_N) recentHits.removeFirst()
            lastHit = hit; lastHitPos = t
            readyFrames++; noHitFrames = 0
        } else {
            recentHits.clear()
            lastHit = null; lastHitPos = null; readyFrames = 0; noHitFrames++
        }
        // 최근 위치가 2 cm 이내로 모여 있어야(표적이 안정) 측정 허용
        val spread = if (recentHits.size < STABLE_N) Float.MAX_VALUE else {
            val m = FloatArray(3); recentHits.forEach { for (i in 0..2) m[i] += it[i] / recentHits.size }
            recentHits.maxOf { dist(it, m) }
        }
        ready = readyFrames >= READY_FRAMES && spread < 0.02f
        hitOnSurface = hit?.trackable is DepthPoint

        // 5) 그리기: 측정선, 점, 진행 중 미리보기선, 레티클
        val segs = segmentsGl()
        if (segs.isNotEmpty()) {
            val lines = FloatArray(segs.size * 6)
            segs.forEachIndexed { i, sg -> System.arraycopy(sg.a, 0, lines, i * 6, 3); System.arraycopy(sg.b, 0, lines, i * 6 + 3, 3) }
            shapes.draw(vp, lines, GLES20.GL_LINES, floatArrayOf(0f, 0f, 0f, 0.45f), 12f)
            shapes.draw(vp, lines, GLES20.GL_LINES, WHITE, 6f)
        }
        val chain = chains.last()
        val last = chain.lastOrNull()
        val hp = lastHitPos
        if (last != null && hp != null) shapes.draw(vp, last.pos + hp, GLES20.GL_LINES, ACCENT, 5f)
        if (mode != "dist") {
            // 높이/수평 모드: 높은 점에서 수직으로 내린 선 + 수평선(직각 보조선)
            val pairs = segs.map { it.a to it.b } + (if (last != null && hp != null) listOf(last.pos to hp) else emptyList())
            val guide = FloatArray(pairs.size * 12)
            pairs.forEachIndexed { i, (p, q) ->
                val hi = if (p[1] >= q[1]) p else q; val lo = if (hi === p) q else p
                val corner = floatArrayOf(hi[0], lo[1], hi[2])
                System.arraycopy(hi, 0, guide, i * 12, 3); System.arraycopy(corner, 0, guide, i * 12 + 3, 3)
                System.arraycopy(corner, 0, guide, i * 12 + 6, 3); System.arraycopy(lo, 0, guide, i * 12 + 9, 3)
            }
            if (guide.isNotEmpty()) shapes.draw(vp, guide, GLES20.GL_LINES, OK, 4f)
        }
        val pts = chains.flatten()
        if (pts.isNotEmpty()) {
            val arr = FloatArray(pts.size * 3)
            pts.forEachIndexed { i, p -> System.arraycopy(p.pos, 0, arr, i * 3, 3) }
            shapes.draw(vp, arr, GLES20.GL_POINTS, ACCENT, 30f)
        }
        val h = lastHit
        if (h != null) {
            val ring = FloatArray(RING * 3)
            val pose = h.hitPose
            for (i in 0 until RING) {
                val a = (i.toFloat() / RING) * 2f * Math.PI.toFloat()
                val w = pose.transformPoint(floatArrayOf(cos(a) * 0.04f, 0f, sin(a) * 0.04f))
                System.arraycopy(w, 0, ring, i * 3, 3)
            }
            shapes.draw(vp, ring, GLES20.GL_LINE_LOOP, if (ready) OK else WHITE, 5f)
        }

        // 6) 상태/안내
        val status = when {
            hit == null && pts.isNotEmpty() -> "표적이 평면을 벗어났습니다 — 측정할 표면을 비추세요"
            hit == null -> "평면을 찾는 중… 휴대폰을 천천히 좌우로 움직이세요"
            !ready -> "평면 인식 중… 잠시 유지하세요"
            chain.isEmpty() -> "시작점에 표적을 맞추고 탭하세요"
            else -> "종료점에 표적을 맞추고 탭하세요"
        } + if (hit != null && ready) (if (hitOnSurface) " · 표면" else " · 평면") else ""
        val camToHit = if (hp != null) dist(cp, hp) else 0f
        val light = frame.lightEstimate
        val dark = light.state == com.google.ar.core.LightEstimate.State.VALID && light.pixelIntensity < 0.12f
        val hint = when {
            speed > 0.6f -> "카메라가 흔들립니다 — 천천히 움직이세요"
            camToHit > FAR_WARN_M -> "측정점이 %.1fm 떨어져 있어 오차가 커질 수 있습니다. 가까이 가세요".format(camToHit)
            dark -> "조명이 어둡습니다 — 인식이 불안정할 수 있습니다"
            noHitFrames > 300 -> "평면을 찾지 못하고 있습니다 — 무늬 없는 흰 벽·유리·반사면은 인식이 어렵습니다"
            else -> ""
        }
        postStatus(status, ready, hint)

        // 7) 라벨(화면 좌표) 계산
        val labels = mutableListOf<Label>()
        val unit = prefs.unit; val dec = prefs.decimals
        for (sg in segs) {
            val mid = floatArrayOf((sg.a[0] + sg.b[0]) / 2, (sg.a[1] + sg.b[1]) / 2, (sg.a[2] + sg.b[2]) / 2)
            project(mid)?.let { labels += Label(it[0], it[1], Units.format(sg.len.toDouble(), unit, dec), false) }
        }
        var liveText: String? = null
        if (last != null && hp != null) {
            val d = valueOf(last.pos, hp)
            val dyM = vertOf(last.pos, hp)
            liveText = when (mode) {
                "dist" -> Units.format(d.toDouble(), unit, dec) + if (dyM >= 0.05f) " (높이차 ${Units.format(dyM.toDouble(), unit, 0)})" else ""
                else -> "${modeLabel()} " + Units.format(d.toDouble(), unit, dec)
            }
            if (dist(last.pos, hp) >= 0.005f) project(floatArrayOf((last.pos[0] + hp[0]) / 2, (last.pos[1] + hp[1]) / 2, (last.pos[2] + hp[2]) / 2))?.let {
                labels += Label(it[0], it[1], liveText, true)
            }
        } else if (last != null) liveText = "표적을 평면에 맞추세요"
        postOverlay(labels, liveText)

        // 8) 사진 캡처(카메라 영상 + 측정선 포함 프레임버퍼)
        if (wantCapture) {
            wantCapture = false
            val bmp = readPixels()
            val snapshot = segs.map { it.copy() }
            runOnUiThread { finishSave(bmp, snapshot, labels.filter { !it.live }) }
        }
    }

    // ---------------- 측정 로직 (GL 스레드) ----------------
    data class Seg(val chain: Int, val a: FloatArray, val b: FloatArray, val len: Float, val d3: Float, val vert: Float, val horiz: Float)

    private fun vertOf(a: FloatArray, b: FloatArray) = kotlin.math.abs(a[1] - b[1])
    private fun horizOf(a: FloatArray, b: FloatArray) = kotlin.math.hypot(a[0] - b[0], a[2] - b[2])
    private fun valueOf(a: FloatArray, b: FloatArray) = when (mode) { "vert" -> vertOf(a, b); "horiz" -> horizOf(a, b); else -> dist(a, b) }
    private fun modeLabel(m: String = mode) = when (m) { "vert" -> "높이"; "horiz" -> "수평"; else -> "거리" }
    data class Label(val x: Float, val y: Float, val text: String, val live: Boolean)

    private fun segmentsGl(): List<Seg> {
        val out = mutableListOf<Seg>()
        chains.forEachIndexed { ci, c ->
            for (i in 1 until c.size) {
                val a = c[i - 1].pos.copyOf(); val b = c[i].pos.copyOf()
                out += Seg(ci, a, b, valueOf(a, b), dist(a, b), vertOf(a, b), horizOf(a, b))
            }
        }
        return out
    }

    private fun addPoint() {
        glTasks.add {
            val h = lastHit
            if (!ready || h == null) {
                runOnUiThread { toast("아직 평면이 인식되지 않아 점을 찍을 수 없습니다. 표적이 초록색이 될 때까지 기다려 주세요.") }
                return@add
            }
            val anchor = try { h.createAnchor() } catch (e: Exception) {
                runOnUiThread { toast("측정점을 고정하지 못했습니다. 다시 시도하세요.") }; return@add
            }
            chains.last().add(MPoint(anchor, anchor.pose.translation))
            runOnUiThread { feedback.vibrate(15) }
        }
    }

    private fun undoGl() {
        if (chains.last().isEmpty() && chains.size > 1) chains.removeAt(chains.size - 1)
        val c = chains.last()
        if (c.isNotEmpty()) c.removeAt(c.size - 1).anchor.detach()
    }

    private fun newChainGl() {
        if (chains.last().size < 2) { runOnUiThread { toast("현재 구간에 두 점 이상 찍은 뒤 새 구간을 시작할 수 있습니다.") }; return }
        chains.add(mutableListOf())
        runOnUiThread { toast("새 구간을 시작합니다. 다음 탭이 새 시작점입니다.") }
    }

    private fun resetGl() {
        for (c in chains) for (p in c) p.anchor.detach()
        chains.clear(); chains.add(mutableListOf())
    }

    private fun project(p: FloatArray): FloatArray? {
        val v = floatArrayOf(p[0], p[1], p[2], 1f)
        val o = FloatArray(4)
        GLMatrix.multiplyMV(o, 0, vp, 0, v, 0)
        if (o[3] <= 0f) return null
        val x = (o[0] / o[3] + 1f) / 2f * viewW
        val y = (1f - o[1] / o[3]) / 2f * viewH
        return floatArrayOf(x, y)
    }

    private fun readPixels(): Bitmap? = try {
        val buf = ByteBuffer.allocateDirect(viewW * viewH * 4).order(ByteOrder.nativeOrder())
        GLES20.glReadPixels(0, 0, viewW, viewH, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, buf)
        buf.rewind()
        val bmp = Bitmap.createBitmap(viewW, viewH, Bitmap.Config.ARGB_8888)
        bmp.copyPixelsFromBuffer(buf)
        val flip = Matrix().apply { preScale(1f, -1f) }
        Bitmap.createBitmap(bmp, 0, 0, viewW, viewH, flip, false).also { bmp.recycle() }
    } catch (e: Throwable) { null }

    // ---------------- UI 갱신 ----------------
    private var lastTotalsText = ""
    private fun postStatus(status: String, ok: Boolean, hint: String) {
        if (status == lastStatus && hint == lastHint) return
        lastStatus = status; lastHint = hint
        runOnUiThread {
            b.status.text = status
            b.status.setBackgroundColor(if (ok) 0xBF0E7850.toInt() else 0x8C000000.toInt())
            b.crosshair.setImageResource(if (ok) R.drawable.crosshair_ready else R.drawable.crosshair)
            b.btnAdd.isEnabled = ok
            b.btnAdd.alpha = if (ok) 1f else 0.4f
            b.hint.text = hint
            b.hint.visibility = if (hint.isEmpty()) View.GONE else View.VISIBLE
        }
    }

    private var frameCounter = 0
    private fun postOverlay(labels: List<Label>, liveText: String?) {
        if (frameCounter++ % 2 != 0) return  // UI 부하 감소(30fps)
        val segs = segmentsGl()
        val unit = prefs.unit; val dec = prefs.decimals
        val total = segs.sumOf { it.len.toDouble() }
        val totals = (if (mode != "dist") "[${modeLabel()} 모드] " else "") + if (segs.isEmpty()) "" else "마지막 ${Units.format(segs.last().len.toDouble(), unit, dec)} · ${segs.size}개 구간 · 합계 ${Units.format(total, unit, dec)}"
        val big = liveText ?: if (segs.isEmpty()) "-" else Units.format(total, unit, dec)
        runOnUiThread {
            if (b.live.text.toString() != big) b.live.text = big
            if (totals != lastTotalsText) { b.total.text = totals; lastTotalsText = totals }
            while (labelPool.size < labels.size) {
                val tv = TextView(this).apply {
                    setBackgroundResource(R.drawable.bg_ar_label)
                    setTextColor(Color.parseColor("#0B0F14"))
                    typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
                    setPadding(16, 6, 16, 6)
                    gravity = Gravity.CENTER
                }
                b.labels.addView(tv, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT))
                labelPool += tv
            }
            labelPool.forEachIndexed { i, tv ->
                if (i < labels.size) {
                    val l = labels[i]
                    tv.visibility = View.VISIBLE
                    if (tv.text.toString() != l.text) tv.text = l.text
                    tv.backgroundTintList = if (l.live) android.content.res.ColorStateList.valueOf(ContextCompat.getColor(this, R.color.accent)) else null
                    tv.translationX = l.x - tv.width / 2f
                    tv.translationY = l.y - tv.height / 2f
                } else tv.visibility = View.GONE
            }
        }
    }

    // ---------------- 저장 ----------------
    private fun requestSave() {
        glTasks.add {
            val segs = segmentsGl()
            if (segs.isEmpty()) { runOnUiThread { toast("저장할 측정 구간이 없습니다. 두 점 이상 찍어 주세요.") }; return@add }
            if (prefs.savePhoto) {
                wantCapture = true
            } else {
                runOnUiThread { finishSave(null, segs, emptyList()) }
            }
            Unit
        }
    }

    private fun finishSave(bitmap: Bitmap?, segs: List<Seg>, labels: List<Label>) {
        val unit = prefs.unit; val dec = prefs.decimals
        val total = segs.sumOf { it.len.toDouble() }
        val arr = JSONArray()
        segs.forEach { sg ->
            arr.put(JSONObject().apply {
                put("chain", sg.chain); put("lengthM", sg.len.toDouble())
                put("dist3dM", sg.d3.toDouble()); put("verticalM", sg.vert.toDouble()); put("horizontalM", sg.horiz.toDouble())
                put("a", JSONArray(sg.a.map { it.toDouble() })); put("b", JSONArray(sg.b.map { it.toDouble() }))
            })
        }
        val detail = JSONObject().apply { put("segments", arr); put("mode", mode); put("modeLabel", modeLabel()); put("anchors", true); put("depth", depthEnabled); put("platform", "android-arcore") }
        lifecycleScope.launch {
            var photoPath: String? = null
            if (bitmap != null) {
                photoPath = withContext(Dispatchers.IO) {
                    try {
                        annotate(bitmap, labels, segs.size, total, unit, dec)
                        val dir = File(filesDir, "photos").apply { mkdirs() }
                        val f = File(dir, "measure_${System.currentTimeMillis()}.jpg")
                        FileOutputStream(f).use { bitmap.compress(Bitmap.CompressFormat.JPEG, 88, it) }
                        f.absolutePath
                    } catch (e: Exception) { null } finally { bitmap.recycle() }
                }
                if (photoPath == null) toast("저장 공간 부족 등으로 사진은 저장하지 못했습니다.")
            }
            val rec = MeasureRecord(type = MeasureRecord.TYPE_LENGTH, createdAt = System.currentTimeMillis(),
                value = total, unit = unit, detailJson = detail.toString(), photoPath = photoPath)
            try {
                repo.add(rec)
                feedback.vibrate(30)
                toast("저장했습니다 (${segs.size}개 구간${if (photoPath != null) ", 사진 포함" else ""})")
            } catch (e: Exception) {
                photoPath?.let { File(it).delete() }
                toast(e.message ?: "저장 실패")
            }
        }
    }

    /** 캡처 이미지에 측정값 라벨과 정보 띠를 그려 넣는다 */
    private fun annotate(bmp: Bitmap, labels: List<Label>, n: Int, total: Double, unit: String, dec: Int) {
        val c = Canvas(bmp)
        val scale = bmp.width / 720f
        val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(242, 255, 255, 255) }
        val tp = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#0B0F14"); textSize = 30f * scale
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD); textAlign = Paint.Align.CENTER
        }
        for (l in labels) {
            val w = tp.measureText(l.text) + 24 * scale
            val h = 44 * scale
            c.drawRoundRect(RectF(l.x - w / 2, l.y - h / 2, l.x + w / 2, l.y + h / 2), 10 * scale, 10 * scale, bg)
            c.drawText(l.text, l.x, l.y + tp.textSize / 3, tp)
        }
        val band = 64 * scale
        c.drawRect(0f, bmp.height - band, bmp.width.toFloat(), bmp.height.toFloat(), Paint().apply { color = Color.argb(160, 0, 0, 0) })
        val ip = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textSize = 24f * scale }
        c.drawText("${DateFormat.getDateTimeInstance().format(Date())} · ${n}개 구간 · 합계 ${Units.format(total, unit, dec)}",
            18 * scale, bmp.height - band / 2 + ip.textSize / 3, ip)
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

    companion object {
        private const val READY_FRAMES = 15
        private const val STABLE_N = 8
        private const val MIN_HIT_DIST = 0.2f
        private const val FAR_WARN_M = 3.0f
        private const val RING = 40
        private val WHITE = floatArrayOf(1f, 1f, 1f, 1f)
        private val ACCENT = floatArrayOf(0.2f, 0.82f, 1f, 1f)
        private val OK = floatArrayOf(0.18f, 0.9f, 0.62f, 1f)

        fun dist(a: FloatArray, b: FloatArray): Float {
            val dx = a[0] - b[0]; val dy = a[1] - b[1]; val dz = a[2] - b[2]
            return sqrt(dx * dx + dy * dy + dz * dz)
        }
    }
}
