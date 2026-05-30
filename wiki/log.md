# Build Log

Append-only chronological record of ingests, queries, and lints. Newest at the
bottom. See [[CLAUDE]] for what each entry type means.

---

### 2026-05-30 — Project genesis (ingest)
- Created the project: scaffolding, `package.json` (`type: module`, zero deps),
  **Unlicense** (public domain), `.gitignore`. Git initialized.
- Authored the deterministic foundation: `src/engine/rng.js` (mulberry32),
  `constants.js` (card/deck/scoring numbers), `state.js` (state shape + initial
  deal), `actions.js` (action tags), `graph.js` (connectivity + longest trail).
- Wrote `CONTRACT.md`, the authoritative engine API spec.
- Smoke-tested: deck builds to 110 cards (12×8 colors + 14 wilds); graph
  helpers return expected results.
- Seeded the wiki: [[index]], [[CLAUDE]], [[overview]], [[architecture]],
  [[game-rules]], [[engine-api]], plus stubs for [[map]], [[ai]], [[ui]],
  [[testing]], [[scoring]], [[determinism]], [[design-decisions]], [[workflows]],
  [[glossary]].
- Added `README.md`, `tools/validate-map.js`, `tools/serve.js`.
- **Commit `cd0d213`** — "Foundation: engine primitives, contract, first-class wiki".

### 2026-05-30 — Engine build workflow launched (ingest)
- Launched the contract-first fan-out (see [[workflows]] phase 2–3): one workflow
  building, in parallel, the US [[map]] (validator-gated) + `scoring.js` +
  `rules.js`, then the `game.js` orchestrator that depends on them. Each module
  ships with a `node:test` suite the agent must drive to green.
- Awaiting results before verifying integration and building the [[ai]]/[[ui]].
