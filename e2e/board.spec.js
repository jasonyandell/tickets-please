// Contract-based e2e for tickets-please. Asserts FACTS, not pixels, via the
// Observable State Contract:
//   window.__APP__ = { screen, viewModel, lastAction }
//   stable DOM hooks: [data-screen], [data-testid], button[data-action]
//   the board smoke flag: #map dataset.painted === "true"
// SVG substrate upgrade: routes/cities are REAL elements (g[data-route-id] /
// g[data-city-id]), so this suite also asserts board STRUCTURE directly.
//
// Flow: boot → menu → Play → setup (fixed seed) → Start → game; then drive a
// scripted human turn (draw 2 cards) and assert structured state advanced.

import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('artifacts', { recursive: true });

const SEED = '12345';

// Collect APP errors and uncaught page errors. Browser auto-requests that aren't
// app resources (e.g. /favicon.ico) are deliberately ignored — a 404 there is
// browser noise, not an app failure.
function attachErrorCollectors(page) {
  const errors = [];
  const ignore = (url) => /\/favicon\.ico(\?|$)/.test(url || '');
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 400 && !ignore(res.url())) {
      errors.push(`http ${res.status()}: ${res.url()}`);
    }
  });
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/Failed to load resource/i.test(text)) return; // covered by response handler
    errors.push(`console.error: ${text}`);
  });
  return errors;
}

const appState = (page) => page.evaluate(() => window.__APP__);

// Full rules open with each player choosing which of 3 dealt starting tickets to
// keep (>= 2). For the active human this surfaces the ticket-keep checklist; keep
// the default (all checked) and confirm. No-op if no choice is showing.
async function resolveStartingTickets(page) {
  const keep = page.locator('button[data-action="keep-tickets"]');
  if (await keep.count()) {
    await expect(keep).toBeEnabled();
    await keep.click();
  }
}

test('menu → setup → start → play a turn (contract, no pixels)', async ({ page }) => {
  const errors = attachErrorCollectors(page);

  await page.goto('/', { waitUntil: 'load' });

  // 1. Boots to the landing menu.
  await expect(page.locator('[data-screen="menu"]')).toBeVisible();
  await expect.poll(async () => (await appState(page)).screen).toBe('menu');

  // 1a. The brand wordmark is present on the menu (appearance contract hook).
  await expect(page.locator('[data-testid="wordmark"]')).toBeVisible();

  // 1b. How-to-play toggles open and teaches the rules (starting tickets, etc.).
  const how = page.locator('.menu-how');
  await expect(how).toBeHidden();
  await page.locator('button[data-action="how-to-play"]').click();
  await expect(how).toBeVisible();
  await expect(how).toContainText('keep at least 2');
  await page.locator('button[data-action="how-to-play"]').click();
  await expect(how).toBeHidden();

  // 2. Play → setup.
  await page.locator('button[data-action="play"]').click();
  await expect(page.locator('[data-screen="setup"]')).toBeVisible();
  await expect.poll(async () => (await appState(page)).screen).toBe('setup');

  // 3. Fixed seed for determinism; leave the default 2 players (P1 human, P2 AI).
  await page.locator('[data-testid="seed"]').fill(SEED);

  // 4. Start → game screen.
  await page.locator('button[data-action="start"]').click();
  await expect(page.locator('[data-screen="game"]')).toBeVisible();
  await expect.poll(async () => (await appState(page)).screen).toBe('game');

  // 5. The board genuinely painted (the ONLY canvas check anywhere).
  await expect
    .poll(() => page.evaluate(() => document.querySelector('#map')?.dataset.painted))
    .toBe('true');

  // 5a. Starting-ticket selection: P1 (human) keeps the default set; the AI
  //     resolves its own choice on a timer, after which real play begins.
  await resolveStartingTickets(page);
  await expect.poll(async () => (await appState(page)).viewModel.phase).toBe('play');

  // 6. The view-model exposes a current player, a prompt, and routes.
  const before = await appState(page);
  expect(before.viewModel, 'viewModel should be published').toBeTruthy();
  expect(before.viewModel.routes.length, 'routes derived').toBeGreaterThan(0);
  await expect(page.locator('[data-testid="prompt"]')).not.toHaveText('');

  // 6a. STRUCTURAL: every route and city is a real SVG element — the board's
  //     DOM mirrors the view-model one-to-one (the substrate upgrade's point).
  const dom = await page.evaluate(() => ({
    routes: document.querySelectorAll('#map [data-route-id]').length,
    cities: document.querySelectorAll('#map .city[data-city-id]').length,
    cars: document.querySelectorAll('#map .car').length,
    citiesHook: Number(document.querySelector('#map')?.dataset.cities),
  }));
  expect(dom.routes, 'one element per route').toBe(before.viewModel.routes.length);
  expect(dom.cities, 'city markers are real elements').toBe(dom.citiesHook);
  expect(dom.cars, 'every route lays out at least one car slot').toBeGreaterThanOrEqual(dom.routes);

  // P1 is the human and it's their turn → own hand is revealed (counts present).
  const startHand = before.viewModel.players[0].handCount;
  expect(startHand, 'starting hand count').toBeGreaterThan(0);

  // 7. Drive a scripted human turn: draw 2 train cards from the deck.
  const drawDeck = page.locator('button[data-action="draw-deck"]');
  await expect(drawDeck).toBeEnabled();
  await drawDeck.click();
  // After one draw the prompt asks for the 2nd card; the button is still live.
  await expect(drawDeck).toBeEnabled();
  await drawDeck.click();

  // 8. Structured state advanced: the human now holds 2 more cards, and the
  //    last applied action is recorded on the contract. The click handler runs
  //    synchronously, so this snapshot is the human's turn (the AI's reply is on
  //    a later timer and cannot have overwritten lastAction yet).
  const after = await appState(page);
  expect(after.viewModel.players[0].handCount, 'human drew 2 cards').toBe(startHand + 2);
  expect(after.lastAction, 'lastAction recorded').toBeTruthy();
  expect(after.lastAction.type).toBe('DRAW_DECK');
  expect(after.lastAction.by, 'recorded actor is the human (P1)').toBe(0);

  // Evidence + zero errors throughout.
  await page.screenshot({ path: 'artifacts/board.png', fullPage: true });
  expect(errors, `page/console errors:\n${errors.join('\n')}`).toEqual([]);
});

