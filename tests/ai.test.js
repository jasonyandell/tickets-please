// ai.test.js — tests for the heuristic AI opponent.
//
// Run: cd /Users/jason/code/tickets-please && node --test tests/ai.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAP, TICKETS } from '../src/engine/map.js';
import { initGame } from '../src/engine/state.js';
import { legalMoves } from '../src/engine/rules.js';
import { applyAction } from '../src/engine/game.js';
import { chooseAction } from '../src/ai/ai.js';

// The engine resolves ticket ids via map.tickets (game.js: ticketById(map,...)),
// so the map passed to engine/AI must carry the ticket list.
const GAME_MAP = { ...MAP, tickets: TICKETS };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function newGame(seed, configs = [{}, {}]) {
  return initGame({ map: GAME_MAP, tickets: TICKETS, playerConfigs: configs, seed });
}

function assertLegal(state, action) {
  const legal = legalMoves(state, GAME_MAP);
  const found = legal.some((m) => sameAction(m, action));
  assert.ok(
    found,
    `chooseAction returned an illegal action: ${JSON.stringify(action)}\n` +
      `legal moves were: ${JSON.stringify(legal)}`,
  );
}

function sameAction(a, b) {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'DRAW_DECK':
    case 'DRAW_TICKETS':
      return true;
    case 'DRAW_FACEUP':
      return a.slot === b.slot;
    case 'CLAIM_ROUTE':
      return a.routeId === b.routeId && sameSpend(a.spend, b.spend);
    case 'KEEP_TICKETS': {
      if (a.keep.length !== b.keep.length) return false;
      const sa = a.keep.slice().sort();
      const sb = b.keep.slice().sort();
      return sa.every((x, i) => x === sb[i]);
    }
    default:
      return false;
  }
}

function sameSpend(a, b) {
  const ka = Object.keys(a).filter((k) => a[k] > 0).sort();
  const kb = Object.keys(b).filter((k) => b[k] > 0).sort();
  if (ka.length !== kb.length) return false;
  return ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}

// Overwrite a player's hand counts for the named colors (others -> 0).
function setHand(state, pid, hand) {
  for (const c of Object.keys(state.players[pid].hand)) {
    state.players[pid].hand[c] = hand[c] || 0;
  }
}

// ---------------------------------------------------------------------------
// 1. Always returns a legal action across full self-played games.
// ---------------------------------------------------------------------------

test('chooseAction always returns a legal move over full self-played games', () => {
  for (const seed of [1, 2, 3, 7, 42, 99, 123, 2024]) {
    let state = newGame(seed);
    let turns = 0;
    const maxTurns = 5000; // safety bound; we assert at least 20 turns happen
    while (state.phase !== 'ended' && turns < maxTurns) {
      const action = chooseAction(state, GAME_MAP);
      assertLegal(state, action);
      state = applyAction(state, action, GAME_MAP);
      turns += 1;
    }
    assert.ok(
      turns >= 20,
      `seed ${seed}: expected >= 20 turns, got ${turns} (phase=${state.phase})`,
    );
    assert.equal(state.phase, 'ended', `seed ${seed}: game did not end`);
  }
});

test('chooseAction drives a full game with startingTicketChoice (setup phase) to completion', () => {
  for (const seed of [1, 7, 42]) {
    let state = initGame({
      map: GAME_MAP, tickets: TICKETS,
      playerConfigs: [{ name: 'A', isAI: true }, { name: 'B', isAI: true }, { name: 'C', isAI: true }],
      seed, startingTicketChoice: true,
    });
    assert.equal(state.phase, 'setup', `seed ${seed}: opens in setup`);
    let sawPlay = false;
    let turns = 0;
    while (state.phase !== 'ended' && turns < 8000) {
      const action = chooseAction(state, GAME_MAP);
      assertLegal(state, action);
      state = applyAction(state, action, GAME_MAP);
      if (state.phase === 'play' || state.phase === 'finalRound') sawPlay = true;
      turns += 1;
    }
    assert.equal(state.phase, 'ended', `seed ${seed}: game did not end`);
    assert.ok(sawPlay, `seed ${seed}: setup transitioned into play`);
    // Each AI kept at least the starting minimum.
    for (const p of state.players) {
      assert.ok(p.tickets.length >= 2, `seed ${seed}: P${p.id} kept ${p.tickets.length} starting tickets`);
    }
  }
});

// ---------------------------------------------------------------------------
// 2. Pending ticket choice resolves with a legal KEEP_TICKETS.
// ---------------------------------------------------------------------------

test('chooseAction resolves a pending ticket choice with a legal KEEP_TICKETS', () => {
  for (const seed of [1, 5, 11, 42]) {
    // Default initGame keeps all starting tickets, so force a pending via a
    // DRAW_TICKETS action first.
    let state = newGame(seed);
    state = applyAction(state, { type: 'DRAW_TICKETS' }, GAME_MAP);
    assert.ok(state.pending && state.pending.kind === 'tickets', 'expected pending');

    const action = chooseAction(state, GAME_MAP);
    assert.equal(action.type, 'KEEP_TICKETS');
    assert.ok(
      action.keep.length >= state.pending.minKeep,
      `kept ${action.keep.length} < minKeep ${state.pending.minKeep}`,
    );
    assertLegal(state, action);

    const next = applyAction(state, action, GAME_MAP);
    assert.equal(next.pending, null);
  }
});

// ---------------------------------------------------------------------------
// 3. Claims an obviously-good route that completes an unfinished ticket.
// ---------------------------------------------------------------------------

