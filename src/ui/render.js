// render.js — Canvas drawing for the tickets-please map.
//
// Pure-ish: it only touches the provided CanvasRenderingContext2D. All geometry
// comes from layout.js so this file just paints. It reads the engine map/state
// defensively (field names may vary) and never mutates them.

import {
  computeLayout,
  fitTransform,
  applyTransform,
  getCities,
  getRoutes,
  routeId,
  routeColor,
  routeLength,
  routeFrom,
  routeTo,
  cityId,
  cityName,
} from './layout.js';
import { setBoardRenderContext } from './game/board.js';

// Player colors used both on the map (claimed routes) and the side panel.
export const PLAYER_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4'];

// Canonical TtR-ish card colors -> CSS. Unknown/locomotive fall back.
const CARD_CSS = {
  red: '#d23',
  orange: '#e8821e',
  yellow: '#e8c020',
  green: '#2a9d3a',
  blue: '#2a6ad2',
  purple: '#8e3fb0',
  pink: '#d24f9e',
  black: '#2b2b2b',
  white: '#f4f4f4',
  gray: '#9aa0a6',
  grey: '#9aa0a6',
  wild: '#bdbdbd',
  locomotive: '#bdbdbd',
  rainbow: '#bdbdbd',
  any: '#9aa0a6',
};

export function cardColorCss(color) {
  if (color == null) return CARD_CSS.gray;
  const k = String(color).toLowerCase();
  return CARD_CSS[k] || CARD_CSS.gray;
}

export function playerColor(playerIndex) {
  return PLAYER_COLORS[playerIndex % PLAYER_COLORS.length];
}

// Build a routeId -> ownerIndex map from state, reading several plausible shapes.
function claimedOwners(state) {
  const owners = new Map();
  if (!state) return owners;

  // Shape 1: state.claims = { routeId: playerId }
  if (state.claims && !Array.isArray(state.claims) && typeof state.claims === 'object') {
    for (const [rid, pid] of Object.entries(state.claims)) owners.set(rid, pid);
  }
  // Shape 2: state.claimedRoutes = [{ routeId, playerId }] or { routeId: playerId }
  if (Array.isArray(state.claimedRoutes)) {
    for (const c of state.claimedRoutes) {
      if (c && c.routeId != null) owners.set(c.routeId, c.player ?? c.playerId ?? c.owner);
    }
  } else if (state.claimedRoutes && typeof state.claimedRoutes === 'object') {
    for (const [rid, pid] of Object.entries(state.claimedRoutes)) owners.set(rid, pid);
  }
  // Shape 3: per-player route lists state.players[i].routes / .claimed
  const players = getPlayers(state);
  players.forEach((p, i) => {
    const pid = p.id != null ? p.id : i;
    const lists = [p.routes, p.claimed, p.claimedRoutes, p.ownedRoutes];
    for (const list of lists) {
      if (Array.isArray(list)) {
        for (const rid of list) {
          const id = rid && rid.routeId != null ? rid.routeId : rid;
          if (id != null) owners.set(id, pid);
        }
      }
    }
  });
  return owners;
}

export function getPlayers(state) {
  if (!state) return [];
  if (Array.isArray(state.players)) return state.players;
  if (state.players && typeof state.players === 'object') return Object.values(state.players);
  return [];
}

// Map a player id (whatever its type) to a 0-based index for coloring.
export function playerIndexOf(state, playerId) {
  const players = getPlayers(state);
  for (let i = 0; i < players.length; i++) {
    const pid = players[i].id != null ? players[i].id : i;
    if (pid === playerId || String(pid) === String(playerId)) return i;
  }
  if (typeof playerId === 'number') return playerId;
  return 0;
}

