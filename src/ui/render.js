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
import { createPopAnimator, isInstantMode } from './anim.js';

// Player colors used both on the map (claimed routes) and the side panel.
export const PLAYER_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4'];

// ── Claimed-route "pop" animation (the reusable anim pattern; see anim.js) ───
// State lives at module scope so it survives across the renderer's per-frame
// drawMap() calls (the controller owns the render loop; we never import it).
//   prevClaimedRids — claimed set from the previous paint, to detect NEW claims.
//                     null until the first paint so we never pop the whole board
//                     on boot / on a restored game (seed silently the first time).
//   popAnimator     — the single rAF driver; repaints via drawLast() each frame.
//   drawLast        — the exact args of the last drawMap() call, so the driver
//                     can re-issue the paint without reaching into the controller.
//   popCount        — durable, monotonic count of pops triggered (exposed on the
//                     canvas so e2e can assert "a pop fired" with no timing).
let prevClaimedRids = null;
let popAnimator = null;
let drawLast = null;
let popCount = 0;

// Re-issue the most recent paint (driven by the pop animator each frame). It
// re-enters drawMap with the cached args; no new pops start (the claimed set is
// unchanged), it just reads fresher pop params.
function drawLastFrame() {
  if (drawLast) {
    drawMap(drawLast.ctx, drawLast.map, drawLast.state, drawLast.view, drawLast.highlight);
  }
}

// Reflect the animator's liveness on the canvas: a single boolean smoke flag
// (data-animating) plus a durable pop counter — the Observable State Contract
// for animation (facts, never pixels).
function syncAnimFlags(canvas) {
  if (!canvas) return;
  canvas.dataset.animating = (popAnimator && popAnimator.isActive()) ? 'true' : 'false';
  canvas.dataset.popCount = String(popCount);
}

// Detect newly-claimed routes between paints and pop each one. Honors instant
// mode (reduced-motion / test): the pop is still COUNTED (so e2e sees it fired)
// but no rAF runs, so the final owned style is reached with zero timing coupling.
function triggerPops(canvas, claimedRids) {
  try {
    if (prevClaimedRids === null) { prevClaimedRids = claimedRids; syncAnimFlags(canvas); return; }
    const fresh = [];
    for (const rid of claimedRids) if (!prevClaimedRids.has(rid)) fresh.push(rid);
    prevClaimedRids = claimedRids;
    if (fresh.length === 0) return;

    if (isInstantMode()) {
      // Instant: count the pops, skip the animation entirely (final state now).
      popCount += fresh.length;
      syncAnimFlags(canvas);
      return;
    }
    if (!popAnimator) {
      popAnimator = createPopAnimator({
        onFrame: drawLastFrame,
        onChange: () => syncAnimFlags(canvas),
      });
    }
    for (const rid of fresh) { popCount += 1; popAnimator.start(rid); }
    syncAnimFlags(canvas);
  } catch (_) { /* animation must never break a paint */ }
}

// Live pop params for a claimed route this frame, or null (no pop / instant).
function popFor(rid) {
  try {
    return popAnimator ? popAnimator.paramsFor(String(rid)) : null;
  } catch (_) { return null; }
}

// Read a CSS custom property off :root so canvas paint shares the same design
// tokens the DOM uses via var(). The canvas can't resolve var(), so it samples
// computed style. Falls back to the literal when there's no document (node
// tests) or the token is undefined, keeping this module import-safe everywhere.
function cssVar(name, fallback) {
  try {
    if (typeof document !== 'undefined' && document.documentElement) {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      if (v) return v;
    }
  } catch (_) { /* fall through to fallback */ }
  return fallback;
}

// Canonical card color -> [token, fallback]. The --card-* token (declared in the
// :root block of style.css) is the source of truth; the fallback keeps imports
// working outside the browser. Unknown/locomotive resolve to gray.
const CARD_TOKENS = {
  red: ['--card-red', '#c62f3b'],
  orange: ['--card-orange', '#cf6a14'],
  yellow: ['--card-yellow', '#e3b505'],
  green: ['--card-green', '#2a9d3a'],
  blue: ['--card-blue', '#2a6ad2'],
  purple: ['--card-purple', '#8e3fb0'],
  white: ['--card-white', '#f4f4f4'],
  black: ['--card-black', '#2b2b2b'],
  gray: ['--card-gray', '#c2c8cd'],
  grey: ['--card-gray', '#c2c8cd'],
  wild: ['--card-wild', '#b9bdc2'],
  locomotive: ['--card-wild', '#b9bdc2'],
  rainbow: ['--card-wild', '#b9bdc2'],
  any: ['--card-gray', '#c2c8cd'],
};

