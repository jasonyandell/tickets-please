import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// WCAG AA contrast gate for the design-token palette.
//
// The single source of truth is the `:root` block in src/ui/style.css. This
// test parses the declared `--token: #hex;` color custom properties and asserts
// that every (foreground text, background) pair the UI actually paints clears
// the WCAG 2.1 AA contrast threshold. Pure: it reads a file and does math, no
// DOM, no browser. If a future palette tweak dims a token below legibility, the
// `npm test` gate fails before it can ship.

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(HERE, '..', 'src', 'ui', 'style.css'), 'utf8');

// --- parse the :root custom-property color tokens -------------------------
function parseRootTokens(css) {
  const root = css.match(/:root\s*\{([\s\S]*?)\}/);
  assert.ok(root, 'style.css must declare a :root design-token block');
  const tokens = {};
  const re = /(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g;
  let m;
  while ((m = re.exec(root[1]))) tokens[m[1]] = m[2];
  return tokens;
}

// --- color math (WCAG 2.1 relative luminance + contrast ratio) ------------
function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function relLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(fg, bg) {
  const a = relLuminance(fg);
  const b = relLuminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const tokens = parseRootTokens(CSS);

// Every text-bearing token painted on a surface. fg/bg are token names so the
// pairs stay readable and the failure message points at the real culprit.
// `large: true` relaxes to the AA large-text threshold (3:1) for type that the
// UI renders at >= 18.66px or >= 14pt bold; everything else must clear 4.5:1.
const PAIRS = [
  ['--ink', '--surface-page'],
  ['--ink', '--surface-board'],
  ['--ink', '--surface-panel'],
  ['--ink', '--surface-raised'],
  ['--ink', '--surface-sunken'],
  ['--ink-muted', '--surface-panel'],
  ['--ink-muted', '--surface-raised'],
  ['--ink-subtle', '--surface-panel'],
  ['--ink-subtle', '--surface-raised'],
  ['--accent', '--surface-panel'],
  ['--accent', '--surface-raised'],
  ['--on-accent', '--accent'],
  ['--on-accent', '--danger'],
  ['--ok', '--surface-raised'],
  ['--danger', '--surface-raised'],
  ['--danger', '--surface-panel'],
  ['--warn-ink', '--warn-surface'],
  ['--warn-ink', '--badge-surface'],
  ['--on-overlay', '--surface-overlay'],
  ['--ink', '--label-plate'],
];

// Train-card chips (face-up cards, hand pips, the legend) and route fills are
// painted from --card-* tokens, with an ADAPTIVE ink chosen at runtime per chip
// (render.js cardInkCss) — dark on light cards, light on dark. This asserts that
// a legible ink EXISTS for every card token, so the runtime choice can always
// clear AA no matter how the palette is retuned.
const CARD_TOKENS = [
  '--card-red', '--card-orange', '--card-yellow', '--card-green', '--card-blue',
  '--card-purple', '--card-white', '--card-black', '--card-gray', '--card-wild',
];

test('every declared color token exists for the audited pairs', () => {
  for (const [fg, bg] of PAIRS) {
    assert.ok(tokens[fg], `missing token ${fg}`);
    assert.ok(tokens[bg], `missing token ${bg}`);
  }
});

for (const [fg, bg, opts] of PAIRS) {
  const min = opts && opts.large ? 3.0 : 4.5;
  test(`WCAG AA: ${fg} on ${bg} >= ${min}:1`, () => {
    const ratio = contrast(tokens[fg], tokens[bg]);
    assert.ok(
      ratio >= min,
      `${fg} (${tokens[fg]}) on ${bg} (${tokens[bg]}) = ${ratio.toFixed(2)}:1, need ${min}:1`,
    );
  });
}

for (const card of CARD_TOKENS) {
  test(`card chip ${card} has a legible ink (>= 4.5:1)`, () => {
    assert.ok(tokens[card], `missing token ${card}`);
    const best = Math.max(
      contrast(tokens['--ink'], tokens[card]),
      contrast(tokens['--on-accent'], tokens[card]),
    );
    assert.ok(
      best >= 4.5,
      `${card} (${tokens[card]}) best ink contrast = ${best.toFixed(2)}:1, need 4.5:1`,
    );
  });
}
