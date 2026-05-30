import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyAction, applyActions } from '../src/engine/game.js';
import { initGame, cloneState } from '../src/engine/state.js';
import {
  drawDeck,
  drawFaceUp,
  claimRoute,
  drawTickets,
  keepTickets,
} from '../src/engine/actions.js';
import { WILD } from '../src/engine/constants.js';
import { finalScores } from '../src/engine/scoring.js';

// ---- Small inline fixture map (never the real map.js for unit tests) ----
const FIXTURE = {
  cities: [
    { id: 'A', name: 'A', x: 0, y: 0 },
    { id: 'B', name: 'B', x: 1, y: 0 },
    { id: 'C', name: 'C', x: 2, y: 0 },
    { id: 'D', name: 'D', x: 3, y: 0 },
  ],
  routes: [
    { id: 'ab', a: 'A', b: 'B', length: 2, color: 'red' },
    { id: 'bc', a: 'B', b: 'C', length: 1, color: 'gray' },
    { id: 'cd', a: 'C', b: 'D', length: 6, color: 'blue' },
  ],
  tickets: [
    { id: 't-ad', from: 'A', to: 'D', points: 10 },
    { id: 't-ab', from: 'A', to: 'B', points: 3 },
    { id: 't-bc', from: 'B', to: 'C', points: 2 },
  ],
};

// Build a deterministic, fully-specified state so action semantics are testable
// without depending on shuffle outcomes. Matches the CONTRACT §3 state shape.
function makeState(overrides = {}) {
  const base = {
    seed: 1,
    players: [
      { id: 0, name: 'P0', isAI: false, hand: {}, tickets: [], claimedRoutes: [], trains: 45, score: 0 },
      { id: 1, name: 'P1', isAI: false, hand: {}, tickets: [], claimedRoutes: [], trains: 45, score: 0 },
    ],
    current: 0,
    deck: [],
    discard: [],
    faceUp: [],
    ticketDeck: [],
    ticketDiscard: [],
    routeOwner: {},
    phase: 'play',
    finalTurnsLeft: null,
    pending: null,
    cardsDrawnThisTurn: 0,
    turnStartTickets: false,
    moveCount: 0,
    log: [],
    winner: null,
  };
  return { ...base, ...overrides };
}

function player(id, hand, extra = {}) {
  return { id, name: `P${id}`, isAI: false, hand, tickets: [], claimedRoutes: [], trains: 45, score: 0, ...extra };
}

test('drawing two deck cards adds to hand, ends turn, advances current', () => {
  // deck top = end of array (state.js); pop() draws 'yellow' then 'green'.
  const s0 = makeState({ deck: ['red', 'blue', 'green', 'yellow'], current: 0 });
  const s1 = applyAction(s0, drawDeck(), FIXTURE);
  assert.equal(s1.cardsDrawnThisTurn, 1);
  assert.equal(s1.current, 0, 'turn not ended after first draw');
  assert.equal(s1.players[0].hand.yellow, 1);

  const s2 = applyAction(s1, drawDeck(), FIXTURE);
  assert.equal(s2.cardsDrawnThisTurn, 0, 'reset after turn end');
  assert.equal(s2.current, 1, 'advanced to next player');
  assert.equal(s2.players[0].hand.green, 1);
  assert.equal(s2.moveCount, 1);
  // input not mutated
  assert.equal(s0.players[0].hand.yellow, undefined);
  assert.equal(s0.current, 0);
});

test('deck draw ends turn early if no card remains for a second draw', () => {
  const s0 = makeState({ deck: ['red'], discard: [], current: 0 });
  const s1 = applyAction(s0, drawDeck(), FIXTURE);
  assert.equal(s1.players[0].hand.red, 1);
  assert.equal(s1.current, 1, 'turn ended because deck empty');
  assert.equal(s1.cardsDrawnThisTurn, 0);
});

test('empty deck reshuffles discard via seeded rng', () => {
  const s0 = makeState({ deck: [], discard: ['red', 'blue', 'green'], current: 0 });
  const s1 = applyAction(s0, drawDeck(), FIXTURE);
  const total = Object.values(s1.players[0].hand).reduce((a, b) => a + b, 0);
  assert.equal(total, 1, 'one card drawn after reshuffle');
  // discard got reshuffled into deck and one consumed
  assert.equal(s1.deck.length + s1.discard.length, 2);
});

test('taking a face-up wild ends the turn immediately even as first card', () => {
  const s0 = makeState({
    faceUp: [WILD, 'red', 'blue', 'green', 'yellow'],
    deck: ['black', 'white', 'orange', 'purple', 'red', 'blue'],
    current: 0,
  });
  const s1 = applyAction(s0, drawFaceUp(0), FIXTURE);
  assert.equal(s1.players[0].hand[WILD], 1);
  assert.equal(s1.current, 1, 'wild face-up ends turn');
  assert.equal(s1.cardsDrawnThisTurn, 0);
  assert.equal(s1.faceUp.filter((c) => c != null).length, 5, 'row refilled');
});