// Build the per-route highlight LEVEL map keyed by routeId:
//   'claimable'  — legal to claim right now (strong, solid highlight)
//   'affordable' — the active human could cover the cost, but it is not legal
//                  to claim this instant (subtle dashed highlight)
// Claimable comes from the `highlight` set main.js passes (legal moves); the
// affordable-but-not-now tier is read from the published view-model so the board
// distinguishes "go" from "you can pay for it, just not yet". Affordable styling
// is shown ONLY on the active human's turn (never leaks an AI/opponent hand).
function routeLevels(highlight, claimedRids) {
  const levels = new Map();
  const hi = highlight || new Set();
  for (const rid of hi) levels.set(String(rid), 'claimable');

  let vm = null;
  try {
    vm = (typeof window !== 'undefined' && window.__APP__) ? window.__APP__.viewModel : null;
  } catch (_) { vm = null; }

  if (vm && Array.isArray(vm.routes)) {
    const showAfford = vm.secretForIndex != null && vm.secretForIndex === vm.currentPlayerIndex;
    for (const r of vm.routes) {
      if (!r || r.claimed) continue;
      const rid = String(r.id);
      if (r.claimable) levels.set(rid, 'claimable');
      else if (showAfford && r.affordable && !levels.has(rid) && !claimedRids.has(rid)) {
        levels.set(rid, 'affordable');
      }
    }
  }
  return levels;
}

// Main entry: draw the whole map.
// ctx: 2d context; map: engine map; state: engine state;
// view: { width, height, transform }; highlight: Set<routeId> claimable now.
export function drawMap(ctx, map, state, view, highlight) {
  const { width, height } = view;
  ctx.clearRect(0, 0, width, height);

  // Background.
  ctx.fillStyle = '#eef3ee';
  ctx.fillRect(0, 0, width, height);

  const t = view.transform || fitTransform(map, width, height);
  const layout = view.layout || computeLayout(map);
  const owners = claimedOwners(state);

  const claimedRids = new Set();
  for (const rl of layout.routes) {
    if (owners.get(rl.id) !== undefined) claimedRids.add(String(rl.id));
  }
  const levels = routeLevels(highlight, claimedRids);

  // Draw routes.
  for (const rl of layout.routes) {
    const r = rl.route;
    const rid = rl.id;
    const ownerId = owners.get(rid);
    const claimed = ownerId !== undefined;
    const level = claimed ? 'none' : (levels.get(String(rid)) || 'none');

    let fill;
    let stroke = 'rgba(0,0,0,0.35)';
    if (claimed) {
      fill = playerColor(playerIndexOf(state, ownerId));
      stroke = 'rgba(0,0,0,0.55)';
    } else {
      const col = routeColor(r);
      const isGray = col == null || /^(gray|grey|any|wild)$/i.test(String(col));
      fill = isGray ? '#c2c8cd' : cardColorCss(col);
    }

    for (const box of rl.boxes) {
      drawBox(ctx, box, t, fill, stroke, level);
    }
  }

  // Draw cities on top.
  for (const c of layout.cities) {
    const p = applyTransform({ x: c.x, y: c.y }, t);
    drawCity(ctx, p.x, p.y, c.name);
  }

  // Hand the board interaction layer the live geometry it needs to hit-test the
  // cursor and locate routes (it imports only pure helpers; we push, never pull).
  try {
    setBoardRenderContext({ canvas: ctx.canvas, map, transform: t, layout, width, height });
  } catch (_) { /* board layer optional */ }

  // Observable State Contract — single canvas smoke signal. Once the board has
  // actually been drawn (non-zero size), flag it so e2e can assert paint without
  // sampling pixels. This is the ONLY canvas check anywhere.
  if (ctx.canvas && width > 0 && height > 0) {
    ctx.canvas.dataset.painted = 'true';
  }
}

// level: 'claimable' (solid, bold — a clear "go"), 'affordable' (dashed amber —
// "you can pay, just not this instant"), or 'none' (normal).
function drawBox(ctx, box, t, fill, stroke, level) {
  const c = box.corners.map((pt) => applyTransform(pt, t));
  ctx.beginPath();
  ctx.moveTo(c[0].x, c[0].y);
  for (let i = 1; i < c.length; i++) ctx.lineTo(c[i].x, c[i].y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  if (level === 'claimable') {
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#111';
    ctx.stroke();
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.stroke();
    ctx.restore();
  } else if (level === 'affordable') {
    ctx.save();
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#c9851a';
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.lineWidth = 1;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function drawCity(ctx, x, y, name) {
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#1a1a1a';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#fff';
  ctx.stroke();

  if (name) {
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const label = String(name);
    const tw = ctx.measureText(label).width;
    // label background for legibility
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(x + 8, y - 8, tw + 4, 16);
    ctx.fillStyle = '#111';
    ctx.fillText(label, x + 10, y);
  }
}

// Export some accessors for main.js convenience.
export { getCities, getRoutes, routeId, routeLength, routeFrom, routeTo, cityId, cityName, claimedOwners };
