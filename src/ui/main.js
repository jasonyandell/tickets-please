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
  DRAW_DECK,
  DRAW_FACEUP,
  CLAIM_ROUTE,
  DRAW_TICKETS,
  KEEP_TICKETS,
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
  PLAYER_COLORS,
  playerColor,
  cardColorCss,
  getPlayers,
  playerIndexOf,
  claimedOwners,
} from './render.js';

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
  try {
    const next = applyAction(G.state, action, G.map);
    G.state = next;
    if (describe) log(describe);
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

function afterAction() {
  refresh();
  if (isGameOver(G.state)) {
    endGame();
    return;
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
    afterAction();
  }
}

function doDrawDeck() {
  if (G.gameOver) return;
  const idx = currentPlayerIndex(G.state);
  if (playerIsAI(idx)) return;
  if (safeApply(drawDeck(), describeAction(drawDeck(), idx))) afterAction();
}

function doDrawFaceUp(slot) {
  if (G.gameOver) return;
  const idx = currentPlayerIndex(G.state);
  if (playerIsAI(idx)) return;
  if (safeApply(drawFaceUp(slot), describeAction(drawFaceUp(slot), idx))) afterAction();
}

function doDrawTickets() {
  if (G.gameOver) return;
  const idx = currentPlayerIndex(G.state);
  if (playerIsAI(idx)) return;
  if (safeApply(drawTickets(), describeAction(drawTickets(), idx))) afterAction();
}

function doKeepTickets(keep) {
  if (G.gameOver) return;
  const idx = currentPlayerIndex(G.state);
  if (playerIsAI(idx)) return;
  if (safeApply(keepTickets(keep), describeAction(keepTickets(keep), idx))) afterAction();
}

// ---------------------------------------------------------------------------
// Game lifecycle
// ---------------------------------------------------------------------------

function newGame(numPlayers, configs) {
  clearTimeout(G.aiTimer);
  const map = resolveMap();
  if (!map) {
    log('ERROR: could not resolve a map from src/engine/map.js');
    renderPanel();
    return;
  }
  const tickets = resolveTickets(map);
  const playerConfigs = [];
  for (let i = 0; i < numPlayers; i++) {
    const c = configs[i] || {};
    const isAI = (c.isAI ?? c.ai ?? (i !== 0));
    playerConfigs.push({ name: `P${i + 1}`, isAI: !!isAI });
  }

  let state;
  try {
    state = initGame({
      map,
      tickets,
      playerConfigs,
      seed: (Date.now() >>> 0),
    });
  } catch (err) {
    log(`initGame failed: ${err && err.message ? err.message : err}`);
    renderPanel();
    return;
  }

  G = {
    ...G,
    map,
    state,
    playerConfigs,
    layout: computeLayout(map),
    logLines: [`New game: ${numPlayers} players.`],
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
  refresh();
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
  renderCanvas();
  renderPanel();
}

function renderCanvas() {
  if (!ui.ctx || !G.map) return;
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

function pip(color) {
  const span = document.createElement('span');
  span.className = 'pip';
  span.style.background = cardColorCss(color);
  span.title = String(color);
  return span;
}

function renderPanel() {
  const panel = ui.panel;
  if (!panel) return;
  panel.innerHTML = '';

  // --- Controls (New Game) ---
  const controls = el('div', 'controls');
  const sel = document.createElement('select');
  sel.id = 'playerCount';
  for (let n = 2; n <= 5; n++) {
    const o = document.createElement('option');
    o.value = String(n);
    o.textContent = `${n} players`;
    if (n === (G.playerConfigs.length || 2)) o.selected = true;
    sel.appendChild(o);
  }
  controls.appendChild(sel);

  // human/AI toggles per slot
  const toggles = el('div', 'toggles');
  const renderToggles = () => {
    toggles.innerHTML = '';
    const n = Number(sel.value);
    for (let i = 0; i < n; i++) {
      const wrap = el('label', 'toggle');
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = playerColor(i);
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.idx = String(i);
      const cfg = G.playerConfigs[i];
      cb.checked = cfg ? !!(cfg.isAI ?? cfg.ai) : (i !== 0);
      const txt = document.createElement('span');
      const setTxt = () => { txt.textContent = `P${i + 1}: ${cb.checked ? 'AI' : 'Human'}`; };
      setTxt();
      cb.addEventListener('change', setTxt);
      wrap.appendChild(sw);
      wrap.appendChild(cb);
      wrap.appendChild(txt);
      toggles.appendChild(wrap);
    }
  };
  sel.addEventListener('change', renderToggles);
  renderToggles();
  controls.appendChild(toggles);

  const newBtn = button('New Game', () => {
    const n = Number(sel.value);
    const configs = [];
    toggles.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      configs[Number(cb.dataset.idx)] = { isAI: cb.checked };
    });
    newGame(n, configs);
  });
  newBtn.classList.add('primary');
  controls.appendChild(newBtn);
  panel.appendChild(controls);

  if (!G.state) {
    panel.appendChild(noteEl('Press "New Game" to start.'));
    renderLog(panel);
    return;
  }

  // --- Current player / turn banner ---
  const curIdx = currentPlayerIndex(G.state);
  const banner = el('div', 'banner');
  banner.style.borderColor = playerColor(curIdx);
  if (G.gameOver) {
    banner.textContent = G.winner
      ? `Game over — Winner: P${G.winner.index + 1} (${G.winner.score} pts)`
      : 'Game over';
    banner.classList.add('over');
  } else {
    banner.textContent = `Turn: P${curIdx + 1} ${playerIsAI(curIdx) ? '(AI thinking…)' : '(your move)'}`;
  }
  panel.appendChild(banner);

  // --- Action buttons (human only) ---
  const acts = el('div', 'actions');
  const human = !G.gameOver && !playerIsAI(curIdx);
  const pend = pendingTickets(G.state);

  if (pend) {
    const tdiv = el('div', 'ticketChoice');
    tdiv.appendChild(noteEl(`Choose tickets to keep (at least ${pend.minKeep}):`));
    pend.ids.forEach((id) => {
      const lbl = el('label', 'tkrow');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.dataset.tkid = String(id);
      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode(' ' + ticketLabel(ticketById(id))));
      tdiv.appendChild(lbl);
    });
    const keepBtn = button('Keep selected', () => {
      const keep = [];
      tdiv.querySelectorAll('input[type=checkbox]').forEach((cb) => {
        if (cb.checked) keep.push(cb.dataset.tkid);
      });
      if (keep.length < pend.minKeep) {
        log(`Keep at least ${pend.minKeep} tickets.`);
        refresh();
        return;
      }
      doKeepTickets(keep);
    });
    keepBtn.disabled = !human;
    tdiv.appendChild(keepBtn);
    acts.appendChild(tdiv);
  } else {
    const dDeck = button('Draw Deck', doDrawDeck);
    const dTickets = button('Draw Tickets', doDrawTickets);
    dDeck.disabled = !human;
    dTickets.disabled = !human;
    acts.appendChild(dDeck);
    acts.appendChild(dTickets);
  }
  panel.appendChild(acts);

  // --- Face-up row ---
  const fu = faceUpCards(G.state);
  const fuWrap = el('div', 'faceup');
  fuWrap.appendChild(labelEl('Face-up cards'));
  const fuRow = el('div', 'cardrow');
  fu.forEach((card, slot) => {
    const color = typeof card === 'string' ? card : (card && (card.color ?? card.kind)) || 'gray';
    const c = el('div', 'card');
    c.style.background = cardColorCss(color);
    c.title = String(color);
    c.textContent = abbr(color);
    if (human) {
      c.classList.add('clickable');
      c.addEventListener('click', () => doDrawFaceUp(slot));
    }
    fuRow.appendChild(c);
  });
  if (fu.length === 0) fuRow.appendChild(noteEl('(none)'));
  fuWrap.appendChild(fuRow);
  panel.appendChild(fuWrap);

  // --- Per-player blocks ---
  const players = getPlayers(G.state);
  players.forEach((p, i) => {
    const block = el('div', 'player');
    block.style.borderLeftColor = playerColor(i);
    const head = el('div', 'phead');
    const dot = document.createElement('span');
    dot.className = 'swatch';
    dot.style.background = playerColor(i);
    head.appendChild(dot);
    const title = document.createElement('strong');
    title.textContent = `P${i + 1}${playerIsAI(i) ? ' (AI)' : ''}`;
    head.appendChild(title);
    const sc = document.createElement('span');
    sc.className = 'score';
    sc.textContent = `${playerScore(G.state, i)} pts`;
    head.appendChild(sc);
    if (i === curIdx && !G.gameOver) head.classList.add('active');
    block.appendChild(head);

    // hand pips
    const hand = handEntries(playerHand(p));
    const handRow = el('div', 'hand');
    if (hand.length === 0) {
      handRow.appendChild(noteEl('(no cards)'));
    } else {
      hand.forEach(({ color, count }) => {
        const grp = el('span', 'pipgrp');
        for (let k = 0; k < Math.min(count, 12); k++) grp.appendChild(pip(color));
        if (count > 12) {
          const more = document.createElement('span');
          more.className = 'pipmore';
          more.textContent = `+${count - 12}`;
          grp.appendChild(more);
        }
        const cnt = document.createElement('span');
        cnt.className = 'pipcount';
        cnt.textContent = String(count);
        grp.appendChild(cnt);
        handRow.appendChild(grp);
      });
    }
    block.appendChild(handRow);

    // trains remaining (if available)
    const trains = p.trains ?? p.cars ?? p.pieces;
    if (typeof trains === 'number') {
      block.appendChild(noteEl(`Trains: ${trains}`));
    }

    // tickets with done / !done
    const tickets = playerTickets(p);
    if (tickets.length > 0) {
      const tWrap = el('div', 'tickets');
      tWrap.appendChild(labelEl('Tickets'));
      tickets.forEach((tk) => {
        const row = el('div', 'tkrow');
        let done = false;
        try {
          const pid = p.id != null ? p.id : i;
          done = !!ticketComplete(G.state, pid, tk, G.map);
        } catch (_) { done = false; }
        const mark = document.createElement('span');
        mark.className = done ? 'done' : 'notdone';
        mark.textContent = done ? '✓' : '✗';
        row.appendChild(mark);
        row.appendChild(document.createTextNode(' ' + ticketLabel(tk)));
        tWrap.appendChild(row);
      });
      block.appendChild(tWrap);
    }

    panel.appendChild(block);
  });

  renderLog(panel);
}

