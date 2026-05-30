// tools/simulate.js — full-game AI-vs-AI simulation harness + CLI.
//
// Usage:
//   node tools/simulate.js [games] [seed]
//
// Plays N complete games (2..5 players, player count cycles with the game index)
// AI-vs-AI to completion using game.applyAction + ai.chooseAction, then prints a
// per-game and aggregate summary (turns, final scores, winner, longest paths,
// completed tickets).
//
// Library use:
//   import { simulateGame } from './tools/simulate.js';
//   const { finalState, scores, winner, turns } = simulateGame({ playerCount, seed });
//
// The whole module is pure-ish: simulateGame performs no I/O and is fully
// deterministic in (playerCount, seed). Only the CLI section at the bottom prints.

import { MAP, TICKETS } from '../src/engine/map.js';
import { initGame } from '../src/engine/state.js';
import { applyAction } from '../src/engine/game.js';
import { legalMoves } from '../src/engine/rules.js';
import { finalScores } from '../src/engine/scoring.js';
import { chooseAction } from '../src/ai/ai.js';

/**
 * A live (non-ended) game state must ALWAYS have at least one legal move — the
 * current player can always at minimum draw a card. If a non-ended state has
 * zero legal moves the player is stranded and the game cannot progress; that is
 * an ENGINE bug (a rules/turn-flow dead-end), not a harness or AI problem.
 *
 * Build a descriptive error for such a stranded state so the failure is legible
 * (with the reproducing seed) instead of surfacing as an opaque AI throw.
 */
export function describeDeadEnd(state, playerCount, seed, step) {
  const s = state;
  const p = s.players[s.current];
  return (
    `ENGINE DEAD-END (no legal moves) — REAL ENGINE BUG, not the harness.\n` +
    `  Reproduce: simulateGame({ playerCount: ${playerCount}, seed: ${seed} }) ` +
    `strands player ${s.current} at step ${step}.\n` +
    `  phase=${s.phase} cardsDrawnThisTurn=${s.cardsDrawnThisTurn} ` +
    `pending=${JSON.stringify(s.pending)}\n` +
    `  deck=${s.deck.length} discard=${s.discard.length} ` +
    `faceUp=${JSON.stringify(s.faceUp)} ticketDeck=${s.ticketDeck.length}\n` +
    `  current player trains=${p.trains} hand=${JSON.stringify(p.hand)}\n` +
    `  Mechanism (CARD EXHAUSTION): over a long game every train-car card drifts\n` +
    `  into players' hands (here all 110 cards are held). With deck+discard empty\n` +
    `  the face-up row can no longer be refilled, so it drains to all-null. A\n` +
    `  player then draws their FIRST card off the last face-up slot\n` +
    `  (cardsDrawnThisTurn->1); the DRAW_FACEUP/DRAW_DECK handlers only end the\n` +
    `  turn at cardsDrawnThisTurn>=2 or when the DECK is empty at draw time, not\n` +
    `  when the SECOND-draw option set is empty. On the next sub-step rules.legalMoves\n` +
    `  offers no DRAW_DECK (deck+discard empty) and no DRAW_FACEUP (row all-null),\n` +
    `  and the mid-draw branch allows neither a claim nor a ticket draw, so it\n` +
    `  returns [] and the player is stranded mid-turn.`
  );
}

// A generous cap on the number of *actions* (engine steps) a single game may
// take before we consider it stuck. Each turn is at most a few actions (draw a
// card x2, or one claim, or draw+keep tickets). Even a long game across 5
// players is well under a few thousand steps; this cap is ~100x that so a
// healthy game never trips it, while a true infinite loop is caught.
export const MAX_STEPS = 200000;

/**
 * Build the map object the engine + AI consume. The engine's State never embeds
 * the map (map is always an explicit final arg), and the AI resolves offered
 * ticket ids against `map.tickets`, so we attach the ticket list to the map.
 * Pure: returns a fresh object; does not mutate MAP.
 */
export function buildMap() {
  return { ...MAP, tickets: TICKETS };
}

/** Default AI configs for `n` players (all AI). */
function aiConfigs(n) {
  const configs = [];
  for (let i = 0; i < n; i++) configs.push({ name: `AI ${i + 1}`, isAI: true });
  return configs;
}

/**
 * Play one full game to completion, AI vs AI.
 *
 * @param {object} opts
 * @param {number} opts.playerCount - 2..5
 * @param {number} opts.seed
 * @param {(step:{state:object, action:object, before:object})=>void} [opts.onStep]
 *        Optional per-step observer, invoked AFTER each action is applied with
 *        the post-action state, the action taken, and the pre-action state. Used
 *        by the property tests to assert invariants at every step.
 * @returns {{ finalState: object, scores: object[], winner: number[], turns: number, steps: number }}
 */
