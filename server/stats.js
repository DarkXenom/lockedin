// stats.js — accountability stats + monthly wrapped. receipts, not gym stats.
import { q, getMeta, setMeta } from './db.js';
import {
  localDate, localHM, addDays, weekDates, levelFor, daysUntilGoal, isWinterArc, validTz, isoWeek,
} from './game.js';

function fmtTime(ms, tz) {
  const d = new Date(ms);
  const s = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
  return s.toLowerCase().replace(/\s/g, ' ');
}
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function dowOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export async function userStats(userId) {
  const u = await q.get('SELECT * FROM users WHERE id = ?', userId);
  if (!u) return null;
  const tz = validTz(u.tz);
  const today = localDate(tz);
  const checkins = await q.all('SELECT * FROM checkins WHERE user_id = ? ORDER BY date ASC', userId);
  const deliberate = checkins.filter(c => !c.auto);

  const counts = { yes: 0, no: 0, rest: 0, skip: 0 };
  for (const c of checkins) counts[c.status]++;

  let daysIn = 0;
  for (let d = u.joined_date; d <= today; d = addDays(d, 1)) daysIn++;

  const yesRate = daysIn ? Math.round((counts.yes / daysIn) * 100) : 0;
  const showUpRate = daysIn ? Math.round((deliberate.length / daysIn) * 100) : 0;

  // clock habits in the user's own timezone
  const times = deliberate.map(c => c.created_at);
  let avgTime = null, earliest = null, latest = null;
  if (times.length) {
    const mins = times.map(t => {
      const [h, m] = localHM(tz, new Date(t)).split(':').map(Number);
      return h * 60 + m;
    });
    const avg = Math.round(mins.reduce((a, b) => a + b, 0) / mins.length);
    const h12 = (Math.floor(avg / 60) % 12) || 12;
    const ap = avg >= 720 ? 'pm' : 'am';
    avgTime = `${h12}:${String(avg % 60).padStart(2, '0')} ${ap}`;
    earliest = fmtTime(times[mins.indexOf(Math.min(...mins))], tz);
    latest = fmtTime(times[mins.indexOf(Math.max(...mins))], tz);
  }

  // weekday patterns
  const byDay = Array.from({ length: 7 }, () => ({ yes: 0, bad: 0, total: 0 }));
  for (const c of checkins) {
    const wd = dowOf(c.date);
    byDay[wd].total++;
    if (c.status === 'yes') byDay[wd].yes++;
    if (c.status === 'skip' || c.status === 'no') byDay[wd].bad++;
  }
  let bestDay = null, worstDay = null, bestRate = -1, worstRate = -1;
  byDay.forEach((s, i) => {
    if (s.total < 2) return;
    const yr = s.yes / s.total, br = s.bad / s.total;
    if (yr > bestRate) { bestRate = yr; bestDay = WEEKDAYS[i]; }
    if (br > worstRate && s.bad > 0) { worstRate = br; worstDay = WEEKDAYS[i]; }
  });

  const excuses = await q.all(
    `SELECT excuse, COUNT(*) AS n FROM checkins WHERE user_id = ? AND status = 'no' AND excuse != '' GROUP BY excuse ORDER BY n DESC`, userId);
  const capped = (await q.get(`SELECT COUNT(*) AS n FROM checkins WHERE user_id = ? AND excuse_capped = 1`, userId)).n;

  const shame = (await q.get(`SELECT COUNT(*) AS n FROM hall WHERE user_id = ? AND kind = 'shame'`, userId)).n;
  const fame = (await q.get(`SELECT COUNT(*) AS n FROM hall WHERE user_id = ? AND kind = 'fame'`, userId)).n;

  const wagerRow = await q.get(
    `SELECT
       SUM(CASE WHEN w.status='settled' AND wm.is_loser=0 THEN 1 ELSE 0 END) AS wins,
       SUM(CASE WHEN w.status='settled' AND wm.is_loser=1 THEN 1 ELSE 0 END) AS losses,
       SUM(CASE WHEN wm.is_loser=1 AND wm.paid=0 THEN 1 ELSE 0 END) AS unpaid
     FROM wager_members wm JOIN wagers w ON w.id = wm.wager_id WHERE wm.user_id = ?`, userId);

  const msgCount = (await q.get(`SELECT COUNT(*) AS n FROM messages WHERE user_id = ? AND type = 'user'`, userId)).n;
  const favReaction = await q.get(
    `SELECT emoji, COUNT(*) AS n FROM reactions WHERE user_id = ? GROUP BY emoji ORDER BY n DESC LIMIT 1`, userId);
  const reactionsReceived = (await q.get(
    `SELECT COUNT(*) AS n FROM reactions r JOIN messages m ON m.id = r.message_id WHERE m.user_id = ?`, userId)).n;

  const firstYes = (await q.get(
    `SELECT COUNT(*) AS n FROM (
       SELECT date, user_id, MIN(created_at) FROM checkins WHERE status = 'yes' AND auto = 0 GROUP BY date
     ) WHERE user_id = ?`, userId)).n;

  // this (local) week
  const wk = weekDates(today);
  const wkPh = wk.map(() => '?').join(',');
  const weekRows = await q.all(`SELECT * FROM checkins WHERE user_id = ? AND date IN (${wkPh})`, userId, ...wk);
  const weekXp = weekRows.reduce((a, c) => a + c.xp_delta, 0);
  const restUsed = weekRows.filter(c => c.status === 'rest' && !c.over_quota).length;
  const weekMap = {};
  for (const c of weekRows) weekMap[c.date] = c.status + (c.frozen ? ':frozen' : '') + (c.over_quota ? ':abuse' : '');

  // xp/aura series (last 30 local days)
  const events = await q.all('SELECT xp_delta, aura_delta, created_at FROM events WHERE user_id = ? ORDER BY created_at ASC', userId);
  const series = [];
  {
    let cx = 0, ca = 100;
    const byDate = new Map();
    for (const e of events) {
      cx += e.xp_delta; ca += e.aura_delta;
      byDate.set(localDate(tz, new Date(e.created_at)), { xp: cx, aura: ca });
    }
    let lx = 0, la = 100;
    for (let i = 29; i >= 0; i--) {
      const d = addDays(today, -i);
      if (byDate.has(d)) { lx = byDate.get(d).xp; la = byDate.get(d).aura; }
      else if (d < u.joined_date) continue;
      series.push({ date: d, xp: lx, aura: la });
    }
  }

  const calendar = {};
  for (const c of checkins) calendar[c.date] = { status: c.status, frozen: !!c.frozen, over_quota: !!c.over_quota, auto: !!c.auto };

  const recent = await q.all(
    'SELECT kind, xp_delta, aura_delta, coin_delta, note, created_at FROM events WHERE user_id = ? ORDER BY id DESC LIMIT 14', userId);

  const pot = await q.get(
    `SELECT COALESCE(SUM(amount),0) AS total, COALESCE(SUM(CASE WHEN settled=0 THEN amount ELSE 0 END),0) AS owed FROM pot_entries WHERE user_id = ?`, userId);

  const lastWrapped = await q.get('SELECT month, data FROM wrapped WHERE user_id = ? ORDER BY month DESC LIMIT 1', userId);

  return {
    user: {
      id: u.id, username: u.username, xp: u.xp, coins: u.coins, aura: u.aura,
      joined: u.joined_date, tz,
      hasBefore: !!u.photo_before, hasAfter: !!u.photo_after,
    },
    level: levelFor(u.xp),
    streak: { current: u.current_streak, longest: u.longest_streak },
    counts, daysIn, yesRate, showUpRate,
    clock: { avgTime, earliest, latest },
    weekdays: { best: bestDay, worst: worstDay },
    excuses: { top: excuses.slice(0, 3), total: counts.no, capped },
    hall: { shame, fame },
    wagers: { wins: wagerRow.wins || 0, losses: wagerRow.losses || 0, unpaid: wagerRow.unpaid || 0 },
    chat: { messages: msgCount, favReaction: favReaction ? favReaction.emoji : null, reactionsReceived },
    firstYes,
    week: { xp: weekXp, restUsed, map: weekMap, dates: wk },
    series,
    calendar,
    recent,
    pot: { contributed: pot.total, owed: pot.owed },
    wrapped: lastWrapped ? { month: lastWrapped.month, ...JSON.parse(lastWrapped.data) } : null,
  };
}

