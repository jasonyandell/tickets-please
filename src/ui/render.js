// render.js — SVG/DOM renderer for the tickets-please board.
//
// Successor to the canvas painter. Every route, car slot, and city is a REAL
// element, so:
//   - appearance lives in style.css (design tokens + data-attribute selectors),
//   - game state is attribute-driven (data-claimed / data-owner / data-level /
//     data-ticket-weight flip per render),
//   - e2e asserts structure (elements + attributes), never pixels.
//
// The renderer is written directly against the view-model contract
// (viewModel.js) — zero defensive engine-state reading. main.js calls
// renderBoard(svg, map, vm) on every refresh; the static skeleton (slots,
// cities, labels) is built once per (svg, map) and only attributes change
// after that.
//
// Observable State Contract kept from the canvas era (e2e relies on it):
//   #map dataset: painted, cities, animating, popCount
// Plus the structural upgrade the SVG substrate enables:
//   g.route[data-route-id]  — one per route, data-* mirrors the view-model
//   g.city[data-city-id]    — one per city
//
// Animations follow the anim.js kit: pure frame models + isolated rAF drivers.
// Drivers mutate CSS custom properties (--pop-scale/--pop-flash/--pulse) on
// route groups; style.css turns those into transforms/opacity. In instant mode
// (reduced-motion / ?test / __INSTANT_ANIM__) no driver runs — final state is
// reached immediately and pops are still COUNTED (durable popCount).

import {
  computeLayout,
  fitTransform,
  applyTransform,
  routeLine,
  convexHull,
  getCities,
  getRoutes,
  routeId,
  routeColor,
  routeLength,
  routeFrom,
  routeTo,
  cityId,
  cityName,
} from './geometry.js';
import {
  createPopAnimator,
  createLoopAnimator,
  isInstantMode,
  pulseIntensityAt,
  PULSE_VELOCITY,
  PULSE_HALF_WIDTH,
} from './anim.js';

// The board's fixed internal coordinate system. index.html declares the same
// viewBox; CSS scales it to the screen, so there is NO resize handling, no
// devicePixelRatio, and no hidden-element sizing race anywhere.
export const VIEWBOX = { width: 1200, height: 760, pad: 50 };

// Player colors used both on the map (claimed routes) and the side panel.
export const PLAYER_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4'];

// ---------------------------------------------------------------------------
// Design-token + color helpers (consumed by panel.js / setup.js / contrast test)
// ---------------------------------------------------------------------------

// Read a CSS custom property off :root so JS-painted colors share the design
// tokens. Falls back to the literal when there's no document (node tests) or
// the token is undefined, keeping this module import-safe everywhere.
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

// ---------------------------------------------------------------------------
// Defensive state helpers kept for main.js (controller-side reads)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// SVG skeleton — built once per (svg, map)
// ---------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs, parent) {
  const node = document.createElementNS(SVG_NS, name);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  }
  if (parent) parent.appendChild(node);
  return node;
}

// Canonical color key for data-color (drives the CSS fill rules).
function colorKey(color) {
  const k = String(color == null ? 'gray' : color).toLowerCase();
  if (k === 'grey' || k === 'any') return 'gray';
  if (k === 'locomotive' || k === 'rainbow') return 'wild';
  return CARD_TOKENS[k] ? k : 'gray';
}

// Board skeleton state. One board per page; module scope mirrors the canvas
// renderer's module-scoped animation state (and keeps the render entry pure-ish:
// renderBoard only touches the SVG it is given).
let B = null; // { svg, map, layout, routeEls: Map<idStr, refs>, routeLen: Map }

// Anim state survives skeleton rebuilds on purpose:
//   prevClaimedRids — claimed set from the previous render, to detect NEW claims
//                     (null until the first render so a restored game never
//                     pops the whole board on boot).
//   popCount        — durable, monotonic count of pops (exposed on #map so e2e
//                     asserts "a pop fired" with no timing).
let prevClaimedRids = null;
let popCount = 0;
let popAnimator = null;
let popping = new Set();
let pulseAnimator = null;
let pulseLit = new Set();   // Set<Element> — wash rects lit by the last frame
let pulsePaths = [];        // [{ pathLength, slots: [{ wash, center }] }]

