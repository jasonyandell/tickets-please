// viewModel.js — PURE derivation of everything the UI renders from engine state.
//
// This is the keystone the whole UI sits on: a single function, buildViewModel,
// turns raw engine state into a plain, render-ready object. It contains NO DOM
// access, NO globals, and NO side effects, so it is fully unit-testable and
// deterministic (same inputs => same output).
//
// It may read engine state DEFENSIVELY (mirroring the helpers that used to live
// inline in main.js) and may call the PURE engine derivation functions
// (rules.legalMoves / canonicalSpend / canClaimRoute, scoring.ticketComplete) to
// answer "what is legal / affordable right now?" — it never mutates anything.
//
// HOTSEAT PRIVACY: only the active human's own hand colors + ticket details are
// populated; every other player exposes counts only. On game over everything is
// revealed (the endgame scoreboard shows all hands/tickets).

import { legalMoves, canonicalSpend, canClaimRoute } from '../engine/rules.js';
import { ticketComplete } from '../engine/scoring.js';
import {
  CLAIM_ROUTE,
  DRAW_DECK,
  DRAW_TICKETS,
  PASS,
} from '../engine/actions.js';
import {
  getRoutes,
  routeId as routeIdOf,
  routeFrom,
  routeTo,
  routeLength,
  routeColor,
} from './layout.js';

// ---------------------------------------------------------------------------
// Defensive state accessors (mirror the ones that lived in main.js)
// ---------------------------------------------------------------------------

function getPlayers(state) {
  if (!state) return [];
  if (Array.isArray(state.players)) return state.players;
  if (state.players && typeof state.players === 'object') return Object.values(state.players);
  return [];
}

// Map a player id (whatever its type) to a 0-based index.
function playerIndexOf(players, playerId) {
  for (let i = 0; i < players.length; i++) {
    const pid = players[i] && players[i].id != null ? players[i].id : i;
    if (pid === playerId || String(pid) === String(playerId)) return i;
  }
  if (typeof playerId === 'number') return playerId;
  return 0;
}

function currentPlayerIndex(state, players) {
  if (!state) return 0;
  const cur = state.current ?? state.currentPlayer ?? state.turn ?? state.activePlayer;
  if (cur == null) return 0;
  if (typeof cur === 'number') return cur;
  return playerIndexOf(players, cur);
}

function playerHand(player) {
  if (!player) return {};
  return player.hand ?? player.cards ?? player.trainCards ?? {};
}

function handTotal(hand) {
  let n = 0;
  for (const k in hand) n += hand[k] || 0;
  return n;
}

// Hand as { color: count } with zero-count colors dropped (a fresh object, not
// the player's live hand reference).
function handByColor(hand) {
  const out = {};
  for (const k in hand) {
    const v = hand[k] || 0;
    if (v > 0) out[k] = v;
  }
  return out;
}

function ticketFrom(t) {
  return t.from ?? t.a ?? t.cityA ?? (Array.isArray(t.cities) && t.cities[0]);
}
function ticketTo(t) {
  return t.to ?? t.b ?? t.cityB ?? (Array.isArray(t.cities) && t.cities[1]);
}
function ticketPoints(t) {
  return t.points ?? t.value ?? t.score ?? 0;
}

// A render-ready ticket: endpoints, points, and whether the player's owned-route
// network currently completes it.
function ticketView(state, playerId, t, map) {
  let done = false;
  try {
    done = !!ticketComplete(state, playerId, t, map);
  } catch (_) {
    done = false;
  }
  return { id: t.id, from: ticketFrom(t), to: ticketTo(t), points: ticketPoints(t), done };
}

// ---------------------------------------------------------------------------
// buildViewModel
// ---------------------------------------------------------------------------

/**
 * Derive the full UI view-model from engine state.
 *
 * @param {object} state - engine state (CONTRACT §3).
 * @param {object} map - engine map (cities + routes + tickets).
 * @param {Array<{name?:string,isAI?:boolean}>} [configs] - per-player UI config
 *   (names / human-or-AI). Falls back to state.players fields when absent.
 * @param {{gameOver?:boolean, scores?:Array}} [opts] - lifecycle extras:
 *   gameOver (the controller has ended the game) and scores (finalScores rows).
 * @returns {object} a plain, render-ready view-model.
 */
