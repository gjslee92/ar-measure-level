// 길이 단위 변환. 내부 값은 항상 미터(m).
export const UNITS = ['mm', 'cm', 'm'];
const FACTOR = { mm: 1000, cm: 100, m: 1 };

export function convert(meters, unit) {
  return meters * FACTOR[unit];
}

export function formatLength(meters, unit, decimals) {
  if (!Number.isFinite(meters)) return '-';
  const v = convert(meters, unit);
  return `${v.toFixed(decimals)} ${unit}`;
}

export function nextUnit(unit) {
  return UNITS[(UNITS.indexOf(unit) + 1) % UNITS.length];
}

export function formatAngle(deg, decimals = 1) {
  if (!Number.isFinite(deg)) return '--';
  // -0.0 방지
  const v = Math.abs(deg) < Math.pow(10, -decimals) / 2 ? 0 : deg;
  return `${v.toFixed(decimals)}°`;
}
