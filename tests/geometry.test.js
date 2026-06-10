import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  routeSegments,
  computeLayout,
  parallelInfo,
  fitTransform,
  applyTransform,
  mapBounds,
  getRoutes,
  getCities,
  routeLength,
  routeId,
} from '../src/ui/geometry.js';

// A small synthetic map. geometry.js is pure, so it only needs the city x,y
// coordinates and route endpoints/length — independent of the engine.
function makeMap() {
  return {
    cities: [
      { id: 'A', name: 'Aville', x: 0, y: 0 },
      { id: 'B', name: 'Bton', x: 100, y: 0 },     // horizontal from A
      { id: 'C', name: 'Cport', x: 0, y: 100 },    // vertical from A
      { id: 'D', name: 'Dburg', x: 100, y: 100 },
    ],
    routes: [
      { id: 'A-B', from: 'A', to: 'B', length: 3, color: 'red' },
      { id: 'A-C', from: 'A', to: 'C', length: 2, color: 'blue' },
      // Two parallel routes between B and D (a "double" route).
      { id: 'B-D#1', from: 'B', to: 'D', length: 4, color: 'green' },
      { id: 'B-D#2', from: 'B', to: 'D', length: 4, color: 'yellow' },
      // A single long route C-D.
      { id: 'C-D', from: 'C', to: 'D', length: 5, color: 'gray' },
    ],
  };
}

test('routeSegments returns one slot per unit of route length', () => {
  const map = makeMap();
  for (const r of getRoutes(map)) {
    const boxes = routeSegments(r, map);
    assert.equal(boxes.length, r.length, `route ${r.id} should have ${r.length} slots`);
    for (const box of boxes) {
      assert.ok(Number.isFinite(box.cx) && Number.isFinite(box.cy));
      assert.ok(box.w > 0 && box.h > 0);
      assert.ok(Number.isFinite(box.angle));
    }
  }
});

test('slots lie along the route between its two cities, in order', () => {
  const map = makeMap();
  // A-B is horizontal at y=0. All slot centers should be ~y=0 and 0<x<100.
  const boxes = routeSegments(map.routes[0], map);
  for (const box of boxes) {
    assert.ok(Math.abs(box.cy) < 1e-6 + 1, `cy near 0, got ${box.cy}`);
    assert.ok(box.cx > 0 && box.cx < 100, `cx within segment, got ${box.cx}`);
  }
  // Centers must be monotonically increasing in x (ordered along the route).
  for (let i = 1; i < boxes.length; i++) {
    assert.ok(boxes[i].cx > boxes[i - 1].cx, 'slots ordered along route');
  }
});

test('slots are evenly spaced along the route', () => {
  const map = makeMap();
  for (const r of getRoutes(map)) {
    const boxes = routeSegments(r, map);
    if (boxes.length < 3) continue;
    const gaps = [];
    for (let i = 1; i < boxes.length; i++) {
      gaps.push(Math.hypot(boxes[i].cx - boxes[i - 1].cx, boxes[i].cy - boxes[i - 1].cy));
    }
    for (const g of gaps) {
      assert.ok(Math.abs(g - gaps[0]) < 1e-9, `even spacing on ${r.id}: ${g} vs ${gaps[0]}`);
    }
  }
});

test('end slots clear the city markers (margins at both ends)', () => {
  const map = makeMap();
  const idx = new Map(map.cities.map((c) => [c.id, c]));
  for (const r of getRoutes(map)) {
    const boxes = routeSegments(r, map);
    const a = idx.get(r.from);
    const b = idx.get(r.to);
    const dFirst = Math.hypot(boxes[0].cx - a.x, boxes[0].cy - a.y);
    const dLast = Math.hypot(boxes[boxes.length - 1].cx - b.x, boxes[boxes.length - 1].cy - b.y);
    // Each end slot's center must clear its city by at least half a slot,
    // so the slot body never overlaps the city marker.
    assert.ok(dFirst > boxes[0].w / 2, `${r.id}: first slot clears ${r.from} (${dFirst})`);
    assert.ok(dLast > boxes[boxes.length - 1].w / 2, `${r.id}: last slot clears ${r.to} (${dLast})`);
  }
});

test('slot angle follows the route direction', () => {
  const map = makeMap();
  // A-B horizontal → angle ~0; A-C vertical → angle ~π/2.
  const ab = routeSegments(map.routes[0], map)[0];
  assert.ok(Math.abs(ab.angle) < 1e-9, `horizontal angle ~0, got ${ab.angle}`);
  const ac = routeSegments(map.routes[1], map)[0];
  assert.ok(Math.abs(Math.abs(ac.angle) - Math.PI / 2) < 1e-9, `vertical angle ~±π/2, got ${ac.angle}`);
});

