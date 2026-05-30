// Move legality and route-claim validation. See CONTRACT.md §5.
//
// This module is PURE: it only reads `state` and `map`, never mutates them, and
// never performs I/O or randomness. It does not apply moves — it only answers
// "what is legal right now?" (`legalMoves`) and "may this exact claim happen?"
// (`canClaimRoute`). The actual state transitions live in game.js.
//
// MAP ARGUMENT
// ------------
// Routes, their colors, lengths and parallel-sibling relationships live in the
// map (see CONTRACT.md §2), NOT in `state`. State only tracks ownership via
// `state.routeOwner`. Therefore every function here that needs route metadata
// takes the map as an EXPLICIT argument:
//
//   legalMoves(state, map)
//   canClaimRoute(state, playerId, routeId, spend, map)
//   canonicalSpend(hand, route, map)
//
// Callers (game.js, ai.js, the UI) already hold the active map, so threading it
// in keeps this module free of any global/singleton map reference and keeps unit
// tests able to use tiny inline fixture maps.

import {
  WILD,
  GRAY,
  TRAIN_COLORS,
} from './constants.js';
import {
  DRAW_DECK,
  DRAW_FACEUP,
  CLAIM_ROUTE,
  DRAW_TICKETS,
  KEEP_TICKETS,
  PASS,
} from './actions.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Look up a route object by id in the map. Returns undefined if absent. */
function findRoute(map, routeId) {
  return map.routes.find((r) => r.id === routeId);
}

/** Do two routes connect the same unordered city pair? */
function sameEndpoints(a, b) {
  return (
    (a.a === b.a && a.b === b.b) || (a.a === b.b && a.b === b.a)
  );
}

/**
 * Find the parallel sibling of a route, if any. A sibling is a *different*
 * route that shares the same unordered city pair. Per the map invariants a
 * route has at most one sibling, and double routes carry `parallel: true`.
 * @returns {object|undefined}
 */
function findSibling(map, route) {
  if (!route.parallel) return undefined;
  return map.routes.find(
    (r) => r.id !== route.id && r.parallel && sameEndpoints(r, route)
  );
}

/** Number of cards in a spend tally (sum of counts). */
function spendTotal(spend) {
  let n = 0;
  for (const k of Object.keys(spend)) n += spend[k] || 0;
  return n;
}

/** How many wilds a spend uses. */
function wildsIn(spend) {
  return spend[WILD] || 0;
}

/**
 * The non-wild colors actually used in a spend (count > 0), as an array.
 */
function nonWildColors(spend) {
  const out = [];
  for (const k of Object.keys(spend)) {
    if (k === WILD) continue;
    if ((spend[k] || 0) > 0) out.push(k);
  }
  return out;
}

// ---------------------------------------------------------------------------
// canClaimRoute
// ---------------------------------------------------------------------------

/**
 * Validate that `playerId` may claim `routeId` paying exactly `spend`.
 *
 * Checks, in order, ALL of:
 *  - the route exists in the map;
 *  - the route is not already owned (state.routeOwner[routeId] is undefined);
 *  - double-route sibling rule (depends on player count):
 *      * a player may NEVER own both siblings of a parallel pair;
 *      * in a 2- or 3-player game the sibling must be UNOWNED by anyone;
 *      * in a 4- or 5-player game the sibling may be owned by *another* player.
 *  - the player has at least `route.length` trains remaining;
 *  - the spend counts sum to exactly `route.length`;
 *  - the player actually holds every card in `spend` (hand tally >= spend);
 *  - color rules:
 *      * colored route: every non-wild card spent equals route.color;
 *      * gray route: all non-wild cards spent are a SINGLE color.
 *    Wilds are always allowed and may substitute for any color.
 *
 * @param {object} state
 * @param {number} playerId
 * @param {string|number} routeId
 * @param {{[color:string]:number}} spend
 * @param {object} map
 * @returns {{ok:boolean, reason?:string}}
 */
