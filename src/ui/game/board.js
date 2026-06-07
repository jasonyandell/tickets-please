// board.js — canvas INTERACTION + route-clarity layer for tickets-please.
//
// This module makes the map self-explanatory: hover (or tap) any route and a
// tooltip near the cursor shows its cost, whether you can claim it, and — when
// you can't — exactly why. It reads FACTS from the Observable State Contract
// (window.__APP__.viewModel.routes: { id, from, to, length, color, cost,
// claimable, affordable, reason, claimed, ownerName }) and the live geometry the
// renderer pushes via setBoardRenderContext(). It imports ONLY pure helpers from
// layout.js — never render.js or main.js — so there is no import cycle and no
// engine coupling.
//
// Division of labour with main.js (which owns the engine): claiming a claimable
// route is still applied by main.js's existing canvas click handler. This layer
// adds the human-facing clarity on top — the hover tooltip, the distinct
// claimable-vs-affordable read, and the INLINE blocked reason near the cursor so
// a player never has to read the log to learn why a route is unavailable.

import {
  invertTransform,
  applyTransform,
  hitTestRoute,
} from '../layout.js';

// Latest geometry pushed by the renderer each frame.
let RC = null;

// DOM handles, resolved once on mount.
let canvasEl = null;
let boardEl = null;
let tipEl = null;

// How long a pinned (clicked-blocked) reason stays before fading on its own.
const PIN_MS = 2600;
let pinTimer = null;

// Board-owned inspection surface for e2e (separate from app.js's __APP__ so we
// never touch the documented contract object). Lets a test locate a route's
// on-screen point to drive a real hover/click, then assert structured state.
const BOARD = { tooltip: null, routeAt, routeCenter };
if (typeof window !== 'undefined') window.__BOARD__ = BOARD;

// Called by render.js after every paint. Pure data in; no work here.
export function setBoardRenderContext(rc) {
  RC = rc;
}

// ---------------------------------------------------------------------------
// Coordinate helpers — CSS pixels (relative to the canvas) <-> world units.
// The renderer's transform fits the map into canvas.width/height (device px),
// so we bridge through the canvas's CSS size.
// ---------------------------------------------------------------------------

function cssToDeviceScale() {
  if (!canvasEl) return 1;
  const cw = canvasEl.clientWidth || canvasEl.width;
  return cw ? canvasEl.width / cw : 1;
}

