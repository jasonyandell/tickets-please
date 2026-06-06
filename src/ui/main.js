// main.js — UI controller for tickets-please.
//
// Wires the engine (state/actions/rules/game/scoring), the AI, and the canvas
// renderer together. Zero external dependencies; ES module.
//
// It reads engine state defensively because the exact internal field names of
// State/Map are owned by other files; only the function signatures in
// CONTRACT.md are guaranteed.

import { initGame } from '../engine/state.js';
import {
  drawDeck,
  drawFaceUp,
  claimRoute,
  drawTickets,
  keepTickets,
  pass,
  DRAW_DECK,
  DRAW_FACEUP,
  CLAIM_ROUTE,
  DRAW_TICKETS,
  KEEP_TICKETS,
  PASS,
} from '../engine/actions.js';
import { legalMoves, canonicalSpend, isTurnOver } from '../engine/rules.js';
import { applyAction } from '../engine/game.js';
import { finalScores, ticketComplete } from '../engine/scoring.js';
import { chooseAction } from '../ai/ai.js';

import {
  computeLayout,
  fitTransform,
  invertTransform,
  hitTestRoute,
  getRoutes,
  routeId as routeIdOf,
  routeFrom,
  routeTo,
  routeLength,
  routeColor,
} from './layout.js';
import {
  drawMap,
  getPlayers,
  playerIndexOf,
} from './render.js';

import { buildViewModel } from './viewModel.js';
import { createRouter, setViewModel, setLastAction } from './app.js';
import { renderMenu } from './screens/menu.js';
import { renderSetup } from './screens/setup.js';
import { renderGameOver } from './screens/gameover.js';
import { showPassDevice, hidePassDevice } from './screens/passdevice.js';
import { renderPanel } from './game/panel.js';

// Try to import a default map; the engine map module may export it under a few
// names. We resolve lazily so a missing export does not break module loading.
import * as MapModule from '../engine/map.js';

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

const AI_DELAY_MS = 550;

const ui = {
  canvas: null,
  ctx: null,
  panel: null,
  log: null,
};

// The screen router (menu | setup | game | gameover). Set up in boot().
let router = null;

let G = {
  map: null,
  state: null,
  layout: null,
  transform: null,
  playerConfigs: [],   // [{ name, isAI }]
  logLines: [],
  aiTimer: null,
  gameOver: false,
  winner: null,
};

// ---------------------------------------------------------------------------
// Map resolution
// ---------------------------------------------------------------------------

function resolveMap() {
  // Common export names; pick the first that looks like a map.
  const candidates = [
    MapModule.default,
    MapModule.map,
    MapModule.MAP,
    MapModule.usaMap,
    MapModule.standardMap,
    MapModule.defaultMap,
  ];
  for (const c of candidates) {
    if (isMapLike(c)) return c;
  }
  // A factory function?
  for (const key of ['createMap', 'makeMap', 'buildMap', 'getMap']) {
    if (typeof MapModule[key] === 'function') {
      try {
        const m = MapModule[key]();
        if (isMapLike(m)) return m;
      } catch (_) { /* ignore */ }
    }
  }
  // Last resort: any export that is map-like.
  for (const v of Object.values(MapModule)) {
    if (isMapLike(v)) return v;
  }
  return null;
}

function isMapLike(v) {
  if (!v || typeof v !== 'object') return false;
  const hasCities = Array.isArray(v.cities) || Array.isArray(v.nodes) ||
    (v.cities && typeof v.cities === 'object') || (v.nodes && typeof v.nodes === 'object');
  const hasRoutes = Array.isArray(v.routes) || Array.isArray(v.edges) ||
    (v.routes && typeof v.routes === 'object') || (v.edges && typeof v.edges === 'object');
  return hasCities && hasRoutes;
}

// ---------------------------------------------------------------------------
// Ticket resolution (for initGame). The engine may expose a ticket deck on the
// map or in a dedicated export; fall back to deriving simple tickets so a game
// can always start.
// ---------------------------------------------------------------------------

function resolveTickets(map) {
  if (Array.isArray(map.tickets)) return map.tickets;
  if (Array.isArray(MapModule.tickets)) return MapModule.tickets;
  if (Array.isArray(MapModule.TICKETS)) return MapModule.TICKETS;
  if (map.destinations && Array.isArray(map.destinations)) return map.destinations;
  return [];
}

