# AI

Computer opponents live in `src/ai/ai.js` and expose a single function:

```js
chooseAction(state, map) -> Action
```

It returns one move for the player whose turn it is (`state.current`), and it is
**guaranteed to be a member of `legalMoves(state, map)`** — it resolves every
preference against the legal list and falls back to `legal[0]`, so it can never
return an action the reducer would reject. It is fully
[[determinism|deterministic]]: no randomness, no clock; ties break by a stable
rule (lowest `routeId`, then lowest face-up slot). See [[engine-api]].

## Heuristic (priority order)
1. **Pending ticket choice** → `KEEP_TICKETS`, keeping every already-completed
   ticket plus the best reachable ones, always respecting `minKeep`.
2. **Mid-draw** (one card already taken) → draw a needed face-up color, else the
   deck.
3. **Claim toward a ticket** → claim a route on the BFS shortest path between an
   unfinished ticket's endpoints, ranked by remaining ticket value, then route
   score, then lowest id. Uses `scoring.playerNetworkConnected` to know which
   tickets are still open.
4. **Claim a long route** (length ≥ 4) if one is affordable.
5. **Draw tickets** when holding < 2 unfinished tickets, the ticket deck is
   non-empty, and it is still early (trains > half).
6. **Draw cards** — prefer the most-needed face-up color, else draw blind.

## Robustness
Late games can drift toward card exhaustion. When the draw supply (deck +
discard) is low, the AI prefers claiming an affordable route (which discards
cards back into supply) over drawing. The engine is robust regardless — see the
`PASS`/end-of-game handling in [[engine-api]] — but the AI avoids reaching it.

## Testing
`tests/ai.test.js` (8 tests) asserts: `chooseAction` always returns a legal move
across full self-played games; it resolves pending tickets legally; it claims a
ticket-completing route when one exists and prefers it over an unrelated big
route; and it is deterministic. A stress run of 180 games (2–5 players × 60
seeds) completes every game with zero illegal actions. See [[testing]].
