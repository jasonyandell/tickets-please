# Build Log

Append-only chronological record of ingests, queries, and lints. Newest at the
bottom. See [[CLAUDE]] for what each entry type means.

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
- Launched the contract-first fan-out (see [[workflows]] phase 2–3): one workflow
  building, in parallel, the US [[map]] (validator-gated) + `scoring.js` +
  `rules.js`, then the `game.js` orchestrator that depends on them. Each module
  ships with a `node:test` suite the agent must drive to green.
- Awaiting results before verifying integration and building the [[ai]]/[[ui]].

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
  "bleeding" output) was traced to **beads** (`bd`), an old MCP/daemon — including
  a stray `bd daemon --interval 5s` process running since April 30. Beads removed,
  daemon killed; channel healthy. Not a code issue; recorded so the timeline makes
  sense. Engine work was unaffected (all tests green afterward).

### 2026-05-30 — Clients + adversarial review workflow launched (ingest)
- Launched the second workflow (see [[workflows]]): in parallel, the [[ai]] bot
  (`src/ai/ai.js` + tests) and a 4-dimension **adversarial rules audit** of the
  engine against the official rules — each finder's findings are independently
  **verified by a skeptic agent** (refute-by-default) before being reported, so
  only confirmed bugs reach me. Then in parallel: a full-game **simulation +
  property-test harness** (`tools/simulate.js`, `tests/simulation.test.js` —
  card/train conservation, legality, termination, determinism) and the
  **Canvas UI** (`src/ui/` + pure `layout.js` geometry tests).
- Awaiting results; will apply any confirmed audit fixes, re-run the full suite,
  then update [[ai]], [[ui]], [[testing]].

### 2026-05-30 — Clients landed; deadlocks found & fixed (ingest + lint)
- Workflow completed (14 agents). Built: [[ai]] (`src/ai/ai.js`, 7 tests, 180
  stress games clean), [[ui]] (`src/ui/` Canvas board + pure `layout.js`, 11
  geometry tests), and the simulation/property harness (`tools/simulate.js`,
  `tests/simulation.test.js`).
- **Adversarial audit** produced 7 raw findings; independent skeptic agents
  refuted 2 and confirmed 5. The **property tests** independently caught a real
  deadlock. Fixes applied by me to the engine:
  - **CRITICAL — turn-flow dead-end.** At card exhaustion a player could draw a
    first card with no legal second draw, or face a turn with no legal action at
    all, and the game froze (`legalMoves → []`). Fix: a first draw with no
    possible second draw auto-ends the turn; a genuinely stuck player uses a new
    `PASS` action (legal only when forced); a fully frozen table ends the game.
    Resolved all 5 deadlocking seeds (5p, seeds 2/13/21/42/99).
  - **MAJOR — `map.tickets` undefined.** `KEEP_TICKETS` resolved tickets via
    `map.tickets`, but `MAP` didn't carry them → mid-game ticket draws threw on
    the real board. Fix: `MAP.tickets = TICKETS` in `map.js`.
  - **minor** — `legalMoves` now returns `[]` when `phase==='ended'`.
  - **minor/nit** — removed dead `turnStartTickets`; documented `moveCount` and
    `PASS` in `CONTRACT.md`; clarified `STARTING_TICKETS_KEEP_MIN`.
  - Two findings (refuted/non-bugs) were correctly not acted on.
- **`npm test` → 87/87 pass.** Validator clean. `tools/simulate.js` plays full
  games to completion. Filled in [[ai]], [[ui]], [[testing]] from stubs.
- **Commit `8a4e7af`** — "Clients (AI, UI, sim) + fix engine deadlocks".

### 2026-05-30 — Wiki lint
- No orphans: every page is reachable from [[index]]. No dangling links: all
  `[[…]]` targets exist. Numbers on [[map]]/[[scoring]]/[[testing]] reconciled
  with the code (76 routes, 37 tickets, 87 tests). The earlier environment
  incident ([[workflows]]/beads) is recorded above for timeline completeness.