function buildSkeleton(svg, map) {
  svg.textContent = '';
  svg.setAttribute('viewBox', `0 0 ${VIEWBOX.width} ${VIEWBOX.height}`);

  // Bake the map into viewBox coordinates ONCE: all geometry below is in
  // fixed viewBox units; the SVG scales itself from there.
  const t = fitTransform(map, VIEWBOX.width, VIEWBOX.height, VIEWBOX.pad);
  const vbMap = {
    cities: getCities(map).map((c) => {
      const p = applyTransform({ x: Number(c.x), y: Number(c.y) }, t);
      return { id: cityId(c), name: cityName(c), x: p.x, y: p.y };
    }),
    routes: getRoutes(map),
  };
  const layout = computeLayout(vbMap);

  // --- defs: the paper-vignette gradient (stop colors come from CSS) -------
  const defs = el('defs', null, svg);
  const grad = el('radialGradient', { id: 'map-vignette', cx: '50%', cy: '42%', r: '72%' }, defs);
  el('stop', { offset: '0%', class: 'vignette-center' }, grad);
  el('stop', { offset: '100%', class: 'vignette-edge' }, grad);

  // --- backdrop: vignette + faint graticule --------------------------------
  el('rect', {
    class: 'board-bg', x: 0, y: 0,
    width: VIEWBOX.width, height: VIEWBOX.height,
    fill: 'url(#map-vignette)',
  }, svg);

  // Landmass (V2): the convex hull of the cities, inflated + rounded by a fat
  // same-color stroke (round joins) in CSS. Water (the vignette) shows around
  // it; derived from the map itself, so any map grounds itself — no geography
  // assets, no pretending to be an accurate coastline.
  const hull = convexHull(vbMap.cities);
  if (hull.length >= 3) {
    const dLand = hull
      .map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join('') + 'Z';
    el('path', { class: 'landmass', d: dLand }, svg);
  }

  const step = 64;
  let d = '';
  for (let x = step; x < VIEWBOX.width; x += step) d += `M${x} 0V${VIEWBOX.height}`;
  for (let y = step; y < VIEWBOX.height; y += step) d += `M0 ${y}H${VIEWBOX.width}`;
  el('path', { class: 'board-grid', d }, svg);

  // --- routes ---------------------------------------------------------------
  const routesLayer = el('g', { class: 'routes-layer' }, svg);
  const routeEls = new Map();
  const routeMeta = new Map(); // idStr -> { from, to, len, washes[] } (pulse layout)
  for (const rl of layout.routes) {
    const idStr = String(rl.id);
    const g = el('g', {
      class: 'route',
      'data-route-id': idStr,
      'data-color': colorKey(routeColor(rl.route)),
      'data-length': rl.boxes.length,
      'data-claimed': 'false',
      'data-level': 'none',
      'data-ticket-weight': '0',
    }, routesLayer);

    // Continuous track line UNDER the slots (V1): city point to city point,
    // same perpendicular offset as the slots. Claimed routes recolor it via
    // CSS (--owner-color), so an owned network reads as connected rail.
    const line = routeLine(rl.route, vbMap, { cityIndex: layout.cityIndex });
    if (line) {
      el('line', { class: 'track', x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2 }, g);
    }

    const deg = (rad) => (rad * 180) / Math.PI;
    const rectAttrs = (box) => ({
      x: box.cx - box.w / 2,
      y: box.cy - box.h / 2,
      width: box.w,
      height: box.h,
      rx: 3,
      transform: `rotate(${deg(box.angle).toFixed(3)} ${box.cx} ${box.cy})`,
    });
    for (const box of rl.boxes) el('rect', { class: 'car', ...rectAttrs(box) }, g);
    // Wash overlay: one per slot, ON TOP of the cars. Carries the heat-map
    // ring (stroke, keyed by data-ticket-weight) and the pop-flash / pulse
    // wash (white fill whose opacity is max(--pop-flash, --pulse)). Collected
    // in routeFrom→routeTo slot order so the pulse can address slot k directly.
    const washes = [];
    for (const box of rl.boxes) washes.push(el('rect', { class: 'car-wash', ...rectAttrs(box) }, g));

    // Owner mark on the middle slot: a small light disc ringed in the owner's
    // color bearing their initial. Hidden by CSS until data-claimed="true".
    const mid = rl.boxes[Math.floor(rl.boxes.length / 2)];
    if (mid) {
      const mark = el('g', { class: 'owner-mark', transform: `translate(${mid.cx} ${mid.cy})` }, g);
      el('circle', { class: 'owner-plate', r: 7 }, mark);
      const txt = el('text', { class: 'owner-initial', y: 0.5 }, mark);
      txt.textContent = '';
    }
    routeEls.set(idStr, g);
    routeMeta.set(idStr, {
      from: String(routeFrom(rl.route)),
      to: String(routeTo(rl.route)),
      len: routeLength(rl.route),
      washes,
    });
  }

  // --- cities ----------------------------------------------------------------
  const citiesLayer = el('g', { class: 'cities-layer' }, svg);
  for (const c of layout.cities) {
    const g = el('g', {
      class: 'city',
      'data-city-id': String(c.id),
      transform: `translate(${c.x} ${c.y})`,
    }, citiesLayer);
    // Metro interchange dot (V2): a ringed white disc — the transit-map idiom
    // for a station every line can touch. Replaces the skyline glyphs.
    el('circle', { class: 'dot', r: 6.5 }, g);
    // Label on a rounded plate, clearing the dot. Plate width is estimated
    // from the label length (11.5px system font ≈ 6.2px/char) so the build
    // never depends on layout/measure (works while hidden).
    const label = String(c.name || '');
    if (label) {
      const plateX = 10;
      const plateW = label.length * 6.2 + 9;
      el('rect', { class: 'label-plate', x: plateX, y: -9, width: plateW, height: 18, rx: 5 }, g);
      const txt = el('text', { class: 'city-label', x: plateX + 4.5, y: 0.5 }, g);
      txt.textContent = label;
    }
  }

  svg.dataset.cities = String(layout.cities.length);
  B = { svg, map, layout, routeEls, routeMeta };
  syncAnimFlags();
}