// Board route clarity: hovering a route surfaces its claimability via the board
// inspection surface (window.__BOARD__.tooltip), and clicking a claimable route
// claims it. Structured state only — no pixels, no canvas-color sampling.
test('hover a route shows its claimability; claim a claimable route', async ({ page }) => {
  const errors = attachErrorCollectors(page);

  await page.goto('/', { waitUntil: 'load' });
  await page.locator('button[data-action="play"]').click();
  await page.locator('[data-testid="seed"]').fill(SEED);
  await page.locator('button[data-action="start"]').click();
  await expect.poll(async () => (await appState(page)).screen).toBe('game');
  await expect
    .poll(() => page.evaluate(() => document.querySelector('#map')?.dataset.painted))
    .toBe('true');

  await resolveStartingTickets(page);
  await expect.poll(async () => (await appState(page)).viewModel.phase).toBe('play');

  // Pick a claimable route from the contract — prefer a length-1 route so the
  // located point sits squarely on a single car box (robust hover + click).
  const vm0 = (await appState(page)).viewModel;
  const claimable = vm0.routes.filter((r) => r.claimable);
  expect(claimable.length, 'human has at least one claimable route at start').toBeGreaterThan(0);
  const target = claimable.find((r) => r.length === 1) || claimable[0];

  // Ticket-relevant routes are exposed for the active human and mirrored onto
  // each route as a boolean. The human holds starting tickets, so there is a
  // path to build toward → the set is non-empty and self-consistent.
  expect(Array.isArray(vm0.ticketRouteIds), 'ticketRouteIds exposed on the view-model').toBe(true);
  expect(vm0.ticketRouteIds.length, 'human has at least one ticket-relevant route').toBeGreaterThan(0);
  const flagged = new Set(vm0.routes.filter((r) => r.ticketRelevant).map((r) => String(r.id)));
  expect(flagged, 'ticketRouteIds matches per-route ticketRelevant flags')
    .toEqual(new Set(vm0.ticketRouteIds.map(String)));

  // Weighted heat-map: each route carries a ticketWeight (how many of my
  // incomplete tickets' shortest paths use it). The published weight map, the
  // per-route weights, and the relevant set must all agree, every weight >= 1,
  // and at least one route is highlighted.
  const weights = vm0.ticketRouteWeights;
  expect(weights && typeof weights === 'object', 'ticketRouteWeights exposed').toBe(true);
  expect(new Set(Object.keys(weights).map(String)), 'weight keys match the relevant set')
    .toEqual(new Set(vm0.ticketRouteIds.map(String)));
  for (const r of vm0.routes) {
    const expected = weights[String(r.id)] || 0;
    expect(r.ticketWeight || 0, `route ${r.id} weight mirrors the map`).toBe(expected);
  }
  expect(Object.values(weights).every((w) => w >= 1), 'every published weight is >= 1').toBe(true);
  expect(Math.max(0, ...Object.values(weights)), 'at least one weighted route').toBeGreaterThan(0);

  // The board exposes a hit-testable on-screen point for the route.
  const center = await page.evaluate((id) => window.__BOARD__.routeCenter(id), target.id);
  expect(center, 'board.routeCenter resolved a point').toBeTruthy();

  // Hover → the board's tooltip reflects THIS route and reports it claimable.
  await page.locator('#map').hover({ position: center });
  await expect.poll(async () => {
    const t = await page.evaluate(() => window.__BOARD__.tooltip);
    return t && String(t.routeId) === String(target.id) ? t.claimable : null;
  }).toBe(true);
  await expect(page.locator('[data-testid="route-tip"]')).toBeVisible();

  // Click the claimable route → it gets claimed and the turn advances.
  await page.locator('#map').click({ position: center });

  const after = await appState(page);
  const claimedRoute = after.viewModel.routes.find((r) => String(r.id) === String(target.id));
  expect(claimedRoute.claimed, 'target route is now claimed').toBe(true);
  // Owner styling hook: a claimed route carries its owner index + name so the
  // renderer can paint the owner-color fill + initialed token (and the board
  // tooltip can name the owner) — never confusable with a required card color.
  expect(claimedRoute.ownerIndex, 'claimed route names its owner index (P1)').toBe(0);
  expect(claimedRoute.ownerName, 'claimed route names its owner').toBeTruthy();
  expect(after.lastAction, 'lastAction recorded').toBeTruthy();
  expect(after.lastAction.type).toBe('CLAIM_ROUTE');
  expect(after.lastAction.by, 'recorded actor is the human (P1)').toBe(0);

  // STRUCTURAL: the route's own element mirrors the claim — data-claimed and
  // data-owner flip on the live DOM node (no pixels, no __APP__ indirection).
  const domClaim = await page.evaluate((id) => {
    const g = document.querySelector(`#map [data-route-id="${id}"]`);
    return g ? { claimed: g.dataset.claimed, owner: g.dataset.owner } : null;
  }, String(target.id));
  expect(domClaim, 'claimed route exists as a DOM element').toBeTruthy();
  expect(domClaim.claimed, 'data-claimed flipped to true').toBe('true');
  expect(domClaim.owner, 'data-owner names the claiming seat (P1)').toBe('0');

  // Claiming the first route makes P1 the live longest-route leader (length > 0).
  expect(after.viewModel.longestLeaderIndices, 'P1 now holds the longest route').toContain(0);
  expect(after.viewModel.longestPathMax).toBeGreaterThan(0);

  await page.screenshot({ path: 'artifacts/board-claim.png', fullPage: true });
  expect(errors, `page/console errors:\n${errors.join('\n')}`).toEqual([]);
});