function renderLog(panel) {
  const logWrap = el('div', 'logwrap');
  logWrap.appendChild(labelEl('Log'));
  const logBox = el('div', 'log');
  ui.log = logBox;
  const last = G.logLines.slice(-40);
  for (const line of last) {
    const ln = document.createElement('div');
    ln.className = 'logline';
    ln.textContent = line;
    logBox.appendChild(ln);
  }
  logWrap.appendChild(logBox);
  panel.appendChild(logWrap);
  // scroll to bottom
  logBox.scrollTop = logBox.scrollHeight;
}

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
function button(text, onClick) {
  const b = document.createElement('button');
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}
function labelEl(text) {
  const e = el('div', 'label');
  e.textContent = text;
  return e;
}
function noteEl(text) {
  const e = el('div', 'note');
  e.textContent = text;
  return e;
}
function abbr(color) {
  const c = String(color);
  return c.length <= 3 ? c.toUpperCase() : c.slice(0, 1).toUpperCase();
}

// ---------------------------------------------------------------------------
// Sizing
// ---------------------------------------------------------------------------

function resize() {
  if (!ui.canvas) return;
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

function boot() {
  ui.canvas = document.getElementById('map');
  ui.ctx = ui.canvas ? ui.canvas.getContext('2d') : null;
  ui.panel = document.getElementById('panel');

  if (ui.canvas) ui.canvas.addEventListener('click', onCanvasClick);
  window.addEventListener('resize', resize);

  resize();
  // Default: 2 players, P1 human vs P2 AI.
  newGame(2, [{ isAI: false }, { isAI: true }]);
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
