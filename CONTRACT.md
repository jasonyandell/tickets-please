# Engine API Contract

This is the **authoritative specification** every engine module is implemented
against. If an implementation and this document disagree, the document wins —
fix the code (or, if the document is wrong, fix the document first, then the
code, then note it in `wiki/log.md`).

The engine is a **pure deterministic reducer**. No I/O, no `Date.now()`, no
`Math.random()` (use `src/engine/rng.js`). Given a seed and an action sequence,
state is reproducible exactly. State is treated as immutable: reducers return a
new state object and never mutate their input.

---

## 1. Card model (`src/engine/constants.js` — already implemented)

- `TRAIN_COLORS` — 8 colors: red, orange, yellow, green, blue, purple, white, black.
- `WILD` = `'rainbow'` — locomotive / wild card.
- `CARD_COLORS` = the 8 colors plus `WILD`.
- `GRAY` = `'gray'` — a route color meaning "any single color".
- Deck: `CARDS_PER_COLOR` (12) of each color + `WILD_COUNT` (14) wilds = 110.

A **hand** is a tally object: `{ [color]: count }` for colors a player holds.
A **deck / discard / face-up row** is an array of color strings.

## 2. Map format (`src/engine/map.js`)

```js
export const MAP = {
  name: 'United States',
  width: 1200,            // logical canvas units
  height: 760,
  cities: [
    { id: 'sea', name: 'Seattle', x: 120, y: 70 },
    // ... x,y in [0,width]x[0,height]
  ],
  routes: [
    { id: 'sea-por', a: 'sea', b: 'por', length: 1, color: 'gray' },
    // length in 1..6, color in TRAIN_COLORS or GRAY
    // Double routes: two route objects with the same {a,b} (order-insensitive).
    //   Give each a distinct id. Add `parallel: true` to BOTH.
  ],
};
export const TICKETS = [
  { id: 't1', from: 'sea', to: 'nyc', points: 22 },
  // from/to are city ids; points is the ticket value (completed: +points,
  // incomplete at game end: -points). Order-insensitive.
  // NOTE: the engine resolves kept ticket ids via `map.tickets`, so the MAP
  // object must also carry the ticket list: `MAP.tickets = TICKETS` (the real
  // map.js does this). A `map` value passed to the engine is { cities, routes,
  // tickets }.
];
```

Invariants (enforced by `tools/validate-map.js`):
- Every `route.a`/`route.b`/`ticket.from`/`ticket.to` references an existing city id.
- All ids (cities, routes, tickets) are unique.
- `1 <= route.length <= 6`; color is a `TRAIN_COLORS` member or `GRAY`.
- The city graph (ignoring colors) is fully connected.
- No `a === b` self-routes. At most 2 parallel edges between any pair, and if 2,
  both carry `parallel: true`.
- Every city coordinate lies within `[0,width] x [0,height]`.
- Every ticket's two endpoints are connected in the graph (so it is achievable).

## 3. State shape (`src/engine/state.js`)

```js
state = {
  seed: number,
  players: [{
    id: number,            // index 0..n-1
    name: string,
    isAI: boolean,
    hand: { [color]: count },   // train-car cards held
    trains: number,             // remaining train pieces (starts 45)
    tickets: [{ id, from, to, points, done: boolean }],
    claimedRoutes: number[] | string[],  // route ids owned
    score: number,              // running route-claim score (tickets added at end)
  }],
  deck: string[],          // draw pile (top = end of array)
  discard: string[],
  faceUp: string[],        // exactly FACE_UP_SLOTS entries (may include nulls only if deck+discard exhausted)
  ticketDeck: string[],    // ticket ids
  ticketDiscard: string[],
  routeOwner: { [routeId]: playerId },
  current: number,         // index of player to move
  phase: 'setup' | 'play' | 'finalRound' | 'ended',
  finalTurnsLeft: number | null,  // set when final round begins
  pending: null | {        // an in-progress multi-step action by `current`
    kind: 'tickets',
    offered: string[],     // ticket ids offered
    minKeep: number,
  },
  cardsDrawnThisTurn: number,  // 0,1,2; turn ends after 2 (or 1 if a wild was taken face-up)
  moveCount: number,       // increments every applied action; seeds mid-game rng (see §7)
  log: string[],
  winner: number[] | null, // set when phase === 'ended' (ties allowed)
};
```

`initGame({ map, tickets, playerConfigs, seed })` returns a ready-to-play
`state` in `phase: 'play'` with: deck shuffled, hands dealt (`STARTING_HAND`),
face-up row filled (respecting `MAX_FACE_UP_WILDS`), starting tickets dealt to
each player as a `pending`-free convenience OR via initial pendings — see §5.
For simplicity the initial ticket selection is handled by dealing each player
`STARTING_TICKETS_DEAL` tickets already in their `tickets` array marked not-done
(keep-all) when `playerConfigs[i].autoKeepTickets` is set; otherwise the first
turns resolve initial ticket choices. The default `initGame` keeps all starting
tickets (simplest correct behavior) — the AI/UI may override.

