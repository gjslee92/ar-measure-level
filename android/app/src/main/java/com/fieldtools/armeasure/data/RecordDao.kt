package com.fieldtools.armeasure.data

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.Query
import androidx.room.Update

@Dao
interface RecordDao {
    @Insert
    suspend fun insert(record: MeasureRecord): Long

    @Update
    suspend fun update(record: MeasureRecord)

    @Delete
    suspend fun delete(record: MeasureRecord)

    @Query("SELECT * FROM records ORDER BY createdAt DESC")
    suspend fun all(): List<MeasureRecord>

    @Query("SELECT * FROM records WHERE type = :type ORDER BY createdAt DESC")
    suspend fun byType(type: String): List<MeasureRecord>

    @Query("SELECT * FROM records WHERE id = :id")
    suspend fun get(id: Long): MeasureRecord?

    @Query("SELECT photoPath FROM records WHERE photoPath IS NOT NULL")
    suspend fun allPhotoPaths(): List<String>

    @Query("DELETE FROM records")
    suspend fun clear()

    @Query("SELECT COUNT(*) FROM records")
    suspend fun count(): Int
}
