// screens/setup.js — choose player count (2–5), per-slot name + Human/AI + color,
// an optional advanced seed, then Start. Pure DOM; hands a plain config object
// back to the controller, which boots the engine and routes to the game screen.

import { playerColor } from '../render.js';

const MIN = 2;
const MAX = 5;

/**
 * @param {HTMLElement} container - the [data-screen="setup"] section.
 * @param {{
 *   onStart: (cfg:{ numPlayers:number, configs:Array<{name:string,isAI:boolean}>, seed:number|null }) => void,
 *   onBack: () => void,
 * }} hooks
 */
export function renderSetup(container, { onStart, onBack }) {
  container.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'setup-card';

  const h = document.createElement('h1');
  h.className = 'setup-title';
  h.textContent = 'Game setup';
  card.appendChild(h);

  // --- Player count -------------------------------------------------------
  const countRow = document.createElement('label');
  countRow.className = 'setup-row';
  countRow.appendChild(text('Players'));
  const count = document.createElement('select');
  count.dataset.testid = 'player-count';
  for (let n = MIN; n <= MAX; n++) {
    const o = document.createElement('option');
    o.value = String(n);
    o.textContent = String(n);
    count.appendChild(o);
  }
  count.value = '2';
  countRow.appendChild(count);
  card.appendChild(countRow);

  // --- Per-slot rows (rebuilt when count changes) -------------------------
  const slots = document.createElement('div');
  slots.className = 'setup-slots';
  card.appendChild(slots);

  const renderSlots = () => {
    const prev = readSlots(slots); // preserve any typed names / toggles
    slots.innerHTML = '';
    const n = Number(count.value);
    for (let i = 0; i < n; i++) {
      const row = document.createElement('div');
      row.className = 'setup-slot';
      row.dataset.idx = String(i);

      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = playerColor(i);
      row.appendChild(sw);

      const name = document.createElement('input');
      name.type = 'text';
      name.className = 'slot-name';
      name.maxLength = 20;
      name.placeholder = `Player ${i + 1}`;
      name.value = prev[i] ? prev[i].name : `Player ${i + 1}`;
      row.appendChild(name);

      const kind = document.createElement('select');
      kind.className = 'slot-kind';
      for (const v of ['Human', 'AI']) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = v;
        kind.appendChild(o);
      }
      // Default: first slot human, the rest AI.
      kind.value = prev[i] ? (prev[i].isAI ? 'AI' : 'Human') : (i === 0 ? 'Human' : 'AI');
      row.appendChild(kind);

      slots.appendChild(row);
    }
  };
  count.addEventListener('change', renderSlots);
  renderSlots();

  // --- Advanced: optional seed -------------------------------------------
  const seedRow = document.createElement('label');
  seedRow.className = 'setup-row advanced';
  seedRow.appendChild(text('Seed (optional)'));
  const seed = document.createElement('input');
  seed.type = 'text';
  seed.dataset.testid = 'seed';
  seed.placeholder = 'random';
  seed.inputMode = 'numeric';
  seedRow.appendChild(seed);
  card.appendChild(seedRow);

  // --- Buttons ------------------------------------------------------------
  const btns = document.createElement('div');
  btns.className = 'setup-buttons';

  const back = document.createElement('button');
  back.dataset.action = 'back';
  back.textContent = '← Menu';
  back.addEventListener('click', onBack);
  btns.appendChild(back);

  const start = document.createElement('button');
  start.className = 'primary big';
  start.dataset.action = 'start';
  start.textContent = 'Start Game';
  start.addEventListener('click', () => {
    const rows = readSlots(slots);
    const numPlayers = rows.length;
    const configs = rows.map((r, i) => ({
      name: r.name || `Player ${i + 1}`,
      isAI: r.isAI,
    }));
    const raw = seed.value.trim();
    const seedVal = raw === '' ? null : (Number.isFinite(Number(raw)) ? (Number(raw) >>> 0) : hashSeed(raw));
    onStart({ numPlayers, configs, seed: seedVal });
  });
  btns.appendChild(start);

  card.appendChild(btns);
  container.appendChild(card);
}

// Read the current slot rows into [{ name, isAI }].
function readSlots(slots) {
  return [...slots.querySelectorAll('.setup-slot')].map((row) => ({
    name: row.querySelector('.slot-name').value.trim(),
    isAI: row.querySelector('.slot-kind').value === 'AI',
  }));
}

// Stable 32-bit hash so a non-numeric seed string still gives a reproducible game.
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function text(s) {
  const span = document.createElement('span');
  span.className = 'setup-label';
  span.textContent = s;
  return span;
}
