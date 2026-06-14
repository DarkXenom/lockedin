// index.js — LOCKED IN server: express + socket.io + the ref + push
import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { migrate, q, getMeta, setMeta, withLock } from './db.js';
import {
  applyCheckin, reconcile, buyItem, levelFor, localDate, localHM, addDays, isoWeek, validTz,
  SHOP_ITEMS, LEVELS, EXCUSE_PRESETS, GOAL_DATE, PACT_START, invQty, award, daysUntilGoal,
  potConfig, constitutionText,
} from './game.js';
import { userStats, squadSnapshot, leaderboard, generateWrapped } from './stats.js';
import { initPush, vapidPublicKey, saveSubscription, removeSubscription, pushToUser, pushMany, reminderTick } from './push.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '3mb' })); // photos travel as compressed data urls
app.get('/sw.js', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, '..', 'public', 'sw.js'));
});
app.use(express.static(path.join(__dirname, '..', 'public')));

// curated reaction arsenal — no free-text reactions. curation keeps it deadpan.
export const REACTIONS = ['💀', '🗿', '🧢', '🤡', '😭', '🐐', '🥀'];
export const STICKERS = ['let him cook', 'caught lacking', 'cooked', 'lightweight baby', 'we go gym', '−1000 aura'];

// async route wrapper — express 4 doesn't catch async throws
const ah = fn => (req, res, next) => fn(req, res, next).catch(next);

// ---------- helpers ----------
function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 32).toString('hex');
}
function publicUser(u) {
  return {
    id: u.id, username: u.username, xp: u.xp, coins: u.coins, aura: u.aura,
    streak: u.current_streak, longest: u.longest_streak,
    level: levelFor(u.xp), joined: u.joined_date, tz: u.tz,
    doubleXpDate: u.double_xp_date,
    signed: !!u.signed_at,
    hasBefore: !!u.photo_before, hasAfter: !!u.photo_after,
    pushEnabled: !!u.push_enabled,
  };
}
async function messageRow(id) {
  const m = await q.get('SELECT * FROM messages WHERE id = ?', id);
  if (!m) return null;
  const u = m.user_id ? await q.get('SELECT id, username, xp FROM users WHERE id = ?', m.user_id) : null;
  const reactions = await q.all(
    `SELECT r.emoji, r.user_id, u.username FROM reactions r JOIN users u ON u.id = r.user_id WHERE r.message_id = ?`, m.id);
  return {
    id: m.id, type: m.type, text: m.text, meta: JSON.parse(m.meta || '{}'),
    created_at: m.created_at,
    user: u ? { id: u.id, username: u.username, level: levelFor(u.xp) } : null,
    reactions,
  };
}
async function postMessage(userId, type, text, meta = {}) {
  const r = await q.run('INSERT INTO messages (user_id, type, text, meta, created_at) VALUES (?,?,?,?,?)',
    userId, type, text, JSON.stringify(meta), Date.now());
  const msg = await messageRow(r.lastInsertRowid);
  io.emit('chat:new', msg);
  return msg;
}
async function refSay(text, meta = {}) {
  if (!text) return;
  return postMessage(null, 'system', text, meta);
}
function broadcastSquad() { io.emit('squad:update'); }
function fx(payload) { io.emit('fx', payload); }

// ---------- auth ----------
async function makeToken(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  await q.run('INSERT INTO tokens (token, user_id, created_at) VALUES (?,?,?)', token, userId, Date.now());
  return token;
}
async function userFromToken(token) {
  if (!token) return null;
  const t = await q.get('SELECT user_id FROM tokens WHERE token = ?', token);
  if (!t) return null;
  return await q.get('SELECT * FROM users WHERE id = ?', t.user_id);
}
const auth = ah(async (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const u = await userFromToken(token);
  if (!u) return res.status(401).json({ error: 'not logged in. who are you.' });
  req.user = u;
  await q.run('UPDATE users SET last_seen = ? WHERE id = ?', Date.now(), u.id);
  next();
});
const fail = (res, code, msg) => res.status(code).json({ error: msg });

