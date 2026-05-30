// ai.js — heuristic AI opponent for tickets-please.
//
// Export: chooseAction(state, map) -> Action
//
// chooseAction picks a move for the player whose turn it is (state.current). It
// is a HARD guarantee that the returned action is one of the members of
// rules.legalMoves(state, map): the AI computes a preference and then resolves it
// against the legal-move list, so it can NEVER return an illegal action. If no
// preferred move is available it falls back to the first legal move
// (legalMoves is non-empty for any live, non-ended state).
//
// DETERMINISM (mandatory): this file uses no randomness and reads no wall-clock
// time. Every decision is a pure function of (state, map). All ties are broken
// with a stable rule — the lexicographically lowest routeId, the lowest face-up
// slot, or the order legalMoves enumerates moves — so the same state always
// yields exactly the same action.
//
// ENGINE SHAPE NOTES (see CONTRACT.md §3-§5): the State does NOT embed the map,
// so map is always the final argument. A player's destination tickets live in
// state.players[i].tickets as { id, from, to, points, done } objects. A pending
// ticket-draw is state.pending = { kind:'tickets', offered, minKeep }. The
// player's remaining train pieces are player.trains. The wild card color is
// WILD ('rainbow') and a "gray" route accepts any single color. Routes carry
// endpoints a/b and a color in TRAIN_COLORS or 'gray'. graph.js provides no
// shortest-path helper, so a small BFS over map.routes is implemented here.
//
// HEURISTIC (greedy but competent), in priority order:
//   0. Pending ticket choice -> KEEP_TICKETS keeping the most useful subset
//      (respecting minKeep). Already-completed tickets are always kept; otherwise
//      the highest-value, network-reachable tickets are kept, and at minimum
//      `minKeep` tickets are kept.
//   1. Mid-draw (cardsDrawnThisTurn === 1): a second card MUST be drawn. Prefer a
//      face-up card whose color advances a targeted route; else draw blind.
//      (legalMoves already excludes face-up wilds as a second card.)
//   2. Claim a route that lies on the shortest path between the endpoints of one
//      of the player's UNFINISHED tickets. Prefer the claim advancing the most
//      still-needed ticket value; break ties by higher route score, then by the
//      lexicographically lowest routeId.
//   3. Else claim a high-value route (length >= 4) if one is available, choosing
//      the highest route score (ties -> lowest routeId).
//   4. Else, occasionally draw destination tickets (only when the player holds
//      < 2 unfinished tickets, the ticket deck is non-empty, and it is early —
//      more than half the trains remain).
//   5. Else draw cards: prefer a face-up card whose color the player most needs
//      for a targeted route; otherwise draw blind from the deck.

import { legalMoves } from '../engine/rules.js';
import { routeScore, playerNetworkConnected } from '../engine/scoring.js';
import { WILD, GRAY, TRAIN_COLORS, STARTING_TRAINS } from '../engine/constants.js';

// ---------------------------------------------------------------------------
// Small graph helpers (graph.js has no shortest-path, so BFS here over the map).
// ---------------------------------------------------------------------------

// Adjacency over the FULL map (ownership-agnostic), city -> [neighbor cityIds].
function buildAdjacency(map) {
  const adj = new Map();
  for (const city of map.cities) adj.set(city.id, []);
  for (const route of map.routes) {
    if (!adj.has(route.a)) adj.set(route.a, []);
    if (!adj.has(route.b)) adj.set(route.b, []);
    adj.get(route.a).push(route.b);
    adj.get(route.b).push(route.a);
  }
  return adj;
}

