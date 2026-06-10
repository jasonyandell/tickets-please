# UI

A zero-dependency, browser-native UI: **SVG/DOM** + ES modules, no framework.
The shipped game has no runtime dependencies. Launch with `npm run serve` — it
builds the static site into `dist/` (via `tools/build.js`) and serves *that*, so
local play, the [[browser-verify|e2e suite]], and production ([[deployment]]) all
exercise the identical artifact. See [[architecture]] for how it relates to the
engine.

## Screen architecture
The page is no longer one always-on pane. `app.js` is a tiny **screen router**
over `<section data-screen>` elements — one per screen
(`menu | setup | game | gameover`); exactly one is `.active` (shown) at a time.
`main.js` is a thin controller that shows the right screen and rebuilds it.

`app.js` also OWNS the **Observable State Contract**:
`window.__APP__ = { screen, viewModel, lastAction }` — the read-only snapshot the
[[testing|e2e suite]] reads instead of sampling pixels (see [[browser-verify]]).

```
              ┌──────── app.js (router) ───────┐
   window.__APP__ = { screen, viewModel, lastAction }
              menu · setup · GAME · gameover
                                  │
                 ┌────────────────┴────────────────┐
            game/board.js (SVG)            game/panel.js (HUD)
            hover/claim + #map               prompt · actions · standings
```

## Files (`src/ui/`)
- `viewModel.js` — **the keystone: a PURE derivation layer.** `buildViewModel`
  turns raw engine state into a plain, render-ready object — no DOM, no globals,
  no side effects, fully unit-testable and deterministic. It calls the pure
  engine derivations (`rules.legalMoves` / `canonicalSpend` / `canClaimRoute`,
  `scoring.ticketComplete` / `longestPath`) to answer "what's legal / affordable
  / complete right now?" and **owns hotseat privacy masking** (opponents are
  reduced to counts only). Both the UI and the e2e suite read this object.
  Imports pure geometry accessors from `geometry.js` (city/route accessors).
- `app.js` — the screen router + the `window.__APP__` contract surface.
- `screens/menu.js` — landing screen: branding, **Play**, and a How-to-play
  panel that teaches the full ruleset (starting-ticket selection, the turn
  choice, final round, +10 longest path).
- `screens/setup.js` — game setup: player count (2–5), per-slot name +
  **Human/AI** + color swatch, an optional advanced seed, then Start. Hands a
  plain config object back to the controller.
- `screens/gameover.js` — the **endgame scoreboard**: a per-player breakdown
  table (`Routes + Tickets + Longest = Total`, highest first), winner/tie line,
  and New Game / Menu buttons. Pure DOM from `vm.scoreboard` + `vm.winnerIndex`.
- `screens/passdevice.js` — the hotseat **pass-the-device** interstitial: a
  full-screen opaque overlay shown between two consecutive *human* turns so the
  incoming player can't glimpse the previous hand. Intentionally NOT a router
  screen — the game stays mounted beneath it (no resize/repaint race).
