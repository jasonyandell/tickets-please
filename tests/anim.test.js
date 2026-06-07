// Unit tests for the animation kit (src/ui/anim.js).
//
// The whole point of this module is that animation is TESTABLE without timers:
//   - the frame model is a pure function of elapsed time (endpoints / midpoint /
//     monotonic / clamped), and
//   - the rAF driver's bookkeeping (start / retarget / cancel / settle) is driven
//     by an INJECTED clock + a no-op raf, so we exercise it with zero real timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clamp01,
  easeOutCubic,
  frame,
  pulse,
  popParams,
  createPopAnimator,
  POP_DURATION_MS,
  pulseCenter,
  bump,
  pulseIntensityAt,
  createLoopAnimator,
  PULSE_VELOCITY,
  PULSE_HALF_WIDTH,
} from '../src/ui/anim.js';

// ── Pure frame model ────────────────────────────────────────────────────────

test('clamp01 clamps to [0,1]', () => {
  assert.equal(clamp01(-1), 0);
  assert.equal(clamp01(0), 0);
  assert.equal(clamp01(0.5), 0.5);
  assert.equal(clamp01(1), 1);
  assert.equal(clamp01(2), 1);
});

test('easeOutCubic: fixed endpoints, monotonic, in-range', () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  let prev = -Infinity;
  for (let i = 0; i <= 20; i++) {
    const v = easeOutCubic(i / 20);
    assert.ok(v >= 0 && v <= 1, `eased value ${v} in [0,1]`);
    assert.ok(v >= prev, 'easeOutCubic is monotonic non-decreasing');
    prev = v;
  }
});

test('frame: frame(0)=from and frame(dur)=to', () => {
  assert.equal(frame(0, 10, 50, 200), 10);
  assert.equal(frame(200, 10, 50, 200), 50);
});

test('frame: strictly between endpoints at the midpoint', () => {
  const mid = frame(100, 0, 100, 200);
  assert.ok(mid > 0 && mid < 100, `midpoint ${mid} strictly between`);
});

test('frame: monotonic in elapsed across the range', () => {
  let prev = -Infinity;
  for (let e = 0; e <= 200; e += 10) {
    const v = frame(e, 0, 100, 200);
    assert.ok(v >= prev, `frame non-decreasing at elapsed=${e} (${v} < ${prev})`);
    prev = v;
  }
});

test('frame: clamped outside [0,dur] (no overshoot / NaN)', () => {
  assert.equal(frame(-50, 10, 50, 200), 10); // before start → from
  assert.equal(frame(999, 10, 50, 200), 50); // after end → to
  assert.equal(frame(123, 7, 7, 0), 7);      // zero duration → to immediately
});

// ── Pop envelope (the pulse + popParams) ────────────────────────────────────

test('pulse is a 0→1→0 pulse, peaking at the midpoint', () => {
  assert.ok(Math.abs(pulse(0, 360) - 0) < 1e-9, 'pulse(0)=0');
  assert.ok(Math.abs(pulse(360, 360) - 0) < 1e-9, 'pulse(dur)=0');
  assert.ok(Math.abs(pulse(180, 360) - 1) < 1e-9, 'pulse(dur/2)=1');
  assert.ok(Math.abs(pulse(99999, 360)) < 1e-9, 'clamped past the end → settled'); // t clamps to 1
});

test('popParams: settles to scale 1 / flash 0 at both ends; bulges mid', () => {
  const start = popParams(0);
  assert.ok(Math.abs(start.scale - 1) < 1e-9, 'scale settles to 1 at start');
  assert.ok(Math.abs(start.flash - 0) < 1e-9, 'no flash at start');
  assert.equal(start.progress, 0);

  const end = popParams(POP_DURATION_MS);
  assert.ok(Math.abs(end.scale - 1) < 1e-9, 'scale settles to 1 at end');
  assert.ok(Math.abs(end.flash - 0) < 1e-9, 'no flash at end');
  assert.equal(end.progress, 1);

  const mid = popParams(POP_DURATION_MS / 2);
  assert.ok(mid.scale > 1, 'box grows at the peak');
  assert.ok(mid.flash > 0, 'box flashes at the peak');
});

