// app.js — LOCKED IN client v2. router + views + motion.
import { api, token, setToken, connectSocket, getSocket } from './api.js';
import { avatarSvg, bodySvg } from './avatars.js';
import { badgeSvg } from './badges.js';
import {
  sounds, confetti, shameFx, toast, flamePixels, isMuted, setMuted,
  countUp, blip, levelUpCinematic, REDUCED,
} from './fx.js';

// debug surface (used by the audit harness; harmless in production)
window.__lockedin = { levelUpCinematic, badgeSvg };

// ---------------- state ----------------
let config = null;
let me = null;            // { user, inventory, today, todayDate }
let squad = null;
let currentTab = 'home';
let chatMessages = [];
let chatLoaded = false;
let unread = 0;
let statsUserId = null;
let pendingStatus = null;
let deferredInstall = null; // android beforeinstallprompt

const $ = sel => document.querySelector(sel);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const esc = s => String(s ?? '');
const myTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; } };

// ---------------- formatting ----------------
function fmtTime(ms) {
  const d = new Date(ms);
  let h = d.getHours(); const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}
function dayKey(ms) { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
function fmtDaySep(ms) {
  const d = new Date(ms);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((today - that) / 86400000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).toLowerCase();
}
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const STATUS_LABEL = { yes: 'went', rest: 'rest day', no: 'didn’t go', skip: 'skipped' };
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

// stagger cards after each view render
function stagger(view) {
  view.classList.remove('view-enter');
  void view.offsetWidth;
  view.classList.add('view-enter');
  [...view.children].forEach((c, i) => c.style.setProperty('--i', Math.min(i, 8)));
}

// hold-to-confirm — the signature interaction
function holdButton(label, hint, onComplete, { red = false, ms = 1000 } = {}) {
  const wrap = el('div');
  wrap.style.marginTop = '10px';
  const b = el('button', 'hold-btn' + (red ? ' hold-red' : ''));
  b.type = 'button';
  const fill = el('div', 'hold-fill');
  const lbl = el('span', 'hold-label', label);
  b.appendChild(fill);
  b.appendChild(lbl);
  wrap.appendChild(b);
  wrap.appendChild(el('div', 'hold-hint', hint));

  let raf = null, start = 0, busy = false, ticks = 0, suppressClickUntil = 0;
  const reset = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = null; start = 0; ticks = 0;
    b.classList.remove('holding');
    fill.style.width = '0%';
  };
  const complete = () => {
    if (busy) return;
    busy = true;
    suppressClickUntil = Date.now() + 1500; // the release click after a full hold must not re-fire
    b.classList.add('hold-done');
    if (navigator.vibrate) navigator.vibrate([15, 30, 25]);
    reset();
    fill.style.width = '100%';
    Promise.resolve()
      .then(onComplete)
      .catch(err => { toast(err.message || 'that didn’t work. try again.', { kind: 'red' }); sounds.shame(); })
      .finally(() => { busy = false; fill.style.width = '0%'; });
  };
  const frame = t => {
    if (!start) start = t;
    const p = Math.min(1, (t - start) / ms);
    fill.style.width = (p * 100) + '%';
    const tick = Math.floor(p * 4);
    if (tick > ticks) { ticks = tick; sounds.tick(); if (navigator.vibrate) navigator.vibrate(8); }
    if (p >= 1) { complete(); return; }
    raf = requestAnimationFrame(frame);
  };
  const begin = e => {
    if (busy || raf) return; // no re-entry mid-hold or mid-submit (multi-touch, double-tap)
    e.preventDefault();
    b.classList.add('holding');
    sounds.charge();
    raf = requestAnimationFrame(frame);
  };
  b.addEventListener('pointerdown', begin);
  b.addEventListener('pointerup', reset);
  b.addEventListener('pointerleave', reset);
  b.addEventListener('pointercancel', reset);
  // keyboard users (enter/space → click with detail 0) and reduced-motion users
  // get direct activation; pointer-generated clicks after a completed hold are suppressed.
  b.addEventListener('click', e => {
    if (busy || Date.now() < suppressClickUntil) return;
    if (e.detail === 0 || REDUCED) complete();
  });
  return wrap;
}

// ============================================================
// BOOT
// ============================================================
async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });

  config = await api('/config');
  $('#login-days').textContent = config.daysLeft;
  if (config.inviteRequired) $('#login-invite').classList.remove('hidden');
  if (token) {
    try {
      me = await api('/me');
      enterApp();
      return;
    } catch { setToken(null); }
  }
  showLogin();
}

function showLogin() {
  $('#login-screen').classList.remove('hidden');
  $('#app').classList.add('hidden');
}

let loginMode = 'login';
$('#tab-login').addEventListener('click', () => setLoginMode('login'));
$('#tab-register').addEventListener('click', () => setLoginMode('register'));
function setLoginMode(m) {
  loginMode = m;
  $('#tab-login').classList.toggle('active', m === 'login');
  $('#tab-register').classList.toggle('active', m === 'register');
  $('#login-submit').textContent = m === 'login' ? 'lock in' : 'sign the pact';
  $('#login-error').textContent = '';
}
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const username = $('#login-name').value.trim();
  const pin = $('#login-pin').value.trim();
  const inviteCode = $('#login-invite').value.trim();
  const btn = $('#login-submit');
  btn.disabled = true;
  try {
    const data = await api('/' + loginMode, { method: 'POST', body: { username, pin, inviteCode, tz: myTz() } });
    setToken(data.token);
    me = await api('/me');
    sounds.yes();
    enterApp();
  } catch (err) {
    $('#login-error').textContent = err.message;
    sounds.shame();
  } finally { btn.disabled = false; }
});

// ============================================================
// APP SHELL
// ============================================================
function enterApp() {
  $('#login-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  renderTopbar();
  setupSocket();
  setTab('home');
  runOnboarding().catch(err => toast(err.message || 'onboarding hiccup. it’ll retry next visit.', { kind: 'red' }));
}

function renderTopbar() {
  const u = me.user;
  countUp($('#chip-days'), config.daysLeft);
  countUp($('#chip-streak'), u.streak);
  countUp($('#chip-aura'), u.aura);
  countUp($('#chip-coins'), u.coins);
  $('#flame-g').innerHTML = flamePixels(u.streak);
  $('#btn-profile').innerHTML = avatarSvg(u.id, u.level.lv);
  if (squad && squad.winterArc) $('#winter-chip').classList.remove('hidden');
}

async function refreshMe() {
  me = await api('/me');
  renderTopbar();
}

// ---------------- tabs ----------------
document.querySelectorAll('.tab').forEach(t =>
  t.addEventListener('click', () => { sounds.click(); setTab(t.dataset.tab); }));

let renderGen = 0;
function setTab(name) {
  currentTab = name;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  if (name === 'chat') { unread = 0; updateBadge(); }
  const gen = ++renderGen;
  const view = $('#view');
  // render into a detached container; only the newest render gets mounted.
  // an in-flight stale render finishes appending into a node nobody sees.
  const container = el('div');
  const render = { home: renderHome, chat: renderChat, board: renderBoard, stats: renderStats, shop: renderShop }[name];
  render(container).then(() => {
    if (gen !== renderGen) return;
    view.innerHTML = '';
    view.appendChild(container);
    stagger(container);
    if (name === 'chat') scrollChat();
  }).catch(err => {
    if (gen !== renderGen) return;
    view.innerHTML = '';
    view.appendChild(el('div', 'empty', 'failed to load. ' + esc(err.message)));
  });
}
function updateBadge() {
  const b = $('#chat-badge');
  if (unread > 0) { b.textContent = unread > 9 ? '9+' : unread; b.classList.remove('hidden'); }
  else b.classList.add('hidden');
}

$('#btn-profile').addEventListener('click', () => { sounds.click(); openProfile(); });

// ============================================================
// ONBOARDING — constitution, then the before photo
// ============================================================
async function runOnboarding() {
  if (!me.user.signed) await showConstitutionModal({ mustSign: true });
  if (!me.user.hasBefore && !localStorage.getItem('li_photo_later_' + me.user.id)) await showBeforePhotoModal();
}

function modalShell() {
  const root = $('#modal-root');
  root.classList.remove('hidden');
  root.innerHTML = '';
  const modal = el('div', 'modal');
  root.appendChild(modal);
  return { root, modal };
}
function closeModal() { $('#modal-root').classList.add('hidden'); }

async function showConstitutionModal({ mustSign = false } = {}) {
  const { articles } = await api('/constitution');
  return new Promise(resolve => {
    const { modal } = modalShell();
    if (!mustSign) {
      const close = el('button', 'modal-close', '✕');
      close.addEventListener('click', () => { closeModal(); resolve(); });
      modal.appendChild(close);
    } else {
      const prog = el('div', 'onb-progress');
      prog.innerHTML = '<i class="on"></i><i></i>';
      modal.appendChild(prog);
    }
    const doc = el('div', 'constitution onb-step');
    doc.appendChild(el('h3', null, 'the constitution'));
    doc.appendChild(el('div', 'const-sub', 'of the shred pact · est. 2026 · binding'));
    for (const a of articles) {
      const art = el('div', 'const-art');
      art.appendChild(el('b', null, a.art));
      art.appendChild(el('p', null, a.text));
      doc.appendChild(art);
    }
    modal.appendChild(doc);
    if (mustSign) {
      const sign = el('div', 'const-sign');
      sign.appendChild(holdButton('hold to sign', 'signatures are permanent. like skipped leg days.', async () => {
        await api('/constitution/sign', { method: 'POST' });
        me.user.signed = true;
        sounds.yes();
        confetti(60);
        closeModal();
        resolve();
      }));
      modal.appendChild(sign);
    }
  });
}

async function showBeforePhotoModal() {
  return new Promise(resolve => {
    const { modal } = modalShell();
    const prog = el('div', 'onb-progress');
    prog.innerHTML = '<i class="on"></i><i class="on"></i>';
    modal.appendChild(prog);
    const step = el('div', 'onb-step');
    step.appendChild(el('div', 'card-title', 'the before photo'));
    const p = el('p', null, 'file the evidence. it stays sealed until dec 20, then sits next to your after photo while the squad compares. optional, but history will ask why you didn’t.');
    p.style.cssText = 'font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:14px';
    step.appendChild(p);
    const up = el('button', 'btn', 'choose photo');
    up.style.width = '100%';
    up.addEventListener('click', () => pickPhoto(async dataUrl => {
      up.disabled = true;
      try {
        await api('/photo', { method: 'POST', body: { kind: 'before', data: dataUrl } });
        me.user.hasBefore = true;
        sounds.coin();
        toast('before photo sealed. see you on dec 20.', { kind: 'volt' });
        closeModal();
        resolve();
      } catch (e) { toast(e.message, { kind: 'red' }); up.disabled = false; }
    }));
    step.appendChild(up);
    const skip = el('button', 'btn', 'later (coward)');
    skip.style.cssText = 'width:100%;margin-top:8px;color:var(--dim)';
    skip.addEventListener('click', () => { localStorage.setItem('li_photo_later_' + me.user.id, '1'); closeModal(); resolve(); });
    step.appendChild(skip);
    modal.appendChild(step);
  });
}

// photo picker + client-side compression (max 900px, jpeg)
function pickPhoto(cb) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    if (!f) return;
    const img = new Image();
    const url = URL.createObjectURL(f);
    img.onload = () => {
      const max = 900;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      cb(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('couldn’t read that image.', { kind: 'red' }); };
    img.src = url;
  });
  input.click();
}

