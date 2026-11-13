// 설정 저장 (localStorage). 저장소 접근이 막혀 있어도 기본값으로 동작하도록 try/catch 처리.
const KEY = 'arlevel.settings.v1';

export const DEFAULTS = Object.freeze({
  unit: 'cm',            // mm | cm | m
  decimals: 1,           // 소수점 자릿수
  savePhoto: true,       // 길이 저장 시 사진 함께 저장
  t1: 0.5,               // '매우 정확한 수평' 기준(°)
  t2: 1.0,               // '거의 수평' 기준(°)
  smoothing: 'mid',      // low | mid | high
  vibrate: true,
  sound: false,
  theme: 'dark',         // dark | light | system
  levelMode: 'auto',     // auto | flat | edge
  calib: { flatX: 0, flatY: 0, edge: 0, at: null, method: null },
});

let cache = null;
let storageOk = true;

function clone(o) { return JSON.parse(JSON.stringify(o)); }

export function loadSettings() {
  if (cache) return cache;
  let saved = {};
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) saved = JSON.parse(raw) || {};
  } catch (e) {
    storageOk = false;
  }
  cache = { ...clone(DEFAULTS), ...saved, calib: { ...clone(DEFAULTS.calib), ...(saved.calib || {}) } };
  sanitize(cache);
  return cache;
}

function sanitize(s) {
  if (!['mm', 'cm', 'm'].includes(s.unit)) s.unit = DEFAULTS.unit;
  s.decimals = Math.min(3, Math.max(0, parseInt(s.decimals, 10) || 0));
  s.t1 = clampNum(s.t1, 0.05, 5, DEFAULTS.t1);
  s.t2 = clampNum(s.t2, 0.1, 10, DEFAULTS.t2);
  if (s.t2 <= s.t1) s.t2 = Math.round((s.t1 + 0.5) * 100) / 100;
  if (!['low', 'mid', 'high'].includes(s.smoothing)) s.smoothing = DEFAULTS.smoothing;
  if (!['dark', 'light', 'system'].includes(s.theme)) s.theme = DEFAULTS.theme;
  if (!['auto', 'flat', 'edge'].includes(s.levelMode)) s.levelMode = DEFAULTS.levelMode;
  for (const k of ['flatX', 'flatY', 'edge']) {
    if (!Number.isFinite(s.calib[k]) || Math.abs(s.calib[k]) > 15) s.calib[k] = 0;
  }
}

function clampNum(v, min, max, def) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export function saveSettings(patch) {
  const s = loadSettings();
  Object.assign(s, patch);
  sanitize(s);
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    storageOk = true;
  } catch (e) {
    storageOk = false;
  }
  return s;
}

export function isSettingsStorageOk() { return storageOk; }