// ---------------------------------------------------------------------------
// State helpers (defensive)
// ---------------------------------------------------------------------------

function currentPlayerIndex(state) {
  if (!state) return 0;
  const players = getPlayers(state);
  const cur = state.currentPlayer ?? state.turn ?? state.current ?? state.activePlayer;
  if (cur == null) return 0;
  if (typeof cur === 'number') return cur;
  // cur is a player id
  return playerIndexOf(state, cur);
}

function currentPlayer(state) {
  return getPlayers(state)[currentPlayerIndex(state)] || null;
}

function isGameOver(state) {
  if (!state) return false;
  if (state.gameOver === true || state.finished === true || state.over === true) return true;
  if (state.phase === 'gameOver' || state.phase === 'ended' || state.phase === 'finished') return true;
  return false;
}

function playerIsAI(idx) {
  // The engine records this on the player (state.players[i].isAI). Fall back to
  // the UI's own config (which also uses isAI) before the game exists.
  const players = getPlayers(G.state);
  const p = players[idx];
  if (p && typeof p.isAI === 'boolean') return p.isAI;
  const cfg = G.playerConfigs[idx];
  return !!(cfg && (cfg.isAI ?? cfg.ai));
}

function playerHand(player) {
  if (!player) return {};
  const h = player.hand ?? player.cards ?? player.trainCards ?? {};
  return h;
}

// Normalize a hand into [{color, count}] regardless of underlying shape.
function handEntries(hand) {
  if (!hand) return [];
  if (Array.isArray(hand)) {
    // could be array of color strings -> tally
    const tally = new Map();
    for (const c of hand) {
      const k = typeof c === 'string' ? c : (c && c.color) || 'gray';
      tally.set(k, (tally.get(k) || 0) + 1);
    }
    return [...tally.entries()].map(([color, count]) => ({ color, count }));
  }
  if (typeof hand === 'object') {
    return Object.entries(hand)
      .filter(([, v]) => typeof v === 'number' && v > 0)
      .map(([color, count]) => ({ color, count }));
  }
  return [];
}

function faceUpCards(state) {
  if (!state) return [];
  const f = state.faceUp ?? state.market ?? state.faceUpCards ?? (state.decks && state.decks.faceUp);
  if (Array.isArray(f)) return f;
  return [];
}

function playerTickets(player) {
  if (!player) return [];
  const t = player.tickets ?? player.destinations ?? player.destinationTickets ?? [];
  return Array.isArray(t) ? t : [];
}

function playerScore(state, idx) {
  const p = getPlayers(state)[idx];
  if (!p) return 0;
  // After the game ends, prefer the full final total (includes tickets + bonus).
  if (G.gameOver && Array.isArray(G.scores)) {
    const row = G.scores.find((r) => r && r.playerId === (p.id != null ? p.id : idx));
    if (row) return row.total ?? row.score ?? 0;
  }
  return p.score ?? p.points ?? 0;
}

function ticketLabel(ticket) {
  if (!ticket) return '?';
  const a = ticket.from ?? ticket.a ?? ticket.cityA ?? (Array.isArray(ticket.cities) && ticket.cities[0]);
  const b = ticket.to ?? ticket.b ?? ticket.cityB ?? (Array.isArray(ticket.cities) && ticket.cities[1]);
  const pts = ticket.points ?? ticket.value ?? ticket.score ?? '';
  return `${a} → ${b}${pts !== '' ? ' (' + pts + ')' : ''}`;
}

// Whether the player is in a "keep tickets" decision phase. The engine sets
// state.pending = { kind:'tickets', offered: ticketId[], minKeep }. We return
// { ids, minKeep } where ids are the offered ticket ids. Returns null otherwise.
function pendingTickets(state) {
  if (!state) return null;
  const pend = state.pending;
  if (pend && pend.kind === 'tickets' && Array.isArray(pend.offered) && pend.offered.length > 0) {
    return { ids: pend.offered.slice(), minKeep: pend.minKeep ?? 1 };
  }
  return null;
}

// Resolve a ticket id to its full ticket object via the map's TICKETS list.
function ticketById(id) {
  const tickets = resolveTickets(G.map);
  return tickets.find((t) => t.id === id) || { id };
}

