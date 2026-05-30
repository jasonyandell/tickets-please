// Validates src/engine/map.js against the invariants in CONTRACT.md §2.
// Usage: node tools/validate-map.js   (exit 0 = valid, 1 = problems found)

import { MAP, TICKETS } from '../src/engine/map.js';
import { TRAIN_COLORS, GRAY, MAX_ROUTE_LENGTH } from '../src/engine/constants.js';
import { fullyConnected, connected } from '../src/engine/graph.js';

const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

const validColors = new Set([...TRAIN_COLORS, GRAY]);
const cityIds = new Set();

// Cities
if (!MAP || !Array.isArray(MAP.cities) || MAP.cities.length === 0) {
  err('MAP.cities is missing or empty');
} else {
  for (const c of MAP.cities) {
    if (c.id == null) err(`city missing id: ${JSON.stringify(c)}`);
    else if (cityIds.has(c.id)) err(`duplicate city id: ${c.id}`);
    else cityIds.add(c.id);
    if (typeof c.name !== 'string' || !c.name) err(`city ${c.id} missing name`);
    if (typeof c.x !== 'number' || typeof c.y !== 'number')
      err(`city ${c.id} missing numeric x/y`);
    else if (c.x < 0 || c.x > MAP.width || c.y < 0 || c.y > MAP.height)
      err(`city ${c.id} out of bounds (${c.x},${c.y}) vs ${MAP.width}x${MAP.height}`);
  }
}

// Routes
const routeIds = new Set();
const pairCount = new Map(); // "a|b" sorted -> count
if (!Array.isArray(MAP.routes) || MAP.routes.length === 0) {
  err('MAP.routes is missing or empty');
} else {
  for (const r of MAP.routes) {
    if (r.id == null) err(`route missing id: ${JSON.stringify(r)}`);
    else if (routeIds.has(r.id)) err(`duplicate route id: ${r.id}`);
    else routeIds.add(r.id);
    if (!cityIds.has(r.a)) err(`route ${r.id} references unknown city a=${r.a}`);
    if (!cityIds.has(r.b)) err(`route ${r.id} references unknown city b=${r.b}`);
    if (r.a === r.b) err(`route ${r.id} is a self-loop`);
    if (!(Number.isInteger(r.length) && r.length >= 1 && r.length <= MAX_ROUTE_LENGTH))
      err(`route ${r.id} has bad length ${r.length}`);
    if (!validColors.has(r.color)) err(`route ${r.id} has bad color ${r.color}`);
    const key = [r.a, r.b].sort().join('|');
    pairCount.set(key, (pairCount.get(key) || 0) + 1);
  }
  // Parallel-edge rules
  const byKey = new Map();
  for (const r of MAP.routes) {
    const key = [r.a, r.b].sort().join('|');
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }
  for (const [key, group] of byKey) {
    if (group.length > 2) err(`more than 2 parallel routes between ${key}`);
    if (group.length === 2 && !group.every((r) => r.parallel === true))
      err(`parallel routes between ${key} must both set parallel:true`);
  }
}

// Connectivity
if (errors.length === 0 && !fullyConnected(MAP)) err('map graph is not fully connected');

// Tickets
const ticketIds = new Set();
if (!Array.isArray(TICKETS) || TICKETS.length === 0) {
  err('TICKETS is missing or empty');
} else {
  for (const t of TICKETS) {
    if (t.id == null) err(`ticket missing id: ${JSON.stringify(t)}`);
    else if (ticketIds.has(t.id)) err(`duplicate ticket id: ${t.id}`);
    else ticketIds.add(t.id);
    if (!cityIds.has(t.from)) err(`ticket ${t.id} unknown from=${t.from}`);
    if (!cityIds.has(t.to)) err(`ticket ${t.id} unknown to=${t.to}`);
    if (t.from === t.to) err(`ticket ${t.id} has from === to`);
    if (!(Number.isInteger(t.points) && t.points > 0))
      err(`ticket ${t.id} has bad points ${t.points}`);
    if (errors.length === 0 && !connected(MAP, t.from, t.to))
      err(`ticket ${t.id} endpoints not connected in graph`);
  }
}

// Soft balance checks (warnings only)
if (errors.length === 0) {
  const colorCounts = {};
  for (const r of MAP.routes) colorCounts[r.color] = (colorCounts[r.color] || 0) + 1;
  for (const color of TRAIN_COLORS) {
    if (!colorCounts[color]) warn(`no routes use color ${color}`);
  }
}

// Report
for (const w of warns) console.log(`  warn: ${w}`);
if (errors.length) {
  console.error(`\n✗ map invalid — ${errors.length} error(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `\n✓ map valid: ${MAP.cities.length} cities, ${MAP.routes.length} routes, ${TICKETS.length} tickets`
);