// ---------- reconciliation + schedulers ----------
// serialized through a lock: overlapping runs would double-award fame,
// double-post wrapped cards, and double-burn streak freezes.
let lastReconcileAt = 0;
function runReconcile(force = false) {
  if (!force && Date.now() - lastReconcileAt < 10 * 60 * 1000) return Promise.resolve();
  return withLock('reconcile', () => doReconcile(force));
}
async function doReconcile(force) {
  if (!force && Date.now() - lastReconcileAt < 10 * 60 * 1000) return;
  lastReconcileAt = Date.now();
  try {
    const { refMessages, pushes } = await reconcile();
    for (const m of refMessages) await refSay(m);
    pushMany(pushes);

    const wrapped = await generateWrapped();
    for (const w of wrapped.refMessages) {
      await postMessage(null, 'wrapped', `${w.username}'s monthly wrapped is in.`, { ...w.data, username: w.username, userId: w.userId });
    }
    pushMany(wrapped.pushes);

    if (refMessages.length || wrapped.refMessages.length) broadcastSquad();
  } catch (e) { console.error('reconcile failed:', e); }
}

// ============================================================
// AUTH ROUTES
// ============================================================
app.post('/api/register', ah(async (req, res) => {
  const { username, pin, inviteCode, tz } = req.body || {};
  if (process.env.INVITE_CODE && String(inviteCode || '') !== process.env.INVITE_CODE)
    return fail(res, 403, 'wrong invite code. this pact is invite-only.');
  const name = String(username || '').trim();
  if (!/^[a-zA-Z0-9_ ]{2,16}$/.test(name)) return fail(res, 400, 'name must be 2-16 chars, letters/numbers/underscores.');
  if (!/^\d{4,8}$/.test(String(pin || ''))) return fail(res, 400, 'pin must be 4-8 digits.');
  if (await q.get('SELECT 1 FROM users WHERE username = ?', name)) return fail(res, 409, 'name taken. be original.');
  const salt = crypto.randomBytes(8).toString('hex');
  const userTz = validTz(String(tz || 'UTC'));
  const r = await q.run(
    'INSERT INTO users (username, pin_hash, pin_salt, tz, joined_date, created_at, last_seen) VALUES (?,?,?,?,?,?,?)',
    name, hashPin(pin, salt), salt, userTz, localDate(userTz), Date.now(), Date.now());
  const u = await q.get('SELECT * FROM users WHERE id = ?', r.lastInsertRowid);
  const token = await makeToken(u.id);
  await refSay(`${name} has joined the pact. ${daysUntilGoal(localDate(userTz))} days until dec 20. this is in writing now.`);
  broadcastSquad();
  res.json({ token, user: publicUser(u) });
}));

// brute-force guard: 4-digit pins are enumerable, so failed logins are throttled
// per ip+name. in-memory is fine — render free tier runs a single instance.
const loginFails = new Map();
function loginThrottled(key) {
  const f = loginFails.get(key);
  return f && f.count >= 8 && Date.now() < f.until;
}
function loginFailed(key) {
  const f = loginFails.get(key) || { count: 0, until: 0 };
  f.count++;
  f.until = Date.now() + 10 * 60 * 1000;
  loginFails.set(key, f);
  if (loginFails.size > 5000) loginFails.clear(); // scanner flood relief valve
}

app.post('/api/login', ah(async (req, res) => {
  const { username, pin, tz } = req.body || {};
  const name = String(username || '').trim();
  const key = (req.ip || '?') + '|' + name.toLowerCase();
  if (loginThrottled(key)) return fail(res, 429, 'too many attempts. the ref is watching you specifically. try later.');
  const u = await q.get('SELECT * FROM users WHERE username = ?', name);
  if (!u || hashPin(pin || '', u.pin_salt) !== u.pin_hash) {
    loginFailed(key);
    return fail(res, 401, 'wrong name or pin. sus.');
  }
  loginFails.delete(key);
  if (tz) {
    const newTz = validTz(String(tz));
    const oldToday = localDate(validTz(u.tz));
    const newToday = localDate(newTz);
    // eastward timezone travel: local date jumps forward past days the user never
    // lived. plug the gap with frozen placeholders so reconcile doesn't fine ghosts.
    if (newToday > oldToday) {
      for (let d = oldToday; d < newToday; d = addDays(d, 1)) {
        await q.run(`INSERT OR IGNORE INTO checkins (user_id, date, status, auto, frozen, created_at) VALUES (?,?,'skip',1,1,?)`, u.id, d, Date.now());
      }
    }
    await q.run('UPDATE users SET tz = ? WHERE id = ?', newTz, u.id);
    u.tz = newTz;
  }
  res.json({ token: await makeToken(u.id), user: publicUser(u) });
}));

app.post('/api/logout', auth, ah(async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  await q.run('DELETE FROM tokens WHERE token = ?', token);
  res.json({ ok: true });
}));

