// tests/scoring.test.js — unit tests for src/engine/scoring.js
// Uses small inline fixtures only (no real map.js import).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  routeScore,
  playerNetworkConnected,
  ticketComplete,
  longestPath,
  finalScores,
} from '../src/engine/scoring.js';
import { LONGEST_PATH_BONUS, ROUTE_POINTS } from '../src/engine/constants.js';

// --- Inline fixture map -----------------------------------------------------
// Cities: A B C D E F
// Routes form a simple network. Lengths chosen to exercise scoring.
//   A-B (len 2)   r_ab
//   B-C (len 3)   r_bc
//   C-D (len 1)   r_cd
//   A-D (len 4)   r_ad   (creates a cycle A-B-C-D-A)
//   E-F (len 5)   r_ef   (separate component)
//   D-E (len 6)   r_de   (bridges the two components)
// graph.js:buildAdjacency expects city OBJECTS with an `id` field, so cities
// here are { id } objects (not bare strings).
const FIXTURE_MAP = {
  cities: ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => ({ id })),
  routes: [
    { id: 'r_ab', a: 'A', b: 'B', length: 2, color: 'gray' },
    { id: 'r_bc', a: 'B', b: 'C', length: 3, color: 'red' },
    { id: 'r_cd', a: 'C', b: 'D', length: 1, color: 'blue' },
    { id: 'r_ad', a: 'A', b: 'D', length: 4, color: 'green' },
    { id: 'r_ef', a: 'E', b: 'F', length: 5, color: 'gray' },
    { id: 'r_de', a: 'D', b: 'E', length: 6, color: 'black' },
  ],
  tickets: [],
};

function makePlayer(id, claimedRoutes, tickets = []) {
  return {
    id,
    name: `P${id}`,
    hand: {},
    claimedRoutes,
    tickets,
    trains: 45,
    score: 0,
  };
}

function makeState(players) {
  return {
    seed: 1,
    rngState: 1,
    players,
    turn: 0,
    phase: 'ended',
    market: [],
    drawPile: [],
    discardPile: [],
    ticketsPile: [],
    log: [],
    pendingTickets: null,
  };
}

// --- routeScore -------------------------------------------------------------

test('routeScore matches ROUTE_POINTS for lengths 1-6', () => {
  assert.equal(routeScore(1), 1);
  assert.equal(routeScore(2), 2);
  assert.equal(routeScore(3), 4);
  assert.equal(routeScore(4), 7);
  assert.equal(routeScore(5), 10);
  assert.equal(routeScore(6), 15);
  // sanity: agrees with the constant table
  for (const len of [1, 2, 3, 4, 5, 6]) {
    assert.equal(routeScore(len), ROUTE_POINTS[len]);
  }
});

test('routeScore returns 0 for unknown lengths', () => {
  assert.equal(routeScore(0), 0);
  assert.equal(routeScore(7), 0);
  assert.equal(routeScore(undefined), 0);
});

// --- playerNetworkConnected -------------------------------------------------

test('playerNetworkConnected uses only the player owned routes', () => {
  // Player owns A-B and B-C only.
  const state = makeState([makePlayer(0, ['r_ab', 'r_bc'])]);
  // A reaches C via B.
  assert.equal(playerNetworkConnected(state, 0, 'A', 'C', FIXTURE_MAP), true);
  // A cannot reach D (route A-D not owned, C-D not owned).
  assert.equal(playerNetworkConnected(state, 0, 'A', 'D', FIXTURE_MAP), false);
  // Same city is trivially connected.
  assert.equal(playerNetworkConnected(state, 0, 'A', 'A', FIXTURE_MAP), true);
});

test('playerNetworkConnected ignores routes owned by other players', () => {
  const state = makeState([
    makePlayer(0, ['r_ab']), // owns A-B
    makePlayer(1, ['r_bc']), // owns B-C
  ]);
  // Player 0 alone cannot connect A to C.
  assert.equal(playerNetworkConnected(state, 0, 'A', 'C', FIXTURE_MAP), false);
  // Player 1 alone cannot connect A to C either (does not even own A).
  assert.equal(playerNetworkConnected(state, 1, 'A', 'C', FIXTURE_MAP), false);
});

// --- ticketComplete ---------------------------------------------------------

test('ticketComplete true when network connects endpoints', () => {
  const state = makeState([makePlayer(0, ['r_ab', 'r_bc', 'r_cd'])]);
  const ticket = { id: 't1', from: 'A', to: 'D', points: 7 };
  assert.equal(ticketComplete(state, 0, ticket, FIXTURE_MAP), true);
});

test('ticketComplete false when endpoints not connected', () => {
  const state = makeState([makePlayer(0, ['r_ab', 'r_bc'])]);
  const ticket = { id: 't2', from: 'A', to: 'D', points: 7 };
  assert.equal(ticketComplete(state, 0, ticket, FIXTURE_MAP), false);
});

// --- longestPath ------------------------------------------------------------

test('longestPath on empty network is 0', () => {
  const state = makeState([makePlayer(0, [])]);
  assert.equal(longestPath(state, 0, FIXTURE_MAP), 0);
});