// ============================================================
// PUSH NOTIFICATIONS
// ============================================================
function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
function urlB64(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
async function enablePush() {
  if (!pushSupported()) {
    if (isIOS() && !isStandalone()) throw new Error('on iphone: add to home screen first (share → add to home screen), then enable.');
    throw new Error('this browser doesn’t do push. try chrome, or install the app.');
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('permission denied. the ref respects boundaries. reluctantly.');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlB64(config.vapidPublic),
  });
  await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
  await api('/push/test', { method: 'POST' });
  return true;
}
async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
      await sub.unsubscribe();
    }
  } catch { /* best effort */ }
  await api('/push/toggle', { method: 'POST', body: { enabled: false } });
}

// ============================================================
// SOCKET
// ============================================================
let hadFirstConnect = false;
function setupSocket() {
  connectSocket({
    // after any reconnect (phone slept, network blip, server redeploy) the client
    // missed broadcasts — refetch instead of trusting a gap-riddled memory.
    'connect': async () => {
      if (!hadFirstConnect) { hadFirstConnect = true; return; }
      chatLoaded = false;
      try {
        await refreshMe();
        if (currentTab === 'chat' || currentTab === 'home' || currentTab === 'board') setTab(currentTab);
      } catch { /* next interaction recovers */ }
    },
    'chat:new': msg => {
      chatMessages.push(msg);
      if (currentTab === 'chat') {
        appendMessage($('#chat-scroll'), msg, true);
        scrollChat();
      } else if (msg.type === 'user' && (!msg.user || msg.user.id !== me.user.id)) {
        unread++; updateBadge(); sounds.msg();
      }
      if (msg.type === 'system') {
        toast(msg.text, { kind: msg.text.includes('−') ? 'red' : '' });
      }
    },
    'chat:react': ({ messageId, message }) => {
      const i = chatMessages.findIndex(m => m.id === messageId);
      if (i >= 0) chatMessages[i] = message;
      const row = document.querySelector(`[data-msgid="${messageId}"]`);
      if (row) renderReactions(row, message);
    },
    'chat:typing': ({ username }) => {
      const line = $('#typing-line');
      if (!line) return;
      line.textContent = `${username} is typing…`;
      clearTimeout(line._t);
      line._t = setTimeout(() => { line.textContent = ''; }, 2200);
    },
    'squad:update': async () => {
      await refreshMe();
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT' || ae.tagName === 'SELECT')) return;
      if (currentTab === 'home') setTab('home');
      else if (currentTab === 'board') setTab('board');
    },
    'fx': f => {
      if (f.userId === me.user.id) {
        if (f.kind === 'levelup') levelUpCinematic({ lv: f.level, name: f.name || '', badge: badgeSvg(f.level) });
        else if (f.kind === 'milestone') { confetti(100); sounds.levelup(); }
        else if (f.kind === 'checkin_yes') { sounds.yes(); }
        else if (f.kind === 'shame') { shameFx(); }
        else if (f.kind === 'callout') { shameFx(); toast('you have been formally called out. 48 hours.', { kind: 'amber' }); }
      }
    },
    'connect_error': err => {
      if (String(err.message).includes('unauthorized')) { setToken(null); location.reload(); }
    },
  });
}

