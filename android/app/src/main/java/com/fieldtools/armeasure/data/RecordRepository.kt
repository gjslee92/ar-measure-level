package com.fieldtools.armeasure.data

import android.content.Context
import android.database.sqlite.SQLiteFullException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/** 기록 저장소: DB 오류를 사용자 메시지로 변환하고, 사진 파일 정리까지 담당 */
class RecordRepository(private val context: Context) {
    private val dao get() = AppDatabase.get(context).records()

    class StorageException(message: String, cause: Throwable? = null) : Exception(message, cause)

    private suspend fun <T> guard(block: suspend () -> T): T = withContext(Dispatchers.IO) {
        try {
            block()
        } catch (e: SQLiteFullException) {
            throw StorageException("저장 공간이 부족합니다. 기기 저장 공간을 확보하거나 사진이 포함된 기록을 삭제해 주세요.", e)
        } catch (e: StorageException) {
            throw e
        } catch (e: Exception) {
            throw StorageException("기기 내부 저장소에 접근하지 못했습니다: ${e.message}", e)
        }
    }

    suspend fun add(r: MeasureRecord): Long = guard { dao.insert(r) }
    suspend fun update(r: MeasureRecord) = guard { dao.update(r) }
    suspend fun get(id: Long) = guard { dao.get(id) }
    suspend fun list(type: String?) = guard { if (type == null) dao.all() else dao.byType(type) }
    suspend fun count() = guard { dao.count() }

    suspend fun delete(r: MeasureRecord) = guard {
        dao.delete(r)
        r.photoPath?.let { File(it).delete() }
    }

    suspend fun clear() = guard {
        val photos = dao.allPhotoPaths()
        dao.clear()
        photos.forEach { File(it).delete() }
        File(context.filesDir, "photos").listFiles()?.forEach { it.delete() }
    }
}
