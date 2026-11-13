package com.fieldtools.armeasure.util

import android.content.Context
import android.content.SharedPreferences
import androidx.appcompat.app.AppCompatDelegate

/** 앱 설정 (기기 내부 SharedPreferences) */
class Prefs(context: Context) {
    private val sp: SharedPreferences = context.applicationContext.getSharedPreferences("settings", Context.MODE_PRIVATE)

    var unit: String
        get() = sp.getString("unit", "cm").takeIf { it in Units.ALL } ?: "cm"
        set(v) = sp.edit().putString("unit", v).apply()

    var decimals: Int
        get() = sp.getInt("decimals", 1).coerceIn(0, 3)
        set(v) = sp.edit().putInt("decimals", v.coerceIn(0, 3)).apply()

    /** AR 깊이 인식(Depth API) 사용 — 높이가 있는 물체 윗면 측정 정확도 향상 */
    var useDepth: Boolean
        get() = sp.getBoolean("useDepth", true)
        set(v) = sp.edit().putBoolean("useDepth", v).apply()

    var savePhoto: Boolean
        get() = sp.getBoolean("savePhoto", true)
        set(v) = sp.edit().putBoolean("savePhoto", v).apply()

    /** '매우 정확한 수평' 기준(°) */
    var t1: Float
        get() = sp.getFloat("t1", 0.5f).coerceIn(0.05f, 5f)
        set(v) = sp.edit().putFloat("t1", v.coerceIn(0.05f, 5f)).apply()

    /** '거의 수평' 기준(°) */
    var t2: Float
        get() = sp.getFloat("t2", 1.0f).coerceIn(0.1f, 10f).let { if (it <= t1) t1 + 0.5f else it }
        set(v) = sp.edit().putFloat("t2", v.coerceIn(0.1f, 10f)).apply()

    /** low | mid | high */
    var smoothing: String
        get() = sp.getString("smoothing", "mid") ?: "mid"
        set(v) = sp.edit().putString("smoothing", v).apply()

    var vibrate: Boolean
        get() = sp.getBoolean("vibrate", true)
        set(v) = sp.edit().putBoolean("vibrate", v).apply()

    var sound: Boolean
        get() = sp.getBoolean("sound", false)
        set(v) = sp.edit().putBoolean("sound", v).apply()

    /** dark | light | system */
    var theme: String
        get() = sp.getString("theme", "dark") ?: "dark"
        set(v) = sp.edit().putString("theme", v).apply()

    /** auto | flat | edge */
    var levelMode: String
        get() = sp.getString("levelMode", "auto") ?: "auto"
        set(v) = sp.edit().putString("levelMode", v).apply()

    // 센서 보정값(°)
    var calibFlatX: Float
        get() = sp.getFloat("calibFlatX", 0f)
        set(v) = sp.edit().putFloat("calibFlatX", v).apply()
    var calibFlatY: Float
        get() = sp.getFloat("calibFlatY", 0f)
        set(v) = sp.edit().putFloat("calibFlatY", v).apply()
    var calibEdge: Float
        get() = sp.getFloat("calibEdge", 0f)
        set(v) = sp.edit().putFloat("calibEdge", v).apply()
    var calibAt: Long
        get() = sp.getLong("calibAt", 0L)
        set(v) = sp.edit().putLong("calibAt", v).apply()
    var calibMethod: String
        get() = sp.getString("calibMethod", "") ?: ""
        set(v) = sp.edit().putString("calibMethod", v).apply()

    fun resetCalibration() {
        sp.edit().putFloat("calibFlatX", 0f).putFloat("calibFlatY", 0f).putFloat("calibEdge", 0f)
            .putLong("calibAt", 0L).putString("calibMethod", "").apply()
    }

    fun applyTheme() {
        AppCompatDelegate.setDefaultNightMode(
            when (theme) {
                "light" -> AppCompatDelegate.MODE_NIGHT_NO
                "system" -> AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM
                else -> AppCompatDelegate.MODE_NIGHT_YES
            }
        )
    }
}