test('non-wild face-up draw counts and ends turn at 2; row refills', () => {
  const s0 = makeState({
    faceUp: ['red', 'blue', 'green', 'yellow', 'black'],
    deck: ['white', 'orange', 'purple', 'red'],
    current: 0,
  });
  const s1 = applyAction(s0, drawFaceUp(0), FIXTURE);
  assert.equal(s1.players[0].hand.red, 1);
  assert.equal(s1.cardsDrawnThisTurn, 1);
  assert.equal(s1.current, 0);
  assert.equal(s1.faceUp.filter((c) => c != null).length, 5, 'refilled after taking');

  const s2 = applyAction(s1, drawFaceUp(1), FIXTURE);
  assert.equal(s2.cardsDrawnThisTurn, 0);
  assert.equal(s2.current, 1, 'ended at 2');
});

test('cannot take a face-up wild as the SECOND draw', () => {
  const s0 = makeState({
    faceUp: ['red', WILD, 'blue', 'green', 'yellow'],
    deck: [],
    discard: [],
    current: 0,
  });
  const s1 = applyAction(s0, drawFaceUp(0), FIXTURE); // first non-wild; no deck so no refill
  assert.equal(s1.cardsDrawnThisTurn, 1);
  const wildSlot = s1.faceUp.indexOf(WILD);
  assert.ok(wildSlot >= 0, 'a wild is present face-up');
  assert.throws(() => applyAction(s1, drawFaceUp(wildSlot), FIXTURE), /wild/i);
});

test('claiming a route updates hand/trains/score/routeOwner and ends the turn', () => {
  const s0 = makeState({
    players: [player(0, { red: 2, blue: 1 }), player(1, {})],
    current: 0,
  });
  const s1 = applyAction(s0, claimRoute('ab', { red: 2 }), FIXTURE);
  assert.equal(s1.players[0].hand.red, undefined, 'red spent');
  assert.equal(s1.players[0].hand.blue, 1, 'blue untouched');
  assert.equal(s1.players[0].trains, 43, '45 - length 2');
  assert.equal(s1.players[0].score, 2, 'routeScore(2) === 2');
  assert.equal(s1.routeOwner.ab, 0);
  assert.deepEqual(s1.players[0].claimedRoutes, ['ab']);
  assert.deepEqual(s1.discard.slice().sort(), ['red', 'red']);
  assert.equal(s1.current, 1, 'turn ended');
  // input untouched
  assert.equal(s0.players[0].hand.red, 2);
});

test('claiming an already-owned route throws', () => {
  const s0 = makeState({
    players: [player(0, { red: 2 }), player(1, {})],
    routeOwner: { ab: 1 },
    current: 0,
  });
  assert.throws(() => applyAction(s0, claimRoute('ab', { red: 2 }), FIXTURE), /already claimed/);
});

test('claiming with insufficient cards throws', () => {
  const s0 = makeState({
    players: [player(0, { red: 1 }), player(1, {})],
    current: 0,
  });
  assert.throws(() => applyAction(s0, claimRoute('ab', { red: 2 }), FIXTURE));
});

test('unknown action type throws', () => {
  const s0 = makeState({ deck: ['red'] });
  assert.throws(() => applyAction(s0, { type: 'NONSENSE' }, FIXTURE), /unknown action/);
});

test('action with no type throws', () => {
  const s0 = makeState({ deck: ['red'] });
  assert.throws(() => applyAction(s0, {}, FIXTURE), /missing action.type/);
});

test('DRAW_TICKETS then KEEP_TICKETS flow', () => {
  const s0 = makeState({ ticketDeck: ['t-ad', 't-ab', 't-bc'], current: 0 });
  const s1 = applyAction(s0, drawTickets(), FIXTURE);
  assert.ok(s1.pending, 'pending set');
  assert.equal(s1.pending.kind, 'tickets');
  assert.deepEqual(s1.pending.offered, ['t-ad', 't-ab', 't-bc']);
  assert.equal(s1.pending.minKeep, 1);
  assert.equal(s1.current, 0, 'turn does not end on DRAW_TICKETS');
  assert.equal(s1.ticketDeck.length, 0, 'offered removed from deck');

  // mid-pending: anything other than KEEP_TICKETS is illegal
  assert.throws(() => applyAction(s1, drawDeck(), FIXTURE), /pending/);

  const s2 = applyAction(s1, keepTickets(['t-ad']), FIXTURE);
  assert.equal(s2.players[0].tickets.length, 1);
  assert.equal(s2.players[0].tickets[0].id, 't-ad');
  assert.equal(s2.players[0].tickets[0].done, false);
  assert.equal(s2.players[0].tickets[0].points, 10, 'full ticket looked up from map');
  assert.equal(s2.pending, null, 'pending cleared');
  assert.equal(s2.current, 1, 'turn ended');
  // returned tickets go to the bottom of the deck
  assert.deepEqual(s2.ticketDeck, ['t-ab', 't-bc']);
});

