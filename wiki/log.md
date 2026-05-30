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
