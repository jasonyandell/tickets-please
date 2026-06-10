# Testing

Correctness is the headline goal ("make no mistakes"), and the project is
**verification-first**: pure unit tests are the *primary gate*, and the browser
is verified through a **deterministic state contract** — never by sampling
pixels. Unit tests use Node's built-in runner — **zero dependencies**:

```
npm test           # node --test over tests/*.test.js   (214 tests, ~2.5s)
npm run test:e2e   # Playwright contract play-throughs   (13 tests, ~6.3s, dev-only)
npm run validate   # check the map against its invariants
node tools/simulate.js [games] [seed]   # play full AI-vs-AI games
```

> Node 24 note: a bare `tests/` directory argument is no longer auto-discovered,
> so the script globs `tests/*.test.js` explicitly (a shell glob, so CI on Node
> 20 works too — see [[log]] 2026-05-30 deploy corrections).

## Unit suites (214 tests total)
- **`scoring.test.js`** (13) — route points, ticket completion, longest path,
  `finalScores` incl. longest-path ties. See [[scoring]].
- **`rules.test.js`** (34) — `canClaimRoute` (colored/gray/wild, trains, double
  routes), `legalMoves` (start/mid-draw/pending/ended), `canonicalSpend`. See
  [[engine-api]].
- **`game.test.js`** (22) — the `applyAction` reducer: draws, claims, the
  ticket flow, end-game trigger and winner, no-mutation, determinism.
- **`ai.test.js`** (8) — the bot always returns a legal move, resolves tickets,
  claims usefully, is deterministic. See [[ai]].
- **`geometry.test.js`** (21) — pure UI geometry (`geometry.js`): slot counts +
  placement, double-route offsets (symmetric; `parallelOffset` used as single
  source by both slots and track line), `routeLine` endpoints at cities, missing-
  city null, `convexHull` (every city inside; deterministic + degenerate-safe).
  Replaces the old `layout.test.js` (11). See [[ui]].
- **`viewModel.test.js`** (37) — the **pure UI derivation** (`buildViewModel`):
  derived actions/claimability + per-route blocked reasons, **hotseat privacy
  masking** (active human revealed, opponents counts-only), live standings &
  longest-route leader, the game-over scoreboard/winner, the **weighted ticket
  heat-map** (`ticketRouteWeights`: overlapping tickets accumulate, complete
  tickets add nothing; lit for the lone human even on an AI turn, but `null` for
  the inactive hotseat human so tickets never leak), the **ordered source→dest
  ticket paths** (`ticketOrderedPaths`, a subset of the weight set, same Dijkstra)
  that drive the traveling pulse, no-mutation, and a JSON round-trip (the
  view-model is plain data). See [[ui]].
- **`boardLevel.test.js`** (5) — the **pure board level policy**
  (`src/ui/render.js:routeLevel`) behind `.route[data-level]`: claimable only on
  a human turn (an AI turn never shows a go signal), affordable only when the
  active human's own hand may show (masked hands never leak), claimed routes
  carry no level, claimable outranks affordable, null-safe. `render.js` is
  import-safe under Node, so the policy unit-tests with no browser. See [[ui]].
- **`history.test.js`** (9) — the **undo/redo recorder/player** (`history.js`):
  state as a pure replay of the tape prefix, undo skipping AI to the previous
  human action, redo, and branch-on-new-action (truncate at the cursor). See
  [[ui]].
- **`anim.test.js`** (22) — the **animation kit** (`anim.js`): the PURE frame
  model (`frame`/`pulse`/`popParams` + the traveling-pulse maths
  `pulseCenter`/`bump`/`pulseIntensityAt` — endpoints, peak, monotonic, clamp,
  wrap-around) and both rAF **drivers** under a fake clock + no-op raf
  (`createPopAnimator` start/retarget/cancel/settle; `createLoopAnimator`
  start/stop/idempotent) with NO real timers. The pattern is documented in [[ui]]
  ("How we test animations"). See [[ui]].
- **`persist.test.js`** (6) — **save/restore** (`persist.js`): serialize →
  deserialize round-trip of the recipe (seed + playerConfigs + action tape +
  cursor), rejecting corrupt/foreign/old-version saves without throwing, and
  **restore-by-replay** rebuilding the exact position. See [[ui]].
- **`contrast.test.js`** (32) — a **WCAG AA contrast gate** over the design-token
  palette: parses the `:root` `--token: #hex` colors in `src/ui/style.css` and
  asserts every (text, background) pair the UI paints clears the AA threshold, so
  a palette tweak can't dim a token below legibility. Pure (reads a file, does
  math; no DOM).
- **`simulation.test.js`** (5) — **property-based** invariants over many full
  games (see below).

