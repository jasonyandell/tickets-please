// tests/viewModel.test.js — unit tests for src/ui/viewModel.js
//
// Pure-function tests using small inline fixtures only (no real map.js, no DOM).
// Mirrors the style of tests/scoring.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildViewModel } from '../src/ui/viewModel.js';
import { finalScores } from '../src/engine/scoring.js';

// --- Inline fixture map -----------------------------------------------------
// Cities A B C. Routes:
//   r_ab  A-B  len 2  red
//   r_bc  B-C  len 3  blue
//   r_ac  A-C  len 2  gray
// graph.js expects city OBJECTS with an `id`; engine routes use a/b endpoints.
const MAP = {
  cities: ['A', 'B', 'C'].map((id) => ({ id, x: 0, y: 0 })),
  routes: [
    { id: 'r_ab', a: 'A', b: 'B', length: 2, color: 'red' },
    { id: 'r_bc', a: 'B', b: 'C', length: 3, color: 'blue' },
    { id: 'r_ac', a: 'A', b: 'C', length: 2, color: 'gray' },
  ],
  tickets: [{ id: 't1', from: 'A', to: 'C', points: 5 }],
};

const CONFIGS = [
  { name: 'Alice', isAI: false },
  { name: 'Bob', isAI: true },
];

// Build a full engine-shaped state, with sensible live-game defaults that the
// caller overrides per test.
function makeState(over = {}) {
  const base = {
    seed: 1,
    players: [
      { id: 0, name: 'Alice', isAI: false, hand: { red: 2 }, trains: 45, tickets: [], claimedRoutes: [], score: 0 },
      { id: 1, name: 'Bob', isAI: true, hand: { blue: 1 }, trains: 45, tickets: [], claimedRoutes: [], score: 0 },
    ],
    deck: ['green', 'green', 'green'],
    discard: [],
    faceUp: ['red', 'blue', 'green', 'yellow', 'black'],
    ticketDeck: ['t1'],
    ticketDiscard: [],
    routeOwner: {},
    current: 0,
    phase: 'play',
    finalTurnsLeft: null,
    pending: null,
    cardsDrawnThisTurn: 0,
    moveCount: 0,
    log: [],
    winner: null,
  };
  return { ...base, ...over };
}

// --- prompt / phase ---------------------------------------------------------

test('fresh turn: phase play, not mustDrawSecond, human draw/claim prompt', () => {
  const vm = buildViewModel(makeState(), MAP, CONFIGS, {});
  assert.equal(vm.phase, 'play');
  assert.equal(vm.currentPlayerIndex, 0);
  assert.equal(vm.actions.mustDrawSecond, false);
  assert.equal(vm.actions.canDrawDeck, true);
  assert.equal(vm.actions.canDrawTickets, true);
  assert.equal(vm.actions.canPass, false);
  assert.match(vm.prompt, /Alice/);
  assert.match(vm.prompt, /draw|claim/i);
});

test('after one draw: mustDrawSecond + "draw your 2nd card" prompt, no claims', () => {
  const vm = buildViewModel(makeState({ cardsDrawnThisTurn: 1 }), MAP, CONFIGS, {});
  assert.equal(vm.actions.mustDrawSecond, true);
  assert.equal(vm.actions.canDrawDeck, true);
  assert.match(vm.prompt, /2nd card/i);
  // No route is claimable mid-draw.
  assert.ok(vm.routes.every((r) => r.claimable === false));
});

test('forced pass: only PASS is legal, prompt says pass', () => {
  const state = makeState({
    deck: [],
    discard: [],
    faceUp: [null, null, null, null, null],
    ticketDeck: [],
    cardsDrawnThisTurn: 0,
    players: [
      { id: 0, name: 'Alice', isAI: false, hand: {}, trains: 45, tickets: [], claimedRoutes: [], score: 0 },
      { id: 1, name: 'Bob', isAI: true, hand: {}, trains: 45, tickets: [], claimedRoutes: [], score: 0 },
    ],
  });
  const vm = buildViewModel(state, MAP, CONFIGS, {});
  assert.equal(vm.actions.canPass, true);
  assert.equal(vm.actions.canDrawDeck, false);
  assert.equal(vm.actions.canDrawTickets, false);
  assert.match(vm.prompt, /pass/i);
});

