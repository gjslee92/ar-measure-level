package com.fieldtools.armeasure.ui

import com.fieldtools.armeasure.data.MeasureRecord
import com.fieldtools.armeasure.util.Units
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object Format {
    private val dt = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.KOREA)
    fun dateTime(ts: Long): String = dt.format(Date(ts))

    fun value(r: MeasureRecord, decimals: Int): String =
        if (r.type == MeasureRecord.TYPE_LENGTH) Units.format(r.value, r.unit, decimals) else Units.angle(r.value)

    fun meta(r: MeasureRecord): String {
        val d = try { JSONObject(r.detailJson) } catch (_: Exception) { JSONObject() }
        val base = if (r.type == MeasureRecord.TYPE_LENGTH) {
            "${dateTime(r.createdAt)} · ${d.optJSONArray("segments")?.length() ?: 0}개 구간${if (r.photoPath != null) " · 사진" else ""}"
        } else {
            "${dateTime(r.createdAt)} · ${d.optString("modeLabel")} · ${d.optString("state")}"
        }
        return if (r.note.isNotEmpty()) "$base · ${r.note}" else base
    }
}