// ---------------------------------------------------------------------------
// Animations — pop (claim) + traveling ticket pulse
// ---------------------------------------------------------------------------

function syncAnimFlags() {
  if (!B || !B.svg) return;
  B.svg.dataset.animating = (popAnimator && popAnimator.isActive()) ? 'true' : 'false';
  B.svg.dataset.popCount = String(popCount);
}

// Per-frame pop update: write the live pop params onto each popping route's
// custom properties; style.css turns them into a scale + white flash.
function applyPopFrames() {
  if (!B) return;
  for (const idStr of [...popping]) {
    const g = B.routeEls.get(idStr);
    const p = popAnimator ? popAnimator.paramsFor(idStr) : null;
    if (g && p) {
      g.style.setProperty('--pop-scale', String(p.scale));
      g.style.setProperty('--pop-flash', String(Math.max(0, Math.min(1, p.flash))));
    } else {
      if (g) {
        g.style.removeProperty('--pop-scale');
        g.style.removeProperty('--pop-flash');
      }
      popping.delete(idStr);
    }
  }
}

// Detect newly-claimed routes between renders and pop each one. Honors instant
// mode (reduced-motion / test): the pop is still COUNTED (so e2e sees it fired)
// but no rAF runs, so the final owned style is reached with zero timing coupling.
function triggerPops(claimedRids) {
  try {
    if (prevClaimedRids === null) { prevClaimedRids = claimedRids; syncAnimFlags(); return; }
    const fresh = [];
    for (const rid of claimedRids) if (!prevClaimedRids.has(rid)) fresh.push(rid);
    prevClaimedRids = claimedRids;
    if (fresh.length === 0) return;

    if (isInstantMode()) {
      popCount += fresh.length;
      syncAnimFlags();
      return;
    }
    if (!popAnimator) {
      popAnimator = createPopAnimator({
        onFrame: applyPopFrames,
        onChange: syncAnimFlags,
      });
    }
    for (const rid of fresh) {
      popCount += 1;
      popping.add(rid);
      popAnimator.start(rid);
    }
    syncAnimFlags();
  } catch (_) { /* animation must never break a render */ }
}

