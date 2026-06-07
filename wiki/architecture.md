# Architecture

`tickets-please` is split into a pure **engine**, an **AI**, a **UI**, and
**tests**. Data flows one way: the UI and AI produce *actions*; the engine
reduces them into new *state*; the UI renders the state.

```
            ┌─────────────┐   action    ┌──────────────────────────┐
  human ───▶│   src/ui    │────────────▶│        src/engine         │
            │  (screens)  │◀────────────│  pure reducer over state  │
            └─────────────┘   state     └──────────────────────────┘
                                              ▲           │
                                       action │           │ state
                                              │           ▼
                                          ┌────────────────────┐
                                          │      src/ai        │
                                          └────────────────────┘
```

Inside the UI the data path runs through **one pure derivation layer**:

```
  engine state ──▶ viewModel.js (PURE buildViewModel) ──▶ window.__APP__.viewModel
                                                          │
                              ┌───────────────────────────┴───────────────┐
                          game/panel.js (HUD)                   game/board.js (canvas)
                              renders viewModel                    renders viewModel
                          (the e2e suite reads the SAME object — see [[testing]])
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
- `src/ui/` — the browser client. See [[ui]] for the full module split. Key
  pieces:
  - `viewModel.js` — **pure derivation**: `buildViewModel(state, …)` turns engine
    state into a plain, render-ready object (legality, affordability, hotseat
    masking, standings, scoreboard). No DOM/globals/side effects, so it is
    unit-tested directly and is the single source the renderers AND the e2e suite
    read.
  - `app.js` — screen router (`menu | setup | game | gameover`) + the
    `window.__APP__` Observable State Contract.
  - `screens/*` — per-screen DOM (`menu`, `setup`, `gameover`, `passdevice`).
  - `game/panel.js` (HUD) + `game/board.js` (canvas interaction) — pure views
    over the view-model.
  - `history.js` (undo/redo) **and** `persist.js` (save/reload) share **one
    record/replay core**: the seed + an append-only action **tape** fully
    determine the game, so state is always a pure *replay* of a tape prefix
    through the engine reducer — never an inverse-delta mutation or a serialized
    snapshot. Both ride directly on [[determinism]]. `history.js` moves a playhead
    across human decision points (skipping AI); `persist.js` serializes the same
    tape to `localStorage` and restores by replaying it. See [[ui]].
  - `anim.js` — the **pure, timer-free animation kit**: motion as a function of
    `elapsed` (route-claim pop + the traveling ticket pulse) plus isolated,
    clock-injectable rAF drivers, with an instant mode for test/reduced-motion.
    No DOM. See [[ui]] + [[testing]].
  - `main.js` — thin controller wiring engine + AI + renderer; `render.js` +
    `layout.js` — canvas drawing + pure geometry.

## Principles
- **Pure & immutable.** Reducers return new state; never mutate inputs.
- **Deterministic.** No `Math.random`/`Date.now` in the engine.
- **Zero dependencies.** Node ≥ 20, ES modules, browser-native.
- The contract is `CONTRACT.md`; this page is the human-readable companion.
