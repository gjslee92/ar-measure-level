// 앱 진입점: 라우팅, 기록/설정 화면, AR·수평기 연결
import { loadSettings, saveSettings, isSettingsStorageOk } from './settings.js';
import { addRecord, getAllRecords, getRecord, deleteRecord, clearRecords, updateRecord, storageEstimate, requestPersist, openDB } from './db.js';
import { recordsToCsv, downloadText, downloadBlob, fmtDate, fmtTime } from './csv.js';
import { formatLength, formatAngle, convert } from './units.js';
import { toast, confirmDialog, escapeHtml } from './ui.js';
import { LevelController } from './level.js';

export const APP_VERSION = '1.0.0';
const $ = id => document.getElementById(id);
const TITLES = { home: 'AR 측정 · 수평기', measure: '길이 측정', level: '디지털 수평기', history: '측정 기록', record: '기록 상세', settings: '설정' };

let level = null;
let ar = null;             // ARMeasure (지연 로드)
let arModule = null;
let arSupport = null;
let lastSession = null;    // AR 종료 후 남은 결과
let historyFilter = 'all';
let currentView = null;

/* ---------- 테마 ---------- */
function applyTheme() {
  const t = loadSettings().theme;
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]').content = dark ? '#0b0f14' : '#f3f6fa';
}

/* ---------- 라우팅 ---------- */
function route() {
  const hash = location.hash.replace(/^#\/?/, '') || 'home';
  const [name, arg] = hash.split('/');
  const viewName = TITLES[name] ? name : 'home';
  if (currentView === 'level' && viewName !== 'level' && level) level.stop();
  currentView = viewName;
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.dataset.view === viewName));
  $('pageTitle').textContent = TITLES[viewName];
  $('btnBack').hidden = viewName === 'home';
  window.scrollTo(0, 0);
  if (viewName === 'level') level.enter();
  if (viewName === 'measure') enterMeasure();
  if (viewName === 'history') renderHistory();
  if (viewName === 'record') renderRecord(Number(arg));
  if (viewName === 'settings') renderSettings();
}

/* ---------- 홈: 플랫폼 지원 안내 ---------- */
async function renderPlatformBox() {
  arSupport = arSupport || await loadArSupport();
  const sensor = 'DeviceOrientationEvent' in window;
  const idb = 'indexedDB' in window;
  const yes = t => `<b class="ok">${t}</b>`, no = t => `<b class="no">${t}</b>`;
  $('platformBox').innerHTML =
    `이 기기·브라우저 지원 현황<br>` +
    `· AR 길이 측정: ${arSupport.ok ? yes('사용 가능') : no('사용 불가')}${arSupport.ok ? '' : ' — ' + escapeHtml(arSupport.msg)}<br>` +
    `· 수평기 센서: ${sensor && window.isSecureContext ? yes('지원') : no('미지원/HTTPS 필요')}<br>` +
    `· 기기 내 기록 저장: ${idb ? yes('지원') : no('미지원')}<br>` +
    `<span class="note">웹앱과 Android 앱의 기능 차이는 '설정 › 앱 정보'를 참고하세요.</span>`;
}

async function loadArSupport() {
  try {
    const m = await import('./ar.js');
    arModule = m;
    return await m.checkARSupport();
  } catch (e) {
    return { ok: false, code: 'load', msg: 'AR 모듈을 불러오지 못했습니다: ' + (e.message || e) };
  }
}

/* ---------- 길이 측정 ---------- */
async function enterMeasure() {
  const st = $('arSupportStatus');
  st.textContent = 'AR 지원 여부 확인 중…'; st.className = 'status-line';
  arSupport = arSupport || await loadArSupport();
  st.textContent = arSupport.msg;
  st.className = 'status-line ' + (arSupport.ok ? 'ok' : 'bad');
  $('btnStartAR').disabled = !arSupport.ok;
  renderLastSession();
}

async function startAR() {
  if (!arModule || !arSupport || !arSupport.ok) return;
  if (!ar) {
    ar = new arModule.ARMeasure({
      onEnd: result => { lastSession = result && result.length ? result : lastSession; renderLastSession(); },
      onSave: rec => saveLengthRecord(rec),
    });
  }
  $('btnStartAR').disabled = true;
  try {
    await ar.start();
  } catch (e) {
    try { if (ar.session) ar.end(); } catch (x) { /* 무시 */ }
    const st = $('arSupportStatus');
    st.textContent = e.message; st.className = 'status-line bad';
  } finally {
    $('btnStartAR').disabled = !arSupport.ok;
  }
}