// ============================================================
// CONFIG + ME + SQUAD
// ============================================================
app.get('/api/config', ah(async (req, res) => {
  const today = localDate('UTC');
  const total = daysUntilGoal(PACT_START);                 // 188
  const elapsed = Math.max(0, daysUntilGoal(PACT_START) - daysUntilGoal(today));
  res.json({
    levels: LEVELS, shop: SHOP_ITEMS, excuses: EXCUSE_PRESETS, reactions: REACTIONS,
    stickers: STICKERS, goal: GOAL_DATE, pactStart: PACT_START, daysLeft: daysUntilGoal(today),
    pactTotalDays: total, pactDay: today < PACT_START ? 0 : elapsed + 1,
    inviteRequired: !!process.env.INVITE_CODE,
    vapidPublic: vapidPublicKey(),
    pot: await potConfig(),
  });
}));

app.get('/api/constitution', ah(async (req, res) => {
  res.json({ articles: await constitutionText() });
}));

app.post('/api/constitution/sign', auth, ah(async (req, res) => {
  if (!req.user.signed_at) {
    await q.run('UPDATE users SET signed_at = ? WHERE id = ?', Date.now(), req.user.id);
    await refSay(`${req.user.username} has signed the constitution. it is in writing. it has always been in writing.`);
  }
  res.json({ ok: true });
}));

app.get('/api/me', auth, ah(async (req, res) => {
  runReconcile();
  const u = await q.get('SELECT * FROM users WHERE id = ?', req.user.id);
  const inventory = await q.all('SELECT item_id, qty FROM inventory WHERE user_id = ? AND qty > 0', u.id);
  const today = localDate(validTz(u.tz));
  const todayCheckin = await q.get('SELECT * FROM checkins WHERE user_id = ? AND date = ?', u.id, today);
  res.json({ user: publicUser(u), inventory, today: todayCheckin || null, todayDate: today });
}));

app.get('/api/squad', auth, ah(async (req, res) => {
  runReconcile();
  res.json(await squadSnapshot());
}));

// ============================================================
// CHECK-INS
// ============================================================
app.post('/api/checkin', auth, ah(async (req, res) => {
  const { status, description = '', excuse = '' } = req.body || {};
  if (status === 'no' && !String(excuse).trim()) return fail(res, 400, 'a NO needs an excuse. the squad will judge it.');
  try {
    // per-user lock: a double-tap must not double-charge the pot or burn two passes
    const result = await withLock('user:' + req.user.id,
      () => applyCheckin(req.user, { status, description: String(description), excuse: String(excuse) }));
    if (result.checkin.status === 'yes') {
      await postMessage(req.user.id, 'card', '', {
        status: 'yes', description: result.checkin.description,
        streak: result.streak, xp: result.checkin.xp_delta, username: req.user.username,
      });
    }
    for (const m of result.refMessages) await refSay(m);
    for (const f of result.fx) fx(f);
    pushMany(result.pushes);
    broadcastSquad();
    const u = await q.get('SELECT * FROM users WHERE id = ?', req.user.id);
    res.json({ ok: true, checkin: result.checkin, user: publicUser(u), milestones: result.milestones, levelUp: result.levelUp });
  } catch (e) {
    if (e.code === 'ALREADY') return fail(res, 409, e.message);
    if (e.code === 'BAD_STATUS') return fail(res, 400, e.message);
    if (String(e.message || '').includes('UNIQUE')) return fail(res, 409, 'already checked in today. no take-backs.');
    throw e;
  }
}));

app.post('/api/checkin/describe', auth, ah(async (req, res) => {
  const { description = '' } = req.body || {};
  const today = localDate(validTz(req.user.tz));
  const c = await q.get('SELECT * FROM checkins WHERE user_id = ? AND date = ?', req.user.id, today);
  if (!c) return fail(res, 404, 'no check-in today yet.');
  if (c.status !== 'yes' && c.status !== 'rest') return fail(res, 400, 'you can only describe days you actually did something.');
  const desc = String(description).trim().slice(0, 500);
  let bonus = 0;
  if (c.status === 'yes' && c.description.trim().length < 20 && desc.length >= 20) {
    bonus = 10;
    await award(req.user.id, 'desc_bonus', { xp: 10, note: 'workout described' });
    await q.run('UPDATE checkins SET xp_delta = xp_delta + 10 WHERE id = ?', c.id);
  }
  await q.run('UPDATE checkins SET description = ? WHERE id = ?', desc, c.id);
  broadcastSquad();
  res.json({ ok: true, bonus });
}));