// ============================================================
// HOME
// ============================================================
async function renderHome(view) {
  const [sq, today, tribunal, callouts] = await Promise.all([
    api('/squad'), api('/today'), api('/excuse/pending'), api('/callouts'),
  ]);
  squad = sq;
  renderTopbar();

  // install hint — once, dismissible
  if (!isStandalone() && !localStorage.getItem('li_hint_dismissed')) {
    const hint = el('div', 'install-hint');
    const txt = el('span', null, isIOS()
      ? 'install: share → add to home screen. unlocks push notifications from the ref.'
      : 'install the app for push notifications from the ref.');
    hint.appendChild(txt);
    if (!isIOS() && deferredInstall) {
      const ib = el('button', null, 'install');
      ib.style.cssText = 'color:var(--volt);font-family:var(--font-mono);font-size:11px';
      ib.addEventListener('click', async () => { deferredInstall.prompt(); });
      hint.appendChild(ib);
    }
    const x = el('button', null, '✕');
    x.addEventListener('click', () => { localStorage.setItem('li_hint_dismissed', '1'); hint.remove(); });
    hint.appendChild(x);
    view.appendChild(hint);
  }

  // hero countdown
  const hero = el('div', 'hero');
  const days = el('div', 'hero-days', '0');
  hero.appendChild(days);
  requestAnimationFrame(() => countUp(days, sq.daysLeft, { duration: 900 }));
  hero.appendChild(el('div', 'hero-label', 'days until dec 20. it doesn’t move. you do.'));
  if (config.pactDay > 0 && config.pactTotalDays) {
    hero.appendChild(el('div', 'hero-pace', `day ${config.pactDay} of ${config.pactTotalDays}. the pact began june 15.`));
  } else if (config.pactDay === 0) {
    hero.appendChild(el('div', 'hero-pace', 'the pact begins june 15. positions, gentlemen.'));
  }
  if (sq.pace) hero.appendChild(el('div', 'hero-pace', sq.pace));
  if (sq.winterArc) hero.appendChild(el('div', 'hero-pace', 'the winter arc is active. aura penalties are doubled.'));
  view.appendChild(hero);

  // squad meter
  const meterCard = el('div', 'card');
  meterCard.appendChild(el('div', 'card-title', 'squad status'));
  const meter = el('div', `meter ${sq.meter.key}`);
  const lbl = el('div', 'meter-label');
  lbl.appendChild(el('div', 'meter-state', sq.meter.label));
  lbl.appendChild(el('div', 'meter-sub', `${sq.meter.sub} — ${sq.meter.pct}% of squad-days handled this week`));
  const bar = el('div', 'meter-bar');
  const fill = el('div', 'meter-fill');
  fill.style.width = '0%';
  requestAnimationFrame(() => { fill.style.transition = 'width .8s cubic-bezier(.2,.8,.3,1)'; fill.style.width = sq.meter.pct + '%'; });
  bar.appendChild(fill);
  lbl.appendChild(bar);
  meter.appendChild(lbl);
  meter.appendChild(el('div', 'meter-pct', sq.meter.pct + '%'));
  meterCard.appendChild(meter);
  if (sq.pot.total > 0) {
    const potLine = el('div', 'meter-sub');
    potLine.style.marginTop = '10px';
    potLine.textContent = `the pot: ${config.pot.currency}${sq.pot.total} collected · ${config.pot.currency}${sq.pot.owed} outstanding (article ix)`;
    meterCard.appendChild(potLine);
  }
  view.appendChild(meterCard);

  // open callouts on me
  const onMe = callouts.rows.filter(c => c.status === 'open' && c.target === me.user.username);
  for (const c of onMe) {
    const left = Math.max(0, 48 - Math.floor((Date.now() - c.created_at) / 3600000));
    view.appendChild(el('div', 'callout-banner',
      `${c.caller} has formally questioned your whereabouts. post a workout within ${left}h or take −100 aura.`));
  }

  view.appendChild(buildCheckinCard());

  // tribunal
  const judgeable = tribunal.filter(t => t.user_id !== me.user.id);
  if (judgeable.length) {
    const tc = el('div', 'card');
    tc.appendChild(el('div', 'card-title', 'excuse tribunal — now in session'));
    for (const t of judgeable) tc.appendChild(buildTribunalRow(t));
    view.appendChild(tc);
  }

  // today's squad grid (everyone's own local today)
  const tg = el('div', 'card');
  tg.appendChild(el('div', 'card-title', 'the squad today — wherever today is'));
  if (!today.grid.length) tg.appendChild(el('div', 'empty', 'no bois yet. the wall sees nothing. the wall forgets nothing.'));
  for (const g of today.grid) {
    const row = el('div', 'today-row');
    const av = el('div', 'today-avatar');
    av.innerHTML = avatarSvg(g.id, g.level.lv, { grayscale: g.checkin && g.checkin.status === 'skip' });
    row.appendChild(av);
    const name = el('div', 'today-name', g.username + (g.id === me.user.id ? ' (you)' : ''));
    const sub = el('small');
    const tzTag = g.id !== me.user.id ? ` · ${g.localTime} there` : '';
    if (g.checkin && g.checkin.description) sub.textContent = g.checkin.description.slice(0, 60);
    else if (g.checkin && g.checkin.excuse) sub.textContent = '“' + g.checkin.excuse.slice(0, 50) + '”';
    else if (g.checkin) sub.textContent = 'checked in at ' + fmtTime(g.checkin.created_at);
    else sub.textContent = 'no word yet' + tzTag;
    name.appendChild(sub);
    row.appendChild(name);
    const pill = el('span', 'pill');
    if (!g.checkin) { pill.classList.add('p-pending'); pill.textContent = 'pending'; }
    else if (g.checkin.frozen) { pill.classList.add('p-frozen'); pill.textContent = 'frozen'; }
    else { pill.classList.add('p-' + g.checkin.status); pill.textContent = STATUS_LABEL[g.checkin.status]; }
    row.appendChild(pill);
    tg.appendChild(row);
  }
  view.appendChild(tg);
}

function buildCheckinCard() {
  const card = el('div', 'card');
  card.appendChild(el('div', 'card-title', 'today’s check-in — did you go gym'));

  const c = me.today;
  if (c && !c.auto) {
    const done = el('div', 'ci-done');
    const st = el('div', `ci-done-status s-${c.status}`,
      { yes: 'you went. noted.', rest: 'rest day. streak holds its breath.', no: 'a no. the tribunal has it.', skip: 'skipped. witnesses: everyone.' }[c.status]);
    done.appendChild(st);
    const sub = el('div', 'ci-done-sub');
    const parts = [];
    if (c.xp_delta) parts.push(`${c.xp_delta > 0 ? '+' : ''}${c.xp_delta} xp`);
    if (c.aura_delta) parts.push(`${c.aura_delta > 0 ? '+' : ''}${c.aura_delta} aura`);
    if (c.coin_delta > 0) parts.push(`+${c.coin_delta} coins`);
    parts.push('checked in at ' + fmtTime(c.created_at));
    sub.textContent = parts.join(' · ');
    done.appendChild(sub);
    card.appendChild(done);

    if (c.status === 'yes' || c.status === 'rest') {
      const desc = el('textarea', 'ci-desc');
      desc.placeholder = 'describe the workout. sets, lifts, crimes against leg day…';
      desc.value = c.description || '';
      desc.maxLength = 500;
      card.appendChild(desc);
      const save = el('button', 'btn btn-sm', 'save description');
      save.style.marginTop = '8px';
      save.addEventListener('click', async () => {
        try {
          const r = await api('/checkin/describe', { method: 'POST', body: { description: desc.value } });
          sounds.click();
          toast(r.bonus ? `description saved. +${r.bonus} xp for the detail.` : 'description saved.', { kind: 'volt' });
          await refreshMe();
        } catch (e) { toast(e.message, { kind: 'red' }); }
      });
      card.appendChild(save);
    }
    return card;
  }

  const grid = el('div', 'checkin-grid');
  const defs = [
    ['yes', 'YES', 'i went. obviously.', 'ci-yes'],
    ['rest', 'REST', 'recovery (2/week max)', 'ci-rest'],
    ['no', 'NO', 'honest L + excuse', 'ci-no'],
    ['skip', 'SKIP', 'don’t. seriously.', 'ci-skip'],
  ];
  const form = el('div');
  for (const [status, label, hint, cls] of defs) {
    const b = el('button', `ci-btn ${cls}`);
    b.type = 'button';
    b.appendChild(el('b', null, label));
    b.appendChild(el('span', null, hint));
    b.addEventListener('click', () => { sounds.click(); pendingStatus = status; renderCheckinForm(form); });
    grid.appendChild(b);
  }
  card.appendChild(grid);
  card.appendChild(form);
  return card;
}

function renderCheckinForm(form) {
  form.innerHTML = '';
  const status = pendingStatus;
  if (!status) return;

  if (status === 'yes') {
    const desc = el('textarea', 'ci-desc');
    desc.placeholder = 'what did you hit? (20+ chars = +10 xp. receipts matter.)';
    desc.maxLength = 500;
    form.appendChild(desc);
    form.appendChild(el('div', 'ci-hint', '+50 xp base · streak multiplier applies · +25 aura'));
    form.appendChild(holdButton('hold to lock it in', 'hold the button. like you held the bar.', () => submitCheckin('yes', { description: desc.value })));
  } else if (status === 'rest') {
    form.appendChild(el('div', 'ci-hint', 'rest pauses the streak — it won’t grow, it won’t die. 2 per week. a third becomes a punished skip.'));
    form.appendChild(holdButton('hold to rest', 'recovery is part of the program. allegedly.', () => submitCheckin('rest', {})));
  } else if (status === 'no') {
    const row = el('div', 'ci-excuse-row');
    const sel = el('select');
    for (const ex of config.excuses) {
      const o = el('option', null, ex);
      o.value = ex;
      sel.appendChild(o);
    }
    row.appendChild(sel);
    const custom = el('input');
    custom.placeholder = 'type the excuse. the squad votes on it.';
    custom.maxLength = 120;
    custom.classList.add('hidden');
    row.appendChild(custom);
    sel.addEventListener('change', () => {
      custom.classList.toggle('hidden', !sel.value.startsWith('other'));
    });
    form.appendChild(row);
    form.appendChild(el('div', 'ci-hint', '−50 aura · streak breaks · excuse goes to tribunal for a validity vote'));
    form.appendChild(holdButton('hold to file the excuse', 'the tribunal reads everything.', () => {
      const excuse = sel.value.startsWith('other') ? custom.value.trim() : sel.value;
      if (!excuse) { toast('an excuse is required. those are the rules.', { kind: 'red' }); return Promise.resolve(); }
      return submitCheckin('no', { excuse });
    }));
  } else if (status === 'skip') {
    form.appendChild(el('div', 'ci-hint', `−25 xp · −150 aura (double in winter arc) · streak dies · wall of shame · ${config.pot.currency}${config.pot.amount} to the pot. last chance to pick literally anything else.`));
    form.appendChild(holdButton('hold to take the L', 'three full seconds. think about it.', () => submitCheckin('skip', {}), { red: true, ms: 3000 }));
  }
}

async function submitCheckin(status, extra) {
  try {
    const r = await api('/checkin', { method: 'POST', body: { status, ...extra } });
    pendingStatus = null;
    if (r.levelUp) levelUpCinematic({ lv: r.levelUp.lv, name: r.levelUp.name, badge: badgeSvg(r.levelUp.lv) });
    else if (status === 'yes') { sounds.yes(); confetti(40); }
    else if (status === 'rest') sounds.freeze();
    await refreshMe();
    if (currentTab === 'home') setTab('home');
  } catch (e) {
    toast(e.message, { kind: 'red' });
    sounds.shame();
  }
}