// ── Traveling pulse model (constant-velocity center + the `_-*-_` bump) ──────

test('pulseCenter: linear in elapsed at constant velocity', () => {
  const L = 10;
  const v = 0.5; // units/ms
  // Before wrapping, center == v*elapsed exactly (linear, slope = velocity).
  assert.equal(pulseCenter(0, L, v), 0);
  assert.equal(pulseCenter(4, L, v), 2);
  assert.equal(pulseCenter(8, L, v), 4);
  // Equal time steps → equal position steps (constant velocity).
  const d1 = pulseCenter(8, L, v) - pulseCenter(4, L, v);
  const d2 = pulseCenter(12, L, v) - pulseCenter(8, L, v);
  assert.ok(Math.abs(d1 - d2) < 1e-9, 'constant velocity ⇒ equal steps');
});

test('pulseCenter: wraps to 0 at the period (period = length / velocity)', () => {
  const L = 10;
  const v = 0.5;
  const period = L / v; // 20 ms
  assert.ok(Math.abs(pulseCenter(period, L, v) - 0) < 1e-9, 'wraps to 0 at one period');
  assert.ok(Math.abs(pulseCenter(2 * period, L, v) - 0) < 1e-9, 'wraps to 0 at two periods');
  // Just before the period it is near the far end (about to wrap).
  assert.ok(pulseCenter(period - 1e-6, L, v) > L - 1e-3, 'approaches length just before wrap');
  // Phase is preserved across a period: center(t) === center(t + period).
  assert.ok(Math.abs(pulseCenter(3, L, v) - pulseCenter(3 + period, L, v)) < 1e-9, 'periodic');
  // Always within [0, length).
  for (let e = 0; e < 100; e += 7) {
    const c = pulseCenter(e, L, v);
    assert.ok(c >= 0 && c < L, `center ${c} in [0, ${L})`);
  }
});

test('pulseCenter: longer path has a proportionally longer period', () => {
  const v = PULSE_VELOCITY;
  // Period scales with length at fixed velocity, so a path twice as long takes
  // twice as long to loop (the "constant velocity" promise).
  const shortPeriod = 6 / v;
  const longPeriod = 12 / v;
  assert.ok(Math.abs(longPeriod / shortPeriod - 2) < 1e-9, 'double length ⇒ double period');
});

test('bump: peak 1 at center, symmetric, → 0 at the edges (and beyond)', () => {
  const hw = PULSE_HALF_WIDTH;
  assert.ok(Math.abs(bump(0, hw) - 1) < 1e-9, 'peak of 1 at the center');
  assert.ok(Math.abs(bump(hw, hw) - 0) < 1e-9, 'falls to 0 at +halfWidth');
  assert.ok(Math.abs(bump(-hw, hw) - 0) < 1e-9, 'falls to 0 at -halfWidth');
  assert.equal(bump(hw + 5, hw), 0, 'stays 0 beyond the edge');
  assert.equal(bump(-hw - 5, hw), 0, 'stays 0 beyond the far edge');
  // Symmetric: bump(-d) === bump(d).
  for (let d = 0; d <= hw; d += hw / 8) {
    assert.ok(Math.abs(bump(d, hw) - bump(-d, hw)) < 1e-12, `symmetric at d=${d}`);
  }
  // Monotonic decreasing from the center out to the edge.
  let prev = Infinity;
  for (let d = 0; d <= hw; d += hw / 16) {
    const v = bump(d, hw);
    assert.ok(v <= prev + 1e-12, `non-increasing away from center at d=${d}`);
    assert.ok(v >= 0 && v <= 1, `bump value ${v} in [0,1]`);
    prev = v;
  }
});

