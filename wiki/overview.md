# Overview

**tickets-please** is a railway route-building game for 2–5 players in the
tradition of *Ticket to Ride*. Players collect colored train-car cards, spend
them to claim routes between cities on a map of the United States, and try to
complete secret **destination tickets** that connect distant cities — all while
racing the dwindling supply of train pieces that ends the game.

It is implemented in **vanilla JavaScript with zero dependencies**, released into
the **public domain** (see `LICENSE`, the Unlicense). The game logic is a pure,
deterministic reducer (see [[determinism]]) that runs identically in Node and the
browser, which is what lets it be exhaustively tested (see [[testing]]).

## Goals

1. **Correct.** The rules are implemented faithfully and verified by tests. ("Make
   no mistakes.")
2. **Free & open.** Public domain, no dependencies, runs by opening a file.
3. **Legible.** The code reads cleanly and the [[architecture]] is small.
4. **A workflow demo.** Built largely by orchestrated agents — see [[workflows]].

## Status

Foundation complete (engine primitives, contract, wiki). Rules, scoring, game
orchestration, map, AI, and UI are built out in subsequent phases — see [[log]]
for the current state.

## How to play (once built)

Open `src/ui/index.html` in a browser (or run `npm run serve`). Pick the number
of human/AI players and play. On your turn: draw 2 train cards, claim one route,
or draw destination tickets. See [[game-rules]] for the full rules and [[ui]] for
the controls.
