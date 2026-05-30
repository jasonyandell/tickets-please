# Architecture

`tickets-please` is split into a pure **engine**, an **AI**, a **UI**, and
**tests**. Data flows one way: the UI and AI produce *actions*; the engine
reduces them into new *state*; the UI renders the state.

```
            ┌─────────────┐   action    ┌──────────────────────────┐
  human ───▶│   src/ui    │────────────▶│        src/engine         │
            │  (canvas)   │◀────────────│  pure reducer over state  │
            └─────────────┘   state     └──────────────────────────┘
                                              ▲           │
                                       action │           │ state
                                              │           ▼
                                          ┌────────────────────┐
                                          │      src/ai        │
                                          └────────────────────┘
```

## Modules (`src/engine/`)
- `rng.js` — seeded PRNG + shuffle. The only source of randomness. See
  [[determinism]].
- `constants.js` — all rule numbers (cards, scoring, thresholds).
- `state.js` — state shape, deck building, the initial deal, face-up refill,
  `cloneState`.
- `actions.js` — action type tags + constructors.
- `graph.js` — connectivity (BFS), full-connectivity, longest trail (DFS).
- `map.js` — the United States map data: cities, routes, tickets. See [[map]].
- `rules.js` — `legalMoves`, `canClaimRoute`, draw/claim legality. See
  [[engine-api]].
- `scoring.js` — route points, ticket completion, longest path, `finalScores`.
  See [[scoring]].
- `game.js` — `applyAction` reducer: turn flow, end-game, winner. See
  [[engine-api]].

## Clients
- `src/ai/ai.js` — `chooseAction(state, playerId)` heuristic bot. See [[ai]].
- `src/ui/` — canvas renderer + input. See [[ui]].

## Principles
- **Pure & immutable.** Reducers return new state; never mutate inputs.
- **Deterministic.** No `Math.random`/`Date.now` in the engine.
- **Zero dependencies.** Node ≥ 20, ES modules, browser-native.
- The contract is `CONTRACT.md`; this page is the human-readable companion.