app.get('/api/checkins/:userId', auth, ah(async (req, res) => {
  const rows = await q.all(
    'SELECT date, status, description, excuse, auto, frozen, over_quota, xp_delta, created_at FROM checkins WHERE user_id = ? ORDER BY date DESC LIMIT 120',
    Number(req.params.userId));
  res.json(rows);
}));

app.get('/api/today', auth, ah(async (req, res) => {
  const users = await q.all('SELECT id, username, xp, tz FROM users');
  const grid = [];
  for (const u of users) {
    const today = localDate(validTz(u.tz));
    const c = await q.get('SELECT status, description, excuse, frozen, over_quota, created_at, id FROM checkins WHERE user_id = ? AND date = ?', u.id, today);
    grid.push({ id: u.id, username: u.username, level: levelFor(u.xp), checkin: c || null, localTime: localHM(validTz(u.tz)) });
  }
  res.json({ date: localDate(validTz(req.user.tz)), grid });
}));

// ============================================================
// EXCUSE COURT
// ============================================================
app.post('/api/excuse/:checkinId/vote', auth, ah(async (req, res) => {
  const c = await q.get('SELECT * FROM checkins WHERE id = ?', Number(req.params.checkinId));
  if (!c || c.status !== 'no') return fail(res, 404, 'no excuse on trial there.');
  if (c.user_id === req.user.id) return fail(res, 400, 'you can’t vote on your own excuse. obviously.');
  if (Date.now() - c.created_at > 48 * 3600 * 1000) return fail(res, 400, 'court is closed. 48h limit.');
  const valid = req.body && req.body.valid ? 1 : 0;
  await q.run(`INSERT INTO excuse_votes (checkin_id, voter_id, valid) VALUES (?,?,?)
         ON CONFLICT(checkin_id, voter_id) DO UPDATE SET valid = excluded.valid`, c.id, req.user.id, valid);
  const votes = await q.all('SELECT valid FROM excuse_votes WHERE checkin_id = ?', c.id);
  const caps = votes.filter(v => !v.valid).length;
  const valids = votes.filter(v => v.valid).length;
  let capped = false;
  if (caps >= 2 && caps > valids) {
    // conditional flip — only the FIRST vote that crosses the threshold punishes
    const flip = await q.run('UPDATE checkins SET excuse_capped = 1 WHERE id = ? AND excuse_capped = 0', c.id);
    if (!flip.changes) return res.json({ ok: true, caps, valids, capped: true });
    const owner = await q.get('SELECT username FROM users WHERE id = ?', c.user_id);
    await award(c.user_id, 'excuse_capped', { aura: -100, note: c.excuse });
    await refSay(`excuse denied. "${c.excuse}" did not survive the tribunal. ${owner.username}: −100 aura. archived under fiction. (article v.)`);
    pushToUser(c.user_id, `the tribunal capped your excuse. −100 aura. "${c.excuse}" is now archived under fiction.`);
    fx({ kind: 'shame', userId: c.user_id });
    capped = true;
    broadcastSquad();
  }
  res.json({ ok: true, caps, valids, capped });
}));

app.get('/api/excuse/pending', auth, ah(async (req, res) => {
  const cutoff = Date.now() - 48 * 3600 * 1000;
  const rows = await q.all(
    `SELECT c.id, c.user_id, c.date, c.excuse, c.excuse_capped, c.created_at, u.username
     FROM checkins c JOIN users u ON u.id = c.user_id
     WHERE c.status = 'no' AND c.excuse != '' AND c.created_at > ? ORDER BY c.created_at DESC`, cutoff);
  const out = [];
  for (const r of rows) {
    const votes = await q.all('SELECT voter_id, valid FROM excuse_votes WHERE checkin_id = ?', r.id);
    out.push({
      ...r,
      caps: votes.filter(v => !v.valid).length,
      valids: votes.filter(v => v.valid).length,
      myVote: (votes.find(v => v.voter_id === req.user.id) || { valid: null }).valid,
    });
  }
  res.json(out);
}));