// --- final round ------------------------------------------------------------

test('play phase: finalRound false, finalTurnsLeft null, no FINAL ROUND in prompt', () => {
  const vm = buildViewModel(makeState(), MAP, CONFIGS, {});
  assert.equal(vm.finalRound, false);
  assert.equal(vm.finalTurnsLeft, null);
  assert.doesNotMatch(vm.prompt, /FINAL ROUND/);
});

test('finalRound phase: finalRound true, turns-left surfaced in vm + prompt', () => {
  const vm = buildViewModel(makeState({ phase: 'finalRound', finalTurnsLeft: 2 }), MAP, CONFIGS, {});
  assert.equal(vm.finalRound, true);
  assert.equal(vm.finalTurnsLeft, 2);
  assert.match(vm.prompt, /FINAL ROUND \(2 turns left\)/);
});

test('finalRound singular: "1 turn left" (no plural)', () => {
  const vm = buildViewModel(makeState({ phase: 'finalRound', finalTurnsLeft: 1 }), MAP, CONFIGS, {});
  assert.match(vm.prompt, /FINAL ROUND \(1 turn left\)/);
});

test('game over: finalRound false even if phase data lingers', () => {
  const vm = buildViewModel(makeState({ phase: 'finalRound', finalTurnsLeft: 0 }), MAP, CONFIGS, { gameOver: true });
  assert.equal(vm.finalRound, false);
  assert.equal(vm.finalTurnsLeft, null);
});

// --- routes: cost / affordable / reason -------------------------------------

test('route cost + affordable + reason: affordable vs unaffordable', () => {
  const vm = buildViewModel(makeState(), MAP, CONFIGS, {});
  const byId = Object.fromEntries(vm.routes.map((r) => [r.id, r]));

  // r_ab is red length-2; the current player holds red:2 -> affordable & claimable.
  assert.equal(byId.r_ab.affordable, true);
  assert.equal(byId.r_ab.claimable, true);
  assert.deepEqual(byId.r_ab.cost, { red: 2 });
  assert.equal(byId.r_ab.reason, null);
  // Unclaimed routes carry structured ownership = empty.
  assert.equal(byId.r_ab.claimed, false);
  assert.equal(byId.r_ab.ownerIndex, null);
  assert.equal(byId.r_ab.ownerName, null);

  // r_bc is blue length-3; the player has no blue/wild -> unaffordable, reason set.
  assert.equal(byId.r_bc.affordable, false);
  assert.equal(byId.r_bc.claimable, false);
  assert.equal(byId.r_bc.cost, null);
  assert.match(byId.r_bc.reason, /cover/i);
});

test('affordable but trains-blocked route: affordable true, claimable false, engine reason', () => {
  // Player holds blue:3 (can pay r_bc's 3) but only 2 trains left (< length 3).
  const state = makeState({
    players: [
      { id: 0, name: 'Alice', isAI: false, hand: { blue: 3 }, trains: 2, tickets: [], claimedRoutes: [], score: 0 },
      { id: 1, name: 'Bob', isAI: true, hand: { blue: 1 }, trains: 45, tickets: [], claimedRoutes: [], score: 0 },
    ],
  });
  const vm = buildViewModel(state, MAP, CONFIGS, {});
  const r = vm.routes.find((x) => x.id === 'r_bc');
  assert.equal(r.affordable, true);
  assert.deepEqual(r.cost, { blue: 3 });
  assert.equal(r.claimable, false);
  assert.match(r.reason, /train/i);
});

test('affordable route mid-draw is blocked with a "finish your draw" reason', () => {
  const vm = buildViewModel(makeState({ cardsDrawnThisTurn: 1 }), MAP, CONFIGS, {});
  const r = vm.routes.find((x) => x.id === 'r_ab');
  assert.equal(r.affordable, true); // still affordable by cards
  assert.equal(r.claimable, false); // but not during a draw
  assert.match(r.reason, /finish your draw/i);
});

