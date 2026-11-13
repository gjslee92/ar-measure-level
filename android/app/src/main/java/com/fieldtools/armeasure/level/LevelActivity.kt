package com.fieldtools.armeasure.level

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.fieldtools.armeasure.R
import com.fieldtools.armeasure.data.MeasureRecord
import com.fieldtools.armeasure.data.RecordRepository
import com.fieldtools.armeasure.databinding.ActivityLevelBinding
import com.fieldtools.armeasure.util.Feedback
import com.fieldtools.armeasure.util.Prefs
import com.fieldtools.armeasure.util.Units
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max

/**
 * 디지털 수평기: 중력 센서(TYPE_GRAVITY, 가속도+자이로 융합) 우선 사용,
 * 없으면 가속도계(TYPE_ACCELEROMETER)에 저역통과 필터 적용.
 */
class LevelActivity : AppCompatActivity(), SensorEventListener {
    private lateinit var b: ActivityLevelBinding
    private lateinit var prefs: Prefs
    private lateinit var feedback: Feedback
    private lateinit var repo: RecordRepository
    private var sensorManager: SensorManager? = null
    private var sensor: Sensor? = null
    private var usingGravity = false

    private val filter = VectorFilter(0.15)
    private val stability = StabilityMeter(30)
    private var rawUp: DoubleArray? = null
    private var lastEventAt = 0L
    private var startedAt = 0L
    private var autoMode: String? = null
    private var prevState: String? = null
    private var current: Reading? = null
    private var locked: Reading? = null

    data class Reading(
        val mode: String, val a: Double, val b: Double, val rawA: Double, val rawB: Double,
        val total: Double, val rotation: Double, val k: Int, val vertical: Boolean,
        val state: String, val stable: Boolean, val labelA: String, val labelB: String, val dirA: String, val dirB: String
    )