// ============================================================
// FORMAL CALLOUTS
// ============================================================
app.post('/api/callouts', auth, ah(async (req, res) => {
  const targetId = Number(req.body && req.body.targetId);
  const target = await q.get('SELECT * FROM users WHERE id = ?', targetId);
  if (!target) return fail(res, 404, 'no such member.');
  if (targetId === req.user.id) return fail(res, 400, 'you can’t call yourself out. that’s called a journal.');
  const week = isoWeek(localDate(validTz(req.user.tz)));
  if (await q.get(`SELECT 1 FROM callouts WHERE caller_id = ? AND week = ?`, req.user.id, week))
    return fail(res, 400, 'one formal callout per week. choose your target with intention.');
  if (await q.get(`SELECT 1 FROM callouts WHERE target_id = ? AND status = 'open'`, targetId))
    return fail(res, 400, 'they’re already under formal questioning.');
  const trained = await q.get(`SELECT 1 FROM checkins WHERE user_id = ? AND date = ? AND status = 'yes'`, targetId, localDate(validTz(target.tz)));
  if (trained) return fail(res, 400, 'they already trained today. the callout would embarrass only you.');
  await q.run('INSERT INTO callouts (caller_id, target_id, week, created_at) VALUES (?,?,?,?)', req.user.id, targetId, week, Date.now());
  await refSay(`callout issued. ${req.user.username} has formally questioned ${target.username}'s whereabouts. ${target.username} has 48 hours to post a workout. (article vi.)`);
  pushToUser(targetId, `${req.user.username} has formally questioned your whereabouts. 48 hours. post a workout or take −100 aura.`);
  fx({ kind: 'callout', userId: targetId });
  broadcastSquad();
  res.json({ ok: true });
}));

app.get('/api/callouts', auth, ah(async (req, res) => {
  const rows = await q.all(
    `SELECT c.*, uc.username AS caller, ut.username AS target FROM callouts c
     JOIN users uc ON uc.id = c.caller_id JOIN users ut ON ut.id = c.target_id
     ORDER BY c.created_at DESC LIMIT 20`);
  const week = isoWeek(localDate(validTz(req.user.tz)));
  const mine = await q.get('SELECT 1 FROM callouts WHERE caller_id = ? AND week = ?', req.user.id, week);
  res.json({ rows, usedThisWeek: !!mine });
}));

// ============================================================
// LEADERBOARD / HALL / STATS
// ============================================================
app.get('/api/leaderboard', auth, ah(async (req, res) => {
  const period = req.query.period === 'all' ? 'all' : 'week';
  res.json({ period, rows: await leaderboard(period) });
}));

app.get('/api/hall', auth, ah(async (req, res) => {
  const rows = await q.all(
    `SELECT h.*, u.username FROM hall h JOIN users u ON u.id = h.user_id ORDER BY h.created_at DESC LIMIT 60`);
  res.json({ week: isoWeek(localDate(validTz(req.user.tz))), rows });
}));

app.get('/api/stats/:userId', auth, ah(async (req, res) => {
  const s = await userStats(Number(req.params.userId));
  if (!s) return fail(res, 404, 'no such soldier.');
  res.json(s);
}));

// ============================================================
// THE POT
// ============================================================
app.get('/api/pot', auth, ah(async (req, res) => {
  const cfg = await potConfig();
  const entries = await q.all(
    `SELECT p.*, u.username FROM pot_entries p JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT 100`);
  const byUser = await q.all(
    `SELECT u.id, u.username,
       COALESCE(SUM(p.amount),0) AS total,
       COALESCE(SUM(CASE WHEN p.settled=0 THEN p.amount ELSE 0 END),0) AS owed
     FROM users u LEFT JOIN pot_entries p ON p.user_id = u.id GROUP BY u.id ORDER BY total DESC`);
  const grand = await q.get(`SELECT COALESCE(SUM(amount),0) AS total, COALESCE(SUM(CASE WHEN settled=0 THEN amount ELSE 0 END),0) AS owed FROM pot_entries`);
  res.json({ config: cfg, entries, byUser, total: grand.total, owed: grand.owed });
}));

app.post('/api/pot/settle', auth, ah(async (req, res) => {
  // settle all of one member's outstanding entries — by themselves or anyone (squad trust + receipts)
  const targetId = Number(req.body && req.body.userId || req.user.id);
  const target = await q.get('SELECT username FROM users WHERE id = ?', targetId);
  if (!target) return fail(res, 404, 'no such member.');
  const owed = await withLock('user:' + targetId, async () => {
    const sum = (await q.get('SELECT COALESCE(SUM(amount),0) AS s FROM pot_entries WHERE user_id = ? AND settled = 0', targetId)).s;
    if (sum) await q.run('UPDATE pot_entries SET settled = 1 WHERE user_id = ? AND settled = 0', targetId);
    return sum;
  });
  if (!owed) return fail(res, 400, 'nothing outstanding. clean ledger.');
  const cfg = await potConfig();
  await refSay(`${target.username} settled ${cfg.currency}${owed} into the pot. the dec 20 dinner thanks them. (article ix.)`);
  broadcastSquad();
  res.json({ ok: true, settled: owed });
}));