export async function squadSnapshot() {
  const users = await q.all('SELECT * FROM users ORDER BY xp DESC');

  const members = [];
  for (const u of users) {
    const tz = validTz(u.tz);
    const today = localDate(tz);
    const wk = weekDates(today);
    const wkPh = wk.map(() => '?').join(',');
    const todayCheckin = await q.get('SELECT status, frozen, over_quota, auto FROM checkins WHERE user_id = ? AND date = ?', u.id, today);
    const weekXp = (await q.get(`SELECT COALESCE(SUM(xp_delta),0) AS s FROM checkins WHERE user_id = ? AND date IN (${wkPh})`, u.id, ...wk)).s;
    members.push({
      id: u.id, username: u.username, xp: u.xp, coins: u.coins, aura: u.aura,
      level: levelFor(u.xp),
      streak: u.current_streak, longest: u.longest_streak,
      today: todayCheckin || null,
      localToday: today,
      localTime: localHM(tz),
      weekXp,
      online: Date.now() - u.last_seen < 70000,
      hasBefore: !!u.photo_before, hasAfter: !!u.photo_after,
    });
  }

  // squad meter — each member judged against their own local week
  let good = 0, elapsed = 0;
  for (const u of users) {
    const tz = validTz(u.tz);
    const today = localDate(tz);
    for (const d of weekDates(today).filter(d => d <= today)) {
      if (d < u.joined_date) continue;
      elapsed++;
      const c = await q.get('SELECT status, over_quota FROM checkins WHERE user_id = ? AND date = ?', u.id, d);
      if (c && (c.status === 'yes' || (c.status === 'rest' && !c.over_quota))) good++;
    }
  }
  const pct = elapsed ? Math.round((good / elapsed) * 100) : 0;
  let mood;
  if (!users.length) mood = { key: 'empty', label: 'no squad yet', sub: 'recruit the bois' };
  else if (pct >= 80) mood = { key: 'locked', label: 'LOCKED IN', sub: 'the squad is him' };
  else if (pct >= 60) mood = { key: 'back', label: "WE'RE SO BACK", sub: 'momentum detected' };
  else if (pct >= 40) mood = { key: 'mid', label: 'MID', sub: 'this is a warning' };
  else mood = { key: 'cooked', label: 'COOKED', sub: 'unsalvageable. almost.' };

  const records = {
    longestStreakEver: await q.get('SELECT username, longest_streak AS v FROM users ORDER BY longest_streak DESC LIMIT 1'),
    mostAura: await q.get('SELECT username, aura AS v FROM users ORDER BY aura DESC LIMIT 1'),
    totalWorkouts: (await q.get(`SELECT COUNT(*) AS v FROM checkins WHERE status = 'yes'`)).v,
    totalSkips: (await q.get(`SELECT COUNT(*) AS v FROM checkins WHERE status = 'skip' AND frozen = 0`)).v,
  };

  // pace projection
  let yesTotal = 0, memberDays = 0;
  for (const u of users) {
    const today = localDate(validTz(u.tz));
    let d = 0;
    for (let x = u.joined_date; x <= today; x = addDays(x, 1)) d++;
    memberDays += d;
    yesTotal += (await q.get(`SELECT COUNT(*) AS n FROM checkins WHERE user_id = ? AND status = 'yes'`, u.id)).n;
  }
  const pacePct = memberDays ? Math.round((yesTotal / memberDays) * 100) : 0;
  const pace = users.length
    ? `at current pace the squad will be ${pacePct}% ripped by dec 20. the remaining ${100 - pacePct}% is between you and god.`
    : null;

  const minToday = users.length ? users.map(u => localDate(validTz(u.tz))).sort()[0] : localDate('UTC');
  const potTotals = await q.get(
    `SELECT COALESCE(SUM(amount),0) AS total, COALESCE(SUM(CASE WHEN settled=0 THEN amount ELSE 0 END),0) AS owed FROM pot_entries`);

  return {
    members, meter: { pct, ...mood }, daysLeft: daysUntilGoal(minToday), goal: GOAL(), records,
    pace, pacePct, winterArc: isWinterArc(minToday),
    pot: { total: potTotals.total, owed: potTotals.owed },
  };
}
const GOAL = () => '2026-12-20';

