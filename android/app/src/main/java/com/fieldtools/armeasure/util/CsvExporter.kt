package com.fieldtools.armeasure.util

import com.fieldtools.armeasure.data.MeasureRecord
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** CSV 내보내기 (UTF-8 BOM, 엑셀 호환) */
object CsvExporter {
    private val dateFmt = SimpleDateFormat("yyyy-MM-dd", Locale.KOREA)
    private val timeFmt = SimpleDateFormat("HH:mm:ss", Locale.KOREA)

    private fun esc(s: String): String =
        if (s.contains(',') || s.contains('"') || s.contains('\n') || s.contains('\r')) "\"" + s.replace("\"", "\"\"") + "\"" else s

    fun build(records: List<MeasureRecord>, decimals: Int): ByteArray {
        val sb = StringBuilder()
        sb.append('﻿')
        sb.append("번호,날짜,시간,측정 종류,측정값,측정 단위,세부 내용,메모\r\n")
        records.sortedBy { it.createdAt }.forEachIndexed { i, r ->
            val d = Date(r.createdAt)
            val detail = try { JSONObject(r.detailJson) } catch (_: Exception) { JSONObject() }
            val cols: List<String> = if (r.type == MeasureRecord.TYPE_LENGTH) {
                val segs = detail.optJSONArray("segments")
                val parts = mutableListOf<String>()
                if (segs != null) for (k in 0 until segs.length()) {
                    parts += "구간${k + 1}=" + String.format(Locale.US, "%.${decimals}f", Units.convert(segs.getJSONObject(k).getDouble("lengthM"), r.unit)) + r.unit
                }
                listOf("${i + 1}", dateFmt.format(d), timeFmt.format(d), "길이",
                    String.format(Locale.US, "%.${decimals}f", Units.convert(r.value, r.unit)), r.unit,
                    "${segs?.length() ?: 0}개 구간" + if (parts.isNotEmpty()) ": " + parts.joinToString(" / ") else "", r.note)
            } else {
                val parts = mutableListOf<String>()
                parts += "모드=" + detail.optString("modeLabel")
                if (detail.has("a")) parts += detail.optString("labelA") + "=" + String.format(Locale.US, "%.1f°", detail.getDouble("a"))
                if (detail.has("b")) parts += detail.optString("labelB") + "=" + String.format(Locale.US, "%.1f°", detail.getDouble("b"))
                if (detail.has("rotation") && !detail.optDouble("rotation").isNaN()) parts += "회전각=" + String.format(Locale.US, "%.1f°", detail.getDouble("rotation"))
                parts += "판정=" + detail.optString("state")
                listOf("${i + 1}", dateFmt.format(d), timeFmt.format(d), "각도",
                    String.format(Locale.US, "%.1f", r.value), "°", parts.joinToString(" / "), r.note)
            }
            sb.append(cols.joinToString(",") { esc(it) }).append("\r\n")
        }
        return sb.toString().toByteArray(Charsets.UTF_8)
    }
}