// ---------------------------------------------------------------------------
// Action application with logging + safety
// ---------------------------------------------------------------------------

function safeApply(action, describe) {
  const by = currentPlayerIndex(G.state);
  try {
    const next = applyAction(G.state, action, G.map);
    G.state = next;
    if (describe) log(describe);
    // Observable State Contract: expose the action that was just applied.
    if (action && action.type) setLastAction({ ...action, by });
    return true;
  } catch (err) {
    log(`Illegal: ${describe || (action && action.type) || 'action'} — ${err && err.message ? err.message : err}`);
    return false;
  }
}

function log(line) {
  G.logLines.push(line);
  if (G.logLines.length > 200) G.logLines.shift();
}

// ---------------------------------------------------------------------------
// Claimable routes for the human (for highlight + click handling)
// ---------------------------------------------------------------------------

function claimableRouteIds(state) {
  const ids = new Set();
  try {
    const moves = legalMoves(state, G.map) || [];
    for (const m of moves) {
      if (m && m.type === CLAIM_ROUTE && (m.routeId != null)) {
        ids.add(m.routeId);
      }
    }
  } catch (_) { /* ignore */ }
  return ids;
}

// Find a legal claim action for a route, preferring canonicalSpend.
function claimActionFor(routeId) {
  const route = getRoutes(G.map).find((r) => String(routeIdOf(r)) === String(routeId));
  const player = currentPlayer(G.state);
  const hand = playerHand(player);

  // Preferred: canonicalSpend(hand, route, map) -> spend | null
  try {
    if (route) {
      const spend = canonicalSpend(hand, route, G.map);
      if (spend) return claimRoute(routeId, spend);
    }
  } catch (_) { /* fall through */ }

  // Fallback: ask legalMoves for a ready-made claim action.
  try {
    const moves = legalMoves(G.state, G.map) || [];
    const m = moves.find(
      (mv) => mv && mv.type === CLAIM_ROUTE && String(mv.routeId) === String(routeId),
    );
    if (m) return m;
  } catch (_) { /* ignore */ }

  return null;
}

// ---------------------------------------------------------------------------
// Turn flow / AI driver
// ---------------------------------------------------------------------------

// Called after a HUMAN action (the AI driver has its own loop and never reaches
// here). `actingIdx` is the player who just acted. If their turn handed off to a
// DIFFERENT human, gate the next player behind a pass-the-device interstitial so
// the previous player can't see the incoming hand. AI↔human handoffs get none.
function afterAction(actingIdx) {
  refresh();
  if (isGameOver(G.state)) {
    endGame();
    return;
  }
  const nextIdx = currentPlayerIndex(G.state);
  if (actingIdx != null && nextIdx !== actingIdx && !playerIsAI(nextIdx)) {
    // Consecutive human turns: hide everything until the new player is ready.
    const name = (G.viewModel && G.viewModel.players[nextIdx] && G.viewModel.players[nextIdx].name)
      || `P${nextIdx + 1}`;
    showPassDevice({ playerNumber: nextIdx + 1, name, onReady: refresh });
    return; // next player is human — nothing to schedule
  }
  scheduleAIIfNeeded();
}

function scheduleAIIfNeeded() {
  clearTimeout(G.aiTimer);
  if (G.gameOver) return;
  const idx = currentPlayerIndex(G.state);
  if (playerIsAI(idx)) {
    G.aiTimer = setTimeout(runAITurn, AI_DELAY_MS);
  }
}

function runAITurn() {
  if (G.gameOver) return;
  if (isGameOver(G.state)) { endGame(); return; }
  const idx = currentPlayerIndex(G.state);
  if (!playerIsAI(idx)) { refresh(); return; }

  let guard = 0;
  // Take actions until the turn is over (some turns are multi-step, e.g. draw
  // two cards). Guard against infinite loops.
  const stepOnce = () => {
    if (G.gameOver) return;
    if (isGameOver(G.state)) { endGame(); return; }
    const here = currentPlayerIndex(G.state);
    if (!playerIsAI(here)) { refresh(); scheduleAIIfNeeded(); return; }

    let action = null;
    try {
      action = chooseAction(G.state, G.map);
    } catch (err) {
      log(`AI error: ${err && err.message ? err.message : err}`);
    }
    if (!action) {
      // AI produced nothing; bail to avoid a hang.
      log(`P${here + 1} (AI) passed.`);
      refresh();
      return;
    }
    const ok = safeApply(action, describeAction(action, here));
    refresh();
    guard++;
    if (!ok || guard > 12) { scheduleAIIfNeeded(); return; }

    if (isGameOver(G.state)) { endGame(); return; }
    const nextIdx = currentPlayerIndex(G.state);
    if (nextIdx === here && playerIsAI(nextIdx) && !turnLikelyOver()) {
      // continue this AI's turn after a brief beat
      setTimeout(stepOnce, AI_DELAY_MS / 2);
    } else {
      scheduleAIIfNeeded();
    }
  };
  stepOnce();
}