export async function leaderboard(period = 'week') {
  const users = await q.all('SELECT * FROM users');
  const rows = [];
  for (const u of users) {
    let score;
    if (period === 'week') {
      const wk = weekDates(localDate(validTz(u.tz)));
      const wkPh = wk.map(() => '?').join(',');
      score = (await q.get(`SELECT COALESCE(SUM(xp_delta),0) AS s FROM checkins WHERE user_id = ? AND date IN (${wkPh})`, u.id, ...wk)).s;
    } else {
      score = u.xp;
    }
    rows.push({
      id: u.id, username: u.username, aura: u.aura, streak: u.current_streak,
      level: levelFor(u.xp), score, totalXp: u.xp,
    });
  }
  rows.sort((a, b) => b.score - a.score || b.totalXp - a.totalXp);
  return rows;
}

// ============================================================
// MONTHLY WRAPPED — generated when the slowest timezone finishes
// the month. everyone gets a unique superlative. by design.
// ============================================================
const SUPERLATIVES = [
  { id: 'carry',   title: 'the carry',          line: 'most xp this month. everyone else is cargo.' },
  { id: 'locked',  title: 'most locked in',     line: 'longest streak of the month. boringly reliable.' },
  { id: 'dawn',    title: 'day-shift soldier',  line: 'earliest average check-in. the sun rises with him.' },
  { id: 'night',   title: 'graveyard shift',    line: 'latest average check-in. the gym at 11pm is a personality.' },
  { id: 'yapper',  title: 'the yapper',         line: 'most messages sent. cardio for the thumbs.' },
  { id: 'judge',   title: 'tribunal judge',     line: 'most excuse votes cast. justice never rests.' },
  { id: 'honest',  title: 'most honest',        line: 'most nos filed. at least he tells us.' },
  { id: 'farmer',  title: 'aura farmer',        line: 'biggest aura gain this month. suspicious. noted.' },
  { id: 'present', title: 'certified present',  line: 'showed up. statistically. a certificate exists now.' },
];