async function saveLengthRecord(rec) {
  try {
    await addRecord(rec);
    requestPersist();
    return true;
  } catch (e) {
    // 사진 때문에 용량 부족이면 사진 없이 재시도
    if (rec.photo) {
      try { await addRecord({ ...rec, photo: null }); toast('저장 공간이 부족해 사진 없이 저장했습니다.', 4000); return true; } catch (e2) { /* 아래 */ }
    }
    throw e;
  }
}

function renderLastSession() {
  const panel = $('lastSessionPanel');
  if (!lastSession || !lastSession.length) { panel.hidden = true; return; }
  const s = loadSettings();
  const total = lastSession.reduce((n, x) => n + x.lengthM, 0);
  $('lastSessionList').innerHTML = lastSession.map((sg, i) =>
    `<div class="detail-row"><span>구간 ${i + 1}</span><span>${formatLength(sg.lengthM, s.unit, s.decimals)}</span></div>`).join('') +
    (lastSession.length > 1 ? `<div class="detail-row"><span>합계</span><span>${formatLength(total, s.unit, s.decimals)}</span></div>` : '');
  panel.hidden = false;
}

/* ---------- 기록 목록 ---------- */
const thumbUrls = [];
function revokeThumbs() { while (thumbUrls.length) URL.revokeObjectURL(thumbUrls.pop()); }

function recordValueText(r, s) {
  if (r.type === 'length') return formatLength(r.totalM, r.unit || s.unit, s.decimals);
  return formatAngle(r.value);
}
function recordMetaText(r) {
  const when = `${fmtDate(r.createdAt)} ${fmtTime(r.createdAt)}`;
  if (r.type === 'length') return `${when} · ${(r.segments || []).length}개 구간${r.photo ? ' · 사진' : ''}`;
  const d = r.detail || {};
  return `${when} · ${d.mode === 'flat' ? '평면' : (d.orientation === 'vertical' ? '수직' : '수평')} · ${d.state || ''}`;
}

async function renderHistory() {
  const list = $('recordList');
  revokeThumbs();
  let records;
  try {
    records = await getAllRecords();
  } catch (e) {
    list.innerHTML = '';
    $('recordEmpty').hidden = false;
    $('recordEmpty').textContent = e.message;
    return;
  }
  const s = loadSettings();
  const filtered = records.filter(r => historyFilter === 'all' || r.type === historyFilter);
  $('recordEmpty').textContent = '저장된 측정 기록이 없습니다.';
  $('recordEmpty').hidden = filtered.length > 0;
  list.innerHTML = '';
  filtered.forEach(r => {
    const li = document.createElement('li');
    li.className = 'record';
    let thumb = '';
    if (r.photo instanceof Blob) { const u = URL.createObjectURL(r.photo); thumbUrls.push(u); thumb = `<img class="thumb" src="${u}" alt="">`; }
    li.innerHTML = `<span class="tag ${r.type}">${r.type === 'length' ? '길이' : '각도'}</span>${thumb}
      <div class="main"><div class="value">${escapeHtml(recordValueText(r, s))}</div><div class="meta">${escapeHtml(recordMetaText(r))}${r.note ? ' · ' + escapeHtml(r.note) : ''}</div></div>
      <button class="icon-btn del" aria-label="삭제"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg></button>`;
    li.addEventListener('click', ev => {
      if (ev.target.closest('.del')) return;
      location.hash = `#/record/${r.id}`;
    });
    li.querySelector('.del').addEventListener('click', async () => {
      if (!await confirmDialog('이 기록을 삭제할까요?', '삭제', true)) return;
      try { await deleteRecord(r.id); toast('삭제했습니다.'); renderHistory(); } catch (e) { toast(e.message); }
    });
    list.appendChild(li);
  });
}

