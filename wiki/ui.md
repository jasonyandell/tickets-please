# UI

A zero-dependency, browser-native UI: HTML5 **Canvas** + ES modules, no build
step. Launch with `npm run serve` (then open the printed URL) or open
`src/ui/index.html` directly. See [[architecture]] for how it relates to the
engine.

## Files (`src/ui/`)
- `index.html` — the page: a `<canvas>` board plus a side panel (current player,
  hands as colored pips, the face-up row, scores, each player's tickets with
  done/not-done, a log, and buttons: Draw Deck, Draw Tickets, New Game with a
  2–5 player-count selector and human/AI toggles).
- `layout.js` — **pure, testable geometry**: `routeSegments(route, map)` (the
  "car" boxes for a route), `hitTestRoute(point, map, layout)`, `cityAt`, plus
  fit/transform helpers. No DOM access, so it unit-tests cleanly.
- `render.js` — draws the [[map]] onto the canvas: labeled city dots, routes as
  runs of colored boxes (one per length unit), gray routes neutral, claimed
  routes recolored to the owner, double routes as two offset parallel lines.
- `main.js` — boot + interaction: clicking a claimable route claims it via
  `canonicalSpend` + `applyAction`; clicking the deck/face-up draws; buttons for
  tickets and new game. After a human move it drives AI turns via
  [[ai]]`chooseAction` on a short timer until it's a human's turn or the game
  ends, then shows the winner.
- `style.css` — layout and the player/card color palette.

## Data flow
The UI holds the current `state`, renders it, turns input into
[[engine-api|actions]], and feeds them to the pure reducer — one-way flow (see
[[architecture]]). All rules logic stays in the engine; the UI only renders and
collects input.

## Testing
`tests/layout.test.js` (11 tests) covers the pure geometry: box counts equal
route length, hit-testing returns the right route on a segment and `null` off it,
and double routes get two distinct offset lines. The interactive canvas/click
path can't run headlessly here, so the geometry is isolated into `layout.js` and
tested directly; `main.js`/`render.js` are verified to parse. See [[testing]].