function buildTribunalRow(t) {
  const row = el('div', 'trib-row');
  row.appendChild(el('div', 'trib-who', `${t.username} said no (${t.date})`));
  row.appendChild(el('div', 'trib-excuse', '“' + t.excuse + '”'));
  const actions = el('div', 'trib-actions');
  if (t.excuse_capped) {
    actions.appendChild(el('span', 'trib-capped', 'verdict: cap. archived under fiction.'));
  } else {
    const validBtn = el('button', 'vote-btn' + (t.myVote === 1 ? ' voted-valid' : ''), 'valid');
    const capBtn = el('button', 'vote-btn' + (t.myVote === 0 ? ' voted-cap' : ''), 'cap');
    const vote = async v => {
      try {
        await api(`/excuse/${t.id}/vote`, { method: 'POST', body: { valid: v } });
        sounds.click();
        if (currentTab === 'home') setTab('home');
      } catch (e) { toast(e.message, { kind: 'red' }); }
    };
    validBtn.addEventListener('click', () => vote(true));
    capBtn.addEventListener('click', () => vote(false));
    actions.appendChild(validBtn);
    actions.appendChild(capBtn);
  }
  actions.appendChild(el('span', 'trib-votes', `${t.valids} valid · ${t.caps} cap`));
  row.appendChild(actions);
  return row;
}

// ============================================================
// CHAT
// ============================================================
async function renderChat(view) {
  const wrap = el('div');
  wrap.id = 'chat-wrap';
  const scroll = el('div');
  scroll.id = 'chat-scroll';
  wrap.appendChild(scroll);
  const typing = el('div');
  typing.id = 'typing-line';
  wrap.appendChild(typing);

  const inputRow = el('div');
  inputRow.id = 'chat-input-row';
  const input = el('input');
  input.id = 'chat-input';
  input.placeholder = 'say something. it’s on the record.';
  input.maxLength = 1000;
  const send = el('button', null, 'send');
  send.id = 'chat-send';
  inputRow.appendChild(input);
  inputRow.appendChild(send);
  wrap.appendChild(inputRow);
  view.appendChild(wrap);

  const doSend = () => {
    const text = input.value.trim();
    if (!text) return;
    getSocket().emit('chat:send', { text }, res => {
      if (res && res.error) toast(res.error, { kind: 'red' });
    });
    input.value = '';
    sounds.send();
  };
  send.addEventListener('click', doSend);
  let lastTyping = 0;
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { doSend(); return; }
    if (Date.now() - lastTyping > 1500) { lastTyping = Date.now(); getSocket().emit('chat:typing'); }
  });

  if (!chatLoaded) {
    chatMessages = await api('/chat?limit=80');
    chatLoaded = true;
  }
  if (!chatMessages.length) {
    scroll.appendChild(el('div', 'empty', 'silence. the group chat equivalent of an empty gym.\nsay something.'));
  }
  let lastDay = null;
  for (const m of chatMessages) {
    if (dayKey(m.created_at) !== lastDay) {
      lastDay = dayKey(m.created_at);
      scroll.appendChild(el('div', 'msg-date-sep', '— ' + fmtDaySep(m.created_at) + ' —'));
    }
    appendMessage(scroll, m, false);
  }
  scrollChat();
}

function wrappedCardEl(meta) {
  const card = el('div', 'wrapped-card');
  const head = el('div', 'wrapped-head');
  head.appendChild(el('span', null, 'monthly wrapped'));
  head.appendChild(el('span', null, 'locked in'));
  card.appendChild(head);
  card.appendChild(el('div', 'wrapped-month', meta.monthLabel || ''));
  card.appendChild(el('div', 'wrapped-user', meta.username || ''));
  const grid = el('div', 'wrapped-grid');
  const cells = [
    [meta.sessions, 'workouts'],
    [meta.bestStreak, 'best streak'],
    [meta.xpGained, 'xp gained'],
    [(meta.auraDelta >= 0 ? '+' : '') + meta.auraDelta, 'aura swing', meta.auraDelta < 0],
    [meta.skips, 'skips', meta.skips > 0],
    [meta.messages, 'messages sent'],
  ];
  for (const [v, l, neg] of cells) {
    const s = el('div', 'wrapped-stat' + (neg ? ' w-neg' : ''));
    s.appendChild(el('b', null, String(v)));
    s.appendChild(el('span', null, l));
    grid.appendChild(s);
  }
  card.appendChild(grid);
  if (meta.superlative) {
    const sup = el('div', 'wrapped-sup');
    sup.appendChild(el('b', null, meta.superlative.title));
    sup.appendChild(el('span', null, meta.superlative.line));
    card.appendChild(sup);
  }
  return card;
}

function appendMessage(scroll, m, checkDaySep) {
  if (!scroll) return;
  if (checkDaySep) {
    const seps = scroll.querySelectorAll('.msg-date-sep');
    const lastSep = seps[seps.length - 1];
    const want = '— ' + fmtDaySep(m.created_at) + ' —';
    if (!lastSep || lastSep.textContent !== want) scroll.appendChild(el('div', 'msg-date-sep', want));
  }
  const empty = scroll.querySelector('.empty');
  if (empty) empty.remove();

  if (m.type === 'system') {
    const sys = el('div', 'msg-sys');
    sys.dataset.msgid = m.id;
    const tag = el('span', 'ref-tag', 'the ref · ' + fmtTime(m.created_at));
    sys.appendChild(tag);
    sys.appendChild(document.createTextNode(m.text));
    scroll.appendChild(sys);
    return;
  }
  if (m.type === 'wrapped') {
    const wrap = el('div', 'wrapped-msg');
    wrap.dataset.msgid = m.id;
    wrap.appendChild(wrappedCardEl(m.meta));
    addReactionUi(wrap, m);
    scroll.appendChild(wrap);
    return;
  }
  if (m.type === 'card') {
    const card = el('div', 'msg-card');
    card.dataset.msgid = m.id;
    const head = el('div', 'msg-card-head');
    head.appendChild(el('b', null, (m.meta.username || (m.user && m.user.username) || '?') + ' went gym'));
    head.appendChild(el('span', null, fmtTime(m.created_at)));
    card.appendChild(head);
    if (m.meta.description) card.appendChild(el('div', 'msg-card-desc', m.meta.description));
    const foot = el('div', 'msg-card-foot');
    foot.appendChild(el('span', null, `+${m.meta.xp} xp`));
    foot.appendChild(el('span', null, `streak ${m.meta.streak}`));
    card.appendChild(foot);
    addReactionUi(card, m);
    scroll.appendChild(card);
    return;
  }

  const mine = m.user && m.user.id === me.user.id;
  const row = el('div', 'msg' + (mine ? ' mine' : ''));
  row.dataset.msgid = m.id;
  const head = el('div', 'msg-head');
  head.appendChild(el('span', 'msg-author', m.user ? m.user.username : '?'));
  if (m.user) head.appendChild(el('span', 'msg-level' + (m.user.level.name === 'HIM' ? ' lv-him' : ''), 'lv.' + m.user.level.lv + ' ' + m.user.level.name));
  head.appendChild(el('span', 'msg-time', fmtTime(m.created_at)));
  row.appendChild(head);
  row.appendChild(el('div', 'msg-bubble', m.text));
  addReactionUi(row, m);
  scroll.appendChild(row);
}

function addReactionUi(row, m) {
  const rxRow = el('div', 'rx-row');
  rxRow.dataset.rxfor = m.id;
  row.appendChild(rxRow);
  paintReactions(rxRow, m);
}

function paintReactions(rxRow, m) {
  rxRow.innerHTML = '';
  const groups = {};
  for (const r of (m.reactions || [])) (groups[r.emoji] = groups[r.emoji] || []).push(r);
  for (const [emoji, rs] of Object.entries(groups)) {
    const mine = rs.some(r => r.user_id === me.user.id);
    const chip = el('button', 'rx-chip' + (mine ? ' mine' : ''));
    chip.type = 'button';
    chip.textContent = `${emoji} ${rs.length}`;
    chip.title = rs.map(r => r.username).join(', ');
    chip.addEventListener('click', () => react(m.id, emoji));
    rxRow.appendChild(chip);
  }
  const add = el('button', 'rx-add', '+');
  add.type = 'button';
  add.addEventListener('click', e => openReactionBar(e, m.id));
  rxRow.appendChild(add);
}

function renderReactions(row, m) {
  const rxRow = row.querySelector(`[data-rxfor="${m.id}"]`);
  if (rxRow) paintReactions(rxRow, m);
}

function react(messageId, emoji) {
  sounds.click();
  getSocket().emit('chat:react', { messageId, emoji }, res => {
    if (res && res.error) toast(res.error, { kind: 'red' });
  });
}

