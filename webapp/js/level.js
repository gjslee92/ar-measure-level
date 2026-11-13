// 디지털 수평기 화면 컨트롤러
import { upFromOrientation, flatAngles, edgeAngles, pickMode, judge, STATE_LABEL,
  VectorFilter, SMOOTHING_ALPHA, StabilityMeter, wrap180, wrap360 } from './levelmath.js';
import { loadSettings, saveSettings } from './settings.js';
import { formatAngle } from './units.js';
import { toast, vibrate, beep, modal } from './ui.js';
import { addRecord } from './db.js';

const $ = id => document.getElementById(id);

export class LevelController {
  constructor() {
    this.running = false;
    this.filter = new VectorFilter(SMOOTHING_ALPHA.mid);
    this.stab = new StabilityMeter(30);
    this.autoMode = null;
    this.lastEventAt = 0;
    this.gotValidEvent = false;
    this.current = null;     // 마지막 계산 결과
    this.locked = null;      // 고정 각도
    this.prevState = null;
    this.calibStep = 0; this.calibFirst = null;
    this.onOrientation = this.onOrientation.bind(this);
    this.tick = this.tick.bind(this);
    this.bindUI();
  }

  bindUI() {
    document.querySelectorAll('.level-mode .seg').forEach(b => {
      b.addEventListener('click', () => { saveSettings({ levelMode: b.dataset.mode }); this.autoMode = null; this.syncModeButtons(); });
    });
    $('btnZero').addEventListener('click', () => this.zero());
    $('btnCalib2').addEventListener('click', () => this.calibTwoStep());
    $('btnResetCalib').addEventListener('click', () => this.resetCalib());
    $('btnLock').addEventListener('click', () => this.toggleLock());
    $('btnSaveAngle').addEventListener('click', () => this.save());
    $('btnSensorPermission').addEventListener('click', () => this.requestPermissionAndStart());
  }

  syncModeButtons() {
    const m = loadSettings().levelMode;
    document.querySelectorAll('.level-mode .seg').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  }

  needsPermission() {
    return typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
  }

  async enter() {
    this.syncModeButtons();
    this.updateCalibLine();
    $('sensorError').hidden = true;
    if (!('DeviceOrientationEvent' in window)) {
      this.showError('이 브라우저는 기울기 센서(DeviceOrientation)를 지원하지 않습니다.<br>Android Chrome 또는 iOS Safari에서 열어 주세요.');
      return;
    }
    if (!window.isSecureContext) {
      this.showError('센서는 보안 연결(HTTPS)에서만 사용할 수 있습니다.<br>https:// 주소로 접속해 주세요.');
      return;
    }
    // 먼저 수신을 시작하고, 이벤트가 오지 않으면(iOS 13+) 권한 버튼을 표시한다.
    this.start();
  }

