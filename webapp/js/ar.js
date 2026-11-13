// WebXR(immersive-ar) 기반 AR 길이 측정
// - hit-test로 인식된 실제 평면 위에만 점을 찍는다(평면 미인식 시 측정 불가, 임의 값 출력 안 함)
// - anchors 지원 시 앵커로 점을 고정해 추적 보정에 따라 위치가 갱신된다
// - 모든 점은 동일한 XR 참조 공간('local') 좌표이며 거리는 3차원 유클리드 거리
import * as THREE from '../vendor/three.module.min.js';
import { loadSettings, saveSettings } from './settings.js';
import { formatLength, nextUnit } from './units.js';
import { toast, vibrate } from './ui.js';

const $ = id => document.getElementById(id);

export async function checkARSupport() {
  if (!window.isSecureContext) return { ok: false, code: 'https', msg: 'AR 카메라는 보안 연결(HTTPS)에서만 사용할 수 있습니다. https:// 주소로 접속해 주세요.' };
  if (!('xr' in navigator)) {
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return { ok: false, code: 'no-webxr', msg: ios
      ? 'iPhone/iPad의 Safari는 웹 AR(WebXR)을 지원하지 않아 웹앱에서는 AR 길이 측정을 할 수 없습니다. 수평기·기록 기능은 사용할 수 있습니다. (iPhone 기본 "측정" 앱을 이용해 주세요.)'
      : '이 브라우저는 WebXR을 지원하지 않습니다. Android의 Chrome 최신 버전에서 열어 주세요.' };
  }
  let supported = false;
  try { supported = await navigator.xr.isSessionSupported('immersive-ar'); } catch (e) { supported = false; }
  if (!supported) return { ok: false, code: 'no-ar', msg: '이 기기/브라우저는 AR 세션(immersive-ar)을 지원하지 않습니다. ARCore 지원 Android 기기의 Chrome이 필요합니다.' };
  return { ok: true, code: 'ok', msg: 'AR 측정을 사용할 수 있습니다. (Google Play 서비스 AR이 없으면 시작 시 설치 안내가 표시됩니다)' };
}

const READY_FRAMES = 15;          // 연속 평면 인식 프레임 수(약 0.25초) 이후 측정 허용
const FAR_WARN_M = 3.0;           // 카메라~측정점 거리 경고

export class ARMeasure {
  constructor({ onEnd, onSave }) {
    this.onEnd = onEnd; this.onSave = onSave;
    this.session = null;
    this.chains = [[]];   // 구간 묶음: 각 체인은 연속된 점 배열
    this.wantCapture = false;
    this.bindUI();
  }

  bindUI() {
    const overlay = $('arOverlay');
    // 오버레이 버튼 탭이 XR 'select'(점 추가)로 중복 처리되지 않도록 차단
    overlay.querySelectorAll('button').forEach(b => b.addEventListener('beforexrselect', ev => ev.preventDefault()));
    $('btnArClose').addEventListener('click', () => this.end());
    $('btnArAdd').addEventListener('click', () => this.addPoint());
    $('btnArUndo').addEventListener('click', () => this.undo());
    $('btnArNewSeg').addEventListener('click', () => this.newChain());
    $('btnArReset').addEventListener('click', () => this.resetAll());
    $('btnArUnit').addEventListener('click', () => { const s = saveSettings({ unit: nextUnit(loadSettings().unit) }); this.arToast(`단위: ${s.unit}`); this.refreshTotals(); });
    $('btnArSave').addEventListener('click', () => this.requestSave());
  }

  arToast(msg, ms = 2000) { toast(msg, ms, $('arToast')); }