test('KEEP_TICKETS below minKeep throws; non-offered ticket throws', () => {
  const s0 = makeState({ ticketDeck: ['t-ad', 't-ab', 't-bc'], current: 0 });
  const s1 = applyAction(s0, drawTickets(), FIXTURE);
  assert.throws(() => applyAction(s1, keepTickets([]), FIXTURE), /at least/);
  assert.throws(() => applyAction(s1, keepTickets(['t-nope']), FIXTURE), /not offered/);
});

test('end-game trigger: finalRound then ends after exactly one more turn each, sets winner', () => {
  // P0 about to drop to threshold by claiming a length-6 route (trains 7 -> 1).
  const s0 = makeState({
    players: [
      player(0, { blue: 6 }, { trains: 7 }),
      player(1, { red: 2 }),
    ],
    deck: ['red', 'blue', 'green', 'yellow', 'black', 'white'],
    current: 0,
  });
  // P0 claims cd (length 6): trains 7 -> 1 <= threshold(2). The trigger turn
  // starts the final round but does NOT consume a final-turn slot, so each of
  // the 2 players (incl. P0) gets exactly one more turn.
  const s1 = applyAction(s0, claimRoute('cd', { blue: 6 }), FIXTURE);
  assert.equal(s1.phase, 'finalRound');
  assert.equal(s1.players[0].trains, 1);
  assert.equal(s1.finalTurnsLeft, 2, 'trigger turn does not decrement');
  assert.equal(s1.current, 1, 'advanced to P1');

  // P1 takes its final turn (two deck draws).
  const s2 = applyActions(s1, [drawDeck(), drawDeck()], FIXTURE);
  assert.equal(s2.current, 0, 'wrapped back to P0');
  assert.equal(s2.finalTurnsLeft, 1);
  assert.equal(s2.phase, 'finalRound');

  // P0 takes its final turn (two deck draws). This should end the game.
  const s3 = applyActions(s2, [drawDeck(), drawDeck()], FIXTURE);
  assert.equal(s3.phase, 'ended');
  assert.equal(s3.finalTurnsLeft, 0);
  assert.ok(Array.isArray(s3.winner), 'winner is an array per CONTRACT §3');

  const scores = finalScores(s3, FIXTURE);
  const max = Math.max(...scores.map((x) => x.total));
  const expected = scores.filter((x) => x.total === max).map((x) => x.playerId);
  assert.deepEqual(s3.winner.slice().sort(), expected.slice().sort());

  // no further actions allowed
  assert.throws(() => applyAction(s3, drawDeck(), FIXTURE), /ended/);
});

test('player.score holds running ROUTE score during play', () => {
  const s0 = makeState({
    players: [player(0, { red: 2, blue: 1 }), player(1, { blue: 1 })],
    current: 0,
  });
  const s1 = applyAction(s0, claimRoute('ab', { red: 2 }), FIXTURE); // score +2
  assert.equal(s1.players[0].score, 2);
  // P1 claims bc (gray, length 1) with blue -> score +1
  const s2 = applyAction(s1, claimRoute('bc', { blue: 1 }), FIXTURE);
  assert.equal(s2.players[1].score, 1);
});

test('DETERMINISM: applyActions twice from same seed+actions yields identical state', () => {
  const cfgs = [{ name: 'P0' }, { name: 'P1' }];
  const start = initGame({ map: FIXTURE, tickets: FIXTURE.tickets, playerConfigs: cfgs, seed: 12345 });
  const actions = [drawDeck(), drawDeck(), drawFaceUp(0), drawFaceUp(0)];
  const a = applyActions(cloneState(start), actions, FIXTURE);
  const b = applyActions(cloneState(start), actions, FIXTURE);
  assert.deepEqual(a, b);
  // and the original start is untouched by the fold
  const startAgain = initGame({ map: FIXTURE, tickets: FIXTURE.tickets, playerConfigs: cfgs, seed: 12345 });
  assert.deepEqual(start, startAgain);
});

test('integration: real map.js can drive applyActions deterministically', async () => {
  const { MAP, TICKETS } = await import('../src/engine/map.js');
  const cfgs = [{ name: 'A' }, { name: 'B' }];
  const start = initGame({ map: MAP, tickets: TICKETS, playerConfigs: cfgs, seed: 999 });
  const acts = [drawDeck(), drawDeck()];
  const r1 = applyActions(cloneState(start), acts, MAP);
  const r2 = applyActions(cloneState(start), acts, MAP);
  assert.deepEqual(r1, r2);
  assert.equal(r1.current, 1, 'turn advanced after two deck draws');
});
