// 수평기 계산 (DOM 비의존 — 테스트 가능)
// 좌표계: 기기 x=오른쪽, y=화면 위쪽, z=화면 바깥(사용자 쪽).
// DeviceOrientationEvent의 beta/gamma(Z-X'-Y'' 내재 회전)로부터
// '하늘 방향(up)' 벡터를 기기 좌표로 구한다. 이 방식은 beta=±90° 부근의
// 짐벌락에서도 연속적이며 Android/iOS 모두 동일한 W3C 규약을 따른다.
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export function upFromOrientation(betaDeg, gammaDeg) {
  const b = betaDeg * D2R, g = gammaDeg * D2R;
  const cb = Math.cos(b);
  return normalize([-cb * Math.sin(g), Math.sin(b), cb * Math.cos(g)]);
}

export function normalize(v) {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

// 화면이 회전된 경우(가로 UI) 기기 좌표 → 화면 좌표로 회전
export function toScreenFrame(u, screenAngleDeg) {
  const a = (screenAngleDeg || 0) * D2R;
  const c = Math.cos(a), s = Math.sin(a);
  return [u[0] * c - u[1] * s, u[0] * s + u[1] * c, u[2]];
}

export function wrap180(d) {
  let x = ((d + 180) % 360 + 360) % 360 - 180;
  if (x === -180) x = 180;
  return x;
}

export function wrap360(d) {
  return ((d % 360) + 360) % 360;
}

// 평면(화면이 위를 향하도록 눕힘) 모드 각도
// x: 좌우 기울기(+ = 왼쪽이 낮음), y: 전후 기울기(+ = 위쪽(상단)이 높음 → 하단이 낮음)
export function flatAngles(u) {
  const ax = Math.atan2(-u[0], u[2]) * R2D;   // 오른쪽이 낮으면 u[0]<0 → ax>0
  const ay = Math.atan2(u[1], u[2]) * R2D;
  const total = Math.acos(Math.max(-1, Math.min(1, u[2]))) * R2D;
  return { x: ax, y: ay, total };
}

// 세움(가장자리) 모드: 화면 평면 안에서의 회전각 0~360°
// 0° = 세로로 똑바로 세움, 90° = 시계방향으로 눕힌 가로, 180°, 270°
export function edgeAngles(u) {
  const rot = wrap360(Math.atan2(-u[0], u[1]) * R2D);
  const k = Math.round(rot / 90) % 4;
  const dev = wrap180(rot - k * 90);                 // 가장 가까운 기준(0/90/180/270)과의 차이
  const orientation = (k % 2 === 0) ? 'vertical' : 'horizontal';
  const outOfPlane = Math.asin(Math.max(-1, Math.min(1, u[2]))) * R2D; // 화면이 수직면에서 앞뒤로 기운 정도
  return { rot, k, dev, orientation, outOfPlane };
}

// 자동 모드: 화면이 위/아래를 향하면 평면, 서 있으면 세움 (히스테리시스 포함)
export function pickMode(u, prev) {
  const az = Math.abs(u[2]);
  if (prev === 'flat') return az < 0.62 ? 'edge' : 'flat';
  if (prev === 'edge') return az > 0.78 ? 'flat' : 'edge';
  return az > 0.707 ? 'flat' : 'edge';
}

export function judge(absDeg, t1, t2) {
  if (absDeg <= t1) return 'ok';
  if (absDeg <= t2) return 'near';
  return 'bad';
}

export const STATE_LABEL = { ok: '매우 정확한 수평', near: '거의 수평', bad: '기울어짐' };

// 지수 이동 평균 필터 (벡터)
export class VectorFilter {
  constructor(alpha) { this.alpha = alpha; this.v = null; }
  push(u) {
    if (!this.v) { this.v = u.slice(); return this.v; }
    const a = this.alpha;
    this.v = normalize([this.v[0] + a * (u[0] - this.v[0]), this.v[1] + a * (u[1] - this.v[1]), this.v[2] + a * (u[2] - this.v[2])]);
    return this.v;
  }
  reset() { this.v = null; }
}

export const SMOOTHING_ALPHA = { low: 0.35, mid: 0.15, high: 0.06 };

// 최근 값의 표준편차로 안정 여부 판단
export class StabilityMeter {
  constructor(n = 30) { this.n = n; this.buf = []; }
  push(x) { this.buf.push(x); if (this.buf.length > this.n) this.buf.shift(); }
  std() {
    const b = this.buf; if (b.length < 5) return Infinity;
    const m = b.reduce((s, x) => s + x, 0) / b.length;
    return Math.sqrt(b.reduce((s, x) => s + (x - m) * (x - m), 0) / b.length);
  }
  reset() { this.buf = []; }
}