export function simulateGame({ playerCount, seed, onStep } = {}) {
  if (!(playerCount >= 2 && playerCount <= 5)) {
    throw new Error(`playerCount must be 2..5, got ${playerCount}`);
  }
  const map = buildMap();
  let state = initGame({
    map,
    tickets: TICKETS,
    playerConfigs: aiConfigs(playerCount),
    seed,
  });

  let steps = 0;
  let turns = 0;
  let prevCurrent = state.current;

  while (state.phase !== 'ended') {
    if (steps >= MAX_STEPS) {
      throw new Error(
        `simulateGame: exceeded MAX_STEPS (${MAX_STEPS}) without ending ` +
          `(playerCount=${playerCount}, seed=${seed}) — likely an engine/AI loop`,
      );
    }
    // A live state must always have a legal move. If not, the engine has
    // stranded the player — surface it as a clear, seeded engine-bug error
    // rather than letting chooseAction throw an opaque "no legal moves".
    if (legalMoves(state, map).length === 0) {
      throw new Error(describeDeadEnd(state, playerCount, seed, steps));
    }
    const before = state;
    const action = chooseAction(state, map);
    state = applyAction(state, action, map);
    steps++;
    if (onStep) onStep({ state, action, before });
    // A "turn" boundary is when the active player changes (or the game ends).
    if (state.current !== prevCurrent || state.phase === 'ended') {
      turns++;
      prevCurrent = state.current;
    }
  }

  const scores = finalScores(state, map);
  return { finalState: state, scores, winner: state.winner, turns, steps };
}

// ---------------------------------------------------------------------------
// CLI summary helpers
// ---------------------------------------------------------------------------

function summarizeGame(gameIndex, playerCount, seed, result) {
  const { finalState, scores, winner, turns, steps } = result;
  const lines = [];
  lines.push(
    `Game ${gameIndex}: players=${playerCount} seed=${seed} ` +
      `turns=${turns} steps=${steps} phase=${finalState.phase}`,
  );
  for (const s of scores) {
    const p = finalState.players[s.playerId];
    const win = winner.includes(s.playerId) ? ' *WIN*' : '';
    lines.push(
      `  P${s.playerId} ${p.name.padEnd(6)} total=${String(s.total).padStart(4)} ` +
        `route=${String(s.routePoints).padStart(3)} ` +
        `ticket=${String(s.ticketPoints).padStart(4)} ` +
        `longestBonus=${String(s.longestBonus).padStart(2)} ` +
        `longestPath=${String(s.longestPath).padStart(2)} ` +
        `tickets=${s.completedTickets}/${p.tickets.length} ` +
        `routes=${p.claimedRoutes.length} trains=${p.trains}${win}`,
    );
  }
  lines.push(`  Winner(s): ${winner.map((w) => `P${w}`).join(', ')}`);
  return lines.join('\n');
}

function runCli(argv) {
  const games = Number.parseInt(argv[0], 10) || 5;
  const baseSeed = Number.parseInt(argv[1], 10) || 1;

  console.log(
    `tickets-please simulation: ${games} game(s), base seed ${baseSeed}\n`,
  );

  let totalTurns = 0;
  let totalSteps = 0;
  let maxTurns = 0;
  const winsByPlayerCount = new Map();

  let completed = 0;
  for (let i = 0; i < games; i++) {
    // Cycle player count 2..5 so every game size is exercised.
    const playerCount = 2 + (i % 4);
    const seed = baseSeed + i;

    let result;
    try {
      result = simulateGame({ playerCount, seed });
    } catch (err) {
      // A dead-end (zero legal moves on a live state) is a real ENGINE bug, not
      // a harness failure. Report it loudly with the reproducing seed and exit
      // non-zero, rather than crashing with a raw stack trace.
      console.error(
        `\nGame ${i + 1} (players=${playerCount} seed=${seed}) FAILED:\n` +
          err.message,
      );
      console.error(
        `\nGames completed before failure: ${completed}/${games}. ` +
          `This indicates a REAL engine bug — see the message above.`,
      );
      process.exitCode = 1;
      return;
    }

    if (result.finalState.phase !== 'ended') {
      console.error(`Game ${i + 1} did not reach phase 'ended'`);
      process.exitCode = 1;
      return;
    }
    if (!Array.isArray(result.winner) || result.winner.length === 0) {
      console.error(`Game ${i + 1} ended with no winner`);
      process.exitCode = 1;
      return;
    }

    console.log(summarizeGame(i + 1, playerCount, seed, result));
    console.log('');

    totalTurns += result.turns;
    totalSteps += result.steps;
    if (result.turns > maxTurns) maxTurns = result.turns;
    winsByPlayerCount.set(
      playerCount,
      (winsByPlayerCount.get(playerCount) || 0) + 1,
    );
    completed++;
  }

  console.log('='.repeat(60));
  console.log(`Summary over ${games} game(s):`);
  console.log(`  avg turns/game: ${(totalTurns / games).toFixed(1)}`);
  console.log(`  avg steps/game: ${(totalSteps / games).toFixed(1)}`);
  console.log(`  max turns:      ${maxTurns}`);
  console.log(`  step cap:       ${MAX_STEPS} (never reached)`);
  console.log(`  games completed to phase=ended: ${completed}/${games}`);
}

// Run as a CLI only when invoked directly (not when imported by tests).
const isMain =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  runCli(process.argv.slice(2));
}