test('pulseIntensityAt: brightest where the center sits, wraps the short way', () => {
  const L = 10;
  const v = 0.5; // center = v*elapsed (mod L)
  // At elapsed=8 the center is at distance 4. A route centered there is brightest.
  const at4 = pulseIntensityAt(8, L, 4, { velocity: v, halfWidth: PULSE_HALF_WIDTH });
  assert.ok(Math.abs(at4 - 1) < 1e-9, 'peak intensity right at the center');
  // A point far from the center (and far the short way around) is dark.
  const far = pulseIntensityAt(8, L, 9, { velocity: v, halfWidth: PULSE_HALF_WIDTH });
  assert.equal(far, 0, 'dark well outside the bump');
  // Wrap-aware: with the center near the end (9), distance to point 0 is 1 the
  // SHORT way around a length-10 loop — so it lights up (within the bump).
  const wrapped = pulseIntensityAt(18, L, 0, { velocity: v, halfWidth: PULSE_HALF_WIDTH });
  assert.ok(wrapped > 0, 'pulse near the end bleeds across the wrap to the start');
});

// ── The rAF driver (injected clock + no-op raf → NO real timers) ────────────

// A controllable clock + a raf that never auto-fires, so .tick() is the only way
// the driver advances. This keeps the test fully deterministic with zero timers.
function harness() {
  let t = 0;
  const events = { frames: 0, changes: 0 };
  const animator = createPopAnimator({
    now: () => t,
    raf: () => 1,        // hand back a truthy handle; never schedule a callback
    caf: () => {},
    onFrame: () => { events.frames += 1; },
    onChange: () => { events.changes += 1; },
  });
  return { animator, events, advance: (ms) => { t += ms; }, at: (ms) => { t = ms; } };
}

test('driver: start activates and exposes live params; settles after duration', () => {
  const h = harness();
  assert.equal(h.animator.isActive(), false);
  assert.equal(h.animator.paramsFor('r1'), null, 'no params before start');

  h.animator.start('r1');
  assert.equal(h.animator.isActive(), true, 'active after start');
  const p0 = h.animator.paramsFor('r1');
  assert.ok(p0 && p0.scale === 1, 'params available, scale starts at 1');

  h.at(POP_DURATION_MS / 2);
  assert.ok(h.animator.paramsFor('r1').scale > 1, 'mid-flight the box is scaled up');

  // Past the duration, a tick prunes it and the driver goes idle.
  h.at(POP_DURATION_MS + 1);
  h.animator.tick();
  assert.equal(h.animator.isActive(), false, 'settled after duration elapses');
  assert.equal(h.animator.paramsFor('r1'), null, 'no params once settled');
});

test('driver: cancel stops an in-flight pop (interruptable)', () => {
  const h = harness();
  h.animator.start('r1');
  assert.equal(h.animator.isActive(), true);

  const had = h.animator.cancel('r1');
  assert.equal(had, true, 'cancel reports it was running');
  assert.equal(h.animator.isActive(), false, 'cancel clears the active set');
  assert.equal(h.animator.paramsFor('r1'), null, 'no params after cancel');

  assert.equal(h.animator.cancel('r1'), false, 'cancelling again is a no-op');
});

test('driver: start retargets a running pop (restarts its clock)', () => {
  const h = harness();
  h.animator.start('r1');
  h.at(POP_DURATION_MS - 10); // nearly done

  h.animator.start('r1');     // retarget at this time → clock restarts here
  const p = h.animator.paramsFor('r1');
  assert.ok(Math.abs(p.progress - 0) < 1e-9, 'retarget restarts progress at 0');
  assert.equal(h.animator.isActive(), true);
});