let rxBar = null;
function openReactionBar(e, messageId) {
  closeReactionBar();
  sounds.click();
  rxBar = el('div', 'rx-bar');
  for (const emoji of config.reactions) {
    const b = el('button', null, emoji);
    b.type = 'button';
    b.addEventListener('click', () => { react(messageId, emoji); closeReactionBar(); });
    rxBar.appendChild(b);
  }
  for (const s of config.stickers) {
    const b = el('button', 'rx-sticker', s);
    b.type = 'button';
    b.addEventListener('click', () => { react(messageId, s); closeReactionBar(); });
    rxBar.appendChild(b);
  }
  document.body.appendChild(rxBar);
  const rect = e.target.getBoundingClientRect();
  const barW = Math.min(320, innerWidth - 24);
  rxBar.style.left = Math.max(12, Math.min(rect.left, innerWidth - barW - 12)) + 'px';
  rxBar.style.top = Math.max(12, rect.top - rxBar.offsetHeight - 8) + 'px';
  setTimeout(() => document.addEventListener('click', closeOnOutside), 0);
}
function closeOnOutside(e) {
  if (rxBar && !rxBar.contains(e.target)) closeReactionBar();
}
function closeReactionBar() {
  if (rxBar) { rxBar.remove(); rxBar = null; document.removeEventListener('click', closeOnOutside); }
}

function scrollChat() {
  const s = $('#chat-scroll');
  if (s) s.scrollTop = s.scrollHeight;
}

// ============================================================
// BOARD (ranks / hall / bets+pot)
// ============================================================
let boardSub = 'ranks';
async function renderBoard(view) {
  const subtabs = el('div', 'subtabs');
  for (const [key, label] of [['ranks', 'ranks'], ['hall', 'fame & shame'], ['bets', 'bets & the pot']]) {
    const b = el('button', 'subtab' + (boardSub === key ? ' active' : ''), label);
    b.addEventListener('click', () => { sounds.click(); boardSub = key; setTab('board'); });
    subtabs.appendChild(b);
  }
  view.appendChild(subtabs);
  const body = el('div');
  view.appendChild(body);
  if (boardSub === 'ranks') await renderRanks(body);
  else if (boardSub === 'hall') await renderHall(body);
  else await renderBets(body);
  stagger(body);
}

let lbPeriod = 'week';
async function renderRanks(body) {
  const toggle = el('div', 'subtabs');
  for (const [key, label] of [['week', 'this week'], ['all', 'all time']]) {
    const b = el('button', 'subtab' + (lbPeriod === key ? ' active' : ''), label);
    b.addEventListener('click', () => { sounds.click(); lbPeriod = key; setTab('board'); });
    toggle.appendChild(b);
  }
  body.appendChild(toggle);

  const { rows } = await api('/leaderboard?period=' + lbPeriod);
  if (!rows.length) { body.appendChild(el('div', 'empty', 'nobody here. the leaderboard of an empty gym.')); return; }

  const podium = el('div', 'podium');
  for (const idx of [1, 0, 2]) {
    const r = rows[idx];
    const slot = el('div', `podium-slot p${idx + 1}`);
    if (r) {
      const box = el('div', 'podium-box');
      box.appendChild(el('div', 'podium-rank', '#' + (idx + 1)));
      const av = el('div', 'podium-avatar');
      av.innerHTML = avatarSvg(r.id, r.level.lv);
      box.appendChild(av);
      box.appendChild(el('div', 'podium-name', r.username));
      box.appendChild(el('div', 'podium-xp', r.score + ' xp'));
      slot.appendChild(box);
    }
    podium.appendChild(slot);
  }
  body.appendChild(podium);

  const card = el('div', 'card');
  rows.forEach((r, i) => {
    const row = el('div', 'lb-row' + (r.id === me.user.id ? ' me' : ''));
    row.appendChild(el('div', 'lb-pos', '#' + (i + 1)));
    const av = el('div', 'lb-avatar');
    av.innerHTML = avatarSvg(r.id, r.level.lv);
    row.appendChild(av);
    const badge = el('div', 'lb-badge');
    badge.innerHTML = badgeSvg(r.level.lv);
    badge.title = r.level.name;
    row.appendChild(badge);
    const name = el('div', 'lb-name', r.username);
    name.appendChild(el('small', r.level.name === 'HIM' ? 'lv-him' : null, `lv.${r.level.lv} ${r.level.name}`));
    row.appendChild(name);
    for (const [v, l] of [[r.score, lbPeriod === 'week' ? 'xp this wk' : 'total xp'], [r.aura, 'aura'], [r.streak, 'streak']]) {
      const s = el('div', 'lb-stat');
      s.appendChild(el('b', null, String(v)));
      s.appendChild(document.createTextNode(l));
      row.appendChild(s);
    }
    card.appendChild(row);
  });
  body.appendChild(card);

  const sq = squad || await api('/squad');
  const rec = el('div', 'card');
  rec.appendChild(el('div', 'card-title', 'squad records'));
  const rrows = [
    ['longest streak ever', sq.records.longestStreakEver ? `${sq.records.longestStreakEver.username} — ${sq.records.longestStreakEver.v} days` : '—'],
    ['highest aura', sq.records.mostAura ? `${sq.records.mostAura.username} — ${sq.records.mostAura.v}` : '—'],
    ['total squad workouts', String(sq.records.totalWorkouts)],
    ['total skips (shameful)', String(sq.records.totalSkips)],
  ];
  for (const [k, v] of rrows) {
    const kv = el('div', 'kv-row');
    kv.appendChild(el('span', null, k));
    kv.appendChild(el('b', null, v));
    rec.appendChild(kv);
  }
  body.appendChild(rec);

  // the org chart — all ten titles
  const org = el('div', 'card');
  org.appendChild(el('div', 'card-title', 'the org chart — every rank in the pact'));
  for (const lvl of config.levels) {
    const row = el('div', 'lb-row');
    const badge = el('div', 'lb-badge');
    badge.innerHTML = badgeSvg(lvl.lv);
    row.appendChild(badge);
    const name = el('div', 'lb-name', lvl.name);
    name.appendChild(el('small', null, `lv.${lvl.lv} · ${lvl.xp} xp`));
    row.appendChild(name);
    if (me.user.level.lv === lvl.lv) row.appendChild(el('span', 'pill p-yes', 'you'));
    org.appendChild(row);
  }
  body.appendChild(org);
}

