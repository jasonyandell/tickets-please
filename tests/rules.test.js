// Unit tests for src/engine/rules.js (CONTRACT.md §5).
//
// These tests use tiny inline fixture maps and hand-built states — they do NOT
// import the big real map, keeping them isolated and fast.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  canClaimRoute,
  canonicalSpend,
  legalMoves,
  isTurnOver,
} from '../src/engine/rules.js';
import { WILD, GRAY } from '../src/engine/constants.js';
import {
  DRAW_DECK,
  DRAW_FACEUP,
  CLAIM_ROUTE,
  DRAW_TICKETS,
  KEEP_TICKETS,
} from '../src/engine/actions.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A small map:
 *   A-B : length 2, color 'red'            (id 'ab-red')
 *   A-B : length 2, color 'blue'           (id 'ab-blue')   parallel sibling pair
 *   B-C : length 3, color 'gray'           (id 'bc')
 *   C-D : length 1, color 'green'          (id 'cd')
 */
const MAP = {
  name: 'fixture',
  width: 100,
  height: 100,
  cities: [
    { id: 'A', name: 'A', x: 0, y: 0 },
    { id: 'B', name: 'B', x: 10, y: 0 },
    { id: 'C', name: 'C', x: 20, y: 0 },
    { id: 'D', name: 'D', x: 30, y: 0 },
  ],
  routes: [
    { id: 'ab-red', a: 'A', b: 'B', length: 2, color: 'red', parallel: true },
    { id: 'ab-blue', a: 'A', b: 'B', length: 2, color: 'blue', parallel: true },
    { id: 'bc', a: 'B', b: 'C', length: 3, color: GRAY },
    { id: 'cd', a: 'C', b: 'D', length: 1, color: 'green' },
  ],
};

// Build an empty hand tally over all colors, overlaying `overrides`.
function hand(overrides = {}) {
  const h = {
    red: 0,
    orange: 0,
    yellow: 0,
    green: 0,
    blue: 0,
    purple: 0,
    white: 0,
    black: 0,
    [WILD]: 0,
  };
  return { ...h, ...overrides };
}

// Build a minimal play state. `playerHands` is an array of hand-overrides.
function makeState(opts = {}) {
  const {
    numPlayers = 2,
    hands = [],
    trains = [45, 45, 45, 45, 45],
    routeOwner = {},
    current = 0,
    deck = ['red', 'red', 'red'],
    discard = [],
    faceUp = ['red', 'blue', 'green', WILD, 'yellow'],
    ticketDeck = ['t1', 't2', 't3'],
    pending = null,
    cardsDrawnThisTurn = 0,
  } = opts;

  const players = [];
  for (let i = 0; i < numPlayers; i++) {
    players.push({
      id: i,
      name: `P${i}`,
      isAI: false,
      hand: hand(hands[i] || {}),
      trains: trains[i],
      tickets: [],
      claimedRoutes: [],
      score: 0,
    });
  }

  return {
    seed: 1,
    players,
    deck: deck.slice(),
    discard: discard.slice(),
    faceUp: faceUp.slice(),
    ticketDeck: ticketDeck.slice(),
    ticketDiscard: [],
    routeOwner: { ...routeOwner },
    current,
    phase: 'play',
    finalTurnsLeft: null,
    pending,
    cardsDrawnThisTurn,
    turnStartTickets: cardsDrawnThisTurn === 0,
    log: [],
    winner: null,
  };
}

// ---------------------------------------------------------------------------
// canClaimRoute — happy paths
// ---------------------------------------------------------------------------

test('canClaimRoute: colored route paid with matching color', () => {
  const state = makeState({ hands: [{ red: 2 }] });
  const res = canClaimRoute(state, 0, 'ab-red', { red: 2 }, MAP);
  assert.deepEqual(res, { ok: true });
});

test('canClaimRoute: colored route with wild substitution', () => {
  const state = makeState({ hands: [{ red: 1, [WILD]: 1 }] });
  const res = canClaimRoute(state, 0, 'ab-red', { red: 1, [WILD]: 1 }, MAP);
  assert.equal(res.ok, true);
});

test('canClaimRoute: gray route paid with a single color', () => {
  const state = makeState({ hands: [{ yellow: 3 }] });
  const res = canClaimRoute(state, 0, 'bc', { yellow: 3 }, MAP);
  assert.equal(res.ok, true);
});

