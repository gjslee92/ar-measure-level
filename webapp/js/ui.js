// 토스트·모달·피드백 유틸
let toastTimer = null;
export function toast(msg, ms = 2600, el = document.getElementById('toast')) {
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, ms);
}

export function modal(html, buttons = [{ label: '확인', value: true, primary: true }]) {
  const m = document.getElementById('modal');
  const body = document.getElementById('modalBody');
  const btns = document.getElementById('modalBtns');
  body.innerHTML = html;
  btns.innerHTML = '';
  return new Promise(resolve => {
    buttons.forEach(b => {
      const el = document.createElement('button');
      el.className = 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '');
      el.textContent = b.label;
      el.onclick = () => { m.hidden = true; resolve(b.value); };
      btns.appendChild(el);
    });
    m.hidden = false;
  });
}

export function confirmDialog(msg, okLabel = '확인', danger = false) {
  return modal(`<p>${msg}</p>`, [
    { label: '취소', value: false },
    { label: okLabel, value: true, primary: !danger, danger },
  ]);
}

export function vibrate(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* 미지원 */ }
}

let audioCtx = null;
export function beep(freq = 880, ms = 90) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = freq;
    g.gain.value = 0.08;
    o.connect(g); g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + ms / 1000);
  } catch (e) { /* 미지원 */ }
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
