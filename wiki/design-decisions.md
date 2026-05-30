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

## Built with workflows
Per the brief, much of the implementation is produced by orchestrated agents
working against `CONTRACT.md`, then adversarially verified. See [[workflows]].