async function renderHall(body) {
  const { rows } = await api('/hall');
  const fame = rows.filter(r => r.kind === 'fame');
  const shame = rows.filter(r => r.kind === 'shame');

  const fc = el('div', 'card');
  fc.appendChild(el('div', 'card-title', 'hall of fame'));
  if (!fame.length) fc.appendChild(el('div', 'empty', 'empty. fame is earned weekly. go earn some.'));
  for (const h of fame) fc.appendChild(hallRow(h, 'fame'));
  body.appendChild(fc);

  const sc = el('div', 'card');
  sc.appendChild(el('div', 'card-title', 'wall of shame'));
  if (!shame.length) sc.appendChild(el('div', 'empty', 'nothing here. the wall sees nothing. the wall forgets nothing.'));
  for (const h of shame) sc.appendChild(hallRow(h, 'shame'));
  body.appendChild(sc);
}
function hallRow(h, kind) {
  const row = el('div', `hall-row h-${kind}`);
  row.appendChild(el('div', 'hall-icon', kind === 'fame' ? '◆' : '✕'));
  const bodyEl = el('div', 'hall-body');
  bodyEl.appendChild(el('div', 'hall-who', h.username));
  bodyEl.appendChild(el('div', 'hall-cap', h.caption));
  bodyEl.appendChild(el('div', 'hall-when', h.week + ' · ' + new Date(h.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toLowerCase()));
  row.appendChild(bodyEl);
  return row;
}

async function renderBets(body) {
  const [wagers, callouts, pot, sq] = await Promise.all([
    api('/wagers'), api('/callouts'), api('/pot'), squad ? Promise.resolve(squad) : api('/squad'),
  ]);
  squad = sq;

  // THE POT
  const potCard = el('div', 'card');
  potCard.appendChild(el('div', 'card-title', 'the pot — article ix'));
  const total = el('div', 'pot-total');
  total.appendChild(el('b', null, `${pot.config.currency}${pot.total}`));
  total.appendChild(el('span', null, `collected for the dec 20 dinner · ${pot.config.currency}${pot.owed} outstanding`));
  potCard.appendChild(total);
  for (const m of pot.byUser) {
    if (!m.total) continue;
    const row = el('div', 'pot-row');
    row.appendChild(el('span', null, m.username));
    const owed = el('span', 'pot-owed' + (m.owed ? '' : ' clear'), m.owed ? `owes ${pot.config.currency}${m.owed}` : 'settled');
    row.appendChild(owed);
    if (m.owed && (m.id === me.user.id)) {
      const settle = el('button', 'btn btn-sm', 'i paid');
      settle.addEventListener('click', async () => {
        try { await api('/pot/settle', { method: 'POST', body: {} }); sounds.coin(); setTab('board'); }
        catch (e) { toast(e.message, { kind: 'red' }); }
      });
      row.appendChild(settle);
    }
    potCard.appendChild(row);
  }
  if (!pot.byUser.some(m => m.total)) potCard.appendChild(el('div', 'empty', 'pot is empty. either the squad is locked in or nobody has been caught yet.'));
  // pot config
  const cfg = el('div', 'pot-cfg');
  const amt = el('input');
  amt.type = 'number'; amt.value = pot.config.amount; amt.min = 0;
  const cur = el('input');
  cur.value = pot.config.currency; cur.maxLength = 3; cur.style.width = '50px';
  const save = el('button', 'btn btn-sm', 'amend article iv');
  save.addEventListener('click', async () => {
    try {
      await api('/pot/config', { method: 'POST', body: { amount: Number(amt.value), currency: cur.value } });
      config.pot = { amount: Number(amt.value), currency: cur.value };
      sounds.coin(); setTab('board');
    } catch (e) { toast(e.message, { kind: 'red' }); }
  });
  cfg.appendChild(cur); cfg.appendChild(amt); cfg.appendChild(save);
  potCard.appendChild(cfg);
  const constBtn = el('button', 'btn btn-sm', 'read the constitution');
  constBtn.style.marginTop = '10px';
  constBtn.addEventListener('click', () => showConstitutionModal());
  potCard.appendChild(constBtn);
  body.appendChild(potCard);

  // create wager
  const create = el('div', 'card wform');
  create.appendChild(el('div', 'card-title', 'open a wager — article vii'));
  const title = el('input'); title.placeholder = 'the bet. e.g. "most xp by sunday"'; title.maxLength = 80;
  const stake = el('input'); stake.placeholder = 'the stake. e.g. "loser buys protein"'; stake.maxLength = 120;
  const deadline = el('input'); deadline.type = 'date';
  const tomorrow = new Date(Date.now() + 86400000);
  deadline.min = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  create.appendChild(title); create.appendChild(stake); create.appendChild(deadline);
  const cbtn = el('button', 'btn', 'open it. it’s binding.');
  cbtn.style.width = '100%';
  cbtn.addEventListener('click', async () => {
    try {
      await api('/wagers', { method: 'POST', body: { title: title.value, stake: stake.value, deadline: deadline.value } });
      sounds.coin();
      setTab('board');
    } catch (e) { toast(e.message, { kind: 'red' }); }
  });
  create.appendChild(cbtn);
  body.appendChild(create);

  const wc = el('div', 'card');
  wc.appendChild(el('div', 'card-title', 'the ledger'));
  if (!wagers.length) wc.appendChild(el('div', 'empty', 'no wagers. cowardice, statistically.'));
  for (const w of wagers) wc.appendChild(wagerCard(w));
  body.appendChild(wc);

  const cc = el('div', 'card');
  cc.appendChild(el('div', 'card-title', 'formal callouts — article vi'));
  const others = sq.members.filter(m => m.id !== me.user.id);
  if (!others.length) cc.appendChild(el('div', 'empty', 'nobody to call out. recruit the bois.'));
  else if (callouts.usedThisWeek) cc.appendChild(el('div', 'empty', 'callout spent for this week. the power returns monday.'));
  else {
    const pickRow = el('div', 'settle-pick');
    for (const m of others) {
      const b = el('button', null, 'question ' + m.username);
      b.addEventListener('click', async () => {
        try {
          await api('/callouts', { method: 'POST', body: { targetId: m.id } });
          sounds.send();
          setTab('board');
        } catch (e) { toast(e.message, { kind: 'red' }); }
      });
      pickRow.appendChild(b);
    }
    cc.appendChild(pickRow);
  }
  for (const c of callouts.rows) {
    const row = el('div', 'co-row');
    row.appendChild(el('span', null, `${c.caller} → ${c.target}`));
    row.appendChild(el('span', `co-status ${c.status}`, c.status));
    cc.appendChild(row);
  }
  body.appendChild(cc);
}

function wagerCard(w) {
  const card = el('div', 'wager-card');
  card.appendChild(el('div', 'wager-title', w.title));
  card.appendChild(el('div', 'wager-meta', `stake: ${w.stake}\ndeadline ${w.deadline} · opened by ${w.creator} · ${w.status}`));
  const members = el('div', 'wager-members');
  for (const m of w.members) {
    members.appendChild(el('span', 'wager-member' + (m.is_loser ? ' loser' : '') + (m.paid ? ' paid' : ''),
      m.username + (m.is_loser ? (m.paid ? ' · paid' : ' · owes') : '')));
  }
  card.appendChild(members);

  const actions = el('div', 'wager-actions');
  const amMember = w.members.some(m => m.user_id === me.user.id);
  const amCreator = w.creator_id === me.user.id;

  if (w.status === 'open' && !amMember) {
    const join = el('button', 'btn btn-sm', 'join');
    join.addEventListener('click', async () => {
      try { await api(`/wagers/${w.id}/join`, { method: 'POST' }); sounds.coin(); setTab('board'); }
      catch (e) { toast(e.message, { kind: 'red' }); }
    });
    actions.appendChild(join);
  }
  if (w.status === 'open' && amCreator && w.members.length > 1) {
    const settle = el('button', 'btn btn-sm', 'settle — pick who lost');
    settle.addEventListener('click', () => {
      actions.innerHTML = '';
      const pickRow = el('div', 'settle-pick');
      const chosen = new Set();
      for (const m of w.members) {
        const b = el('button', null, m.username);
        b.addEventListener('click', () => {
          if (chosen.has(m.user_id)) { chosen.delete(m.user_id); b.classList.remove('picked'); }
          else { chosen.add(m.user_id); b.classList.add('picked'); }
        });
        pickRow.appendChild(b);
      }
      card.appendChild(pickRow);
      const confirm = el('button', 'btn btn-sm btn-danger', 'confirm losers');
      confirm.addEventListener('click', async () => {
        if (!chosen.size) { toast('pick at least one loser. that’s how losing works.', { kind: 'red' }); return; }
        try { await api(`/wagers/${w.id}/settle`, { method: 'POST', body: { loserIds: [...chosen] } }); sounds.shame(); setTab('board'); }
        catch (e) { toast(e.message, { kind: 'red' }); }
      });
      card.appendChild(confirm);
    });
    actions.appendChild(settle);
  }
  for (const m of w.members) {
    if (m.is_loser && !m.paid && (m.user_id === me.user.id || amCreator)) {
      const paid = el('button', 'btn btn-sm', `${m.user_id === me.user.id ? 'i' : m.username} paid up`);
      paid.addEventListener('click', async () => {
        try { await api(`/wagers/${w.id}/paid`, { method: 'POST', body: { userId: m.user_id } }); sounds.coin(); setTab('board'); }
        catch (e) { toast(e.message, { kind: 'red' }); }
      });
      actions.appendChild(paid);
    }
  }
  if (actions.children.length) card.appendChild(actions);
  return card;
}

// ============================================================
// STATS
// ============================================================
async function renderStats(view) {
  const sq = await api('/squad');
  squad = sq;
  if (!statsUserId || !sq.members.some(m => m.id === statsUserId)) statsUserId = me.user.id;

  const picker = el('div', 'member-picker');
  for (const m of sq.members) {
    const b = el('button', 'member-pick' + (m.id === statsUserId ? ' active' : ''));
    const av = el('span', 'mp-av');
    av.innerHTML = avatarSvg(m.id, m.level.lv);
    b.appendChild(av);
    b.appendChild(document.createTextNode(m.username));
    b.addEventListener('click', () => { sounds.click(); statsUserId = m.id; setTab('stats'); });
    picker.appendChild(b);
  }
  view.appendChild(picker);

  const s = await api('/stats/' + statsUserId);

  const grid = el('div', 'stat-grid');
  const cells = [
    [s.streak.current, 'current streak', 'volt'],
    [s.streak.longest, 'longest streak', ''],
    [s.yesRate + '%', 'gym rate', s.yesRate >= 60 ? 'volt' : s.yesRate >= 40 ? 'amber' : 'red'],
    [s.showUpRate + '%', 'shows up at all', ''],
    [s.user.aura, 'aura', 'purple'],
    [s.user.xp, 'lifetime xp', ''],
  ];
  for (const [num, lblTxt, color] of cells) {
    const c = el('div', 'stat-cell');
    c.appendChild(el('div', 'stat-num' + (color ? ' ' + color : ''), String(num)));
    c.appendChild(el('div', 'stat-lbl', lblTxt));
    grid.appendChild(c);
  }
  view.appendChild(grid);

  // monthly wrapped (latest)
  if (s.wrapped) {
    view.appendChild(wrappedCardEl({ ...s.wrapped, username: s.user.username }));
  }

  // photo vault
  const vaultCard = el('div', 'card');
  vaultCard.appendChild(el('div', 'card-title', 'the evidence locker'));
  const vault = el('div', 'vault');
  vault.appendChild(await vaultSlot(s.user.id, 'before', s.user.hasBefore));
  vault.appendChild(await vaultSlot(s.user.id, 'after', s.user.hasAfter));
  vaultCard.appendChild(vault);
  view.appendChild(vaultCard);

  // weekly receipt
  const receipt = el('div', 'receipt');
  receipt.style.marginBottom = '12px';
  const rh = el('div', 'receipt-head');
  rh.appendChild(el('span', null, 'weekly receipt'));
  rh.appendChild(el('span', null, 'locked in'));
  receipt.appendChild(rh);
  receipt.appendChild(el('div', 'receipt-name', s.user.username));
  receipt.appendChild(el('div', 'receipt-rank', `lv.${s.level.lv} ${s.level.name} · ${s.streak.current} day streak`));
  const week = el('div', 'receipt-week');
  const dayNames = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'];
  s.week.dates.forEach((d, i) => {
    const st = (s.week.map[d] || '').split(':')[0];
    const cell = el('div', 'receipt-day' + (st ? ' r-' + st : ''));
    cell.appendChild(el('i'));
    cell.appendChild(el('span', null, dayNames[i]));
    week.appendChild(cell);
  });
  receipt.appendChild(week);
  for (const [k, v] of [['xp this week', s.week.xp], ['rest days used', s.week.restUsed + ' / 2'], ['aura balance', s.user.aura], ['pot contributions', s.pot.contributed ? `${config.pot.currency}${s.pot.contributed}` : 'clean']]) {
    const rl = el('div', 'receipt-line');
    rl.appendChild(el('span', null, k));
    rl.appendChild(el('b', null, String(v)));
    receipt.appendChild(rl);
  }
  receipt.appendChild(el('div', 'receipt-foot', 'ripped by 12.20.26 or we’re cooked'));
  view.appendChild(receipt);

  // heatmap
  const hm = el('div', 'card');
  hm.appendChild(el('div', 'card-title', 'the chain — every day on record'));
  hm.appendChild(buildHeatmap(s.calendar));
  const legend = el('div', 'hm-legend');
  for (const [cls, lblTxt] of [['hm-yes', 'went'], ['hm-rest', 'rest'], ['hm-no', 'no'], ['hm-skip', 'skip'], ['hm-frozen', 'frozen']]) {
    const item = el('span');
    item.innerHTML = `<i class="${cls}" style="border:none"></i>${lblTxt}`;
    legend.appendChild(item);
  }
  hm.appendChild(legend);
  view.appendChild(hm);

  // chart
  if (s.series.length >= 2) {
    const ch = el('div', 'card');
    ch.appendChild(el('div', 'card-title', 'trajectory — last 30 days'));
    const wrap = el('div', 'chart-wrap');
    const canvas = el('canvas');
    wrap.appendChild(canvas);
    ch.appendChild(wrap);
    const lg = el('div', 'chart-legend');
    lg.innerHTML = '<span class="lg-xp">— xp</span><span class="lg-aura">— aura</span>';
    ch.appendChild(lg);
    view.appendChild(ch);
    requestAnimationFrame(() => drawChart(canvas, s.series));
  }

  // habits
  const habits = el('div', 'card');
  habits.appendChild(el('div', 'card-title', 'patterns — the data snitches'));
  const kvs = [
    ['usually checks in at', s.clock.avgTime || '—'],
    ['earliest ever', s.clock.earliest || '—'],
    ['latest ever', s.clock.latest || '—'],
    ['most reliable day', s.weekdays.best || 'not enough data'],
    ['most suspicious day', s.weekdays.worst || 'not enough data'],
    ['first of the squad to train', `${s.firstYes} ${s.firstYes === 1 ? 'day' : 'days'}`],
    ['days in the pact', `${s.daysIn} ${s.daysIn === 1 ? 'day' : 'days'}`],
    ['timezone', s.user.tz],
  ];
  for (const [k, v] of kvs) {
    const kv = el('div', 'kv-row');
    kv.appendChild(el('span', null, k));
    kv.appendChild(el('b', null, String(v)));
    habits.appendChild(kv);
  }
  view.appendChild(habits);

  // record
  const sheet = el('div', 'card');
  sheet.appendChild(el('div', 'card-title', 'the record'));
  const sheetKvs = [
    ['workouts logged', s.counts.yes],
    ['honest nos', s.counts.no],
    ['rest days', s.counts.rest],
    ['skips', s.counts.skip],
    ['hall of fame entries', s.hall.fame],
    ['wall of shame entries', s.hall.shame],
    ['excuses capped by tribunal', s.excuses.capped],
    ['wagers won', s.wagers.wins],
    ['wagers lost', s.wagers.losses],
    ['unpaid debts', s.wagers.unpaid],
    ['pot contributions', s.pot.contributed ? `${config.pot.currency}${s.pot.contributed}` : 0],
    ['messages sent', s.chat.messages],
    ['favorite reaction', s.chat.favReaction || '—'],
    ['reactions received', s.chat.reactionsReceived],
  ];
  for (const [k, v] of sheetKvs) {
    const kv = el('div', 'kv-row');
    kv.appendChild(el('span', null, k));
    kv.appendChild(el('b', null, String(v)));
    sheet.appendChild(kv);
  }
  view.appendChild(sheet);

  // excuse archive
  if (s.excuses.top.length) {
    const ex = el('div', 'card');
    ex.appendChild(el('div', 'card-title', 'excuse archive — filed under fiction'));
    for (const e2 of s.excuses.top) {
      const kv = el('div', 'kv-row');
      kv.appendChild(el('span', null, '“' + e2.excuse + '”'));
      kv.appendChild(el('b', null, e2.n + 'x'));
      ex.appendChild(kv);
    }
    view.appendChild(ex);
  }

  // ledger
  if (s.recent.length) {
    const led = el('div', 'card');
    led.appendChild(el('div', 'card-title', 'the ledger — recent transactions'));
    for (const ev of s.recent) {
      const row = el('div', 'ledger-row');
      row.appendChild(el('span', 'ledger-note', `${ev.kind.replace(/_/g, ' ')}${ev.note ? ' · ' + ev.note : ''}`));
      const parts = [];
      if (ev.xp_delta) parts.push(`${ev.xp_delta > 0 ? '+' : ''}${ev.xp_delta}xp`);
      if (ev.aura_delta) parts.push(`${ev.aura_delta > 0 ? '+' : ''}${ev.aura_delta}au`);
      if (ev.coin_delta) parts.push(`${ev.coin_delta > 0 ? '+' : ''}${ev.coin_delta}c`);
      const net = (ev.xp_delta + ev.aura_delta + ev.coin_delta) >= 0;
      row.appendChild(el('span', 'ledger-amt ' + (net ? 'pos' : 'neg'), parts.join(' ') || '0'));
      led.appendChild(row);
    }
    view.appendChild(led);
  }
}

async function vaultSlot(userId, kind, has) {
  const slot = el('div', 'vault-slot');
  const isMine = userId === me.user.id;
  const afterLocked = kind === 'after' && todayLocal() < config.goal;
  if (has) {
    try {
      const { data } = await api(`/photo/${userId}/${kind}`);
      const img = document.createElement('img');
      img.src = data;
      img.alt = kind;
      slot.appendChild(img);
      slot.appendChild(el('span', 'vault-tag', kind));
    } catch (e) {
      const lock = el('div', 'vault-locked');
      lock.innerHTML = e.status === 403
        ? `<span class="vault-lock-ico">▣</span>${kind} photo filed.<br>sealed until 12.20.26`
        : '<span class="vault-lock-ico">∅</span>photo unavailable';
      slot.appendChild(lock);
    }
  } else if (afterLocked) {
    const lock = el('div', 'vault-locked');
    lock.innerHTML = '<span class="vault-lock-ico">▣</span>the after photo<br>unlocks 12.20.26';
    slot.appendChild(lock);
  } else {
    const lock = el('div', 'vault-locked');
    lock.innerHTML = `<span class="vault-lock-ico">∅</span>no ${kind} photo filed`;
    slot.appendChild(lock);
    if (isMine) {
      const up = el('button', 'btn btn-sm', 'upload');
      up.style.marginTop = '8px';
      up.addEventListener('click', () => pickPhoto(async dataUrl => {
        try {
          await api('/photo', { method: 'POST', body: { kind, data: dataUrl } });
          sounds.coin();
          setTab('stats');
        } catch (e) { toast(e.message, { kind: 'red' }); }
      }));
      lock.appendChild(up);
    }
  }
  return slot;
}

function buildHeatmap(calendar) {
  const wrap = el('div', 'heatmap');
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - 7 * 16);
  const todayStr = todayLocal();
  for (let w = 0; w < 17; w++) {
    for (let d = 0; d < 7; d++) {
      const cur = new Date(start);
      cur.setDate(start.getDate() + w * 7 + d);
      const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
      const cell = el('div', 'hm-cell');
      cell.title = key;
      const c = calendar[key];
      if (key > todayStr) cell.classList.add('hm-future');
      else if (c) {
        if (c.frozen) cell.classList.add('hm-frozen');
        else cell.classList.add('hm-' + c.status);
        cell.title = `${key} — ${c.frozen ? 'frozen' : c.status}`;
      }
      wrap.appendChild(cell);
    }
  }
  return wrap;
}

