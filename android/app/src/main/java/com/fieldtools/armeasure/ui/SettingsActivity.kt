package com.fieldtools.armeasure.ui

import android.os.Bundle
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Spinner
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.fieldtools.armeasure.BuildConfig
import com.fieldtools.armeasure.data.RecordRepository
import com.fieldtools.armeasure.databinding.ActivitySettingsBinding
import com.fieldtools.armeasure.util.Prefs
import com.fieldtools.armeasure.util.Units
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.launch

class SettingsActivity : AppCompatActivity() {
    private lateinit var b: ActivitySettingsBinding
    private lateinit var prefs: Prefs
    private lateinit var repo: RecordRepository

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(b.root)
        prefs = Prefs(this)
        repo = RecordRepository(this)
        b.toolbar.setNavigationOnClickListener { finish() }

        spinner(b.spUnit, Units.ALL, Units.ALL, prefs.unit) { prefs.unit = it }
        spinner(b.spDecimals, listOf("0", "1", "2", "3"), listOf("0", "1", "2", "3"), prefs.decimals.toString()) { prefs.decimals = it.toInt() }
        spinner(b.spSmoothing, listOf("약하게(빠른 반응)", "보통", "강하게(안정)"), listOf("low", "mid", "high"), prefs.smoothing) { prefs.smoothing = it }
        spinner(b.spTheme, listOf("다크", "라이트", "시스템 설정"), listOf("dark", "light", "system"), prefs.theme) {
            if (it != prefs.theme) { prefs.theme = it; prefs.applyTheme() }
        }
        b.swDepth.isChecked = prefs.useDepth
        b.swDepth.setOnCheckedChangeListener { _, v -> prefs.useDepth = v }
        b.swPhoto.isChecked = prefs.savePhoto
        b.swPhoto.setOnCheckedChangeListener { _, v -> prefs.savePhoto = v }
        b.swVibrate.isChecked = prefs.vibrate
        b.swVibrate.setOnCheckedChangeListener { _, v -> prefs.vibrate = v }
        b.swSound.isChecked = prefs.sound
        b.swSound.setOnCheckedChangeListener { _, v -> prefs.sound = v }
        b.etT1.setText(prefs.t1.toString())
        b.etT2.setText(prefs.t2.toString())
        b.btnResetCalib.setOnClickListener { prefs.resetCalibration(); toast("센서 보정값을 초기화했습니다.") }
        b.btnDeleteAll.setOnClickListener {
            MaterialAlertDialogBuilder(this).setTitle("전체 기록 삭제").setMessage("모든 측정 기록(사진 포함)을 삭제합니다. 되돌릴 수 없습니다.")
                .setNegativeButton("취소", null)
                .setPositiveButton("전체 삭제") { _, _ -> lifecycleScope.launch { try { repo.clear(); toast("삭제했습니다."); refreshStorage() } catch (e: Exception) { toast(e.message ?: "실패") } } }
                .show()
        }
        b.appInfo.text = "버전 ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})\n로그인·회원가입·광고·인터넷 권한이 없는 독립형 앱입니다. 모든 측정 기록은 이 기기 내부에만 저장됩니다.\n측정값은 참고용이며 전문 측정 장비 수준의 정밀도를 보장하지 않습니다."
        refreshStorage()
    }

    override fun onPause() {
        super.onPause()
        // 판정 기준 저장 (t1 < t2 유지)
        val t1 = b.etT1.text?.toString()?.toFloatOrNull()
        val t2 = b.etT2.text?.toString()?.toFloatOrNull()
        if (t1 != null) prefs.t1 = t1
        if (t2 != null) prefs.t2 = if (t2 <= prefs.t1) prefs.t1 + 0.5f else t2
    }

    private fun refreshStorage() {
        lifecycleScope.launch {
            val n = try { repo.count().toString() + "건" } catch (e: Exception) { "확인 불가" }
            b.storageInfo.text = "저장된 기록: $n · 앱을 삭제하면 기록도 함께 삭제됩니다."
        }
    }

    private fun spinner(sp: Spinner, labels: List<String>, values: List<String>, current: String, onSel: (String) -> Unit) {
        sp.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, labels)
        sp.setSelection(values.indexOf(current).coerceAtLeast(0))
        sp.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) = onSel(values[position])
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
    }

    private fun toast(m: String) = Toast.makeText(this, m, Toast.LENGTH_SHORT).show()
}
