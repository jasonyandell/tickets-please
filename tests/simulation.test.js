// tests/simulation.test.js — property-based invariant tests over full games.
//
// These play many complete AI-vs-AI games across several seeds and player counts
// and assert engine invariants AT EVERY STEP (or at game end where appropriate).
//
// A failing property here indicates a REAL engine bug, not a test that needs
// loosening. Failures report the reproducing (playerCount, seed) and the step.
//
// Tests are flat top-level `test()` declarations so node:test reports each one
// individually (pass/fail per property). Each is a pure synchronous function, so
// a violated assertion fails exactly the property it belongs to.
//
// Run: node --test tests/simulation.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  simulateGame,
  buildMap,
  MAX_STEPS,
  describeDeadEnd,
} from '../tools/simulate.js';
import { initGame } from '../src/engine/state.js';
import { applyAction } from '../src/engine/game.js';
import { legalMoves } from '../src/engine/rules.js';
import { finalScores } from '../src/engine/scoring.js';
import { chooseAction } from '../src/ai/ai.js';
import { CARD_COLORS, STARTING_TRAINS } from '../src/engine/constants.js';
import { TICKETS } from '../src/engine/map.js';

// The (playerCount, seed) matrix exercised by the suite.
const SEEDS = [1, 2, 3, 7, 11, 13, 21, 42, 99, 123];
const PLAYER_COUNTS = [2, 3, 4, 5];

const MAP = buildMap();
const TOTAL_CARDS = 110; // 8 colors * 12 + 14 wilds
const ROUTE_POINTS = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 10, 6: 15 };

// ---------------------------------------------------------------------------
// Pure invariant checkers (each throws an AssertionError with context on fail)
// ---------------------------------------------------------------------------

function countCardsInHand(hand) {
  let n = 0;
  for (const color of CARD_COLORS) n += hand[color] || 0;
  return n;
}

function scoreForLength(len) {
  return ROUTE_POINTS[len] || 0;
}

// Total train-car cards across all hands + deck + discard + faceUp == 110.
function checkCardConservation(state, ctx) {
  let total = 0;
  for (const p of state.players) total += countCardsInHand(p.hand);
  total += state.deck.length;
  total += state.discard.length;
  for (const c of state.faceUp) if (c != null) total += 1;
  assert.equal(
    total,
    TOTAL_CARDS,
    `${ctx}: card conservation broken — counted ${total}, expected ${TOTAL_CARDS}`,
  );
}

// Each player's trains == 45 - sum(lengths of claimed routes); never negative.
function checkTrainConservation(state, map, ctx) {
  for (const p of state.players) {
    let claimedLen = 0;
    for (const rid of p.claimedRoutes) {
      const route = map.routes.find((r) => r.id === rid);
      assert.ok(route, `${ctx}: player ${p.id} owns unknown route ${rid}`);
      claimedLen += route.length;
    }
    assert.equal(
      p.trains,
      STARTING_TRAINS - claimedLen,
      `${ctx}: player ${p.id} trains=${p.trains} but expected ${STARTING_TRAINS - claimedLen}`,
    );
    assert.ok(
      p.trains >= 0,
      `${ctx}: player ${p.id} has negative trains ${p.trains}`,
    );
  }
}

// running score == sum of route points of claimed routes (tickets are folded in
// only by finalScores, never into player.score during play).
function checkRunningScore(state, map, ctx) {
  for (const p of state.players) {
    let routePoints = 0;
    for (const rid of p.claimedRoutes) {
      const route = map.routes.find((r) => r.id === rid);
      if (route) routePoints += scoreForLength(route.length);
    }
    assert.equal(
      p.score,
      routePoints,
      `${ctx}: player ${p.id} score=${p.score} but route points sum=${routePoints}`,
    );
  }
}

