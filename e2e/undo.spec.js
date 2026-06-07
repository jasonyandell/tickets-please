// Contract-based e2e for undo/redo (the recorder/player over the pure engine).
//
// Undo/redo are pure replays of an action prefix — never a mutate-to-undo — so
// the proof is structural: after a human move (and the AI's reply), Undo must
// return window.__APP__.viewModel to BYTE-FOR-BYTE what it was before the move,
// and Redo must restore the post-move view-model. No pixels are sampled.
//
// Flow: P1 (human) vs P2 (AI), fixed seed → claim a route → wait for the AI to
// reply (control returns to P1) → Undo → assert the view-model deep-equals the
// pre-claim snapshot → Redo → assert it deep-equals the post-AI snapshot.

import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('artifacts', { recursive: true });

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

async function resolveStartingTickets(page) {
  const keep = page.locator('button[data-action="keep-tickets"]');
  if (await keep.count()) {
    await expect(keep).toBeEnabled();
    await keep.click();
  }
}

test('undo returns to the pre-move state (skipping the AI); redo restores it', async ({ page }) => {
  const errors = attachErrorCollectors(page);

  await page.goto('/', { waitUntil: 'load' });
  await page.locator('button[data-action="play"]').click();
  await page.locator('[data-testid="seed"]').fill(SEED);
  // Default 2 players: P1 human, P2 AI.
  await page.locator('button[data-action="start"]').click();
  await expect.poll(async () => (await appState(page)).screen).toBe('game');
  await expect
    .poll(() => page.evaluate(() => document.querySelector('#map')?.dataset.painted))
    .toBe('true');

  await resolveStartingTickets(page);
  await expect.poll(async () => (await appState(page)).viewModel.phase).toBe('play');
  // Settle on P1's first decision point (the AI resolves its starting tickets on
  // a timer; wait until control is back with the human).
  await expect.poll(async () => (await appState(page)).viewModel.currentPlayerIndex).toBe(0);

  // At the very start of play there is nothing to redo yet.
  await expect(page.locator('button[data-action="redo"]')).toBeDisabled();

  // Snapshot the exact pre-move view-model (P1's decision point).
  const undoBtn = page.locator('button[data-action="undo"]');
  const redoBtn = page.locator('button[data-action="redo"]');
  const vmBefore = (await appState(page)).viewModel;

  // P1 claims a route — a single action that ends the turn, so ONE undo returns
  // to this exact point.
  const claimable = vmBefore.routes.filter((r) => r.claimable);
  expect(claimable.length, 'human has a claimable route at start').toBeGreaterThan(0);
  const target = claimable.find((r) => r.length === 1) || claimable[0];
  const center = await page.evaluate((id) => window.__BOARD__.routeCenter(id), target.id);
  await page.locator('#map').click({ position: center });

  // The claim registered, and Undo is now offered.
  await expect.poll(async () => {
    const r = (await appState(page)).viewModel.routes.find((x) => String(x.id) === String(target.id));
    return r && r.claimed;
  }).toBe(true);
  await expect(undoBtn).toBeEnabled();

  // Wait for the AI to take its reply turn and hand control back to P1.
  await expect.poll(async () => (await appState(page)).viewModel.currentPlayerIndex).toBe(0);
  // Give the AI driver a beat to fully settle, then snapshot the post-move state.
  await expect.poll(async () => {
    const a = (await appState(page)).lastAction;
    return a && a.by === 1; // last recorded action was the AI's
  }).toBe(true);
  const vmAfter = (await appState(page)).viewModel;
  expect(vmAfter, 'a move actually changed the view-model').not.toEqual(vmBefore);

  // --- Undo: pure replay back to the pre-move decision point ----------------
  await undoBtn.click();
  const vmUndone = (await appState(page)).viewModel;
  expect(vmUndone, 'undo restores the exact pre-move view-model').toEqual(vmBefore);
  // We landed on the human's turn (no AI auto-replay) and the route is unclaimed.
  expect(vmUndone.currentPlayerIndex).toBe(0);
  const undoneRoute = vmUndone.routes.find((r) => String(r.id) === String(target.id));
  expect(undoneRoute.claimed, 'the claimed route is rewound to unclaimed').toBe(false);
  await expect(page.locator('[data-testid="pass-device"]')).toHaveCount(0);

  // --- Redo: fast-forward through the recorded move + AI reply --------------
  await expect(redoBtn).toBeEnabled();
  await redoBtn.click();
  const vmRedone = (await appState(page)).viewModel;
  expect(vmRedone, 'redo restores the post-move view-model').toEqual(vmAfter);

  await page.screenshot({ path: 'artifacts/undo.png', fullPage: true });
  expect(errors, `page/console errors:\n${errors.join('\n')}`).toEqual([]);
});
