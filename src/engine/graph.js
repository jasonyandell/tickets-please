// Generic graph helpers shared by the map validator and scoring. Pure, no deps.

/**
 * Build an adjacency map { cityId: [{ to, route }] } from a map's routes.
 * Optionally filter to a subset of route ids (e.g. one player's network).
 * @param {object} map
 * @param {(route:object)=>boolean} [includeRoute]
 */
export function buildAdjacency(map, includeRoute = () => true) {
  const adj = new Map();
  for (const city of map.cities) adj.set(city.id, []);
  for (const route of map.routes) {
    if (!includeRoute(route)) continue;
    adj.get(route.a).push({ to: route.b, route });
    adj.get(route.b).push({ to: route.a, route });
  }
  return adj;
}

/**
 * Are two cities connected, traversing only included routes? BFS.
 */
export function connected(map, cityA, cityB, includeRoute = () => true) {
  if (cityA === cityB) return true;
  const adj = buildAdjacency(map, includeRoute);
  if (!adj.has(cityA) || !adj.has(cityB)) return false;
  const seen = new Set([cityA]);
  const queue = [cityA];
  while (queue.length) {
    const cur = queue.shift();
    for (const { to } of adj.get(cur)) {
      if (to === cityB) return true;
      if (!seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  return false;
}

/**
 * Is the whole map connected as one component (ignoring colors)?
 */
export function fullyConnected(map) {
  if (map.cities.length === 0) return true;
  const adj = buildAdjacency(map);
  const start = map.cities[0].id;
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    for (const { to } of adj.get(cur)) {
      if (!seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  return seen.size === map.cities.length;
}

/**
 * Longest trail (no repeated EDGE; cities may repeat) over the included routes,
 * measured as the sum of route lengths. Exhaustive DFS from every city.
 * Used for the longest-path bonus. Intended for a single player's subgraph,
 * which is small.
 * @returns {number}
 */
export function longestTrail(map, includeRoute = () => true) {
  const routes = map.routes.filter(includeRoute);
  if (routes.length === 0) return 0;

  // Adjacency as edge-index lists so we can mark edges used.
  const adj = new Map();
  routes.forEach((route, idx) => {
    if (!adj.has(route.a)) adj.set(route.a, []);
    if (!adj.has(route.b)) adj.set(route.b, []);
    adj.get(route.a).push({ to: route.b, idx, len: route.length });
    adj.get(route.b).push({ to: route.a, idx, len: route.length });
  });

  const used = new Array(routes.length).fill(false);
  let best = 0;

  const dfs = (city, acc) => {
    if (acc > best) best = acc;
    for (const edge of adj.get(city) || []) {
      if (used[edge.idx]) continue;
      used[edge.idx] = true;
      dfs(edge.to, acc + edge.len);
      used[edge.idx] = false;
    }
  };

  for (const city of adj.keys()) dfs(city, 0);
  return best;
}
