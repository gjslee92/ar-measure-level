package com.fieldtools.armeasure.ui

import android.content.ContentValues
import android.content.Intent
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.view.LayoutInflater
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import com.fieldtools.armeasure.R
import com.fieldtools.armeasure.data.MeasureRecord
import com.fieldtools.armeasure.data.RecordRepository
import com.fieldtools.armeasure.databinding.ActivityRecordDetailBinding
import com.fieldtools.armeasure.util.Prefs
import com.fieldtools.armeasure.util.Units
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

class RecordDetailActivity : AppCompatActivity() {
    private lateinit var b: ActivityRecordDetailBinding
    private lateinit var repo: RecordRepository
    private var record: MeasureRecord? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityRecordDetailBinding.inflate(layoutInflater)
        setContentView(b.root)
        repo = RecordRepository(this)
        b.toolbar.setNavigationOnClickListener { finish() }
        val id = intent.getLongExtra("id", -1)
        lifecycleScope.launch {
            val r = try { repo.get(id) } catch (e: Exception) { null }
            if (r == null) { toast("기록을 찾을 수 없습니다."); finish(); return@launch }
            record = r
            render(r)
        }
        b.btnSaveNote.setOnClickListener {
            val r = record ?: return@setOnClickListener
            val nr = r.copy(note = b.note.text?.toString()?.trim() ?: "")
            lifecycleScope.launch { try { repo.update(nr); record = nr; toast("메모를 저장했습니다.") } catch (e: Exception) { toast(e.message ?: "저장 실패") } }
        }
        b.btnDelete.setOnClickListener {
            val r = record ?: return@setOnClickListener
            MaterialAlertDialogBuilder(this).setMessage("이 기록을 삭제할까요?").setNegativeButton("취소", null)
                .setPositiveButton("삭제") { _, _ -> lifecycleScope.launch { try { repo.delete(r); toast("삭제했습니다."); finish() } catch (e: Exception) { toast(e.message ?: "삭제 실패") } } }
                .show()
        }
        b.btnShare.setOnClickListener { sharePhoto() }
        b.btnGallery.setOnClickListener { saveToGallery() }
    }

    private fun row(k: String, v: String) {
        val tv = LayoutInflater.from(this).inflate(android.R.layout.simple_list_item_2, b.rows, false)
        tv.findViewById<TextView>(android.R.id.text1).apply { text = k; setTextColor(getColor(R.color.muted)); textSize = 13f }
        tv.findViewById<TextView>(android.R.id.text2).apply { text = v; setTextColor(getColor(R.color.text)); textSize = 17f }
        b.rows.addView(tv, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    }

    private fun render(r: MeasureRecord) {
        val dec = Prefs(this).decimals
        val d = try { JSONObject(r.detailJson) } catch (_: Exception) { JSONObject() }
        b.rows.removeAllViews()
        row("측정 종류", if (r.type == MeasureRecord.TYPE_LENGTH) "길이 (AR)" else "각도 (수평기)")
        row("날짜 · 시간", Format.dateTime(r.createdAt))
        if (r.type == MeasureRecord.TYPE_LENGTH) {
            row("측정 방식", when (d.optString("mode", "dist")) { "vert" -> "높이(수직)"; "horiz" -> "수평 거리"; else -> "직선 거리" })
            row("합계", Units.format(r.value, r.unit, dec))
            val segs = d.optJSONArray("segments")
            if (segs != null) for (i in 0 until segs.length()) {
                val sj = segs.getJSONObject(i)
                val len = sj.getDouble("lengthM")
                val extra = if (sj.has("dist3dM")) "\n직선 ${Units.format(sj.getDouble("dist3dM"), r.unit, dec)} · 수직 ${Units.format(sj.getDouble("verticalM"), r.unit, dec)} · 수평 ${Units.format(sj.getDouble("horizontalM"), r.unit, dec)}" else ""
                row("구간 ${i + 1}", "${Units.format(len, r.unit, dec)}  (${Units.format(len, "mm", 1)})$extra")
            }
        } else {
            row("모드", d.optString("modeLabel"))
            row("대표 각도", Units.angle(r.value))
            if (d.has("a")) row(d.optString("labelA"), "${Units.angle(kotlin.math.abs(d.getDouble("a")))} ${d.optString("dirA")}")
            if (d.has("b")) row(d.optString("labelB"), "${Units.angle(kotlin.math.abs(d.getDouble("b")))} ${d.optString("dirB")}")
            if (d.has("rotation")) row("회전각/방향", Units.angle(d.getDouble("rotation")))
            row("판정", d.optString("state"))
            if (d.has("lockDelta")) row("고정 기준 대비", Units.angle(d.getDouble("lockDelta")))
            row("보정 적용", if (d.optBoolean("calibrated")) "예" else "아니오")
        }
        b.note.setText(r.note)
        val path = r.photoPath
        if (path != null && File(path).exists()) {
            b.photo.setImageBitmap(BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = 2 }))
            b.photo.visibility = View.VISIBLE
            b.photoActions.visibility = View.VISIBLE
        }
    }

    private fun sharePhoto() {
        val path = record?.photoPath ?: return
        val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", File(path))
        startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
            type = "image/jpeg"; putExtra(Intent.EXTRA_STREAM, uri); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }, "측정 사진 공유"))
    }

    /** Android 10+ : MediaStore(권한 불필요) / Android 9 이하 : 공유 기능 안내 */
    private fun saveToGallery() {
        val path = record?.photoPath ?: return
        if (Build.VERSION.SDK_INT < 29) { toast("Android 9 이하에서는 '공유'를 눌러 갤러리/파일 앱에 저장해 주세요."); return }
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    val values = ContentValues().apply {
                        put(MediaStore.Images.Media.DISPLAY_NAME, File(path).name)
                        put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                        put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/ARMeasure")
                    }
                    val uri = contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: throw IllegalStateException("갤러리에 파일을 만들 수 없습니다")
                    contentResolver.openOutputStream(uri)?.use { out -> File(path).inputStream().use { it.copyTo(out) } }
                }
                toast("갤러리(사진/ARMeasure)에 저장했습니다.")
            } catch (e: Exception) { toast("저장 실패: ${e.message}") }
        }
    }

    private fun toast(m: String) = Toast.makeText(this, m, Toast.LENGTH_SHORT).show()
}
