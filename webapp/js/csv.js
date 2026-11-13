// CSV 내보내기 (UTF-8 BOM, 엑셀 호환)
import { convert } from './units.js';

function esc(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function pad(n) { return String(n).padStart(2, '0'); }
export function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function fmtTime(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function recordsToCsv(records, decimals) {
  const header = ['번호', '날짜', '시간', '측정 종류', '측정값', '측정 단위', '세부 내용', '메모'];
  const rows = [header];
  records.slice().sort((a, b) => a.createdAt - b.createdAt).forEach((r, i) => {
    if (r.type === 'length') {
      const unit = r.unit || 'cm';
      const segs = (r.segments || []).map((s, k) => `구간${k + 1}=${convert(s.lengthM, unit).toFixed(decimals)}${unit}`).join(' / ');
      rows.push([i + 1, fmtDate(r.createdAt), fmtTime(r.createdAt), '길이', convert(r.totalM, unit).toFixed(decimals), unit,
        `${(r.segments || []).length}개 구간${segs ? ': ' + segs : ''}`, r.note || '']);
    } else {
      const d = r.detail || {};
      const parts = [];
      if (d.mode) parts.push(`모드=${d.mode === 'flat' ? '평면' : (d.orientation === 'vertical' ? '수직' : '수평')}`);
      if (Number.isFinite(d.a)) parts.push(`${d.labelA || 'A'}=${d.a.toFixed(1)}°`);
      if (Number.isFinite(d.b)) parts.push(`${d.labelB || 'B'}=${d.b.toFixed(1)}°`);
      if (Number.isFinite(d.rotation)) parts.push(`회전각=${d.rotation.toFixed(1)}°`);
      if (d.state) parts.push(`판정=${d.state}`);
      rows.push([i + 1, fmtDate(r.createdAt), fmtTime(r.createdAt), '각도', r.value.toFixed(1), '°', parts.join(' / '), r.note || '']);
    }
  });
  return '﻿' + rows.map(r => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

export function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime });
  downloadBlob(blob, filename);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
