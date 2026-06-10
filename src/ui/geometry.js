// geometry.js — PURE geometry for the tickets-please SVG board.
//
// Successor to the canvas-era layout.js. Same job — turn map data into
// car-slot rectangles and a fitted coordinate transform — minus everything the
// SVG substrate made obsolete (point-in-polygon hit-testing, inverse
// transforms, nearest-city search): clicks now land on real DOM nodes, so
// geometry only has to PLACE things, never to find them again.
//
// This module contains NO DOM access and NO side effects so it is fully
// unit-testable under node:test (tests/geometry.test.js).
//
// Map data shape (read defensively so we tolerate field-name variation):
//   map.cities: Array<{ id, name?, x, y }>            (or map.nodes)
//   map.routes: Array<{
//       id, from, to, length, color?,
//       parallel?: number | boolean,   // 2 => double route
//       double?: boolean,              // alt spelling
//       sibling?: routeId              // alt spelling for the paired route
//   }>                                                (or map.edges)
//
// Coordinates (city x,y) are an abstract layout space; the renderer bakes
// fitTransform(map, viewBoxW, viewBoxH) ONCE and lays everything out in fixed
// viewBox units — the SVG viewBox then scales to any screen for free.

// ---------------------------------------------------------------------------
// Defensive accessors
// ---------------------------------------------------------------------------

export function getCities(map) {
  if (!map) return [];
  if (Array.isArray(map.cities)) return map.cities;
  if (Array.isArray(map.nodes)) return map.nodes;
  if (map.cities && typeof map.cities === 'object') return Object.values(map.cities);
  if (map.nodes && typeof map.nodes === 'object') return Object.values(map.nodes);
  return [];
}

export function getRoutes(map) {
  if (!map) return [];
  if (Array.isArray(map.routes)) return map.routes;
  if (Array.isArray(map.edges)) return map.edges;
  if (map.routes && typeof map.routes === 'object') return Object.values(map.routes);
  if (map.edges && typeof map.edges === 'object') return Object.values(map.edges);
  return [];
}

export function cityId(city) {
  if (city == null) return undefined;
  return city.id != null ? city.id : city.name;
}

export function cityName(city) {
  if (city == null) return '';
  return city.name != null ? city.name : (city.id != null ? String(city.id) : '');
}

export function routeId(route) {
  if (route == null) return undefined;
  return route.id != null ? route.id : `${routeFrom(route)}-${routeTo(route)}`;
}

export function routeFrom(route) {
  if (route == null) return undefined;
  if (route.from != null) return route.from;
  if (route.a != null) return route.a;
  if (Array.isArray(route.cities)) return route.cities[0];
  if (Array.isArray(route.endpoints)) return route.endpoints[0];
  return undefined;
}

export function routeTo(route) {
  if (route == null) return undefined;
  if (route.to != null) return route.to;
  if (route.b != null) return route.b;
  if (Array.isArray(route.cities)) return route.cities[1];
  if (Array.isArray(route.endpoints)) return route.endpoints[1];
  return undefined;
}

export function routeLength(route) {
  if (route == null) return 1;
  const n = route.length != null ? route.length
    : route.len != null ? route.len
    : route.cost != null ? route.cost
    : 1;
  const v = Number(n);
  return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1;
}

export function routeColor(route) {
  if (route == null) return 'gray';
  return route.color != null ? route.color : (route.colour != null ? route.colour : 'gray');
}

// Build a quick lookup id -> city.
export function cityIndex(map) {
  const idx = new Map();
  for (const c of getCities(map)) idx.set(cityId(c), c);
  return idx;
}

// ---------------------------------------------------------------------------
// Double / parallel route detection
// ---------------------------------------------------------------------------

// A route is "doubled" when there is more than one route between the same
// pair of cities, OR it is flagged via parallel/double/sibling.
// Returns the offset INDEX (0 or 1) and total count for that city pair so the
// renderer can shift each parallel line sideways.
export function parallelInfo(route, map) {
  const flaggedDouble =
    route.double === true ||
    route.parallel === true ||
    (typeof route.parallel === 'number' && route.parallel >= 2) ||
    route.sibling != null;

  const fromK = String(routeFrom(route));
  const toK = String(routeTo(route));
  const key = pairKey(fromK, toK);

  // Gather all routes sharing this unordered city pair, in stable order.
  const group = [];
  for (const r of getRoutes(map)) {
    if (pairKey(String(routeFrom(r)), String(routeTo(r))) === key) group.push(r);
  }
  group.sort((a, b) => String(routeId(a)).localeCompare(String(routeId(b))));

  const count = Math.max(group.length, flaggedDouble ? 2 : 1);
  let index = group.findIndex((r) => String(routeId(r)) === String(routeId(route)));
  if (index < 0) index = 0;

  return { index, count, isDouble: count >= 2 || flaggedDouble };
}

function pairKey(a, b) {
  return a <= b ? `${a} ${b}` : `${b} ${a}`;
}

