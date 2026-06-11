// index.js — LOCKED IN server: express + socket.io + THE REF
import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { db, q } from './db.js';
import {
  applyCheckin, reconcile, buyItem, levelFor, todayStr, addDays, isoWeek,
  SHOP_ITEMS, LEVELS, EXCUSE_PRESETS, GOAL_DATE, invQty, award, daysUntilGoal,
} from './game.js';
import { userStats, squadSnapshot, leaderboard } from './stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// curated reaction arsenal — emoji + text stickers, all stored as plain strings.
// curation is what keeps it deadpan. no free-text reactions.
export const REACTIONS = ['💀', '🗿', '🧢', '🤡', '😭', '🐐', '🥀'];
export const STICKERS = ['let him cook', 'caught lacking', 'cooked', 'lightweight baby', 'we go gym', '−1000 aura'];

// ---------- helpers ----------
function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 32).toString('hex');
}
function publicUser(u) {
  return {
    id: u.id, username: u.username, xp: u.xp, coins: u.coins, aura: u.aura,
    streak: u.current_streak, longest: u.longest_streak,
    level: levelFor(u.xp), joined: u.joined_date,
    doubleXpDate: u.double_xp_date,
  };
}
function messageRow(id) {
  const m = q.get('SELECT * FROM messages WHERE id = ?', id);
  if (!m) return null;
  const u = m.user_id ? q.get('SELECT id, username, xp FROM users WHERE id = ?', m.user_id) : null;
  const reactions = q.all(
    `SELECT r.emoji, r.user_id, u.username FROM reactions r JOIN users u ON u.id = r.user_id WHERE r.message_id = ?`, m.id);
  return {
    id: m.id, type: m.type, text: m.text, meta: JSON.parse(m.meta || '{}'),
    created_at: m.created_at,
    user: u ? { id: u.id, username: u.username, level: levelFor(u.xp) } : null,
    reactions,
  };
}
function postMessage(userId, type, text, meta = {}) {
  const r = q.run('INSERT INTO messages (user_id, type, text, meta, created_at) VALUES (?,?,?,?,?)',
    userId, type, text, JSON.stringify(meta), Date.now());
  const msg = messageRow(r.lastInsertRowid);
  io.emit('chat:new', msg);
  return msg;
}
function refSay(text, meta = {}) {
  if (!text) return;
  return postMessage(null, 'system', text, meta);
}
function broadcastSquad() { io.emit('squad:update'); }
function fx(payload) { io.emit('fx', payload); }

// ---------- auth ----------
function makeToken(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  q.run('INSERT INTO tokens (token, user_id, created_at) VALUES (?,?,?)', token, userId, Date.now());
  return token;
}
function userFromToken(token) {
  if (!token) return null;
  const t = q.get('SELECT user_id FROM tokens WHERE token = ?', token);
  if (!t) return null;
  return q.get('SELECT * FROM users WHERE id = ?', t.user_id) || null;
}
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const u = userFromToken(token);
  if (!u) return res.status(401).json({ error: 'not logged in. who are you.' });
  req.user = u;
  q.run('UPDATE users SET last_seen = ? WHERE id = ?', Date.now(), u.id);
  next();
}
const fail = (res, code, msg) => res.status(code).json({ error: msg });

// ---------- reconciliation (auto-skips, weekly fame) ----------
let lastReconcileDay = null;
function runReconcile(force = false) {
  const today = todayStr();
  if (!force && lastReconcileDay === today) return;
  lastReconcileDay = today;
  try {
    const msgs = reconcile();
    for (const m of msgs) refSay(m);
    if (msgs.length) broadcastSquad();
  } catch (e) { console.error('reconcile failed:', e); }
}
runReconcile(true);
setInterval(() => runReconcile(), 10 * 60 * 1000);

