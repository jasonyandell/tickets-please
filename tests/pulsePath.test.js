import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pathSlotLayout } from '../src/ui/render.js';

// The pure per-square layout behind the traveling ticket pulse (G2): slot
// distances march source→dest along the walk, reversing a route's DOM slot
// order when the path enters it at its `to` end.

const ROUTES = {
  'A-B': { from: 'A', to: 'B', length: 2, slots: 2 },
  'C-B': { from: 'C', to: 'B', length: 3, slots: 3 },
  'C-D': { from: 'C', to: 'D', length: 1, slots: 1 },
};
const getRoute = (id) => ROUTES[id] || null;

test('forward route: slot distances follow DOM order', () => {
  const { pathLength, slots } = pathSlotLayout(['A-B'], 'A', getRoute);
  assert.equal(pathLength, 2);
  assert.deepEqual(slots, [
    { id: 'A-B', domIndex: 0, center: 0.5 },
    { id: 'A-B', domIndex: 1, center: 1.5 },
  ]);
});

test('a route entered at its `to` end reverses its DOM slot order', () => {
  // Walk A→B→C: C-B is entered at B (its `to`), so DOM slot 2 comes first.
  const { pathLength, slots } = pathSlotLayout(['A-B', 'C-B'], 'A', getRoute);
  assert.equal(pathLength, 5);
  const cb = slots.filter((s) => s.id === 'C-B');
  assert.deepEqual(cb.map((s) => s.domIndex), [2, 1, 0], 'reversed along the walk');
  assert.deepEqual(cb.map((s) => s.center), [2.5, 3.5, 4.5]);
});

test('centers are strictly increasing across the whole multi-route walk', () => {
  const { slots } = pathSlotLayout(['A-B', 'C-B', 'C-D'], 'A', getRoute);
  for (let i = 1; i < slots.length; i++) {
    assert.ok(slots[i].center > slots[i - 1].center, `monotonic at ${i}`);
  }
  // And the walk ends at D via C: the last slot belongs to C-D.
  assert.equal(slots[slots.length - 1].id, 'C-D');
});

test('unknown route ids are skipped without breaking the walk distances', () => {
  const { pathLength, slots } = pathSlotLayout(['A-B', 'nope', 'C-B'], 'A', getRoute);
  assert.equal(pathLength, 5);
  assert.equal(slots.length, 5);
});

test('empty/null input is safe', () => {
  assert.deepEqual(pathSlotLayout([], 'A', getRoute), { pathLength: 0, slots: [] });
  assert.deepEqual(pathSlotLayout(null, 'A', getRoute), { pathLength: 0, slots: [] });
});
