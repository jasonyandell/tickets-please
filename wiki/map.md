# Map

The game board is an **original** route network over real United States cities
(geography is fact; the route graph is our own — see [[design-decisions]]). Data
lives in `src/engine/map.js` as `MAP` and `TICKETS`, in the format specified by
`CONTRACT.md` §2 and validated by `tools/validate-map.js` (`npm run validate`).

## At a glance
- **38 cities**, coordinates tuned for a 1200×760 board, roughly matching US
  geography (Seattle top-left → Miami bottom-right).
- **76 routes**, one fully-connected graph spanning PNW, California, the mountain
  west, plains, Texas/Gulf, the Mississippi/Southeast, Great Lakes, Appalachia,
  and the Northeast.
- **9 double-route pairs** (parallel edges between the same two cities; both
  members flagged `parallel: true`). In 2–3 player games only one of a pair may
  be claimed — enforced by `rules.js:canClaimRoute`. See [[game-rules]].
- **37 destination tickets**, 5–22 points scaled to graph distance.

## Distributions
- **Route color:** gray 36 (≈half), red 6, orange 6, green 5, blue 5, purple 5,
  yellow 5, white 4, black 4. All 8 train colors are used.
- **Route length:** len-1 ×11, len-2 ×32, len-3 ×19, len-4 ×12, len-5 ×2. (No
  len-6 on the real board, though the engine and `ROUTE_POINTS` support it.)
- **Tickets:** 12 short (5–9 pts), 17 medium (10–15), 8 long transcontinental
  (18–22). Marquee tickets include Seattle↔Miami (22), San Francisco↔Boston (22),
  San Francisco↔New York (21), Los Angeles↔New York (21).

## Notes
- Miami (`mia`) has degree 1 (only Jacksonville connects) — intentional, matching
  its peninsula geography. Still connected; all Miami tickets route through
  Jacksonville.
- Every ticket's endpoints are verified connected in the graph by the validator,
  so every ticket is achievable.

See [[game-rules]] for how routes and tickets are used in play, [[scoring]] for
points, and [[ui]] for how the board is drawn (`x,y` are canvas coordinates).
