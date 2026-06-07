// Contract-based e2e for the claimed-route "pop" animation (src/ui/anim.js +
// render.js). We run with INSTANT MODE on (window.__INSTANT_ANIM__), so the pop
// resolves to its final owned state with ZERO timing coupling — no sleeps, no
// pixel sampling. The proof is durable, observable FACTS on the canvas dataset:
//
//   data-pop-count   — monotonic count of pops triggered. It increments by 1 when
//                      a route is claimed → the animation system actually engaged.
//   data-animating   — the live "a pop is in flight" flag. In instant mode it
//                      flips on→off within the claim, so it reads 'false' after:
//                      the pop both FIRED (count went up) and SETTLED (flag false).
//
// Together those two assertions show the flag flipped and the route reached its
// final claimed state, deterministically. (Non-instant manual play shows the
// actual grow + flash; that visual is for human/screenshot review, not the gate.)

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

test('claiming a route pops then settles (instant mode = zero timing coupling)', async ({ page }) => {
  const errors = attachErrorCollectors(page);

  // Force instant mode BEFORE any app code runs: the pop completes immediately,
  // so the test never couples to a frame clock.
  await page.addInitScript(() => { window.__INSTANT_ANIM__ = true; });

  await page.goto('/', { waitUntil: 'load' });
  await page.locator('button[data-action="play"]').click();
  await page.locator('[data-testid="seed"]').fill(SEED);
  await page.locator('button[data-action="start"]').click();
  await expect.poll(async () => (await appState(page)).screen).toBe('game');
  await expect.poll(() => canvasData(page, 'painted')).toBe('true');

  await resolveStartingTickets(page);
  await expect.poll(async () => (await appState(page)).viewModel.phase).toBe('play');

  // Before any claim, nothing is animating and no pop has fired yet.
  expect(await canvasData(page, 'animating'), 'idle before any claim').toBe('false');
  const popsBefore = Number(await canvasData(page, 'popCount'));

  // Pick a claimable route and claim it via a real click on its on-screen box.
  const vm0 = (await appState(page)).viewModel;
  const claimable = vm0.routes.filter((r) => r.claimable);
  expect(claimable.length, 'human has a claimable route at start').toBeGreaterThan(0);
  const target = claimable.find((r) => r.length === 1) || claimable[0];
  const center = await page.evaluate((id) => window.__BOARD__.routeCenter(id), target.id);
  expect(center, 'board resolved an on-screen point for the route').toBeTruthy();
  await page.locator('#map').click({ position: center });

  // Final owned state reached (the pop settled into the claimed style).
  await expect.poll(async () => {
    const r = (await appState(page)).viewModel.routes.find((x) => String(x.id) === String(target.id));
    return r && r.claimed;
  }).toBe(true);
  const claimedRoute = (await appState(page)).viewModel.routes.find(
    (r) => String(r.id) === String(target.id),
  );
  expect(claimedRoute.claimed, 'target route is now claimed').toBe(true);
  expect(claimedRoute.ownerIndex, 'claimed by the human (P1)').toBe(0);

  // The pop animation engaged (count went up) AND settled (flag back to false) —
  // the data-animating flag flipped on→off within the claim, no sleeps.
  await expect.poll(() => canvasData(page, 'popCount')).toBe(String(popsBefore + 1));
  expect(await canvasData(page, 'animating'), 'pop settled in instant mode').toBe('false');

  await page.screenshot({ path: 'artifacts/anim.png', fullPage: true });
  expect(errors, `page/console errors:\n${errors.join('\n')}`).toEqual([]);
});