test('owned route is not claimable and names its owner', () => {
  const vm = buildViewModel(makeState({ routeOwner: { r_ab: 1 } }), MAP, CONFIGS, {});
  const r = vm.routes.find((x) => x.id === 'r_ab');
  assert.equal(r.claimable, false);
  assert.equal(r.affordable, false);
  assert.equal(r.cost, null);
  assert.match(r.reason, /Claimed by Bob/);
  // Structured ownership: renderer/e2e read these, never the reason string.
  assert.equal(r.claimed, true);
  assert.equal(r.ownerIndex, 1);
  assert.equal(r.ownerName, 'Bob');
});

// --- secret masking (hotseat privacy) ---------------------------------------

test('active human sees own hand/tickets; opponent is masked to counts', () => {
  const state = makeState({
    players: [
      { id: 0, name: 'Alice', isAI: false, hand: { red: 2, blue: 1 }, trains: 45, tickets: [{ id: 't1', from: 'A', to: 'C', points: 5 }], claimedRoutes: [], score: 0 },
      { id: 1, name: 'Bob', isAI: true, hand: { green: 3 }, trains: 45, tickets: [{ id: 't1', from: 'A', to: 'C', points: 5 }, { id: 't2', from: 'B', to: 'C', points: 3 }], claimedRoutes: [], score: 0 },
    ],
  });
  const vm = buildViewModel(state, MAP, CONFIGS, {});
  assert.equal(vm.secretForIndex, 0);

  // Active human (index 0): hand colors + tickets populated.
  assert.deepEqual(vm.players[0].handByColor, { red: 2, blue: 1 });
  assert.equal(vm.players[0].handCount, 3);
  assert.ok(Array.isArray(vm.players[0].tickets));
  assert.equal(vm.players[0].tickets.length, 1);

  // Opponent (index 1): masked — counts only.
  assert.equal(vm.players[1].handByColor, null);
  assert.equal(vm.players[1].handCount, 3);
  assert.equal(vm.players[1].tickets, null);
  assert.equal(vm.players[1].ticketCount, 2);
});

test('on an AI turn no one is revealed (secretForIndex null)', () => {
  const vm = buildViewModel(makeState({ current: 1 }), MAP, CONFIGS, {});
  assert.equal(vm.secretForIndex, null);
  assert.equal(vm.players[0].handByColor, null);
  assert.equal(vm.players[1].handByColor, null);
});

// --- scoreboard / winner (game over) ----------------------------------------

test('scoreboard totals match finalScores; winnerIndex is the top total', () => {
  // Alice owns r_ac (A-C) -> completes ticket t1 (A->C). Bob owns nothing.
  const state = makeState({
    phase: 'ended',
    players: [
      { id: 0, name: 'Alice', isAI: false, hand: {}, trains: 43, tickets: [{ id: 't1', from: 'A', to: 'C', points: 5 }], claimedRoutes: ['r_ac'], score: 0 },
      { id: 1, name: 'Bob', isAI: true, hand: {}, trains: 45, tickets: [{ id: 't1', from: 'A', to: 'C', points: 5 }], claimedRoutes: [], score: 0 },
    ],
    routeOwner: { r_ac: 0 },
  });
  const scores = finalScores(state, MAP);
  const vm = buildViewModel(state, MAP, CONFIGS, { gameOver: true, scores });

  assert.ok(Array.isArray(vm.scoreboard));
  assert.equal(vm.scoreboard.length, 2);

  // Each scoreboard row's total equals the matching finalScores row total.
  for (const row of vm.scoreboard) {
    const engineRow = scores.find((s) => s.playerId === row.index);
    assert.equal(row.total, engineRow.total);
  }

  // Highest total wins; scoreboard is sorted total-desc.
  const top = scores.reduce((a, b) => (b.total > a.total ? b : a));
  assert.equal(vm.winnerIndex, top.playerId);
  assert.equal(vm.scoreboard[0].index, top.playerId);
  assert.match(vm.prompt, /Game over/);

  // On game over both players' secret info is revealed.
  assert.ok(vm.players[0].handByColor !== null);
  assert.ok(Array.isArray(vm.players[1].tickets));
});

