// game.js — the pure deterministic game orchestrator. See CONTRACT.md §7.
//
// applyAction(state, action, map) -> new state. Never mutates its inputs: it
// clones via state.js:cloneState and returns the clone. Throws an Error on any
// illegal action. The map is threaded through to rules.js / scoring.js, which
// (per their own contracts) take the map as an explicit final argument because
// the canonical State shape does not embed it.
//
// Determinism: any randomness (deck reshuffle, face-up re-deal) uses an rng
// seeded from state.seed + state.moveCount, so the same seed + action sequence
// always yields byte-for-byte identical state.

import { cloneState, refillFaceUp } from './state.js';
import { makeRng, shuffle } from './rng.js';
import { canClaimRoute, canonicalSpend, legalMoves } from './rules.js';
import { routeScore, finalScores } from './scoring.js';
import {
  DRAW_DECK,
  DRAW_FACEUP,
  CLAIM_ROUTE,
  DRAW_TICKETS,
  KEEP_TICKETS,
  PASS,
} from './actions.js';
import { WILD, TICKETS_DEAL, TICKETS_KEEP_MIN, ENDGAME_TRAIN_THRESHOLD } from './constants.js';

// Build a deterministic rng keyed off the current state. Used whenever the
// engine needs randomness during a move (deck reshuffle, face-up refill).
function turnRng(state) {
  return makeRng((state.seed >>> 0) + (state.moveCount >>> 0));
}

function routeById(map, routeId) {
  return map.routes.find((r) => r.id === routeId);
}

function ticketById(map, ticketId) {
  return (map.tickets || []).find((t) => t.id === ticketId);
}

function addToHand(player, color, n = 1) {
  player.hand[color] = (player.hand[color] || 0) + n;
}

function removeFromHand(player, color, n) {
  const have = player.hand[color] || 0;
  const left = have - n;
  if (left <= 0) delete player.hand[color];
  else player.hand[color] = left;
}

// Ensure the deck has at least one card to draw; reshuffle discard into deck
// using a seeded rng when the deck is empty. Mutates the (cloned) state.
function ensureDeck(state, rng) {
  if (state.deck.length === 0 && state.discard.length > 0) {
    state.deck = shuffle(state.discard, rng);
    state.discard = [];
  }
}

// Draw the top card of the deck. The deck's "top" is the END of the array
// (state.js documents top = end of array); deck.pop() takes it.
function drawTop(state) {
  return state.deck.pop();
}

// Can the current player legally draw a SECOND train card right now? A second
// draw may come from the deck (blind — reshuffles discard if needed) or from any
// non-wild face-up card (a face-up wild may not be taken as the second card).
// Mirrors the mid-draw branch of rules.legalMoves. Used to auto-end a turn that
// has no legal continuation, so the game can never dead-end after the first draw.
function canDrawSecond(state) {
  if (state.deck.length > 0 || state.discard.length > 0) return true;
  return state.faceUp.some((c) => c != null && c !== WILD);
}

// Transition a (cloned) state to phase 'ended' and compute the winner(s) as the
// player(s) with the maximum total in finalScores (ties => multiple winners).
function finalizeGame(state, map, reason) {
  state.phase = 'ended';
  const scores = finalScores(state, map);
  let max = -Infinity;
  for (const s of scores) if (s.total > max) max = s.total;
  state.winner = scores.filter((s) => s.total === max).map((s) => s.playerId);
  state.log.push(
    `Game ended${reason ? ` (${reason})` : ''}. Winner(s): ${state.winner.join(', ')}`
  );
}

// Could ANY player legally claim ANY route right now? Used only when a PASS is
// being applied (deck/discard/face-up/tickets are all exhausted, so claiming is
// the only remaining way for the game to make progress). If no one can claim,
// the game state is frozen forever and must end.
function anyPlayerCanClaim(state, map) {
  for (const p of state.players) {
    for (const route of map.routes) {
      if (state.routeOwner[route.id] != null) continue;
      const spend = canonicalSpend(p.hand, route, map);
      if (!spend) continue;
      if (canClaimRoute(state, p.id, route.id, spend, map).ok) return true;
    }
  }
  return false;
}