test('canClaimRoute: gray route paid with single color plus wilds', () => {
  const state = makeState({ hands: [{ yellow: 1, [WILD]: 2 }] });
  const res = canClaimRoute(state, 0, 'bc', { yellow: 1, [WILD]: 2 }, MAP);
  assert.equal(res.ok, true);
});

test('canClaimRoute: gray route paid entirely with wilds', () => {
  const state = makeState({ hands: [{ [WILD]: 3 }] });
  const res = canClaimRoute(state, 0, 'bc', { [WILD]: 3 }, MAP);
  assert.equal(res.ok, true);
});

// ---------------------------------------------------------------------------
// canClaimRoute — rejections
// ---------------------------------------------------------------------------

test('canClaimRoute: rejects unknown route', () => {
  const state = makeState({ hands: [{ red: 2 }] });
  const res = canClaimRoute(state, 0, 'nope', { red: 2 }, MAP);
  assert.equal(res.ok, false);
  assert.match(res.reason, /exist/);
});

test('canClaimRoute: rejects an already-owned route', () => {
  const state = makeState({
    hands: [{ red: 2 }],
    routeOwner: { 'ab-red': 1 },
  });
  const res = canClaimRoute(state, 0, 'ab-red', { red: 2 }, MAP);
  assert.equal(res.ok, false);
  assert.match(res.reason, /claimed/);
});

test('canClaimRoute: rejects insufficient trains', () => {
  const state = makeState({ hands: [{ red: 2 }], trains: [1, 45] });
  const res = canClaimRoute(state, 0, 'ab-red', { red: 2 }, MAP);
  assert.equal(res.ok, false);
  assert.match(res.reason, /trains/);
});

test('canClaimRoute: rejects spend that does not total route length', () => {
  const state = makeState({ hands: [{ red: 3 }] });
  const tooFew = canClaimRoute(state, 0, 'ab-red', { red: 1 }, MAP);
  assert.equal(tooFew.ok, false);
  assert.match(tooFew.reason, /total/);

  const tooMany = canClaimRoute(state, 0, 'ab-red', { red: 3 }, MAP);
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.reason, /total/);
});

test('canClaimRoute: rejects when player lacks the cards in spend', () => {
  const state = makeState({ hands: [{ red: 1 }] });
  const res = canClaimRoute(state, 0, 'ab-red', { red: 2 }, MAP);
  assert.equal(res.ok, false);
  assert.match(res.reason, /do not hold/);
});

test('canClaimRoute: rejects wrong color on a colored route', () => {
  const state = makeState({ hands: [{ blue: 2 }] });
  const res = canClaimRoute(state, 0, 'ab-red', { blue: 2 }, MAP);
  assert.equal(res.ok, false);
  assert.match(res.reason, /red/);
});

test('canClaimRoute: rejects mixed colors on a gray route', () => {
  const state = makeState({ hands: [{ yellow: 2, blue: 1 }] });
  const res = canClaimRoute(state, 0, 'bc', { yellow: 2, blue: 1 }, MAP);
  assert.equal(res.ok, false);
  assert.match(res.reason, /single color/);
});

// ---------------------------------------------------------------------------
// canClaimRoute — double-route sibling rules
// ---------------------------------------------------------------------------

test('canClaimRoute: in 2p, sibling owned by anyone blocks the parallel route', () => {
  const state = makeState({
    numPlayers: 2,
    hands: [{ red: 2 }, { blue: 2 }],
    routeOwner: { 'ab-blue': 1 }, // other player owns the sibling
  });
  const res = canClaimRoute(state, 0, 'ab-red', { red: 2 }, MAP);
  assert.equal(res.ok, false);
  assert.match(res.reason, /parallel/);
});

test('canClaimRoute: a player may never own both siblings (even in 4p)', () => {
  const state = makeState({
    numPlayers: 4,
    hands: [{ red: 2, blue: 2 }, {}, {}, {}],
    routeOwner: { 'ab-blue': 0 }, // same player already owns sibling
  });
  const res = canClaimRoute(state, 0, 'ab-red', { red: 2 }, MAP);
  assert.equal(res.ok, false);
  assert.match(res.reason, /already own/);
});

test('canClaimRoute: in 4p, sibling owned by ANOTHER player is allowed', () => {
  const state = makeState({
    numPlayers: 4,
    hands: [{ red: 2 }, { blue: 2 }, {}, {}],
    routeOwner: { 'ab-blue': 1 }, // a different player owns the sibling
  });
  const res = canClaimRoute(state, 0, 'ab-red', { red: 2 }, MAP);
  assert.equal(res.ok, true);
});

