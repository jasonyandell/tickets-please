// Contract-based responsive e2e (Appearance Wave C). Asserts FACTS, not pixels:
// at two small-desktop viewports every screen is free of horizontal overflow
// (documentElement.scrollWidth <= clientWidth) and the key layout elements'
// boundingBoxes sit inside the viewport (no clipping off-screen). It also saves
// artifacts/setup.png + artifacts/gameover.png for human review.
//
// The game-over screen is rendered deterministically from a synthetic view-model
// by importing the (unbundled) screen module in the page — no need to play a full
// game, so this stays fast and stable.

import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('artifacts', { recursive: true });

const SEED = '12345';
const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1024, height: 700 },
];

// A 4-player game-over view-model (gameover.js reads scoreboard + winnerIndex),
// pre-sorted highest-first as the real view-model is.
const GAME_OVER_VM = {
  winnerIndex: 0,
  scoreboard: [
    { index: 0, name: 'Alice', routePoints: 78, ticketPoints: 21, completedTickets: 4, longestBonus: 10, longestPath: 18, total: 109 },
    { index: 2, name: 'Carol (AI)', routePoints: 64, ticketPoints: 12, completedTickets: 3, longestBonus: 0, longestPath: 12, total: 76 },
    { index: 1, name: 'Bob (AI)', routePoints: 55, ticketPoints: -4, completedTickets: 2, longestBonus: 0, longestPath: 11, total: 51 },
    { index: 3, name: 'Dave (AI)', routePoints: 41, ticketPoints: -9, completedTickets: 1, longestBonus: 0, longestPath: 9, total: 32 },
  ],
};

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

const appState = (page) => page.evaluate(() => window.__APP__);

// No horizontal overflow anywhere in the document.
async function assertNoHorizontalOverflow(page, where) {
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  expect(
    overflow.scrollW,
    `${where}: horizontal overflow (scrollWidth ${overflow.scrollW} > clientWidth ${overflow.clientW})`,
  ).toBeLessThanOrEqual(overflow.clientW);
}

// A located element's box sits fully inside the viewport (no off-screen clip).
async function assertInViewport(page, locator, where, vp) {
  await expect(locator, `${where}: element should be visible`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${where}: element has a layout box`).toBeTruthy();
  const eps = 1;
  expect(box.x, `${where}: left edge off-screen (${box.x})`).toBeGreaterThanOrEqual(-eps);
  expect(box.y, `${where}: top edge off-screen (${box.y})`).toBeGreaterThanOrEqual(-eps);
  expect(box.x + box.width, `${where}: right edge clipped (${box.x + box.width} > ${vp.width})`).toBeLessThanOrEqual(vp.width + eps);
  expect(box.y + box.height, `${where}: bottom edge clipped (${box.y + box.height} > ${vp.height})`).toBeLessThanOrEqual(vp.height + eps);
}

// Render the game-over screen from the synthetic view-model (no full play-through).
async function showGameOver(page, vm) {
  await page.evaluate(async (vmArg) => {
    const mod = await import('/src/ui/screens/gameover.js');
    const section = document.querySelector('[data-screen="gameover"]');
    mod.renderGameOver(section, vmArg, { onNewGame() {}, onMenu() {} });
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    section.classList.add('active');
  }, vm);
}

for (const vp of VIEWPORTS) {
  test(`responsive: no overflow + key elements in-viewport at ${vp.width}×${vp.height}`, async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.setViewportSize(vp);

    // --- Menu ---
    await page.goto('/', { waitUntil: 'load' });
    await expect.poll(async () => (await appState(page)).screen).toBe('menu');
    await assertNoHorizontalOverflow(page, 'menu');
    await assertInViewport(page, page.locator('.menu-card'), 'menu card', vp);

    // --- Setup ---
    await page.locator('button[data-action="play"]').click();
    await expect.poll(async () => (await appState(page)).screen).toBe('setup');
    await page.locator('[data-testid="seed"]').fill(SEED);
    await assertNoHorizontalOverflow(page, 'setup');
    await assertInViewport(page, page.locator('.setup-card'), 'setup form', vp);

    // --- Game ---
    await page.locator('button[data-action="start"]').click();
    await expect.poll(async () => (await appState(page)).screen).toBe('game');
    await expect
      .poll(() => page.evaluate(() => document.querySelector('#map')?.dataset.painted))
      .toBe('true');
    await assertNoHorizontalOverflow(page, 'game');
    await assertInViewport(page, page.locator('#panel'), 'game panel', vp);
    await assertInViewport(page, page.locator('#board'), 'game board', vp);

    // --- Game over (synthetic view-model) ---
    await showGameOver(page, GAME_OVER_VM);
    await expect(page.locator('[data-screen="gameover"]')).toBeVisible();
    await assertNoHorizontalOverflow(page, 'gameover');
    await assertInViewport(page, page.locator('[data-testid="scoreboard"]'), 'gameover table', vp);

    expect(errors, `page/console errors:\n${errors.join('\n')}`).toEqual([]);
  });
}

// Capture polished, non-clipped artifacts for human review (default desktop size).
test('artifacts: setup + gameover screenshots for review', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/', { waitUntil: 'load' });

  await page.locator('button[data-action="play"]').click();
  await expect.poll(async () => (await appState(page)).screen).toBe('setup');
  await page.locator('[data-testid="player-count"]').selectOption('4');
  await page.screenshot({ path: 'artifacts/setup.png', fullPage: true });

  await showGameOver(page, GAME_OVER_VM);
  await expect(page.locator('[data-testid="scoreboard"]')).toBeVisible();
  // Let the CSS-only celebration (headline pop-in) settle so the static artifact
  // shows the fully-opaque title, not a mid-fade frame.
  await expect
    .poll(() => page.evaluate(() =>
      getComputedStyle(document.querySelector('.over-title')).opacity))
    .toBe('1');
  await page.screenshot({ path: 'artifacts/gameover.png', fullPage: true });
});
