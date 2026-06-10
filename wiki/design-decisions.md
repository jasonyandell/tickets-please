# Design Decisions

Why the project is built the way it is. See [[architecture]] and [[overview]].

## Vanilla JS, zero dependencies
Runs by opening a file or with bare Node ≥ 20. Nothing to install, nothing to go
stale, and the smallest possible attack/maintenance surface. `node:test` (built
in) covers [[testing]] with no test framework.

## Public domain (Unlicense)
The user asked for "free and open source and entirely public domain." The
**Unlicense** dedicates the work to the public domain outright — anyone may copy,
modify, sell, or relicense with no conditions. See `LICENSE`.

## Original map, not the real one
*Ticket to Ride* is a trademark of Days of Wonder, and the published board's exact
route graph is a creative work. **Game rules are not copyrightable**, so this is a
faithful rules implementation over an **original** route network on real US
cities (geography is fact). See [[map]] and [[game-rules]].

## Pure deterministic reducer
Game logic is `applyAction(state, action) -> state` with no I/O. This buys
testability, replays, and look-ahead AI for free. See [[determinism]].

## Engine / AI / UI split
One-way data flow (clients emit actions, engine reduces, UI renders) keeps each
part independently testable and replaceable. See [[architecture]].

## SVG substrate — structure, not pixels
The board is a **pure SVG projection of the view-model**: every route is a
`g[data-route-id]`, every city a `g[data-city-id]`, and all appearance lives in
CSS design tokens + data-attribute selectors. Game state rides on `data-*`
attributes; the renderer only flips attributes, never re-creates elements.
This buys: (1) CSS-driven theming with zero JS changes, (2) e2e structural
assertions on real DOM nodes (no pixel sampling, no hit-testing geometry), and
(3) a fixed viewBox that scales to any screen without `resize()`/`dpr` code —
eliminating the hidden-canvas blank-board race entirely. **Screenshots are for
human taste, never gates.**

## Dim with saturation, never blank the heat-map
When the board needs to recede (AI turns), it desaturates
(`#map[data-turn="ai"] .routes-layer { filter: saturate(0.8) }`) — **never**
drops opacity. The human's teal ticket heat-map is the "where to build" plan
and must stay readable at all times; an opacity dim would blank it exactly when
the human is watching the AI move (the common 1-human-vs-AI case). Same
principle as the Batch-9 viewer rule: the human's own map never blanks. The
flag→treatment policy itself is pure and unit-tested
(`src/ui/render.js:routeLevel`). See [[ui]].

## Built with workflows
Per the brief, much of the implementation is produced by orchestrated agents
working against `CONTRACT.md`, then adversarially verified. See [[workflows]].