// ============================================================
// AUTH ROUTES
// ============================================================
app.post('/api/register', (req, res) => {
  const { username, pin, inviteCode } = req.body || {};
  // optional gate for public deployments: set INVITE_CODE env var
  if (process.env.INVITE_CODE && String(inviteCode || '') !== process.env.INVITE_CODE)
    return fail(res, 403, 'wrong invite code. this pact is invite-only.');
  const name = String(username || '').trim();
  if (!/^[a-zA-Z0-9_ ]{2,16}$/.test(name)) return fail(res, 400, 'name must be 2-16 chars, letters/numbers/underscores.');
  if (!/^\d{4,8}$/.test(String(pin || ''))) return fail(res, 400, 'pin must be 4-8 digits.');
  if (q.get('SELECT 1 FROM users WHERE username = ?', name)) return fail(res, 409, 'name taken. be original.');
  const salt = crypto.randomBytes(8).toString('hex');
  const r = q.run(
    'INSERT INTO users (username, pin_hash, pin_salt, joined_date, created_at, last_seen) VALUES (?,?,?,?,?,?)',
    name, hashPin(pin, salt), salt, todayStr(), Date.now(), Date.now());
  const u = q.get('SELECT * FROM users WHERE id = ?', r.lastInsertRowid);
  const token = makeToken(u.id);
  refSay(`${name} has joined the pact. ${daysUntilGoal()} days until dec 20. this is in writing now.`);
  broadcastSquad();
  res.json({ token, user: publicUser(u) });
});

app.post('/api/login', (req, res) => {
  const { username, pin } = req.body || {};
  const u = q.get('SELECT * FROM users WHERE username = ?', String(username || '').trim());
  if (!u || hashPin(pin || '', u.pin_salt) !== u.pin_hash) return fail(res, 401, 'wrong name or pin. sus.');
  res.json({ token: makeToken(u.id), user: publicUser(u) });
});

app.post('/api/logout', auth, (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  q.run('DELETE FROM tokens WHERE token = ?', token);
  res.json({ ok: true });
});

// ============================================================
// CONFIG + ME + SQUAD
// ============================================================
app.get('/api/config', (req, res) => {
  res.json({
    levels: LEVELS, shop: SHOP_ITEMS, excuses: EXCUSE_PRESETS, reactions: REACTIONS,
    stickers: STICKERS, goal: GOAL_DATE, daysLeft: daysUntilGoal(), inviteRequired: !!process.env.INVITE_CODE,
  });
});

app.get('/api/me', auth, (req, res) => {
  runReconcile();
  const u = q.get('SELECT * FROM users WHERE id = ?', req.user.id);
  const inventory = q.all('SELECT item_id, qty FROM inventory WHERE user_id = ? AND qty > 0', u.id);
  const todayCheckin = q.get('SELECT * FROM checkins WHERE user_id = ? AND date = ?', u.id, todayStr());
  res.json({ user: publicUser(u), inventory, today: todayCheckin || null, todayDate: todayStr() });
});

app.get('/api/squad', auth, (req, res) => {
  runReconcile();
  res.json(squadSnapshot());
});

// ============================================================
// CHECK-INS
// ============================================================
app.post('/api/checkin', auth, (req, res) => {
  const { status, description = '', excuse = '' } = req.body || {};
  if (status === 'no' && !String(excuse).trim()) return fail(res, 400, 'a NO needs an excuse. the squad will judge it.');
  try {
    const result = applyCheckin(req.user, { status, description: String(description), excuse: String(excuse) });
    // the flex card for YES days
    if (result.checkin.status === 'yes') {
      postMessage(req.user.id, 'card', '', {
        status: 'yes', description: result.checkin.description,
        streak: result.streak, xp: result.checkin.xp_delta, username: req.user.username,
      });
    }
    for (const m of result.refMessages) refSay(m);
    for (const f of result.fx) fx(f);
    broadcastSquad();
    const u = q.get('SELECT * FROM users WHERE id = ?', req.user.id);
    res.json({ ok: true, checkin: result.checkin, user: publicUser(u), milestones: result.milestones, levelUp: result.levelUp });
  } catch (e) {
    if (e.code === 'ALREADY') return fail(res, 409, e.message);
    if (e.code === 'BAD_STATUS') return fail(res, 400, e.message);
    throw e;
  }
});