function turnLikelyOver() {
  try {
    return isTurnOver(G.state);
  } catch (_) {
    return false;
  }
}

function describeAction(action, idx) {
  const tag = `P${idx + 1}${playerIsAI(idx) ? ' (AI)' : ''}`;
  if (!action) return `${tag} acted`;
  switch (action.type) {
    case DRAW_DECK: return `${tag} drew from deck`;
    case DRAW_FACEUP: return `${tag} drew face-up card`;
    case CLAIM_ROUTE: {
      const r = getRoutes(G.map).find((x) => String(routeIdOf(x)) === String(action.routeId));
      const lbl = r ? `${routeFrom(r)}–${routeTo(r)} (${routeLength(r)})` : action.routeId;
      return `${tag} claimed ${lbl}`;
    }
    case DRAW_TICKETS: return `${tag} drew tickets`;
    case KEEP_TICKETS: return `${tag} kept ${(action.keep || []).length} tickets`;
    default: return `${tag} ${action.type}`;
  }
}

// ---------------------------------------------------------------------------
// Human interactions
// ---------------------------------------------------------------------------

function onCanvasClick(ev) {
  if (G.gameOver) return;
  const idx = currentPlayerIndex(G.state);
  if (playerIsAI(idx)) return; // not your turn

  const rect = ui.canvas.getBoundingClientRect();
  const screen = {
    x: (ev.clientX - rect.left) * (ui.canvas.width / rect.width),
    y: (ev.clientY - rect.top) * (ui.canvas.height / rect.height),
  };
  const world = invertTransform(screen, G.transform);

  const hitRoute = hitTestRoute(world, G.map, G.layout);
  if (hitRoute != null) {
    const claimable = claimableRouteIds(G.state);
    if (!claimable.has(hitRoute)) {
      log(`Route not claimable right now.`);
      refresh();
      return;
    }
    const action = claimActionFor(hitRoute);
    if (!action) {
      log(`Cannot afford route ${hitRoute}.`);
      refresh();
      return;
    }
    safeApply(action, describeAction(action, idx));
    afterAction(idx);
  }
}

function doDrawDeck() {
  if (G.gameOver) return;
  const idx = currentPlayerIndex(G.state);
  if (playerIsAI(idx)) return;
  if (safeApply(drawDeck(), describeAction(drawDeck(), idx))) afterAction(idx);
}

function doDrawFaceUp(slot) {
  if (G.gameOver) return;
  const idx = currentPlayerIndex(G.state);
  if (playerIsAI(idx)) return;
  if (safeApply(drawFaceUp(slot), describeAction(drawFaceUp(slot), idx))) afterAction(idx);
}

function doDrawTickets() {
  if (G.gameOver) return;
  const idx = currentPlayerIndex(G.state);
  if (playerIsAI(idx)) return;
  if (safeApply(drawTickets(), describeAction(drawTickets(), idx))) afterAction(idx);
}

function doKeepTickets(keep) {
  if (G.gameOver) return;
  const idx = currentPlayerIndex(G.state);
  if (playerIsAI(idx)) return;
  if (safeApply(keepTickets(keep), describeAction(keepTickets(keep), idx))) afterAction(idx);
}

// Human pass (e.g. a forced pass when no other move is legal). Routes through
// afterAction(idx) so a pass that hands off to another human still triggers the
// pass-the-device interstitial.
function doPass() {
  if (G.gameOver) return;
  const idx = currentPlayerIndex(G.state);
  if (playerIsAI(idx)) return;
  if (safeApply(pass(), describeAction(pass(), idx))) afterAction(idx);
}

