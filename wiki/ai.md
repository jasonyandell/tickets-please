# AI

> **Status: stub.** Filled in when the bot is built (phase 4). See [[workflows]].

Computer opponents implement `chooseAction(state, playerId) -> Action` in
`src/ai/ai.js`, always returning a move from `legalMoves` (see [[engine-api]]).
The heuristic (to be documented): pursue routes that advance unfinished
destination tickets, draw toward the most useful color otherwise, and draw new
tickets when the hand is flush. Because the engine is [[determinism|deterministic]]
and pure, the AI can evaluate candidate moves on cloned state.