function drawChart(canvas, series) {
  const dpr = devicePixelRatio || 1;
  const w = canvas.clientWidth, h = 130;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  const pad = 6;
  const xs = series.map((_, i) => pad + (i / Math.max(1, series.length - 1)) * (w - pad * 2));
  function line(vals, color) {
    const min = Math.min(...vals), max = Math.max(...vals);
    const span = max - min || 1;
    g.beginPath();
    vals.forEach((v, i) => {
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      i ? g.lineTo(xs[i], y) : g.moveTo(xs[i], y);
    });
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.shadowColor = color;
    g.shadowBlur = 6;
    g.stroke();
    g.shadowBlur = 0;
  }
  line(series.map(p => p.xp), '#c8ff1f');
  line(series.map(p => p.aura), '#8b5cf6');
}

// ============================================================
// SHOP
// ============================================================
async function renderShop(view) {
  const shop = await api('/shop');

  const bal = el('div', 'shop-balance');
  const b = el('b', null, '0');
  bal.appendChild(b);
  requestAnimationFrame(() => countUp(b, shop.coins, { duration: 600 }));
  bal.appendChild(el('span', null, 'coins. earned, not given.'));
  view.appendChild(bal);

  if (shop.doubleXpDate) {
    const when = shop.doubleXpDate === shop.today ? 'today' : 'tomorrow';
    view.appendChild(el('div', 'boost-banner', `2x xp armed for ${when}. don’t waste it.`));
  }

  for (const item of config.shop) {
    const card = el('div', 'card');
    const row = el('div', 'shop-item');
    row.appendChild(el('div', 'shop-icon', item.icon));
    const bodyEl = el('div', 'shop-body');
    bodyEl.appendChild(el('div', 'shop-name', item.name));
    bodyEl.appendChild(el('div', 'shop-desc', item.desc));
    const held = shop.inventory[item.id] || 0;
    if (held > 0) bodyEl.appendChild(el('div', 'shop-held', `holding ${held}`));
    row.appendChild(bodyEl);
    const buy = el('button', 'shop-buy', item.price + 'c');
    const maxed = item.maxHold > 0 && held >= item.maxHold;
    buy.disabled = shop.coins < item.price || maxed;
    if (maxed) buy.textContent = 'max';
    buy.addEventListener('click', async () => {
      try {
        await api('/shop/buy', { method: 'POST', body: { itemId: item.id } });
        sounds.coin();
        await refreshMe();
        setTab('shop');
      } catch (e) { toast(e.message, { kind: 'red' }); sounds.shame(); }
    });
    row.appendChild(buy);
    card.appendChild(row);
    view.appendChild(card);
  }
}