## 4. Actions (`src/engine/actions.js` — type tags + small constructors)

```
{ type: 'DRAW_FACEUP', slot }      // take faceUp[slot]; wild costs the whole turn
{ type: 'DRAW_DECK' }              // draw blind from deck
{ type: 'CLAIM_ROUTE', routeId, spend: { [color]: count } }
{ type: 'DRAW_TICKETS' }           // -> sets state.pending (kind:'tickets')
{ type: 'KEEP_TICKETS', keep: string[] }  // resolve pending; keep ⊆ offered, |keep| >= minKeep
{ type: 'PASS' }                   // forfeit turn; legal ONLY when no other move exists
```

`PASS` models the official rule that a player who cannot draw cards (deck and
discard exhausted, no drawable face-up card), cannot claim any route, and cannot
draw tickets simply forfeits their turn. It is the only legal move in that
situation; `legalMoves` returns exactly `[{type:'PASS'}]` and `applyAction`
rejects a `PASS` whenever any other move is available. If a `PASS` occurs and no
player can claim any route either, the game state is frozen and the engine ends
the game (computing the winner from `finalScores`).

## 5. Rules (`src/engine/rules.js`)

- `legalMoves(state) -> Action[]` — every legal action for `state.current` right
  now. When `state.pending` is set, the only legal actions are `KEEP_TICKETS`
  with each valid subset of size >= minKeep (it is acceptable to return one
  canonical "keep all" plus minimal subsets; AI/UI build their own choice, so
  returning a representative non-empty set is fine — document what you return).
- `canClaimRoute(state, playerId, routeId, spend) -> { ok, reason? }` — validates:
  route exists & unclaimed; in <4-player games a parallel sibling not owned by
  the same player blocks it (and a player may never own both siblings); player
  has `>= route.length` trains; `spend` counts sum to `route.length`; for a
  colored route, all non-wild spent cards match `route.color`; for a gray route,
  all non-wild spent cards are a single color; player actually holds `spend`.
- A turn consists of exactly one of: drawing cards (1 or 2 — see card rules),
  claiming one route, or drawing tickets. Helpers may expose
  `isTurnOver(state)`.

Card-draw turn rules:
- A player draws up to 2 cards. Taking a **face-up wild** uses the entire turn
  (only that one card). After drawing the first non-wild card, the player may
  draw a second; you may NOT take a face-up wild as the second card.
- When a face-up card is taken it is immediately replaced from the deck. If that
  causes `MAX_FACE_UP_WILDS` wilds to show, discard all five and re-deal.
- Reshuffle `discard` into `deck` (via rng) when the deck empties.

## 6. Scoring (`src/engine/scoring.js`)

- `routeScore(length) -> number` using `ROUTE_POINTS`.
- `playerNetworkConnected(state, playerId, cityA, cityB) -> boolean` — are the
  two cities connected using only routes owned by that player? (union-find / BFS)
- `ticketComplete(state, playerId, ticket) -> boolean`.
- `longestPath(state, playerId) -> number` — longest continuous trail (a path
  that may reuse cities but not edges) measured in **train segments** summed by
  route length. Standard TtR longest-route: it's the longest trail by total
  length over the player's owned routes. Exact DFS over the player's subgraph.
- `finalScores(state) -> [{ playerId, routePoints, ticketPoints, longestBonus, total, completedTickets, longestPath }]`
  and assigns `LONGEST_PATH_BONUS` to the player(s) with the max longest path.

## 7. Game orchestrator (`src/engine/game.js`)

- `applyAction(state, action) -> state` — pure. Throws `Error` on an illegal
  action (callers should check `legalMoves`/`canClaimRoute` first). Handles:
  advancing `cardsDrawnThisTurn`, ending the turn and advancing `current`,
  triggering the final round when a player drops to `<= ENDGAME_TRAIN_THRESHOLD`
  trains, decrementing `finalTurnsLeft`, and transitioning to `phase:'ended'`
  with `winner` computed from `finalScores` (ties => multiple winners).
- `applyActions(state, actions[]) -> state` — fold helper.
- Determinism: any randomness (shuffles, reshuffles, re-deals) uses an rng
  seeded deterministically from `state.seed` and a move counter, so the same
  inputs always produce the same outputs.

## 8. AI (`src/ai/ai.js`)

- `chooseAction(state, playerId) -> Action` — returns one legal action. A
  greedy/heuristic bot: prioritize claiming routes that progress unfinished
  tickets, otherwise draw toward the most useful color, otherwise draw tickets
  when hand is flush. Must only ever return actions in `legalMoves`.

## 9. Conventions

- ES modules, named exports, no default exports.
- No external dependencies anywhere. Node >= 20.
- Pure functions; never mutate inputs. Clone with structured spreads.
- Tests live in `tests/<module>.test.js` using `node:test` + `node:assert/strict`.
- Tests must not depend on the big real map — use small inline fixture maps for
  engine unit tests so they stay isolated and fast.