// Advance the game to the next player and handle end-game bookkeeping.
// `mover` is the player object (in the cloned state) who just acted.
function endTurn(state, map, mover) {
  state.moveCount += 1;
  state.cardsDrawnThisTurn = 0;

  // Snapshot whether the final round was ALREADY active before this turn. Only
  // turns taken while the round is already active consume a final-turn slot —
  // the trigger turn starts the round but does NOT consume one, so every player
  // (including the trigger) gets exactly one more turn.
  const wasFinalRound = state.phase === 'finalRound';

  // End-game trigger: the first time a player ends a turn at/below the train
  // threshold, grant exactly one more turn to every player (incl. the trigger).
  if (state.phase === 'play' && mover.trains <= ENDGAME_TRAIN_THRESHOLD) {
    state.phase = 'finalRound';
    state.finalTurnsLeft = state.players.length;
  }

  // Advance current (wrap).
  state.current = (state.current + 1) % state.players.length;

  if (wasFinalRound) {
    state.finalTurnsLeft -= 1;
    if (state.finalTurnsLeft <= 0) {
      state.finalTurnsLeft = 0;
      finalizeGame(state, map);
    }
  }
}

export function applyAction(state, action, map) {
  if (!action || typeof action.type !== 'string') {
    throw new Error('applyAction: missing action.type');
  }
  if (state.phase === 'ended') {
    throw new Error('applyAction: game already ended');
  }

  const next = cloneState(state);
  const player = next.players[next.current];

  // --- Mid-turn legality gates --------------------------------------------
  if (next.pending) {
    // When tickets are pending, only KEEP_TICKETS is legal.
    if (action.type !== KEEP_TICKETS) {
      throw new Error('applyAction: must resolve pending tickets (KEEP_TICKETS) first');
    }
  } else if (next.cardsDrawnThisTurn === 1) {
    // After the first card, only a further deck draw or a non-wild face-up draw.
    if (action.type === DRAW_DECK) {
      // ok
    } else if (action.type === DRAW_FACEUP) {
      const card = next.faceUp[action.slot];
      if (card == null) throw new Error('applyAction: empty face-up slot ' + action.slot);
      if (card === WILD) {
        throw new Error('applyAction: cannot take a face-up wild as the second draw');
      }
    } else {
      throw new Error('applyAction: only a second card draw is legal after the first');
    }
  }

  switch (action.type) {
    case DRAW_DECK: {
      const rng = turnRng(next);
      ensureDeck(next, rng);
      if (next.deck.length === 0) {
        throw new Error('applyAction: no cards to draw');
      }
      const card = drawTop(next);
      addToHand(player, card);
      next.cardsDrawnThisTurn += 1;
      next.log.push(`P${player.id} drew a card from the deck`);

      // End the turn at 2, or early if no legal second draw remains.
      if (next.cardsDrawnThisTurn >= 2 || !canDrawSecond(next)) {
        endTurn(next, map, player);
      }
      return next;
    }

    case DRAW_FACEUP: {
      const slot = action.slot;
      const card = next.faceUp[slot];
      if (card == null) throw new Error('applyAction: empty face-up slot ' + slot);
      const wasFirst = next.cardsDrawnThisTurn === 0;

      if (card === WILD && !wasFirst) {
        // Guarded above too, but defend regardless.
        throw new Error('applyAction: a face-up wild may only be taken as the first draw');
      }

      addToHand(player, card);
      // Remove the taken card (leave the slot empty) and refill the row.
      next.faceUp[slot] = null;
      const rng = turnRng(next);
      const refilled = refillFaceUp(
        { faceUp: next.faceUp, deck: next.deck, discard: next.discard },
        rng,
      );
      next.faceUp = refilled.faceUp;
      next.deck = refilled.deck;
      next.discard = refilled.discard;

      if (card === WILD) {
        next.log.push(`P${player.id} took a face-up wild`);
        endTurn(next, map, player);
        return next;
      }

      next.cardsDrawnThisTurn += 1;
      next.log.push(`P${player.id} took a face-up ${card}`);
      // End at 2, or early if no legal second draw remains (prevents a dead-end
      // where one card is drawn but no further draw is possible).
      if (next.cardsDrawnThisTurn >= 2 || !canDrawSecond(next)) {
        endTurn(next, map, player);
      }
      return next;
    }

    case CLAIM_ROUTE: {
      const { routeId, spend } = action;
      // Validate (throws on illegal).
      const check = canClaimRoute(next, player.id, routeId, spend, map);
      if (!check.ok) {
        throw new Error('applyAction: illegal claim — ' + (check.reason || 'unknown'));
      }
      const route = routeById(map, routeId);

      // Remove spent cards from hand to discard.
      for (const color of Object.keys(spend)) {
        const n = spend[color] || 0;
        if (n <= 0) continue;
        removeFromHand(player, color, n);
        for (let i = 0; i < n; i++) next.discard.push(color);
      }

      player.claimedRoutes.push(routeId);
      next.routeOwner[routeId] = player.id;
      player.trains -= route.length;
      player.score += routeScore(route.length);

      next.log.push(`P${player.id} claimed ${routeId} (length ${route.length})`);
      endTurn(next, map, player);
      return next;
    }

    case DRAW_TICKETS: {
      if (next.ticketDeck.length === 0) {
        throw new Error('applyAction: no tickets to draw');
      }
      const offered = next.ticketDeck.splice(0, TICKETS_DEAL);
      next.pending = { kind: 'tickets', offered, minKeep: TICKETS_KEEP_MIN };
      next.log.push(`P${player.id} drew ${offered.length} tickets`);
      // Turn does NOT end; only KEEP_TICKETS is legal next.
      return next;
    }

    case KEEP_TICKETS: {
      const pending = next.pending;
      if (!pending || pending.kind !== 'tickets') {
        throw new Error('applyAction: no pending tickets to keep');
      }
      const keep = action.keep || [];
      const offeredSet = new Set(pending.offered);
      for (const id of keep) {
        if (!offeredSet.has(id)) {
          throw new Error('applyAction: kept ticket not offered: ' + id);
        }
      }
      if (new Set(keep).size !== keep.length) {
        throw new Error('applyAction: duplicate ticket in keep');
      }
      if (keep.length < pending.minKeep) {
        throw new Error('applyAction: must keep at least ' + pending.minKeep + ' tickets');
      }

      const keepSet = new Set(keep);
      for (const id of keep) {
        const t = ticketById(map, id);
        if (!t) throw new Error('applyAction: unknown ticket ' + id);
        player.tickets.push({ ...t, done: false });
      }
      // Return the rest to the BOTTOM of the ticket deck.
      const returned = pending.offered.filter((id) => !keepSet.has(id));
      next.ticketDeck.push(...returned);

      next.pending = null;
      next.log.push(`P${player.id} kept ${keep.length} tickets`);
      endTurn(next, map, player);
      return next;
    }

    case PASS: {
      // PASS is legal only when the player is genuinely out of options. Confirm
      // by checking the legal-move set is exactly [PASS].
      const lm = legalMoves(next, map);
      const forced = lm.length === 1 && lm[0].type === PASS;
      if (!forced) {
        throw new Error('applyAction: PASS is illegal while other moves exist');
      }
      next.log.push(`P${player.id} passed (no legal action)`);
      // When a PASS happens, deck+discard+face-up+tickets are all exhausted, so
      // the only way the game can progress is another player claiming a route.
      // If nobody can claim, the state is frozen forever — end the game now.
      if (!anyPlayerCanClaim(next, map)) {
        next.moveCount += 1;
        next.cardsDrawnThisTurn = 0;
        finalizeGame(next, map, 'no player can move');
        return next;
      }
      endTurn(next, map, player);
      return next;
    }

    default:
      throw new Error('applyAction: unknown action type ' + action.type);
  }
}

export function applyActions(state, actions, map) {
  return actions.reduce((s, a) => applyAction(s, a, map), state);
}