// ---------------------------------------------------------------------------
// Game lifecycle
// ---------------------------------------------------------------------------

function newGame(numPlayers, configs, seed) {
  clearTimeout(G.aiTimer);
  const map = resolveMap();
  if (!map) {
    log('ERROR: could not resolve a map from src/engine/map.js');
    refresh();
    return;
  }
  const tickets = resolveTickets(map);
  const playerConfigs = [];
  for (let i = 0; i < numPlayers; i++) {
    const c = configs[i] || {};
    const isAI = (c.isAI ?? c.ai ?? (i !== 0));
    playerConfigs.push({ name: c.name || `P${i + 1}`, isAI: !!isAI });
  }

  // A fixed seed (from the setup screen / e2e) yields a deterministic game;
  // otherwise pick a fresh one each game.
  const gameSeed = (seed != null) ? (seed >>> 0) : (Date.now() >>> 0);

  let state;
  try {
    state = initGame({
      map,
      tickets,
      playerConfigs,
      seed: gameSeed,
    });
  } catch (err) {
    log(`initGame failed: ${err && err.message ? err.message : err}`);
    refresh();
    return;
  }

  G = {
    ...G,
    map,
    state,
    playerConfigs,
    layout: computeLayout(map),
    logLines: [`New game: ${numPlayers} players (seed ${gameSeed}).`],
    gameOver: false,
    winner: null,
    scores: null,
  };
  resize();
  refresh();
  scheduleAIIfNeeded();
}

function endGame() {
  if (G.gameOver) return;
  G.gameOver = true;
  clearTimeout(G.aiTimer);
  hidePassDevice();
  let scores = [];
  try {
    scores = finalScores(G.state, G.map);
  } catch (err) {
    log(`finalScores failed: ${err && err.message ? err.message : err}`);
  }
  G.scores = scores;
  G.winner = computeWinner(scores);
  if (G.winner) {
    log(`GAME OVER. Winner: P${G.winner.index + 1} with ${G.winner.score} points.`);
  } else {
    log('GAME OVER.');
  }
  refresh();          // recompute the view-model (now in game-over shape)
  // Fill the game-over screen from the (now revealed) view-model. New Game goes
  // to setup so the next match can be reconfigured; Menu returns to the landing.
  renderGameOver(router && router.sections.gameover, G.viewModel, {
    onNewGame: goToSetup,
    onMenu: goToMenu,
  });
  if (router) router.show('gameover');
}