  async requestPermissionAndStart() {
    try {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') {
        this.showError('동작 및 방향 센서 접근이 거부되었습니다.<br>설정 › Safari › "동작 및 방향 접근"을 켠 뒤 페이지를 새로고침하세요.');
        return;
      }
      this.permGranted = true;
      $('btnSensorPermission').hidden = true;
      this.stop();
      this.start();
    } catch (e) {
      this.showError('센서 권한을 요청하지 못했습니다: ' + (e && e.message ? e.message : e));
    }
  }

  start() {
    if (this.running) return;
    const s = loadSettings();
    this.filter = new VectorFilter(SMOOTHING_ALPHA[s.smoothing]);
    this.stab.reset();
    this.running = true;
    this.gotValidEvent = false;
    this.startedAt = performance.now();
    this.lastEventAt = 0;
    window.addEventListener('deviceorientation', this.onOrientation);
    this.raf = requestAnimationFrame(this.tick);
    try { screen.orientation && screen.orientation.lock && screen.orientation.lock('portrait').catch(() => {}); } catch (e) { /* 무시 */ }
  }

  stop() {
    this.running = false;
    window.removeEventListener('deviceorientation', this.onOrientation);
    cancelAnimationFrame(this.raf);
    this.filter.reset();
    this.rawUp = null;
  }

  showError(html) {
    const el = $('sensorError');
    el.innerHTML = html;
    el.hidden = false;
    $('levelState').textContent = '측정 불가';
    $('bigAngle').textContent = '--.-°';
    document.querySelector('[data-view="level"]').classList.remove('state-ok', 'state-near', 'state-bad');
  }

  onOrientation(e) {
    if (e.beta == null || e.gamma == null) return; // 데스크톱 등 센서 없는 환경의 빈 이벤트
    this.gotValidEvent = true;
    this.lastEventAt = performance.now();
    // 필터는 기기 좌표계 기준. 화면(UI) 회전각은 표시할 때만 반영한다.
    this.screenAngle = (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : (Number(window.orientation) || 0);
    this.rawUp = upFromOrientation(e.beta, e.gamma);
  }

  // 외부(테스트)에서 센서 값을 주입할 때 사용
  inject(beta, gamma) { this.onOrientation({ beta, gamma }); }

  tick() {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    const now = performance.now();
    if (!this.gotValidEvent) {
      if (now - this.startedAt > 1000 && this.needsPermission() && !this.permGranted) {
        if ($('btnSensorPermission').hidden) { $('btnSensorPermission').hidden = false; $('levelState').textContent = '센서 권한 필요 — 아래 버튼을 눌러 주세요'; }
        return;
      }
      if (now - this.startedAt > 2500 && $('sensorError').hidden) {
        this.showError('기울기 센서 데이터를 받지 못했습니다.<br>· 이 기기에 센서가 없거나(PC 등) 브라우저가 센서 접근을 막고 있을 수 있습니다.<br>· Chrome: 사이트 설정 › 동작 센서 허용을 확인하세요.');
      }
      return;
    }
    if (now - this.lastEventAt > 3000) {
      if (document.visibilityState === 'visible') {
        $('levelState').textContent = '센서 수신 중단 — 재연결 대기';
        document.querySelector('[data-view="level"]').classList.remove('state-ok', 'state-near', 'state-bad');
      }
      return;
    }
    $('sensorError').hidden = true;
    $('btnSensorPermission').hidden = true;
    // 필터는 화면 프레임마다 최신 센서값으로 갱신(이벤트 빈도와 무관하게 일정한 반응 속도)
    if (this.rawUp) this.filter.push(this.rawUp);
    this.compute();
    this.render();
  }

  compute() {
    const s = loadSettings();
    const u = this.filter.v;
    if (!u) return;
    let mode = s.levelMode;
    if (mode === 'auto') { this.autoMode = pickMode(u, this.autoMode); mode = this.autoMode; }
    const c = s.calib;
    let r;
    if (mode === 'flat') {
      const f = flatAngles(u);                       // 기기 좌표 기준(보정용)
      const x = f.x - c.flatX, y = f.y - c.flatY;
      // 화면이 가로로 회전된 경우 표시 방향을 화면 기준으로 회전
      const sa = (this.screenAngle || 0) * Math.PI / 180;
      const dx = x * Math.cos(sa) + y * Math.sin(sa);
      const dy = -x * Math.sin(sa) + y * Math.cos(sa);
      const primary = Math.max(Math.abs(x), Math.abs(y));
      r = { mode, a: dx, b: dy, rawA: f.x, rawB: f.y, primary, total: Math.hypot(x, y),
        // 평면 모드의 0~360°: 기기가 낮아지는 방향(화면 위쪽=0°, 시계방향)
        rotation: Math.hypot(x, y) < 0.1 ? NaN : wrap360(Math.atan2(dx, -dy) * 180 / Math.PI),
        state: judge(primary, s.t1, s.t2) };
    } else {
      const e = edgeAngles(u);
      const rot = wrap360(e.rot - c.edge);
      const k = Math.round(rot / 90) % 4;
      const dev = wrap180(rot - k * 90);
      const orientation = (k % 2 === 0) ? 'vertical' : 'horizontal';
      r = { mode, a: dev, b: e.outOfPlane, rawA: wrap180(e.rot - k * 90), primary: Math.abs(dev), rotation: rot, k, orientation,
        state: judge(Math.abs(dev), s.t1, s.t2) };
    }
    this.stab.push(r.a);
    r.stable = this.stab.std() < 0.08;
    this.current = r;

    if (r.state === 'ok' && this.prevState && this.prevState !== 'ok') {
      if (s.vibrate) vibrate(40);
      if (s.sound) beep(1046, 80);
    }
    this.prevState = r.state;
  }

  render() {
    const r = this.current; if (!r) return;
    const view = document.querySelector('[data-view="level"]');
    view.classList.remove('state-ok', 'state-near', 'state-bad');
    view.classList.add('state-' + r.state);
    $('bubbleWrap').hidden = r.mode !== 'flat';
    $('edgeWrap').hidden = r.mode !== 'edge';

    if (r.mode === 'flat') {
      // 버블은 높은 쪽으로 이동: 오른쪽이 낮으면(a>0) 버블은 왼쪽으로
      const lim = 12; // 가장자리 = 12°
      let bx = -r.a / lim, by = r.b / lim;
      const n = Math.hypot(bx, by); if (n > 1) { bx /= n; by /= n; }
      const wrap = $('bubbleWrap').clientWidth || 300;
      const rad = wrap * 0.42;
      $('bubble').style.transform = `translate(${(bx * rad).toFixed(1)}px, ${(-by * rad).toFixed(1)}px)`;
      $('lblA').textContent = '좌우';
      $('lblB').textContent = '전후';
      $('valA').textContent = formatAngle(Math.abs(r.a));
      $('valB').textContent = formatAngle(Math.abs(r.b));
      $('dirA').textContent = Math.abs(r.a) < 0.05 ? '수평' : (r.a > 0 ? '오른쪽이 낮음' : '왼쪽이 낮음');
      $('dirB').textContent = Math.abs(r.b) < 0.05 ? '수평' : (r.b > 0 ? '아래쪽(앞)이 낮음' : '위쪽(뒤)이 낮음');
      $('bigAngle').textContent = formatAngle(r.total);
    } else {
      // 다이얼을 실제 세계 기준으로 똑바로 보이도록 회전(기기 회전 + 화면 회전 상쇄)
      $('edgeWrap').style.transform = `rotate(${-(r.k * 90 + (this.screenAngle || 0))}deg)`;
      // 선 = 실제 수평선(기준). 십자선(기기 모서리)과 겹치면 수평/수직
      $('edgeLine').style.transform = `rotate(${-r.a}deg)`;
      // 원통형 버블: 높은 쪽으로 이동
      const tube = $('tube').clientWidth || 300;
      const px = Math.max(-1, Math.min(1, -r.a / 5)) * (tube / 2 - 34);
      $('tubeBubble').style.transform = `translateX(${px.toFixed(1)}px)`;
      const isV = r.orientation === 'vertical';
      $('lblA').textContent = isV ? '수직 오차' : '수평 오차';
      $('lblB').textContent = '앞뒤 기울기';
      $('valA').textContent = formatAngle(Math.abs(r.a));
      $('valB').textContent = formatAngle(Math.abs(r.b));
      $('dirA').textContent = Math.abs(r.a) < 0.05 ? (isV ? '수직' : '수평')
        : (isV ? (r.a > 0 ? '위쪽이 오른쪽으로' : '위쪽이 왼쪽으로') : (r.a > 0 ? '오른쪽이 낮음' : '왼쪽이 낮음'));
      $('dirB').textContent = Math.abs(r.b) < 0.5 ? '' : (r.b > 0 ? '화면이 위로 기움' : '화면이 아래로 기움');
      $('bigAngle').textContent = formatAngle(Math.abs(r.a));
    }
    $('valRot').textContent = formatAngle(r.rotation);
    $('valRot').previousElementSibling.textContent = r.mode === 'flat' ? '낮은 쪽 방향' : '회전각';
    const modeLabel = r.mode === 'flat' ? '평면' : (r.orientation === 'vertical' ? '수직' : '수평');
    $('levelState').textContent = `${modeLabel} · ${STATE_LABEL[r.state]}${r.stable ? '' : ' (흔들림)'}`;

    if (this.locked) {
      $('lockLine').hidden = false;
      const L = this.locked;
      if (L.mode === 'flat' && r.mode === 'flat') {
        $('lockRef').textContent = `좌우 ${formatAngle(L.a)} · 전후 ${formatAngle(L.b)}`;
        $('lockDelta').textContent = `좌우 ${formatAngle(r.a - L.a)} · 전후 ${formatAngle(r.b - L.b)}`;
      } else if (L.mode === 'edge' && r.mode === 'edge') {
        $('lockRef').textContent = `회전각 ${formatAngle(L.rotation)}`;
        $('lockDelta').textContent = formatAngle(wrap180(r.rotation - L.rotation));
      } else {
        $('lockRef').textContent = L.mode === 'flat' ? '평면 모드 기준' : '세움 모드 기준';
        $('lockDelta').textContent = '모드가 달라 비교 불가';
      }
    } else {
      $('lockLine').hidden = true;
    }
  }

  updateCalibLine() {
    const c = loadSettings().calib;
    $('calibLine').textContent = c.at
      ? `보정 적용됨 (${new Date(c.at).toLocaleString('ko-KR')}, ${c.method === 'two-step' ? '정밀 2단계' : '영점'}) · 평면 X ${c.flatX.toFixed(2)}° Y ${c.flatY.toFixed(2)}° / 세움 ${c.edge.toFixed(2)}°`
      : '보정값 없음 (공장 기본값)';
  }

  requireReading() {
    if (!this.current || !this.running) { toast('센서 값이 아직 없습니다. 잠시 후 다시 시도하세요.'); return false; }
    if (!this.current.stable) { toast('기기를 움직이지 말고 안정된 뒤 다시 눌러 주세요.'); return false; }
    return true;
  }

  zero() {
    if (!this.requireReading()) return;
    const r = this.current; const s = loadSettings();
    const calib = { ...s.calib, at: Date.now(), method: 'zero' };
    if (r.mode === 'flat') { calib.flatX = r.rawA; calib.flatY = r.rawB; }
    else { calib.edge = wrap180(s.calib.edge + r.a); }
    if (Math.abs(calib.flatX) > 15 || Math.abs(calib.flatY) > 15 || Math.abs(calib.edge) > 15) {
      toast('기울기가 너무 커서 영점으로 설정할 수 없습니다(15° 초과). 평평한 곳에 놓아 주세요.');
      return;
    }
    saveSettings({ calib });
    this.updateCalibLine();
    toast('영점 보정 완료: 현재 위치가 0°로 설정되었습니다.');
    vibrate([30, 40, 30]);
  }

  async calibTwoStep() {
    if (!this.requireReading()) return;
    const ok = await modal(
      `<h3>정밀 보정 (2단계)</h3><p>센서 자체 오차를 상쇄하는 방법입니다.</p>
       <p>1) 평평한 곳에 기기를 놓고 <b>측정 1</b>을 누릅니다.<br>2) 같은 자리에서 기기를 <b>180° 돌려</b> 놓고 <b>측정 2</b>를 누릅니다.<br>
       · 평면 모드: 화면이 위를 향한 채 수평으로 180° 회전<br>· 세움 모드: 같은 모서리를 바닥에 댄 채 화면이 반대쪽을 보도록 뒤집기</p>`,
      [{ label: '취소', value: false }, { label: '측정 1', value: true, primary: true }]);
    if (!ok) return;
    if (!this.requireReading()) return;
    const first = { ...this.current };
    const s0 = loadSettings();
    const ok2 = await modal('<p>이제 기기를 180° 돌려 같은 자리에 놓고, 움직임이 멈추면 <b>측정 2</b>를 누르세요.</p>',
      [{ label: '취소', value: false }, { label: '측정 2', value: true, primary: true }]);
    if (!ok2) return;
    if (!this.requireReading()) return;
    const second = { ...this.current };
    if (first.mode !== second.mode) { toast('두 측정의 모드가 다릅니다(평면/세움). 다시 시도하세요.'); return; }
    const calib = { ...s0.calib, at: Date.now(), method: 'two-step' };
    if (first.mode === 'flat') {
      calib.flatX = (first.rawA + second.rawA) / 2;
      calib.flatY = (first.rawB + second.rawB) / 2;
    } else {
      // rawA = 보정 전 편차
      calib.edge = (first.rawA + second.rawA) / 2;
    }
    saveSettings({ calib });
    this.updateCalibLine();
    toast('정밀 보정 완료');
    vibrate([30, 40, 30]);
  }

  resetCalib() {
    saveSettings({ calib: { flatX: 0, flatY: 0, edge: 0, at: null, method: null } });
    this.updateCalibLine();
    toast('보정값을 초기화했습니다.');
  }

  toggleLock() {
    if (this.locked) { this.locked = null; $('btnLock').textContent = '각도 고정'; toast('각도 고정을 해제했습니다.'); return; }
    if (!this.current) { toast('센서 값이 아직 없습니다.'); return; }
    this.locked = { ...this.current };
    $('btnLock').textContent = '고정 해제';
    toast('현재 각도를 기준으로 고정했습니다. 설치 작업 중 기준과의 차이가 표시됩니다.');
  }

  async save() {
    if (!this.current || !this.running) { toast('측정값이 없어 저장할 수 없습니다.'); return; }
    const r = this.current;
    const rec = {
      type: 'angle',
      value: r.mode === 'flat' ? r.total : Math.abs(r.a),
      unit: '°',
      detail: {
        mode: r.mode, orientation: r.orientation || null,
        labelA: $('lblA').textContent, labelB: $('lblB').textContent,
        a: r.a, b: r.b, rotation: r.rotation, state: STATE_LABEL[r.state],
        dirA: $('dirA').textContent, dirB: $('dirB').textContent,
        locked: this.locked && this.locked.mode === r.mode
          ? (r.mode === 'flat' ? { a: this.locked.a, b: this.locked.b, delta: Math.hypot(r.a - this.locked.a, r.b - this.locked.b) }
            : { rotation: this.locked.rotation, delta: wrap180(r.rotation - this.locked.rotation) }) : null,
        calibrated: !!loadSettings().calib.at,
      },
    };
    try {
      await addRecord(rec);
      toast('각도 기록을 저장했습니다.');
    } catch (e) {
      toast(e.message || '저장에 실패했습니다.', 4000);
    }
  }
}