export function cardColorCss(color) {
  const k = color == null ? 'gray' : String(color).toLowerCase();
  const entry = CARD_TOKENS[k] || CARD_TOKENS.gray;
  return cssVar(entry[0], entry[1]);
}

// --- color math (shared with tests/contrast.test.js) ----------------------
function hexToRgb(hex) {
  let h = String(hex).replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function relLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastRatio(fg, bg) {
  const a = relLuminance(fg);
  const b = relLuminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

// Pick a legible ink (dark or light) for text drawn ON a card chip, by WCAG
// contrast against its background — so yellow/white/wild read dark and
// red/blue/black read light. The chip backgrounds are guaranteed (by the
// contrast test) to have a legible ink in this pair.
export function cardInkCss(color) {
  const bg = cardColorCss(color);
  const dark = cssVar('--ink', '#1a1a1a');
  const light = cssVar('--on-accent', '#ffffff');
  return contrastRatio(light, bg) >= contrastRatio(dark, bg) ? light : dark;
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
  // Cache this exact call so the pop animator can re-issue the paint each frame
  // (it owns no controller state; it just replays the latest draw).
  drawLast = { ctx, map, state, view, highlight };
  ctx.clearRect(0, 0, width, height);

  // Map-like backdrop: a soft paper vignette + a faint graticule.
  drawBoardBackground(ctx, width, height);

  const t = view.transform || fitTransform(map, width, height);
  const layout = view.layout || computeLayout(map);
  const owners = claimedOwners(state);

  const claimedRids = new Set();
  for (const rl of layout.routes) {
    if (owners.get(rl.id) !== undefined) claimedRids.add(String(rl.id));
  }
  // Pop any route claimed since the last paint (first anim of the reusable kit).
  triggerPops(ctx.canvas, claimedRids);
  const levels = routeLevels(highlight, claimedRids);

  // Read the published view-model once for: the active human's per-route ticket
  // WEIGHT (privacy-safe — the view-model only populates it for the active human;
  // weight = how many of my incomplete tickets' shortest paths use this route)
  // and per-route owner display names (so a claimed route can be marked with its
  // owner's initial). Both are facts already derived in viewModel.js.
  const vm = liveViewModel();
  const vmRoutesById = new Map();
  if (vm && Array.isArray(vm.routes)) {
    for (const r of vm.routes) vmRoutesById.set(String(r.id), r);
  }

  // Draw routes.
  for (const rl of layout.routes) {
    const r = rl.route;
    const rid = rl.id;
    const ownerId = owners.get(rid);
    const claimed = ownerId !== undefined;
    const level = claimed ? 'none' : (levels.get(String(rid)) || 'none');
    // Highlight only UNCLAIMED ticket routes — what the player still has to
    // build (a claimed route already reads as owned via its color + mark). The
    // weight (how many of my tickets this route serves) grades the glow: routes
    // serving more tickets glow harder, so overlaps pop as "build here first".
    const vmrForWeight = vmRoutesById.get(String(rid));
    const ticketWeight = claimed ? 0 : ((vmrForWeight && vmrForWeight.ticketWeight) || 0);

    let fill;
    let stroke = 'rgba(0,0,0,0.35)';
    if (claimed) {
      fill = playerColor(playerIndexOf(state, ownerId));
      stroke = 'rgba(0,0,0,0.55)';
    } else {
      const col = routeColor(r);
      const isGray = col == null || /^(gray|grey|any|wild)$/i.test(String(col));
      fill = isGray ? cardColorCss('gray') : cardColorCss(col);
    }

    // A just-claimed route pops (grows + flashes white) then settles to owned.
    const pop = claimed ? popFor(rid) : null;
    for (const box of rl.boxes) {
      drawBox(ctx, box, t, fill, stroke, level, ticketWeight, pop);
    }

    // Owner indicator: a claimed route gets the owner's colored fill PLUS a
    // small initialed token on its middle car box, so it unmistakably reads as
    // "owned by player X" — never confusable with an unclaimed route whose car
    // boxes merely show the required color.
    if (claimed && rl.boxes.length) {
      const ownerIdx = playerIndexOf(state, ownerId);
      const vmr = vmRoutesById.get(String(rid));
      const ownerName = vmr && vmr.ownerName != null ? vmr.ownerName : ownerNameFromState(state, ownerIdx);
      const mid = rl.boxes[Math.floor(rl.boxes.length / 2)];
      drawOwnerMark(ctx, mid, t, ownerInitial(ownerName, ownerIdx), fill);
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
    // City count — a structured (non-pixel) smoke hook so e2e can assert the
    // city icons were laid out and drawn, mirroring the layout's city list.
    ctx.canvas.dataset.cities = String(layout.cities.length);
  }
}

// The live view-model published on the Observable State Contract (or null).
function liveViewModel() {
  try {
    return (typeof window !== 'undefined' && window.__APP__) ? window.__APP__.viewModel : null;
  } catch (_) { return null; }
}

// Fallback owner name when the view-model has none (e.g. a stray render before
// the first viewModel publish): read the engine player, else "P{n}".
function ownerNameFromState(state, ownerIdx) {
  const players = getPlayers(state);
  const p = players[ownerIdx];
  if (p && p.name) return p.name;
  return `P${ownerIdx + 1}`;
}

// A single-character badge for an owner: their name's initial, else the seat #.
function ownerInitial(name, ownerIdx) {
  const s = name != null ? String(name).trim() : '';
  return s ? s[0].toUpperCase() : String(ownerIdx + 1);
}

// Draw the owner token: a small light disc ringed in the owner's color, bearing
// their initial in dark ink — legible on any owner-color fill underneath.
function drawOwnerMark(ctx, box, t, initial, ownerColor) {
  const ctr = applyTransform({ x: box.cx, y: box.cy }, t);
  const radius = 7;
  ctx.save();
  ctx.beginPath();
  ctx.arc(ctr.x, ctr.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = cssVar('--label-plate', '#ffffff');
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 1;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 2;
  ctx.strokeStyle = ownerColor;
  ctx.stroke();
  ctx.fillStyle = cssVar('--ink', '#1a1a1a');
  ctx.font = '700 9px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initial, ctr.x, ctr.y + 0.5);
  ctx.restore();
}

// level: 'claimable' (solid, bold — a clear "go"), 'affordable' (dashed amber —
// "you can pay, just not this instant"), or 'none' (normal). ticketWeight (>= 0,
// orthogonal to level) adds a teal halo marking routes that serve the active
// human's incomplete tickets — "build toward this". The halo's strength scales
// with the weight: a route on two tickets' shortest paths glows harder than one,
// turning the board into a "where to build first" heat-map.
function drawBox(ctx, box, t, fill, stroke, level, ticketWeight, pop) {
  let c = box.corners.map((pt) => applyTransform(pt, t));

  // Pop: scale the car box around its own centroid so a freshly-claimed route
  // briefly bulges then settles (scale returns to 1). Pure geometry on the
  // already-transformed corners — no extra canvas transform to leak.
  if (pop && pop.scale && pop.scale !== 1) {
    let cx = 0;
    let cy = 0;
    for (const p of c) { cx += p.x; cy += p.y; }
    cx /= c.length; cy /= c.length;
    c = c.map((p) => ({ x: cx + (p.x - cx) * pop.scale, y: cy + (p.y - cy) * pop.scale }));
  }

  // Ticket halo: paint the box in the glow color WITH a blur so the color bleeds
  // outward as a halo, then overpaint with the real fill below. The bled-out
  // ring stays, reading as "this route serves your ticket(s)". Blur radius and
  // opacity grow with the weight (capped) so overlaps read as a hotter spot.
  if (ticketWeight > 0) {
    const w = Math.min(ticketWeight, 4); // cap so a busy hub doesn't blow out
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(c[0].x, c[0].y);
    for (let i = 1; i < c.length; i++) ctx.lineTo(c[i].x, c[i].y);
    ctx.closePath();
    const glow = cssVar('--ticket-glow', '#0f8a9c');
    ctx.shadowColor = glow;
    ctx.shadowBlur = 6 + w * 5;        // 11 at weight 1, hotter as weight rises
    ctx.globalAlpha = Math.min(1, 0.5 + 0.25 * (w - 1)); // 0.5 → 1.0
    ctx.fillStyle = glow;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fill();
    ctx.restore();
  }

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

  // Pop flash: a brief white wash over the box that fades to nothing (flash→0),
  // so the claim "lights up" then settles into the owner color underneath.
  if (pop && pop.flash > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(c[0].x, c[0].y);
    for (let i = 1; i < c.length; i++) ctx.lineTo(c[i].x, c[i].y);
    ctx.closePath();
    ctx.globalAlpha = Math.min(1, pop.flash);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();
  }
}

// Paint the board as a map: a radial paper vignette (lighter middle → darker
// edges) overlaid with a faint graticule for cartographic texture. All colors
// come from the --map-* tokens.
function drawBoardBackground(ctx, width, height) {
  const land = cssVar('--map-land', '#e7ecdf');
  const edge = cssVar('--map-land-edge', '#dadfca');
  let bg = land;
  try {
    const g = ctx.createRadialGradient(
      width / 2, height * 0.42, Math.min(width, height) * 0.08,
      width / 2, height / 2, Math.max(width, height) * 0.72,
    );
    g.addColorStop(0, land);
    g.addColorStop(1, edge);
    bg = g;
  } catch (_) { /* createRadialGradient may be absent in a stub ctx */ }
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Faint lat/long grid.
  ctx.save();
  ctx.strokeStyle = cssVar('--map-grid', '#d2dbc9');
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  const step = 64;
  for (let x = step; x < width; x += step) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, height); }
  for (let y = step; y < height; y += step) { ctx.moveTo(0, y + 0.5); ctx.lineTo(width, y + 0.5); }
  ctx.stroke();
  ctx.restore();
}

// Rounded-rect path helper (uses native roundRect where available).
function roundRectPath(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// A small city skyline marker (three buildings of varied height with lit
// windows), drawn as an inline-SVG-style glyph straight to canvas — zero-dep and
// far more legible as "a city" than a flat dot. Buildings are [dx, w, h] in
// canvas px relative to the city point (dx from center x, all sharing a baseline
// just below y so the cluster centers on the point). Colors come from --city-*
// tokens. Returns the marker's right edge so the label can clear it.
const CITY_BUILDINGS = [
  [-14, 8, 15],
  [-5, 10, 22],
  [6, 8, 18],
];
const CITY_BASELINE = 8; // baseline offset below the city point (px)

function drawCityIcon(ctx, x, y) {
  const base = y + CITY_BASELINE;
  const fill = cssVar('--city-fill', '#2b2f2b');
  const ring = cssVar('--city-ring', '#ffffff');
  const win = cssVar('--city-window', '#e3b505');

  // White halo/ring with a soft drop shadow: a rounded outline of the silhouette
  // so the dark buildings stay legible against the map's land tones.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.30)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.strokeStyle = ring;
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const [dx, w, h] of CITY_BUILDINGS) roundRectPath(ctx, x + dx, base - h, w, h, 2);
  ctx.stroke();
  ctx.restore();

  // Building bodies.
  ctx.save();
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (const [dx, w, h] of CITY_BUILDINGS) roundRectPath(ctx, x + dx, base - h, w, h, 2);
  ctx.fill();
  ctx.restore();

  // Lit windows — a small grid of accent squares so the marker reads as a city.
  ctx.save();
  ctx.fillStyle = win;
  const inset = 2;
  const ww = 2;
  const gap = 1.8;
  for (const [dx, w, h] of CITY_BUILDINGS) {
    const left = x + dx + inset;
    const right = x + dx + w - inset;
    const cols = w >= 9 ? 2 : 1;
    for (let fy = base - h + inset + 0.6; fy + ww <= base - inset; fy += ww + gap) {
      for (let c = 0; c < cols; c++) {
        const wx = left + c * (ww + gap);
        if (wx + ww <= right) ctx.fillRect(wx, fy, ww, ww);
      }
    }
  }
  ctx.restore();

  // Rightmost building edge — where the label should start clearing.
  let edge = -Infinity;
  for (const [dx, w] of CITY_BUILDINGS) edge = Math.max(edge, dx + w);
  return x + edge;
}

function drawCity(ctx, x, y, name) {
  const rightEdge = drawCityIcon(ctx, x, y);

  if (name) {
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const label = String(name);
    const tw = ctx.measureText(label).width;
    const plateX = rightEdge + 5;
    // Rounded label plate for legibility against the map.
    ctx.save();
    ctx.beginPath();
    roundRectPath(ctx, plateX, y - 10, tw + 9, 20, 5);
    ctx.fillStyle = cssVar('--label-plate', '#ffffff');
    ctx.globalAlpha = 0.92;
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = cssVar('--ink', '#111');
    ctx.fillText(label, plateX + 4, y + 1);
  }
}

// Export some accessors for main.js convenience.
export { getCities, getRoutes, routeId, routeLength, routeFrom, routeTo, cityId, cityName, claimedOwners };
