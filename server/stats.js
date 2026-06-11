// stats.js — accountability stats. not gym stats. receipts.
import { q } from './db.js';
import { todayStr, addDays, weekDates, levelFor, daysUntilGoal, isWinterArc } from './game.js';

function fmtTime(ms) {
  const d = new Date(ms);
  let h = d.getHours(); const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function userStats(userId) {
  const u = q.get('SELECT * FROM users WHERE id = ?', userId);
  if (!u) return null;
  const today = todayStr();
  const checkins = q.all('SELECT * FROM checkins WHERE user_id = ? ORDER BY date ASC', userId);
  const deliberate = checkins.filter(c => !c.auto);

  const counts = { yes: 0, no: 0, rest: 0, skip: 0 };
  for (const c of checkins) counts[c.status]++;

  // days since joining (inclusive of today)
  let daysIn = 0;
  for (let d = u.joined_date; d <= today; d = addDays(d, 1)) daysIn++;

  const yesRate = daysIn ? Math.round((counts.yes / daysIn) * 100) : 0;
  const showUpRate = daysIn ? Math.round((deliberate.length / daysIn) * 100) : 0; // answered at all

  // check-in clock habits (deliberate only)
  const times = deliberate.map(c => c.created_at);
  let avgTime = null, earliest = null, latest = null;
  if (times.length) {
    const mins = times.map(t => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); });
    const avg = Math.round(mins.reduce((a, b) => a + b, 0) / mins.length);
    const base = new Date(); base.setHours(Math.floor(avg / 60), avg % 60, 0, 0);
    avgTime = fmtTime(base.getTime());
    earliest = fmtTime(times[mins.indexOf(Math.min(...mins))]);
    latest = fmtTime(times[mins.indexOf(Math.max(...mins))]);
  }

  // weekday patterns
  const byDay = Array.from({ length: 7 }, () => ({ yes: 0, bad: 0, total: 0 }));
  for (const c of checkins) {
    const [y, m, d] = c.date.split('-').map(Number);
    const wd = new Date(y, m - 1, d).getDay();
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

  // excuses
  const excuses = q.all(
    `SELECT excuse, COUNT(*) AS n FROM checkins WHERE user_id = ? AND status = 'no' AND excuse != '' GROUP BY excuse ORDER BY n DESC`, userId);
  const capped = q.get(`SELECT COUNT(*) AS n FROM checkins WHERE user_id = ? AND excuse_capped = 1`, userId).n;

  // hall record
  const shame = q.get(`SELECT COUNT(*) AS n FROM hall WHERE user_id = ? AND kind = 'shame'`, userId).n;
  const fame = q.get(`SELECT COUNT(*) AS n FROM hall WHERE user_id = ? AND kind = 'fame'`, userId).n;

  // wagers
  const wagerRow = q.get(
    `SELECT
       SUM(CASE WHEN w.status='settled' AND wm.is_loser=0 THEN 1 ELSE 0 END) AS wins,
       SUM(CASE WHEN w.status='settled' AND wm.is_loser=1 THEN 1 ELSE 0 END) AS losses,
       SUM(CASE WHEN wm.is_loser=1 AND wm.paid=0 THEN 1 ELSE 0 END) AS unpaid
     FROM wager_members wm JOIN wagers w ON w.id = wm.wager_id WHERE wm.user_id = ?`, userId);

  // chat presence
  const msgCount = q.get(`SELECT COUNT(*) AS n FROM messages WHERE user_id = ? AND type = 'user'`, userId).n;
  const favReaction = q.get(
    `SELECT emoji, COUNT(*) AS n FROM reactions WHERE user_id = ? GROUP BY emoji ORDER BY n DESC LIMIT 1`, userId);
  const reactionsReceived = q.get(
    `SELECT COUNT(*) AS n FROM reactions r JOIN messages m ON m.id = r.message_id WHERE m.user_id = ?`, userId).n;

  // first-to-check-in days ("day shift soldier")
  const firstYes = q.get(
    `SELECT COUNT(*) AS n FROM (
       SELECT date, user_id, MIN(created_at) FROM checkins WHERE status = 'yes' AND auto = 0 GROUP BY date
     ) WHERE user_id = ?`, userId).n;

  // this week
  const wk = weekDates(today);
  const wkPh = wk.map(() => '?').join(',');
  const weekRows = q.all(`SELECT * FROM checkins WHERE user_id = ? AND date IN (${wkPh})`, userId, ...wk);
  const weekXp = weekRows.reduce((a, c) => a + c.xp_delta, 0);
  const restUsed = weekRows.filter(c => c.status === 'rest' && !c.over_quota).length;
  const weekMap = {};
  for (const c of weekRows) weekMap[c.date] = c.status + (c.frozen ? ':frozen' : '') + (c.over_quota ? ':abuse' : '');

  // xp / aura time series (last 30 days, cumulative)
  const events = q.all('SELECT xp_delta, aura_delta, created_at FROM events WHERE user_id = ? ORDER BY created_at ASC', userId);
  const series = [];
  {
    let cx = 0, ca = 100; // aura starts at 100
    const byDate = new Map();
    for (const e of events) {
      cx += e.xp_delta; ca += e.aura_delta;
      byDate.set(todayStr(new Date(e.created_at)), { xp: cx, aura: ca });
    }
    let lx = 0, la = 100;
    for (let i = 29; i >= 0; i--) {
      const d = addDays(today, -i);
      if (byDate.has(d)) { lx = byDate.get(d).xp; la = byDate.get(d).aura; }
      else if (d < u.joined_date) { series.push(null); continue; }
      series.push({ date: d, xp: lx, aura: la });
    }
  }

  // full calendar for heatmap
  const calendar = {};
  for (const c of checkins) calendar[c.date] = { status: c.status, frozen: !!c.frozen, over_quota: !!c.over_quota, auto: !!c.auto };

  // recent ledger entries — the aura bank statement. precision is the comedy.
  const recent = q.all(
    'SELECT kind, xp_delta, aura_delta, coin_delta, note, created_at FROM events WHERE user_id = ? ORDER BY id DESC LIMIT 14', userId);

  return {
    user: { id: u.id, username: u.username, xp: u.xp, coins: u.coins, aura: u.aura, joined: u.joined_date },
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
    series: series.filter(Boolean),
    calendar,
    recent,
  };
}

