# locked in — the shred pact

a daily accountability app for the bois. one goal: **ripped by dec 20, 2026.**
group chat, daily check-ins, xp, ranks, streaks, aura, a tribunal for your excuses,
and a wall of shame that forgets nothing.

## run it

```bash
npm install
npm start
# → http://localhost:3000
```

requires node 22.5+ (uses the built-in sqlite — no native builds).
data lives in `data/lockedin.db` (created automatically). delete it to reset the universe.

everyone registers with a name + 4-8 digit pin. multiple devices per person work.

## deploy it (so the bois can join from anywhere)

works on any node host — [render.com](https://render.com) / [railway.app](https://railway.app) free tiers are fine:

1. push this folder to a git repo
2. create a web service: build `npm install`, start `npm start`
3. add a persistent disk mounted where the app runs (the `data/` folder must survive restarts)
4. optional: set env `INVITE_CODE=something` so randoms can't sign the pact

## the rules (as enforced by the ref)

| action | xp | aura | notes |
|---|---|---|---|
| **YES** (trained) | +50 base, streak multiplier up to 2x, +10 desc bonus | +25 | posts a flex card to chat |
| **REST** | +15 | 0 | max 2/week. a third becomes a punished skip |
| **NO** (honest L) | 0 | −50 | excuse required → squad votes valid or cap |
| **SKIP** (or ghosting the app) | −25 | −150 | wall of shame, streak dies |
| capped excuse | — | −100 | "archived under fiction" |
| expired callout | — | −100 | you had 48 hours |

- **streaks** count yes + valid rest days. milestones at 3/7/14/30/50/100 pay out.
- **ranks**: npc → gym tourist → benchwarmer → regular → locked in → menace → problem → gymmaxxed → the carry → HIM. your avatar evolves (and de-evolves).
- **coins** buy shop items: streak freeze, shame shield, 2x xp day, excuse pass, aura transfusion.
- **the winter arc**: from sept 21 (90 days out), all aura penalties double.
- **wagers**: open a bet, set the stake, settle it, the ledger tracks who owes what.
- **formal callouts**: one per week. target has 48h to post a workout or take the fine.
- missed days reconcile automatically as skips (streak freezes auto-consume first).

## stack

node + express + socket.io + node:sqlite. vanilla js frontend, zero build step.