// How bright the pulse peak is allowed to get. Deliberately SUBTLE: the bump
// should read as a hint gliding along your path, never a flashing block.
const PULSE_MAX_OPACITY = 0.45;

// Per-frame pulse update, per SQUARE: each individual car slot on a viewer
// ticket path gets its own intensity from the pure pulse model, by its own
// distance along the walk — so the `_-^-_` bump travels square-by-square
// instead of lighting whole routes as blocks. The per-element --pulse
// overrides the group-inherited value in the same max() the wash already uses.
function pulseFrame() {
  if (!B) return;
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  const lit = new Set();
  for (const path of pulsePaths) {
    for (const s of path.slots) {
      const intensity = pulseIntensityAt(now, path.pathLength, s.center, {
        velocity: PULSE_VELOCITY,
        halfWidth: PULSE_HALF_WIDTH,
      });
      if (intensity <= 0.04 || !s.wash) continue;
      s.wash.style.setProperty('--pulse', (PULSE_MAX_OPACITY * intensity).toFixed(3));
      lit.add(s.wash);
    }
  }
  for (const wash of pulseLit) {
    if (!lit.has(wash)) wash.style.removeProperty('--pulse');
  }
  pulseLit = lit;
}

// Start/stop the continuous pulse driver to match whether a pulse should run.
// Idempotent. In instant mode (reduced-motion / test) the driver never runs:
// the static heat-map remains the durable visual and the gate never couples
// to motion.
function syncPulseDriver(shouldRun) {
  try {
    if (shouldRun) {
      if (!pulseAnimator) pulseAnimator = createLoopAnimator({ onFrame: pulseFrame });
      pulseAnimator.start();
    } else if (pulseAnimator) {
      pulseAnimator.stop();
      for (const wash of pulseLit) wash.style.removeProperty('--pulse');
      pulseLit = new Set();
    }
  } catch (_) { /* animation must never break a render */ }
}

// Lay a ticket path out PER SLOT in path-distance units (pure; exported for
// unit tests). Walks routeIds from startCity: a route entered at its `to` end
// contributes its slots in REVERSED DOM order, so slot distances always march
// source→dest along the actual walk. getRoute(idStr) → { from, to, length,
// slots } | null; unknown routes are skipped (defensive).
// Returns { pathLength, slots: [{ id, domIndex, center }] }.
export function pathSlotLayout(routeIds, startCity, getRoute) {
  const slots = [];
  let acc = 0;
  let cur = String(startCity);
  for (const rid of routeIds || []) {
    const r = getRoute(String(rid));
    if (!r) continue;
    const forward = String(r.from) === cur;
    const n = Math.max(1, r.slots | 0);
    const step = r.length / n;
    for (let k = 0; k < n; k++) {
      slots.push({
        id: String(rid),
        domIndex: forward ? k : n - 1 - k,
        center: acc + (k + 0.5) * step,
      });
    }
    cur = forward ? String(r.to) : String(r.from);
    acc += r.length;
  }
  return { pathLength: acc, slots };
}

