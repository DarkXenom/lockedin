// simulate.mjs — faithful economy simulation over the june15->dec20 pact.
// mirrors game.js applyCheckin/milestone/winter-arc math exactly so we can
// calibrate the level curve against real low/moderate/high consistency.
// usage: node tools/simulate.mjs

const PACT_START = '2026-06-15';
const GOAL = '2026-12-20';

// ---- candidate level curve (edit here, re-run) ----
const LEVELS = [
  { lv: 1,  xp: 0,     name: 'unpaid intern of gravity' },
  { lv: 2,  xp: 200,   name: 'tourist, gym district' },
  { lv: 3,  xp: 600,   name: 'junior bench associate' },
  { lv: 4,  xp: 1300,  name: 'card-carrying regular' },
  { lv: 5,  xp: 2500,  name: 'certified locked in' },
  { lv: 6,  xp: 4400,  name: 'licensed local menace' },
  { lv: 7,  xp: 7000,  name: 'registered public problem' },
  { lv: 8,  xp: 10500, name: 'director of overload' },
  { lv: 9,  xp: 15000, name: 'load-bearing member' },
  { lv: 10, xp: 20000, name: 'HIM' },
];
const levelFor = xp => { let c = LEVELS[0]; for (const l of LEVELS) if (xp >= l.xp) c = l; return c; };

const MILESTONES = [
  { n: 3, xp: 30, aura: 50, coins: 20 },
  { n: 7, xp: 70, aura: 100, coins: 40 },
  { n: 14, xp: 150, aura: 200, coins: 80 },
  { n: 30, xp: 300, aura: 400, coins: 150 },
  { n: 50, xp: 500, aura: 600, coins: 250 },
  { n: 100, xp: 1000, aura: 1000, coins: 500 },
];

function addDays(str, n) {
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
function daysUntil(from, to) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
}
const isWinter = date => { const left = daysUntil(date, GOAL); return left <= 90 && left >= 0; };
const dow = str => new Date(str + 'T00:00:00Z').getUTCDay(); // 0=sun

// weekly behaviour patterns keyed mon..sun (idx 0=mon)
// y=yes(described), n=no(honest), r=rest, s=skip(ghost)
const PATTERNS = {
  low:      ['y', 's', 'n', 'r', 'y', 's', 'n'],   // ~2 gym days, chaos
  moderate: ['y', 'y', 'r', 'y', 'y', 'r', 'n'],   // 4 gym + 2 rest + 1 honest miss
  high:     ['y', 'y', 'y', 'r', 'y', 'y', 'y'],   // 6 gym + 1 rest, never misses
  elite:    ['y', 'y', 'y', 'y', 'y', 'y', 'r'],   // near-perfect
};

function simulate(pattern, { describe = true, trace = false } = {}) {
  let xp = 0, aura = 100, coins = 0, streak = 0, restThisWeek = 0;
  let totals = { yes: 0, no: 0, rest: 0, skip: 0 };
  const totalDays = daysUntil(PACT_START, GOAL); // 188
  let date = PACT_START;
  const crossings = {};
  let lastLevel = 1, lastMonth = '';
  for (let i = 0; i < totalDays; i++, date = addDays(date, 1)) {
    if (trace) {
      const lv = levelFor(xp).lv;
      if (lv > lastLevel) { crossings['lv' + lv] = date; lastLevel = lv; }
      const mon = date.slice(0, 7);
      if (mon !== lastMonth) { lastMonth = mon; if (trace.snaps) trace.snaps.push(`${mon}: lv${lv} xp${xp}`); }
    }
    const wd = (dow(date) + 6) % 7;          // mon=0
    if (wd === 0) restThisWeek = 0;          // new week
    let act = pattern[wd];
    const winter = isWinter(date);
    const pen = n => winter ? n * 2 : n;
    const prevStreak = streak;

    if (act === 'r') {
      if (restThisWeek >= 2) act = 's';      // 3rd rest -> punished skip (game rule)
      else { restThisWeek++; xp += 15; coins += 5; totals.rest++; /* streak pauses */ }
    }
    if (act === 'y') {
      const streakWithToday = prevStreak + 1;
      let base = describe ? 60 : 50;
      let mult = 1;
      if (streakWithToday >= 30) mult = 2; else if (streakWithToday >= 14) mult = 1.75;
      else if (streakWithToday >= 7) mult = 1.5; else if (streakWithToday >= 3) mult = 1.25;
      xp += Math.round(base * mult); coins += 10; aura += 25;
      streak = streakWithToday; totals.yes++;
      for (const m of MILESTONES) if (prevStreak < m.n && streak >= m.n) { xp += m.xp; aura += m.aura; coins += m.coins; }
    } else if (act === 'n') {
      aura += pen(-50); streak = 0; totals.no++;
    } else if (act === 's') {
      xp = Math.max(0, xp - 25); aura += pen(-150); streak = 0; totals.skip++;
    }
  }
  const L = levelFor(xp);
  return { xp, aura, coins, streak, level: L.lv, name: L.name, totals, crossings };
}

console.log(`pact: ${PACT_START} -> ${GOAL} (${daysUntil(PACT_START, GOAL)} days)\n`);
for (const [k, p] of Object.entries(PATTERNS)) {
  const r = simulate(p);
  console.log(
    `${k.padEnd(9)} lv${String(r.level).padStart(2)} ${r.name.padEnd(26)} ` +
    `xp ${String(r.xp).padStart(6)}  aura ${String(r.aura).padStart(6)}  coins ${String(r.coins).padStart(5)}  ` +
    `streak ${String(r.streak).padStart(3)}  [Y${r.totals.yes} R${r.totals.rest} N${r.totals.no} S${r.totals.skip}]`
  );
}
console.log('\nlevel curve:');
console.log(LEVELS.map(l => `lv${l.lv}:${l.xp}`).join('  '));

for (const tier of ['moderate', 'high']) {
  const snaps = [];
  const r = simulate(PATTERNS[tier], { trace: { snaps } });
  console.log(`\n${tier} monthly:`);
  console.log('  ' + snaps.join('\n  '));
  console.log(`  level crossings: ${Object.entries(r.crossings).map(([k, d]) => `${k}@${d}`).join('  ')}`);
}
