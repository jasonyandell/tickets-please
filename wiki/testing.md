# Testing

Correctness is the headline goal ("make no mistakes"). Tests use Node's built-in
runner — **zero dependencies**:

```
npm test           # node --test over tests/**/*.test.js  (87 tests)
npm run validate   # check the map against its invariants
node tools/simulate.js [games] [seed]   # play full AI-vs-AI games
```

> Node 24 note: a bare `tests/` directory argument is no longer auto-discovered,
> so the script globs `tests/**/*.test.js` explicitly.

## Suites (87 tests total)
- **`scoring.test.js`** (13) — route points, ticket completion, longest path,
  `finalScores` incl. longest-path ties. See [[scoring]].
- **`rules.test.js`** (34) — `canClaimRoute` (colored/gray/wild, trains, double
  routes), `legalMoves` (start/mid-draw/pending/ended), `canonicalSpend`. See
  [[engine-api]].
- **`game.test.js`** (17) — the `applyAction` reducer: draws, claims, the
  ticket flow, end-game trigger and winner, no-mutation, determinism.
- **`ai.test.js`** (7) — the bot always returns a legal move, resolves tickets,
  claims usefully, is deterministic. See [[ai]].
- **`layout.test.js`** (11) — pure UI geometry (box counts, hit-testing, double
  routes). See [[ui]].
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
