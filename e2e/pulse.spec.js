// Contract-based e2e for the traveling ticket pulse (Batch 10: src/ui/anim.js +
// viewModel.js + render.js). We run with INSTANT MODE on (window.__INSTANT_ANIM__):
// the traveling motion is DISABLED, so the test never couples to a frame clock or
// a sleep. What the gate asserts is the durable FACT the pulse is built on — the
// viewer's ORDERED, source→dest ticket paths published on the Observable State
// Contract (window.__APP__.viewModel.ticketPaths) — plus the static heat-map
// (ticketRouteIds) that remains visible in instant mode. The actual gliding bump
// is for human/screenshot review, not the gate.

import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('artifacts', { recursive: true });

const SEED = '12345';
const appState = (page) => page.evaluate(() => window.__APP__);
const canvasData = (page, key) =>
  page.evaluate((k) => document.querySelector('#map')?.dataset[k], key);

function attachErrorCollectors(page) {
  const errors = [];
  const ignore = (url) => /\/favicon\.ico(\?|$)/.test(url || '');
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 400 && !ignore(res.url())) errors.push(`http ${res.status()}: ${res.url()}`);
  });
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (/Failed to load resource/i.test(msg.text())) return;
    errors.push(`console.error: ${msg.text()}`);
  });
  return errors;
}

async function resolveStartingTickets(page) {
  const keep = page.locator('button[data-action="keep-tickets"]');
  if (await keep.count()) {
    await expect(keep).toBeEnabled();
    await keep.click();
  }
}

test('viewer ticket paths are ordered source→dest (static heat-map, no motion)', async ({ page }) => {
  const errors = attachErrorCollectors(page);

  // Force instant mode BEFORE any app code runs: the traveling pulse is frozen,
  // so the test reads facts, never a moving pixel.
  await page.addInitScript(() => { window.__INSTANT_ANIM__ = true; });

  await page.goto('/', { waitUntil: 'load' });
  await page.locator('button[data-action="play"]').click();
  await page.locator('[data-testid="seed"]').fill(SEED);
  await page.locator('button[data-action="start"]').click();
  await expect.poll(async () => (await appState(page)).screen).toBe('game');
  await expect.poll(() => canvasData(page, 'painted')).toBe('true');

  await resolveStartingTickets(page);
  await expect.poll(async () => (await appState(page)).viewModel.phase).toBe('play');

  const vm = (await appState(page)).viewModel;

  // The human viewer is set (single human vs AI → always the human).
  expect(vm.ticketViewerIndex, 'human viewer is set').toBe(0);

  // Ordered ticket paths are present for the viewer (the pulse's source).
  expect(Array.isArray(vm.ticketPaths), 'ticketPaths is an array').toBe(true);
  expect(vm.ticketPaths.length, 'viewer has at least one ordered ticket path').toBeGreaterThan(0);

  // Build a route lookup so we can verify orientation against real endpoints.
  const routeById = Object.fromEntries(vm.routes.map((r) => [String(r.id), r]));
  const touches = (route, city) => route && (route.from === city || route.to === city);

  for (const p of vm.ticketPaths) {
    expect(Array.isArray(p.routeIds), 'each path carries an ordered routeIds list').toBe(true);
    expect(p.routeIds.length, `path ${p.ticketId} is non-empty`).toBeGreaterThan(0);

    // Oriented source→dest: the FIRST route touches `from`, the LAST touches `to`.
    const first = routeById[String(p.routeIds[0])];
    const last = routeById[String(p.routeIds[p.routeIds.length - 1])];
    expect(touches(first, p.from), `first route of ${p.ticketId} touches its source`).toBe(true);
    expect(touches(last, p.to), `last route of ${p.ticketId} touches its dest`).toBe(true);

    // The ordered path is a connected walk: consecutive routes share a city.
    for (let i = 1; i < p.routeIds.length; i++) {
      const a = routeById[String(p.routeIds[i - 1])];
      const b = routeById[String(p.routeIds[i])];
      const shared = a.from === b.from || a.from === b.to || a.to === b.from || a.to === b.to;
      expect(shared, `routes ${i - 1}→${i} of ${p.ticketId} are connected`).toBe(true);
    }
  }

  // The static heat-map remains the durable read in instant mode: every routeId
  // on a ticket path is also in the heat-map's relevant-route set (same Dijkstra).
  const relevant = new Set(vm.ticketRouteIds.map(String));
  for (const p of vm.ticketPaths) {
    for (const rid of p.routeIds) {
      expect(relevant.has(String(rid)), `path route ${rid} is in the static heat-map`).toBe(true);
    }
  }

  await page.screenshot({ path: 'artifacts/pulse.png', fullPage: true });
  expect(errors, `page/console errors:\n${errors.join('\n')}`).toEqual([]);
});