- `game/panel.js` — the in-game side **HUD**, a pure view over the published
  view-model: the turn banner + next-step prompt, the action bar (each button
  disabled-with-reason) including **↶ Undo / ↷ Redo** (gated by
  `vm.canUndo`/`vm.canRedo`, self-explaining when there's nothing to undo/redo),
  the ticket-keep checklist, **live standings**, the face-up row (wilds render as
  the multicolor rainbow chip, and lock during the 2nd-card draw), per-player
  blocks (privacy-masked, wild hand-pips also rainbow), and the log. There is no
  card-color legend — colors are self-evident on the cards, so the panel dropped
  it for space.
- `game/board.js` — SVG **interaction + route-clarity** layer: hover (or tap)
  any route and a tooltip near the cursor shows its cost, whether you can claim
  it, and — when you can't — exactly why. Routes are real DOM elements
  (`g[data-route-id]`), so "which route is under the cursor" is plain
  `event.target.closest()` — the old canvas hit-testing (transform inversion +
  point-in-polygon) is gone entirely. Reads `vm.routes` + live DOM geometry;
  exposes `window.__BOARD__` (a separate inspection surface) for the e2e suite.
  Claiming a route is still applied by `main.js`.
- `main.js` — the thin controller: wires the engine + [[ai]] + renderer, owns
  the engine `state`, builds & publishes the view-model each render, routes
  between screens, records `lastAction`, drives AI turns on a timer, gates the
  pass-the-device handoff, and owns the `history.js` **undo/redo recorder** —
  recording every applied action onto its tape and binding Undo/Redo (buttons +
  Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z) to the recorder's playhead. It also persists the
  game after every applied action and restores it on boot (see *Persistence*),
  and exposes the **⟳ Reload** button (`doReload`).
- `render.js` — the **SVG/DOM renderer**: builds the board skeleton once per
  `(svg, map)` — every route is a `g.route[data-route-id]` element, every city
  is a `g.city[data-city-id]` element — then on each render pass mirrors the
  view-model onto `data-*` attributes only (no element re-creation). Appearance
  is entirely **CSS-token-driven**: design tokens in `style.css` (`:root`) +
  data-attribute selectors (`[data-color]`, `[data-claimed]`, `[data-level]`,
  `[data-ticket-weight]`) determine every color and opacity. The board uses a
  **fixed viewBox 1200×760** — no `resize()`, no `devicePixelRatio` code
  anywhere; CSS scales the SVG to any screen for free, eliminating the
  hidden-canvas blank-board race of the old canvas era. See *Board details*
  below for V1/V2 features. Anim drivers mutate CSS custom properties
  (`--pop-scale`, `--pop-flash`, `--pulse`) on route groups; `style.css` turns
  those into transforms/opacity. Sets `svg.dataset.painted = "true"` after a
  real render (the Observable State Contract smoke flag).
- `geometry.js` — **pure, testable geometry**: successor to `layout.js`. Computes
  car-slot rectangles (`routeSegments`), the perpendicular-offset single source
  (`parallelOffset` — used by both slots and the track line so they always agree),
  the continuous track line (`routeLine`), the convex-hull landmass
  (`convexHull`), the viewport transform (`fitTransform`/`applyTransform`), and
  all defensive map accessors (`getCities`/`getRoutes`/`cityId`/`routeId`/…). No
  DOM; no hit-testing (clicks land on real SVG nodes). Fully unit-testable under
  Node (tests/geometry.test.js, 19 tests).
- `anim.js` — the **verification-first animation kit** (see *How we test
  animations* below): a PURE, timer-free frame model (`frame`/`pulse`/`popParams`
  for the claimed-route pop; `pulseCenter`/`bump`/`pulseIntensityAt` for the
  traveling ticket pulse) plus two isolated rAF drivers (`createPopAnimator`,
  `createLoopAnimator`) whose clock/raf are injectable. Touches no DOM; import-safe
  in Node and the browser. `isInstantMode()` collapses all motion to its final
  state under `?test` / `window.__INSTANT_ANIM__` / `prefers-reduced-motion`.
- `persist.js` — **save/restore the game across a reload** (see *Persistence*
  below). Pure + dependency-injected: serializes the *recipe* (seed +
  playerConfigs + the recorded action tape + cursor), not engine state, and
  restores by pure **replay** — the very same model as `history.js`.
- `history.js` — **undo/redo as a recorder/player over the engine** (see the
  *Undo/redo* section below). Pure: it owns an
  append-only action **tape** + a **cursor** and computes state by *replaying*
  the tape prefix through the engine reducer. No DOM, timers, or globals; the
  reducer is injected, so it unit-tests directly.
- `style.css` — layout, design tokens, and the board visual theme. CSS custom
  properties (`:root`) drive every color the board and panel render: card colors
  (`--card-*`), owner colors (`--owner-color` set inline per route), ticket-weight
  halo (`--ticket-weight-*`), animation properties (`--pop-scale`, `--pop-flash`,
  `--pulse`), and the transit-theme water/landmass tokens. The **wild /
  locomotive** card is a distinctive multicolor **rainbow chip** (`.card.wild`,
  `.pip.wild`), never a flat gray — so it always reads as "any color".

## Board details (V0 → V1 → V2)

### V0 — SVG substrate (Overhaul V0, 2026-06-10)
The canvas renderer was replaced by a pure SVG projection. Every route, car
slot, and city is a **real DOM element**:
- `g.route[data-route-id]` — one per route in the view-model. Game state rides
  on `data-claimed`, `data-owner`, `data-level` (`claimable | affordable |
  none`), and `data-ticket-weight`; appearance is entirely CSS-driven.
- `g.city[data-city-id]` — one per city.
- The board's fixed internal coordinate system is **viewBox 1200×760**; CSS
  scales the SVG to any screen. There is no `resize()`, no `devicePixelRatio`
  code, and no hidden-element sizing race anywhere.
- `board.js` interaction uses `event.target.closest('[data-route-id]')` — the
  old point-in-polygon hit-testing and inverse transforms are gone.

### V1 — Continuous track lines (Overhaul V1, 2026-06-10)
Each route now has a **`<line class="track">`** drawn city-to-city under the car
slots, sharing the same perpendicular offset (`parallelOffset()` — single source
used by both `routeLine` and `routeSegments` so they always agree). A claimed
route's rail takes the owner's color (`--owner-color`), so an owned network reads
as one connected line of rail instead of floating disconnected slots.

### V2 — Transit theme (Overhaul V2, 2026-06-10)
The board reads as a metro map:
- **Water vignette**: a radial gradient (`#map-vignette`) fills the board
  background using `--map-water` CSS tokens; letterbox bars match so the viewBox
  edge disappears.
- **Landmass**: `convexHull(cities)` inflated + rounded by a fat same-color
  stroke (`path.landmass`) — derived from the map itself, no geography assets.
  Water shows around it; it grounds any map without pretending to be an accurate
  coastline.
- **Metro station dots**: city markers are now **ringed white discs** (`circle.dot`)
  — the transit-map interchange idiom. Replaced the skyline glyphs.
- **Label chips**: city names sit on a rounded plate (`rect.label-plate`) beside
  the dot, clearing it cleanly.
- Cooler track/grid tones, removed the now-unused `--city-window` token.

> **Known deferred issue (battery-only nit):** the pulse rAF driver does not
> stop when the player navigates to the menu mid-game. It will stop on a fresh
> game start. Deliberate deferral; no correctness or test impact.

## The guided turn loop
The UI's job is **legibility** — at every moment the player can tell whose turn
it is, what to do next, and *why* an action is or isn't available:
- **Prompt** (`[data-testid="prompt"]`) — a plain-language next step derived in
  `viewModel.js` (e.g. *"Alice: draw cards, claim a route, or draw tickets"*,
  with a `— FINAL ROUND (N turns left)` tag when the last lap begins).
- **Self-explaining disabled actions** — a blocked button carries both
  `disabled` and a `data-reason`/`title` ("Finish drawing your 2nd card first",
  "Waiting for Bob to play…"), so the *why* lives in the HUD, not the log.
- **Explicit 2nd-card step** — after one draw the prompt asks for the 2nd card;
  ticket draws and route claims stay locked, and a face-up **wild can't** be
  taken as the 2nd card (the slot is visibly locked).
- **Ticket-keep** — a checklist that enforces `minKeep` (≥2 of 3 at the start,
  ≥1 of 3 mid-game) before the Keep button enables, with a live "keep N more"
  helper.

## Board route clarity
Hovering a route surfaces its **cost**, **claimability**, and the blocked
**reason** inline near the cursor — a player never has to read the log to learn
why a route is unavailable. The tooltip distinguishes *claimable* (legal now,
click to claim) from merely *affordable* (you hold the cards but a phase/rule
blocks it). A blocked click pins the reason briefly. Claiming itself is still
applied by `main.js`'s click handler.

### Weighted ticket heat-map (always on)
Orthogonal to claimability, the board is always a **"where to build first" map**.
`viewModel.js` derives `ticketRouteWeights` (`ticketRouteWeights(state, player,
map, routeOwner)` → `{ routeId: count }`): for each of the viewer's
**incomplete** destination tickets, it shortest-paths from end to end over a
graph where *owned* routes are free connectors (weight 0), *unclaimed* routes
cost their length, and *opponents'* routes are impassable — then counts how many
tickets' paths cross each route. The `data-ticket-weight` attribute on each
`g.route` drives a **bold, weight-graded teal outline** in CSS whose width +
opacity scale with the weight (capped at 4), so a route serving two tickets at
once reads hotter than one. Completed tickets contribute nothing. This
*supersedes* the earlier flat ticket-route highlight: overlap now reads as
intensity, not on/off.

**Who the heat-map shows (Batch 9 — stays lit during AI turns).** The "viewer"
is decoupled from strict turn-gating so the human's own map doesn't blank out
while the AI is moving — the common 1-human-vs-AI case, where the AI takes most
of the turns you watch (`ticketViewerIndex` in `viewModel.js`):
- **1 human total** → that human is *always* the viewer, even on an AI turn, with
  a bold teal outline that stays lit so the human keeps reading their own plan.
- **2+ humans (hotseat)** → scoped to the *active* human only; on an AI turn the
  viewer is `null`, so one human's tickets never leak to another (human→human
  handoffs are gated by the pass-device overlay).