// --- live longest-route ------------------------------------------------------

test('longest route: no claims → no leader, max 0, no hasLongest flags', () => {
  const vm = buildViewModel(makeState(), MAP, CONFIGS, {});
  assert.equal(vm.longestPathMax, 0);
  assert.deepEqual(vm.longestLeaderIndices, []);
  for (const s of vm.standings) assert.equal(s.hasLongest, false);
});

test('longest route: the player with the longer trail is the live longest-route leader', () => {
  // Alice owns r_ab(2) + r_bc(3) = a trail of 5; Bob owns r_ac(2) = 2.
  const state = makeState({
    players: [
      { id: 0, name: 'Alice', isAI: false, hand: {}, trains: 40, tickets: [], claimedRoutes: ['r_ab', 'r_bc'], score: 6 },
      { id: 1, name: 'Bob', isAI: true, hand: {}, trains: 43, tickets: [], claimedRoutes: ['r_ac'], score: 2 },
    ],
    routeOwner: { r_ab: 0, r_bc: 0, r_ac: 1 },
  });
  const vm = buildViewModel(state, MAP, CONFIGS, {});
  assert.equal(vm.longestPathMax, 5);
  assert.deepEqual(vm.longestLeaderIndices, [0]);
  const alice = vm.standings.find((s) => s.index === 0);
  const bob = vm.standings.find((s) => s.index === 1);
  assert.equal(alice.longestPath, 5);
  assert.equal(alice.hasLongest, true);
  assert.equal(bob.longestPath, 2);
  assert.equal(bob.hasLongest, false);
});

// --- standings (live ranking + leader) --------------------------------------

test('standings: sorted by score desc, ranked, leader marked', () => {
  const state = makeState({
    players: [
      { id: 0, name: 'Alice', isAI: false, hand: {}, trains: 45, tickets: [], claimedRoutes: [], score: 4 },
      { id: 1, name: 'Bob', isAI: true, hand: {}, trains: 45, tickets: [], claimedRoutes: [], score: 9 },
    ],
  });
  const vm = buildViewModel(state, MAP, CONFIGS, {});
  assert.equal(vm.standings.length, 2);
  // Bob (9) leads Alice (4).
  assert.equal(vm.standings[0].index, 1);
  assert.equal(vm.standings[0].score, 9);
  assert.equal(vm.standings[0].rank, 1);
  assert.equal(vm.standings[0].isLeader, true);
  assert.equal(vm.standings[1].index, 0);
  assert.equal(vm.standings[1].rank, 2);
  assert.equal(vm.standings[1].isLeader, false);
  assert.equal(vm.leaderIndex, 1);
});

test('standings: ties share a rank and tie-break by index; both leaders flagged', () => {
  const state = makeState({
    players: [
      { id: 0, name: 'Alice', isAI: false, hand: {}, trains: 45, tickets: [], claimedRoutes: [], score: 7 },
      { id: 1, name: 'Bob', isAI: true, hand: {}, trains: 45, tickets: [], claimedRoutes: [], score: 7 },
    ],
  });
  const vm = buildViewModel(state, MAP, CONFIGS, {});
  // Both top with 7; stable order is by index, both rank 1, both leaders.
  assert.equal(vm.standings[0].index, 0);
  assert.equal(vm.standings[1].index, 1);
  assert.equal(vm.standings[0].rank, 1);
  assert.equal(vm.standings[1].rank, 1);
  assert.equal(vm.standings[0].isLeader, true);
  assert.equal(vm.standings[1].isLeader, true);
  // leaderIndex points at the first (lowest-index) tied leader.
  assert.equal(vm.leaderIndex, 0);
});

