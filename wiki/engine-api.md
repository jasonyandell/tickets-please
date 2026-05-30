# Engine API

The companion to `CONTRACT.md` (authoritative). The engine is a **pure
deterministic reducer**: `applyAction(state, action) -> state`. See
[[architecture]] and [[determinism]].

## State (abridged — full shape in `CONTRACT.md` §3)
```
state = {
  seed, players[], deck[], discard[], faceUp[5],
  ticketDeck[], ticketDiscard[], routeOwner{routeId: playerId},
  current, phase: 'play'|'finalRound'|'ended',
  finalTurnsLeft, pending, cardsDrawnThisTurn, moveCount, log[], winner
}
player = { id, name, isAI, hand{color:count}, trains, tickets[], claimedRoutes[], score }
```

## Actions (`src/engine/actions.js`)
| Action | Meaning |
|---|---|
| `DRAW_FACEUP {slot}` | take a face-up card (wild ⇒ whole turn) |
| `DRAW_DECK` | draw blind from the deck |
| `CLAIM_ROUTE {routeId, spend{color:count}}` | claim a route, spending cards |
| `DRAW_TICKETS` | draw 3 tickets ⇒ sets `state.pending` |
| `KEEP_TICKETS {keep[]}` | resolve the pending ticket choice |

## Key functions
- `initGame({map, tickets, playerConfigs, seed})` — `src/engine/state.js`.
- `legalMoves(state) -> Action[]` — `src/engine/rules.js`.
- `canClaimRoute(state, playerId, routeId, spend) -> {ok, reason?}` — `rules.js`.
- `applyAction(state, action) -> state` — `src/engine/game.js`; throws on illegal.
- `applyActions(state, actions[])` — fold helper.
- `finalScores(state)` — `src/engine/scoring.js`; see [[scoring]].

## Turn flow
A turn is exactly one of: draw cards (1–2), claim a route, or draw tickets. The
reducer tracks `cardsDrawnThisTurn`, ends the turn, advances `current`, and —
when a player drops to ≤ 2 trains — starts the final round and counts it down to
`phase:'ended'`.

See [[testing]] for the invariants this API guarantees.
