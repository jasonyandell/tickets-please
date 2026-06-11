// screens/gameover.js — the endgame scoreboard.
//
// Pure DOM construction from the view-model alone (no engine knowledge),
// plus playerColor for the winner's color chip. It reads
// `vm.scoreboard` (rows derived from finalScores: routePoints / ticketPoints /
// longestBonus / total / completedTickets / longestPath, pre-sorted highest-first)
// and `vm.winnerIndex` to render a per-player breakdown table, highlight the
// winner, and offer New Game (→ setup) and Menu.
//
// Observable State Contract hooks:
//   [data-testid="winner"]              — the winner/tie summary line
//   [data-testid="scoreboard"]          — the breakdown table
//   [data-testid="final-score-{index}"] — each player's row
//   [data-testid="final-total-{index}"] — each player's total cell
//   button[data-action="new-game"|"menu"]

import { playerColor } from '../render.js';

/**
 * @param {HTMLElement} container - the [data-screen="gameover"] section.
 * @param {object} vm - the view-model (game-over shape).
 * @param {{ onNewGame: () => void, onMenu: () => void }} hooks
 */
export function renderGameOver(container, vm, { onNewGame, onMenu }) {
  if (!container) return;
  container.innerHTML = '';

  const rows = vm && Array.isArray(vm.scoreboard) ? vm.scoreboard : [];
  const winnerIndex = vm ? vm.winnerIndex : null;

  const card = el('div', 'over-card');

  const h = el('h1', 'over-title');
  h.textContent = 'Game over';
  card.appendChild(h);

  const who = el('div', 'over-winner');
  who.dataset.testid = 'winner';
  // Winner color chip (decorative) + the summary text. textContent-only
  // consumers still read the full line via the trailing text node.
  if (winnerIndex != null && rows.some((r) => r.index === winnerIndex)) {
    const chip = el('span', 'swatch');
    chip.style.background = playerColor(winnerIndex);
    chip.setAttribute('aria-hidden', 'true');
    who.appendChild(chip);
  }
  who.appendChild(document.createTextNode(winnerText(rows, winnerIndex)));
  card.appendChild(who);

  if (rows.length > 0) {
    card.appendChild(scoreTable(rows, winnerIndex));
  } else {
    card.appendChild(noteEl((vm && vm.prompt) || 'No scores available.'));
  }

  const btns = el('div', 'over-buttons');
  const again = button('New Game', onNewGame);
  again.classList.add('primary', 'big');
  again.dataset.action = 'new-game';
  btns.appendChild(again);

  const menu = button('Menu', onMenu);
  menu.dataset.action = 'menu';
  btns.appendChild(menu);
  card.appendChild(btns);

  container.appendChild(card);
}

// The per-player breakdown table. Columns mirror the scoring components so the
// total is legibly accounted for: Routes + Tickets + Longest = Total.
function scoreTable(rows, winnerIndex) {
  const table = document.createElement('table');
  table.className = 'over-table';
  table.dataset.testid = 'scoreboard';

  const thead = document.createElement('thead');
  thead.appendChild(headerRow(['Player', 'Routes', 'Tickets', 'Longest', 'Total']));
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.dataset.testid = `final-score-${row.index}`;
    if (row.index === winnerIndex) tr.classList.add('winner');

    tr.appendChild(td(row.name, 'over-name'));
    tr.appendChild(td(String(row.routePoints), 'num'));
    // Net ticket points plus the count completed (a quick read of completed/failed).
    tr.appendChild(td(`${row.ticketPoints} (${row.completedTickets}✓)`, 'num'));
    // Longest-path bonus, annotated with the path length when it earned the bonus.
    const longest = row.longestBonus
      ? `${row.longestBonus} (${row.longestPath})`
      : String(row.longestBonus);
    tr.appendChild(td(longest, 'num'));

    const total = td(String(row.total), 'num total');
    total.dataset.testid = `final-total-${row.index}`;
    tr.appendChild(total);

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

// The winner / tie summary line (the h1 already says "Game over"). The leading
// emoji is decorative; it pairs with the CSS-only celebration (the headline
// pop-in + the gold shimmer on the winner row) defined in style.css.
function winnerText(rows, winnerIndex) {
  if (winnerIndex == null || rows.length === 0) return 'Game over';
  const win = rows.find((r) => r.index === winnerIndex);
  if (!win) return 'Game over';
  const tied = rows.filter((r) => r.total === win.total).length > 1;
  if (tied) return `🤝 Tie at ${win.total} pts`;
  return `🎉 ${win.name} wins — ${win.total} pts`;
}

// ---------------------------------------------------------------------------
// Small DOM helpers (local; this module owns its own markup).
// ---------------------------------------------------------------------------

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
function button(text, onClick) {
  const b = document.createElement('button');
  b.textContent = text;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}
function td(text, cls) {
  const cell = document.createElement('td');
  if (cls) cell.className = cls;
  cell.textContent = text;
  return cell;
}
function headerRow(labels) {
  const tr = document.createElement('tr');
  for (const l of labels) {
    const th = document.createElement('th');
    th.textContent = l;
    tr.appendChild(th);
  }
  return tr;
}
function noteEl(text) {
  const e = el('div', 'note');
  e.textContent = text;
  return e;
}