async function renderRecord(id) {
  const box = $('recordDetail');
  revokeThumbs();
  let r;
  try { r = await getRecord(id); } catch (e) { box.innerHTML = `<p>${escapeHtml(e.message)}</p>`; return; }
  if (!r) { box.innerHTML = '<p>기록을 찾을 수 없습니다.</p>'; return; }
  const s = loadSettings();
  const rows = [];
  const row = (k, v) => rows.push(`<div class="detail-row"><span>${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></div>`);
  row('측정 종류', r.type === 'length' ? '길이 (AR)' : '각도 (수평기)');
  row('날짜', fmtDate(r.createdAt));
  row('시간', fmtTime(r.createdAt));
  let photoHtml = '';
  if (r.type === 'length') {
    const unit = r.unit || s.unit;
    row('합계', formatLength(r.totalM, unit, s.decimals));
    (r.segments || []).forEach((sg, i) => row(`구간 ${i + 1}`, `${formatLength(sg.lengthM, unit, s.decimals)}  (${convert(sg.lengthM, 'mm').toFixed(1)} mm)`));
    row('앵커 고정', r.meta && r.meta.anchors ? '사용' : '미사용');
    if (r.photo instanceof Blob) {
      const u = URL.createObjectURL(r.photo); thumbUrls.push(u);
      photoHtml = `<img class="detail-photo" src="${u}" alt="측정 사진"><button class="btn block" id="btnDlPhoto">사진 파일로 저장</button>`;
    }
  } else {
    const d = r.detail || {};
    row('모드', d.mode === 'flat' ? '평면(버블)' : (d.orientation === 'vertical' ? '수직(세움)' : '수평(세움)'));
    row('대표 각도', formatAngle(r.value));
    if (Number.isFinite(d.a)) row(d.labelA || 'A', `${formatAngle(Math.abs(d.a))} ${d.dirA || ''}`);
    if (Number.isFinite(d.b)) row(d.labelB || 'B', `${formatAngle(Math.abs(d.b))} ${d.dirB || ''}`);
    if (Number.isFinite(d.rotation)) row('회전각', formatAngle(d.rotation));
    row('판정', d.state || '-');
    if (d.locked) row('고정 기준 대비', formatAngle(d.locked.delta));
    row('보정 적용', d.calibrated ? '예' : '아니오');
  }
  box.innerHTML = `${photoHtml}${rows.join('')}
    <label class="note">메모</label><textarea class="memo" id="recNote" maxlength="200" placeholder="예: 3층 회의실 전자칠판 좌측">${escapeHtml(r.note || '')}</textarea>
    <div class="btn-row"><button class="btn" id="btnSaveNote">메모 저장</button><button class="btn danger" id="btnDelRec">삭제</button></div>`;
  $('btnSaveNote').onclick = async () => {
    try { r.note = $('recNote').value.trim(); await updateRecord(r); toast('메모를 저장했습니다.'); } catch (e) { toast(e.message); }
  };
  $('btnDelRec').onclick = async () => {
    if (!await confirmDialog('이 기록을 삭제할까요?', '삭제', true)) return;
    try { await deleteRecord(r.id); toast('삭제했습니다.'); history.back(); } catch (e) { toast(e.message); }
  };
  const dl = $('btnDlPhoto');
  if (dl) dl.onclick = () => downloadBlob(r.photo, `측정사진_${fmtDate(r.createdAt)}_${fmtTime(r.createdAt).replace(/:/g, '')}.jpg`);
}

async function exportCsv() {
  try {
    const recs = await getAllRecords();
    const filtered = recs.filter(r => historyFilter === 'all' || r.type === historyFilter);
    if (!filtered.length) { toast('내보낼 기록이 없습니다.'); return; }
    const csv = recordsToCsv(filtered, loadSettings().decimals);
    const d = new Date();
    downloadText(csv, `측정기록_${fmtDate(d)}_${fmtTime(d).replace(/:/g, '')}.csv`, 'text/csv;charset=utf-8');
    toast(`${filtered.length}건을 CSV로 저장했습니다.`);
  } catch (e) { toast(e.message || 'CSV 저장 실패'); }
}

async function deleteAll() {
  if (!await confirmDialog('모든 측정 기록(사진 포함)을 삭제합니다. 되돌릴 수 없습니다.', '전체 삭제', true)) return;
  try { await clearRecords(); toast('모든 기록을 삭제했습니다.'); if (currentView === 'history') renderHistory(); renderStorageInfo(); } catch (e) { toast(e.message); }
}

/* ---------- 설정 ---------- */
function renderSettings() {
  const s = loadSettings();
  $('setUnit').value = s.unit;
  $('setDecimals').value = String(s.decimals);
  $('setSavePhoto').checked = s.savePhoto;
  $('setT1').value = s.t1;
  $('setT2').value = s.t2;
  $('setSmoothing').value = s.smoothing;
  $('setVibrate').checked = s.vibrate;
  $('setSound').checked = s.sound;
  $('setTheme').value = s.theme;
  $('appVersion').textContent = 'v' + APP_VERSION;
  $('capInfo').innerHTML = 'Android 앱(APK)은 ARCore를 직접 사용해 카메라 영상이 포함된 측정 사진을 항상 저장할 수 있고, 웹앱은 브라우저가 허용하는 경우에만 카메라 영상이 포함됩니다. iPhone Safari에서는 웹 AR이 지원되지 않아 수평기·기록 기능만 동작합니다.' +
    (isSettingsStorageOk() ? '' : '<br><b>주의: 브라우저 저장소 접근이 막혀 설정이 저장되지 않습니다.</b>');
  renderStorageInfo();
}