    private val ui = Handler(Looper.getMainLooper())
    private val frame = object : Runnable {
        override fun run() {
            tick()
            ui.postDelayed(this, 33)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityLevelBinding.inflate(layoutInflater)
        setContentView(b.root)
        prefs = Prefs(this)
        feedback = Feedback(this)
        repo = RecordRepository(this)
        b.toolbar.setNavigationOnClickListener { finish() }

        b.cellRot.label.text = "회전각"
        when (prefs.levelMode) { "flat" -> b.modeGroup.check(R.id.modeFlat); "edge" -> b.modeGroup.check(R.id.modeEdge); else -> b.modeGroup.check(R.id.modeAuto) }
        b.modeGroup.addOnButtonCheckedListener { _, id, checked ->
            if (!checked) return@addOnButtonCheckedListener
            prefs.levelMode = when (id) { R.id.modeFlat -> "flat"; R.id.modeEdge -> "edge"; else -> "auto" }
            autoMode = null
        }
        b.btnZero.setOnClickListener { zero() }
        b.btnCalib2.setOnClickListener { calibTwoStep() }
        b.btnResetCalib.setOnClickListener { prefs.resetCalibration(); updateCalibLine(); toast("보정값을 초기화했습니다.") }
        b.btnLock.setOnClickListener { toggleLock() }
        b.btnSave.setOnClickListener { save() }

        sensorManager = getSystemService(Context.SENSOR_SERVICE) as? SensorManager
        sensor = sensorManager?.getDefaultSensor(Sensor.TYPE_GRAVITY)
        usingGravity = sensor != null
        if (sensor == null) sensor = sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        val gyro = sensorManager?.getDefaultSensor(Sensor.TYPE_GYROSCOPE) != null
        b.sensorInfo.text = when {
            sensor == null -> ""
            usingGravity -> "센서: 중력(가속도계${if (gyro) "+자이로스코프" else ""} 융합) · ${sensor?.name}"
            else -> "센서: 가속도계 + 저역통과 필터 · ${sensor?.name}"
        }
        updateCalibLine()
    }

    override fun onResume() {
        super.onResume()
        filter.alpha = LevelMath.alpha(prefs.smoothing)
        filter.reset(); stability.reset(); rawUp = null
        val s = sensor
        if (s == null || sensorManager == null) {
            showError("이 기기에서 기울기 센서(가속도계)를 찾을 수 없어 수평기를 사용할 수 없습니다.")
            return
        }
        val ok = sensorManager!!.registerListener(this, s, SensorManager.SENSOR_DELAY_GAME)
        if (!ok) { showError("센서를 시작하지 못했습니다. 기기를 재시작한 뒤 다시 시도해 주세요."); return }
        startedAt = SystemClock.elapsedRealtime()
        lastEventAt = 0L
        ui.post(frame)
    }

    override fun onPause() {
        super.onPause()
        sensorManager?.unregisterListener(this)
        ui.removeCallbacks(frame)
    }

    override fun onDestroy() {
        feedback.release()
        super.onDestroy()
    }

    override fun onSensorChanged(e: SensorEvent) {
        rawUp = LevelMath.normalize(doubleArrayOf(e.values[0].toDouble(), e.values[1].toDouble(), e.values[2].toDouble()))
        lastEventAt = SystemClock.elapsedRealtime()
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        if (accuracy == SensorManager.SENSOR_STATUS_UNRELIABLE) toast("센서 정확도가 낮습니다. 기기를 8자 모양으로 움직인 뒤 다시 측정해 보세요.")
    }

    private fun showError(msg: String) {
        b.sensorError.text = msg
        b.sensorError.visibility = View.VISIBLE
        b.stateChip.text = "측정 불가"
        b.bigAngle.text = "--.-°"
    }

    private fun tick() {
        val now = SystemClock.elapsedRealtime()
        if (lastEventAt == 0L) {
            if (now - startedAt > 2500) showError("센서 데이터를 받지 못했습니다. 다른 앱이 센서를 점유 중이거나 기기 센서에 문제가 있을 수 있습니다.")
            return
        }
        if (now - lastEventAt > 3000) {
            b.stateChip.text = "센서 수신 중단 — 재연결 대기"
            return
        }
        b.sensorError.visibility = View.GONE
        val raw = rawUp ?: return
        val u = filter.push(raw)
        compute(u)
        render()
    }

    private fun compute(u: DoubleArray) {
        var mode = prefs.levelMode
        if (mode == "auto") { autoMode = LevelMath.pickMode(u, autoMode); mode = autoMode!! }
        val t1 = prefs.t1.toDouble(); val t2 = prefs.t2.toDouble()
        val r: Reading = if (mode == "flat") {
            val f = LevelMath.flat(u)
            val x = f.x - prefs.calibFlatX; val y = f.y - prefs.calibFlatY
            val primary = max(abs(x), abs(y))
            val st = LevelMath.judge(primary, t1, t2)
            Reading("flat", x, y, f.x, f.y, hypot(x, y), LevelMath.lowDirection(x, y), 0, false, st, false,
                "좌우", "전후",
                if (abs(x) < 0.05) "수평" else if (x > 0) "오른쪽이 낮음" else "왼쪽이 낮음",
                if (abs(y) < 0.05) "수평" else if (y > 0) "아래쪽(앞)이 낮음" else "위쪽(뒤)이 낮음")
        } else {
            val e = LevelMath.edge(u, prefs.calibEdge.toDouble())
            val raw = LevelMath.edge(u, 0.0)
            val st = LevelMath.judge(abs(e.dev), t1, t2)
            Reading("edge", e.dev, e.outOfPlane, LevelMath.wrap180(raw.rot - e.k * 90.0), 0.0, abs(e.dev), e.rot, e.k, e.vertical, st, false,
                if (e.vertical) "수직 오차" else "수평 오차", "앞뒤 기울기",
                if (abs(e.dev) < 0.05) (if (e.vertical) "수직" else "수평")
                else if (e.vertical) (if (e.dev > 0) "위쪽이 오른쪽으로" else "위쪽이 왼쪽으로")
                else (if (e.dev > 0) "오른쪽이 낮음" else "왼쪽이 낮음"),
                if (abs(e.outOfPlane) < 0.5) "" else if (e.outOfPlane > 0) "화면이 위로 기움" else "화면이 아래로 기움")
        }
        stability.push(r.a)
        val withStable = r.copy(stable = stability.std() < 0.08)
        current = withStable
        if (withStable.state == "ok" && prevState != null && prevState != "ok") {
            if (prefs.vibrate) feedback.vibrate(40)
            if (prefs.sound) feedback.beep()
        }
        prevState = withStable.state
    }

    private fun render() {
        val r = current ?: return
        b.levelView.update(r.mode, r.a, r.b, r.k, r.state)
        b.cellA.label.text = r.labelA; b.cellA.value.text = Units.angle(abs(r.a)); b.cellA.dir.text = r.dirA
        b.cellB.label.text = r.labelB; b.cellB.value.text = Units.angle(abs(r.b)); b.cellB.dir.text = r.dirB
        b.cellRot.label.text = if (r.mode == "flat") "낮은 쪽 방향" else "회전각"
        b.cellRot.value.text = Units.angle(r.rotation); b.cellRot.dir.text = "0~360°"
        b.bigAngle.text = Units.angle(if (r.mode == "flat") r.total else abs(r.a))
        val color = ContextCompat.getColor(this, when (r.state) { "ok" -> R.color.ok; "near" -> R.color.near; else -> R.color.bad })
        b.stateChip.setTextColor(color)
        val modeLabel = if (r.mode == "flat") "평면" else if (r.vertical) "수직" else "수평"
        b.stateChip.text = "$modeLabel · ${LevelMath.STATE_LABEL[r.state]}${if (r.stable) "" else " (흔들림)"}"
        val l = locked
        if (l != null) {
            b.lockLine.visibility = View.VISIBLE
            b.lockLine.text = when {
                l.mode == "flat" && r.mode == "flat" ->
                    "고정 기준 좌우 ${Units.angle(l.a)} · 전후 ${Units.angle(l.b)}\n차이 좌우 ${Units.angle(r.a - l.a)} · 전후 ${Units.angle(r.b - l.b)}"
                l.mode == "edge" && r.mode == "edge" ->
                    "고정 기준 회전각 ${Units.angle(l.rotation)} · 차이 ${Units.angle(LevelMath.wrap180(r.rotation - l.rotation))}"
                else -> "고정 기준과 모드가 달라 비교할 수 없습니다"
            }
        } else b.lockLine.visibility = View.GONE
    }

    private fun updateCalibLine() {
        b.calibLine.text = if (prefs.calibAt > 0)
            "보정 적용됨 (${DateFormat.getDateTimeInstance().format(Date(prefs.calibAt))}, ${if (prefs.calibMethod == "two-step") "정밀 2단계" else "영점"}) · 평면 X ${"%.2f".format(prefs.calibFlatX)}° Y ${"%.2f".format(prefs.calibFlatY)}° / 세움 ${"%.2f".format(prefs.calibEdge)}°"
        else "보정값 없음 (기본값)"
    }

    private fun requireReading(): Reading? {
        val r = current
        if (r == null) { toast("센서 값이 아직 없습니다."); return null }
        if (!r.stable) { toast("기기를 움직이지 말고 안정된 뒤 다시 눌러 주세요."); return null }
        return r
    }

    private fun zero() {
        val r = requireReading() ?: return
        if (r.mode == "flat") {
            if (abs(r.rawA) > 15 || abs(r.rawB) > 15) { toast("기울기가 15°를 넘어 영점으로 설정할 수 없습니다."); return }
            prefs.calibFlatX = r.rawA.toFloat(); prefs.calibFlatY = r.rawB.toFloat()
        } else {
            if (abs(r.rawA) > 15) { toast("기울기가 15°를 넘어 영점으로 설정할 수 없습니다."); return }
            prefs.calibEdge = r.rawA.toFloat()
        }
        prefs.calibAt = System.currentTimeMillis(); prefs.calibMethod = "zero"
        updateCalibLine()
        feedback.vibrate(40)
        toast("영점 보정 완료: 현재 위치가 0°로 설정되었습니다.")
    }

    private fun calibTwoStep() {
        MaterialAlertDialogBuilder(this)
            .setTitle("정밀 보정 (2단계)")
            .setMessage("센서 자체 오차를 상쇄합니다.\n\n1) 평평한 곳에 기기를 놓고 [측정 1]\n2) 같은 자리에서 180° 돌려 놓고 [측정 2]\n\n· 평면: 화면이 위를 향한 채 수평 회전\n· 세움: 같은 모서리를 바닥에 댄 채 화면이 반대쪽을 보도록 뒤집기")
            .setNegativeButton("취소", null)
            .setPositiveButton("측정 1") { _, _ ->
                val first = requireReading() ?: return@setPositiveButton
                MaterialAlertDialogBuilder(this)
                    .setMessage("기기를 180° 돌려 같은 자리에 놓고, 움직임이 멈추면 [측정 2]를 누르세요.")
                    .setNegativeButton("취소", null)
                    .setPositiveButton("측정 2") { _, _ ->
                        val second = requireReading() ?: return@setPositiveButton
                        if (first.mode != second.mode) { toast("두 측정의 모드가 다릅니다. 다시 시도하세요."); return@setPositiveButton }
                        if (first.mode == "flat") {
                            prefs.calibFlatX = ((first.rawA + second.rawA) / 2).toFloat()
                            prefs.calibFlatY = ((first.rawB + second.rawB) / 2).toFloat()
                        } else {
                            prefs.calibEdge = ((first.rawA + second.rawA) / 2).toFloat()
                        }
                        prefs.calibAt = System.currentTimeMillis(); prefs.calibMethod = "two-step"
                        updateCalibLine(); feedback.vibrate(40); toast("정밀 보정 완료")
                    }.show()
            }.show()
    }

    private fun toggleLock() {
        if (locked != null) { locked = null; b.btnLock.text = "각도 고정"; toast("각도 고정을 해제했습니다."); return }
        val r = current ?: run { toast("센서 값이 아직 없습니다."); return }
        locked = r
        b.btnLock.text = "고정 해제"
        toast("현재 각도를 기준으로 고정했습니다.")
    }

    private fun save() {
        val r = current ?: run { toast("측정값이 없어 저장할 수 없습니다."); return }
        val l = locked
        val detail = JSONObject().apply {
            put("mode", r.mode)
            put("modeLabel", if (r.mode == "flat") "평면" else if (r.vertical) "수직" else "수평")
            put("labelA", r.labelA); put("labelB", r.labelB)
            put("a", r.a); put("b", r.b)
            if (!r.rotation.isNaN()) put("rotation", r.rotation)
            put("dirA", r.dirA); put("dirB", r.dirB)
            put("state", LevelMath.STATE_LABEL[r.state])
            put("calibrated", prefs.calibAt > 0)
            if (l != null && l.mode == r.mode) put("lockDelta", if (r.mode == "flat") hypot(r.a - l.a, r.b - l.b) else LevelMath.wrap180(r.rotation - l.rotation))
        }
        val rec = MeasureRecord(type = MeasureRecord.TYPE_ANGLE, createdAt = System.currentTimeMillis(),
            value = if (r.mode == "flat") r.total else abs(r.a), unit = "°", detailJson = detail.toString())
        lifecycleScope.launch {
            try { repo.add(rec); toast("각도 기록을 저장했습니다.") }
            catch (e: Exception) { toast(e.message ?: "저장 실패") }
        }
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
}
