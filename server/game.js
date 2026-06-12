// game.js — the rules engine: XP, aura, coins, streaks, levels, shop, shame, pot.
// all async (libsql), all dates per-user timezone.
import { q, getMeta, setMeta } from './db.js';

export const GOAL_DATE = '2026-12-20';

// ============================================================
// COPY DECK — deadpan microcopy. lowercase. no exclamation marks.
// roast the miss, never the man.
// ============================================================
export const COPY = {
  skipCaptions: [
    'he said he was coming. he was not coming.',
    'studies show the gym was open.',
    'marked safe from progressive overload.',
    'the squat rack has been informed.',
    'even the tripod guy showed up today.',
    'skipped. witnesses: everyone.',
    'gravity won today.',
    'chose the bed. the bed always wins.',
    'the legs have been notified.',
  ],
  autoSkipCaptions: [
    'left the squad on read.',
    'didn’t even open the app. bold.',
    'silence is also an answer. a bad one.',
    'a workout was not logged. no further comment.',
  ],
  restAbuseCaptions: [
    'rest day 3 of a 1-day rest plan.',
    '"rest day" has been plural for a while now. flagged.',
    'resting from what, exactly.',
  ],
  streakLostCaptions: [
    'streak: cooked. it knew too much.',
    '{n} days. gone. it was avoidable.',
  ],
  cappedCaptions: [
    'excuse denied. archived under fiction.',
    'the squad reviewed the excuse. verdict: cap.',
  ],
  milestoneLines: {
    3: 'three days. statistically almost not a fluke.',
    7: 'seven days. statistically no longer a fluke.',
    14: 'two weeks. the front desk guy almost nodded.',
    30: 'thirty days. mild aura accumulation detected.',
    50: 'day 50. lightweight, apparently.',
    100: 'day 100. we go gym.',
  },
  levelUpLines: [
    'promoted. the mirror will be notified.',
    'level up. still natty (unverified).',
    'you have mogged your previous self. barely.',
    'hr has processed the paperwork.',
  ],
  fameTopXp: 'carried this week. everyone else is cargo.',
  famePerfectWeek: 'perfect week. zero excuses filed. no notes.',
  ghostReturn: 'has returned from the dead. act normal.',
};

export const EXCUSE_PRESETS = [
  'felt a tweak (mental)',
  'cns fatigue (woke up at 1pm)',
  'deload week (week 6 of deload)',
  'gym was "too crowded"',
  'work ran late (again)',
  'woke up and chose peace',
  'sore from yesterday’s planned workout',
  'traffic (distance walked: 0)',
  'social obligations',
  'other (type it, coward)',
];

// ============================================================
// LEVELS — the org chart. bureaucratic-mythic, lowercase.
// HIM is the only uppercase word in the entire app. that's the point.
// ============================================================
export const LEVELS = [
  { lv: 1,  xp: 0,     name: 'unpaid intern of gravity' },
  { lv: 2,  xp: 250,   name: 'tourist, gym district' },
  { lv: 3,  xp: 600,   name: 'junior bench associate' },
  { lv: 4,  xp: 1200,  name: 'card-carrying regular' },
  { lv: 5,  xp: 2200,  name: 'certified locked in' },
  { lv: 6,  xp: 3800,  name: 'licensed local menace' },
  { lv: 7,  xp: 6000,  name: 'registered public problem' },
  { lv: 8,  xp: 9000,  name: 'director of overload' },
  { lv: 9,  xp: 13000, name: 'load-bearing member' },
  { lv: 10, xp: 18000, name: 'HIM' },
];

export function levelFor(xp) {
  let cur = LEVELS[0];
  for (const l of LEVELS) if (xp >= l.xp) cur = l;
  const next = LEVELS.find(l => l.xp > xp) || null;
  return {
    lv: cur.lv, name: cur.name, floor: cur.xp,
    next: next ? { lv: next.lv, name: next.name, xp: next.xp } : null,
    progress: next ? (xp - cur.xp) / (next.xp - cur.xp) : 1,
  };
}