## Property-based invariants (`simulation.test.js`)
Full AI-vs-AI games across several seeds and player counts, asserting at every
step / at game end:
- **Card conservation**: hands + deck + discard + faceUp == 110, always.
- **Train conservation**: `trains == 45 − Σ claimed-route lengths`; never negative.
- **Legality**: every applied action was in `legalMoves` at that moment.
- **Ownership**: no route owned twice; no player owns both sides of a double.
- **Score**: monotonic non-decreasing; equals the sum of claimed-route points.
- **Termination**: every game reaches `phase:'ended'` with a non-empty winner
  matching the max `finalScores` total.
- **Determinism**: same `(playerCount, seed)` ⇒ identical final state.

These property tests caught a real engine deadlock the unit tests missed (a
turn-flow dead-end at card exhaustion), now fixed — see [[log]] (2026-05-30
review) and the `PASS` handling in [[engine-api]]. This is the value of the
adversarial-review + property-test layer described in [[workflows]].

Unit tests use small inline fixture maps (not the big real [[map]]) so they stay
fast and isolated; a couple of integration tests exercise the real map.

## Verification-first: the Observable State Contract
The whole UI is built so it can be verified **structurally**, not visually. The
keystone is `viewModel.js`, a [[ui|pure derivation]] of everything the UI renders
— so most UI logic is covered by plain, deterministic unit tests
(`viewModel.test.js`), the fastest gate.

For real-browser behaviour the e2e suite reads an explicit contract instead of
inspecting the canvas:

- **`window.__APP__ = { screen, viewModel, lastAction }`** — the read-only
  app-state snapshot (`screen` is the active router screen, `viewModel` the
  published pure view-model, `lastAction` the last applied action with its
  actor). A separate `window.__BOARD__` exposes route hit-testing + the current
  tooltip for driving real hover/click.
- **Stable DOM hooks** — `[data-screen]`, `[data-testid="…"]` (prompt,
  standings, scoreboard, pass-device, …), `button[data-action]`/`data-reason`,
  and `data-*` attributes (e.g. `rank-N` carries `data-rank`/`data-leader`).
- **SVG structural hooks** — `g[data-route-id]` (one per view-model route),
  `g[data-city-id]` (one per city), `data-claimed`/`data-owner` that flip on
  the live DOM node when a route is claimed. The SVG substrate makes board
  structure directly assertable without pixel sampling.
- **One smoke flag** — `#map dataset.painted === "true"`, set by `render.js`
  after a real SVG render pass. This is the only paint-proof check anywhere.

**Canvas color / pixel sampling is banned** — it was flaky and slow, and a green
sample with a wrong picture proves nothing. It has been fully replaced by
deterministic, contract-based play-throughs. See [[browser-verify]] and [[log]]
(2026-06-06).

## e2e suites (13 tests, `npm run test:e2e`)
Playwright, dev-only — the shipped game stays zero-dependency. Each test boots
the built `dist/`, drives a scripted play-through, and asserts FACTS via the
contract above (plus screenshots as human-checkable evidence):
- **`board.spec.js`** (3) — menu → setup (fixed seed) → start → resolve starting
  tickets → play a turn (draw 2 cards) asserting `lastAction`/hand counts
  advanced; hover-a-route shows its claimability, then claiming a claimable route
  advances the turn and the longest-route leader; and the **ticket heat-map stays
  lit during the AI turn** in a 1-human game (the lone human's map never blanks).
- **`hotseat.spec.js`** (1) — two humans: opponents are masked to counts only,
  and the pass-the-device overlay appears only between consecutive human turns,
  re-masking the previous player on acknowledge.
- **`undo.spec.js`** (1) — after a move, **undo** returns to the pre-move state
  (skipping the AI so the table waits on the human), and **redo** restores it —
  the recorder/player contract end-to-end.
- **`persist.spec.js`** (2) — a game **survives a page reload** (same game, same
  point via replay), and **New Game overwrites the save** (a reload restores the
  new game, not the old one).
- **`anim.spec.js`** (1) — claiming a route **pops then settles** in instant mode
  (zero timing coupling): the pop count increments and `data-animating` returns to
  `false`, asserting a durable fact rather than sleeping on a frame.
- **`pulse.spec.js`** (1) — the viewer's ticket paths are **ordered source→dest**
  and the heat-map is **static** in instant mode (no motion the gate depends on).
- **`cities.spec.js`** (1) — cities render as **metro station dots** and the
  city-count contract hook (`#map dataset.cities`) matches the [[map]] city
  count (structural assertion, no pixel sampling).
- **`responsive.spec.js`** (2 + artifacts) — at 1024×700 and 1280×720 the layout
  has no overflow and key elements stay in-viewport; plus an **artifacts** run
  that saves setup + game-over screenshots for human review.
