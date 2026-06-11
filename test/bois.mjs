// bois.mjs — simulates squad members for multi-user audits
// usage: node test/bois.mjs <step>
import { io } from 'socket.io-client';

const BASE = 'http://localhost:3000';
const PINS = { rohan: '1111', dev: '2222', marcus: '3333', kiri: '4444' };
const TZS = { rohan: 'America/New_York', dev: 'Asia/Kolkata', marcus: 'Pacific/Midway', kiri: 'Pacific/Kiritimati' };

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
async function login(username) {
  const pin = PINS[username];
  const tz = TZS[username];
  try { return await api('/login', { method: 'POST', body: { username, pin, tz } }); }
  catch {
    const r = await api('/register', { method: 'POST', body: { username, pin, tz } });
    await api('/constitution/sign', { method: 'POST', token: r.token });
    return r;
  }
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
const who = process.argv[3] || 'rohan';
const out = o => console.log(JSON.stringify(o, null, 1));

// 1x1 black jpeg for photo endpoint testing
const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

if (step === 'join') {
  const r = await login(who);
  out({ user: r.user.username, tz: r.user.tz, joined: r.user.joined });
} else if (step === 'yes') {
  const u = await login(who);
  const r = await api('/checkin', { method: 'POST', token: u.token, body: { status: 'yes', description: 'pull day. deadlifts moved. barely.' } });
  out({ xp: r.checkin.xp_delta, streak: r.user.streak, date: r.checkin.date });
} else if (step === 'no') {
  const u = await login(who);
  const r = await api('/checkin', { method: 'POST', token: u.token, body: { status: 'no', excuse: 'gym was "too crowded"' } });
  out({ status: r.checkin.status, aura: r.user.aura, date: r.checkin.date });
} else if (step === 'rest') {
  const u = await login(who);
  const r = await api('/checkin', { method: 'POST', token: u.token, body: { status: 'rest' } });
  out({ status: r.checkin.status, over_quota: r.checkin.over_quota, streak: r.user.streak });
} else if (step === 'skip') {
  const u = await login(who);
  const r = await api('/checkin', { method: 'POST', token: u.token, body: { status: 'skip' } });
  out({ status: r.checkin.status, aura: r.user.aura });
} else if (step === 'chat') {
  const rohan = await login('rohan');
  await say(rohan.token, 'crowded gym is a real thing bro');
  const dev = await login('dev');
  await say(dev.token, 'it was leg day. of course it was "crowded"');
  out({ sent: 2 });
} else if (step === 'vote-cap') {
  const u = await login(who);
  const pending = await api('/excuse/pending', { token: u.token });
  const target = pending.find(p => p.username !== who);
  const r = await api(`/excuse/${target.id}/vote`, { method: 'POST', token: u.token, body: { valid: false } });
  out(r);
} else if (step === 'photo') {
  const u = await login(who);
  const r = await api('/photo', { method: 'POST', token: u.token, body: { kind: 'before', data: TINY_JPEG } });
  out(r);
} else if (step === 'push-sub') {
  const u = await login(who);
  const r = await api('/push/subscribe', {
    method: 'POST', token: u.token,
    body: { subscription: { endpoint: 'https://example.com/fake-' + who, keys: { p256dh: 'BFakeFakeFakeFakeFakeFakeFakeFakeFakeFakeFakeFakeFakeFakeFakeFakeFakeFakeFakeFakeFakeFakeFak', auth: 'FakeFakeFakeFakeFakeFA' } } },
  });
  out(r);
} else if (step === 'join-wager') {
  const u = await login(who);
  const wagers = await api('/wagers', { token: u.token });
  const w = wagers.find(w => w.status === 'open');
  const r = await api(`/wagers/${w.id}/join`, { method: 'POST', token: u.token });
  out({ joined: w.id, who, ...r });
} else if (step === 'state') {
  const u = await login('rohan');
  const squad = await api('/squad', { token: u.token });
  out({
    meter: squad.meter, pace: squad.pacePct, pot: squad.pot, daysLeft: squad.daysLeft,
    members: squad.members.map(m => ({ n: m.username, xp: m.xp, aura: m.aura, streak: m.streak, lv: m.level.lv, localToday: m.localToday })),
  });
} else if (step === 'me') {
  const u = await login(who);
  const r = await api('/me', { token: u.token });
  out({ user: r.user, todayDate: r.todayDate, today: r.today && r.today.status });
} else {
  console.log('steps: join|yes|no|rest|skip|chat|vote-cap|photo|push-sub|join-wager|state|me  [who]');
}
