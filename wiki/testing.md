# Testing

Correctness is the headline goal ("make no mistakes"), and the project is
**verification-first**: pure unit tests are the *primary gate*, and the browser
is verified through a **deterministic state contract** — never by sampling
pixels. Unit tests use Node's built-in runner — **zero dependencies**:

```
npm test           # node --test over tests/*.test.js   (115 tests)
npm run test:e2e   # Playwright contract play-throughs   (3 tests, dev-only)
npm run validate   # check the map against its invariants
node tools/simulate.js [games] [seed]   # play full AI-vs-AI games
```

> Node 24 note: a bare `tests/` directory argument is no longer auto-discovered,
> so the script globs `tests/*.test.js` explicitly (a shell glob, so CI on Node
> 20 works too — see [[log]] 2026-05-30 deploy corrections).

## Unit suites (115 tests total)
- **`scoring.test.js`** (13) — route points, ticket completion, longest path,
  `finalScores` incl. longest-path ties. See [[scoring]].
- **`rules.test.js`** (34) — `canClaimRoute` (colored/gray/wild, trains, double
  routes), `legalMoves` (start/mid-draw/pending/ended), `canonicalSpend`. See
  [[engine-api]].
- **`game.test.js`** (22) — the `applyAction` reducer: draws, claims, the
  ticket flow, end-game trigger and winner, no-mutation, determinism.
- **`ai.test.js`** (8) — the bot always returns a legal move, resolves tickets,
  claims usefully, is deterministic. See [[ai]].
- **`layout.test.js`** (11) — pure UI geometry (box counts, hit-testing, double
  routes). See [[ui]].
- **`viewModel.test.js`** (22) — the **pure UI derivation** (`buildViewModel`):
  derived actions/claimability + per-route blocked reasons, **hotseat privacy
  masking** (active human revealed, opponents counts-only), live standings &
  longest-route leader, the game-over scoreboard/winner, no-mutation, and a JSON
  round-trip (the view-model is plain data). See [[ui]].
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
- **One canvas smoke flag** — `canvas.dataset.painted === "true"`, set by
  `render.js` after a real paint. This is the *only* canvas check anywhere.

**Canvas color / pixel sampling is banned** — it was flaky and slow, and a green
sample with a wrong picture proves nothing. It has been fully replaced by
deterministic, contract-based play-throughs. See [[browser-verify]] and [[log]]
(2026-06-06).

## e2e suites (3 tests, `npm run test:e2e`)
Playwright, dev-only — the shipped game stays zero-dependency. Each test boots
the built `dist/`, drives a scripted play-through, and asserts FACTS via the
contract above (plus a `board.png` screenshot as human-checkable evidence):
- **`board.spec.js`** (2) — menu → setup (fixed seed) → start → resolve starting
  tickets → play a turn (draw 2 cards) asserting `lastAction`/hand counts
  advanced; and hover-a-route shows its claimability, then claiming a claimable
  route advances the turn and the longest-route leader.
- **`hotseat.spec.js`** (1) — two humans: opponents are masked to counts only,
  and the pass-the-device overlay appears only between consecutive human turns,
  re-masking the previous player on acknowledge.
