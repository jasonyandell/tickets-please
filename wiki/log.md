# Build Log

Chronological record of ingests, queries, and lints. Newest at the bottom. See
[[CLAUDE]] for what each entry type means.

> This file was rewritten clean on 2026-05-30 after an episode of premature
> "green" claims and a referenced commit hash that never existed (an edit that
> had silently failed). All commit hashes below are verified against `git log`,
> and every "tests pass" claim below was observed before the commit it describes.

---

### 2026-05-30 — Project genesis (ingest) · commit `cd0d213`
- Scaffolding, `package.json` (`type: module`, zero deps), **Unlicense** (public
  domain), `.gitignore`, git init.
- Deterministic foundation: `rng.js` (mulberry32), `constants.js`, `state.js`
  (state shape + initial deal), `actions.js`, `graph.js` (connectivity + longest
  trail). Wrote `CONTRACT.md` (authoritative API). Smoke test: 110-card deck.
- Seeded the wiki ([[index]], [[CLAUDE]], [[overview]], [[architecture]],
  [[game-rules]], [[engine-api]], + stubs). Added `README.md`,
  `tools/validate-map.js`, `tools/serve.js`.

### 2026-05-30 — Engine core (ingest) · commit `ba7d376`
- Contract-first workflow fan-out (4 agents): the US [[map]] (validator-gated)
  + `scoring.js` + `rules.js` in parallel, then the `game.js` reducer.
- Independently verified: [[map]] 38 cities / 76 routes (9 doubles) / 37 tickets,
  validator clean; **`npm test` → 64/64**.
- Fixed the `npm test` script — Node 24 no longer auto-discovers a bare `tests/`
  arg, so it globs `tests/**/*.test.js`. Filled in [[map]] from its stub.

### 2026-05-30 — Environment incident (note)
- A long stretch of tool-call stalls (instant commands taking minutes; garbled,
  duplicated "bleeding" output) was traced to **beads** (`bd`) — an old MCP plus a
  stray `bd daemon --interval 5s` process running since April 30. Removed and
  killed. Not a code issue; recorded for timeline sense. Recurred briefly later
  from leftover node processes; cleared with `pkill`.

### 2026-05-30 — Clients + adversarial review (ingest) · commits `30ed17f`,`2532f1f`,`94b00cc`
- Second workflow (14 agents): the [[ai]] bot + a 4-dimension **adversarial rules
  audit** (each finding refuted-or-confirmed by an independent skeptic agent),
  then a full-game **simulation + property harness** and the **Canvas UI**.
- Built: [[ai]] (`src/ai/ai.js`, 7 tests, 180 stress games clean), [[ui]]
  (`src/ui/` + pure `layout.js`, 11 geometry tests), `tools/simulate.js` +
  `tests/simulation.test.js` (property invariants).
- Audit: 7 raw findings → skeptics **confirmed 5, refuted 2**. The property tests
  independently caught a deadlock. Confirmed fixes I applied:
  - **MAJOR — `map.tickets` undefined.** `KEEP_TICKETS` resolved tickets via
    `map.tickets`, but `MAP` didn't carry them → mid-game ticket draws threw on
    the real board. Fix: `MAP.tickets = TICKETS`.
  - **minor** — `legalMoves` returns `[]` when `phase==='ended'`.
  - **minor/nit** — removed dead `turnStartTickets`; documented `moveCount` &
    `PASS` in `CONTRACT.md`; clarified `STARTING_TICKETS_KEEP_MIN`.
  - The 2 refuted findings were correctly not acted on.
- `2532f1f` filled in [[ai]], [[ui]], [[testing]]; `94b00cc` added the SVG board
  renderer (`tools/render-svg.js`) + `assets/board.svg`.
- **Process miss:** `30ed17f` batched the commit in the *same step* as its gating
  test run, so it landed before results were seen — and an `Edit` had silently
  failed, leaving the start-of-turn `PASS` branch out of `legalMoves`. The suite
  was actually 82/87; the message's "87/87" was wrong.

### 2026-05-30 — Endgame turn-flow fix (ingest) · commit `671bfd2`
- The real engine bug behind the deadlock: at card exhaustion a player could be
  left with no legal continuation and the game froze (`legalMoves → []`). Added a
  **`PASS`** action (legal only when forced), `game.js` handling (auto-end a turn
  with no possible second draw; a fully frozen table ends the game via
  `finalizeGame`), and the start-of-turn `PASS` fallback in `legalMoves`.
- This took the suite to **86/87** — better, but one property test still failed,
  and I again described it too optimistically before fully verifying. (Two follow
  -up wiki commits, `119d56c` and `fc7d112`, compounded this: they claimed green
  and referenced a commit `4d9f0a2` that never existed — the mid-draw `Edit` had
  failed. This log supersedes them.)

### 2026-05-30 — Last failure was a TEST bug, not the engine (ingest + lint)
- Root-caused the final red property test (`pc=5 seed=2 step=400`): the engine was
  **correct** — `legalMoves` returned `[PASS]` and `chooseAction` returned `PASS`.
  The failure was in the *test's own* `sameAction()` comparator in
  `tests/simulation.test.js`, which lacked a `PASS` case and so hit
  `default: return false`, wrongly reporting "PASS not in legalMoves".
- Fix: added the `PASS` case to `sameAction` (test), plus a defensive mid-draw
  `PASS` fallback in `legalMoves` (so no branch can ever return `[]` for a live
  state). **`npm test` → 87/87, observed green twice before committing.** Validator
  clean; `tools/simulate.js` completes 2–5 player games to `ended`.
- Lesson recorded (and saved to memory): never put the `git commit` in the same
  step as the test run that gates it; verify, *then* commit.

### 2026-05-30 — Wiki lint
- Pages: 16. **No orphans** (all reachable from [[index]]). **No real dangling
  links** — the only unresolved `[[…]]` are the literal `[[links]]`/`[[page-name]]`
  *examples* inside [[CLAUDE]] (the schema doc), which are intentional.
- Numbers reconciled with code: 76 routes, 37 tickets, 87 tests.