export async function generateWrapped() {
  const refMessages = [];
  const pushes = [];
  const users = await q.all('SELECT * FROM users');
  if (!users.length) return { refMessages, pushes };

  const minToday = users.map(u => localDate(validTz(u.tz))).sort()[0];
  const curMonth = minToday.slice(0, 7);
  const targetMonth = addDays(curMonth + '-01', -1).slice(0, 7); // previous month
  const done = await getMeta('wrapped_done_month', '');
  if (done >= targetMonth) return { refMessages, pushes };

  const monthStart = targetMonth + '-01';
  const monthEnd = addDays(curMonth + '-01', -1);
  const eligible = users.filter(u => u.joined_date <= monthEnd);
  if (!eligible.length) { await setMeta('wrapped_done_month', targetMonth); return { refMessages, pushes }; }

  // per-user month stats
  const statsByUser = new Map();
  for (const u of eligible) {
    const tz = validTz(u.tz);
    const rows = await q.all('SELECT * FROM checkins WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date ASC', u.id, monthStart, monthEnd);
    const counts = { yes: 0, no: 0, rest: 0, skip: 0 };
    let bestStreak = 0, run = 0;
    for (const c of rows) {
      counts[c.status]++;
      if (c.status === 'yes') { run++; bestStreak = Math.max(bestStreak, run); }
      else if ((c.status === 'rest' && !c.over_quota) || c.frozen) { /* pause */ }
      else run = 0;
    }
    const xpGained = rows.reduce((a, c) => a + c.xp_delta, 0);
    const monthStartMs = new Date(monthStart + 'T00:00:00Z').getTime() - 14 * 3600000;
    const monthEndMs = new Date(monthEnd + 'T23:59:59Z').getTime() + 14 * 3600000;
    const auraDelta = (await q.get(
      'SELECT COALESCE(SUM(aura_delta),0) AS s FROM events WHERE user_id = ? AND created_at BETWEEN ? AND ?', u.id, monthStartMs, monthEndMs)).s;
    const msgs = (await q.get(
      `SELECT COUNT(*) AS n FROM messages WHERE user_id = ? AND type = 'user' AND created_at BETWEEN ? AND ?`, u.id, monthStartMs, monthEndMs)).n;
    const votes = (await q.get(
      `SELECT COUNT(*) AS n FROM excuse_votes ev JOIN checkins c ON c.id = ev.checkin_id WHERE ev.voter_id = ? AND c.date >= ? AND c.date <= ?`,
      u.id, monthStart, monthEnd)).n;
    const deliberate = rows.filter(c => !c.auto);
    let avgMin = null;
    if (deliberate.length) {
      const mins = deliberate.map(c => { const [h, m] = localHM(tz, new Date(c.created_at)).split(':').map(Number); return h * 60 + m; });
      avgMin = Math.round(mins.reduce((a, b) => a + b, 0) / mins.length);
    }
    const byDay = {};
    for (const c of rows) if (c.status === 'yes') { const w = WEEKDAYS[dowOf(c.date)]; byDay[w] = (byDay[w] || 0) + 1; }
    const busiestDay = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];
    statsByUser.set(u.id, { counts, bestStreak, xpGained, auraDelta, msgs, votes, avgMin, busiestDay: busiestDay ? busiestDay[0] : null });
  }

  // unique superlative assignment — greedy by category priority
  const scoreFns = {
    carry: s => s.xpGained,
    locked: s => s.bestStreak,
    dawn: s => s.avgMin == null ? -1 : 1440 - s.avgMin,
    night: s => s.avgMin == null ? -1 : s.avgMin,
    yapper: s => s.msgs,
    judge: s => s.votes,
    honest: s => s.counts.no,
    farmer: s => s.auraDelta,
  };
  const assigned = new Map(); // userId -> superlative
  for (const sup of SUPERLATIVES) {
    if (assigned.size >= eligible.length) break;
    if (sup.id === 'present') continue;
    const candidates = eligible
      .filter(u => !assigned.has(u.id))
      .map(u => ({ u, score: scoreFns[sup.id](statsByUser.get(u.id)) }))
      .filter(c => c.score > 0)
      .sort((a, b) => b.score - a.score);
    if (candidates.length) assigned.set(candidates[0].u.id, sup);
  }
  const fallback = SUPERLATIVES.find(s => s.id === 'present');
  for (const u of eligible) if (!assigned.has(u.id)) assigned.set(u.id, fallback);

  // monthLabel like "may 2026"
  const [yy, mm] = targetMonth.split('-').map(Number);
  const monthLabel = new Date(Date.UTC(yy, mm - 1, 15)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).toLowerCase();

  for (const u of eligible) {
    const s = statsByUser.get(u.id);
    const sup = assigned.get(u.id);
    const data = {
      monthLabel,
      sessions: s.counts.yes, rests: s.counts.rest, nos: s.counts.no, skips: s.counts.skip,
      xpGained: s.xpGained, auraDelta: s.auraDelta, bestStreak: s.bestStreak,
      busiestDay: s.busiestDay, messages: s.msgs,
      superlative: { title: sup.title, line: sup.line },
    };
    await q.run('INSERT OR IGNORE INTO wrapped (user_id, month, data, created_at) VALUES (?,?,?,?)',
      u.id, targetMonth, JSON.stringify(data), Date.now());
    refMessages.push({ wrapped: true, userId: u.id, username: u.username, data });
    pushes.push({ userId: u.id, body: `your ${monthLabel} wrapped is in. superlative: ${sup.title}. see the receipts.` });
  }
  await setMeta('wrapped_done_month', targetMonth);
  return { refMessages, pushes };
}
