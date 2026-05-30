# Testing

> **Status: seed.** Expanded as suites land (phases 3–5). See [[workflows]].

Correctness is the headline goal ("make no mistakes"). Tests use Node's built-in
runner — **zero dependencies**:

```
npm test           # runs node --test over tests/
```

## What is tested
- **Engine units** — `rng`, `state`/deck, `graph`, `rules` (legal moves, claim
  validation), `scoring` (route points, ticket completion, longest path),
  `game` (turn flow, end game, winner). See [[engine-api]].
- **Map validity** — `npm run validate` checks `CONTRACT.md` §2 invariants.
- **Property/integration** — play full deterministic games from a seed and assert
  invariants hold every turn (conservation of cards, train counts, monotonic
  scores, legal-move soundness). See [[determinism]].

Tests use small inline fixture maps (not the big real [[map]]) so they stay fast
and isolated.