test('standings: a 0-0 opening has no leader', () => {
  const vm = buildViewModel(makeState(), MAP, CONFIGS, {});
  assert.equal(vm.standings.length, 2);
  assert.equal(vm.standings.every((s) => s.isLeader === false), true);
  assert.equal(vm.leaderIndex, null);
  // Still ranked, stable by index when scores are equal.
  assert.equal(vm.standings[0].rank, 1);
  assert.equal(vm.standings[1].rank, 1);
});

test('standings: skipped rank after a tie (1,1,3) and uses game-over totals', () => {
  // Three players with scores 5,5,2 -> ranks 1,1,3.
  const state = makeState({
    phase: 'ended',
    players: [
      { id: 0, name: 'Alice', isAI: false, hand: {}, trains: 45, tickets: [], claimedRoutes: [], score: 5 },
      { id: 1, name: 'Bob', isAI: true, hand: {}, trains: 45, tickets: [], claimedRoutes: [], score: 5 },
      { id: 2, name: 'Cara', isAI: true, hand: {}, trains: 45, tickets: [], claimedRoutes: [], score: 2 },
    ],
  });
  // On game over, playerViews.score comes from the scores rows when present.
  const scores = [
    { playerId: 0, total: 5 },
    { playerId: 1, total: 5 },
    { playerId: 2, total: 2 },
  ];
  const vm = buildViewModel(state, MAP, [...CONFIGS, { name: 'Cara', isAI: true }], { gameOver: true, scores });
  assert.deepEqual(vm.standings.map((s) => s.rank), [1, 1, 3]);
  assert.deepEqual(vm.standings.map((s) => s.score), [5, 5, 2]);
  assert.equal(vm.standings.filter((s) => s.isLeader).length, 2);
});

// --- ticket-relevant routes (the active human's "build toward" hint) --------

test('ticket-relevant routes: shortest path for the active human\'s incomplete ticket', () => {
  // Alice (active human) holds t1 (A->C). Shortest A->C is r_ac(2), not A-B-C(5).
  const state = makeState({
    players: [
      { id: 0, name: 'Alice', isAI: false, hand: { red: 2 }, trains: 45, tickets: [{ id: 't1', from: 'A', to: 'C', points: 5 }], claimedRoutes: [], score: 0 },
      { id: 1, name: 'Bob', isAI: true, hand: { blue: 1 }, trains: 45, tickets: [], claimedRoutes: [], score: 0 },
    ],
  });
  const vm = buildViewModel(state, MAP, CONFIGS, {});
  assert.deepEqual(vm.ticketRouteIds, ['r_ac']);
  const byId = Object.fromEntries(vm.routes.map((r) => [r.id, r]));
  assert.equal(byId.r_ac.ticketRelevant, true);
  assert.equal(byId.r_ab.ticketRelevant, false);
  assert.equal(byId.r_bc.ticketRelevant, false);
});

test('ticket-relevant routes: an owned route is a free connector (weight 0)', () => {
  // Alice owns r_ab (A-B). Ticket B->C: the direct r_bc costs 3 cars, but going
  // B->A (free, already owned) then A->C via r_ac costs only 2 — so the cheapest
  // build the hint surfaces is r_ac, riding the owned r_ab as a 0-cost connector.
  const state = makeState({
    players: [
      { id: 0, name: 'Alice', isAI: false, hand: {}, trains: 45, tickets: [{ id: 't1', from: 'B', to: 'C', points: 4 }], claimedRoutes: ['r_ab'], score: 0 },
      { id: 1, name: 'Bob', isAI: true, hand: {}, trains: 45, tickets: [], claimedRoutes: [], score: 0 },
    ],
    routeOwner: { r_ab: 0 },
  });
  const vm = buildViewModel(state, MAP, CONFIGS, {});
  assert.deepEqual([...vm.ticketRouteIds].sort(), ['r_ab', 'r_ac']);
});

