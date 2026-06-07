# UI

A zero-dependency, browser-native UI: HTML5 **Canvas** + ES modules, no
framework. The shipped game has no runtime dependencies. Launch with
`npm run serve` — it builds the static site into `dist/` (via `tools/build.js`)
and serves *that*, so local play, the [[browser-verify|e2e suite]], and
production ([[deployment]]) all exercise the identical artifact. See
[[architecture]] for how it relates to the engine.

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
            game/board.js (canvas)          game/panel.js (HUD)
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
  screen — the game stays mounted beneath it (no canvas resize/repaint race).
- `game/panel.js` — the in-game side **HUD**, a pure view over the published
  view-model: the turn banner + next-step prompt, the action bar (each button
  disabled-with-reason) including **↶ Undo / ↷ Redo** (gated by
  `vm.canUndo`/`vm.canRedo`, self-explaining when there's nothing to undo/redo),
  the ticket-keep checklist, **live standings**, the face-up row (wilds render as
  the multicolor rainbow chip, and lock during the 2nd-card draw), per-player
  blocks (privacy-masked, wild hand-pips also rainbow), and the log. There is no
  card-color legend — colors are self-evident on the cards, so the panel dropped
  it for space.
- `game/board.js` — canvas **interaction + route-clarity** layer: hover (or tap)
  any route and a tooltip near the cursor shows its cost, whether you can claim
  it, and — when you can't — exactly why. Reads `vm.routes` + live geometry;
  exposes `window.__BOARD__` (a separate inspection surface) for the e2e suite.
- `main.js` — the thin controller: wires the engine + [[ai]] + renderer, owns
  the engine `state`, builds & publishes the view-model each render, routes
  between screens, records `lastAction`, drives AI turns on a timer, gates the
  pass-the-device handoff, and owns the `history.js` **undo/redo recorder** —
  recording every applied action onto its tape and binding Undo/Redo (buttons +
  Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z) to the recorder's playhead. It also persists the
  game after every applied action and restores it on boot (see *Persistence*),
  and exposes the **⟳ Reload** button (`doReload`).
- `render.js` — draws the [[map]] onto the canvas (cities as **skyline icons** —
  a three-building glyph with a white halo + lit windows, sized to fill the space
  and balance the route boxes, far more legible than a flat dot — routes as
  runs of colored boxes, claimed routes recolored to the owner + a small **owner
  token** — a light disc ringed in the owner's color bearing their initial,
  double routes as offset parallel lines). Also paints the always-on **weighted
  ticket heat-map**: routes serving the viewer's incomplete tickets get a
  **bold, weight-graded teal outline** whose width + opacity scale with
  `vm.ticketRouteWeights[id]`, so a route on two tickets' shortest paths reads
  hotter than one (`drawBox`'s `ticketWeight`), and a **traveling `_-*-_` pulse**
  that glides source→dest along each ticket path (see *Traveling ticket pulse*
  below). Asks `anim.js` for all motion params; sets the single smoke
  flag `canvas.dataset.painted`.
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
- `layout.js` — **pure, testable geometry**: route "car" boxes, `hitTestRoute`,
  fit/transform helpers. No DOM, so it unit-tests cleanly.
- `style.css` — layout and the player/card color palette. The **wild /
  locomotive** card is a distinctive multicolor **rainbow chip** (`.card.wild`,
  `.pip.wild`), never a flat gray — so it always reads as "any color".

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
applied by `main.js`'s canvas click handler.

### Weighted ticket heat-map (always on)
Orthogonal to claimability, the board is always a **"where to build first" map**.
`viewModel.js` derives `ticketRouteWeights` (`ticketRouteWeights(state, player,
map, routeOwner)` → `{ routeId: count }`): for each of the viewer's
**incomplete** destination tickets, it shortest-paths from end to end over a
graph where *owned* routes are free connectors (weight 0), *unclaimed* routes
cost their length, and *opponents'* routes are impassable — then counts how many
tickets' paths cross each route. `render.js:drawBox` paints those routes with a
**bold, weight-graded teal outline** hugging the cars whose width + opacity
**scale with the weight** (capped), so a route serving two tickets at once reads
hotter than one. Completed tickets contribute nothing. This *supersedes* the
earlier flat ticket-route highlight: overlap now reads as intensity, not on/off.

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
point by its wrap-aware distance to the moving center. `render.js:drawTicketPulses`
runs off the single continuous `createLoopAnimator` rAF driver. It's **static in
reduced-motion / test** (`isInstantMode`) — the durable read is the static
heat-map, so the gate never depends on motion — and privacy-scoped identically to
the heat-map (a pulse never traces a hidden opponent ticket).

A claimed route is recolored to its owner and stamped with a small **owner
token** — a light disc ringed in the owner's color carrying their initial — so
ownership is legible even where two players' colors are close.

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
- `tests/layout.test.js` (11) — the **pure geometry** (box counts, hit-testing,
  double routes).
- `tests/history.test.js` (9) — the **undo/redo recorder**: replay-of-prefix,
  undo skips AI to the previous human action, redo, and branch-on-new-action.
- `tests/anim.test.js` (22) — the **pure frame model** (frame/pulse/pop +
  traveling-pulse maths: endpoints, peak, monotonic, clamp, wrap) and both rAF
  **drivers** under a fake clock (start/retarget/cancel/settle; loop start/stop),
  with no real timers.
- `tests/persist.test.js` (6) — **serialize/deserialize** (recipe round-trip,
  reject corrupt/foreign/old saves without throwing) and **restore-by-replay**.

Real-browser behaviour is proven by the **contract-based** e2e suite
(`npm run test:e2e`, Playwright, dev-only) — it drives scripted play-throughs and
asserts structured state via `window.__APP__` + `data-testid` hooks, with a single
`canvas.dataset.painted` smoke flag. **Canvas color/pixel sampling is banned**
(flaky + slow). See [[browser-verify]].
