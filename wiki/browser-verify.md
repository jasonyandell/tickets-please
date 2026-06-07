# browser-verify (skill)

A self-improving project skill that proves the browser UI actually renders and is
interactive, rather than trusting "it looks done in the code." Lives at
`.claude/skills/browser-verify/` (`SKILL.md` + `log.md`). Methodology: the
verification-loop-as-a-skill pattern from Sid Bidasaria's "Stop babysitting your
agents" talk (sourced in the gomoku project) — package a verify loop as a skill,
and have the skill **document and improve itself** every time it hits a blocker.

## What it does
`npm run test:e2e` (Playwright, **dev-only** — the shipped game stays
zero-dependency) builds the site, serves the built `dist/`, loads it in real
Chromium, and asserts FACTS through the **Observable State Contract** rather than
inspecting the canvas:
- zero app errors (page errors / non-favicon HTTP failures),
- the app reaches each expected screen (`window.__APP__.screen`),
- a scripted play-through advances real structured state — `lastAction`, hand
  counts, route ownership, standings — read from `window.__APP__.viewModel` and
  stable `[data-testid]` / `button[data-action]` hooks,
- the board genuinely painted, via the **single** smoke flag
  `canvas.dataset.painted === "true"` (the only canvas check anywhere),
- and it saves `artifacts/board.png` as human-checkable evidence.

> **Canvas color / pixel sampling is banned.** The original check sampled the
> canvas for "hundreds of distinct colors"; it was flaky and slow, and a green
> sample with a wrong picture proves nothing. It was replaced mid-stream by the
> deterministic, contract-based play-throughs above — see [[testing]] and [[log]]
> (2026-06-06).

## Why it exists
A null DOM ref or a 404 at load blanks the whole page, and **no Node unit test
catches it**. browser-verify is the forcing function that makes "I thought it
worked" impossible: green assertions on real, structured state PLUS a screenshot
you actually look at. It found three real bugs on its first outing (canvas id
mismatch; serving raw `src/` so assets 404'd; an over-strict favicon check) — see
[[ui]] and `wiki/log.md` (2026-05-30 render-bug entry).

## The self-improvement contract
`SKILL.md` is read before each run and **edited after** it: every new failure
mode, every too-weak assertion (a green run with a bad screenshot), every
environment gotcha gets written back into the skill + a dated `log.md` entry,
*log failures loudest*. It also carries an **integrity rule** — record only what
you observed, never a prediction — added the hard way (see the verify-before-commit memory).

This is the first instance of the broader goal: teach → extract a skill →
validate → self-improve → measure. See [[testing]] and [[workflows]].