test('ticket-relevant routes: an opponent-owned route is impassable', () => {
  // Bob owns r_ac. Alice's ticket A->C must now route A-B-C (r_ab + r_bc).
  const state = makeState({
    players: [
      { id: 0, name: 'Alice', isAI: false, hand: {}, trains: 45, tickets: [{ id: 't1', from: 'A', to: 'C', points: 5 }], claimedRoutes: [], score: 0 },
      { id: 1, name: 'Bob', isAI: true, hand: {}, trains: 45, tickets: [], claimedRoutes: ['r_ac'], score: 0 },
    ],
    routeOwner: { r_ac: 1 },
  });
  const vm = buildViewModel(state, MAP, CONFIGS, {});
  assert.deepEqual([...vm.ticketRouteIds].sort(), ['r_ab', 'r_bc']);
});

test('ticket-relevant routes: a COMPLETE ticket contributes nothing', () => {
  // Alice owns r_ac, which already completes A->C → no build hint needed.
  const state = makeState({
    players: [
      { id: 0, name: 'Alice', isAI: false, hand: {}, trains: 43, tickets: [{ id: 't1', from: 'A', to: 'C', points: 5 }], claimedRoutes: ['r_ac'], score: 0 },
      { id: 1, name: 'Bob', isAI: true, hand: {}, trains: 45, tickets: [], claimedRoutes: [], score: 0 },
    ],
    routeOwner: { r_ac: 0 },
  });
  const vm = buildViewModel(state, MAP, CONFIGS, {});
  assert.deepEqual(vm.ticketRouteIds, []);
});

test('ticket-relevant routes: PRIVACY — empty on an AI turn (never leaks tickets)', () => {
  // It is Bob's (AI) turn. Even though Alice holds a ticket, nothing is exposed.
  const state = makeState({
    current: 1,
    players: [
      { id: 0, name: 'Alice', isAI: false, hand: {}, trains: 45, tickets: [{ id: 't1', from: 'A', to: 'C', points: 5 }], claimedRoutes: [], score: 0 },
      { id: 1, name: 'Bob', isAI: true, hand: {}, trains: 45, tickets: [{ id: 't1', from: 'A', to: 'C', points: 5 }], claimedRoutes: [], score: 0 },
    ],
  });
  const vm = buildViewModel(state, MAP, CONFIGS, {});
  assert.equal(vm.secretForIndex, null);
  assert.deepEqual(vm.ticketRouteIds, []);
  assert.equal(vm.routes.every((r) => r.ticketRelevant === false), true);
});

// --- serializability (exposed on window.__APP__ for e2e to read) ------------

test('view-model is plain JSON (round-trips with no loss) in play and game-over', () => {
  // Mid-game with a masked opponent and an owned route.
  const playVm = buildViewModel(makeState({ routeOwner: { r_ab: 1 } }), MAP, CONFIGS, {});
  assert.deepEqual(JSON.parse(JSON.stringify(playVm)), playVm);

  // Game over with a full scoreboard.
  const overState = makeState({
    phase: 'ended',
    players: [
      { id: 0, name: 'Alice', isAI: false, hand: {}, trains: 43, tickets: [{ id: 't1', from: 'A', to: 'C', points: 5 }], claimedRoutes: ['r_ac'], score: 0 },
      { id: 1, name: 'Bob', isAI: true, hand: {}, trains: 45, tickets: [], claimedRoutes: [], score: 0 },
    ],
    routeOwner: { r_ac: 0 },
  });
  const scores = finalScores(overState, MAP);
  const overVm = buildViewModel(overState, MAP, CONFIGS, { gameOver: true, scores });
  assert.deepEqual(JSON.parse(JSON.stringify(overVm)), overVm);

  // No top-level field is `undefined` (JSON.stringify would silently drop it).
  for (const k of Object.keys(overVm)) assert.notEqual(overVm[k], undefined);
});

// --- purity -----------------------------------------------------------------

test('buildViewModel does not mutate the input state', () => {
  const state = makeState({ routeOwner: { r_ab: 1 } });
  const snapshot = JSON.stringify(state);
  buildViewModel(state, MAP, CONFIGS, {});
  assert.equal(JSON.stringify(state), snapshot);
});