// routeOwner agrees with each player's claimedRoutes; no route owned twice; no
// player owns both sides of a double (parallel pair).
function checkOwnership(state, map, ctx) {
  const ownerFromPlayers = new Map();
  for (const p of state.players) {
    for (const rid of p.claimedRoutes) {
      assert.ok(
        !ownerFromPlayers.has(rid),
        `${ctx}: route ${rid} claimed by multiple players`,
      );
      ownerFromPlayers.set(rid, p.id);
      assert.equal(
        state.routeOwner[rid],
        p.id,
        `${ctx}: routeOwner[${rid}]=${state.routeOwner[rid]} != claiming player ${p.id}`,
      );
    }
  }
  for (const [rid, owner] of Object.entries(state.routeOwner)) {
    assert.equal(
      ownerFromPlayers.get(rid),
      owner,
      `${ctx}: routeOwner has ${rid}->${owner} but no matching claimedRoutes`,
    );
  }

  // No player owns both siblings of a parallel pair.
  for (const route of map.routes) {
    const owner = state.routeOwner[route.id];
    if (owner == null) continue;
    for (const sib of map.routes) {
      if (sib.id === route.id) continue;
      const samePair =
        (sib.a === route.a && sib.b === route.b) ||
        (sib.a === route.b && sib.b === route.a);
      if (!samePair) continue;
      const sibOwner = state.routeOwner[sib.id];
      if (sibOwner == null) continue;
      assert.notEqual(
        sibOwner,
        owner,
        `${ctx}: player ${owner} owns both parallel siblings ${route.id} & ${sib.id}`,
      );
    }
  }
}

function sameSpend(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) if ((a[k] || 0) !== (b[k] || 0)) return false;
  return true;
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const sa = a.slice().sort();
  const sb = b.slice().sort();
  return sa.every((x, i) => x === sb[i]);
}

function sameAction(a, b) {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'DRAW_DECK':
      return true;
    case 'DRAW_FACEUP':
      return a.slot === b.slot;
    case 'CLAIM_ROUTE':
      return a.routeId === b.routeId && sameSpend(a.spend, b.spend);
    case 'DRAW_TICKETS':
      return true;
    case 'KEEP_TICKETS':
      return sameSet(a.keep, b.keep);
    case 'PASS':
      return true;
    default:
      return false;
  }
}

// The action applied was a member of legalMoves(before, map).
function checkActionWasLegal(before, action, map, ctx) {
  const legal = legalMoves(before, map);
  const match = legal.some((m) => sameAction(m, action));
  assert.ok(
    match,
    `${ctx}: applied action ${JSON.stringify(action)} was NOT in legalMoves ` +
      `(had ${legal.length} legal moves)`,
  );
}

// ---------------------------------------------------------------------------
// Per-step property runner: plays one full game, asserting on every step.
// Returns { state, step, scores } at game end (or throws on the first violated
// invariant — including an engine dead-end with zero legal moves).
// ---------------------------------------------------------------------------