app.post('/api/pot/config', auth, ah(async (req, res) => {
  const amount = Math.max(0, Math.min(100000, Number(req.body && req.body.amount)));
  const currency = String(req.body && req.body.currency || '₹').slice(0, 3);
  if (!Number.isFinite(amount)) return fail(res, 400, 'amount must be a number.');
  await setMeta('pot_amount', amount);
  await setMeta('pot_currency', currency);
  await refSay(`${req.user.username} amended article iv. skips now cost ${currency}${amount} to the pot. democracy was not consulted.`);
  broadcastSquad();
  res.json({ ok: true });
}));

// ============================================================
// PHOTO VAULT — before at signup, after unlocks dec 20
// ============================================================
app.post('/api/photo', auth, ah(async (req, res) => {
  const { kind, data } = req.body || {};
  if (kind !== 'before' && kind !== 'after') return fail(res, 400, 'kind must be before or after.');
  if (kind === 'after' && localDate(validTz(req.user.tz)) < GOAL_DATE)
    return fail(res, 400, 'the after photo unlocks on dec 20. no spoilers.');
  if (typeof data !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(data))
    return fail(res, 400, 'send a jpeg/png/webp data url.');
  if (data.length > 900000) return fail(res, 400, 'photo too large even after compression. how.');
  await q.run(`UPDATE users SET photo_${kind} = ?, photo_${kind}_at = ? WHERE id = ?`, data, Date.now(), req.user.id);
  if (kind === 'before') await refSay(`${req.user.username} has filed a before photo. the evidence is sealed until dec 20.`);
  else await refSay(`${req.user.username} has filed their after photo. the jury may now compare.`);
  broadcastSquad();
  res.json({ ok: true });
}));

app.get('/api/photo/:userId/:kind', auth, ah(async (req, res) => {
  const { userId, kind } = req.params;
  if (kind !== 'before' && kind !== 'after') return fail(res, 400, 'bad kind.');
  // the evidence is sealed: you can see your own anytime; everyone else's unlocks dec 20.
  // enforced HERE, not just in the ui — curl is not a loophole.
  if (Number(userId) !== req.user.id && localDate(validTz(req.user.tz)) < GOAL_DATE)
    return fail(res, 403, 'sealed until dec 20. no spoilers.');
  const u = await q.get(`SELECT photo_${kind} AS photo, photo_${kind}_at AS at FROM users WHERE id = ?`, Number(userId));
  if (!u || !u.photo) return fail(res, 404, 'no photo filed.');
  res.json({ data: u.photo, at: u.at });
}));

// ============================================================
// PUSH
// ============================================================
app.post('/api/push/subscribe', auth, ah(async (req, res) => {
  await saveSubscription(req.user.id, req.body && req.body.subscription);
  await q.run('UPDATE users SET push_enabled = 1 WHERE id = ?', req.user.id);
  res.json({ ok: true });
}));
app.post('/api/push/unsubscribe', auth, ah(async (req, res) => {
  if (req.body && req.body.endpoint) await removeSubscription(String(req.body.endpoint));
  res.json({ ok: true });
}));
app.post('/api/push/toggle', auth, ah(async (req, res) => {
  const enabled = req.body && req.body.enabled ? 1 : 0;
  await q.run('UPDATE users SET push_enabled = ? WHERE id = ?', enabled, req.user.id);
  res.json({ ok: true, enabled: !!enabled });
}));
app.post('/api/push/test', auth, ah(async (req, res) => {
  pushToUser(req.user.id, 'this is what consequences will feel like. notifications armed.');
  res.json({ ok: true });
}));

// ============================================================
// SHOP
// ============================================================
app.get('/api/shop', auth, ah(async (req, res) => {
  const inventory = {};
  for (const r of await q.all('SELECT item_id, qty FROM inventory WHERE user_id = ? AND qty > 0', req.user.id)) inventory[r.item_id] = r.qty;
  const u = await q.get('SELECT coins, double_xp_date, tz FROM users WHERE id = ?', req.user.id);
  res.json({ items: SHOP_ITEMS, inventory, coins: u.coins, doubleXpDate: u.double_xp_date, today: localDate(validTz(u.tz)) });
}));

app.post('/api/shop/buy', auth, ah(async (req, res) => {
  try {
    const { item, refMessage } = await withLock('user:' + req.user.id,
      () => buyItem(req.user, String(req.body && req.body.itemId || '')));
    if (refMessage) await refSay(refMessage);
    broadcastSquad();
    const u = await q.get('SELECT * FROM users WHERE id = ?', req.user.id);
    const inventory = {};
    for (const r of await q.all('SELECT item_id, qty FROM inventory WHERE user_id = ? AND qty > 0', u.id)) inventory[r.item_id] = r.qty;
    res.json({ ok: true, item: item.id, user: publicUser(u), inventory, doubleXpDate: u.double_xp_date });
  } catch (e) {
    if (e.code) return fail(res, 400, e.message);
    throw e;
  }
}));