export function buildViewModel(state, map, configs = [], opts = {}) {
  const players = getPlayers(state);
  const cfgs = Array.isArray(configs) ? configs : [];
  const scores = Array.isArray(opts.scores) ? opts.scores : null;

  const phase = (state && state.phase) || 'play';
  const gameOver = !!opts.gameOver || phase === 'ended';
  const curIdx = currentPlayerIndex(state, players);

  // Final round: the endgame trigger has fired (a player dropped to the train
  // threshold) and every player is taking their last turn. The engine marks this
  // with phase === 'finalRound' and tracks finalTurnsLeft (turns remaining incl.
  // the current one). Surface it so the UI can warn "last lap".
  const finalRound = !gameOver && phase === 'finalRound';
  const finalTurnsLeft = finalRound && typeof (state && state.finalTurnsLeft) === 'number'
    ? state.finalTurnsLeft
    : null;

  const playerName = (i) => {
    const c = cfgs[i];
    if (c && c.name) return c.name;
    const p = players[i];
    if (p && p.name) return p.name;
    return `P${i + 1}`;
  };
  const playerIsAI = (i) => {
    const p = players[i];
    if (p && typeof p.isAI === 'boolean') return p.isAI;
    const c = cfgs[i];
    return !!(c && (c.isAI ?? c.ai));
  };

  // --- Legal moves (drives actions + claimable set) -----------------------
  let moves = [];
  try {
    moves = legalMoves(state, map) || [];
  } catch (_) {
    moves = [];
  }
  const claimableIds = new Set();
  let canDrawDeck = false;
  let canDrawTickets = false;
  let canPass = false;
  for (const m of moves) {
    if (!m) continue;
    if (m.type === DRAW_DECK) canDrawDeck = true;
    else if (m.type === DRAW_TICKETS) canDrawTickets = true;
    else if (m.type === PASS) canPass = true;
    else if (m.type === CLAIM_ROUTE && m.routeId != null) claimableIds.add(String(m.routeId));
  }
  const pending = state && state.pending && state.pending.kind === 'tickets' ? state.pending : null;
  const cardsDrawn = (state && state.cardsDrawnThisTurn) || 0;
  const mustDrawSecond = !gameOver && !pending && cardsDrawn === 1;
  // A forced pass: the ONLY thing the player can legally do is pass.
  const forcedPass = !gameOver && moves.length === 1 && moves[0] && moves[0].type === PASS;

  const actions = { canDrawDeck, canDrawTickets, canPass, mustDrawSecond };

  // The phase reason that blocks ALL claims (legalMoves already reflects this;
  // we recompute it only to give each blocked route a helpful reason string).
  let claimBlock = null;
  if (gameOver) claimBlock = 'Game over';
  else if (pending) claimBlock = 'Resolve your ticket draw first';
  else if (cardsDrawn === 1) claimBlock = 'Finish your draw first';

  // --- Routes -------------------------------------------------------------
  const curPlayer = players[curIdx] || null;
  const curHand = playerHand(curPlayer);
  const routeOwner = (state && state.routeOwner) || {};

  const routes = getRoutes(map).map((r) => {
    const id = routeIdOf(r);
    const from = routeFrom(r);
    const to = routeTo(r);
    const length = routeLength(r);
    const color = routeColor(r);

    const ownerId = routeOwner[id];
    if (ownerId != null) {
      const ownerIdx = playerIndexOf(players, ownerId);
      return {
        id, from, to, length, color,
        cost: null,
        claimable: false,
        affordable: false,
        claimed: true,
        ownerIndex: ownerIdx,
        ownerName: playerName(ownerIdx),
        reason: `Claimed by ${playerName(ownerIdx)}`,
      };
    }

    let cost = null;
    try {
      cost = canonicalSpend(curHand, r, map);
    } catch (_) {
      cost = null;
    }
    const affordable = cost != null;
    const claimable = claimableIds.has(String(id));

    let reason = null;
    if (!claimable) {
      if (!affordable) {
        reason = `You can't cover its ${length}-card cost`;
      } else if (claimBlock) {
        reason = claimBlock;
      } else {
        // Affordable, in the claim phase, yet not legal: surface the precise
        // engine reason (trains, parallel-route rule, …).
        let check = { ok: false, reason: 'Not claimable right now' };
        try {
          check = canClaimRoute(state, curIdx, id, cost, map);
        } catch (_) { /* keep default */ }
        reason = check.ok ? 'Not claimable right now' : check.reason;
      }
    }

    return {
      id, from, to, length, color, cost, claimable, affordable,
      claimed: false,
      ownerIndex: null,
      ownerName: null,
      reason,
    };
  });

  // --- Face-up row (mirror engine; nulls preserved for empty slots) -------
  const faceUp = Array.isArray(state && state.faceUp) ? state.faceUp.slice() : [];

  // --- Hotseat privacy: whose secret info is exposed ----------------------
  // During play: the active player's own secrets, but only if they are human.
  // On game over: everything is revealed (handled per-player below).
  const secretForIndex = !gameOver && curPlayer && !playerIsAI(curIdx) ? curIdx : null;
  const revealed = (i) => gameOver || i === secretForIndex;

  // --- Players ------------------------------------------------------------
  const playerViews = players.map((p, i) => {
    const hand = playerHand(p);
    const tickets = Array.isArray(p && p.tickets) ? p.tickets : [];
    const pid = p && p.id != null ? p.id : i;
    const show = revealed(i);
    let score = (p && p.score) || 0;
    if (gameOver && scores) {
      const row = scores.find((r) => r && r.playerId === pid);
      if (row) score = row.total ?? row.score ?? score;
    }
    return {
      index: i,
      name: playerName(i),
      isAI: playerIsAI(i),
      isActive: !gameOver && i === curIdx,
      handCount: handTotal(hand),
      handByColor: show ? handByColor(hand) : null,
      trainsLeft: (p && p.trains) ?? null,
      score,
      ticketCount: tickets.length,
      tickets: show ? tickets.map((t) => ticketView(state, pid, t, map)) : null,
    };
  });

  // --- Standings (live, always-visible) -----------------------------------
  // Rank players by current score (desc), ties broken by player index so the
  // order is stable. rank is 1-based and SHARED across ties (1,1,3,…). The
  // leader flag marks every player tied for the top score, but only when that
  // top score is > 0 (a 0-0 opening isn't a "lead").
  const standings = playerViews
    .map((pv) => ({ index: pv.index, name: pv.name, score: pv.score, isAI: pv.isAI }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const topScore = standings.length ? standings[0].score : 0;
  let prevScore = null;
  standings.forEach((s, i) => {
    s.rank = (i > 0 && s.score === prevScore) ? standings[i - 1].rank : i + 1;
    s.isLeader = topScore > 0 && s.score === topScore;
    prevScore = s.score;
  });
  const leaderIndex = (standings.length && standings[0].isLeader) ? standings[0].index : null;

  // --- Scoreboard + winner (game over) ------------------------------------
  const scoreboard = scores
    ? scores
        .map((r) => {
          const idx = playerIndexOf(players, r.playerId);
          return {
            index: idx,
            name: playerName(idx),
            routePoints: r.routePoints ?? 0,
            ticketPoints: r.ticketPoints ?? 0,
            longestBonus: r.longestBonus ?? 0,
            total: r.total ?? r.score ?? 0,
            completedTickets: r.completedTickets ?? 0,
            longestPath: r.longestPath ?? 0,
          };
        })
        .sort((a, b) => b.total - a.total || a.index - b.index)
    : null;

  const winnerIndex = computeWinnerIndex(state, players, scores, gameOver);

  // --- Prompt (human-readable next step) ----------------------------------
  const prompt = buildPrompt({
    gameOver, pending, mustDrawSecond, forcedPass,
    curIdx, playerName, isAI: playerIsAI(curIdx),
    winnerIndex, scoreboard,
    finalRound, finalTurnsLeft,
  });

  return {
    phase,
    currentPlayerIndex: curIdx,
    prompt,
    actions,
    routes,
    faceUp,
    players: playerViews,
    secretForIndex,
    standings,
    leaderIndex,
    finalRound,
    finalTurnsLeft,
    scoreboard,
    winnerIndex,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeWinnerIndex(state, players, scores, gameOver) {
  if (!gameOver) return null;
  // Prefer the engine-declared winner(s) (array of playerIds).
  if (state && Array.isArray(state.winner) && state.winner.length > 0) {
    return playerIndexOf(players, state.winner[0]);
  }
  if (scores && scores.length > 0) {
    let best = null;
    for (const r of scores) {
      const t = r.total ?? r.score ?? 0;
      if (best === null || t > best.t) best = { i: playerIndexOf(players, r.playerId), t };
    }
    return best ? best.i : null;
  }
  return null;
}

function buildPrompt({ gameOver, pending, mustDrawSecond, forcedPass, curIdx, playerName, isAI, winnerIndex, scoreboard, finalRound, finalTurnsLeft }) {
  if (gameOver) {
    if (winnerIndex == null) return 'Game over';
    const total = scoreboard ? (scoreboard.find((s) => s.index === winnerIndex) || {}).total : undefined;
    const tied = scoreboard ? scoreboard.filter((s) => s.total === (total ?? -Infinity)).length > 1 : false;
    const who = playerName(winnerIndex);
    if (tied) return `Game over — tie at ${total} pts`;
    return total != null
      ? `Game over — ${who} wins with ${total} pts`
      : `Game over — ${who} wins`;
  }
  const name = playerName(curIdx);
  // A short "last lap" tag appended to the in-play prompt during the final round.
  const lap = finalRound
    ? ` — FINAL ROUND${typeof finalTurnsLeft === 'number' ? ` (${finalTurnsLeft} turn${finalTurnsLeft === 1 ? '' : 's'} left)` : ''}`
    : '';
  if (pending) {
    const offered = Array.isArray(pending.offered) ? pending.offered.length : 0;
    const minKeep = pending.minKeep ?? 1;
    return `${name}: keep at least ${minKeep} of ${offered} drawn tickets${lap}`;
  }
  if (mustDrawSecond) {
    return `${name}: draw your 2nd card (deck or a non-wild face-up card)${lap}`;
  }
  if (forcedPass) {
    return `${name}: no legal move — pass${lap}`;
  }
  if (isAI) {
    return `${name} (AI) is taking their turn…${lap}`;
  }
  return `${name}: draw cards, claim a route, or draw tickets${lap}`;
}
