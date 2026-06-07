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
  disabled-with-reason), the ticket-keep checklist, **live standings**, the
  face-up row, per-player blocks (privacy-masked), and the log.
- `game/board.js` — canvas **interaction + route-clarity** layer: hover (or tap)
  any route and a tooltip near the cursor shows its cost, whether you can claim
  it, and — when you can't — exactly why. Reads `vm.routes` + live geometry;
  exposes `window.__BOARD__` (a separate inspection surface) for the e2e suite.
- `main.js` — the thin controller: wires the engine + [[ai]] + renderer, owns
  the engine `state`, builds & publishes the view-model each render, routes
  between screens, records `lastAction`, drives AI turns on a timer, and gates
  the pass-the-device handoff.
- `render.js` — draws the [[map]] onto the canvas (labeled city dots, routes as
  runs of colored boxes, claimed routes recolored to the owner, double routes as
  offset parallel lines). Sets the single smoke flag `canvas.dataset.painted`.
- `layout.js` — **pure, testable geometry**: route "car" boxes, `hitTestRoute`,
  fit/transform helpers. No DOM, so it unit-tests cleanly.
- `style.css` — layout and the player/card color palette.

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
- `tests/viewModel.test.js` (22) — the **pure derivation**: actions/claimability,
  hotseat masking, standings/longest-route, scoreboard, no-mutation, JSON round-trip.
- `tests/layout.test.js` (11) — the **pure geometry** (box counts, hit-testing,
  double routes).

Real-browser behaviour is proven by the **contract-based** e2e suite
(`npm run test:e2e`, Playwright, dev-only) — it drives scripted play-throughs and
asserts structured state via `window.__APP__` + `data-testid` hooks, with a single
`canvas.dataset.painted` smoke flag. **Canvas color/pixel sampling is banned**
(flaky + slow). See [[browser-verify]].