export function squadSnapshot() {
  const today = todayStr();
  const users = q.all('SELECT * FROM users ORDER BY xp DESC');
  const wk = weekDates(today);
  const wkPh = wk.map(() => '?').join(',');

  const members = users.map(u => {
    const todayCheckin = q.get('SELECT status, frozen, over_quota, auto FROM checkins WHERE user_id = ? AND date = ?', u.id, today);
    const weekXp = q.get(`SELECT COALESCE(SUM(xp_delta),0) AS s FROM checkins WHERE user_id = ? AND date IN (${wkPh})`, u.id, ...wk).s;
    return {
      id: u.id, username: u.username, xp: u.xp, coins: u.coins, aura: u.aura,
      level: levelFor(u.xp),
      streak: u.current_streak, longest: u.longest_streak,
      today: todayCheckin || null,
      weekXp,
      online: Date.now() - u.last_seen < 70000,
    };
  });

  // squad meter: this week, % of (yes | valid rest) over elapsed member-days
  let good = 0, elapsed = 0;
  const elapsedDates = wk.filter(d => d <= today);
  for (const u of users) {
    for (const d of elapsedDates) {
      if (d < u.joined_date) continue;
      elapsed++;
      const c = q.get('SELECT status, over_quota FROM checkins WHERE user_id = ? AND date = ?', u.id, d);
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

  // squad records
  const records = {
    longestStreakEver: q.get('SELECT username, longest_streak AS v FROM users ORDER BY longest_streak DESC LIMIT 1'),
    mostAura: q.get('SELECT username, aura AS v FROM users ORDER BY aura DESC LIMIT 1'),
    totalWorkouts: q.get(`SELECT COUNT(*) AS v FROM checkins WHERE status = 'yes'`).v,
    totalSkips: q.get(`SELECT COUNT(*) AS v FROM checkins WHERE status = 'skip' AND frozen = 0`).v,
    biggestWeek: q.get(
      `SELECT u.username, SUM(c.xp_delta) AS v FROM checkins c JOIN users u ON u.id = c.user_id
       GROUP BY c.user_id, (SELECT 1) HAVING v > 0 ORDER BY v DESC LIMIT 1`) || null,
  };

  // pace projection: squad-wide yes-rate since inception → "% ripped by dec 20"
  let yesTotal = 0, memberDays = 0;
  for (const u of users) {
    let d = 0;
    for (let x = u.joined_date; x <= today; x = addDays(x, 1)) d++;
    memberDays += d;
    yesTotal += q.get(`SELECT COUNT(*) AS n FROM checkins WHERE user_id = ? AND status = 'yes'`, u.id).n;
  }
  const pacePct = memberDays ? Math.round((yesTotal / memberDays) * 100) : 0;
  const pace = users.length
    ? `at current pace the squad will be ${pacePct}% ripped by dec 20. the remaining ${100 - pacePct}% is between you and god.`
    : null;

  return {
    members, meter: { pct, ...mood }, daysLeft: daysUntilGoal(), goal: '2026-12-20', records,
    pace, pacePct, winterArc: isWinterArc(today),
  };
}

export function leaderboard(period = 'week') {
  const today = todayStr();
  const users = q.all('SELECT * FROM users');
  let rows;
  if (period === 'week') {
    const wk = weekDates(today);
    const wkPh = wk.map(() => '?').join(',');
    rows = users.map(u => ({
      id: u.id, username: u.username, aura: u.aura, streak: u.current_streak, level: levelFor(u.xp),
      score: q.get(`SELECT COALESCE(SUM(xp_delta),0) AS s FROM checkins WHERE user_id = ? AND date IN (${wkPh})`, u.id, ...wk).s,
      totalXp: u.xp,
    }));
  } else {
    rows = users.map(u => ({
      id: u.id, username: u.username, aura: u.aura, streak: u.current_streak, level: levelFor(u.xp),
      score: u.xp, totalXp: u.xp,
    }));
  }
  rows.sort((a, b) => b.score - a.score || b.totalXp - a.totalXp);
  return rows;
}
