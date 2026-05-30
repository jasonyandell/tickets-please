# Workflows — how this was built

`tickets-please` is, in part, a demonstration of building software with
**orchestrated agents** (the Claude Code `Workflow` tool). This page records the
orchestration so the process is reproducible. See [[architecture]] for the result.

## Strategy: contract-first fan-out
The risk with parallel agents is incoherence. We avoid it by writing
`CONTRACT.md` — the authoritative API — **first**, by hand. Every agent then
implements against the same fixed contract and tests against `node:test`, so the
pieces compose.

## Phases
1. **Foundation (inline, by hand).** RNG, constants, state shape, actions, graph
   helpers, the contract, and this wiki seed. The coherence-critical core.
2. **Map (agent + validation).** One agent authors the US map; `tools/validate-map.js`
   enforces the invariants in `CONTRACT.md` §2. The agent iterates until valid.
3. **Engine implementation (pipeline).** `rules.js`, `scoring.js`, `game.js` —
   each implemented, then its `node:test` suite written and run, as a pipeline so
   a finished module starts testing while others are still being written.
4. **Clients (parallel).** The [[ai]] bot and the [[ui]] canvas renderer.
5. **Adversarial correctness review.** Multiple reviewers check the rules against
   the official game ("make no mistakes"); findings are verified, then fixed.
6. **Wiki maintenance (every phase).** Pages and [[log]] are updated as the
   first-class artifact they are — see [[CLAUDE]].

## Why pipeline over a barrier
Stages run per-item without a barrier: the moment `scoring.js` is written its
tests run, even if `rules.js` is still in progress. Wall-clock ≈ the slowest
single chain, not the sum of stages.