// ---------------------------------------------------------------------------
// canonicalSpend
// ---------------------------------------------------------------------------

test('canonicalSpend: colored route prefers matching color, minimal wild', () => {
  const route = MAP.routes.find((r) => r.id === 'ab-red');
  const spend = canonicalSpend(hand({ red: 5, [WILD]: 3 }), route, MAP);
  assert.deepEqual(spend, { red: 2 });
});

test('canonicalSpend: colored route fills remainder with wilds', () => {
  const route = MAP.routes.find((r) => r.id === 'ab-red');
  const spend = canonicalSpend(hand({ red: 1, [WILD]: 3 }), route, MAP);
  assert.deepEqual(spend, { red: 1, [WILD]: 1 });
});

test('canonicalSpend: colored route returns null when unaffordable', () => {
  const route = MAP.routes.find((r) => r.id === 'ab-red');
  const spend = canonicalSpend(hand({ red: 1, [WILD]: 0 }), route, MAP);
  assert.equal(spend, null);
});

test('canonicalSpend: gray route picks most-plentiful single color', () => {
  const route = MAP.routes.find((r) => r.id === 'bc'); // length 3, gray
  const spend = canonicalSpend(hand({ yellow: 2, blue: 5, [WILD]: 1 }), route, MAP);
  // Most-plentiful is blue (5); use 3 blue, no wilds needed.
  assert.deepEqual(spend, { blue: 3 });
});

test('canonicalSpend: gray route tops up the best color with wilds', () => {
  const route = MAP.routes.find((r) => r.id === 'bc'); // length 3, gray
  const spend = canonicalSpend(hand({ green: 2, [WILD]: 2 }), route, MAP);
  // green is the most-plentiful color; 2 green + 1 wild.
  assert.deepEqual(spend, { green: 2, [WILD]: 1 });
});

test('canonicalSpend: gray route uses all wilds when no colors held', () => {
  const route = MAP.routes.find((r) => r.id === 'bc'); // length 3, gray
  const spend = canonicalSpend(hand({ [WILD]: 4 }), route, MAP);
  assert.deepEqual(spend, { [WILD]: 3 });
});

test('canonicalSpend output is accepted by canClaimRoute', () => {
  const state = makeState({ hands: [{ yellow: 2, [WILD]: 2 }] });
  const route = MAP.routes.find((r) => r.id === 'bc');
  const spend = canonicalSpend(state.players[0].hand, route, MAP);
  assert.notEqual(spend, null);
  const res = canClaimRoute(state, 0, 'bc', spend, MAP);
  assert.equal(res.ok, true);
});

// ---------------------------------------------------------------------------
// legalMoves
// ---------------------------------------------------------------------------

test('legalMoves: start of turn enumerates draws, claims and ticket draw', () => {
  // Player 0 can afford 'cd' (green length 1) with one green card.
  const state = makeState({
    hands: [{ green: 1 }],
    faceUp: ['red', 'blue', 'green', WILD, 'yellow'],
  });
  const moves = legalMoves(state, MAP);

  // DRAW_DECK present (deck non-empty).
  assert.ok(moves.some((m) => m.type === DRAW_DECK));

  // One DRAW_FACEUP per non-null slot (5 here, including the wild).
  const faceup = moves.filter((m) => m.type === DRAW_FACEUP);
  assert.equal(faceup.length, 5);
  assert.ok(faceup.some((m) => m.slot === 3)); // the wild slot is drawable first

  // DRAW_TICKETS present (ticketDeck non-empty).
  assert.ok(moves.some((m) => m.type === DRAW_TICKETS));

  // Exactly one CLAIM_ROUTE: the green 'cd' route.
  const claims = moves.filter((m) => m.type === CLAIM_ROUTE);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].routeId, 'cd');
  assert.deepEqual(claims[0].spend, { green: 1 });
});

test('legalMoves: start of turn with no affordable routes yields no claims', () => {
  const state = makeState({ hands: [{}] }); // empty hand
  const moves = legalMoves(state, MAP);
  assert.equal(moves.filter((m) => m.type === CLAIM_ROUTE).length, 0);
});

test('legalMoves: no DRAW_DECK when deck and discard both empty', () => {
  const state = makeState({ hands: [{}], deck: [], discard: [] });
  const moves = legalMoves(state, MAP);
  assert.ok(!moves.some((m) => m.type === DRAW_DECK));
});

test('legalMoves: no DRAW_TICKETS when ticket deck is empty', () => {
  const state = makeState({ hands: [{}], ticketDeck: [] });
  const moves = legalMoves(state, MAP);
  assert.ok(!moves.some((m) => m.type === DRAW_TICKETS));
});

