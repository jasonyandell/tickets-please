// board.js — board INTERACTION + route-clarity layer for tickets-please.
//
// This module makes the map self-explanatory: hover (or tap) any route and a
// tooltip near the cursor shows its cost, whether you can claim it, and — when
// you can't — exactly why. It reads FACTS from the Observable State Contract
// (window.__APP__.viewModel.routes: { id, from, to, length, color, cost,
// claimable, affordable, reason, claimed, ownerName }).
//
// SVG era: routes are real elements (g.route[data-route-id] under #map), so
// "which route is under the cursor" is just event.target.closest() — the old
// canvas hit-testing (transform inversion + point-in-polygon) is gone, and
// this module needs NO geometry pushed from the renderer.
//
// Division of labour with main.js (which owns the engine): claiming a
// claimable route is still applied by main.js's click handler. This layer adds
// the human-facing clarity on top — the hover tooltip, the distinct
// claimable-vs-affordable read, and the INLINE blocked reason near the cursor
// so a player never has to read the log to learn why a route is unavailable.

// DOM handles, resolved once on mount.
let svgEl = null;
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

// ---------------------------------------------------------------------------
// Route lookup — straight off the DOM (real elements, real boxes)
// ---------------------------------------------------------------------------

function routeIdFromTarget(target) {
  if (!target || typeof target.closest !== 'function') return null;
  const g = target.closest('[data-route-id]');
  return g ? g.getAttribute('data-route-id') : null;
}

// CSS-pixel point on a route relative to #map. Uses the route's middle car
// slot (always a real element — never a gap between slots), so the returned
// point is guaranteed to land on the route for hover/click.
function routeCenter(id) {
  if (!svgEl) return null;
  const g = svgEl.querySelector(`[data-route-id="${cssEscape(String(id))}"]`);
  if (!g) return null;
  const cars = g.querySelectorAll('.car');
  if (!cars.length) return null;
  const mid = cars[Math.floor(cars.length / 2)];
  const r = mid.getBoundingClientRect();
  const s = svgEl.getBoundingClientRect();
  return { x: r.left + r.width / 2 - s.left, y: r.top + r.height / 2 - s.top };
}

// Route id under a CSS-pixel point relative to #map (null if none).
function routeAt(cssX, cssY) {
  if (!svgEl || typeof document === 'undefined' || !document.elementsFromPoint) return null;
  const s = svgEl.getBoundingClientRect();
  const els = document.elementsFromPoint(s.left + cssX, s.top + cssY);
  for (const e of els) {
    const id = routeIdFromTarget(e);
    if (id != null) return id;
  }
  return null;
}

function cssEscape(s) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
  return s.replace(/["\\]/g, '\\$&');
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

function cityLabel(id) {
  if (svgEl) {
    const g = svgEl.querySelector(`.city[data-city-id="${cssEscape(String(id))}"] .city-label`);
    if (g && g.textContent) return g.textContent;
  }
  return String(id);
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
  const title = `${cityLabel(r.from)} → ${cityLabel(r.to)}`;
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
  const rect = svgEl.getBoundingClientRect();
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
}

function onMove(ev) {
  if (!svgEl) return;
  clearPin();
  const id = routeIdFromTarget(ev.target);
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
  if (!svgEl) return;
  const id = routeIdFromTarget(ev.target);
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
  svgEl = document.getElementById('map');
  boardEl = document.getElementById('board');
  if (!svgEl || !boardEl) return;

  tipEl = document.createElement('div');
  tipEl.id = 'route-tip';
  tipEl.dataset.testid = 'route-tip';
  tipEl.setAttribute('role', 'status');
  boardEl.appendChild(tipEl);

  svgEl.addEventListener('mousemove', onMove);
  svgEl.addEventListener('mouseleave', onLeave);
  // Capture phase so the reason pins even though main.js also listens for clicks.
  svgEl.addEventListener('click', onClick, true);

  // Touch: a tap shows the tooltip; main.js's click handles the claim.
  svgEl.addEventListener('touchstart', (ev) => {
    const t = ev.touches && ev.touches[0];
    if (!t) return;
    let id = null;
    if (typeof document !== 'undefined' && document.elementsFromPoint) {
      for (const e of document.elementsFromPoint(t.clientX, t.clientY)) {
        id = routeIdFromTarget(e);
        if (id != null) break;
      }
    }
    if (id == null) { hideTip(); return; }
    const rect = svgEl.getBoundingClientRect();
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
