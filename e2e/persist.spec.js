// Contract-based e2e for persist + reload (src/ui/persist.js + main.js boot).
//
// The save is the recorded action tape, so a reload is a pure replay: after a
// move (and the AI's reply), window.__APP__.viewModel must come back BYTE-FOR-BYTE
// the same across page.reload(). No pixels are sampled.
//
//   1. start a fixed-seed game → claim a route → AI replies → reload → assert the
//      view-model is identical.
//   2. New Game (a different seed) overwrites the save → reload → assert the
//      restored view-model is the NEW game, proving the old save was cleared.

import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('artifacts', { recursive: true });

const appState = (page) => page.evaluate(() => window.__APP__);

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

async function waitForPlayableGame(page) {
  await expect.poll(async () => (await appState(page)).screen).toBe('game');
  await expect
    .poll(() => page.evaluate(() => document.querySelector('#map')?.dataset.painted))
    .toBe('true');
  await resolveStartingTickets(page);
  await expect.poll(async () => (await appState(page)).viewModel.phase).toBe('play');
  // The AI resolves its starting tickets on a timer; wait until control is the
  // human's so the position is a stable decision point.
  await expect.poll(async () => (await appState(page)).viewModel.currentPlayerIndex).toBe(0);
}

async function startGame(page, seed) {
  await page.locator('button[data-action="play"]').click();
  await page.locator('[data-testid="seed"]').fill(String(seed));
  await page.locator('button[data-action="start"]').click();
  await waitForPlayableGame(page);
}

// P1 claims a route (a turn-ending move), then we wait for the AI to reply and
// hand control back — landing on a stable post-move human decision point.
async function claimRouteAndSettle(page) {
  const vm = (await appState(page)).viewModel;
  const claimable = vm.routes.filter((r) => r.claimable);
  expect(claimable.length, 'human has a claimable route at start').toBeGreaterThan(0);
  const target = claimable.find((r) => r.length === 1) || claimable[0];
  const center = await page.evaluate((id) => window.__BOARD__.routeCenter(id), target.id);
  await page.locator('#map').click({ position: center });

  await expect.poll(async () => {
    const r = (await appState(page)).viewModel.routes.find((x) => String(x.id) === String(target.id));
    return r && r.claimed;
  }).toBe(true);
  // AI takes its reply turn and control returns to P1.
  await expect.poll(async () => (await appState(page)).viewModel.currentPlayerIndex).toBe(0);
  await expect.poll(async () => {
    const a = (await appState(page)).lastAction;
    return a && a.by === 1; // last recorded action was the AI's
  }).toBe(true);
}

test('a game survives a page reload (same game, same point)', async ({ page }) => {
  const errors = attachErrorCollectors(page);

  await page.goto('/', { waitUntil: 'load' });
  await startGame(page, '24680');
  await claimRouteAndSettle(page);

  const vmBefore = (await appState(page)).viewModel;
  expect(vmBefore.routes.some((r) => r.claimed), 'a move actually happened').toBe(true);

  // --- Reload: boot replays the saved tape back to this exact position --------
  await page.reload({ waitUntil: 'load' });
  await expect.poll(async () => (await appState(page)).screen).toBe('game');
  await expect
    .poll(() => page.evaluate(() => document.querySelector('#map')?.dataset.painted))
    .toBe('true');
  await expect.poll(async () => (await appState(page)).viewModel.currentPlayerIndex).toBe(0);

  const vmAfter = (await appState(page)).viewModel;
  expect(vmAfter, 'reload restores the exact pre-reload view-model').toEqual(vmBefore);

  await page.screenshot({ path: 'artifacts/persist.png', fullPage: true });
  expect(errors, `page/console errors:\n${errors.join('\n')}`).toEqual([]);
});

test('New Game overwrites the save (reload restores the new game)', async ({ page }) => {
  const errors = attachErrorCollectors(page);

  await page.goto('/', { waitUntil: 'load' });

  // Game A.
  await startGame(page, '11111');
  await claimRouteAndSettle(page);
  const vmA = (await appState(page)).viewModel;

  // New Game B (a different seed) — overwrites A's save.
  await page.locator('button[data-action="menu"]').click();
  await expect.poll(async () => (await appState(page)).screen).toBe('menu');
  await startGame(page, '99999');
  await claimRouteAndSettle(page);
  const vmB = (await appState(page)).viewModel;
  expect(vmB, 'a different seed yields a genuinely different game').not.toEqual(vmA);

  // Reload restores B, not A → the old save was cleared/overwritten.
  await page.reload({ waitUntil: 'load' });
  await waitForPlayableGame(page);
  const vmRestored = (await appState(page)).viewModel;
  expect(vmRestored, 'reload restores the NEW game (B)').toEqual(vmB);

  expect(errors, `page/console errors:\n${errors.join('\n')}`).toEqual([]);
});
