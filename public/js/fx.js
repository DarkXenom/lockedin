// fx.js — confetti, sounds, toasts. juice, but restrained.
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
  send: () => tone(880, 0.07, 'triangle', 0.05),
  msg: () => tone(620, 0.08, 'triangle', 0.04),
  coin: () => { tone(988, 0.07, 'square', 0.05); tone(1319, 0.12, 'square', 0.05, 0.07); },
  yes: () => { tone(523, 0.09, 'square', 0.05); tone(659, 0.09, 'square', 0.05, 0.09); tone(784, 0.16, 'square', 0.05, 0.18); },
  levelup: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.11, 'square', 0.05, i * 0.09)); },
  shame: () => { tone(180, 0.25, 'sawtooth', 0.06); tone(120, 0.35, 'sawtooth', 0.06, 0.2); },
  freeze: () => { tone(1400, 0.1, 'sine', 0.05); tone(1100, 0.18, 'sine', 0.05, 0.1); },
};

// ---------------- confetti (pixel squares) ----------------
const COLORS = ['#c8ff1f', '#8b5cf6', '#4dd7ff', '#ffb020', '#ff7ad9'];
let particles = [];
let rafId = null;
const canvas = () => document.getElementById('confetti');

export function confetti(count = 90) {
  const c = canvas();
  if (!c) return;
  c.width = innerWidth; c.height = innerHeight;
  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * c.width,
      y: -10 - Math.random() * 100,
      vx: (Math.random() - 0.5) * 2.4,
      vy: 1.8 + Math.random() * 3,
      size: 4 + Math.random() * 5,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.18,
    });
  }
  if (!rafId) loop();
}
function loop() {
  const c = canvas();
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  particles = particles.filter(p => p.y < c.height + 20);
  for (const p of particles) {
    p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vy += 0.04;
    g.save();
    g.translate(p.x, p.y); g.rotate(p.rot);
    g.fillStyle = p.color;
    g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
    g.restore();
  }
  if (particles.length) rafId = requestAnimationFrame(loop);
  else { rafId = null; g.clearRect(0, 0, c.width, c.height); }
}

// ---------------- shame fx ----------------
export function shameFx() {
  sounds.shame();
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
  if (!root || root.children.length >= 3) return; // no toast spam
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

// ---------------- pixel flame (topbar streak) ----------------
export function flamePixels(streak) {
  let color = '#3a3a50';
  if (streak >= 30) color = '#b75cff';
  else if (streak >= 7) color = '#4dd7ff';
  else if (streak >= 1) color = '#ff7a1a';
  const core = streak >= 1 ? '#ffd23f' : '#2a2a3c';
  return `
    <rect x="3" y="0" width="2" height="2" fill="${color}"/>
    <rect x="2" y="2" width="4" height="2" fill="${color}"/>
    <rect x="1" y="4" width="6" height="3" fill="${color}"/>
    <rect x="2" y="7" width="4" height="2" fill="${color}"/>
    <rect x="3" y="5" width="2" height="3" fill="${core}"/>
  `;
}