// Bind the pure layout to this board's wash elements.
function computePulsePaths(vm) {
  const out = [];
  const paths = vm && Array.isArray(vm.ticketPaths) ? vm.ticketPaths : [];
  if (!B) return out;
  const getRoute = (idStr) => {
    const m = B.routeMeta.get(idStr);
    return m ? { from: m.from, to: m.to, length: m.len, slots: m.washes.length } : null;
  };
  for (const path of paths) {
    const ids = path && Array.isArray(path.routeIds) ? path.routeIds : null;
    if (!ids || ids.length === 0) continue;
    const laid = pathSlotLayout(ids, path.from, getRoute);
    if (laid.pathLength <= 0) continue;
    out.push({
      pathLength: laid.pathLength,
      slots: laid.slots.map((s) => ({
        center: s.center,
        wash: (B.routeMeta.get(s.id) || { washes: [] }).washes[s.domIndex] || null,
      })),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// renderBoard — the per-refresh update pass (attributes only)
// ---------------------------------------------------------------------------

// Pure level policy (exported for unit tests): which stroke treatment an
// unclaimed route gets. 'claimable' only on a human's own turn; 'affordable'
// only when the active human's own hand may show (never leaks an AI hand).
export function routeLevel(r, humanTurn, showAfford) {
  if (!r || r.claimed) return 'none';
  if (r.claimable && humanTurn) return 'claimable';
  if (r.affordable && showAfford) return 'affordable';
  return 'none';
}

// A single-character badge for an owner: their name's initial, else the seat #.
function ownerInitial(name, ownerIdx) {
  const s = name != null ? String(name).trim() : '';
  return s ? s[0].toUpperCase() : String(ownerIdx + 1);
}

/**
 * Render the board: build the skeleton if needed, then mirror the view-model
 * onto route/city attributes. Pure projection — reads vm only.
 *
 * @param {SVGSVGElement} svg - the #map element.
 * @param {object} map - engine map (geometry source; skeleton key).
 * @param {object|null} vm - view-model from buildViewModel (null before a game).
 */
export function renderBoard(svg, map, vm) {
  if (!svg || !map) return;
  if (!B || B.svg !== svg || B.map !== map) buildSkeleton(svg, map);
  if (!vm || !Array.isArray(vm.routes)) { syncAnimFlags(); return; }

  const cur = vm.players && vm.players[vm.currentPlayerIndex];
  const humanTurn = !!(cur && !cur.isAI);
  // Board-level turn flag (V3): CSS dims the network during AI turns and
  // releases it at game over. The heat-map stays readable (saturation dim,
  // not opacity) — the Batch-9 "never blank the human's map" rule holds.
  svg.dataset.turn = vm.scoreboard ? 'over' : (humanTurn ? 'human' : 'ai');
  // Affordable styling is shown ONLY on the active human's own view (never
  // leaks an AI/opponent hand) — same rule the canvas renderer enforced.
  const showAfford = vm.secretForIndex != null && vm.secretForIndex === vm.currentPlayerIndex;

  const claimedRids = new Set();
  for (const r of vm.routes) {
    const idStr = String(r.id);
    const g = B.routeEls.get(idStr);
    if (!g) continue;

    if (r.claimed) claimedRids.add(idStr);
    g.dataset.claimed = r.claimed ? 'true' : 'false';
    g.dataset.owner = r.claimed && r.ownerIndex != null ? String(r.ownerIndex) : '';
    if (r.claimed && r.ownerIndex != null) {
      g.style.setProperty('--owner-color', playerColor(r.ownerIndex));
    } else {
      g.style.removeProperty('--owner-color');
    }

    g.dataset.level = routeLevel(r, humanTurn, showAfford);

    // Heat only on routes still to be built (a claimed route reads as owned).
    const weight = r.claimed ? 0 : Math.min(r.ticketWeight || 0, 4);
    g.dataset.ticketWeight = String(weight);

    const initial = g.querySelector('.owner-initial');
    if (initial) {
      initial.textContent = r.claimed
        ? ownerInitial(r.ownerName, r.ownerIndex != null ? r.ownerIndex : 0)
        : '';
    }
  }

  // Pop any route claimed since the last render.
  triggerPops(claimedRids);

  // Traveling ticket pulse over the viewer's ordered paths, square-by-square.
  pulsePaths = computePulsePaths(vm);
  syncPulseDriver(pulsePaths.length > 0 && !isInstantMode());

  // Observable State Contract — the board has rendered real elements.
  svg.dataset.painted = 'true';
  syncAnimFlags();
}

// Re-export the pure accessors for controller convenience (main.js).
export { getCities, getRoutes, routeId, routeLength, routeFrom, routeTo, cityId, cityName };