test('longestPath returns sum of route lengths of the longest trail', () => {
  // Player owns the full A-B-C-D-A cycle plus the D-E and E-F tail.
  // Routes: r_ab(2) r_bc(3) r_cd(1) r_ad(4) r_de(6) r_ef(5).
  // Longest trail (no route reused). Best trail:
  //   F-E-D : 5 + 6 = 11, then from D continue the cycle without reusing edges.
  //   F(r_ef)E(r_de)D(r_ad)A(r_ab)B(r_bc)C(r_cd)D
  //   = 5 + 6 + 4 + 2 + 3 + 1 = 21, visiting every edge exactly once.
  const state = makeState([
    makePlayer(0, ['r_ab', 'r_bc', 'r_cd', 'r_ad', 'r_de', 'r_ef']),
  ]);
  assert.equal(longestPath(state, 0, FIXTURE_MAP), 21);
});

test('longestPath on a simple path equals total length', () => {
  // A-B-C : 2 + 3 = 5
  const state = makeState([makePlayer(0, ['r_ab', 'r_bc'])]);
  assert.equal(longestPath(state, 0, FIXTURE_MAP), 5);
});

// --- finalScores ------------------------------------------------------------

test('finalScores: 2 players, longest-path tie gives both +10', () => {
  // Construct two players whose longest trails are equal (a tie).
  // Player 0 owns A-B(2) and B-C(3): longest trail = 5.
  // Player 1 owns C-D(1) and A-D(4): longest trail = 5.
  // Both have longest path 5 -> both get LONGEST_PATH_BONUS.
  //
  // Tickets:
  //  P0 has ticket A->C (complete via A-B-C), points 4  => +4
  //  P0 has ticket A->D (incomplete), points 7          => -7
  //  P1 has ticket A->D (complete via A-D), points 7    => +7
  const p0 = makePlayer(0, ['r_ab', 'r_bc'], [
    { id: 'tA', from: 'A', to: 'C', points: 4 },
    { id: 'tB', from: 'A', to: 'D', points: 7 },
  ]);
  const p1 = makePlayer(1, ['r_cd', 'r_ad'], [
    { id: 'tC', from: 'A', to: 'D', points: 7 },
  ]);
  const state = makeState([p0, p1]);

  const rows = finalScores(state, FIXTURE_MAP);
  assert.equal(rows.length, 2);

  const r0 = rows[0];
  const r1 = rows[1];

  // Player 0 route points: r_ab(len2)->2 + r_bc(len3)->4 = 6
  assert.equal(r0.routePoints, 6);
  // Player 0 ticket points: +4 (A->C done) -7 (A->D not done) = -3
  assert.equal(r0.ticketPoints, -3);
  assert.equal(r0.completedTickets, 1);
  assert.equal(r0.longestPath, 5);
  assert.equal(r0.longestBonus, LONGEST_PATH_BONUS); // 10
  // total = 6 - 3 + 10 = 13
  assert.equal(r0.total, 13);

  // Player 1 route points: r_cd(len1)->1 + r_ad(len4)->7 = 8
  assert.equal(r1.routePoints, 8);
  // Player 1 ticket points: +7 (A->D done) = 7
  assert.equal(r1.ticketPoints, 7);
  assert.equal(r1.completedTickets, 1);
  assert.equal(r1.longestPath, 5);
  assert.equal(r1.longestBonus, LONGEST_PATH_BONUS); // 10 (tie)
  // total = 8 + 7 + 10 = 25
  assert.equal(r1.total, 25);

  assert.equal(r0.playerId, 0);
  assert.equal(r1.playerId, 1);
});

test('finalScores: strict longest-path winner gets the only bonus', () => {
  // Player 0 owns a longer trail than player 1.
  // P0: A-B(2), B-C(3), C-D(1) => longest 6
  // P1: E-F(5)                  => longest 5
  const p0 = makePlayer(0, ['r_ab', 'r_bc', 'r_cd'], []);
  const p1 = makePlayer(1, ['r_ef'], []);
  const state = makeState([p0, p1]);

  const rows = finalScores(state, FIXTURE_MAP);
  assert.equal(rows[0].longestPath, 6);
  assert.equal(rows[1].longestPath, 5);
  assert.equal(rows[0].longestBonus, LONGEST_PATH_BONUS);
  assert.equal(rows[1].longestBonus, 0);

  // P0 route points: 2 + 4 + 1 = 7, total 7 + 0 + 10 = 17
  assert.equal(rows[0].routePoints, 7);
  assert.equal(rows[0].total, 17);
  // P1 route points: len5 -> 10, total 10 + 0 + 0 = 10
  assert.equal(rows[1].routePoints, 10);
  assert.equal(rows[1].total, 10);
});

test('finalScores: no bonus when every longest path is 0', () => {
  const state = makeState([makePlayer(0, []), makePlayer(1, [])]);
  const rows = finalScores(state, FIXTURE_MAP);
  assert.equal(rows[0].longestBonus, 0);
  assert.equal(rows[1].longestBonus, 0);
  assert.equal(rows[0].total, 0);
  assert.equal(rows[1].total, 0);
});

test('finalScores does not mutate the input state', () => {
  const state = makeState([makePlayer(0, ['r_ab'], [])]);
  const snapshot = JSON.stringify(state);
  finalScores(state, FIXTURE_MAP);
  assert.equal(JSON.stringify(state), snapshot);
});
