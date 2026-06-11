// bois.mjs — simulates squad members for multi-user audit
// usage: node test/bois.mjs <step>
import { io } from 'socket.io-client';

const BASE = 'http://localhost:3000';
async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${data && data.error}`);
  return data;
}
async function login(username, pin) {
  try { return await api('/login', { method: 'POST', body: { username, pin } }); }
  catch { return await api('/register', { method: 'POST', body: { username, pin } }); }
}
function say(token, text) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { token } });
    s.on('connect', () => {
      s.emit('chat:send', { text }, res => { s.disconnect(); res && res.ok ? resolve(res) : reject(new Error(JSON.stringify(res))); });
    });
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('socket timeout')), 5000);
  });
}

const step = process.argv[2];
const out = o => console.log(JSON.stringify(o, null, 1));

if (step === 'join') {
  // rohan + dev join the pact
  const rohan = await login('rohan', '1111');
  const dev = await login('dev', '2222');
  out({ rohan: rohan.user.username, dev: dev.user.username });
} else if (step === 'no-checkin') {
  // rohan files a NO with a suspicious excuse
  const rohan = await login('rohan', '1111');
  const r = await api('/checkin', { method: 'POST', token: rohan.token, body: { status: 'no', excuse: 'gym was "too crowded"' } });
  out({ checkin: r.checkin.status, aura: r.user.aura });
} else if (step === 'chat') {
  const rohan = await login('rohan', '1111');
  await say(rohan.token, 'crowded gym is a real thing bro');
  const dev = await login('dev', '2222');
  await say(dev.token, 'it was leg day. of course it was "crowded"');
  out({ sent: 2 });
} else if (step === 'dev-vote-cap') {
  const dev = await login('dev', '2222');
  const pending = await api('/excuse/pending', { token: dev.token });
  const target = pending.find(p => p.username === 'rohan');
  const r = await api(`/excuse/${target.id}/vote`, { method: 'POST', token: dev.token, body: { valid: false } });
  out(r);
} else if (step === 'dev-yes') {
  const dev = await login('dev', '2222');
  const r = await api('/checkin', { method: 'POST', token: dev.token, body: { status: 'yes', description: 'pull day. deadlifts moved. barely.' } });
  out({ xp: r.checkin.xp_delta, streak: r.checkin ? 'ok' : '?' });
} else if (step === 'dev-wager') {
  const dev = await login('dev', '2222');
  const d = new Date(Date.now() + 5 * 86400000);
  const deadline = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const r = await api('/wagers', { method: 'POST', token: dev.token, body: { title: 'most xp by sunday', stake: 'loser buys protein for everyone', deadline } });
  out(r);
} else if (step === 'join-wager') {
  const who = process.argv[3] || 'rohan';
  const pins = { rohan: '1111', dev: '2222', marcus: '3333' };
  const u = await login(who, pins[who]);
  const wagers = await api('/wagers', { token: u.token });
  const w = wagers.find(w => w.status === 'open');
  const r = await api(`/wagers/${w.id}/join`, { method: 'POST', token: u.token });
  out({ joined: w.id, who, ...r });
} else if (step === 'marcus-join') {
  const m = await login('marcus', '3333');
  out({ marcus: m.user.username });
} else if (step === 'marcus-rest') {
  const m = await login('marcus', '3333');
  const r = await api('/checkin', { method: 'POST', token: m.token, body: { status: 'rest' } });
  out({ status: r.checkin.status, over_quota: r.checkin.over_quota, aura_delta: r.checkin.aura_delta });
} else if (step === 'rohan-callout') {
  // rohan formally questions dev's whereabouts... wait dev trained. question pranav? pranav trained too.
  const rohan = await login('rohan', '1111');
  const squad = await api('/squad', { token: rohan.token });
  out(squad.members.map(m => ({ name: m.username, today: m.today && m.today.status })));
} else if (step === 'state') {
  const rohan = await login('rohan', '1111');
  const squad = await api('/squad', { token: rohan.token });
  out({
    meter: squad.meter, pace: squad.pacePct,
    members: squad.members.map(m => ({ n: m.username, xp: m.xp, aura: m.aura, streak: m.streak, lv: m.level.lv })),
  });
} else {
  console.log('steps: join | no-checkin | chat | dev-vote-cap | dev-yes | dev-wager | rohan-join-wager | state');
}
