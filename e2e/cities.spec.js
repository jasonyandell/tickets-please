// Contract-based e2e for the city skyline markers (Jam Batch 6). Asserts FACTS,
// not pixels: the board paints, and the renderer's structured city-count hook
// (#map dataset.cities, set in render.js drawMap) reflects the cities actually
// laid out — at least every city that an unclaimed route connects. A screenshot
// is captured for human review of icon legibility.
//
// Hooks used (Observable State Contract): window.__APP__.{screen,viewModel},
// [data-screen], [data-action], [data-testid], canvas.dataset.{painted,cities}.

import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('artifacts', { recursive: true });

const SEED = '12345';

function attachErrorCollectors(page) {
  const errors = [];
  const ignore = (url) => /\/favicon\.ico(\?|$)/.test(url || '');
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 400 && !ignore(res.url())) errors.push(`http ${res.status()}: ${res.url()}`);
  });
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/Failed to load resource/i.test(text)) return;
    errors.push(`console.error: ${text}`);
  });
  return errors;
}

const appState = (page) => page.evaluate(() => window.__APP__);

async function resolveStartingTickets(page) {
  const keep = page.locator('button[data-action="keep-tickets"]');
  if (await keep.count()) {
    await expect(keep).toBeEnabled();
    await keep.click();
  }
}

test('cities render as icons and the city-count hook matches the map (no pixels)', async ({ page }) => {
  const errors = attachErrorCollectors(page);

  await page.goto('/', { waitUntil: 'load' });
  await page.locator('button[data-action="play"]').click();
  await page.locator('[data-testid="seed"]').fill(SEED);
  await page.locator('button[data-action="start"]').click();
  await expect.poll(async () => (await appState(page)).screen).toBe('game');

  // The board genuinely painted.
  await expect
    .poll(() => page.evaluate(() => document.querySelector('#map')?.dataset.painted))
    .toBe('true');

  await resolveStartingTickets(page);
  await expect.poll(async () => (await appState(page)).viewModel.phase).toBe('play');

  // Structured city-count hook is published and is a positive integer.
  const cityCount = await page.evaluate(
    () => Number(document.querySelector('#map')?.dataset.cities),
  );
  expect(Number.isInteger(cityCount), 'dataset.cities is an integer').toBe(true);
  expect(cityCount, 'at least one city was drawn').toBeGreaterThan(0);

  // Cross-check against real data: every distinct city referenced by a route
  // endpoint must have a marker, so the drawn city count is at least that many.
  const vm = (await appState(page)).viewModel;
  const endpoints = new Set();
  for (const r of vm.routes) {
    endpoints.add(String(r.from));
    endpoints.add(String(r.to));
  }
  expect(endpoints.size, 'routes reference some cities').toBeGreaterThan(0);
  expect(cityCount, 'drawn cities cover every routed city')
    .toBeGreaterThanOrEqual(endpoints.size);

  // Evidence (icon legibility) + zero errors throughout.
  await page.screenshot({ path: 'artifacts/cities.png', fullPage: true });
  expect(errors, `page/console errors:\n${errors.join('\n')}`).toEqual([]);
});