// finalScores returns rows: { playerId, routePoints, ticketPoints, longestBonus,
// total, completedTickets, longestPath }. The engine also sets state.winner to
// an array of winning playerIds. Prefer that; fall back to max(total).
function computeWinner(scores) {
  const rows = Array.isArray(scores) ? scores : [];
  // Map playerId -> total for lookups.
  const totalById = new Map();
  for (const r of rows) {
    if (r && typeof r === 'object' && r.playerId != null) {
      totalById.set(r.playerId, r.total ?? r.score ?? 0);
    }
  }

  // Engine-declared winners (array of playerIds).
  const declared = G.state && Array.isArray(G.state.winner) ? G.state.winner : null;
  if (declared && declared.length > 0) {
    const wid = declared[0];
    return { index: playerIndexOf(G.state, wid), score: totalById.get(wid) ?? 0 };
  }

  // Otherwise pick the row with the highest total.
  let best = null;
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const score = r.total ?? r.score ?? 0;
    if (best === null || score > best.score) {
      best = { index: playerIndexOf(G.state, r.playerId), score };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function refresh() {
  // Derive the pure view-model and publish it on the Observable State Contract
  // (window.__APP__.viewModel) so e2e reads facts, not pixels.
  let vm = null;
  if (G.state && G.map) {
    try {
      vm = buildViewModel(G.state, G.map, G.playerConfigs, {
        gameOver: G.gameOver,
        scores: G.scores,
      });
    } catch (err) {
      log(`viewModel failed: ${err && err.message ? err.message : err}`);
    }
  }
  G.viewModel = vm;
  setViewModel(vm);

  renderCanvas();
  renderPanel(ui.panel, buildPanelCtx(vm));
}

// Bundle the live state snapshot, defensive accessors, and action callbacks the
// extracted side panel needs. The accessors stay defined here (they read G) so
// the panel remains a pure view over whatever the controller hands it.
function buildPanelCtx(viewModel) {
  return {
    state: G.state,
    map: G.map,
    gameOver: G.gameOver,
    winner: G.winner,
    logLines: G.logLines,
    viewModel,
    currentPlayerIndex,
    playerIsAI,
    pendingTickets,
    ticketById,
    ticketLabel,
    faceUpCards,
    playerHand,
    playerTickets,
    playerScore,
    handEntries,
    onDrawDeck: doDrawDeck,
    onDrawFaceUp: doDrawFaceUp,
    onDrawTickets: doDrawTickets,
    onKeepTickets: doKeepTickets,
    onPass: doPass,
    onMenu: goToMenu,
  };
}

function renderCanvas() {
  if (!ui.ctx || !G.map) return;
  // Only paint when the game screen is actually visible; a hidden canvas has no
  // layout box, so sizing/painting it would be a no-op (and the source of the
  // old "blank board" race). When hidden we skip and repaint on screen entry.
  if (ui.canvas.offsetParent === null) return;
  const highlight = (!G.gameOver && !playerIsAI(currentPlayerIndex(G.state)))
    ? claimableRouteIds(G.state)
    : new Set();
  drawMap(ui.ctx, G.map, G.state, {
    width: ui.canvas.width,
    height: ui.canvas.height,
    transform: G.transform,
    layout: G.layout,
  }, highlight);
}

// (The endgame scoreboard now lives in screens/gameover.js; main.js just calls
// renderGameOver() from endGame() with the view-model + screen-transition hooks.)

// ---------------------------------------------------------------------------
// Sizing
// ---------------------------------------------------------------------------

function resize() {
  if (!ui.canvas) return;
  // A hidden canvas (any non-game screen) has a zero-size layout box; sizing it
  // then would collapse the board. Skip until the game screen is visible — the
  // game screen's onShow re-runs resize() so the first paint happens on entry.
  if (ui.canvas.offsetParent === null) return;
  const parent = ui.canvas.parentElement;
  const w = Math.max(parent ? parent.clientWidth : 800, 320);
  const h = Math.max(parent ? parent.clientHeight : 600, 320);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ui.canvas.width = Math.floor(w * dpr);
  ui.canvas.height = Math.floor(h * dpr);
  ui.canvas.style.width = w + 'px';
  ui.canvas.style.height = h + 'px';
  if (G.map) {
    G.transform = fitTransform(G.map, ui.canvas.width, ui.canvas.height, 50);
    renderCanvas();
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

// Screen transitions used as callbacks by the screens / panel. Each drops any
// open pass-the-device overlay so it can't linger across a navigation.
function goToMenu() {
  clearTimeout(G.aiTimer);
  hidePassDevice();
  if (router) router.show('menu');
}

function goToSetup() {
  clearTimeout(G.aiTimer);
  hidePassDevice();
  if (router) router.show('setup');
}

function startGame({ numPlayers, configs, seed }) {
  // Show the game screen FIRST so the canvas has a real layout box, then deal —
  // newGame()'s resize()/refresh() paint into a now-visible canvas.
  hidePassDevice();
  if (router) router.show('game');
  newGame(numPlayers, configs, seed);
}

function boot() {
  const appRoot = document.getElementById('app');
  ui.canvas = document.getElementById('map');
  ui.ctx = ui.canvas ? ui.canvas.getContext('2d') : null;
  ui.panel = document.getElementById('panel');

  // Router over the [data-screen] sections. Repaint the board whenever the game
  // screen becomes visible (so the canvas sizes against a real box).
  router = createRouter(appRoot, (name) => {
    if (name === 'game') resize();
  });

  // Build the static screens once.
  renderMenu(router.sections.menu, { onPlay: () => router.show('setup') });
  renderSetup(router.sections.setup, { onStart: startGame, onBack: goToMenu });

  if (ui.canvas) ui.canvas.addEventListener('click', onCanvasClick);
  window.addEventListener('resize', resize);

  // Boot to the landing menu.
  router.show('menu');
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}

// Export internals for potential testing (no-op in browser).
export { resolveMap, isMapLike, handEntries, computeWinner, currentPlayerIndex };
