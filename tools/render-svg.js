// Render the board to a standalone SVG from the real map data — no browser, no
// dependencies. Doubles as a README/preview asset and a sanity check that the
// map geometry is sensible. Usage: node tools/render-svg.js > assets/board.svg
//
// Colors mirror the UI palette so the SVG looks like the in-game board.

import { MAP } from '../src/engine/map.js';
import { TRAIN_COLORS, GRAY, WILD } from '../src/engine/constants.js';

const COLOR_HEX = {
  red: '#e6194b',
  orange: '#f58231',
  yellow: '#ffe119',
  green: '#3cb44b',
  blue: '#4363d8',
  purple: '#911eb4',
  white: '#f5f5f5',
  black: '#2b2b2b',
  [GRAY]: '#9a9a9a',
  [WILD]: '#bbbbbb',
};

const W = MAP.width;
const H = MAP.height;
const cityById = new Map(MAP.cities.map((c) => [c.id, c]));

// Group routes by unordered city pair so we can offset double routes.
const groups = new Map();
for (const r of MAP.routes) {
  const key = [r.a, r.b].sort().join('|');
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const parts = [];
parts.push(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui,Segoe UI,Helvetica,Arial,sans-serif">`
);
parts.push(`<rect width="${W}" height="${H}" fill="#0e1726"/>`);

// Routes (drawn first, under the cities).
for (const [, group] of groups) {
  group.forEach((r, gi) => {
    const a = cityById.get(r.a);
    const b = cityById.get(r.b);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // Unit normal for offsetting parallel routes.
    const nx = -dy / len;
    const ny = dx / len;
    const offset = group.length > 1 ? (gi === 0 ? -6 : 6) : 0;
    const ax = a.x + nx * offset;
    const ay = a.y + ny * offset;
    const bx = b.x + nx * offset;
    const by = b.y + ny * offset;
    const stroke = COLOR_HEX[r.color] || '#888';

    // Base line.
    parts.push(
      `<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${stroke}" stroke-width="6" stroke-linecap="round" opacity="0.85"/>`
    );
    // Length "car" pips along the route.
    for (let i = 1; i <= r.length; i++) {
      const t = i / (r.length + 1);
      const px = ax + (bx - ax) * t;
      const py = ay + (by - ay) * t;
      parts.push(
        `<rect x="${(px - 3.5).toFixed(1)}" y="${(py - 3.5).toFixed(1)}" width="7" height="7" rx="1.5" fill="${stroke}" stroke="#0e1726" stroke-width="1"/>`
      );
    }
  });
}

// Cities (dots + labels).
for (const c of MAP.cities) {
  parts.push(`<circle cx="${c.x}" cy="${c.y}" r="5" fill="#ffffff" stroke="#0e1726" stroke-width="1.5"/>`);
  parts.push(
    `<text x="${c.x + 7}" y="${c.y + 3.5}" font-size="11" fill="#dfe7f3" stroke="#0e1726" stroke-width="2.5" paint-order="stroke">${esc(c.name)}</text>`
  );
}

// Title.
parts.push(
  `<text x="${W / 2}" y="34" font-size="26" font-weight="700" text-anchor="middle" fill="#ffffff">tickets-please — ${esc(MAP.name)}</text>`
);
parts.push(
  `<text x="${W / 2}" y="54" font-size="13" text-anchor="middle" fill="#9fb3cc">${MAP.cities.length} cities · ${MAP.routes.length} routes · public domain</text>`
);

parts.push('</svg>');
process.stdout.write(parts.join('\n') + '\n');