  async start() {
    const overlay = $('arOverlay');
    overlay.hidden = false;
    this.resetState();
    let session;
    try {
      session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test', 'dom-overlay'],
        optionalFeatures: ['anchors', 'camera-access'],
        domOverlay: { root: overlay },
      });
    } catch (e) {
      overlay.hidden = true;
      throw new Error(this.describeStartError(e));
    }
    this.session = session;
    this.ended = false;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local');
    this.renderer.domElement.style.display = 'none';
    document.body.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 50);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.5));

    // 표적(레티클)
    const ring = new THREE.RingGeometry(0.035, 0.045, 40).rotateX(-Math.PI / 2);
    const dot = new THREE.CircleGeometry(0.006, 16).rotateX(-Math.PI / 2);
    this.reticle = new THREE.Group();
    this.reticleRing = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
    this.reticle.add(this.reticleRing, new THREE.Mesh(dot, new THREE.MeshBasicMaterial({ color: 0xffffff })));
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.scene.add(this.reticle);

    this.pointGeo = new THREE.SphereGeometry(0.008, 16, 12);
    this.pointMat = new THREE.MeshBasicMaterial({ color: 0x33d1ff });
    this.liveLineMat = new THREE.LineDashedMaterial({ color: 0x33d1ff, dashSize: 0.01, gapSize: 0.008 });
    this.liveLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), this.liveLineMat);
    this.liveLine.visible = false;
    this.scene.add(this.liveLine);

    session.addEventListener('end', () => this.onSessionEnd());
    session.addEventListener('select', () => this.addPoint());
    session.addEventListener('visibilitychange', () => {
      if (session.visibilityState !== 'visible') this.setStatus('일시 중지됨 — 앱으로 돌아오면 다시 인식합니다', 'bad');
    });

    await this.renderer.xr.setSession(session);
    this.viewerSpace = await session.requestReferenceSpace('viewer');
    this.hitTestSource = await session.requestHitTestSource({ space: this.viewerSpace });
    this.gl = this.renderer.getContext();
    this.cameraAccess = false;
    try {
      if (session.enabledFeatures ? session.enabledFeatures.includes('camera-access') : false) {
        this.glBinding = new XRWebGLBinding(session, this.gl);
        this.cameraAccess = true;
      }
    } catch (e) { this.cameraAccess = false; }
    this.anchorsSupported = !!(session.enabledFeatures && session.enabledFeatures.includes('anchors'));

    this.setStatus('평면을 찾는 중… 휴대폰을 천천히 움직여 주세요', null);
    this.renderer.setAnimationLoop((t, frame) => this.onFrame(t, frame));
  }

  describeStartError(e) {
    const n = e && e.name;
    if (n === 'NotAllowedError') return '카메라 권한이 거부되었거나 AR 시작이 취소되었습니다. 브라우저 사이트 설정에서 카메라를 허용한 뒤 다시 시도하세요.';
    if (n === 'NotSupportedError') return '이 기기는 필요한 AR 기능(평면 인식/화면 오버레이)을 지원하지 않습니다. Google Play 서비스 AR(ARCore)이 설치·업데이트되어 있는지 확인하세요.';
    if (n === 'SecurityError') return 'AR은 HTTPS 보안 연결과 사용자 터치로만 시작할 수 있습니다.';
    if (n === 'InvalidStateError') return '이미 AR 세션이 실행 중입니다. 잠시 후 다시 시도하세요.';
    return 'AR을 시작하지 못했습니다: ' + (e && e.message ? e.message : String(e)) + '\nGoogle Play 서비스 AR(ARCore) 설치 여부와 카메라 사용 중인 다른 앱을 확인하세요.';
  }

  resetState() {
    this.chains = [[]];
    this.readyFrames = 0;
    this.ready = false;
    this.lastHit = null;
    this.lastHitPos = null;
    this.prevCamPos = null; this.prevCamQuat = null; this.prevT = null;
    this.speed = 0; this.angSpeed = 0;
    this.tracking = 'init';
    $('arLabels').innerHTML = '';
    $('arLive').textContent = '-';
    $('arTotal').textContent = '';
    $('arHint').textContent = '';
  }

  setStatus(text, cls) {
    const el = $('arStatus');
    if (el.textContent !== text) el.textContent = text;
    el.className = 'ar-status' + (cls ? ' ' + cls : '');
  }

  onFrame(t, frame) {
    if (!frame) return;
    const refSpace = this.renderer.xr.getReferenceSpace();
    const pose = frame.getViewerPose(refSpace);
    const s = loadSettings();

    // 1) 추적 상태
    if (!pose) {
      this.tracking = 'lost';
      this.ready = false; this.readyFrames = 0;
      this.reticle.visible = false;
      this.setStatus('추적을 잃었습니다 — 카메라를 가리지 말고 천천히 움직이세요', 'bad');
      $('arCrosshair').classList.remove('ready');
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.tracking = pose.emulatedPosition ? 'limited' : 'normal';

    // 2) 흔들림 감지(카메라 이동/회전 속도)
    const p = pose.transform.position, o = pose.transform.orientation;
    const camPos = new THREE.Vector3(p.x, p.y, p.z);
    const camQuat = new THREE.Quaternion(o.x, o.y, o.z, o.w);
    if (this.prevCamPos && this.prevT) {
      const dt = Math.max(1e-3, (t - this.prevT) / 1000);
      const v = camPos.distanceTo(this.prevCamPos) / dt;
      const w = (camQuat.angleTo(this.prevCamQuat) * 180 / Math.PI) / dt;
      this.speed = this.speed * 0.85 + v * 0.15;
      this.angSpeed = this.angSpeed * 0.85 + w * 0.15;
    }
    this.prevCamPos = camPos; this.prevCamQuat = camQuat; this.prevT = t;
    const shaking = this.speed > 0.6 || this.angSpeed > 70;

    // 3) 앵커 위치 갱신
    for (const chain of this.chains) for (const pt of chain) {
      if (pt.anchor && frame.trackedAnchors && frame.trackedAnchors.has(pt.anchor)) {
        const ap = frame.getPose(pt.anchor.anchorSpace, refSpace);
        if (ap) { const q = ap.transform.position; pt.pos.set(q.x, q.y, q.z); pt.mesh.position.copy(pt.pos); }
      }
    }
    this.rebuildLines();

    // 4) 평면 hit-test
    const results = this.hitTestSource ? frame.getHitTestResults(this.hitTestSource) : [];
    if (results.length && this.tracking === 'normal') {
      const hp = results[0].getPose(refSpace);
      this.lastHit = results[0];
      this.reticle.visible = true;
      this.reticle.matrix.fromArray(hp.transform.matrix);
      this.lastHitPos = new THREE.Vector3(hp.transform.position.x, hp.transform.position.y, hp.transform.position.z);
      this.readyFrames++;
    } else {
      this.lastHit = null; this.lastHitPos = null;
      this.reticle.visible = false;
      this.readyFrames = 0;
    }
    this.ready = this.readyFrames >= READY_FRAMES;
    $('arCrosshair').classList.toggle('ready', this.ready);
    this.reticleRing.material.color.set(this.ready ? 0x2ee59d : 0xffffff);
    $('btnArAdd').disabled = !this.ready;

    if (this.tracking === 'limited') this.setStatus('추적이 불안정합니다 — 밝은 곳에서 무늬가 있는 표면을 비추세요', 'bad');
    else if (!this.lastHitPos) this.setStatus(this.pointCount() ? '표적이 평면을 벗어났습니다 — 측정할 표면을 비추세요' : '평면을 찾는 중… 휴대폰을 천천히 좌우로 움직이세요', null);
    else if (!this.ready) this.setStatus('평면 인식 중… 잠시 유지하세요', null);
    else this.setStatus(this.currentChain().length ? '종료점에 표적을 맞추고 탭하세요' : '시작점에 표적을 맞추고 탭하세요', 'ok');

    // 5) 안내 문구(흔들림·거리·조명)
    let hint = '';
    if (shaking) hint = '카메라가 흔들립니다 — 천천히 움직이세요';
    else if (this.lastHitPos && this.lastHitPos.distanceTo(camPos) > FAR_WARN_M) hint = `측정점이 ${this.lastHitPos.distanceTo(camPos).toFixed(1)}m 떨어져 있어 오차가 커질 수 있습니다. 가까이 가세요`;
    else if (this.tracking === 'limited') hint = '조명이 어둡거나 표면 특징점이 부족할 수 있습니다';
    else if (!this.lastHitPos && this.readyFramesLost > 180) hint = '평면을 찾지 못하고 있습니다 — 무늬 없는 흰 벽·유리·반사면은 인식이 어렵습니다';
    this.readyFramesLost = this.lastHitPos ? 0 : (this.readyFramesLost || 0) + 1;
    if ($('arHint').textContent !== hint) $('arHint').textContent = hint;

    // 6) 실시간 미리보기 선(마지막 점 → 표적)
    const chain = this.currentChain();
    const last = chain[chain.length - 1];
    if (last && this.lastHitPos) {
      const g = this.liveLine.geometry;
      g.setFromPoints([last.pos, this.lastHitPos]);
      this.liveLine.computeLineDistances();
      this.liveLine.visible = true;
    } else {
      this.liveLine.visible = false;
    }

    // 7) 사진 캡처 요청 처리 (카메라 영상 접근은 렌더 전에)
    if (this.wantCapture) this.captureFrame(frame, pose);

    this.renderer.render(this.scene, this.camera);
    this.updateLabels(s, last);
  }

  currentChain() { return this.chains[this.chains.length - 1]; }
  pointCount() { return this.chains.reduce((n, c) => n + c.length, 0); }

  addPoint() {
    if (!this.session) return;
    if (!this.ready || !this.lastHit || !this.lastHitPos) {
      this.arToast('아직 평면이 인식되지 않아 점을 찍을 수 없습니다. 표적이 초록색이 될 때까지 기다려 주세요.');
      return;
    }
    const pos = this.lastHitPos.clone();
    const mesh = new THREE.Mesh(this.pointGeo, this.pointMat);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    const pt = { pos, mesh, anchor: null };
    if (this.anchorsSupported && this.lastHit.createAnchor) {
      this.lastHit.createAnchor().then(a => { pt.anchor = a; }).catch(() => { /* 앵커 실패 시 고정 좌표 사용 */ });
    }
    this.currentChain().push(pt);
    vibrate(15);
    this.rebuildLines();
    this.refreshTotals();
  }

  undo() {
    let chain = this.currentChain();
    if (!chain.length && this.chains.length > 1) { this.chains.pop(); chain = this.currentChain(); }
    const pt = chain.pop();
    if (pt) { this.scene.remove(pt.mesh); if (pt.anchor && pt.anchor.delete) try { pt.anchor.delete(); } catch (e) { /* 무시 */ } }
    this.rebuildLines();
    this.refreshTotals();
  }

  newChain() {
    if (this.currentChain().length < 2) { this.arToast('현재 구간에 두 점 이상 찍은 뒤 새 구간을 시작할 수 있습니다.'); return; }
    this.chains.push([]);
    this.arToast('새 구간을 시작합니다. 다음 탭이 새 시작점입니다.');
    this.refreshTotals();
  }

  resetAll() {
    for (const c of this.chains) for (const pt of c) { this.scene.remove(pt.mesh); if (pt.anchor && pt.anchor.delete) try { pt.anchor.delete(); } catch (e) { /* 무시 */ } }
    this.chains = [[]];
    this.rebuildLines();
    this.refreshTotals();
    $('arLabels').innerHTML = '';
  }

  segments() {
    const segs = [];
    this.chains.forEach((c, ci) => {
      for (let i = 1; i < c.length; i++) {
        const a = c[i - 1].pos, b = c[i].pos;
        segs.push({ chain: ci, a: a.clone(), b: b.clone(), lengthM: a.distanceTo(b) });
      }
    });
    return segs;
  }

  // 측정선: WebGL 선 굵기(1px) 한계 때문에 얇은 원기둥 메시로 그려 실제 카메라 화면에서도 잘 보이게 함
  rebuildLines() {
    if (!this.lineGroup) {
      this.lineGroup = new THREE.Group(); this.scene.add(this.lineGroup);
      this.cylGeo = new THREE.CylinderGeometry(0.0025, 0.0025, 1, 10, 1, true);
      this.cylMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    }
    const segs = this.segments();
    while (this.lineGroup.children.length < segs.length) this.lineGroup.add(new THREE.Mesh(this.cylGeo, this.cylMat));
    while (this.lineGroup.children.length > segs.length) this.lineGroup.remove(this.lineGroup.children[this.lineGroup.children.length - 1]);
    const up = new THREE.Vector3(0, 1, 0);
    segs.forEach((sg, i) => {
      const m = this.lineGroup.children[i];
      const dir = sg.b.clone().sub(sg.a);
      const len = dir.length();
      m.visible = len > 1e-4;
      if (!m.visible) return;
      m.position.copy(sg.a).add(sg.b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(up, dir.normalize());
      m.scale.set(1, len, 1);
    });
  }

  refreshTotals() {
    const s = loadSettings();
    const segs = this.segments();
    const total = segs.reduce((n, x) => n + x.lengthM, 0);
    const el = $('arTotal');
    el.textContent = segs.length
      ? `마지막 ${formatLength(segs[segs.length - 1].lengthM, s.unit, s.decimals)} · ${segs.length}개 구간 · 합계 ${formatLength(total, s.unit, s.decimals)}`
      : '';
    // 큰 숫자: 진행 중인 구간(마지막 점→표적)의 실시간 거리는 updateLabels에서 갱신
    if (!this.currentChain().length) $('arLive').textContent = segs.length ? formatLength(total, s.unit, s.decimals) : '-';
  }

  project(v) {
    const cam = this.renderer.xr.getCamera();
    const p = v.clone().project(cam);
    if (p.z > 1 || p.z < -1) return null;
    return { x: (p.x + 1) / 2 * window.innerWidth, y: (1 - p.y) / 2 * window.innerHeight };
  }

  updateLabels(s, last) {
    const host = $('arLabels');
    const segs = this.segments();
    const items = segs.map(sg => ({ pos: sg.a.clone().add(sg.b).multiplyScalar(0.5), text: formatLength(sg.lengthM, s.unit, s.decimals), live: false }));
    if (last && this.lastHitPos) {
      const d = last.pos.distanceTo(this.lastHitPos);
      if (d >= 0.005) items.push({ pos: last.pos.clone().add(this.lastHitPos).multiplyScalar(0.5), text: formatLength(d, s.unit, s.decimals), live: true });
      $('arLive').textContent = formatLength(d, s.unit, s.decimals);
    } else if (last) {
      $('arLive').textContent = '표적을 평면에 맞추세요';
    }
    while (host.children.length < items.length) { const el = document.createElement('div'); el.className = 'ar-label'; host.appendChild(el); }
    while (host.children.length > items.length) host.lastChild.remove();
    items.forEach((it, i) => {
      const el = host.children[i];
      const sp = this.project(it.pos);
      if (!sp) { el.style.display = 'none'; return; }
      el.style.display = '';
      el.className = 'ar-label' + (it.live ? ' live' : '');
      if (el.textContent !== it.text) el.textContent = it.text;
      el.style.left = sp.x.toFixed(0) + 'px';
      el.style.top = sp.y.toFixed(0) + 'px';
    });
    this.refreshTotals();
  }

  requestSave() {
    const segs = this.segments();
    if (!segs.length) { this.arToast('저장할 측정 구간이 없습니다. 두 점 이상 찍어 주세요.'); return; }
    if (loadSettings().savePhoto) {
      this.wantCapture = true; // 다음 프레임에서 캡처 후 저장
    } else {
      this.finishSave(null);
    }
  }

  captureFrame(frame, pose) {
    this.wantCapture = false;
    const view = pose.views[0];
    const W = window.innerWidth, H = window.innerHeight;
    let photo = null;
    try {
      const canvas = document.createElement('canvas');
      let camW = W, camH = H, hasCamera = false;
      if (this.cameraAccess && view.camera && this.glBinding) {
        const tex = this.glBinding.getCameraImage(view.camera);
        camW = view.camera.width; camH = view.camera.height;
        const gl = this.gl;
        const fb = gl.createFramebuffer();
        const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
          const px = new Uint8Array(camW * camH * 4);
          gl.readPixels(0, 0, camW, camH, gl.RGBA, gl.UNSIGNED_BYTE, px);
          canvas.width = camW; canvas.height = camH;
          const ctx = canvas.getContext('2d');
          const img = ctx.createImageData(camW, camH);
          for (let y = 0; y < camH; y++) { // 상하 반전
            img.data.set(px.subarray((camH - 1 - y) * camW * 4, (camH - y) * camW * 4), y * camW * 4);
          }
          ctx.putImageData(img, 0, 0);
          hasCamera = true;
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
        gl.deleteFramebuffer(fb);
        this.renderer.resetState();
      }
      if (!hasCamera) {
        canvas.width = Math.round(W * 2); canvas.height = Math.round(H * 2); camW = canvas.width; camH = canvas.height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#0b0f14'; ctx.fillRect(0, 0, camW, camH);
      }
      this.drawOverlay(canvas, view, hasCamera);
      photo = canvas;
    } catch (e) {
      photo = null;
    }
    if (photo) photo.toBlob(b => this.finishSave(b), 'image/jpeg', 0.85);
    else this.finishSave(null);
  }

  drawOverlay(canvas, view, hasCamera) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const s = loadSettings();
    // XR 뷰의 투영 행렬로 3D 점 → 이미지 좌표
    const proj = new THREE.Matrix4().fromArray(view.projectionMatrix);
    const viewInv = new THREE.Matrix4().fromArray(view.transform.inverse.matrix);
    const toImg = v => {
      const p = new THREE.Vector4(v.x, v.y, v.z, 1).applyMatrix4(viewInv).applyMatrix4(proj);
      if (p.w <= 0) return null;
      return { x: (p.x / p.w + 1) / 2 * W, y: (1 - p.y / p.w) / 2 * H };
    };
    const scale = Math.max(1, W / 720);
    ctx.lineCap = 'round';
    const segs = this.segments();
    segs.forEach(sg => {
      const a = toImg(sg.a), b = toImg(sg.b); if (!a || !b) return;
      ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 7 * scale; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4 * scale; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      for (const q of [a, b]) { ctx.fillStyle = '#33d1ff'; ctx.beginPath(); ctx.arc(q.x, q.y, 9 * scale, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3 * scale; ctx.stroke(); }
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const text = formatLength(sg.lengthM, s.unit, s.decimals);
      ctx.font = `800 ${Math.round(26 * scale)}px ui-monospace, monospace`;
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      ctx.fillRect(m.x - tw / 2 - 10 * scale, m.y - 20 * scale, tw + 20 * scale, 40 * scale);
      ctx.fillStyle = '#0b0f14'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, m.x, m.y + 1);
    });
    // 하단 정보 띠
    const total = segs.reduce((n, x) => n + x.lengthM, 0);
    const d = new Date();
    const info = `${d.toLocaleString('ko-KR')} · ${segs.length}개 구간 · 합계 ${formatLength(total, s.unit, s.decimals)}`;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, H - 54 * scale, W, 54 * scale);
    ctx.fillStyle = '#fff'; ctx.font = `600 ${Math.round(20 * scale)}px system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(info, 16 * scale, H - 27 * scale);
    if (!hasCamera) {
      ctx.fillStyle = '#ffc94d'; ctx.font = `600 ${Math.round(18 * scale)}px system-ui, sans-serif`; ctx.textAlign = 'center';
      ctx.fillText('이 브라우저는 AR 카메라 영상 캡처를 허용하지 않아 측정선만 저장했습니다', W / 2, 40 * scale);
    }
  }

  finishSave(photoBlob) {
    const s = loadSettings();
    const segs = this.segments();
    const total = segs.reduce((n, x) => n + x.lengthM, 0);
    const rec = {
      type: 'length', unit: s.unit, totalM: total, value: total,
      segments: segs.map(sg => ({ chain: sg.chain, lengthM: sg.lengthM,
        a: { x: +sg.a.x.toFixed(4), y: +sg.a.y.toFixed(4), z: +sg.a.z.toFixed(4) },
        b: { x: +sg.b.x.toFixed(4), y: +sg.b.y.toFixed(4), z: +sg.b.z.toFixed(4) } })),
      photo: photoBlob || null,
      meta: { anchors: !!this.anchorsSupported, cameraPhoto: !!(photoBlob && this.cameraAccess), platform: 'web' },
    };
    Promise.resolve(this.onSave(rec)).then(ok => {
      if (ok) { this.arToast(`저장했습니다 (${segs.length}개 구간${photoBlob ? ', 사진 포함' : ''})`); vibrate([20, 30, 20]); }
    }).catch(e => this.arToast(e.message || '저장 실패', 4000));
  }

  lastResult() {
    return this.segments().map(sg => ({ chain: sg.chain, lengthM: sg.lengthM, a: sg.a, b: sg.b }));
  }

  end() {
    if (this.session) this.session.end().catch(() => this.onSessionEnd());
    else this.onSessionEnd();
  }

  onSessionEnd() {
    if (this.ended) return;
    this.ended = true;
    const result = this.lastResult();
    try { this.renderer && this.renderer.setAnimationLoop(null); } catch (e) { /* 무시 */ }
    try { this.hitTestSource && this.hitTestSource.cancel(); } catch (e) { /* 무시 */ }
    if (this.renderer) { this.renderer.dispose(); this.renderer.domElement.remove(); }
    this.renderer = null; this.session = null; this.hitTestSource = null;
    $('arOverlay').hidden = true;
    if (this.onEnd) { const cb = this.onEnd; cb(result); }
  }
}