// edit today's workout description (yes/rest days only)
app.post('/api/checkin/describe', auth, (req, res) => {
  const { description = '' } = req.body || {};
  const c = q.get('SELECT * FROM checkins WHERE user_id = ? AND date = ?', req.user.id, todayStr());
  if (!c) return fail(res, 404, 'no check-in today yet.');
  if (c.status !== 'yes' && c.status !== 'rest') return fail(res, 400, 'you can only describe days you actually did something.');
  const desc = String(description).trim().slice(0, 500);
  let bonus = 0;
  if (c.status === 'yes' && c.description.trim().length < 20 && desc.length >= 20) {
    bonus = 10;
    award(req.user.id, 'desc_bonus', { xp: 10, note: 'workout described' });
    q.run('UPDATE checkins SET xp_delta = xp_delta + 10 WHERE id = ?', c.id);
  }
  q.run('UPDATE checkins SET description = ? WHERE id = ?', desc, c.id);
  broadcastSquad();
  res.json({ ok: true, bonus });
});

// calendar / history for any member
app.get('/api/checkins/:userId', auth, (req, res) => {
  const rows = q.all(
    'SELECT date, status, description, excuse, auto, frozen, over_quota, xp_delta, created_at FROM checkins WHERE user_id = ? ORDER BY date DESC LIMIT 120',
    Number(req.params.userId));
  res.json(rows);
});

// today's squad grid
app.get('/api/today', auth, (req, res) => {
  const today = todayStr();
  const users = q.all('SELECT id, username, xp FROM users');
  const grid = users.map(u => {
    const c = q.get('SELECT status, description, excuse, frozen, over_quota, created_at, id FROM checkins WHERE user_id = ? AND date = ?', u.id, today);
    return { id: u.id, username: u.username, level: levelFor(u.xp), checkin: c || null };
  });
  res.json({ date: today, grid });
});

// ============================================================
// EXCUSE COURT — vote on the validity of a NO
// ============================================================
app.post('/api/excuse/:checkinId/vote', auth, (req, res) => {
  const c = q.get('SELECT * FROM checkins WHERE id = ?', Number(req.params.checkinId));
  if (!c || c.status !== 'no') return fail(res, 404, 'no excuse on trial there.');
  if (c.user_id === req.user.id) return fail(res, 400, 'you can’t vote on your own excuse. obviously.');
  if (Date.now() - c.created_at > 48 * 3600 * 1000) return fail(res, 400, 'court is closed. 48h limit.');
  const valid = req.body && req.body.valid ? 1 : 0;
  q.run(`INSERT INTO excuse_votes (checkin_id, voter_id, valid) VALUES (?,?,?)
         ON CONFLICT(checkin_id, voter_id) DO UPDATE SET valid = excluded.valid`, c.id, req.user.id, valid);
  const votes = q.all('SELECT valid FROM excuse_votes WHERE checkin_id = ?', c.id);
  const caps = votes.filter(v => !v.valid).length;
  const valids = votes.filter(v => v.valid).length;
  let capped = false;
  if (!c.excuse_capped && caps >= 2 && caps > valids) {
    q.run('UPDATE checkins SET excuse_capped = 1 WHERE id = ?', c.id);
    const owner = q.get('SELECT username FROM users WHERE id = ?', c.user_id);
    award(c.user_id, 'excuse_capped', { aura: -100, note: c.excuse });
    refSay(`excuse denied. "${c.excuse}" did not survive the tribunal. ${owner.username}: −100 aura. archived under fiction.`);
    fx({ kind: 'shame', userId: c.user_id });
    capped = true;
    broadcastSquad();
  }
  res.json({ ok: true, caps, valids, capped });
});

app.get('/api/excuse/pending', auth, (req, res) => {
  // recent NOs still in their 48h voting window
  const cutoff = Date.now() - 48 * 3600 * 1000;
  const rows = q.all(
    `SELECT c.id, c.user_id, c.date, c.excuse, c.excuse_capped, c.created_at, u.username
     FROM checkins c JOIN users u ON u.id = c.user_id
     WHERE c.status = 'no' AND c.excuse != '' AND c.created_at > ? ORDER BY c.created_at DESC`, cutoff);
  const out = rows.map(r => {
    const votes = q.all('SELECT voter_id, valid FROM excuse_votes WHERE checkin_id = ?', r.id);
    return {
      ...r,
      caps: votes.filter(v => !v.valid).length,
      valids: votes.filter(v => v.valid).length,
      myVote: (votes.find(v => v.voter_id === req.user.id) || { valid: null }).valid,
    };
  });
  res.json(out);
});

