package com.fieldtools.armeasure.ui

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.fieldtools.armeasure.R
import com.fieldtools.armeasure.data.MeasureRecord
import com.fieldtools.armeasure.data.RecordRepository
import com.fieldtools.armeasure.databinding.ActivityHistoryBinding
import com.fieldtools.armeasure.util.CsvExporter
import com.fieldtools.armeasure.util.Prefs
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class HistoryActivity : AppCompatActivity() {
    private lateinit var b: ActivityHistoryBinding
    private lateinit var repo: RecordRepository
    private lateinit var prefs: Prefs
    private lateinit var adapter: RecordAdapter
    private var filter: String? = null
    private var pendingCsv: ByteArray? = null

    /** 저장 위치를 사용자가 선택(다운로드 폴더 등) — 저장소 권한 불필요 */
    private val createCsv = registerForActivityResult(ActivityResultContracts.CreateDocument("text/csv")) { uri ->
        val data = pendingCsv ?: return@registerForActivityResult
        pendingCsv = null
        if (uri == null) return@registerForActivityResult
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) { contentResolver.openOutputStream(uri)?.use { it.write(data) } ?: throw IllegalStateException("파일을 열 수 없습니다") }
                toast("CSV 파일을 저장했습니다.")
            } catch (e: Exception) { toast("CSV 저장 실패: ${e.message}") }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityHistoryBinding.inflate(layoutInflater)
        setContentView(b.root)
        repo = RecordRepository(this)
        prefs = Prefs(this)
        b.toolbar.setNavigationOnClickListener { finish() }
        adapter = RecordAdapter({ prefs.decimals },
            onOpen = { startActivity(Intent(this, RecordDetailActivity::class.java).putExtra("id", it.id)) },
            onDelete = { confirmDelete(it) })
        b.list.layoutManager = LinearLayoutManager(this)
        b.list.adapter = adapter
        b.filterGroup.check(R.id.fAll)
        b.filterGroup.addOnButtonCheckedListener { _, id, checked ->
            if (!checked) return@addOnButtonCheckedListener
            filter = when (id) { R.id.fLength -> MeasureRecord.TYPE_LENGTH; R.id.fAngle -> MeasureRecord.TYPE_ANGLE; else -> null }
            load()
        }
        b.btnCsv.setOnClickListener { exportCsv() }
        b.btnDeleteAll.setOnClickListener { confirmDeleteAll() }
    }

    override fun onResume() { super.onResume(); load() }

    private fun load() {
        lifecycleScope.launch {
            try {
                val list = repo.list(filter)
                adapter.items = list
                b.empty.visibility = if (list.isEmpty()) View.VISIBLE else View.GONE
            } catch (e: Exception) {
                b.empty.text = e.message; b.empty.visibility = View.VISIBLE
            }
        }
    }

    private fun confirmDelete(r: MeasureRecord) {
        MaterialAlertDialogBuilder(this).setMessage("이 기록을 삭제할까요?")
            .setNegativeButton("취소", null)
            .setPositiveButton("삭제") { _, _ -> lifecycleScope.launch { try { repo.delete(r); toast("삭제했습니다."); load() } catch (e: Exception) { toast(e.message ?: "삭제 실패") } } }
            .show()
    }

    private fun confirmDeleteAll() {
        MaterialAlertDialogBuilder(this).setTitle("전체 기록 삭제").setMessage("모든 측정 기록(사진 포함)을 삭제합니다. 되돌릴 수 없습니다.")
            .setNegativeButton("취소", null)
            .setPositiveButton("전체 삭제") { _, _ -> lifecycleScope.launch { try { repo.clear(); toast("모든 기록을 삭제했습니다."); load() } catch (e: Exception) { toast(e.message ?: "삭제 실패") } } }
            .show()
    }

    private fun exportCsv() {
        lifecycleScope.launch {
            try {
                val list = repo.list(filter)
                if (list.isEmpty()) { toast("내보낼 기록이 없습니다."); return@launch }
                pendingCsv = CsvExporter.build(list, prefs.decimals)
                val name = "측정기록_" + SimpleDateFormat("yyyyMMdd_HHmmss", Locale.KOREA).format(Date()) + ".csv"
                createCsv.launch(name)
            } catch (e: Exception) { toast(e.message ?: "CSV 생성 실패") }
        }
    }

    private fun toast(m: String) = Toast.makeText(this, m, Toast.LENGTH_SHORT).show()
}
