package com.fieldtools.armeasure.ui

import android.content.Intent
import android.hardware.Sensor
import android.hardware.SensorManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.appcompat.app.AppCompatActivity
import com.fieldtools.armeasure.ar.ArMeasureActivity
import com.fieldtools.armeasure.databinding.ActivityMainBinding
import com.fieldtools.armeasure.level.LevelActivity
import com.fieldtools.armeasure.util.Prefs
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.ar.core.ArCoreApk

/** 메인 화면: 로그인 없이 바로 진입 */
class MainActivity : AppCompatActivity() {
    private lateinit var b: ActivityMainBinding
    private var arAvailability: ArCoreApk.Availability? = null
    private val handler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        Prefs(this).applyTheme()
        super.onCreate(savedInstanceState)
        b = ActivityMainBinding.inflate(layoutInflater)
        setContentView(b.root)
        b.cardMeasure.setOnClickListener { openMeasure() }
        b.cardLevel.setOnClickListener { startActivity(Intent(this, LevelActivity::class.java)) }
        b.btnHistory.setOnClickListener { startActivity(Intent(this, HistoryActivity::class.java)) }
        b.btnSettings.setOnClickListener { startActivity(Intent(this, SettingsActivity::class.java)) }
    }

    override fun onResume() {
        super.onResume()
        checkAr()
    }

    /** ARCore 지원 여부 확인 (UNKNOWN_CHECKING 상태면 잠시 후 재확인) */
    private fun checkAr() {
        val a = try { ArCoreApk.getInstance().checkAvailability(this) } catch (e: Exception) { ArCoreApk.Availability.UNKNOWN_ERROR }
        arAvailability = a
        if (a.isTransient) handler.postDelayed({ checkAr() }, 300)
        val arText = when (a) {
            ArCoreApk.Availability.SUPPORTED_INSTALLED -> "사용 가능"
            ArCoreApk.Availability.SUPPORTED_APK_TOO_OLD -> "ARCore 업데이트 필요 (측정 시작 시 안내)"
            ArCoreApk.Availability.SUPPORTED_NOT_INSTALLED -> "ARCore 설치 필요 (측정 시작 시 안내)"
            ArCoreApk.Availability.UNSUPPORTED_DEVICE_NOT_CAPABLE -> "이 기기는 ARCore 미지원 — 사용 불가"
            ArCoreApk.Availability.UNKNOWN_CHECKING -> "확인 중…"
            else -> "확인 불가 (측정 시작 시 다시 확인)"
        }
        val sm = getSystemService(SENSOR_SERVICE) as? SensorManager
        val acc = sm?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null
        val gyro = sm?.getDefaultSensor(Sensor.TYPE_GYROSCOPE) != null
        b.supportInfo.text = "이 기기 지원 현황\n· AR 길이 측정: $arText\n· 수평기 센서: ${if (acc) "가속도계 있음" else "없음 — 수평기 사용 불가"}${if (gyro) " · 자이로스코프 있음" else ""}\n· 기록 저장: 기기 내부 저장소"
        b.measureSub.text = if (a == ArCoreApk.Availability.UNSUPPORTED_DEVICE_NOT_CAPABLE) "이 기기는 AR 측정을 지원하지 않습니다" else "AR 카메라로 두 점 사이 거리 측정"
    }

    private fun openMeasure() {
        if (arAvailability == ArCoreApk.Availability.UNSUPPORTED_DEVICE_NOT_CAPABLE) {
            MaterialAlertDialogBuilder(this)
                .setTitle("AR 측정 사용 불가")
                .setMessage("이 기기는 Google ARCore를 지원하지 않아 AR 길이 측정을 사용할 수 없습니다.\n디지털 수평기와 측정 기록 기능은 정상적으로 사용할 수 있습니다.")
                .setPositiveButton("확인", null).show()
            return
        }
        startActivity(Intent(this, ArMeasureActivity::class.java))
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }
}
