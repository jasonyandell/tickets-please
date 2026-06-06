// Contract-based e2e for hotseat privacy + the pass-the-device interstitial.
// Companion to board.spec.js (which covers the human-vs-AI play-through). This
// one configures TWO humans and asserts FACTS via the Observable State Contract:
//   - opponents are masked to counts only (viewModel.players[i].handByColor null)
//   - the pass-device overlay appears ONLY between two consecutive human turns
//   - acknowledging it advances to the next human, re-masking the previous one
// No pixels are sampled (the board's single `painted` smoke flag aside).

import { test, expect } from '@playwright/test';

const SEED = '12345';
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

test('hotseat: privacy masking + pass-the-device between two human turns', async ({ page }) => {
  const errors = attachErrorCollectors(page);

  await page.goto('/', { waitUntil: 'load' });
  await page.locator('button[data-action="play"]').click();
  await page.locator('[data-testid="seed"]').fill(SEED);

  // Default is P1 Human, P2 AI — flip P2 to Human so the handoff is human→human.
  await page.locator('.setup-slot .slot-kind').nth(1).selectOption('Human');

  await page.locator('button[data-action="start"]').click();
  await expect.poll(async () => (await appState(page)).screen).toBe('game');
  await expect
    .poll(() => page.evaluate(() => document.querySelector('#map')?.dataset.painted))
    .toBe('true');

  // Privacy during play: the active human (P1) sees their own colors + tickets;
  // the opponent (P2) is masked to counts only.
  const vm0 = (await appState(page)).viewModel;
  expect(vm0.currentPlayerIndex).toBe(0);
  expect(vm0.players[0].handByColor, 'active human sees own colors').toBeTruthy();
  expect(vm0.players[0].handCount, 'active human has cards').toBeGreaterThan(0);
  expect(vm0.players[1].handByColor, 'opponent colors hidden').toBeNull();
  expect(vm0.players[1].tickets, 'opponent tickets hidden').toBeNull();
  expect(typeof vm0.players[1].handCount, 'opponent count still exposed').toBe('number');

  // No interstitial at the start of a turn.
  await expect(page.locator('[data-testid="pass-device"]')).toHaveCount(0);

  // P1 plays a full turn (draw two train cards) → turn hands to P2 (human).
  const drawDeck = page.locator('button[data-action="draw-deck"]');
  await expect(drawDeck).toBeEnabled();
  await drawDeck.click();
  await expect(drawDeck).toBeEnabled();
  await drawDeck.click();

  // The pass-the-device interstitial appears (consecutive HUMAN turns) and names
  // the incoming player.
  await expect(page.locator('[data-testid="pass-device"]')).toBeVisible();
  await expect(page.locator('[data-testid="pass-device-target"]')).toContainText('P2');

  // Acknowledge → overlay gone; P2 is now the active human; P1 is re-masked.
  await page.locator('button[data-action="ready"]').click();
  await expect(page.locator('[data-testid="pass-device"]')).toHaveCount(0);
  const vm1 = (await appState(page)).viewModel;
  expect(vm1.currentPlayerIndex, 'turn advanced to P2').toBe(1);
  expect(vm1.players[1].handByColor, 'new active human sees own colors').toBeTruthy();
  expect(vm1.players[0].handByColor, 'previous player now masked').toBeNull();

  expect(errors, `page/console errors:\n${errors.join('\n')}`).toEqual([]);
});
