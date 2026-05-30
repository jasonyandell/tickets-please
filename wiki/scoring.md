# Scoring

Exact scoring rules. Numbers come from `src/engine/constants.js`; the logic lives
in `src/engine/scoring.js`. See [[game-rules]] for context.

## Route points (`ROUTE_POINTS`)
Claiming a route scores by its length, immediately:

| Length | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Points | 1 | 2 | 4 | 7 | 10 | 15 |

## Destination tickets
At game end, each ticket a player holds is checked with
`ticketComplete(state, playerId, ticket)`: are its two cities connected using
only routes that player owns (see `graph.js:connected`)?
- Completed ticket: **+ its points**.
- Incomplete ticket: **− its points**.

## Longest path bonus (`LONGEST_PATH_BONUS = 10`)
The player with the longest **continuous path** — the longest trail over their
owned routes, measured in total train segments (route lengths summed), where an
edge can't be reused but cities can — gets **+10**. Computed by
`scoring.js:longestPath` (exhaustive DFS via `graph.js:longestTrail`). **Ties:
every tied player gets the full +10.**

## Final score
`finalScores(state)` returns per player: `routePoints`, `ticketPoints`,
`longestBonus`, `total`, plus `completedTickets` and `longestPath` for display.
The winner(s) have the max `total` (ties allowed → `state.winner` is an array).
