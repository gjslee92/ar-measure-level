package com.fieldtools.armeasure.data

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * 측정 기록 (기기 내부 Room DB에만 저장)
 * type: "length" | "angle"
 * value: 길이는 미터(m), 각도는 도(°)
 * detailJson: 길이 = 구간 목록, 각도 = 모드·축별 각도 등
 */
@Entity(tableName = "records")
data class MeasureRecord(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val type: String,
    val createdAt: Long,
    val value: Double,
    val unit: String,
    val detailJson: String,
    val photoPath: String? = null,
    val note: String = ""
) {
    companion object {
        const val TYPE_LENGTH = "length"
        const val TYPE_ANGLE = "angle"
    }
}