test('driver: multiple pops settle independently; cancelAll clears them', () => {
  const h = harness();
  h.animator.start('a');
  h.at(POP_DURATION_MS - 5);
  h.animator.start('b');      // 'b' starts later, so it outlives 'a'

  h.at(POP_DURATION_MS + 1);  // 'a' has elapsed; 'b' has not
  h.animator.tick();
  assert.equal(h.animator.paramsFor('a'), null, "'a' settled");
  assert.ok(h.animator.paramsFor('b'), "'b' still animating");
  assert.equal(h.animator.isActive(), true);

  h.animator.cancelAll();
  assert.equal(h.animator.isActive(), false, 'cancelAll clears everything');
});

test('driver: onFrame/onChange fire (observable for the renderer flags)', () => {
  const h = harness();
  h.animator.start('r1');
  assert.ok(h.events.changes >= 1, 'idle→active fires onChange (renderer flips flag on)');

  h.at(POP_DURATION_MS + 1);
  h.animator.tick();          // prune + repaint + settle
  assert.ok(h.events.frames >= 1, 'tick repaints via onFrame');
  assert.ok(h.events.changes >= 2, 'active→idle fires onChange (renderer flips flag off)');
});

// ── The continuous LOOP driver (the traveling pulse's timing home) ──────────

// A raf that records scheduled callbacks WITHOUT auto-firing, so the test fully
// controls advancement (drive frames by calling the captured cb). NO real timers.
function loopHarness() {
  let scheduled = null;
  let frames = 0;
  let rafCalls = 0;
  const animator = createLoopAnimator({
    raf: (cb) => { scheduled = cb; rafCalls += 1; return rafCalls; },
    caf: () => { scheduled = null; },
    onFrame: () => { frames += 1; },
  });
  return {
    animator,
    counts: () => ({ frames, rafCalls }),
    // Fire the most recently scheduled frame (the loop re-schedules itself).
    pump: () => { const cb = scheduled; scheduled = null; if (cb) cb(); },
    hasScheduled: () => scheduled != null,
  };
}

test('loop driver: starts idle, runs continuously while started, re-schedules each frame', () => {
  const h = loopHarness();
  assert.equal(h.animator.isRunning(), false, 'idle before start');
  assert.equal(h.counts().rafCalls, 0, 'no frame scheduled before start');

  h.animator.start();
  assert.equal(h.animator.isRunning(), true, 'running after start');
  assert.equal(h.counts().rafCalls, 1, 'start schedules the first frame');

  h.pump(); // run frame 1 → paints, then re-schedules itself
  assert.equal(h.counts().frames, 1, 'frame painted via onFrame');
  assert.equal(h.counts().rafCalls, 2, 'a running loop re-schedules the next frame');

  h.pump(); // frame 2
  assert.equal(h.counts().frames, 2, 'keeps painting frame after frame');
  assert.equal(h.counts().rafCalls, 3, 'and keeps re-scheduling (continuous)');
});

test('loop driver: start is idempotent (re-asserting does not double-schedule)', () => {
  const h = loopHarness();
  h.animator.start();
  h.animator.start(); // no-op while already running
  h.animator.start();
  assert.equal(h.counts().rafCalls, 1, 'still only one outstanding scheduled frame');
});

test('loop driver: stop halts the loop (next frame does not re-schedule)', () => {
  const h = loopHarness();
  h.animator.start();
  h.pump(); // frame 1, re-schedules
  assert.ok(h.hasScheduled(), 'a frame is queued while running');

  h.animator.stop();
  assert.equal(h.animator.isRunning(), false, 'stopped');
  assert.equal(h.hasScheduled(), false, 'stop cancels the queued frame');

  const before = h.counts().frames;
  h.pump(); // nothing queued → no-op
  assert.equal(h.counts().frames, before, 'no more frames after stop');
});

test('loop driver: tick() paints once without a real frame (deterministic hook)', () => {
  const h = loopHarness();
  h.animator.start();
  const before = h.counts().frames;
  h.animator.tick();
  assert.equal(h.counts().frames, before + 1, 'tick repaints exactly once');
});