// Shortest path (fewest hops) of city ids from `a` to `b`, or null if none.
// Deterministic: neighbors are explored in a stable (sorted) order so the exact
// path returned is reproducible.
function shortestPath(adj, a, b) {
  if (a === b) return [a];
  if (!adj.has(a) || !adj.has(b)) return null;
  const prev = new Map([[a, null]]);
  const queue = [a];
  while (queue.length) {
    const cur = queue.shift();
    const neighbors = adj.get(cur).slice().sort();
    for (const nxt of neighbors) {
      if (prev.has(nxt)) continue;
      prev.set(nxt, cur);
      if (nxt === b) {
        const path = [b];
        let p = cur;
        while (p != null) {
          path.push(p);
          p = prev.get(p);
        }
        return path.reverse();
      }
      queue.push(nxt);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ticket / route helpers
// ---------------------------------------------------------------------------

function routeById(map, id) {
  return map.routes.find((r) => r.id === id) || null;
}

function isRouteClaimed(state, routeId) {
  return state.routeOwner[routeId] != null;
}

// The current player's held tickets not yet satisfied by their owned network.
function unfinishedTickets(state, pid, map) {
  const out = [];
  for (const t of state.players[pid].tickets) {
    if (!playerNetworkConnected(state, pid, t.from, t.to, map)) out.push(t);
  }
  return out;
}

// The unclaimed route directly connecting cities a and b that is cheapest to
// claim (lowest length), ties broken by lexicographically lowest id.
function bestUnclaimedRouteBetween(state, map, a, b) {
  let best = null;
  for (const r of map.routes) {
    if ((r.a === a && r.b === b) || (r.a === b && r.b === a)) {
      if (isRouteClaimed(state, r.id)) continue;
      if (
        best === null ||
        r.length < best.length ||
        (r.length === best.length && r.id < best.id)
      ) {
        best = r;
      }
    }
  }
  return best;
}

// For each unfinished ticket, find the unclaimed routes on a shortest path
// between its endpoints. Returns Map routeId -> { route, value } where value is
// the summed ticket points the route helps toward (shared routes accrue both).
function usefulRouteValues(state, pid, map, tickets) {
  const adj = buildAdjacency(map);
  const values = new Map();
  for (const t of tickets) {
    const path = shortestPath(adj, t.from, t.to);
    if (!path) continue;
    for (let i = 0; i < path.length - 1; i++) {
      const route = bestUnclaimedRouteBetween(state, map, path[i], path[i + 1]);
      if (!route) continue; // leg already owned by someone — skip
      const prev = values.get(route.id);
      if (prev) prev.value += t.points;
      else values.set(route.id, { route, value: t.points });
    }
  }
  return values;
}

// How many cards of the route's required color the player still needs (after
// applying available wilds). For gray routes, the closest concrete color.
function colorDeficitForRoute(hand, route) {
  const wild = hand[WILD] || 0;
  if (route.color !== GRAY) {
    const have = (hand[route.color] || 0) + wild;
    return { color: route.color, deficit: Math.max(0, route.length - have) };
  }
  let best = { color: TRAIN_COLORS[0], deficit: Infinity };
  for (const c of TRAIN_COLORS) {
    const have = (hand[c] || 0) + wild;
    const deficit = Math.max(0, route.length - have);
    if (deficit < best.deficit || (deficit === best.deficit && c < best.color)) {
      best = { color: c, deficit };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Legal-move lookup helpers — every choice is validated against `legal`.
// ---------------------------------------------------------------------------

function findClaim(legal, routeId) {
  return legal.find((m) => m.type === 'CLAIM_ROUTE' && m.routeId === routeId) || null;
}

function faceUpMoves(legal) {
  return legal.filter((m) => m.type === 'DRAW_FACEUP');
}

function deckMove(legal) {
  return legal.find((m) => m.type === 'DRAW_DECK') || null;
}

function ticketDrawMove(legal) {
  return legal.find((m) => m.type === 'DRAW_TICKETS') || null;
}

// Pick the best draw move given desired colors (color -> weight). Prefers a
// face-up card of a desired color (highest weight; ties -> lowest slot), then
// blind from the deck (preserves the face-up row), then any face-up draw.
// Only ever returns a legal move (or null if no draw is legal).
function chooseDraw(legal, state, desiredColors) {
  const faceUps = faceUpMoves(legal);
  let best = null;
  let bestWeight = -Infinity;
  for (const m of faceUps) {
    const color = state.faceUp[m.slot];
    let weight = 0;
    if (color === WILD) weight = 1; // wilds are broadly useful
    if (desiredColors && desiredColors.has(color)) {
      weight = Math.max(weight, 2 + desiredColors.get(color));
    }
    if (weight > bestWeight || (weight === bestWeight && best && m.slot < best.slot)) {
      best = m;
      bestWeight = weight;
    }
  }
  if (best && bestWeight > 0) return best; // a targeted/desirable face-up
  const deck = deckMove(legal);
  if (deck) return deck;
  return best || null;
}

// ---------------------------------------------------------------------------
// Pending-ticket resolution
// ---------------------------------------------------------------------------

function chooseKeep(state, map, legal) {
  const pid = state.current;
  const { offered, minKeep } = state.pending;
  const adj = buildAdjacency(map);

  // Offered entries are ticket ids; resolve them via the map's ticket list.
  const ticketLookup = new Map((map.tickets || []).map((t) => [t.id, t]));

  const ranked = offered
    .map((id) => {
      const t = ticketLookup.get(id);
      const points = t ? t.points : 0;
      const done = t
        ? playerNetworkConnected(state, pid, t.from, t.to, map)
        : false;
      const reachable = t ? !!shortestPath(adj, t.from, t.to) : false;
      return { id, points, done, reachable };
    })
    .sort((a, b) => {
      if (a.done !== b.done) return a.done ? -1 : 1; // completed first
      if (a.reachable !== b.reachable) return a.reachable ? -1 : 1;
      if (b.points !== a.points) return b.points - a.points; // higher value
      return a.id < b.id ? -1 : 1; // stable id tiebreak
    });

  // Always keep completed tickets (free points). Then fill to minKeep with the
  // best reachable remaining ones. Beyond minKeep we stay conservative —
  // unfinished tickets are a liability at game end.
  const keep = [];
  for (const r of ranked) if (r.done) keep.push(r.id);
  for (const r of ranked) {
    if (keep.length >= minKeep) break;
    if (keep.includes(r.id)) continue;
    if (r.reachable) keep.push(r.id);
  }
  for (const r of ranked) {
    if (keep.length >= minKeep) break;
    if (!keep.includes(r.id)) keep.push(r.id);
  }

  // Resolve the desired keep-set against the legal KEEP_TICKETS moves.
  const desired = new Set(keep);
  const exact = legal.find(
    (m) =>
      m.type === 'KEEP_TICKETS' &&
      m.keep.length === desired.size &&
      m.keep.every((id) => desired.has(id)),
  );
  if (exact) return exact;

  // Fall back: legal KEEP_TICKETS keeping the most desired ids, then smallest.
  const keeps = legal.filter((m) => m.type === 'KEEP_TICKETS');
  keeps.sort((a, b) => {
    const ka = a.keep.filter((id) => desired.has(id)).length;
    const kb = b.keep.filter((id) => desired.has(id)).length;
    if (kb !== ka) return kb - ka;
    if (a.keep.length !== b.keep.length) return a.keep.length - b.keep.length;
    const sa = a.keep.slice().sort().join(',');
    const sb = b.keep.slice().sort().join(',');
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
  return keeps[0] || legal[0];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function chooseAction(state, map) {
  const legal = legalMoves(state, map);
  if (legal.length === 0) {
    throw new Error('chooseAction: no legal moves available');
  }

  const pid = state.current;
  const player = state.players[pid];

  // --- 0. Pending ticket decision (the only legal action when present). ------
  if (state.pending && state.pending.kind === 'tickets') {
    return chooseKeep(state, map, legal);
  }

  // --- 1. Mid-draw: must draw a second card. -------------------------------
  if (state.cardsDrawnThisTurn === 1) {
    const desired = desiredColorsForTargets(state, pid, map);
    return chooseDraw(legal, state, desired) || legal[0];
  }

  // Targeting info shared by the remaining branches.
  const unfinished = unfinishedTickets(state, pid, map);
  const useful = usefulRouteValues(state, pid, map, unfinished);

  // --- 2. Claim a route advancing an unfinished ticket. --------------------
  let bestTicketClaim = null;
  let bestKey = null;
  for (const { route, value } of useful.values()) {
    const claim = findClaim(legal, route.id);
    if (!claim) continue;
    const key = [value, routeScore(route.length), invId(route.id)];
    if (bestKey === null || compareKeyDesc(key, bestKey) > 0) {
      bestKey = key;
      bestTicketClaim = claim;
    }
  }
  if (bestTicketClaim) return bestTicketClaim;

  // --- 3. Claim a high-value route (length >= 4) if available. -------------
  let bestBigClaim = null;
  let bestBigKey = null;
  for (const m of legal) {
    if (m.type !== 'CLAIM_ROUTE') continue;
    const route = routeById(map, m.routeId);
    if (!route || route.length < 4) continue;
    const key = [routeScore(route.length), invId(route.id)];
    if (bestBigKey === null || compareKeyDesc(key, bestBigKey) > 0) {
      bestBigKey = key;
      bestBigClaim = m;
    }
  }
  if (bestBigClaim) return bestBigClaim;

  // --- 3b. Low card supply: claim rather than draw. ------------------------
  // The draw deck is finite (110 cards). If players only ever drew, every card
  // would end up in hands and the deck+discard+face-up would empty, leaving a
  // mid-draw player with NO legal move (legalMoves only offers a deck draw when
  // deck/discard is non-empty, and never a face-up wild as a second card). To
  // keep the game flowing — and because spending cards on a claim returns them
  // to the discard pile — when the draw supply runs low we prefer claiming ANY
  // affordable route over drawing. Highest route score wins; ties -> lowest id.
  const drawSupply = state.deck.length + state.discard.length;
  if (drawSupply <= LOW_SUPPLY_THRESHOLD) {
    const claim = bestAnyClaim(legal, map);
    if (claim) return claim;
  }

  // --- 4. Occasionally draw destination tickets (early game). --------------
  const drawTickets = ticketDrawMove(legal);
  if (
    drawTickets &&
    unfinished.length < 2 &&
    state.ticketDeck.length > 0 &&
    player.trains > STARTING_TRAINS / 2 &&
    drawSupply > LOW_SUPPLY_THRESHOLD
  ) {
    return drawTickets;
  }

  // --- 5. Draw cards toward a target (face-up preferred), else blind. -------
  const desired = desiredColorsForTargets(state, pid, map);
  const draw = chooseDraw(legal, state, desired);
  if (draw) return draw;

  // --- Fallback: any claim, else first legal move. -------------------------
  // If we get here, no draw is legal (e.g. supply exhausted). Claim if we can,
  // otherwise take whatever legalMoves offers (never an illegal action).
  const claim = bestAnyClaim(legal, map);
  if (claim) return claim;
  return legal[0];
}

// When the draw supply is at or below this many cards, the AI prefers claiming
// an affordable route to drawing, so spent cards refill the discard pile and a
// mid-draw dead-end (deck+discard+face-up all empty) cannot arise.
const LOW_SUPPLY_THRESHOLD = 6;

// The legal CLAIM_ROUTE with the highest route score (ties -> lowest routeId),
// or null if no claim is currently legal.
function bestAnyClaim(legal, map) {
  let best = null;
  let bestKey = null;
  for (const m of legal) {
    if (m.type !== 'CLAIM_ROUTE') continue;
    const route = routeById(map, m.routeId);
    if (!route) continue;
    const key = [routeScore(route.length), invId(route.id)];
    if (bestKey === null || compareKeyDesc(key, bestKey) > 0) {
      bestKey = key;
      best = m;
    }
  }
  return best;
}

// Weighted map of colors the player wants, based on the unclaimed legs of its
// unfinished tickets (weighted by ticket points) and, failing that, the nearest
// high-value routes. Smaller deficit -> higher weight (closest to a claim).
function desiredColorsForTargets(state, pid, map) {
  const player = state.players[pid];
  const unfinished = unfinishedTickets(state, pid, map);
  const useful = usefulRouteValues(state, pid, map, unfinished);
  const weights = new Map();

  const add = (color, w) => {
    if (!color || color === GRAY) return;
    weights.set(color, (weights.get(color) || 0) + w);
  };

  for (const { route, value } of useful.values()) {
    const { color, deficit } = colorDeficitForRoute(player.hand, route);
    if (deficit <= 0) continue; // already claimable — don't draw toward it
    add(color, value + Math.max(0, 6 - deficit));
  }

  if (weights.size === 0) {
    for (const route of map.routes) {
      if (route.length < 4) continue;
      if (isRouteClaimed(state, route.id)) continue;
      if (player.trains < route.length) continue;
      const { color, deficit } = colorDeficitForRoute(player.hand, route);
      if (deficit <= 0) continue;
      add(color, routeScore(route.length) + Math.max(0, 6 - deficit));
    }
  }

  return weights;
}

// ---------------------------------------------------------------------------
// Stable comparison helpers
// ---------------------------------------------------------------------------

// Wrapper so a lexicographically LOWER id ranks higher in a descending compare.
function invId(id) {
  return { __invId: id };
}

function isInvId(v) {
  return v && typeof v === 'object' && '__invId' in v;
}

// Compare two key arrays. Numbers: higher first. invId: lower id first.
// Returns >0 if a ranks before b, <0 if b before a, 0 if equal.
function compareKeyDesc(a, b) {
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (isInvId(x) && isInvId(y)) {
      if (x.__invId < y.__invId) return 1;
      if (x.__invId > y.__invId) return -1;
      continue;
    }
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}
