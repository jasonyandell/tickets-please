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