test('chooseAction claims a route that completes an unfinished ticket', () => {
  const state = newGame(42);
  const pid = state.current;

  // Give the player a single ticket completable by claiming one route. The
  // length-1 gray route sea-por directly connects Seattle and Portland.
  const ticket = TICKETS.find((t) => t.id === 't-sea-sfo'); // realistic ticket
  // Use a one-route ticket instead: build a custom ticket Seattle<->Portland.
  const directTicket = { id: 't-sea-por', from: 'sea', to: 'por', points: 5, done: false };
  state.players[pid].tickets = [directTicket];

  // Give exactly enough cards to claim sea-por (length 1, gray) and nothing else
  // tempting. One red card claims the gray length-1 route.
  setHand(state, pid, { red: 1 });
  state.cardsDrawnThisTurn = 0;

  // Sanity: sea-por is claimable.
  const legal = legalMoves(state, GAME_MAP);
  const target = legal.find(
    (m) => m.type === 'CLAIM_ROUTE' && m.routeId === 'sea-por',
  );
  assert.ok(target, 'expected sea-por to be claimable in this fixture');

  const action = chooseAction(state, GAME_MAP);
  assert.equal(action.type, 'CLAIM_ROUTE');
  assert.equal(action.routeId, 'sea-por');
  assertLegal(state, action);

  const next = applyAction(state, action, GAME_MAP);
  assert.ok(next.players[pid].claimedRoutes.includes('sea-por'));
  // Touch `ticket` so the import-style lookup is not flagged unused.
  assert.ok(ticket);
});

test('chooseAction prefers a ticket-completing route over an unrelated big route', () => {
  const state = newGame(7);
  const pid = state.current;

  // Ticket sea<->por completable by the length-1 gray route sea-por.
  state.players[pid].tickets = [
    { id: 't-sea-por', from: 'sea', to: 'por', points: 6, done: false },
  ];

  // Hand can claim BOTH sea-por (1 of any color) and a big length-4 route.
  // Give 1 red (for sea-por) plus 4 blue (e.g. bil-den length-4 blue).
  setHand(state, pid, { red: 1, blue: 4 });
  state.cardsDrawnThisTurn = 0;

  // Confirm a length-4 route is genuinely claimable, so the test is meaningful.
  const legal = legalMoves(state, GAME_MAP);
  const bigClaim = legal.find((m) => {
    if (m.type !== 'CLAIM_ROUTE') return false;
    const r = GAME_MAP.routes.find((x) => x.id === m.routeId);
    return r && r.length >= 4;
  });
  assert.ok(bigClaim, 'expected at least one length>=4 route claimable');

  const action = chooseAction(state, GAME_MAP);
  assert.equal(action.type, 'CLAIM_ROUTE');
  assert.equal(action.routeId, 'sea-por');
});

// ---------------------------------------------------------------------------
// 4. Determinism: same state -> same action.
// ---------------------------------------------------------------------------

test('chooseAction is deterministic: same state -> same action', () => {
  for (const seed of [1, 2, 3, 42, 777]) {
    let state = newGame(seed);
    for (let i = 0; i < 60 && state.phase !== 'ended'; i++) {
      const a1 = chooseAction(state, GAME_MAP);
      const a2 = chooseAction(state, GAME_MAP);
      assert.deepEqual(a1, a2, `non-deterministic at seed ${seed} step ${i}`);
      state = applyAction(state, a1, GAME_MAP);
    }
  }
});

// ---------------------------------------------------------------------------
// 5. Draws a needed face-up color when no claim is available.
// ---------------------------------------------------------------------------

test('chooseAction draws a needed face-up color when no claim is available', () => {
  const state = newGame(11);
  const pid = state.current;

  // Give the player 2 unfinished tickets so the "draw destination tickets"
  // branch (only fires with < 2 unfinished tickets) is suppressed and we
  // exercise drawing train cards toward a target. sea-boi is a length-3 RED
  // route on the shortest path between Seattle and Boise.
  state.players[pid].tickets = [
    { id: 't-sea-boi', from: 'sea', to: 'boi', points: 6, done: false },
    { id: 't-sea-hel', from: 'sea', to: 'hel', points: 7, done: false },
  ];

  // Empty hand: cannot claim anything. The sea-boi target wants red. Put a red
  // face-up so the AI should grab the color it needs.
  setHand(state, pid, {});
  state.faceUp = ['red', 'green', 'green', 'green', 'green'];
  state.cardsDrawnThisTurn = 0;

  const action = chooseAction(state, GAME_MAP);
  assert.ok(
    action.type === 'DRAW_FACEUP' || action.type === 'DRAW_DECK',
    `expected a draw, got ${action.type}`,
  );
  if (action.type === 'DRAW_FACEUP') {
    assert.equal(state.faceUp[action.slot], 'red', 'should grab the needed red');
  }
  assertLegal(state, action);
});

// ---------------------------------------------------------------------------
// 6. Mid-draw: must draw a (legal) second card.
// ---------------------------------------------------------------------------

test('chooseAction draws a legal second card mid-draw', () => {
  const state = newGame(3);
  state.cardsDrawnThisTurn = 1; // simulate one card already drawn this turn
  state.faceUp = ['red', 'rainbow', 'blue', 'green', 'black'];

  const legal = legalMoves(state, GAME_MAP);
  // Mid-draw legal moves must exclude any face-up wild.
  assert.ok(
    legal.every((m) => !(m.type === 'DRAW_FACEUP' && state.faceUp[m.slot] === 'rainbow')),
    'legalMoves should exclude a face-up wild as second card',
  );

  const action = chooseAction(state, GAME_MAP);
  assert.ok(
    action.type === 'DRAW_DECK' || action.type === 'DRAW_FACEUP',
    `expected a draw mid-turn, got ${action.type}`,
  );
  if (action.type === 'DRAW_FACEUP') {
    assert.notEqual(state.faceUp[action.slot], 'rainbow');
  }
  assertLegal(state, action);
});