async function renderStorageInfo() {
  const est = await storageEstimate();
  let count = '-';
  try { count = (await getAllRecords()).length + '건'; } catch (e) { count = '확인 불가'; }
  $('storageInfo').textContent = `저장된 기록: ${count}` + (est ? ` · 사용량 약 ${(est.usage / 1024 / 1024).toFixed(1)}MB` : '') +
    ' · 브라우저 데이터 삭제 시 기록이 함께 삭제됩니다.';
}

function bindSettings() {
  const on = (id, ev, fn) => $(id).addEventListener(ev, fn);
  on('setUnit', 'change', e => saveSettings({ unit: e.target.value }));
  on('setDecimals', 'change', e => saveSettings({ decimals: Number(e.target.value) }));
  on('setSavePhoto', 'change', e => saveSettings({ savePhoto: e.target.checked }));
  const thr = () => {
    const s = saveSettings({ t1: $('setT1').value, t2: $('setT2').value });
    $('setT1').value = s.t1; $('setT2').value = s.t2;
    toast(`판정 기준: ≤${s.t1}° 매우 정확 · ≤${s.t2}° 거의 수평 · 초과 기울어짐`);
  };
  on('setT1', 'change', thr); on('setT2', 'change', thr);
  on('setSmoothing', 'change', e => saveSettings({ smoothing: e.target.value }));
  on('setVibrate', 'change', e => saveSettings({ vibrate: e.target.checked }));
  on('setSound', 'change', e => saveSettings({ sound: e.target.checked }));
  on('setTheme', 'change', e => { saveSettings({ theme: e.target.value }); applyTheme(); });
  on('btnResetCalib2', 'click', () => { saveSettings({ calib: { flatX: 0, flatY: 0, edge: 0, at: null, method: null } }); toast('센서 보정값을 초기화했습니다.'); });
  on('btnDeleteAll2', 'click', deleteAll);
}

/* ---------- 오프라인 / 서비스워커 ---------- */
function updateOnline() { $('offlineBadge').hidden = navigator.onLine; }

async function registerSW() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  try { await navigator.serviceWorker.register('sw.js'); } catch (e) { /* 오프라인 캐시 없이 동작 */ }
}

/* ---------- 초기화 ---------- */
function init() {
  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
  level = new LevelController();
  bindSettings();
  $('btnBack').addEventListener('click', () => { if (history.length > 1) history.back(); else location.hash = '#/home'; });
  $('btnStartAR').addEventListener('click', startAR);
  $('btnSaveLastSession').addEventListener('click', async () => {
    if (!lastSession) return;
    const s = loadSettings();
    const total = lastSession.reduce((n, x) => n + x.lengthM, 0);
    const rec = { type: 'length', unit: s.unit, totalM: total, value: total, photo: null, meta: { platform: 'web', anchors: false },
      segments: lastSession.map(sg => ({ chain: sg.chain, lengthM: sg.lengthM, a: { x: sg.a.x, y: sg.a.y, z: sg.a.z }, b: { x: sg.b.x, y: sg.b.y, z: sg.b.z } })) };
    try { await saveLengthRecord(rec); toast('기록에 저장했습니다.'); lastSession = null; renderLastSession(); } catch (e) { toast(e.message); }
  });
  $('btnClearLastSession').addEventListener('click', () => { lastSession = null; renderLastSession(); });
  document.querySelectorAll('.filter .seg').forEach(b => b.addEventListener('click', () => {
    historyFilter = b.dataset.filter;
    document.querySelectorAll('.filter .seg').forEach(x => x.classList.toggle('active', x === b));
    renderHistory();
  }));
  $('btnExportCsv').addEventListener('click', exportCsv);
  $('btnDeleteAll').addEventListener('click', deleteAll);
  window.addEventListener('hashchange', route);
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  document.addEventListener('visibilitychange', () => {
    // 다른 앱으로 전환 시 센서 해제, 복귀 시 재개
    if (currentView !== 'level' || !level) return;
    if (document.visibilityState === 'hidden') level.stop();
    else level.enter();
  });
  updateOnline();
  openDB().catch(e => toast(e.message, 5000));
  route();
  renderPlatformBox();
  registerSW();
  window.__app = { level, version: APP_VERSION, getAR: () => ar }; // 자동 테스트용 훅(읽기 전용)
}

init();
