// game.js — the rules engine: XP, aura, coins, streaks, levels, shop, shame
import { db, q, getMeta, setMeta } from './db.js';

export const GOAL_DATE = '2026-12-20';

// ============================================================
// COPY DECK — all deadpan microcopy lives here.
// rules: lowercase. no exclamation marks. max one slang term per line.
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
// LEVELS — total XP thresholds. avatar evolves with level.
// HIM is the only uppercase word in the entire app. that's the point.
// ============================================================
export const LEVELS = [
  { lv: 1,  xp: 0,     name: 'npc' },
  { lv: 2,  xp: 250,   name: 'gym tourist' },
  { lv: 3,  xp: 600,   name: 'benchwarmer' },
  { lv: 4,  xp: 1200,  name: 'regular' },
  { lv: 5,  xp: 2200,  name: 'locked in' },
  { lv: 6,  xp: 3800,  name: 'menace' },
  { lv: 7,  xp: 6000,  name: 'problem' },
  { lv: 8,  xp: 9000,  name: 'gymmaxxed' },
  { lv: 9,  xp: 13000, name: 'the carry' },
  { lv: 10, xp: 18000, name: 'HIM' },
];

// ============================================================
// THE WINTER ARC — final 90 days before the goal. penalties double.
// ============================================================
export function isWinterArc(date) {
  return daysUntilGoal(date) <= 90 && daysUntilGoal(date) >= 0;
}

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
// DATE HELPERS (server-local timezone)
// ============================================================
export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(str, n) {
  const [y, m, d] = str.split('-').map(Number);
  return todayStr(new Date(y, m - 1, d + n));
}
export function isoWeek(str) {
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayNum = (dt.getUTCDay() + 6) % 7;        // Mon=0
  dt.setUTCDate(dt.getUTCDate() - dayNum + 3);    // nearest Thursday
  const firstThu = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((dt - firstThu) / (7 * 86400000));
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
export function weekDates(str) {            // Mon..Sun containing str
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const mon = new Date(y, m - 1, d - ((dt.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => todayStr(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i)));
}
export function daysUntilGoal(from = todayStr()) {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = GOAL_DATE.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// ============================================================
// INVENTORY
// ============================================================
export function invQty(userId, itemId) {
  const r = q.get('SELECT qty FROM inventory WHERE user_id = ? AND item_id = ?', userId, itemId);
  return r ? r.qty : 0;
}
export function invAdd(userId, itemId, delta) {
  q.run(`INSERT INTO inventory (user_id, item_id, qty) VALUES (?, ?, ?)
         ON CONFLICT(user_id, item_id) DO UPDATE SET qty = qty + ?`, userId, itemId, delta, delta);
}

// ============================================================
// EVENTS LEDGER + CURRENCY MUTATION
// ============================================================
export function award(userId, kind, { xp = 0, aura = 0, coins = 0, note = '' } = {}) {
  const u = q.get('SELECT xp, coins, aura FROM users WHERE id = ?', userId);
  const newXp = Math.max(0, u.xp + xp);
  const actualXp = newXp - u.xp;                 // clamp so total xp never goes < 0
  const newCoins = Math.max(0, u.coins + coins);
  const actualCoins = newCoins - u.coins;
  q.run('UPDATE users SET xp = ?, coins = ?, aura = aura + ? WHERE id = ?', newXp, newCoins, aura, userId);
  q.run('INSERT INTO events (user_id, kind, xp_delta, aura_delta, coin_delta, note, created_at) VALUES (?,?,?,?,?,?,?)',
    userId, kind, actualXp, aura, actualCoins, note, Date.now());
  return { xp: actualXp, aura, coins: actualCoins };
}

// ============================================================
// STREAKS — recomputed from history (source of truth: checkins)
// A day keeps the streak alive if: yes | rest(valid) | frozen skip | excuse-passed no
// ============================================================
function dayKeepsStreak(c) {
  if (!c) return false;
  if (c.status === 'yes') return true;
  if (c.status === 'rest' && !c.over_quota) return true;
  if (c.frozen) return true;                     // freeze or excuse pass consumed
  return false;
}
export function computeStreak(userId, asOf = todayStr()) {
  const rows = q.all('SELECT date, status, over_quota, frozen FROM checkins WHERE user_id = ? ORDER BY date DESC', userId);
  const map = new Map(rows.map(r => [r.date, r]));
  let streak = 0;
  let day = asOf;
  // today pending (no check-in yet) doesn't break the streak — start counting yesterday
  if (!map.has(day)) day = addDays(day, -1);
  while (true) {
    const c = map.get(day);
    if (!dayKeepsStreak(c)) break;
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}
export function refreshStreak(userId) {
  const streak = computeStreak(userId);
  const u = q.get('SELECT longest_streak FROM users WHERE id = ?', userId);
  const longest = Math.max(u.longest_streak, streak);
  q.run('UPDATE users SET current_streak = ?, longest_streak = ? WHERE id = ?', streak, longest, userId);
  return streak;
}

// ============================================================
// SHAME / FAME
// ============================================================
export function addShame(userId, reason, caption, { shieldable = true } = {}) {
  if (shieldable && invQty(userId, 'shame_shield') > 0) {
    invAdd(userId, 'shame_shield', -1);
    return { shielded: true };
  }
  q.run('INSERT INTO hall (user_id, kind, week, reason, caption, created_at) VALUES (?,?,?,?,?,?)',
    userId, 'shame', isoWeek(todayStr()), reason, caption, Date.now());
  return { shielded: false };
}
export function addFame(userId, reason, caption, week = isoWeek(todayStr())) {
  q.run('INSERT INTO hall (user_id, kind, week, reason, caption, created_at) VALUES (?,?,?,?,?,?)',
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
function milestonesCrossed(prev, next) {
  return MILESTONES.filter(m => prev < m.n && next >= m.n);
}

// ============================================================
// CHECK-IN — the core transaction
// Returns { checkin, refMessages[], fx[], levelUp, milestones[] }
// ============================================================
export function applyCheckin(user, { status, description = '', excuse = '' }) {
  const date = todayStr();
  const existing = q.get('SELECT * FROM checkins WHERE user_id = ? AND date = ?', user.id, date);
  if (existing && !existing.auto) {
    const err = new Error('already checked in today. no take-backs.');
    err.code = 'ALREADY';
    throw err;
  }

  const prevStreak = computeStreak(user.id, addDays(date, -1)) ;
  const prevLevel = levelFor(user.xp).lv;
  const refMessages = [];
  const fx = [];
  const winter = isWinterArc(date);
  const pen = n => winter ? n * 2 : n;   // winter arc: penalties double
  let xp = 0, aura = 0, coins = 0;
  let frozen = 0, overQuota = 0, finalStatus = status;
  let caption = '';

  // If an auto-skip already landed today (e.g. server reconciled at midnight while they slept
  // — shouldn't happen for today, but defensively), replace it.
  if (existing) q.run('DELETE FROM checkins WHERE id = ?', existing.id);

  if (status === 'rest') {
    const week = weekDates(date).filter(d => d <= date);
    const used = q.all(
      `SELECT 1 FROM checkins WHERE user_id = ? AND status = 'rest' AND over_quota = 0 AND date IN (${week.map(() => '?').join(',')})`,
      user.id, ...week).length;
    if (used >= 2) {
      // 3rd+ rest day = a skip with extra steps
      finalStatus = 'skip';
      overQuota = 1;
      xp = -25; aura = pen(-150);
      caption = pick(COPY.restAbuseCaptions);
      const sh = addShame(user.id, 'rest_abuse', caption);
      refMessages.push(sh.shielded
        ? `${user.username}'s shame shield quietly ate something. the squad will never know.`
        : `${user.username} filed a third "rest day" this week. ${caption} ${aura} aura.`);
      fx.push({ kind: 'shame', userId: user.id });
    } else {
      xp = 15; coins = 5;
      refMessages.push(`${user.username} is on a rest day (${used + 1}/2 this week). recovery counts. barely.`);
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
    if (user.double_xp_date === date) { mult *= 2; boosted = true; q.run('UPDATE users SET double_xp_date = NULL WHERE id = ?', user.id); }
    xp = Math.round(base * mult);
    coins = 10; aura = 25;
    fx.push({ kind: 'checkin_yes', userId: user.id });
    if (boosted) refMessages.push(`${user.username} cashed a 2x xp day. +${xp} xp. menace behavior.`);
    // returned from the dead: 3+ consecutive skips immediately before today
    let deadDays = 0;
    for (let d = addDays(date, -1); ; d = addDays(d, -1)) {
      const c = q.get('SELECT status, frozen FROM checkins WHERE user_id = ? AND date = ?', user.id, d);
      if (c && c.status === 'skip' && !c.frozen) deadDays++;
      else break;
    }
    if (deadDays >= 3) refMessages.push(`${user.username} ${COPY.ghostReturn}`);
    // answered callouts: any open callout on this user resolves
    const open = q.all(`SELECT id, caller_id FROM callouts WHERE target_id = ? AND status = 'open'`, user.id);
    for (const c of open) {
      q.run(`UPDATE callouts SET status = 'answered' WHERE id = ?`, c.id);
      const caller = q.get('SELECT username FROM users WHERE id = ?', c.caller_id);
      refMessages.push(`callout answered. ${user.username} posted a workout within the window. ${caller.username} has been notified.`);
    }
  } else if (status === 'no') {
    // honest L — excuse required, streak breaks unless excuse pass held
    if (invQty(user.id, 'excuse_pass') > 0) {
      invAdd(user.id, 'excuse_pass', -1);
      frozen = 1; // marks the day as streak-preserving
      aura = -25;
      refMessages.push(`${user.username} burned an excuse pass. streak lives. aura doesn’t (−25).`);
    } else {
      aura = pen(-50);
      if (prevStreak >= 7) {
        caption = pick(COPY.streakLostCaptions).replace('{n}', prevStreak);
        const sh = addShame(user.id, 'streak_lost', caption);
        if (!sh.shielded) refMessages.push(`${user.username} lost a ${prevStreak}-day streak. ${caption}`);
      }
      refMessages.push(`${user.username} has filed an excuse: "${excuse || 'none. just vibes.'}" — the tribunal is now in session.`);
      // repeated excuse detection. the archive remembers.
      const reps = q.get(
        `SELECT COUNT(*) AS n FROM checkins WHERE user_id = ? AND status = 'no' AND excuse = ? AND date < ?`,
        user.id, excuse.trim(), date).n;
      if (reps >= 2) refMessages.push(`the excuse "${excuse.trim()}" has now been filed ${reps + 1} times. archived under fiction.`);
    }
  } else if (status === 'skip') {
    xp = -25; aura = pen(-150);
    caption = pick(COPY.skipCaptions);
    const sh = addShame(user.id, 'skip', caption);
    refMessages.push(sh.shielded
      ? `${user.username}'s shame shield quietly ate something. the squad will never know.`
      : `${user.username} skipped. ${caption} ${aura} aura.`);
    fx.push({ kind: 'shame', userId: user.id });
  } else {
    const err = new Error('invalid status');
    err.code = 'BAD_STATUS';
    throw err;
  }

  const now = Date.now();
  const ins = q.run(
    `INSERT INTO checkins (user_id, date, status, description, excuse, auto, frozen, over_quota, xp_delta, aura_delta, coin_delta, created_at)
     VALUES (?,?,?,?,?,0,?,?,?,?,?,?)`,
    user.id, date, finalStatus, description.trim(), excuse.trim(), frozen, overQuota, xp, aura, coins, now);

  award(user.id, `checkin_${finalStatus}`, { xp, aura, coins, note: date });
  const newStreak = refreshStreak(user.id);

  // milestones
  const crossed = milestonesCrossed(prevStreak, newStreak);
  for (const m of crossed) {
    award(user.id, 'milestone', { xp: m.xp, aura: m.aura, coins: m.coins, note: `${m.n}-day streak` });
    const line = COPY.milestoneLines[m.n] || `${m.n} days.`;
    refMessages.push(`${user.username}: ${m.n}-day streak. ${line} +${m.xp} xp, +${m.aura} aura.`);
    fx.push({ kind: 'milestone', userId: user.id, n: m.n });
  }

  // level change (up OR down)
  const fresh = q.get('SELECT xp FROM users WHERE id = ?', user.id);
  const newLevel = levelFor(fresh.xp);
  let levelUp = null;
  if (newLevel.lv > prevLevel) {
    levelUp = newLevel;
    refMessages.push(`${user.username} is now lv.${newLevel.lv} "${newLevel.name}". ${pick(COPY.levelUpLines)}`);
    fx.push({ kind: 'levelup', userId: user.id, level: newLevel.lv });
  } else if (newLevel.lv < prevLevel) {
    refMessages.push(`${user.username} de-evolved to lv.${newLevel.lv} "${newLevel.name}". the chuzz version is winning.`);
    fx.push({ kind: 'shame', userId: user.id });
  }

  const checkin = q.get('SELECT * FROM checkins WHERE id = ?', ins.lastInsertRowid);
  return { checkin, refMessages, fx, levelUp, milestones: crossed.map(m => m.n), streak: newStreak };
}

// ============================================================
// RECONCILE — backfill auto-skips for ghosted days, weekly fame awards
// Returns refMessages[] to broadcast
// ============================================================
export function reconcile() {
  const today = todayStr();
  const refMessages = [];
  const users = q.all('SELECT * FROM users');

  // winter arc begins: announce once
  if (isWinterArc(today) && getMeta('winter_arc_announced') !== '1') {
    setMeta('winter_arc_announced', '1');
    refMessages.push(`the winter arc has begun. ${daysUntilGoal(today)} days to dec 20. aura penalties are doubled. nobody is safe.`);
  }

  for (const u of users) {
    const have = new Set(q.all('SELECT date FROM checkins WHERE user_id = ?', u.id).map(r => r.date));
    const missing = [];
    for (let d = u.joined_date; d < today; d = addDays(d, 1)) {
      if (!have.has(d)) missing.push(d);
    }
    if (!missing.length) continue;

    let frozeCount = 0, skipCount = 0, totalAura = 0;
    for (const d of missing) {
      if (invQty(u.id, 'streak_freeze') > 0) {
        invAdd(u.id, 'streak_freeze', -1);
        q.run(`INSERT INTO checkins (user_id, date, status, auto, frozen, created_at) VALUES (?,?,'skip',1,1,?)`, u.id, d, Date.now());
        frozeCount++;
      } else {
        const aura = isWinterArc(d) ? -300 : -150;
        q.run(`INSERT INTO checkins (user_id, date, status, auto, xp_delta, aura_delta, created_at) VALUES (?,?,'skip',1,-25,?,?)`, u.id, d, aura, Date.now());
        award(u.id, 'auto_skip', { xp: -25, aura, note: d });
        const caption = pick(COPY.autoSkipCaptions);
        addShame(u.id, 'skip', caption);
        skipCount++; totalAura += aura;
      }
    }
    refreshStreak(u.id);
    if (frozeCount) refMessages.push(`${u.username}'s streak freeze auto-activated. streak survives. that was insurance, not absolution.`);
    if (skipCount === 1) refMessages.push(`${u.username} ghosted yesterday. didn’t even say no. auto-skip filed. ${totalAura} aura.`);
    else if (skipCount > 1) refMessages.push(`day ${skipCount} of no activity from ${u.username}. ${totalAura} aura. the ledger remembers everything.`);
  }

  // expire 48h-old open callouts: target never answered
  const expired = q.all(
    `SELECT c.id, c.caller_id, c.target_id FROM callouts c WHERE c.status = 'open' AND c.created_at < ?`,
    Date.now() - 48 * 3600 * 1000);
  for (const c of expired) {
    q.run(`UPDATE callouts SET status = 'expired' WHERE id = ?`, c.id);
    const target = q.get('SELECT username FROM users WHERE id = ?', c.target_id);
    const caller = q.get('SELECT username FROM users WHERE id = ?', c.caller_id);
    award(c.target_id, 'callout_expired', { aura: -100, note: `called out by ${caller.username}` });
    refMessages.push(`callout expired. ${target.username} was formally questioned by ${caller.username} and produced nothing in 48 hours. −100 aura.`);
  }

  // weekly fame: award once per completed week
  const lastWeekDate = addDays(today, -7);
  const prevWeek = isoWeek(lastWeekDate);
  const awarded = getMeta('fame_awarded_week', '');
  if (awarded !== prevWeek && users.length > 0) {
    const dates = weekDates(lastWeekDate);
    const placeholders = dates.map(() => '?').join(',');
    // top XP of that week
    const xpRows = q.all(
      `SELECT user_id, SUM(xp_delta) AS wxp FROM checkins WHERE date IN (${placeholders}) GROUP BY user_id ORDER BY wxp DESC`, ...dates);
    if (xpRows.length && xpRows[0].wxp > 0) {
      const top = users.find(x => x.id === xpRows[0].user_id);
      addFame(top.id, 'top_xp', COPY.fameTopXp, prevWeek);
      refMessages.push(`weekly report: ${top.username} topped the board with ${xpRows[0].wxp} xp. ${COPY.fameTopXp}`);
    }
    // perfect weeks (7/7 days yes or valid rest)
    for (const u of users) {
      if (u.joined_date > dates[0]) continue;
      const good = q.all(
        `SELECT 1 FROM checkins WHERE user_id = ? AND date IN (${placeholders}) AND (status = 'yes' OR (status = 'rest' AND over_quota = 0))`,
        u.id, ...dates).length;
      if (good === 7) {
        addFame(u.id, 'perfect_week', COPY.famePerfectWeek, prevWeek);
        refMessages.push(`${u.username} logged a perfect week. enshrined. ${COPY.famePerfectWeek}`);
      }
    }
    setMeta('fame_awarded_week', prevWeek);
  }

  return refMessages;
}

// ============================================================
// SHOP TRANSACTIONS
// ============================================================
export function buyItem(user, itemId) {
  const item = SHOP_ITEMS.find(i => i.id === itemId);
  if (!item) { const e = new Error('no such item'); e.code = 'BAD_ITEM'; throw e; }
  const u = q.get('SELECT * FROM users WHERE id = ?', user.id);
  if (u.coins < item.price) { const e = new Error('not enough coins. go earn some.'); e.code = 'BROKE'; throw e; }
  if (item.maxHold > 0 && invQty(u.id, item.id) >= item.maxHold) {
    const e = new Error(`you can only hold ${item.maxHold}. greed is a sin.`); e.code = 'MAX_HOLD'; throw e;
  }

  let refMessage = null;
  if (item.id === 'aura_juice') {
    award(u.id, 'purchase', { coins: -item.price, aura: 100, note: 'aura transfusion' });
    refMessage = `${u.username} purchased aura. +100. money can’t buy gains but apparently it buys aura.`;
  } else if (item.id === 'double_xp') {
    const date = todayStr();
    const doneToday = q.get(`SELECT 1 FROM checkins WHERE user_id = ? AND date = ? AND status = 'yes'`, u.id, date);
    const applyDate = doneToday ? addDays(date, 1) : date;
    q.run('UPDATE users SET double_xp_date = ? WHERE id = ?', applyDate, u.id);
    award(u.id, 'purchase', { coins: -item.price, note: `2x xp for ${applyDate}` });
    refMessage = `${u.username} activated a 2x xp day for ${applyDate === date ? 'today' : 'tomorrow'}. let him cook.`;
  } else {
    invAdd(u.id, item.id, 1);
    award(u.id, 'purchase', { coins: -item.price, note: item.id });
  }
  return { item, refMessage };
}
