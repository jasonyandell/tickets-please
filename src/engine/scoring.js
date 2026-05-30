// scoring.js — pure end-game / mid-game scoring functions. Zero dependencies.
//
// IMPORTANT: the canonical State shape (see CONTRACT.md §3) does NOT embed the
// map. Therefore every function here that needs the map (cities + routes) takes
// the MAP as its FINAL argument, after all state-derived args. game.js and the
// clients are responsible for passing the real MAP in.
//
// A MAP is { cities, routes, tickets } where routes is an array of
// Route = { id, a, b, length, color }. We only ever read map.routes here.
//
// All functions are pure: they never mutate state or map.

import { ROUTE_POINTS, LONGEST_PATH_BONUS } from './constants.js';
import { connected, longestTrail } from './graph.js';

/**
 * Points awarded for claiming a route of the given length.
 * Uses ROUTE_POINTS from constants.js. Unknown lengths score 0.
 */
export function routeScore(length) {
  return ROUTE_POINTS[length] ?? 0;
}

/**
 * Build a routeId -> Route lookup from a map.
 * @param {{routes: Array}} map
 */
function routeLookup(map) {
  const lookup = new Map();
  const routes = (map && map.routes) || [];
  for (const route of routes) lookup.set(route.id, route);
  return lookup;
}

/**
 * Build an `includeRoute` predicate for graph.js helpers that accepts only the
 * routes whose id is in the given player's claimedRoutes set.
 */
function ownedRoutePredicate(state, playerId) {
  const player = state.players[playerId];
  const owned = new Set(player ? player.claimedRoutes : []);
  return (route) => owned.has(route.id);
}

/**
 * True if cityA and cityB are connected using ONLY routes owned by playerId.
 * Map passed as final arg.
 */
export function playerNetworkConnected(state, playerId, cityA, cityB, map) {
  return connected(map, cityA, cityB, ownedRoutePredicate(state, playerId));
}

/**
 * True if the player's owned-route network connects the ticket's two endpoints.
 */
export function ticketComplete(state, playerId, ticket, map) {
  return playerNetworkConnected(state, playerId, ticket.from, ticket.to, map);
}

/**
 * The longest trail (sum of route lengths, no route reused) over the player's
 * owned routes. Delegates to graph.js:longestTrail.
 */
export function longestPath(state, playerId, map) {
  return longestTrail(map, ownedRoutePredicate(state, playerId));
}

/**
 * Compute final scores for all players.
 * Returns an array (parallel to state.players) of:
 *   { playerId, routePoints, ticketPoints, longestBonus, total,
 *     completedTickets, longestPath }
 *
 * - routePoints = sum of routeScore(route.length) over claimedRoutes.
 * - ticketPoints = sum of (+points if complete else -points) over tickets.
 * - longestBonus = LONGEST_PATH_BONUS for the player(s) holding the strictly
 *   maximum longestPath; ALL tied players get the full bonus. If every player's
 *   longest path is 0, no bonus is awarded.
 * - total = routePoints + ticketPoints + longestBonus.
 */
export function finalScores(state, map) {
  const lookup = routeLookup(map);

  const rows = state.players.map((player) => {
    let routePoints = 0;
    for (const routeId of player.claimedRoutes) {
      const route = lookup.get(routeId);
      if (route) routePoints += routeScore(route.length);
    }

    let ticketPoints = 0;
    let completedTickets = 0;
    for (const ticket of player.tickets) {
      const done = ticketComplete(state, player.id, ticket, map);
      if (done) {
        ticketPoints += ticket.points;
        completedTickets += 1;
      } else {
        ticketPoints -= ticket.points;
      }
    }

    const lp = longestPath(state, player.id, map);

    return {
      playerId: player.id,
      routePoints,
      ticketPoints,
      longestBonus: 0,
      total: 0,
      completedTickets,
      longestPath: lp,
    };
  });

  // Longest-path bonus: strictly-maximum length, but only if > 0. Ties share.
  const maxLen = rows.reduce((m, r) => Math.max(m, r.longestPath), 0);
  for (const row of rows) {
    if (maxLen > 0 && row.longestPath === maxLen) {
      row.longestBonus = LONGEST_PATH_BONUS;
    }
    row.total = row.routePoints + row.ticketPoints + row.longestBonus;
  }

  return rows;
}