// ============================================================
// WAGERS
// ============================================================
app.get('/api/wagers', auth, ah(async (req, res) => {
  const wagers = await q.all('SELECT w.*, u.username AS creator FROM wagers w JOIN users u ON u.id = w.creator_id ORDER BY w.created_at DESC LIMIT 40');
  const out = [];
  for (const w of wagers) {
    out.push({
      ...w,
      members: await q.all(
        `SELECT wm.user_id, wm.is_loser, wm.paid, u.username FROM wager_members wm JOIN users u ON u.id = wm.user_id WHERE wm.wager_id = ?`, w.id),
    });
  }
  res.json(out);
}));

app.post('/api/wagers', auth, ah(async (req, res) => {
  const { title, stake, deadline } = req.body || {};
  const t = String(title || '').trim().slice(0, 80);
  const s = String(stake || '').trim().slice(0, 120);
  if (t.length < 3) return fail(res, 400, 'wager needs a real title.');
  if (s.length < 3) return fail(res, 400, 'no stake, no wager. what does the loser owe?');
  const today = localDate(validTz(req.user.tz));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(deadline || '')) || deadline <= today) return fail(res, 400, 'deadline must be a future date.');
  const r = await q.run('INSERT INTO wagers (creator_id, title, stake, deadline, created_at) VALUES (?,?,?,?,?)',
    req.user.id, t, s, deadline, Date.now());
  await q.run('INSERT INTO wager_members (wager_id, user_id) VALUES (?,?)', r.lastInsertRowid, req.user.id);
  await refSay(`${req.user.username} opened a wager: "${t}". stake: ${s}. deadline ${deadline}. joining is voluntary. so is losing. (article vii.)`);
  broadcastSquad();
  res.json({ ok: true, id: r.lastInsertRowid });
}));

app.post('/api/wagers/:id/join', auth, ah(async (req, res) => {
  const w = await q.get('SELECT * FROM wagers WHERE id = ?', Number(req.params.id));
  if (!w || w.status !== 'open') return fail(res, 404, 'that wager is closed or gone.');
  if (await q.get('SELECT 1 FROM wager_members WHERE wager_id = ? AND user_id = ?', w.id, req.user.id)) return fail(res, 400, 'already in.');
  await q.run('INSERT INTO wager_members (wager_id, user_id) VALUES (?,?)', w.id, req.user.id);
  await refSay(`${req.user.username} joined the wager "${w.title}". noted. witnessed. binding.`);
  broadcastSquad();
  res.json({ ok: true });
}));

app.post('/api/wagers/:id/settle', auth, ah(async (req, res) => {
  const w = await q.get('SELECT * FROM wagers WHERE id = ?', Number(req.params.id));
  if (!w || w.status !== 'open') return fail(res, 404, 'that wager is closed or gone.');
  if (w.creator_id !== req.user.id) return fail(res, 403, 'only the wager creator can settle it.');
  const loserIds = Array.isArray(req.body && req.body.loserIds) ? req.body.loserIds.map(Number) : [];
  const members = await q.all('SELECT user_id FROM wager_members WHERE wager_id = ?', w.id);
  const memberIds = new Set(members.map(m => m.user_id));
  if (!loserIds.length || !loserIds.every(id => memberIds.has(id))) return fail(res, 400, 'losers must be wager members.');
  const settle = await q.run(`UPDATE wagers SET status = 'settled' WHERE id = ? AND status = 'open'`, w.id);
  if (!settle.changes) return fail(res, 409, 'already settled. one L per wager.');
  const names = [];
  for (const id of loserIds) {
    await q.run('UPDATE wager_members SET is_loser = 1 WHERE wager_id = ? AND user_id = ?', w.id, id);
    await award(id, 'wager_loss', { aura: -75, note: w.title });
    names.push((await q.get('SELECT username FROM users WHERE id = ?', id)).username);
    pushToUser(id, `wager settled: "${w.title}". you took the L. you owe: ${w.stake}.`);
    fx({ kind: 'shame', userId: id });
  }
  await refSay(`wager settled: "${w.title}". ${names.join(' & ')} took the L. owed: ${w.stake}. −75 aura each. the ledger is patient.`);
  broadcastSquad();
  res.json({ ok: true });
}));

