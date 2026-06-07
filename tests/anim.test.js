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
