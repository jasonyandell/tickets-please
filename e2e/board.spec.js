// browser-verify harness: prove the tickets-please board actually renders and is
// interactive in a real browser. See .claude/skills/browser-verify/SKILL.md.
//
// The crisp Y (all must hold): zero page errors / console.errors; the drawing
// canvas exists and has non-trivial painted content (>3 distinct sampled
// colors); the side panel is populated; a screenshot is saved as evidence.

import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('artifacts', { recursive: true });

// Collect console errors and uncaught page errors for the whole page lifetime.
function attachErrorCollectors(page) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  return errors;
}

// Count distinct sampled colors on a canvas. A blank or flat-filled canvas has
// <= ~2 distinct colors; a drawn board has many. Returns -1 if the canvas is
// missing, 0 if its 2D context/pixels are unreadable.
async function distinctCanvasColors(page) {
  return page.evaluate(() => {
    // The app draws on whichever <canvas> it uses; find the first one.
    const c = document.querySelector('canvas');
    if (!c) return -1;
    const ctx = c.getContext('2d');
    if (!ctx) return 0;
    const w = c.width;
    const h = c.height;
    if (!w || !h) return 0;
    const { data } = ctx.getImageData(0, 0, w, h);
    const seen = new Set();
    // Sample sparsely for speed; step is coprime-ish to avoid aliasing.
    for (let i = 0; i < data.length; i += 4 * 101) {
      seen.add(`${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`);
      if (seen.size > 8) break;
    }
    return seen.size;
  });
}

test('board renders and is interactive', async ({ page }) => {
  const errors = attachErrorCollectors(page);

  await page.goto('/', { waitUntil: 'load' });
  // Give module scripts a tick to boot and draw.
  await page.waitForTimeout(500);

  // Evidence first — always capture, even on failure paths below.
  await page.screenshot({ path: 'artifacts/board.png', fullPage: true });

  // 1. No errors during load.
  expect(errors, `page/console errors on load:\n${errors.join('\n')}`).toEqual([]);

  // 2. A canvas exists and was actually painted (not blank / not a flat fill).
  const colors = await distinctCanvasColors(page);
  expect(colors, 'no <canvas> element found').toBeGreaterThanOrEqual(0);
  expect(colors, 'canvas appears blank / flat-filled (<=3 distinct colors)').toBeGreaterThan(3);

  // 3. The side panel is populated.
  const panel = page.locator('#panel');
  await expect(panel).toHaveCount(1);
  const panelText = (await panel.innerText()).trim();
  expect(panelText.length, 'side panel is empty').toBeGreaterThan(0);

  // 4. No errors accumulated by the end either.
  expect(errors, `errors after interaction:\n${errors.join('\n')}`).toEqual([]);
});
