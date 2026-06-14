# locked in — the shred pact

a daily accountability app for the bois. one goal: **ripped by dec 20, 2026.**
group chat, daily check-ins, xp, ranks, streaks, aura, an excuse tribunal,
a squad pot, monthly wrapped, before/after photo vault, push notifications,
and a wall of shame that forgets nothing.

## run it locally

```bash
npm install
npm start
# → http://localhost:3000
```

requires node 22.5+. data lives in `data/lockedin.db` (created automatically) — delete it to reset the universe.
everyone registers with a name + 4-8 digit pin; timezone is auto-detected per member, and every
member's day/deadline/streak follows their own local midnight.

## deploy it free (so the bois worldwide can join)

zero-registration hosting does not exist — but this is the minimum-click path, all free, no credit card:

**one-time setup (~10 minutes, mostly "sign in with google/github" buttons):**

1. **github** — if you don't have an account: github.com → sign up (can use your google account).
   push this folder: create a new repo (private is fine), then
   `git remote add origin <your-repo-url> && git push -u origin master`.
2. **turso** (the free cloud database) — [turso.tech](https://turso.tech) → "sign in with github" → create a database (any name, nearest region):
   - copy the **database url** (`libsql://….turso.io`)
   - create a **token** (database → tokens / connect tab) and copy it
3. **render** (the free server) — [render.com](https://render.com) → "sign in with github" → **New → Blueprint** → pick your repo
   (it reads `render.yaml` automatically). when asked for env vars, paste:
   - `TURSO_DATABASE_URL` = the libsql url
   - `TURSO_AUTH_TOKEN` = the token
   - `INVITE_CODE` = anything secret (so randoms can't sign the pact)
4. done — render gives you `https://<name>.onrender.com`. send it to the bois.

**optional but recommended:** free render instances sleep after 15 min idle (first visit then takes ~50s).
fix: [uptimerobot.com](https://uptimerobot.com) free account → add an HTTP monitor on
`https://<name>.onrender.com/api/config` every 5 minutes. the app never sleeps again,
and the ref's scheduled jobs (auto-skips, 8pm reminders, weekly fame, monthly wrapped) run on time.

## phones

- the site is a PWA: on android, chrome offers **install app**; on iphone, **share → add to home screen.**
- **push notifications** (daily 8pm reminder if you haven't checked in, callouts, tribunal verdicts,
  wager results): enable in profile → "the ref in your pocket". on iphone this only works after
  adding to home screen (iOS rule, not ours).

## the rules (as enforced by the ref — see the in-app constitution)

| action | xp | aura | notes |
|---|---|---|---|
| **YES** (trained) | +50 base, streak multiplier to 2x, +10 desc bonus | +25 | posts a flex card to chat |
| **REST** | +15 | 0 | max 2/week. **pauses** the streak (doesn't grow it, doesn't kill it). a third becomes a punished skip |
| **NO** (honest L) | 0 | −50 | excuse required → tribunal votes valid or cap |
| **SKIP** (or ghosting) | −25 | −150 | wall of shame, streak dies, pot contribution |
| capped excuse | — | −100 | "archived under fiction" |
| expired callout | — | −100 | you had 48 hours |

- **the pact**: launch june 15 2026 → finish dec 20 2026 (188 days). nothing is penalized before launch.
- **streaks** count YES days only; valid rest days and freezes pause them. milestones at 3/7/14/30/50/100.
- **ranks** (xp curve calibrated for the 188-day window, `tools/simulate.mjs`): moderate consistency
  (~4 gym + 2 rest/wk) lands ~lv7 by the finish; near-perfect consistency reaches **HIM** around dec 10 —
  earned as a finale, not weeks early. thresholds: 0 / 200 / 600 / 1300 / 2500 / 4400 / 7000 / 10500 / 15000 / 20000.
  - unpaid intern of gravity → tourist, gym district → junior bench associate → card-carrying regular →
    certified locked in → licensed local menace → registered public problem → director of overload →
    load-bearing member → **HIM**. each rank has a badge; your avatar gains armor/costume as it evolves —
    gym tee → tank → hoodie → track jacket → leather lifting vest → bronze → iron → steel+cape → gold → HIM's crown.
- **the pot** (article ix): every skip adds a configurable amount; funds the dec 20 dinner. settle in-app.
- **monthly wrapped**: on the 1st, everyone gets a shareable recap card with a guaranteed superlative.
- **photo vault**: before photo at signup; the after photo unlocks dec 20.
- **the winter arc**: from sept 21 (90 days out), aura penalties double.
- missed days reconcile automatically as skips per your own timezone (streak freezes auto-consume first).

## stack

node + express + socket.io + libsql (`file:` locally, turso in production), vanilla js frontend,
zero build step. `test/bois.mjs` simulates squad members; `test/timewarp.mjs` (server stopped)
plants historical scenarios.