- **game over** → no heat-map (nothing left to build).

It's **privacy-safe**: it only ever shows the *human viewer's own* tickets — never
the AI's, never another human's (unit-tested: empty whenever no viewer is set).

### Traveling ticket pulse (Batch 10)
On top of the static heat-map, a bright **`_-*-_` pulse glides source→dest** along
each of the viewer's ticket paths at **constant velocity**, looping when it reaches
the end — so a longer path takes proportionally longer to traverse. The motion is
a pure function of time: `viewModel.js:ticketOrderedPaths` (`vm.ticketPaths`)
gives each path's routes **oriented source→dest** (same Dijkstra as the weights),
and `anim.js`'s `pulseCenter`/`bump`/`pulseIntensityAt` light each
point by its wrap-aware distance to the moving center. The driver sets `--pulse`
on each route's CSS custom property; `style.css` turns that into opacity on the
`car-wash` overlay. It's **static in reduced-motion / test** (`isInstantMode`) —
the durable read is the static heat-map, so the gate never depends on motion —
and privacy-scoped identically to the heat-map (a pulse never traces a hidden
opponent ticket).

A claimed route takes `--owner-color` on its track line and car slots, and is
stamped with a small **owner mark** — a light disc ringed in the owner's color
bearing their initial (`.owner-mark`) — so ownership is legible even where two
players' colors are close.