// ============================================================
// FORMAL CALLOUTS — one per member per week. the formality is the joke.
// target has 48h to post a YES check-in or take −100 aura.
// ============================================================
app.post('/api/callouts', auth, (req, res) => {
  const targetId = Number(req.body && req.body.targetId);
  const target = q.get('SELECT * FROM users WHERE id = ?', targetId);
  if (!target) return fail(res, 404, 'no such member.');
  if (targetId === req.user.id) return fail(res, 400, 'you can’t call yourself out. that’s called a journal.');
  const week = isoWeek(todayStr());
  if (q.get(`SELECT 1 FROM callouts WHERE caller_id = ? AND week = ?`, req.user.id, week))
    return fail(res, 400, 'one formal callout per week. choose your target with intention.');
  if (q.get(`SELECT 1 FROM callouts WHERE target_id = ? AND status = 'open'`, targetId))
    return fail(res, 400, 'they’re already under formal questioning.');
  // a target who already trained today has answered in advance
  const trained = q.get(`SELECT 1 FROM checkins WHERE user_id = ? AND date = ? AND status = 'yes'`, targetId, todayStr());
  if (trained) return fail(res, 400, 'they already trained today. the callout would embarrass only you.');
  q.run('INSERT INTO callouts (caller_id, target_id, week, created_at) VALUES (?,?,?,?)', req.user.id, targetId, week, Date.now());
  refSay(`callout issued. ${req.user.username} has formally questioned ${target.username}'s whereabouts. ${target.username} has 48 hours to post a workout.`);
  fx({ kind: 'callout', userId: targetId });
  broadcastSquad();
  res.json({ ok: true });
});

app.get('/api/callouts', auth, (req, res) => {
  const rows = q.all(
    `SELECT c.*, uc.username AS caller, ut.username AS target FROM callouts c
     JOIN users uc ON uc.id = c.caller_id JOIN users ut ON ut.id = c.target_id
     ORDER BY c.created_at DESC LIMIT 20`);
  const week = isoWeek(todayStr());
  const mine = q.get('SELECT 1 FROM callouts WHERE caller_id = ? AND week = ?', req.user.id, week);
  res.json({ rows, usedThisWeek: !!mine });
});

// ============================================================
// LEADERBOARD / SHAME / STATS
// ============================================================
app.get('/api/leaderboard', auth, (req, res) => {
  res.json({ period: req.query.period === 'all' ? 'all' : 'week', rows: leaderboard(req.query.period === 'all' ? 'all' : 'week') });
});

app.get('/api/hall', auth, (req, res) => {
  const week = isoWeek(todayStr());
  const rows = q.all(
    `SELECT h.*, u.username FROM hall h JOIN users u ON u.id = h.user_id ORDER BY h.created_at DESC LIMIT 60`);
  res.json({ week, rows });
});

app.get('/api/stats/:userId', auth, (req, res) => {
  const s = userStats(Number(req.params.userId));
  if (!s) return fail(res, 404, 'no such soldier.');
  res.json(s);
});

// ============================================================
// SHOP
// ============================================================
app.get('/api/shop', auth, (req, res) => {
  const inventory = {};
  for (const r of q.all('SELECT item_id, qty FROM inventory WHERE user_id = ? AND qty > 0', req.user.id)) inventory[r.item_id] = r.qty;
  const u = q.get('SELECT coins, double_xp_date FROM users WHERE id = ?', req.user.id);
  res.json({ items: SHOP_ITEMS, inventory, coins: u.coins, doubleXpDate: u.double_xp_date, today: todayStr() });
});

