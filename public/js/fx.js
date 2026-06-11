// fx.js — confetti, sounds, toasts, cinematics. juice, but restrained.
export const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

let muted = localStorage.getItem('li_muted') === '1';
export function isMuted() { return muted; }
export function setMuted(v) { muted = v; localStorage.setItem('li_muted', v ? '1' : '0'); }

// ---------------- sounds (WebAudio synth, zero assets) ----------------
let ctx = null;
function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
function tone(freq, dur, type = 'square', vol = 0.06, when = 0) {
  if (muted) return;
  try {
    const a = ac();
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, a.currentTime + when);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + when + dur);
    o.connect(g).connect(a.destination);
    o.start(a.currentTime + when);
    o.stop(a.currentTime + when + dur + 0.02);
  } catch { /* audio blocked */ }
}
export const sounds = {
  click: () => tone(720, 0.05, 'square', 0.04),
  tick: () => tone(980, 0.03, 'square', 0.03),
  send: () => tone(880, 0.07, 'triangle', 0.05),
  msg: () => tone(620, 0.08, 'triangle', 0.04),
  coin: () => { tone(988, 0.07, 'square', 0.05); tone(1319, 0.12, 'square', 0.05, 0.07); },
  yes: () => { tone(523, 0.09, 'square', 0.05); tone(659, 0.09, 'square', 0.05, 0.09); tone(784, 0.16, 'square', 0.05, 0.18); },
  levelup: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.11, 'square', 0.05, i * 0.09)); },
  shame: () => { tone(180, 0.25, 'sawtooth', 0.06); tone(120, 0.35, 'sawtooth', 0.06, 0.2); },
  freeze: () => { tone(1400, 0.1, 'sine', 0.05); tone(1100, 0.18, 'sine', 0.05, 0.1); },
  charge: () => tone(330, 0.08, 'sawtooth', 0.025),
};

// ---------------- particles (confetti + click blips, one canvas) ----------------
const COLORS = ['#c8ff1f', '#8b5cf6', '#4dd7ff', '#ffb020', '#ff7ad9'];
let particles = [];
let rafId = null;
const canvas = () => document.getElementById('confetti');

function ensureCanvas() {
  const c = canvas();
  if (!c) return null;
  if (c.width !== innerWidth || c.height !== innerHeight) { c.width = innerWidth; c.height = innerHeight; }
  return c;
}
export function confetti(count = 90) {
  if (REDUCED) return;
  const c = ensureCanvas();
  if (!c) return;
  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * c.width, y: -10 - Math.random() * 100,
      vx: (Math.random() - 0.5) * 2.4, vy: 1.8 + Math.random() * 3,
      size: 4 + Math.random() * 5,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.18,
      life: Infinity, gravity: 0.04,
    });
  }
  if (!rafId) loop();
}
export function blip(x, y, color = '#c8ff1f', count = 5) {
  if (REDUCED) return;
  const c = ensureCanvas();
  if (!c) return;
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const sp = 1 + Math.random() * 2.2;
    particles.push({
      x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 0.6,
      size: 2 + Math.random() * 2.5, color, rot: 0, vr: 0,
      life: 22 + Math.random() * 10, gravity: 0.12,
    });
  }
  if (!rafId) loop();
}
function loop() {
  const c = canvas();
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  particles = particles.filter(p => p.y < c.height + 20 && (p.life === Infinity || p.life-- > 0));
  for (const p of particles) {
    p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vy += p.gravity;
    g.save();
    g.translate(p.x, p.y); g.rotate(p.rot);
    g.fillStyle = p.color;
    if (p.life !== Infinity) g.globalAlpha = Math.min(1, p.life / 14);
    g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
    g.restore();
  }
  if (particles.length) rafId = requestAnimationFrame(loop);
  else { rafId = null; g.clearRect(0, 0, c.width, c.height); }
}

// global click blips on interactive elements — subtle, everywhere
document.addEventListener('pointerdown', e => {
  const t = e.target.closest('button, .tab, .chip');
  if (!t) return;
  blip(e.clientX, e.clientY, '#c8ff1f', 4);
}, { passive: true });

// ---------------- shame fx ----------------
export function shameFx() {
  sounds.shame();
  if (REDUCED) return;
  document.body.classList.add('red-flash');
  const app = document.getElementById('app');
  if (app) {
    app.classList.add('shame-shake');
    setTimeout(() => app.classList.remove('shame-shake'), 600);
  }
  setTimeout(() => document.body.classList.remove('red-flash'), 900);
}

// ---------------- toasts ----------------
export function toast(text, { tag = 'the ref', kind = '' } = {}) {
  const root = document.getElementById('toasts');
  if (!root || root.children.length >= 3) return;
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' t-' + kind : '');
  const tagEl = document.createElement('span');
  tagEl.className = 't-tag';
  tagEl.textContent = tag;
  el.appendChild(tagEl);
  el.appendChild(document.createTextNode(text));
  root.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 350);
  }, 4200);
}

// ---------------- count-up numbers ----------------
export function countUp(el, to, { duration = 500, prefix = '', suffix = '' } = {}) {
  const from = Number(String(el.textContent).replace(/[^\d.-]/g, '')) || 0;
  if (REDUCED || from === to) { el.textContent = prefix + to + suffix; return; }
  const start = performance.now();
  function frame(t) {
    const p = Math.min(1, (t - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = prefix + Math.round(from + (to - from) * eased) + suffix;
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ---------------- level-up cinematic ----------------
export function levelUpCinematic({ lv, name, badge }) {
  sounds.levelup();
  confetti(160);
  const overlay = document.createElement('div');
  overlay.className = 'cine' + (REDUCED ? ' cine-still' : '');
  overlay.innerHTML = `
    <div class="cine-inner">
      <div class="cine-label">promotion processed</div>
      <div class="cine-badge">${badge}</div>
      <div class="cine-lv">lv.${lv}</div>
      <div class="cine-name">${name}</div>
      <div class="cine-sub">tap to acknowledge the paperwork</div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => { overlay.classList.add('cine-out'); setTimeout(() => overlay.remove(), 350); };
  overlay.addEventListener('click', close);
  setTimeout(close, 6000);
}

// ---------------- pixel flame (topbar streak) ----------------
export function flamePixels(streak) {
  let color = '#3a3a50';
  if (streak >= 30) color = '#b75cff';
  else if (streak >= 7) color = '#4dd7ff';
  else if (streak >= 1) color = '#ff7a1a';
  const core = streak >= 1 ? '#ffd23f' : '#2a2a3c';
  const anim = streak >= 1 && !REDUCED ? '<animate attributeName="opacity" values="1;0.75;1;0.85;1" dur="1.6s" repeatCount="indefinite"/>' : '';
  return `
    <rect x="3" y="0" width="2" height="2" fill="${color}">${anim}</rect>
    <rect x="2" y="2" width="4" height="2" fill="${color}"/>
    <rect x="1" y="4" width="6" height="3" fill="${color}"/>
    <rect x="2" y="7" width="4" height="2" fill="${color}"/>
    <rect x="3" y="5" width="2" height="3" fill="${core}">${anim}</rect>
  `;
}
