package com.fieldtools.armeasure.ui

import android.graphics.BitmapFactory
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import com.fieldtools.armeasure.R
import com.fieldtools.armeasure.data.MeasureRecord
import com.fieldtools.armeasure.databinding.ItemRecordBinding

class RecordAdapter(
    private val decimals: () -> Int,
    private val onOpen: (MeasureRecord) -> Unit,
    private val onDelete: (MeasureRecord) -> Unit
) : RecyclerView.Adapter<RecordAdapter.VH>() {
    var items: List<MeasureRecord> = emptyList()
        set(v) { field = v; notifyDataSetChanged() }

    class VH(val b: ItemRecordBinding) : RecyclerView.ViewHolder(b.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
        VH(ItemRecordBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun getItemCount() = items.size

    override fun onBindViewHolder(h: VH, position: Int) {
        val r = items[position]
        val ctx = h.b.root.context
        val isLen = r.type == MeasureRecord.TYPE_LENGTH
        h.b.tag.text = if (isLen) "길이" else "각도"
        h.b.tag.setTextColor(ContextCompat.getColor(ctx, if (isLen) R.color.accent else R.color.ok))
        h.b.value.text = Format.value(r, decimals())
        h.b.meta.text = Format.meta(r)
        val path = r.photoPath
        if (path != null) {
            val opts = BitmapFactory.Options().apply { inSampleSize = 8 }
            val bmp = try { BitmapFactory.decodeFile(path, opts) } catch (_: Exception) { null }
            h.b.thumb.visibility = if (bmp != null) View.VISIBLE else View.GONE
            h.b.thumb.setImageBitmap(bmp)
        } else {
            h.b.thumb.visibility = View.GONE
            h.b.thumb.setImageDrawable(null)
        }
        h.b.root.setOnClickListener { onOpen(r) }
        h.b.btnDelete.setOnClickListener { onDelete(r) }
    }
}
