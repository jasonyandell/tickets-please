import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  routeSegments,
  computeLayout,
  hitTestRoute,
  cityAt,
  parallelInfo,
  pointInPolygon,
  fitTransform,
  applyTransform,
  invertTransform,
  getRoutes,
  getCities,
} from '../src/ui/layout.js';

// A small synthetic map. layout.js is pure geometry, so it only needs the
// city x,y coordinates and route endpoints/length — independent of the engine.
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

test('routeSegments returns one box per unit of route length', () => {
  const map = makeMap();
  for (const r of getRoutes(map)) {
    const boxes = routeSegments(r, map);
    assert.equal(boxes.length, r.length, `route ${r.id} should have ${r.length} boxes`);
    for (const box of boxes) {
      assert.equal(box.corners.length, 4, 'each box is a quad');
      assert.ok(Number.isFinite(box.cx) && Number.isFinite(box.cy));
      assert.ok(box.w > 0 && box.h > 0);
    }
  }
});

test('boxes lie along the route between its two cities', () => {
  const map = makeMap();
  // A-B is horizontal at y=0. All box centers should be ~y=0 and 0<x<100.
  const boxes = routeSegments(map.routes[0], map);
  for (const box of boxes) {
    assert.ok(Math.abs(box.cy) < 1e-6 + 1, `cy near 0, got ${box.cy}`);
    assert.ok(box.cx > 0 && box.cx < 100, `cx within segment, got ${box.cx}`);
  }
  // Centers should be monotonically increasing in x (ordered along the route).
  for (let i = 1; i < boxes.length; i++) {
    assert.ok(boxes[i].cx > boxes[i - 1].cx, 'boxes ordered along route');
  }
});

test('hitTestRoute returns the right route for a point on it', () => {
  const map = makeMap();
  const layout = computeLayout(map);
  // Pick the center of the first box of route A-B.
  const abLayout = layout.routes.find((r) => r.id === 'A-B');
  const box = abLayout.boxes[0];
  const hit = hitTestRoute({ x: box.cx, y: box.cy }, map, layout);
  assert.equal(hit, 'A-B');

  // Center of a box on A-C (vertical route).
  const acLayout = layout.routes.find((r) => r.id === 'A-C');
  const acBox = acLayout.boxes[0];
  const hit2 = hitTestRoute({ x: acBox.cx, y: acBox.cy }, map, layout);
  assert.equal(hit2, 'A-C');
});

test('hitTestRoute returns null for a point off any route', () => {
  const map = makeMap();
  const layout = computeLayout(map);
  // Far away from everything.
  assert.equal(hitTestRoute({ x: -500, y: -500 }, map, layout), null);
  // Near a city corner but not on a route box (margins keep boxes off the dots).
  assert.equal(hitTestRoute({ x: 1, y: 1 }, map, layout), null);
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

  // Geometrically: their box centers must be offset perpendicular to the line.
  const boxes1 = routeSegments(r1, map);
  const boxes2 = routeSegments(r2, map);
  assert.equal(boxes1.length, boxes2.length);
  // B-D is vertical (x=100). Offset is horizontal, so cx differs but boxes pair
  // up at the same height (cy).
  for (let i = 0; i < boxes1.length; i++) {
    assert.ok(
      Math.abs(boxes1[i].cx - boxes2[i].cx) > 1,
      'parallel boxes are horizontally offset from each other',
    );
    assert.ok(
      Math.abs(boxes1[i].cy - boxes2[i].cy) < 1e-6,
      'parallel boxes share the same position along the route',
    );
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

test('cityAt returns the nearest city within radius, null otherwise', () => {
  const map = makeMap();
  const near = cityAt({ x: 2, y: 2 }, map, { radius: 16 });
  assert.ok(near);
  assert.equal(near.id, 'A');
  assert.equal(cityAt({ x: 50, y: 50 }, map, { radius: 5 }), null);
});

test('pointInPolygon basic correctness', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  assert.equal(pointInPolygon({ x: 5, y: 5 }, square), true);
  assert.equal(pointInPolygon({ x: 15, y: 5 }, square), false);
});

test('fitTransform + invert round-trips a city coordinate', () => {
  const map = makeMap();
  const t = fitTransform(map, 800, 600, 40);
  assert.ok(t.scale > 0);
  const world = { x: 100, y: 100 };
  const screen = applyTransform(world, t);
  // Screen point should be inside the canvas.
  assert.ok(screen.x >= 0 && screen.x <= 800);
  assert.ok(screen.y >= 0 && screen.y <= 600);
  const back = invertTransform(screen, t);
  assert.ok(Math.abs(back.x - world.x) < 1e-6);
  assert.ok(Math.abs(back.y - world.y) < 1e-6);
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