app.post('/api/shop/buy', auth, (req, res) => {
  try {
    const { item, refMessage } = buyItem(req.user, String(req.body && req.body.itemId || ''));
    if (refMessage) refSay(refMessage);
    broadcastSquad();
    const u = q.get('SELECT * FROM users WHERE id = ?', req.user.id);
    const inventory = {};
    for (const r of q.all('SELECT item_id, qty FROM inventory WHERE user_id = ? AND qty > 0', u.id)) inventory[r.item_id] = r.qty;
    res.json({ ok: true, item: item.id, user: publicUser(u), inventory, doubleXpDate: u.double_xp_date });
  } catch (e) {
    if (e.code) return fail(res, 400, e.message);
    throw e;
  }
});

// ============================================================
// WAGERS — the forfeit ledger
// ============================================================
app.get('/api/wagers', auth, (req, res) => {
  const wagers = q.all('SELECT w.*, u.username AS creator FROM wagers w JOIN users u ON u.id = w.creator_id ORDER BY w.created_at DESC LIMIT 40');
  const out = wagers.map(w => ({
    ...w,
    members: q.all(
      `SELECT wm.user_id, wm.is_loser, wm.paid, u.username FROM wager_members wm JOIN users u ON u.id = wm.user_id WHERE wm.wager_id = ?`, w.id),
  }));
  res.json(out);
});

app.post('/api/wagers', auth, (req, res) => {
  const { title, stake, deadline } = req.body || {};
  const t = String(title || '').trim().slice(0, 80);
  const s = String(stake || '').trim().slice(0, 120);
  if (t.length < 3) return fail(res, 400, 'wager needs a real title.');
  if (s.length < 3) return fail(res, 400, 'no stake, no wager. what does the loser owe?');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(deadline || '')) || deadline <= todayStr()) return fail(res, 400, 'deadline must be a future date.');
  const r = q.run('INSERT INTO wagers (creator_id, title, stake, deadline, created_at) VALUES (?,?,?,?,?)',
    req.user.id, t, s, deadline, Date.now());
  q.run('INSERT INTO wager_members (wager_id, user_id) VALUES (?,?)', r.lastInsertRowid, req.user.id);
  refSay(`${req.user.username} opened a wager: "${t}". stake: ${s}. deadline ${deadline}. joining is voluntary. so is losing.`);
  broadcastSquad();
  res.json({ ok: true, id: r.lastInsertRowid });
});

app.post('/api/wagers/:id/join', auth, (req, res) => {
  const w = q.get('SELECT * FROM wagers WHERE id = ?', Number(req.params.id));
  if (!w || w.status !== 'open') return fail(res, 404, 'that wager is closed or gone.');
  if (q.get('SELECT 1 FROM wager_members WHERE wager_id = ? AND user_id = ?', w.id, req.user.id)) return fail(res, 400, 'already in.');
  q.run('INSERT INTO wager_members (wager_id, user_id) VALUES (?,?)', w.id, req.user.id);
  refSay(`${req.user.username} joined the wager "${w.title}". noted. witnessed. binding.`);
  broadcastSquad();
  res.json({ ok: true });
});

app.post('/api/wagers/:id/settle', auth, (req, res) => {
  const w = q.get('SELECT * FROM wagers WHERE id = ?', Number(req.params.id));
  if (!w || w.status !== 'open') return fail(res, 404, 'that wager is closed or gone.');
  if (w.creator_id !== req.user.id) return fail(res, 403, 'only the wager creator can settle it.');
  const loserIds = Array.isArray(req.body && req.body.loserIds) ? req.body.loserIds.map(Number) : [];
  const members = q.all('SELECT user_id FROM wager_members WHERE wager_id = ?', w.id);
  const memberIds = new Set(members.map(m => m.user_id));
  if (!loserIds.length || !loserIds.every(id => memberIds.has(id))) return fail(res, 400, 'losers must be wager members.');
  q.run('UPDATE wagers SET status = ? WHERE id = ?', 'settled', w.id);
  for (const id of loserIds) {
    q.run('UPDATE wager_members SET is_loser = 1 WHERE wager_id = ? AND user_id = ?', w.id, id);
    award(id, 'wager_loss', { aura: -75, note: w.title });
  }
  const names = loserIds.map(id => q.get('SELECT username FROM users WHERE id = ?', id).username);
  refSay(`wager settled: "${w.title}". ${names.join(' & ')} took the L. owed: ${w.stake}. −75 aura each. the ledger is patient.`);
  for (const id of loserIds) fx({ kind: 'shame', userId: id });
  broadcastSquad();
  res.json({ ok: true });
});