// Ticket heat-map continuity: in a 1-human-vs-AI game the human's own "build
// toward" map must stay lit even while the AI is moving (the bug Batch 9 fixes —
// it used to blank out on every AI turn, which is most of the turns you watch).
// Contract-only: assert ticketViewerIndex + a non-empty ticketRouteWeights map
// while currentPlayerIndex points at the AI. Plus a screenshot of the lit path.
test('ticket heat-map stays lit during the AI turn (1-human game)', async ({ page }) => {
  const errors = attachErrorCollectors(page);

  await page.goto('/', { waitUntil: 'load' });
  await page.locator('button[data-action="play"]').click();
  await page.locator('[data-testid="seed"]').fill(SEED);
  await page.locator('button[data-action="start"]').click();
  await expect.poll(async () => (await appState(page)).screen).toBe('game');
  await expect
    .poll(() => page.evaluate(() => document.querySelector('#map')?.dataset.painted))
    .toBe('true');

  await resolveStartingTickets(page);
  await expect.poll(async () => (await appState(page)).viewModel.phase).toBe('play');

  // The human's own map is lit on their turn: viewer is P1 and the set is non-empty.
  const human = (await appState(page)).viewModel;
  expect(human.currentPlayerIndex, 'human is active').toBe(0);
  expect(human.ticketViewerIndex, 'viewer is the human (P1)').toBe(0);
  expect(Object.keys(human.ticketRouteWeights).length, 'lit path on the human turn')
    .toBeGreaterThan(0);
  // Evidence of the lit ticket path on a human view.
  await page.screenshot({ path: 'artifacts/board-ticket-path.png', fullPage: true });

  // End the human's turn (draw 2 cards) → control passes to the AI (P2). The
  // view-model is republished with currentPlayerIndex === 1 before the AI acts.
  const drawDeck = page.locator('button[data-action="draw-deck"]');
  await expect(drawDeck).toBeEnabled();
  await drawDeck.click();
  await expect(drawDeck).toBeEnabled();
  await drawDeck.click();

  // Capture a snapshot while it is the AI's turn and assert the human's map is
  // STILL lit (the fix). The viewer remains the sole human, never the AI.
  let aiSnap = null;
  await expect
    .poll(async () => {
      const vm = (await appState(page)).viewModel;
      if (vm && vm.currentPlayerIndex === 1) { aiSnap = vm; return true; }
      return false;
    })
    .toBe(true);
  expect(aiSnap.ticketViewerIndex, 'viewer stays the human during the AI turn').toBe(0);
  expect(Object.keys(aiSnap.ticketRouteWeights).length, 'heat-map still lit on the AI turn')
    .toBeGreaterThan(0);

  expect(errors, `page/console errors:\n${errors.join('\n')}`).toEqual([]);
});