app.post('/api/wagers/:id/paid', auth, ah(async (req, res) => {
  const w = await q.get('SELECT * FROM wagers WHERE id = ?', Number(req.params.id));
  if (!w) return fail(res, 404, 'no such wager.');
  const targetId = Number(req.body && req.body.userId || req.user.id);
  if (targetId !== req.user.id && w.creator_id !== req.user.id) return fail(res, 403, 'only the loser or the creator can clear a debt.');
  const m = await q.get('SELECT * FROM wager_members WHERE wager_id = ? AND user_id = ?', w.id, targetId);
  if (!m || !m.is_loser) return fail(res, 400, 'that person doesn’t owe anything here.');
  const pay = await q.run('UPDATE wager_members SET paid = 1 WHERE wager_id = ? AND user_id = ? AND paid = 0', w.id, targetId);
  if (!pay.changes) return fail(res, 400, 'already paid.');
  const name = (await q.get('SELECT username FROM users WHERE id = ?', targetId)).username;
  await award(targetId, 'debt_cleared', { aura: 25, note: w.title });
  await refSay(`${name} settled their debt on "${w.title}". honor restored. +25 aura.`);
  broadcastSquad();
  res.json({ ok: true });
}));

// ============================================================
// CHAT
// ============================================================
app.get('/api/chat', auth, ah(async (req, res) => {
  const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const rows = await q.all('SELECT id FROM messages WHERE id < ? ORDER BY id DESC LIMIT ?', before, limit);
  const out = [];
  for (const r of rows.reverse()) out.push(await messageRow(r.id));
  res.json(out);
}));

// ============================================================
// SOCKET.IO
// ============================================================
io.use((socket, next) => {
  userFromToken(socket.handshake.auth && socket.handshake.auth.token)
    .then(u => {
      if (!u) return next(new Error('unauthorized'));
      socket.user = u;
      next();
    })
    .catch(next);
});

io.on('connection', (socket) => {
  q.run('UPDATE users SET last_seen = ? WHERE id = ?', Date.now(), socket.user.id).then(broadcastSquad).catch(() => {});

  socket.on('chat:send', async (payload, ack) => {
    try {
      const text = String(payload && payload.text || '').trim().slice(0, 1000);
      if (!text) return ack && ack({ error: 'empty' });
      await q.run('UPDATE users SET last_seen = ? WHERE id = ?', Date.now(), socket.user.id);
      const msg = await postMessage(socket.user.id, 'user', text);
      ack && ack({ ok: true, id: msg.id });
    } catch { ack && ack({ error: 'send failed' }); }
  });

  socket.on('chat:react', async (payload, ack) => {
    try {
      const messageId = Number(payload && payload.messageId);
      const emoji = String(payload && payload.emoji || '').slice(0, 24);
      if (!messageId || !emoji) return ack && ack({ error: 'bad reaction' });
      if (![...REACTIONS, ...STICKERS].includes(emoji)) return ack && ack({ error: 'not in the approved reaction arsenal' });
      if (!await q.get('SELECT 1 FROM messages WHERE id = ?', messageId)) return ack && ack({ error: 'message gone' });
      const existing = await q.get('SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', messageId, socket.user.id, emoji);
      if (existing) await q.run('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', messageId, socket.user.id, emoji);
      else await q.run('INSERT INTO reactions (message_id, user_id, emoji) VALUES (?,?,?)', messageId, socket.user.id, emoji);
      io.emit('chat:react', { messageId, message: await messageRow(messageId) });
      ack && ack({ ok: true });
    } catch { ack && ack({ error: 'react failed' }); }
  });

  socket.on('chat:typing', () => {
    socket.broadcast.emit('chat:typing', { username: socket.user.username });
  });

  socket.on('disconnect', () => {
    q.run('UPDATE users SET last_seen = ? WHERE id = ?', Date.now() - 60000, socket.user.id)
      .then(() => setTimeout(broadcastSquad, 100)).catch(() => {});
  });
});

// ---------- error handling ----------
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'server pulled something. try again.' });
});

// ---------- boot ----------
await migrate();
await initPush();
await runReconcile(true);
setInterval(() => runReconcile(true), 10 * 60 * 1000);
setInterval(() => reminderTick().catch(e => console.error('reminder failed:', e)), 5 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`LOCKED IN — listening on http://localhost:${PORT}`);
  console.log(`${daysUntilGoal(localDate('UTC'))} days until ${GOAL_DATE}. clock's ticking.`);
});