export function canClaimRoute(state, playerId, routeId, spend, map) {
  const route = findRoute(map, routeId);
  if (!route) return { ok: false, reason: 'route does not exist' };

  // Already owned?
  if (state.routeOwner[routeId] != null) {
    return { ok: false, reason: 'route already claimed' };
  }

  const player = state.players[playerId];
  if (!player) return { ok: false, reason: 'unknown player' };

  // Double-route / parallel-sibling rule.
  const sibling = findSibling(map, route);
  if (sibling) {
    const siblingOwner = state.routeOwner[sibling.id];
    if (siblingOwner != null) {
      // A player may never own both siblings.
      if (siblingOwner === playerId) {
        return { ok: false, reason: 'you already own the parallel route' };
      }
      // In small games (2-3 players) the second parallel track is closed.
      if (state.players.length < 4) {
        return {
          ok: false,
          reason: 'parallel route is blocked in games with fewer than 4 players',
        };
      }
      // 4-5 players: another player owning the sibling is fine.
    }
  }

  // Trains available.
  if (player.trains < route.length) {
    return { ok: false, reason: 'not enough trains' };
  }

  // Spend size must equal route length exactly.
  const total = spendTotal(spend);
  if (total !== route.length) {
    return {
      ok: false,
      reason: `spend must total ${route.length} cards (got ${total})`,
    };
  }

  // Player must actually hold every card in the spend.
  for (const color of Object.keys(spend)) {
    const want = spend[color] || 0;
    if (want < 0) return { ok: false, reason: 'negative spend' };
    if (want === 0) continue;
    const have = player.hand[color] || 0;
    if (have < want) {
      return { ok: false, reason: `you do not hold enough ${color}` };
    }
  }

  // Color rules on the non-wild cards.
  const usedColors = nonWildColors(spend);
  if (route.color === GRAY) {
    // Any single color (plus wilds). Wilds-only is also fine.
    if (usedColors.length > 1) {
      return {
        ok: false,
        reason: 'a gray route must be paid with a single color (plus wilds)',
      };
    }
  } else {
    // Colored route: every non-wild card must match route.color.
    for (const c of usedColors) {
      if (c !== route.color) {
        return {
          ok: false,
          reason: `a ${route.color} route accepts only ${route.color} cards or wilds`,
        };
      }
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// canonicalSpend
// ---------------------------------------------------------------------------

/**
 * Compute THE canonical spend a player would use to claim `route`, or null if
 * they cannot afford it from `hand`.
 *
 * Canonicalization rules (deterministic, minimal-wild):
 *  - Prefer paying with matching color cards; only fill the remainder with
 *    wilds. This minimises wild usage, which is what a sensible player wants.
 *  - Colored route: use up to `length` cards of route.color, then top up with
 *    wilds.
 *  - Gray route: pick the player's most-plentiful single non-wild color (ties
 *    broken by TRAIN_COLORS order for determinism) that, combined with wilds,
 *    can cover the length; among colors that can complete the route prefer the
 *    one needing the FEWEST wilds (i.e. the one the player holds most of), then
 *    fill with wilds.
 *
 * The returned spend always satisfies canClaimRoute's spend-size and color
 * constraints (caller must still confirm ownership/trains via canClaimRoute).
 *
 * @param {{[color:string]:number}} hand
 * @param {object} route
 * @param {object} _map - unused but accepted for signature symmetry/future use.
 * @returns {{[color:string]:number}|null}
 */
export function canonicalSpend(hand, route, _map) {
  const length = route.length;
  const wilds = hand[WILD] || 0;

  if (route.color === GRAY) {
    // Choose the color that lets us pay with the fewest wilds. That is the
    // color we hold the most of (capped at length). Deterministic tie-break by
    // TRAIN_COLORS order.
    let best = null;
    for (const color of TRAIN_COLORS) {
      const have = hand[color] || 0;
      if (have === 0) continue;
      const useColor = Math.min(have, length);
      const needWild = length - useColor;
      if (needWild > wilds) continue; // can't complete with this color
      if (best === null || useColor > best.useColor) {
        best = { color, useColor, needWild };
      }
    }
    if (best !== null) {
      const spend = {};
      if (best.useColor > 0) spend[best.color] = best.useColor;
      if (best.needWild > 0) spend[WILD] = best.needWild;
      return spend;
    }
    // No colored cards: pay entirely with wilds if possible.
    if (wilds >= length) return { [WILD]: length };
    return null;
  }

  // Colored route.
  const haveColor = hand[route.color] || 0;
  const useColor = Math.min(haveColor, length);
  const needWild = length - useColor;
  if (needWild > wilds) return null;
  const spend = {};
  if (useColor > 0) spend[route.color] = useColor;
  if (needWild > 0) spend[WILD] = needWild;
  return spend;
}

// ---------------------------------------------------------------------------
// legalMoves
// ---------------------------------------------------------------------------

/**
 * Enumerate legal actions for `state.current` given the current mid-turn state.
 *
 * Returned set, by situation:
 *
 *  1. PENDING TICKETS (state.pending && state.pending.kind === 'tickets'):
 *     Resolving the ticket draw is the only thing the player may do. We return:
 *       - one KEEP_TICKETS keeping ALL offered tickets ("keep all"); and
 *       - one KEEP_TICKETS for each minimal-size (exactly minKeep) subset of the
 *         offered tickets.
 *     (This is a representative, non-exhaustive set per the contract — it always
 *     includes the maximum-keep and every minimum-keep choice. The AI/UI can
 *     construct any other valid subset themselves.) If minKeep >= offered.length
 *     only the keep-all action is returned (and it IS the minimal subset).
 *
 *  2. MID-DRAW (no pending, cardsDrawnThisTurn === 1):
 *     The player has drawn exactly one (non-wild) card and may take a second
 *     card only. Legal:
 *       - DRAW_DECK if deck or discard is non-empty;
 *       - DRAW_FACEUP for every non-null, NON-wild face-up slot (you may not
 *         take a face-up wild as a second card).
 *     No claims, no ticket draws.
 *
 *  3. START OF TURN (no pending, cardsDrawnThisTurn === 0):
 *       - DRAW_DECK if deck or discard is non-empty;
 *       - DRAW_FACEUP for every non-null face-up slot (wild included — taking a
 *         face-up wild as the FIRST card is legal and ends the turn);
 *       - one canonical CLAIM_ROUTE per route the player can currently claim,
 *         using canonicalSpend (minimal-wild) — validated through canClaimRoute;
 *       - DRAW_TICKETS if state.ticketDeck has at least one ticket.
 *
 * @param {object} state
 * @param {object} map
 * @returns {Array<object>} actions
 */
export function legalMoves(state, map) {
  const moves = [];

  // --- 0. A finished game has no legal moves ------------------------------
  // (applyAction rejects everything once phase === 'ended'; legalMoves must
  // agree so callers like the AI never see a move the reducer will throw on.)
  if (state.phase === 'ended') return moves;

  // --- 1. Pending ticket choice -------------------------------------------
  if (state.pending && state.pending.kind === 'tickets') {
    const { offered, minKeep } = state.pending;
    const keepAll = offered.slice();
    moves.push({ type: KEEP_TICKETS, keep: keepAll });

    // Each minimal subset of size exactly minKeep (skip if that equals keepAll).
    if (minKeep < offered.length && minKeep >= 1) {
      for (const subset of combinations(offered, minKeep)) {
        moves.push({ type: KEEP_TICKETS, keep: subset });
      }
    }
    return moves;
  }

  const player = state.players[state.current];

  // --- 2. Mid-draw (one card already drawn) -------------------------------
  if (state.cardsDrawnThisTurn === 1) {
    if (state.deck.length > 0 || state.discard.length > 0) {
      moves.push({ type: DRAW_DECK });
    }
    for (let slot = 0; slot < state.faceUp.length; slot++) {
      const card = state.faceUp[slot];
      if (card == null) continue;
      if (card === WILD) continue; // cannot take a face-up wild as 2nd card
      moves.push({ type: DRAW_FACEUP, slot });
    }
    // No legal second draw (deck+discard exhausted, only wild/empty face-up
    // slots remain): the player forfeits the second draw via PASS. legalMoves
    // must never return [] for a live state. (game.js also auto-ends a turn when
    // no second draw is possible, so reaching here is a belt-and-suspenders case.)
    if (moves.length === 0) {
      moves.push({ type: PASS });
    }
    return moves;
  }

  // --- 3. Start of turn ---------------------------------------------------
  // Draw blind.
  if (state.deck.length > 0 || state.discard.length > 0) {
    moves.push({ type: DRAW_DECK });
  }
  // Draw any face-up card (wild allowed as first card).
  for (let slot = 0; slot < state.faceUp.length; slot++) {
    if (state.faceUp[slot] == null) continue;
    moves.push({ type: DRAW_FACEUP, slot });
  }
  // Claim routes.
  for (const route of map.routes) {
    if (state.routeOwner[route.id] != null) continue;
    const spend = canonicalSpend(player.hand, route, map);
    if (spend === null) continue;
    const check = canClaimRoute(state, state.current, route.id, spend, map);
    if (check.ok) {
      moves.push({ type: CLAIM_ROUTE, routeId: route.id, spend });
    }
  }
  // Draw tickets.
  if (state.ticketDeck.length >= 1) {
    moves.push({ type: DRAW_TICKETS });
  }

  // If the player has NO legal action (deck+discard exhausted, no drawable
  // face-up card, no claimable route, no tickets to draw), the only legal move
  // is to PASS — otherwise the game would dead-end. Mirrors the official rule
  // that a player who cannot act forfeits their turn.
  if (moves.length === 0) {
    moves.push({ type: PASS });
  }

  return moves;
}

/**
 * Generate all size-`k` combinations of `arr` (order-preserving). Used for the
 * minimal ticket-keep subsets. Small inputs only (offered tickets are <= 3).
 * @template T
 * @param {T[]} arr
 * @param {number} k
 * @returns {T[][]}
 */
function combinations(arr, k) {
  const result = [];
  const combo = [];
  const helper = (start) => {
    if (combo.length === k) {
      result.push(combo.slice());
      return;
    }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      helper(i + 1);
      combo.pop();
    }
  };
  if (k >= 0 && k <= arr.length) helper(0);
  return result;
}

// ---------------------------------------------------------------------------
// isTurnOver
// ---------------------------------------------------------------------------

/**
 * Optional helper: is the current player's turn finished?
 *
 * A draw-cards turn ends once two cards have been drawn (cardsDrawnThisTurn>=2),
 * OR after a single face-up wild was taken (which the game orchestrator records
 * by setting cardsDrawnThisTurn to 2). Claiming a route or resolving a ticket
 * draw is handled by game.js advancing `current`; this helper only reports the
 * within-turn draw situation.
 *
 * A turn is NOT over while a ticket choice is pending (the player must still
 * resolve it), so this returns false whenever state.pending is set.
 *
 * @param {object} state
 * @returns {boolean}
 */
export function isTurnOver(state) {
  if (state.pending) return false;
  return state.cardsDrawnThisTurn >= 2;
}
