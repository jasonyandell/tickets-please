# Build Log

Append-only chronological record of ingests, queries, and lints. Newest at the
bottom. See [[CLAUDE]] for what each entry type means.

> Note: a few entries below reference an environment incident (the `beads` tool
> caused tool-call stalls and garbled, duplicated output). This `log.md` was
> rewritten clean on 2026-05-30 to remove duplicate lines that the glitch had
> scattered through it; content and commit hashes were reconciled against
> `git log`.

---

### 2026-05-30 — Project genesis (ingest)
- Created the project: scaffolding, `package.json` (`type: module`, zero deps),
  **Unlicense** (public domain), `.gitignore`. Git initialized.
- Authored the deterministic foundation: `src/engine/rng.js` (mulberry32),
  `constants.js` (card/deck/scoring numbers), `state.js` (state shape + initial
  deal), `actions.js` (action tags), `graph.js` (connectivity + longest trail).
- Wrote `CONTRACT.md`, the authoritative engine API spec.
- Smoke-tested: deck builds to 110 cards (12×8 colors + 14 wilds); graph
  helpers return expected results.
- Seeded the wiki: [[index]], [[CLAUDE]], [[overview]], [[architecture]],
  [[game-rules]], [[engine-api]], plus stubs for [[map]], [[ai]], [[ui]],
  [[testing]], [[scoring]], [[determinism]], [[design-decisions]], [[workflows]],
  [[glossary]].
- Added `README.md`, `tools/validate-map.js`, `tools/serve.js`.
- **Commit `cd0d213`** — "Foundation: engine primitives, contract, first-class wiki".

### 2026-05-30 — Engine build workflow launched (ingest)
- Launched the contract-first fan-out (see [[workflows]] phases 2–3): one
  workflow building, in parallel, the US [[map]] (validator-gated) + `scoring.js`
  + `rules.js`, then the `game.js` orchestrator that depends on them. Each module
  ships with a `node:test` suite the agent must drive to green.

### 2026-05-30 — Engine core landed & verified (ingest)
- Workflow completed (4 agents). Independently verified on a healthy channel:
  - [[map]] `src/engine/map.js`: 38 cities, 76 routes (9 doubles), 37 tickets;
    `npm run validate` → ✓ valid, 0 errors.
  - `scoring.js` (13 tests), `rules.js` (34 tests), `game.js` (17 tests).
  - **`npm test` → 64/64 pass.** Determinism, end-game/winner, and no-mutation
    all asserted. See [[testing]], [[determinism]], [[scoring]].
- Fixed the `npm test` script: Node 24 no longer auto-discovers a bare `tests/`
  directory arg, so it now globs `tests/**/*.test.js`.
- Filled in [[map]] from a stub to the real distributions.
- **Commit `ba7d376`** — "Engine core: map, rules, scoring, game reducer".

### 2026-05-30 — Environment incident (lint/note)
- A long stretch of tool-call stalls (instant commands taking minutes, garbled
  "bleeding"/duplicated output) was traced to **beads** (`bd`), an old MCP/daemon
  — including a stray `bd daemon --interval 5s` process running since April 30.
  Beads removed, daemon killed. Not a code issue; recorded so the timeline makes
  sense. Engine work was unaffected (all tests green afterward).

### 2026-05-30 — Clients + adversarial review workflow (ingest)
- Launched the second workflow (see [[workflows]]): in parallel, the [[ai]] bot
  (`src/ai/ai.js` + tests) and a 4-dimension **adversarial rules audit** of the
  engine — each finder's findings independently **verified by a skeptic agent**
  (refute-by-default) before being reported, so only confirmed bugs reach me.
  Then in parallel: a full-game **simulation + property-test harness**
  (`tools/simulate.js`, `tests/simulation.test.js` — card/train conservation,
  legality, termination, determinism) and the **Canvas UI** (`src/ui/` + pure
  `layout.js` geometry tests).
- Workflow completed (14 agents). Built: [[ai]] (7 tests; 180 stress games
  clean), [[ui]] (Canvas board + 11 geometry tests), the sim/property harness.
- The audit produced 7 raw findings; skeptics refuted 2 and **confirmed 5**. The
  property tests independently caught a real deadlock. Fixes I applied:
  - **CRITICAL — turn-flow dead-end.** At card exhaustion a player could be
    stranded mid-turn (a first draw with no possible second draw) or face a turn
    with no legal action at all, and the game froze (`legalMoves → []`). Fix: a
    first draw with no possible second draw auto-ends the turn; a genuinely stuck
    player uses a new `PASS` action (legal only when forced); a fully frozen
    table ends the game. Resolved all 5 deadlocking seeds (5p: 2,13,21,42,99).
  - **MAJOR — `map.tickets` undefined.** `KEEP_TICKETS` resolved tickets via
    `map.tickets`, but `MAP` didn't carry them → mid-game ticket draws threw on
    the real board. Fix: `MAP.tickets = TICKETS` in `map.js`.
  - **minor** — `legalMoves` returns `[]` when `phase==='ended'`.
  - **minor/nit** — removed dead `turnStartTickets`; documented `moveCount` and
    `PASS` in `CONTRACT.md`; clarified `STARTING_TICKETS_KEEP_MIN`.
  - The 2 refuted findings were correctly not acted on.
- The deadlock fix took **two** commits and I learned a lesson: in commit
  `8a4e7af` I batched the `git commit` in the *same step* as the gating test run,
  so I committed before seeing the result — and an editing slip had left the
  `legalMoves` `PASS` branch out, so 5 property tests were still red and the
  commit message's "87/87" was wrong. `57b7e85` added the missing branch; the
  full suite was then re-run and observed **87/87 green before committing**.
  Rule going forward: never commit in the same step as the test run that gates it.
- **`npm test` → 87/87 pass.** Validator clean. `tools/simulate.js` plays full
  games to completion. Filled in [[ai]], [[ui]], [[testing]] from stubs.
- **Commits:** `8a4e7af` (clients + first deadlock fixes), `2532f1f` (wiki fill),
  `94b00cc` (SVG board renderer + `assets/board.svg`), `57b7e85` (complete the
  deadlock fix).

### 2026-05-30 — Wiki lint
- No orphans: every page is reachable from [[index]]. No real dangling links:
  the only unresolved `[[…]]` are the illustrative `[[links]]`/`[[page-name]]`
  examples inside [[CLAUDE]] (the schema doc), which are intentional.
- Numbers reconciled with code: 76 routes, 37 tickets, 87 tests.
- Rewrote this `log.md` clean to remove duplicate lines the beads glitch had
  scattered through earlier entries; commit hashes verified against `git log`.