// ---------------------------------------------------------------------------
// Vector helpers
// ---------------------------------------------------------------------------

function sub(p, q) { return { x: p.x - q.x, y: p.y - q.y }; }
function add(p, q) { return { x: p.x + q.x, y: p.y + q.y }; }
function scale(p, s) { return { x: p.x * s, y: p.y * s }; }
function len(p) { return Math.hypot(p.x, p.y); }
function norm(p) { const l = len(p) || 1; return { x: p.x / l, y: p.y / l }; }
function perp(p) { return { x: -p.y, y: p.x }; }

// ---------------------------------------------------------------------------
// routeSegments — the core geometry
// ---------------------------------------------------------------------------

// Returns an array of "car slot" rectangles (one per unit of route length).
// Each slot is { cx, cy, angle, w, h } where (cx,cy) is the slot center, angle
// is the route direction in RADIANS, and w/h are the slot's length/thickness.
// The SVG renderer turns each into <rect> + rotate(angle cx cy) — no corner
// math needed (the old quad corners existed only for canvas hit-testing).
//
// opts:
//   boxGap   : gap (in layout units) between slots (default 4)
//   offset   : perpendicular offset for parallel/double routes (computed from
//              parallelInfo unless explicitly provided)
//   boxWidth : thickness of a car slot (default 14)
export function routeSegments(route, map, opts = {}) {
  const idx = opts.cityIndex || cityIndex(map);
  const a = idx.get(routeFrom(route));
  const b = idx.get(routeTo(route));
  if (!a || !b) return [];

  const A = { x: Number(a.x), y: Number(a.y) };
  const B = { x: Number(b.x), y: Number(b.y) };
  const n = routeLength(route);

  const dir = norm(sub(B, A));
  const segLen = len(sub(B, A));
  const p = perp(dir);

  const boxWidth = opts.boxWidth != null ? opts.boxWidth : 14;
  const boxGap = opts.boxGap != null ? opts.boxGap : 4;

  // Determine perpendicular offset for parallel routes.
  let offset = opts.offset;
  if (offset == null) {
    const info = parallelInfo(route, map);
    if (info.count >= 2) {
      const spacing = boxWidth + 6;
      // Center the group around the line: index 0 -> -spacing/2, 1 -> +spacing/2 (for 2)
      offset = (info.index - (info.count - 1) / 2) * spacing;
    } else {
      offset = 0;
    }
  }

  const off = scale(p, offset);

  // Lay n slots evenly between A and B, with small margins at the ends so
  // slots never overlap the city markers.
  const margin = Math.min(segLen * 0.12, 22);
  const usable = Math.max(segLen - margin * 2, 1);
  const slot = usable / n;          // length allotted to each slot (incl. gap)
  const boxLen = Math.max(slot - boxGap, 4);

  const start = add(add(A, scale(dir, margin)), off);

  const boxes = [];
  for (let i = 0; i < n; i++) {
    const centerDist = slot * i + slot / 2;
    const c = add(start, scale(dir, centerDist));
    boxes.push({
      cx: c.x,
      cy: c.y,
      angle: Math.atan2(dir.y, dir.x),
      w: boxLen,
      h: boxWidth,
    });
  }
  return boxes;
}

// ---------------------------------------------------------------------------
// Full layout — geometry for every route + city, computed once.
// ---------------------------------------------------------------------------

export function computeLayout(map, opts = {}) {
  const idx = cityIndex(map);
  const routes = [];
  for (const r of getRoutes(map)) {
    routes.push({
      id: routeId(r),
      route: r,
      boxes: routeSegments(r, map, { ...opts, cityIndex: idx }),
    });
  }
  const cities = getCities(map).map((c) => ({
    id: cityId(c),
    name: cityName(c),
    x: Number(c.x),
    y: Number(c.y),
  }));
  return { routes, cities, cityIndex: idx };
}

// ---------------------------------------------------------------------------
// Viewport transform — fit the map bounds into a fixed viewBox rect.
// ---------------------------------------------------------------------------

export function mapBounds(map) {
  const cities = getCities(map);
  if (cities.length === 0) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cities) {
    const x = Number(c.x), y = Number(c.y);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

// Returns { scale, tx, ty } such that worldX*scale + tx maps into [pad, w-pad].
export function fitTransform(map, width, height, pad = 40) {
  const b = mapBounds(map);
  const bw = Math.max(b.maxX - b.minX, 1);
  const bh = Math.max(b.maxY - b.minY, 1);
  const sx = (width - pad * 2) / bw;
  const sy = (height - pad * 2) / bh;
  const scale = Math.min(sx, sy);
  const tx = pad - b.minX * scale + (width - pad * 2 - bw * scale) / 2;
  const ty = pad - b.minY * scale + (height - pad * 2 - bh * scale) / 2;
  return { scale, tx, ty };
}

export function applyTransform(pt, t) {
  return { x: pt.x * t.scale + t.tx, y: pt.y * t.scale + t.ty };
}