test('legalMoves: mid-draw allows only further draws, no face-up wild', () => {
  const state = makeState({
    hands: [{ green: 1 }],
    cardsDrawnThisTurn: 1,
    faceUp: ['red', 'blue', 'green', WILD, 'yellow'],
  });
  const moves = legalMoves(state, MAP);

  // No claims, no tickets mid-draw.
  assert.ok(!moves.some((m) => m.type === CLAIM_ROUTE));
  assert.ok(!moves.some((m) => m.type === DRAW_TICKETS));

  // DRAW_DECK allowed.
  assert.ok(moves.some((m) => m.type === DRAW_DECK));

  // Face-up draws: only the 4 non-wild slots, NOT slot 3 (the wild).
  const faceup = moves.filter((m) => m.type === DRAW_FACEUP);
  assert.equal(faceup.length, 4);
  assert.ok(!faceup.some((m) => m.slot === 3));
});

test('legalMoves: mid-draw with empty deck and discard yields only non-wild face-ups', () => {
  const state = makeState({
    hands: [{}],
    cardsDrawnThisTurn: 1,
    deck: [],
    discard: [],
    faceUp: [WILD, 'red', null, null, null],
  });
  const moves = legalMoves(state, MAP);
  assert.ok(!moves.some((m) => m.type === DRAW_DECK));
  const faceup = moves.filter((m) => m.type === DRAW_FACEUP);
  assert.equal(faceup.length, 1);
  assert.equal(faceup[0].slot, 1); // red, not the wild and not the nulls
});

test('legalMoves: pending tickets returns keep-all plus minimal subsets', () => {
  const state = makeState({
    pending: { kind: 'tickets', offered: ['t1', 't2', 't3'], minKeep: 1 },
  });
  const moves = legalMoves(state, MAP);

  // Every move is KEEP_TICKETS.
  assert.ok(moves.length > 0);
  assert.ok(moves.every((m) => m.type === KEEP_TICKETS));

  // keep-all present.
  assert.ok(moves.some((m) => m.keep.length === 3));

  // All three minimal (size-1) subsets present.
  const singles = moves.filter((m) => m.keep.length === 1).map((m) => m.keep[0]);
  assert.deepEqual(singles.sort(), ['t1', 't2', 't3']);

  // Total: keep-all (1) + three singletons (3) = 4.
  assert.equal(moves.length, 4);
});

test('legalMoves: pending tickets where minKeep equals offered size -> only keep-all', () => {
  const state = makeState({
    pending: { kind: 'tickets', offered: ['t1', 't2'], minKeep: 2 },
  });
  const moves = legalMoves(state, MAP);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].type, KEEP_TICKETS);
  assert.deepEqual(moves[0].keep, ['t1', 't2']);
});

test('legalMoves: claim is offered for the player whose turn it is', () => {
  // current = 1; only player 1 has the green card.
  const state = makeState({
    numPlayers: 2,
    hands: [{}, { green: 1 }],
    current: 1,
  });
  const claims = legalMoves(state, MAP).filter((m) => m.type === CLAIM_ROUTE);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].routeId, 'cd');
});

test('legalMoves: a 2p game does not offer a sibling already owned by the opponent', () => {
  const state = makeState({
    numPlayers: 2,
    hands: [{ red: 2, blue: 2 }, {}],
    routeOwner: { 'ab-blue': 1 },
  });
  const claims = legalMoves(state, MAP)
    .filter((m) => m.type === CLAIM_ROUTE)
    .map((m) => m.routeId);
  // ab-red is blocked (sibling owned in 2p); only 'cd'? no green -> none of ab.
  assert.ok(!claims.includes('ab-red'));
});

// ---------------------------------------------------------------------------
// isTurnOver
// ---------------------------------------------------------------------------

test('isTurnOver: false at start, false mid-draw, true after two draws', () => {
  assert.equal(isTurnOver(makeState({ cardsDrawnThisTurn: 0 })), false);
  assert.equal(isTurnOver(makeState({ cardsDrawnThisTurn: 1 })), false);
  assert.equal(isTurnOver(makeState({ cardsDrawnThisTurn: 2 })), true);
});

test('isTurnOver: false while a ticket choice is pending', () => {
  const state = makeState({
    cardsDrawnThisTurn: 2,
    pending: { kind: 'tickets', offered: ['t1'], minKeep: 1 },
  });
  assert.equal(isTurnOver(state), false);
});