test('double routes get two distinct, offset parallel lines', () => {
  const map = makeMap();
  const r1 = map.routes.find((r) => r.id === 'B-D#1');
  const r2 = map.routes.find((r) => r.id === 'B-D#2');

  const info1 = parallelInfo(r1, map);
  const info2 = parallelInfo(r2, map);
  assert.equal(info1.count, 2);
  assert.equal(info2.count, 2);
  assert.ok(info1.isDouble && info2.isDouble);
  assert.notEqual(info1.index, info2.index, 'the two parallels have different offset indices');

  // Geometrically: their slot centers must be offset perpendicular to the line.
  const boxes1 = routeSegments(r1, map);
  const boxes2 = routeSegments(r2, map);
  assert.equal(boxes1.length, boxes2.length);
  // B-D is vertical (x=100). Offset is horizontal, so cx differs but slots pair
  // up at the same height (cy).
  for (let i = 0; i < boxes1.length; i++) {
    assert.ok(
      Math.abs(boxes1[i].cx - boxes2[i].cx) > 1,
      'parallel slots are horizontally offset from each other',
    );
    assert.ok(
      Math.abs(boxes1[i].cy - boxes2[i].cy) < 1e-6,
      'parallel slots share the same position along the route',
    );
  }
});

test('parallel slots never overlap: separation >= slot thickness', () => {
  const map = makeMap();
  const boxes1 = routeSegments(map.routes.find((r) => r.id === 'B-D#1'), map);
  const boxes2 = routeSegments(map.routes.find((r) => r.id === 'B-D#2'), map);
  for (let i = 0; i < boxes1.length; i++) {
    const sep = Math.abs(boxes1[i].cx - boxes2[i].cx);
    assert.ok(sep >= boxes1[i].h, `separation ${sep} >= thickness ${boxes1[i].h}`);
  }
});

test('single (non-double) route reports count 1 and zero offset', () => {
  const map = makeMap();
  const info = parallelInfo(map.routes.find((r) => r.id === 'C-D'), map);
  assert.equal(info.count, 1);
  assert.equal(info.isDouble, false);
});

test('a route flagged double=true is treated as a double even when alone', () => {
  const map = {
    cities: [
      { id: 'X', x: 0, y: 0 },
      { id: 'Y', x: 50, y: 0 },
    ],
    routes: [{ id: 'X-Y', from: 'X', to: 'Y', length: 2, double: true }],
  };
  const info = parallelInfo(map.routes[0], map);
  assert.equal(info.isDouble, true);
  assert.ok(info.count >= 2);
});

test('computeLayout covers every route and city', () => {
  const map = makeMap();
  const layout = computeLayout(map);
  assert.equal(layout.routes.length, map.routes.length);
  assert.equal(layout.cities.length, map.cities.length);
  for (const rl of layout.routes) {
    assert.ok(rl.id != null);
    assert.ok(rl.boxes.length >= 1);
  }
  for (const c of layout.cities) {
    assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y));
  }
});

test('fitTransform maps every city inside the padded viewBox', () => {
  const map = makeMap();
  const W = 1200; const H = 760; const PAD = 50;
  const t = fitTransform(map, W, H, PAD);
  assert.ok(t.scale > 0);
  for (const c of getCities(map)) {
    const p = applyTransform({ x: c.x, y: c.y }, t);
    assert.ok(p.x >= PAD - 1e-6 && p.x <= W - PAD + 1e-6, `x in bounds: ${p.x}`);
    assert.ok(p.y >= PAD - 1e-6 && p.y <= H - PAD + 1e-6, `y in bounds: ${p.y}`);
  }
});

test('mapBounds spans exactly the city extremes', () => {
  const map = makeMap();
  const b = mapBounds(map);
  assert.deepEqual(b, { minX: 0, minY: 0, maxX: 100, maxY: 100 });
});

test('routeLength is defensive: floor, min 1, len/cost fallbacks', () => {
  assert.equal(routeLength({ length: 3.9 }), 3);
  assert.equal(routeLength({ length: 0 }), 1);
  assert.equal(routeLength({ len: 2 }), 2);
  assert.equal(routeLength({ cost: 4 }), 4);
  assert.equal(routeLength({}), 1);
  assert.equal(routeLength(null), 1);
});

test('routeId falls back to from-to when id is missing', () => {
  assert.equal(routeId({ id: 'r1' }), 'r1');
  assert.equal(routeId({ from: 'A', to: 'B' }), 'A-B');
});

test('getCities / getRoutes tolerate alternate field names', () => {
  const map = {
    nodes: [{ id: 'P', x: 1, y: 2 }, { id: 'Q', x: 3, y: 4 }],
    edges: [{ id: 'e1', a: 'P', b: 'Q', len: 2 }],
  };
  assert.equal(getCities(map).length, 2);
  assert.equal(getRoutes(map).length, 1);
  const boxes = routeSegments(map.edges[0], map);
  assert.equal(boxes.length, 2);
});
