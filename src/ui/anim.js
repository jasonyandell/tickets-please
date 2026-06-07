// anim.js — the tiny, verification-first animation kit for tickets-please.
//
// HOW WE TEST ANIMATIONS (the recipe this module establishes):
//   1. A PURE frame model. All motion is a function of time: frame()/pulse()/
//      popParams() take an `elapsed` number and return values — no timers, no
//      globals, no DOM. These are unit-tested directly (endpoints, midpoint,
//      monotonic, clamped) with zero flake.
//   2. ONE isolated rAF driver (createPopAnimator) that reads performance.now()
//      and re-paints each frame. It is cancelable + retargetable and uses
//      requestAnimationFrame ONLY — never setTimeout (no temporal coupling). Its
//      clock/raf are injectable, so its bookkeeping (start/cancel/settle) is
//      unit-tested with a fake clock and NO real timers.
//   3. INSTANT MODE. Under a test flag (window.__INSTANT_ANIM__ / ?test) or the
//      user's prefers-reduced-motion, animations resolve to their final state
//      immediately and the driver never schedules a frame. So e2e (and a11y)
//      reach the settled visual with ZERO timing coupling — the test asserts a
//      durable fact (pop count incremented, data-animating back to 'false'),
//      not a sleep. See e2e/anim.spec.js.
//
// This file is import-safe everywhere (node tests, browser). It touches no DOM;
// the renderer (render.js) owns the canvas and just asks this module for params.

// ── Pure frame model ────────────────────────────────────────────────────────

// Clamp a normalized time to [0, 1].
export function clamp01(t) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

// Ease-out cubic: fast then settling. ease(0)=0, ease(1)=1, monotonic on [0,1].
export function easeOutCubic(t) {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

// Pure eased interpolation from `from` to `to` over `dur`. Guarantees:
//   frame(0)        === from
//   frame(dur)      === to
//   monotonic in elapsed (for a monotonic ease)
//   clamped outside [0, dur] (elapsed<0 → from, elapsed>dur → to)
// No timers — elapsed is supplied by the caller.
export function frame(elapsed, from, to, dur, ease = easeOutCubic) {
  if (!(dur > 0)) return to;
  const t = clamp01(elapsed / dur);
  return from + (to - from) * ease(t);
}

// A 0→1→0 pulse used to drive a brief "pop" (rise then settle). Pure.
//   pulse(0, dur)       === 0
//   pulse(dur, dur)     === 0
//   pulse(dur/2, dur)   === 1   (the peak)
// Clamped outside [0, dur] (so a stale/overrun elapsed reads as settled, not NaN).
export function pulse(elapsed, dur) {
  if (!(dur > 0)) return 0;
  const t = clamp01(elapsed / dur);
  return Math.sin(t * Math.PI);
}

// Pop tuning — a claimed route briefly grows + flashes white, then settles.
export const POP_DURATION_MS = 360;
export const POP_PEAK_SCALE = 0.45; // +45% size at the peak
export const POP_PEAK_FLASH = 0.55; // white-overlay alpha at the peak

// Visual params for a pop at a given elapsed time. Pure. Settles to the owned
// style: at elapsed 0 and elapsed>=dur, scale=1 and flash=0 (no residue).
export function popParams(elapsed, dur = POP_DURATION_MS) {
  const p = pulse(elapsed, dur);
  return {
    scale: 1 + POP_PEAK_SCALE * p,
    flash: POP_PEAK_FLASH * p,
    progress: clamp01(elapsed / dur),
  };
}

// ── Instant mode ────────────────────────────────────────────────────────────

// True when animations should resolve instantly (final state, no frames):
//   window.__INSTANT_ANIM__   — explicit test/opt-out flag
//   ?test                     — the verification path (also disables auto-reload)
//   prefers-reduced-motion    — the user asked for no motion
// Import-safe: any access throwing (no window/matchMedia) falls back to false.
export function isInstantMode() {
  try {
    if (typeof window === 'undefined') return false;
    if (window.__INSTANT_ANIM__) return true;
    const search = (typeof location !== 'undefined' && location.search) || '';
    if (new URLSearchParams(search).has('test')) return true;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return true;
    }
  } catch (_) { /* fall through */ }
  return false;
}

// ── The rAF driver ──────────────────────────────────────────────────────────

// A tiny pop animator: tracks per-id start times, advances on requestAnimationFrame,
// and repaints via onFrame each tick until every pop has elapsed, then fires
// onChange (settled). ONE driver; no setTimeout. Cancelable + retargetable.
//
// Injectables (opts) keep it unit-testable with a fake clock and a no-op raf —
// drive prune/settle by calling .tick() yourself, with NO real timers:
//   now()  → current time in ms (default performance.now)
//   raf(cb)→ schedule a frame (default requestAnimationFrame)
//   caf(h) → cancel a scheduled frame (default cancelAnimationFrame)
//   duration, onFrame(), onChange()
export function createPopAnimator(opts = {}) {
  const now = opts.now
    || (() => (typeof performance !== 'undefined' && performance.now ? performance.now() : 0));
  const raf = opts.raf
    || ((cb) => (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(cb) : null));
  const caf = opts.caf
    || ((h) => { if (typeof cancelAnimationFrame !== 'undefined' && h != null) cancelAnimationFrame(h); });
  const dur = opts.duration || POP_DURATION_MS;
  const onFrame = opts.onFrame || (() => {});
  const onChange = opts.onChange || (() => {});

  const starts = new Map(); // id -> start time (ms)
  let handle = null;        // current rAF handle, or null when idle

  const active = () => starts.size > 0;

  // Drop any pops whose time has fully elapsed. Returns whether anything changed.
  function prune() {
    const t = now();
    let changed = false;
    for (const [id, s] of starts) {
      if (t - s >= dur) { starts.delete(id); changed = true; }
    }
    return changed;
  }

  function loop() {
    handle = null;
    prune();
    onFrame();                       // repaint with the current frame's params
    if (active()) {
      handle = raf(loop);            // keep going while pops are live
    } else {
      onChange();                    // idle again → let the renderer settle flags
    }
  }

  return {
    // Begin a pop for id; if one is already running, RETARGET it (restart clock).
    start(id) {
      const wasActive = active();
      starts.set(String(id), now());
      if (!wasActive) onChange();    // idle → active: let the renderer flag it
      if (handle == null) handle = raf(loop);
      return this;
    },
    // Cancel a single pop (interruptable). Returns whether it was running.
    cancel(id) {
      const had = starts.delete(String(id));
      if (had && !active()) {
        caf(handle); handle = null;
        onChange();
      }
      return had;
    },
    // Cancel every pop at once.
    cancelAll() {
      if (!active()) return;
      starts.clear();
      caf(handle); handle = null;
      onChange();
    },
    // Visual params for id right now, or null if it isn't animating.
    paramsFor(id) {
      const s = starts.get(String(id));
      return s == null ? null : popParams(now() - s, dur);
    },
    isActive: active,
    // Deterministic test hook: prune with the (injected) clock, repaint, and fire
    // onChange when it settles — the rAF loop's body, callable without a frame.
    tick() {
      prune();
      onFrame();
      if (!active()) onChange();
      return active();
    },
  };
}