app.post('/api/wagers/:id/paid', auth, (req, res) => {
  const w = q.get('SELECT * FROM wagers WHERE id = ?', Number(req.params.id));
  if (!w) return fail(res, 404, 'no such wager.');
  const targetId = Number(req.body && req.body.userId || req.user.id);
  if (targetId !== req.user.id && w.creator_id !== req.user.id) return fail(res, 403, 'only the loser or the creator can clear a debt.');
  const m = q.get('SELECT * FROM wager_members WHERE wager_id = ? AND user_id = ?', w.id, targetId);
  if (!m || !m.is_loser) return fail(res, 400, 'that person doesn’t owe anything here.');
  if (m.paid) return fail(res, 400, 'already paid.');
  q.run('UPDATE wager_members SET paid = 1 WHERE wager_id = ? AND user_id = ?', w.id, targetId);
  const name = q.get('SELECT username FROM users WHERE id = ?', targetId).username;
  award(targetId, 'debt_cleared', { aura: 25, note: w.title });
  refSay(`${name} settled their debt on "${w.title}". honor restored. +25 aura.`);
  broadcastSquad();
  res.json({ ok: true });
});

// ============================================================
// CHAT (history via REST, live via socket)
// ============================================================
app.get('/api/chat', auth, (req, res) => {
  const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const rows = q.all('SELECT id FROM messages WHERE id < ? ORDER BY id DESC LIMIT ?', before, limit);
  res.json(rows.map(r => messageRow(r.id)).reverse());
});

// ============================================================
// SOCKET.IO
// ============================================================
io.use((socket, next) => {
  const u = userFromToken(socket.handshake.auth && socket.handshake.auth.token);
  if (!u) return next(new Error('unauthorized'));
  socket.user = u;
  next();
});

io.on('connection', (socket) => {
  q.run('UPDATE users SET last_seen = ? WHERE id = ?', Date.now(), socket.user.id);
  broadcastSquad();

  socket.on('chat:send', (payload, ack) => {
    const text = String(payload && payload.text || '').trim().slice(0, 1000);
    if (!text) return ack && ack({ error: 'empty' });
    q.run('UPDATE users SET last_seen = ? WHERE id = ?', Date.now(), socket.user.id);
    const msg = postMessage(socket.user.id, 'user', text);
    ack && ack({ ok: true, id: msg.id });
  });

  socket.on('chat:react', (payload, ack) => {
    const messageId = Number(payload && payload.messageId);
    const emoji = String(payload && payload.emoji || '').slice(0, 24);
    if (!messageId || !emoji) return ack && ack({ error: 'bad reaction' });
    if (![...REACTIONS, ...STICKERS].includes(emoji)) return ack && ack({ error: 'not in the approved reaction arsenal' });
    if (!q.get('SELECT 1 FROM messages WHERE id = ?', messageId)) return ack && ack({ error: 'message gone' });
    const existing = q.get('SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', messageId, socket.user.id, emoji);
    if (existing) {
      q.run('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', messageId, socket.user.id, emoji);
    } else {
      q.run('INSERT INTO reactions (message_id, user_id, emoji) VALUES (?,?,?)', messageId, socket.user.id, emoji);
    }
    io.emit('chat:react', { messageId, message: messageRow(messageId) });
    ack && ack({ ok: true });
  });

  socket.on('chat:typing', () => {
    socket.broadcast.emit('chat:typing', { username: socket.user.username });
  });

  socket.on('disconnect', () => {
    q.run('UPDATE users SET last_seen = ? WHERE id = ?', Date.now() - 60000, socket.user.id);
    setTimeout(broadcastSquad, 100);
  });
});

// ---------- error handling ----------
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'server pulled something. try again.' });
});

server.listen(PORT, () => {
  console.log(`LOCKED IN — listening on http://localhost:${PORT}`);
  console.log(`${daysUntilGoal()} days until ${GOAL_DATE}. clock's ticking.`);
});