function clientToWorld(clientX, clientY) {
  if (!RC || !canvasEl) return null;
  const rect = canvasEl.getBoundingClientRect();
  const sx = rect.width ? canvasEl.width / rect.width : 1;
  const sy = rect.height ? canvasEl.height / rect.height : 1;
  const device = { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
  return invertTransform(device, RC.transform);
}

// CSS-pixel point on a route relative to the canvas. Uses the route's middle
// car box (always a real, hit-testable box — never a gap between boxes), so the
// returned point is guaranteed to land on the route for hover/click.
function routeCenter(id) {
  if (!RC) return null;
  const rl = RC.layout.routes.find((r) => String(r.id) === String(id));
  if (!rl || !rl.boxes || rl.boxes.length === 0) return null;
  const box = rl.boxes[Math.floor(rl.boxes.length / 2)];
  const device = applyTransform({ x: box.cx, y: box.cy }, RC.transform);
  const s = cssToDeviceScale() || 1;
  return { x: device.x / s, y: device.y / s };
}

// Route id under a CSS-pixel point relative to the canvas (null if none).
function routeAt(cssX, cssY) {
  if (!RC || !canvasEl) return null;
  const rect = canvasEl.getBoundingClientRect();
  return routeAtClient(rect.left + cssX, rect.top + cssY);
}

function routeAtClient(clientX, clientY) {
  const world = clientToWorld(clientX, clientY);
  if (!world) return null;
  return hitTestRoute(world, RC.map, RC.layout);
}

// ---------------------------------------------------------------------------
// View-model lookups
// ---------------------------------------------------------------------------

function viewModel() {
  try {
    return (typeof window !== 'undefined' && window.__APP__) ? window.__APP__.viewModel : null;
  } catch (_) { return null; }
}

function routeVM(id) {
  const vm = viewModel();
  if (!vm || !Array.isArray(vm.routes)) return null;
  return vm.routes.find((r) => String(r.id) === String(id)) || null;
}

function cityName(id) {
  if (!RC) return String(id);
  const c = RC.layout.cities.find((x) => String(x.id) === String(id));
  return c && c.name ? c.name : String(id);
}

// Format the engine spend object ({ color: count, ... }) as e.g. "2 yellow + 1 wild".
function formatCost(cost, length) {
  if (!cost || typeof cost !== 'object') return `${length} card${length === 1 ? '' : 's'}`;
  const parts = [];
  for (const k of Object.keys(cost)) {
    const n = cost[k] || 0;
    if (n > 0) parts.push(`${n} ${k}`);
  }
  return parts.length ? parts.join(' + ') : `${length} card${length === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// Tooltip rendering
// ---------------------------------------------------------------------------

function statusFor(r) {
  if (r.claimed) {
    return { cls: 'claimed', text: r.ownerName ? `Claimed by ${r.ownerName}` : 'Claimed' };
  }
  if (r.claimable) {
    return { cls: 'go', text: 'Claimable — click to claim' };
  }
  if (r.affordable) {
    return { cls: 'wait', text: r.reason || "Can't claim right now" };
  }
  return { cls: 'no', text: r.reason || "You can't afford this route" };
}

function buildTip(r) {
  const title = `${cityName(r.from)} → ${cityName(r.to)}`;
  const colorLabel = r.color && !/^(gray|grey|any)$/i.test(String(r.color))
    ? String(r.color)
    : 'any color';
  const costText = r.claimed ? '' : `Cost: ${formatCost(r.cost, r.length)}`;
  const status = statusFor(r);

  const lines = [
    `<div class="bt-title">${esc(title)}</div>`,
    `<div class="bt-cost">${r.length} × ${esc(colorLabel)}${costText ? ' · ' + esc(costText) : ''}</div>`,
    `<div class="bt-status ${status.cls}">${esc(status.text)}</div>`,
  ];
  return { html: lines.join(''), status };
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

// Position the tooltip near the cursor, kept inside the board box.
function positionTip(cssX, cssY) {
  if (!tipEl || !boardEl) return;
  const pad = 14;
  const bw = boardEl.clientWidth;
  const bh = boardEl.clientHeight;
  let left = cssX + pad;
  let top = cssY + pad;
  const tw = tipEl.offsetWidth || 180;
  const th = tipEl.offsetHeight || 60;
  if (left + tw > bw) left = Math.max(0, cssX - pad - tw);
  if (top + th > bh) top = Math.max(0, cssY - pad - th);
  tipEl.style.left = `${left}px`;
  tipEl.style.top = `${top}px`;
}

function showTip(routeId, cssX, cssY, pinned) {
  const r = routeVM(routeId);
  if (!r) { hideTip(); return; }
  const { html, status } = buildTip(r);
  tipEl.innerHTML = html;
  tipEl.classList.add('visible');
  tipEl.classList.toggle('pinned', !!pinned);
  positionTip(cssX, cssY);
  BOARD.tooltip = {
    routeId: r.id,
    claimable: !!r.claimable,
    affordable: !!r.affordable,
    claimed: !!r.claimed,
    ownerIndex: r.ownerIndex != null ? r.ownerIndex : null,
    ownerName: r.ownerName || null,
    ticketRelevant: !!r.ticketRelevant,
    ticketWeight: r.ticketWeight || 0,
    reason: r.reason || null,
    cost: r.cost || null,
    status: status.cls,
    pinned: !!pinned,
  };
}

function hideTip() {
  if (!tipEl) return;
  tipEl.classList.remove('visible', 'pinned');
  BOARD.tooltip = null;
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function localXY(ev) {
  const rect = canvasEl.getBoundingClientRect();
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
}

function onMove(ev) {
  if (!RC) return;
  clearPin();
  const id = routeAtClient(ev.clientX, ev.clientY);
  if (id == null) { hideTip(); return; }
  const { x, y } = localXY(ev);
  showTip(id, x, y, false);
}

function onLeave() {
  clearPin();
  hideTip();
}

// Claimable clicks are applied by main.js's own handler; here we only react to
// BLOCKED clicks by pinning the reason inline near the cursor (so the player
// learns "why not" without reading the log). On a claimable click we clear the
// tooltip and let the claim land.
function onClick(ev) {
  if (!RC) return;
  const id = routeAtClient(ev.clientX, ev.clientY);
  if (id == null) { hideTip(); return; }
  const r = routeVM(id);
  if (!r) { hideTip(); return; }
  if (r.claimable) { hideTip(); return; }
  const { x, y } = localXY(ev);
  showTip(id, x, y, true);
  pinTimer = setTimeout(() => { hideTip(); pinTimer = null; }, PIN_MS);
}

function clearPin() {
  if (pinTimer) { clearTimeout(pinTimer); pinTimer = null; }
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

function mount() {
  canvasEl = document.getElementById('map');
  boardEl = document.getElementById('board');
  if (!canvasEl || !boardEl) return;

  tipEl = document.createElement('div');
  tipEl.id = 'route-tip';
  tipEl.dataset.testid = 'route-tip';
  tipEl.setAttribute('role', 'status');
  boardEl.appendChild(tipEl);

  canvasEl.addEventListener('mousemove', onMove);
  canvasEl.addEventListener('mouseleave', onLeave);
  // Capture phase so the reason pins even though main.js also listens for clicks.
  canvasEl.addEventListener('click', onClick, true);

  // Touch: a tap shows the tooltip; main.js's click handles the claim.
  canvasEl.addEventListener('touchstart', (ev) => {
    const t = ev.touches && ev.touches[0];
    if (!t) return;
    const id = routeAtClient(t.clientX, t.clientY);
    if (id == null) { hideTip(); return; }
    const rect = canvasEl.getBoundingClientRect();
    showTip(id, t.clientX - rect.left, t.clientY - rect.top, true);
  }, { passive: true });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
}

// Exported for potential unit use; harmless in node (no DOM).
export { routeCenter, routeAt };
