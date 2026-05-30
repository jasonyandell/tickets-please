# Determinism

The engine is **fully deterministic**: the same `seed` plus the same sequence of
actions always produces byte-identical state. This is the property that makes the
game exhaustively testable and replayable. See [[engine-api]] and [[testing]].

## How
- The only randomness lives in `src/engine/rng.js` (`makeRng`, a mulberry32
  PRNG). Nothing in the engine ever calls `Math.random()` or `Date.now()`.
- `state.seed` seeds the initial deal. `state.moveCount` increments every action;
  any mid-game randomness (deck reshuffles, face-up re-deals) derives its rng from
  `seed` + `moveCount`, so it is reproducible.
- Reducers are pure and never mutate inputs (`cloneState` in `state.js`).

## Why it matters
- **Tests** can assert on exact outcomes (see [[testing]]).
- **Replays**: a game is just `seed` + the action log; replaying yields the same
  game.
- **AI** (see [[ai]]) can look ahead by applying actions to clones without side
  effects.
