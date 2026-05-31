# tickets-please — Wiki Index

The catalog of all wiki pages. See [[CLAUDE]] for how this wiki is maintained,
and [[log]] for the chronological build record.

> **tickets-please** is a free, open-source, **public-domain** railway route game
> in the lineage of *Ticket to Ride*. Zero dependencies; pure ES-module engine
> that runs in Node and the browser. Built as a live demonstration of
> workflow-orchestrated development.

## Overview
- [[overview]] — what the game is, project goals, status.
- [[design-decisions]] — why vanilla JS, public domain, deterministic reducer.

## Rules & design
- [[game-rules]] — the rules of play (turns, claiming, scoring, end game).
- [[scoring]] — exact point values and the longest-path bonus.
- [[map]] — the United States map: cities, routes, destination tickets.

> **▶ Play it live:** https://tickets-please.jasonyandell.workers.dev — see [[deployment]].

## Engineering
- [[architecture]] — module map and data flow.
- [[deployment]] — Cloudflare Workers hosting + GitHub Actions CI/CD.
- [[engine-api]] — the reducer, state shape, actions (mirrors `CONTRACT.md`).
- [[determinism]] — the seeded RNG and why the engine is reproducible.
- [[ai]] — how the computer opponents choose moves.
- [[ui]] — the canvas renderer and interaction model.
- [[testing]] — how correctness is guaranteed; how to run the suite.

## Process
- [[workflows]] — how this project was (and is) built with agent orchestration.
- [[glossary]] — terms used across the codebase and wiki.