function playWithInvariants(playerCount, seed) {
  const ctxBase = `pc=${playerCount} seed=${seed}`;
  const map = MAP;

  let state = initGame({
    map,
    tickets: TICKETS,
    playerConfigs: Array.from({ length: playerCount }, (_, i) => ({
      name: `AI ${i + 1}`,
      isAI: true,
    })),
    seed,
  });

  const scoreHigh = state.players.map(() => 0);

  // Initial-state invariants.
  checkCardConservation(state, `${ctxBase} step=init`);
  checkTrainConservation(state, map, `${ctxBase} step=init`);
  checkRunningScore(state, map, `${ctxBase} step=init`);
  checkOwnership(state, map, `${ctxBase} step=init`);

  let step = 0;
  while (state.phase !== 'ended') {
    assert.ok(step < MAX_STEPS, `${ctxBase}: exceeded MAX_STEPS without ending`);

    // INVARIANT: a live (non-ended) state must always offer at least one legal
    // move — the current player can at minimum draw a card. Zero legal moves on
    // a non-ended state is a rules/turn-flow dead-end (a REAL engine bug). Check
    // BEFORE asking the AI so the failure is a clean, seeded assertion instead
    // of an opaque "chooseAction: no legal moves available" throw.
    assert.ok(
      legalMoves(state, map).length > 0,
      describeDeadEnd(state, playerCount, seed, step),
    );

    const before = state;
    const action = chooseAction(before, map);
    const ctx = `${ctxBase} step=${step} action=${action.type}`;

    checkActionWasLegal(before, action, map, ctx);

    state = applyAction(before, action, map);
    step++;

    checkCardConservation(state, ctx);
    checkTrainConservation(state, map, ctx);
    checkRunningScore(state, map, ctx);
    checkOwnership(state, map, ctx);

    // Score monotonic non-decreasing during play.
    for (const p of state.players) {
      assert.ok(
        p.score >= scoreHigh[p.id],
        `${ctx}: player ${p.id} score decreased ${scoreHigh[p.id]} -> ${p.score}`,
      );
      scoreHigh[p.id] = p.score;
    }

    assert.ok(
      state.cardsDrawnThisTurn <= 2,
      `${ctx}: cardsDrawnThisTurn=${state.cardsDrawnThisTurn} > 2`,
    );
  }

  // Terminal invariants.
  assert.equal(state.phase, 'ended', `${ctxBase}: did not end`);
  assert.ok(Array.isArray(state.winner), `${ctxBase}: winner not an array`);
  assert.ok(state.winner.length >= 1, `${ctxBase}: winner array empty`);

  const scores = finalScores(state, map);
  let max = -Infinity;
  for (const s of scores) if (s.total > max) max = s.total;
  const expectedWinners = scores
    .filter((s) => s.total === max)
    .map((s) => s.playerId)
    .sort((a, b) => a - b);
  const actualWinners = state.winner.slice().sort((a, b) => a - b);
  assert.deepEqual(
    actualWinners,
    expectedWinners,
    `${ctxBase}: winner ${JSON.stringify(actualWinners)} != max-total ${JSON.stringify(expectedWinners)}`,
  );

  checkRunningScore(state, map, `${ctxBase} final`);

  return { state, step, scores };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('per-step invariants hold across many full games (all player counts, many seeds)', () => {
  let gamesPlayed = 0;
  let totalSteps = 0;
  for (const playerCount of PLAYER_COUNTS) {
    for (const seed of SEEDS) {
      const { step } = playWithInvariants(playerCount, seed);
      gamesPlayed++;
      totalSteps += step;
    }
  }
  assert.equal(gamesPlayed, PLAYER_COUNTS.length * SEEDS.length);
  assert.ok(totalSteps > gamesPlayed * 50, 'games suspiciously short');
});

test('every game terminates well under the step cap', () => {
  for (const playerCount of PLAYER_COUNTS) {
    for (const seed of SEEDS) {
      const { finalState, steps } = simulateGame({ playerCount, seed });
      assert.equal(
        finalState.phase,
        'ended',
        `pc=${playerCount} seed=${seed}: did not reach 'ended'`,
      );
      // "Well under" the cap: a healthy game is a few hundred steps; require at
      // least a 10x margin to the cap.
      assert.ok(
        steps < MAX_STEPS / 10,
        `pc=${playerCount} seed=${seed}: steps=${steps} too close to cap ${MAX_STEPS}`,
      );
    }
  }
});

test('winner(s) match the max total in finalScores; winner array non-empty', () => {
  for (const playerCount of PLAYER_COUNTS) {
    for (const seed of SEEDS) {
      const { finalState, scores, winner } = simulateGame({ playerCount, seed });
      assert.ok(Array.isArray(winner) && winner.length >= 1);
      let max = -Infinity;
      for (const s of scores) if (s.total > max) max = s.total;
      const expected = scores
        .filter((s) => s.total === max)
        .map((s) => s.playerId)
        .sort((a, b) => a - b);
      assert.deepEqual(
        winner.slice().sort((a, b) => a - b),
        expected,
        `pc=${playerCount} seed=${seed}: winner mismatch`,
      );
    }
  }
});

test('determinism: same (playerCount, seed) yields identical finalState', () => {
  for (const playerCount of PLAYER_COUNTS) {
    for (const seed of SEEDS) {
      const a = simulateGame({ playerCount, seed });
      const b = simulateGame({ playerCount, seed });
      assert.deepEqual(
        a.finalState,
        b.finalState,
        `pc=${playerCount} seed=${seed}: non-deterministic finalState`,
      );
      assert.deepEqual(a.scores, b.scores);
      assert.deepEqual(a.winner, b.winner);
      assert.equal(a.turns, b.turns);
      assert.equal(a.steps, b.steps);
    }
  }
});

test('a single double-route is never owned on both sides by one player (end state)', () => {
  for (const playerCount of PLAYER_COUNTS) {
    for (const seed of SEEDS) {
      const { finalState } = simulateGame({ playerCount, seed });
      checkOwnership(finalState, MAP, `pc=${playerCount} seed=${seed} end`);
    }
  }
});
