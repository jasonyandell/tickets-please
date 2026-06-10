import { test } from 'node:test';
import assert from 'node:assert/strict';

import { routeLevel } from '../src/ui/render.js';

// The pure flag→treatment policy behind .route[data-level] (V3 hierarchy).
// render.js is import-safe under node (no module-level DOM access), so the
// policy is unit-tested directly — no browser needed.

test('claimable shows only on a human turn', () => {
  const r = { claimable: true, affordable: true, claimed: false };
  assert.equal(routeLevel(r, true, true), 'claimable');
  assert.equal(routeLevel(r, false, false), 'none', 'AI turn never shows a go signal');
});

test('affordable shows only when the active human\'s own hand may show', () => {
  const r = { claimable: false, affordable: true, claimed: false };
  assert.equal(routeLevel(r, true, true), 'affordable');
  assert.equal(routeLevel(r, true, false), 'none', 'no hand leak when secrets are masked');
});

test('a claimed route never carries a level', () => {
  const r = { claimable: true, affordable: true, claimed: true };
  assert.equal(routeLevel(r, true, true), 'none');
});

test('claimable outranks affordable', () => {
  const r = { claimable: true, affordable: true, claimed: false };
  assert.equal(routeLevel(r, true, true), 'claimable');
});

test('null route is safe', () => {
  assert.equal(routeLevel(null, true, true), 'none');
});