// ============================================================
// SHOP
// ============================================================
export const SHOP_ITEMS = [
  { id: 'streak_freeze', name: 'streak freeze', icon: '🧊', price: 150, maxHold: 2,
    desc: 'auto-saves your streak if you ghost a day. consumed silently. max 2.' },
  { id: 'shame_shield', name: 'shame shield', icon: '🛡️', price: 200, maxHold: 1,
    desc: 'eats your next wall of shame entry. the squad never finds out. max 1.' },
  { id: 'double_xp', name: '2x xp day', icon: '⚡', price: 250, maxHold: 0,
    desc: 'doubles xp on your next YES check-in day. activates instantly.' },
  { id: 'excuse_pass', name: 'excuse pass', icon: '🎫', price: 400, maxHold: 1,
    desc: 'your next NO doesn’t break your streak. one honest L, forgiven. max 1.' },
  { id: 'aura_juice', name: 'aura transfusion', icon: '🧃', price: 300, maxHold: 0,
    desc: '+100 aura, instantly. undetectable. probably.' },
];

// ============================================================
// DATE HELPERS — per-user timezone. dates are YYYY-MM-DD strings;
// calendar arithmetic on strings is timezone-free.
// ============================================================
const tzFmtCache = new Map();
function tzFmt(tz, opts, key) {
  const k = tz + '|' + key;
  if (!tzFmtCache.has(k)) {
    try { tzFmtCache.set(k, new Intl.DateTimeFormat('en-CA', { timeZone: tz, ...opts })); }
    catch { tzFmtCache.set(k, new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', ...opts })); }
  }
  return tzFmtCache.get(k);
}
export function validTz(tz) {
  try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return tz; }
  catch { return 'UTC'; }
}
export function localDate(tz, d = new Date()) {
  return tzFmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }, 'd').format(d); // YYYY-MM-DD
}
export function localHM(tz, d = new Date()) {
  return tzFmt(tz, { hour: '2-digit', minute: '2-digit', hour12: false }, 't').format(d); // HH:mm
}
export function addDays(str, n) {
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
function dow(str) { // 0=sun … 6=sat, timezone-free
  const [y, m, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
export function isoWeek(str) {
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayNum = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dayNum + 3);
  const firstThu = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((dt - firstThu) / (7 * 86400000));
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
export function weekDates(str) { // mon..sun containing str
  const mon = addDays(str, -((dow(str) + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}
export function daysUntilGoal(from) {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = GOAL_DATE.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
export function isWinterArc(date) {
  const left = daysUntilGoal(date);
  return left <= 90 && left >= 0;
}
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// ============================================================
// THE POT + THE CONSTITUTION
// ============================================================
export async function potConfig() {
  return {
    amount: Number(await getMeta('pot_amount', '100')),
    currency: await getMeta('pot_currency', '₹'),
  };
}
export async function addPotEntry(userId, reason, date) {
  const { amount } = await potConfig();
  if (amount <= 0) return 0;
  await q.run('INSERT INTO pot_entries (user_id, amount, reason, date, created_at) VALUES (?,?,?,?,?)',
    userId, amount, reason, date, Date.now());
  return amount;
}
export async function constitutionText() {
  const { amount, currency } = await potConfig();
  return [
    { art: 'article i — the goal', text: 'ripped by december 20, 2026. this date does not move.' },
    { art: 'article ii — the daily question', text: 'every member answers the daily question: did you go gym. silence counts as a skip. the ref files it automatically.' },
    { art: 'article iii — rest', text: 'two rest days per week. rest days pause the streak; they do not feed it. a third rest day is a skip wearing a costume and is punished accordingly.' },
    { art: 'article iv — skips', text: `a skip costs 25 xp, 150 aura, a wall of shame entry, and ${currency}${amount} to the pot. the wall forgets nothing.` },
    { art: 'article v — excuses', text: 'a no requires an excuse. excuses face tribunal review for 48 hours. a capped excuse costs 100 aura and is archived under fiction.' },
    { art: 'article vi — callouts', text: 'each member may formally question one member per week. the questioned has 48 hours to post a workout or forfeit 100 aura.' },
    { art: 'article vii — wagers', text: 'wagers are voluntary to join and binding to lose. the ledger is patient.' },
    { art: 'article viii — the winter arc', text: 'the final 90 days before the goal. all aura penalties are doubled. nobody is safe.' },
    { art: 'article ix — the pot', text: `the pot funds the december 20 dinner. ${currency}${amount} per skip. debts are settled between members; the app keeps receipts.` },
    { art: 'article x — HIM', text: 'someone must become HIM. it does not have to be you. it could be you.' },
  ];
}

// ============================================================
// INVENTORY
// ============================================================
export async function invQty(userId, itemId) {
  const r = await q.get('SELECT qty FROM inventory WHERE user_id = ? AND item_id = ?', userId, itemId);
  return r ? r.qty : 0;
}
export async function invAdd(userId, itemId, delta) {
  await q.run(`INSERT INTO inventory (user_id, item_id, qty) VALUES (?, ?, ?)
         ON CONFLICT(user_id, item_id) DO UPDATE SET qty = qty + ?`, userId, itemId, delta, delta);
}

// ============================================================
// EVENTS LEDGER + CURRENCY MUTATION
// ============================================================
export async function award(userId, kind, { xp = 0, aura = 0, coins = 0, note = '' } = {}) {
  // relative updates — atomic per statement, no lost deltas under concurrency
  await q.run('UPDATE users SET xp = MAX(0, xp + ?), coins = MAX(0, coins + ?), aura = aura + ? WHERE id = ?',
    xp, coins, aura, userId);
  await q.run('INSERT INTO events (user_id, kind, xp_delta, aura_delta, coin_delta, note, created_at) VALUES (?,?,?,?,?,?,?)',
    userId, kind, xp, aura, coins, note, Date.now());
  return { xp, aura, coins };
}

// consume one of an item atomically; returns true only if one was actually held
export async function invConsume(userId, itemId) {
  const r = await q.run('UPDATE inventory SET qty = qty - 1 WHERE user_id = ? AND item_id = ? AND qty > 0', userId, itemId);
  return r.changes > 0;
}

// ============================================================
// STREAKS — yes days build it. valid rest / frozen days PAUSE it
// (no increment, no break). no / skip / missing days kill it.
// ============================================================
export async function computeStreak(userId, asOf) {
  const rows = await q.all('SELECT date, status, over_quota, frozen FROM checkins WHERE user_id = ? ORDER BY date DESC', userId);
  const map = new Map(rows.map(r => [r.date, r]));
  let streak = 0;
  let day = asOf;
  if (!map.has(day)) day = addDays(day, -1); // today pending doesn't break it yet
  while (true) {
    const c = map.get(day);
    if (!c) break;
    if (c.status === 'yes') streak++;
    else if ((c.status === 'rest' && !c.over_quota) || c.frozen) { /* pause — walk through */ }
    else break;
    day = addDays(day, -1);
  }
  return streak;
}
export async function refreshStreak(userId, tz) {
  const streak = await computeStreak(userId, localDate(tz));
  const u = await q.get('SELECT longest_streak FROM users WHERE id = ?', userId);
  const longest = Math.max(u.longest_streak, streak);
  await q.run('UPDATE users SET current_streak = ?, longest_streak = ? WHERE id = ?', streak, longest, userId);
  return streak;
}

// ============================================================
// SHAME / FAME
// ============================================================
export async function addShame(userId, reason, caption, week) {
  if (await invConsume(userId, 'shame_shield')) {
    return { shielded: true };
  }
  await q.run('INSERT INTO hall (user_id, kind, week, reason, caption, created_at) VALUES (?,?,?,?,?,?)',
    userId, 'shame', week, reason, caption, Date.now());
  return { shielded: false };
}
export async function addFame(userId, reason, caption, week) {
  await q.run('INSERT INTO hall (user_id, kind, week, reason, caption, created_at) VALUES (?,?,?,?,?,?)',
    userId, 'fame', week, reason, caption, Date.now());
}

// ============================================================
// STREAK MILESTONES
// ============================================================
const MILESTONES = [
  { n: 3,   xp: 30,   aura: 50,   coins: 20 },
  { n: 7,   xp: 70,   aura: 100,  coins: 40 },
  { n: 14,  xp: 150,  aura: 200,  coins: 80 },
  { n: 30,  xp: 300,  aura: 400,  coins: 150 },
  { n: 50,  xp: 500,  aura: 600,  coins: 250 },
  { n: 100, xp: 1000, aura: 1000, coins: 500 },
];
const milestonesCrossed = (prev, next) => MILESTONES.filter(m => prev < m.n && next >= m.n);

// ============================================================
// CHECK-IN — the core transaction.
// Returns { checkin, refMessages[], fx[], pushes[], levelUp, milestones[], streak }
// ============================================================
export async function applyCheckin(user, { status, description = '', excuse = '' }) {
  const tz = validTz(user.tz);
  const date = localDate(tz);
  const week = isoWeek(date);
  const existing = await q.get('SELECT * FROM checkins WHERE user_id = ? AND date = ?', user.id, date);
  if (existing && !existing.auto) {
    const err = new Error('already checked in today. no take-backs.');
    err.code = 'ALREADY';
    throw err;
  }

  const prevStreak = await computeStreak(user.id, addDays(date, -1));
  const prevLevel = levelFor(user.xp).lv;
  const refMessages = [];
  const fx = [];
  const pushes = [];
  const winter = isWinterArc(date);
  const pen = n => winter ? n * 2 : n;
  let xp = 0, aura = 0, coins = 0;
  let frozen = 0, overQuota = 0, finalStatus = status;
  let caption = '';

  if (existing) {
    // replacing an auto-skip (timezone traveler re-living a reconciled day):
    // refund what the ghost fine took, and void that day's pot charge.
    // the shame row stays — the wall forgets nothing.
    if (existing.xp_delta || existing.aura_delta) {
      await award(user.id, 'auto_skip_reversed', { xp: -existing.xp_delta, aura: -existing.aura_delta, note: existing.date });
    }
    await q.run(`DELETE FROM pot_entries WHERE user_id = ? AND date = ? AND settled = 0 AND reason = 'ghosted the day'`, user.id, existing.date);
    await q.run('DELETE FROM checkins WHERE id = ?', existing.id);
  }

  if (status === 'rest') {
    const wk = weekDates(date).filter(d => d <= date);
    const used = (await q.all(
      `SELECT 1 FROM checkins WHERE user_id = ? AND status = 'rest' AND over_quota = 0 AND date IN (${wk.map(() => '?').join(',')})`,
      user.id, ...wk)).length;
    if (used >= 2) {
      finalStatus = 'skip';
      overQuota = 1;
      xp = -25; aura = pen(-150);
      caption = pick(COPY.restAbuseCaptions);
      const sh = await addShame(user.id, 'rest_abuse', caption, week);
      const potAmt = await addPotEntry(user.id, 'rest day abuse', date);
      const potLine = potAmt ? ` +${potAmt} to the pot, per article iv.` : '';
      refMessages.push(sh.shielded
        ? `${user.username}'s shame shield quietly ate something. the squad will never know.${potLine}`
        : `${user.username} filed a third "rest day" this week. ${caption} ${aura} aura.${potLine}`);
      fx.push({ kind: 'shame', userId: user.id });
    } else {
      xp = 15; coins = 5;
      refMessages.push(`${user.username} is on a rest day (${used + 1}/2 this week). the streak holds its breath.`);
    }
  } else if (status === 'yes') {
    const streakWithToday = prevStreak + 1;
    let base = 50;
    if (description.trim().length >= 20) base += 10;
    let mult = 1;
    if (streakWithToday >= 30) mult = 2;
    else if (streakWithToday >= 14) mult = 1.75;
    else if (streakWithToday >= 7) mult = 1.5;
    else if (streakWithToday >= 3) mult = 1.25;
    let boosted = false;
    if (user.double_xp_date === date) { mult *= 2; boosted = true; await q.run('UPDATE users SET double_xp_date = NULL WHERE id = ?', user.id); }
    xp = Math.round(base * mult);
    coins = 10; aura = 25;
    fx.push({ kind: 'checkin_yes', userId: user.id });
    if (boosted) refMessages.push(`${user.username} cashed a 2x xp day. +${xp} xp. menace behavior.`);
    // returned from the dead: 3+ consecutive unfrozen skips before today
    let deadDays = 0;
    for (let d = addDays(date, -1); ; d = addDays(d, -1)) {
      const c = await q.get('SELECT status, frozen FROM checkins WHERE user_id = ? AND date = ?', user.id, d);
      if (c && c.status === 'skip' && !c.frozen) deadDays++;
      else break;
    }
    if (deadDays >= 3) refMessages.push(`${user.username} ${COPY.ghostReturn}`);
    // answered callouts
    const open = await q.all(`SELECT id, caller_id FROM callouts WHERE target_id = ? AND status = 'open'`, user.id);
    for (const c of open) {
      await q.run(`UPDATE callouts SET status = 'answered' WHERE id = ?`, c.id);
      const caller = await q.get('SELECT username FROM users WHERE id = ?', c.caller_id);
      refMessages.push(`callout answered. ${user.username} posted a workout within the window. ${caller.username} has been notified.`);
      pushes.push({ userId: c.caller_id, body: `${user.username} answered your callout. they actually went.` });
    }
  } else if (status === 'no') {
    if (await invConsume(user.id, 'excuse_pass')) {
      frozen = 1;
      aura = -25;
      refMessages.push(`${user.username} burned an excuse pass. streak lives. aura doesn’t (−25).`);
    } else {
      aura = pen(-50);
      if (prevStreak >= 7) {
        caption = pick(COPY.streakLostCaptions).replace('{n}', prevStreak);
        const sh = await addShame(user.id, 'streak_lost', caption, week);
        if (!sh.shielded) refMessages.push(`${user.username} lost a ${prevStreak}-day streak. ${caption}`);
      }
      refMessages.push(`${user.username} has filed an excuse: "${excuse || 'none. just vibes.'}" — the tribunal is now in session.`);
      const reps = (await q.get(
        `SELECT COUNT(*) AS n FROM checkins WHERE user_id = ? AND status = 'no' AND excuse = ? AND date < ?`,
        user.id, excuse.trim(), date)).n;
      if (reps >= 2) refMessages.push(`the excuse "${excuse.trim()}" has now been filed ${reps + 1} times. archived under fiction.`);
    }
  } else if (status === 'skip') {
    xp = -25; aura = pen(-150);
    caption = pick(COPY.skipCaptions);
    const sh = await addShame(user.id, 'skip', caption, week);
    const potAmt = await addPotEntry(user.id, 'skip', date);
    const potLine = potAmt ? ` +${potAmt} to the pot, per article iv.` : '';
    refMessages.push(sh.shielded
      ? `${user.username}'s shame shield quietly ate something. the squad will never know.${potLine}`
      : `${user.username} skipped. ${caption} ${aura} aura.${potLine}`);
    fx.push({ kind: 'shame', userId: user.id });
  } else {
    const err = new Error('invalid status');
    err.code = 'BAD_STATUS';
    throw err;
  }

  const now = Date.now();
  const ins = await q.run(
    `INSERT INTO checkins (user_id, date, status, description, excuse, auto, frozen, over_quota, xp_delta, aura_delta, coin_delta, created_at)
     VALUES (?,?,?,?,?,0,?,?,?,?,?,?)`,
    user.id, date, finalStatus, description.trim(), excuse.trim(), frozen, overQuota, xp, aura, coins, now);

  await award(user.id, `checkin_${finalStatus}`, { xp, aura, coins, note: date });
  const newStreak = await refreshStreak(user.id, tz);

  const crossed = milestonesCrossed(prevStreak, newStreak);
  for (const m of crossed) {
    await award(user.id, 'milestone', { xp: m.xp, aura: m.aura, coins: m.coins, note: `${m.n}-day streak` });
    const line = COPY.milestoneLines[m.n] || `${m.n} days.`;
    refMessages.push(`${user.username}: ${m.n}-day streak. ${line} +${m.xp} xp, +${m.aura} aura.`);
    fx.push({ kind: 'milestone', userId: user.id, n: m.n });
  }

  const fresh = await q.get('SELECT xp FROM users WHERE id = ?', user.id);
  const newLevel = levelFor(fresh.xp);
  let levelUp = null;
  if (newLevel.lv > prevLevel) {
    levelUp = newLevel;
    refMessages.push(`${user.username} is now lv.${newLevel.lv} "${newLevel.name}". ${pick(COPY.levelUpLines)}`);
    fx.push({ kind: 'levelup', userId: user.id, level: newLevel.lv, name: newLevel.name });
  } else if (newLevel.lv < prevLevel) {
    refMessages.push(`${user.username} de-evolved to lv.${newLevel.lv} "${newLevel.name}". the chuzz version is winning.`);
    fx.push({ kind: 'shame', userId: user.id });
  }

  const checkin = await q.get('SELECT * FROM checkins WHERE id = ?', ins.lastInsertRowid);
  return { checkin, refMessages, fx, pushes, levelUp, milestones: crossed.map(m => m.n), streak: newStreak };
}

// ============================================================
// RECONCILE — per-user-timezone backfill, callout expiry,
// weekly fame, winter arc. Returns { refMessages[], pushes[] }
// ============================================================
export async function reconcile() {
  const refMessages = [];
  const pushes = [];
  const users = await q.all('SELECT * FROM users');
  if (!users.length) return { refMessages, pushes };

  // earliest local date across the squad (the furthest-behind timezone)
  const localToday = u => localDate(validTz(u.tz));
  const minToday = users.map(localToday).sort()[0];

  // winter arc begins (judged on the earliest timezone so nobody gets doubled early)
  if (isWinterArc(minToday) && (await getMeta('winter_arc_announced')) !== '1') {
    await setMeta('winter_arc_announced', '1');
    refMessages.push(`the winter arc has begun. ${daysUntilGoal(minToday)} days to dec 20. aura penalties are doubled. nobody is safe. (article viii.)`);
    for (const u of users) pushes.push({ userId: u.id, body: 'the winter arc has begun. penalties are doubled. nobody is safe.' });
  }

  for (const u of users) {
    const tz = validTz(u.tz);
    const today = localToday(u);
    const have = new Set((await q.all('SELECT date FROM checkins WHERE user_id = ?', u.id)).map(r => r.date));
    const missing = [];
    for (let d = u.joined_date; d < today; d = addDays(d, 1)) {
      if (!have.has(d)) missing.push(d);
    }
    if (!missing.length) { await refreshStreak(u.id, tz); continue; }

    let frozeCount = 0, skipCount = 0, totalAura = 0, potTotal = 0;
    for (const d of missing) {
      if (await invConsume(u.id, 'streak_freeze')) {
        await q.run(`INSERT INTO checkins (user_id, date, status, auto, frozen, created_at) VALUES (?,?,'skip',1,1,?)`, u.id, d, Date.now());
        frozeCount++;
      } else {
        const aura = isWinterArc(d) ? -300 : -150;
        await q.run(`INSERT INTO checkins (user_id, date, status, auto, xp_delta, aura_delta, created_at) VALUES (?,?,'skip',1,-25,?,?)`, u.id, d, aura, Date.now());
        await award(u.id, 'auto_skip', { xp: -25, aura, note: d });
        await addShame(u.id, 'skip', pick(COPY.autoSkipCaptions), isoWeek(d));
        potTotal += await addPotEntry(u.id, 'ghosted the day', d);
        skipCount++; totalAura += aura;
      }
    }
    await refreshStreak(u.id, tz);
    const potLine = potTotal ? ` +${potTotal} to the pot, per article iv.` : '';
    if (frozeCount) {
      refMessages.push(`${u.username}'s streak freeze auto-activated. streak survives. that was insurance, not absolution.`);
      pushes.push({ userId: u.id, body: 'your streak freeze just saved you. that was the safety net. there is no second net.' });
    }
    if (skipCount === 1) {
      refMessages.push(`${u.username} ghosted yesterday. didn’t even say no. auto-skip filed. ${totalAura} aura.${potLine}`);
      pushes.push({ userId: u.id, body: `you ghosted yesterday. auto-skip filed. ${totalAura} aura. the ledger remembers.` });
    } else if (skipCount > 1) {
      refMessages.push(`day ${skipCount} of no activity from ${u.username}. ${totalAura} aura.${potLine} the ledger remembers everything.`);
      pushes.push({ userId: u.id, body: `${skipCount} days of silence. ${totalAura} aura. the squad has noticed.` });
    }
  }

  // expire 48h-old open callouts
  const expired = await q.all(
    `SELECT c.id, c.caller_id, c.target_id FROM callouts c WHERE c.status = 'open' AND c.created_at < ?`,
    Date.now() - 48 * 3600 * 1000);
  for (const c of expired) {
    await q.run(`UPDATE callouts SET status = 'expired' WHERE id = ?`, c.id);
    const target = await q.get('SELECT username FROM users WHERE id = ?', c.target_id);
    const caller = await q.get('SELECT username FROM users WHERE id = ?', c.caller_id);
    await award(c.target_id, 'callout_expired', { aura: -100, note: `called out by ${caller.username}` });
    refMessages.push(`callout expired. ${target.username} was formally questioned by ${caller.username} and produced nothing in 48 hours. −100 aura. (article vi.)`);
    pushes.push({ userId: c.target_id, body: 'your 48 hours are up. nothing was produced. −100 aura.' });
  }

  // weekly fame — once per completed week, judged when the slowest timezone finishes it
  const prevWeekDate = addDays(minToday, -7);
  const prevWeek = isoWeek(prevWeekDate);
  const awarded = await getMeta('fame_awarded_week', '');
  if (awarded !== prevWeek) {
    const dates = weekDates(prevWeekDate);
    const ph = dates.map(() => '?').join(',');
    const xpRows = await q.all(
      `SELECT user_id, SUM(xp_delta) AS wxp FROM checkins WHERE date IN (${ph}) GROUP BY user_id ORDER BY wxp DESC`, ...dates);
    if (xpRows.length && xpRows[0].wxp > 0) {
      const top = users.find(x => x.id === xpRows[0].user_id);
      await addFame(top.id, 'top_xp', COPY.fameTopXp, prevWeek);
      refMessages.push(`weekly report: ${top.username} topped the board with ${xpRows[0].wxp} xp. ${COPY.fameTopXp}`);
    }
    for (const u of users) {
      if (u.joined_date > dates[0]) continue;
      const good = (await q.all(
        `SELECT 1 FROM checkins WHERE user_id = ? AND date IN (${ph}) AND (status = 'yes' OR (status = 'rest' AND over_quota = 0))`,
        u.id, ...dates)).length;
      if (good === 7) {
        await addFame(u.id, 'perfect_week', COPY.famePerfectWeek, prevWeek);
        refMessages.push(`${u.username} logged a perfect week. enshrined. ${COPY.famePerfectWeek}`);
      }
    }
    await setMeta('fame_awarded_week', prevWeek);
  }

  return { refMessages, pushes };
}

// ============================================================
// SHOP TRANSACTIONS
// ============================================================
export async function buyItem(user, itemId) {
  const item = SHOP_ITEMS.find(i => i.id === itemId);
  if (!item) { const e = new Error('no such item'); e.code = 'BAD_ITEM'; throw e; }
  const u = await q.get('SELECT * FROM users WHERE id = ?', user.id);
  if (item.maxHold > 0 && await invQty(u.id, item.id) >= item.maxHold) {
    const e = new Error(`you can only hold ${item.maxHold}. greed is a sin.`); e.code = 'MAX_HOLD'; throw e;
  }
  // atomic debit — fails outright instead of clamping an overdraft
  const debit = await q.run('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?', item.price, u.id, item.price);
  if (!debit.changes) { const e = new Error('not enough coins. go earn some.'); e.code = 'BROKE'; throw e; }

  const tz = validTz(u.tz);
  let refMessage = null;
  let auraDelta = 0;
  let note = item.id;
  if (item.id === 'aura_juice') {
    await q.run('UPDATE users SET aura = aura + 100 WHERE id = ?', u.id);
    auraDelta = 100;
    note = 'aura transfusion';
    refMessage = `${u.username} purchased aura. +100. money can’t buy gains but apparently it buys aura.`;
  } else if (item.id === 'double_xp') {
    const date = localDate(tz);
    const doneToday = await q.get(`SELECT 1 FROM checkins WHERE user_id = ? AND date = ? AND status = 'yes'`, u.id, date);
    const applyDate = doneToday ? addDays(date, 1) : date;
    await q.run('UPDATE users SET double_xp_date = ? WHERE id = ?', applyDate, u.id);
    note = `2x xp for ${applyDate}`;
    refMessage = `${u.username} activated a 2x xp day for ${applyDate === date ? 'today' : 'tomorrow'}. let him cook.`;
  } else {
    await invAdd(u.id, item.id, 1);
  }
  await q.run('INSERT INTO events (user_id, kind, xp_delta, aura_delta, coin_delta, note, created_at) VALUES (?,?,0,?,?,?,?)',
    u.id, 'purchase', auraDelta, -item.price, note, Date.now());
  return { item, refMessage };
}