// ============================================================
// PROFILE MODAL
// ============================================================
async function openProfile() {
  const data = await api('/me');
  me = data;
  const u = data.user;
  const { root, modal } = modalShell();

  const close = el('button', 'modal-close', '✕');
  close.addEventListener('click', () => closeModal());
  modal.appendChild(close);

  const top = el('div', 'profile-top');
  const av = el('div', 'profile-avatar');
  av.innerHTML = avatarSvg(u.id, u.level.lv);
  top.appendChild(av);
  top.appendChild(el('div', 'profile-name', u.username));
  const rank = el('div', 'profile-rank' + (u.level.name === 'HIM' ? ' lv-him' : ''));
  const bdg = el('span', 'badge-svg');
  bdg.innerHTML = badgeSvg(u.level.lv);
  rank.appendChild(bdg);
  rank.appendChild(document.createTextNode(` lv.${u.level.lv} ${u.level.name}`));
  top.appendChild(rank);
  modal.appendChild(top);

  const bar = el('div', 'xpbar');
  const fill = el('div', 'xpbar-fill');
  fill.style.width = '0%';
  requestAnimationFrame(() => { fill.style.width = Math.round(u.level.progress * 100) + '%'; });
  bar.appendChild(fill);
  modal.appendChild(bar);
  modal.appendChild(el('div', 'xpbar-lbl', u.level.next
    ? `${u.xp} xp — ${u.level.next.xp - u.xp} more to "${u.level.next.name}"`
    : `${u.xp} xp — final form. maintain it.`));

  modal.appendChild(el('div', 'card-title', 'the evolution'));
  const strip = el('div', 'evo-strip');
  for (const lvl of config.levels) {
    const stage = el('div', 'evo-stage'
      + (u.level.lv >= lvl.lv ? ' reached' : '')
      + (u.level.lv === lvl.lv ? ' current' : ''));
    const sv = el('div');
    sv.innerHTML = bodySvg(u.id, lvl.lv, { grayscale: u.level.lv < lvl.lv });
    stage.appendChild(sv);
    stage.appendChild(el('small', null, lvl.name));
    strip.appendChild(stage);
  }
  modal.appendChild(strip);

  modal.appendChild(el('div', 'card-title', 'inventory'));
  if (!data.inventory.length) modal.appendChild(el('div', 'empty', 'empty. the shop exists for a reason.'));
  for (const inv of data.inventory) {
    const item = config.shop.find(i => i.id === inv.item_id);
    const row = el('div', 'inv-row');
    row.appendChild(el('span', null, (item ? item.icon + ' ' + item.name : inv.item_id)));
    row.appendChild(el('span', 'inv-qty', 'x' + inv.qty));
    modal.appendChild(row);
  }

  // notifications
  modal.appendChild(el('div', 'card-title', 'the ref in your pocket'));
  const pushBtn = el('button', 'btn', u.pushEnabled && pushSupported() ? 'notifications: checking…' : 'enable notifications');
  pushBtn.style.cssText = 'width:100%;margin-top:4px';
  (async () => {
    if (!pushSupported()) { pushBtn.textContent = isIOS() && !isStandalone() ? 'notifications: install app first' : 'notifications: unsupported here'; return; }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      pushBtn.textContent = (sub && u.pushEnabled) ? 'notifications: on (tap to disable)' : 'enable notifications';
      pushBtn.dataset.on = (sub && u.pushEnabled) ? '1' : '0';
    } catch { pushBtn.textContent = 'enable notifications'; }
  })();
  pushBtn.addEventListener('click', async () => {
    pushBtn.disabled = true;
    try {
      if (pushBtn.dataset.on === '1') {
        await disablePush();
        pushBtn.textContent = 'enable notifications';
        pushBtn.dataset.on = '0';
        toast('the ref has been silenced. he remembers this too.');
      } else {
        await enablePush();
        pushBtn.textContent = 'notifications: on (tap to disable)';
        pushBtn.dataset.on = '1';
        toast('notifications armed. a test was sent.', { kind: 'volt' });
      }
    } catch (e) { toast(e.message, { kind: 'red' }); }
    finally { pushBtn.disabled = false; }
  });
  modal.appendChild(pushBtn);

  // constitution
  const constBtn = el('button', 'btn', 'read the constitution');
  constBtn.style.cssText = 'width:100%;margin-top:8px';
  constBtn.addEventListener('click', () => showConstitutionModal());
  modal.appendChild(constBtn);

  // sound + logout
  const soundBtn = el('button', 'btn', isMuted() ? 'sound: off' : 'sound: on');
  soundBtn.style.cssText = 'width:100%;margin-top:8px';
  soundBtn.addEventListener('click', () => {
    setMuted(!isMuted());
    soundBtn.textContent = isMuted() ? 'sound: off' : 'sound: on';
    if (!isMuted()) sounds.coin();
  });
  modal.appendChild(soundBtn);

  const out = el('button', 'btn btn-danger', 'log out');
  out.style.cssText = 'width:100%;margin-top:8px';
  out.addEventListener('click', async () => {
    try { await api('/logout', { method: 'POST' }); } catch { /* already dead */ }
    setToken(null);
    location.reload();
  });
  modal.appendChild(out);

  root.addEventListener('click', e => { if (e.target === root) closeModal(); }, { once: true });
}

// go
boot().catch(err => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend',
    `<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#ff3b5c;font-family:monospace;font-size:13px;background:#08080c;z-index:200">server unreachable. is it running? (${esc(err.message)})</div>`);
});