## Undo/redo: the recorder/player model
Undo/redo is a **video recorder over the deterministic engine** (`history.js`),
not a stack of inverse deltas. The model is a **tape + playhead**:
- The seed + an append-only **tape** of applied actions fully determine the game,
  so *the tape is the game*. The **cursor** is the playhead — how many tape
  entries are currently applied.
- The shown state is always a pure **replay** of `entries[0..cursor]` through the
  engine reducer (`applyActions`). Undo/redo never mutate state to reverse a move;
  they only move the cursor and recompute. This leans directly on
  [[determinism]] — same prefix ⇒ same state, every time, with no timers.
- Undo/redo operate on **human decision points**: undo rewinds *past* any AI
  actions to the previous human action (so the table lands waiting on that human
  and the AI never auto-replays); redo fast-forwards to the next human action (or
  the tape's end). Each entry carries an `isAI` flag that drives this skip.
- Recording a new action while the cursor sits before the end **branches**: the
  tape is truncated at the cursor and the new action appended — a genuine do-over.

The module is pure (log + cursor, reducer injected) so it unit-tests without a
browser; `main.js` owns the recorder instance and wires the buttons + keyboard.

## Persistence & reload (Batch 5)
The game survives a page reload. Because the engine is [[determinism|deterministic]],
the **save is the recipe, not a snapshot** — exactly the undo/redo
insight reused: `persist.js` serializes `{ seed, playerConfigs, actions[], cursor }`
to `localStorage` (key `tickets-please/save/v1`) and **restores by pure replay**
of the action tape through the engine reducer (`restoreGame` rebuilds a
`history.js` recorder). `main.js` saves after *every* applied action, so the save
is always current; on boot it restores the exact position, falling back to a fresh
game on a missing/corrupt/foreign save (deserialize never throws). A **⟳ Reload**
button (`doReload` → `location.reload()`) restores to this same point. **New Game**
overwrites the save so a later reload restores the new game, not the old one. See
[[deployment]] for the `_headers` cache policy that makes a reload pick up new code.

## How we test animations (the anim.js recipe)
`anim.js` establishes a flake-free pattern, mirrored by `tests/anim.test.js`:
1. **A pure frame model.** All motion is a function of an `elapsed` number —
   `frame`/`pulse`/`popParams` (route-claim pop) and `pulseCenter`/`bump`/
   `pulseIntensityAt` (traveling pulse) — no timers, no globals, no DOM. Unit-test
   the maths directly (endpoints, midpoint/peak, monotonicity, clamping, wrap).
2. **Isolated rAF drivers.** `createPopAnimator` (transient pops) and
   `createLoopAnimator` (the continuous pulse) are the *only* places that read a
   clock, use `requestAnimationFrame` only (never `setTimeout`), and take an
   **injectable clock + raf** — so their bookkeeping is unit-tested with a fake
   clock and a `.tick()` hook, NO real timers.
3. **Instant mode.** Under `?test` / `window.__INSTANT_ANIM__` / reduced-motion,
   `isInstantMode()` resolves motion to its final state and no frame is scheduled,
   so e2e (and a11y) reach the settled visual with **zero timing coupling** — the
   test asserts a durable fact (pop count incremented, `data-animating` back to
   `false`, static heat-map present), not a sleep. See `e2e/anim.spec.js`.

## Hotseat privacy
Multiple humans share one device, so secrets must not leak. The view-model
exposes only the **active human's own** hand colors + ticket details; every other
player shows **counts only** (`handByColor`/`tickets` are `null`). Between two
consecutive human turns the **pass-the-device** interstitial hides the board
until the incoming player taps Ready. On game over everything is revealed.

## Data flow
One-way (see [[architecture]]): the controller holds engine `state` →
`buildViewModel` derives a pure view-model → it's published to
`window.__APP__.viewModel` → `panel.js` and `board.js` render *only* from it.
Input becomes [[engine-api|actions]] → the pure reducer returns new state →
the view-model is rebuilt. All rules logic stays in the engine.

## Testing
Pure unit tests are the primary gate (see [[testing]]):
- `tests/viewModel.test.js` (37) — the **pure derivation**: actions/claimability,
  hotseat masking, standings/longest-route, scoreboard, the weighted ticket
  heat-map (overlap accumulates; lit for the lone human even on an AI turn; null
  for the inactive hotseat human), the ordered source→dest ticket paths, no
  mutation, JSON round-trip.
- `tests/geometry.test.js` (19) — the **pure geometry** (`geometry.js`): slot
  counts/placement, double-route offsets (symmetric; slots provably on the track
  line), `routeLine` endpoints at cities, `convexHull` (every city inside;
  deterministic + degenerate-safe). Replaces the old `layout.test.js` (11 tests).
- `tests/history.test.js` (9) — the **undo/redo recorder**: replay-of-prefix,
  undo skips AI to the previous human action, redo, and branch-on-new-action.
- `tests/anim.test.js` (22) — the **pure frame model** (frame/pulse/pop +
  traveling-pulse maths: endpoints, peak, monotonic, clamp, wrap-around) and both rAF
  **drivers** under a fake clock + no-op raf
  (`createPopAnimator` start/retarget/cancel/settle; `createLoopAnimator`
  start/stop/idempotent) with NO real timers. The pattern is documented above
  ("How we test animations"). See [[testing]].
- `tests/persist.test.js` (6) — **serialize/deserialize** (recipe round-trip,
  reject corrupt/foreign/old-version saves without throwing) and **restore-by-replay**.

Real-browser behaviour is proven by the **contract-based** e2e suite
(`npm run test:e2e`, Playwright, dev-only) — it drives scripted play-throughs and
asserts structured state via `window.__APP__` + `data-testid` hooks. The SVG
substrate enables structural assertions: one `g[data-route-id]` per view-model
route, `.city[data-city-id]` count === `#map dataset.cities`, a claim flips
`data-claimed`/`data-owner` on the live DOM node. **Canvas color/pixel sampling
is banned** (flaky + slow). See [[browser-verify]].
