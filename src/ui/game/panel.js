// game/panel.js — the in-game side HUD. Wave-3 owns it.
//
// It is a PURE view over the published view-model (window.__APP__.viewModel):
// renderPanel(panel, ctx) clears the panel and rebuilds it from
// `ctx.viewModel` plus the controller's action callbacks. The view-model already
// does the hard work — legality, affordability, hotseat secret-masking — so the
// panel's only job is LEGIBILITY: at every moment the player can tell whose turn
// it is, exactly what to do next, and why an action is or isn't available.
//
// Ticket detail for the *keep* checklist (offered ticket labels) is the one thing
// the view-model doesn't carry, so it still comes from the ctx accessors
// (pendingTickets / ticketById / ticketLabel).
//
// Observable State Contract hooks owned here:
//   - [data-testid="prompt"]                       — the human-readable next step
//   - button[data-action][data-reason] + `disabled` — each action + why-if-blocked
//   - [data-action="draw-faceup"][data-slot]        — clickable face-up cards
//   - [data-testid="standings"] / [data-testid="rank-N"] — live ranking + leader
//   - [data-testid="player-N"] / [data-testid="score-N"] — per-player blocks

import { playerColor, cardColorCss } from '../render.js';
import { WILD } from '../../engine/constants.js';

/**
 * @param {HTMLElement} panel
 * @param {object} ctx - see main.js buildPanelCtx() for the exact shape.
 */
export function renderPanel(panel, ctx) {
  if (!panel) return;
  const {
    viewModel, gameOver,
    pendingTickets, state, ticketById, ticketLabel,
    onDrawDeck, onDrawFaceUp, onDrawTickets, onKeepTickets, onPass, onMenu,
  } = ctx;

  panel.innerHTML = '';

  // --- Header: Menu exit -------------------------------------------------
  const header = el('div', 'panel-header');
  const menuBtn = button('☰ Menu', onMenu);
  menuBtn.dataset.action = 'menu';
  menuBtn.classList.add('menu-exit');
  header.appendChild(menuBtn);
  panel.appendChild(header);

  const vm = viewModel;
  if (!vm) {
    panel.appendChild(noteEl('No game in progress.'));
    return;
  }

  const curIdx = vm.currentPlayerIndex;
  const curPlayer = vm.players[curIdx] || null;
  const curName = curPlayer ? curPlayer.name : `P${curIdx + 1}`;
  const isAITurn = !gameOver && !!(curPlayer && curPlayer.isAI);
  const human = !gameOver && !isAITurn;
  const pend = typeof pendingTickets === 'function' ? pendingTickets(state) : null;
  const a = vm.actions || {};

  // --- Turn banner: whose turn + the next-step prompt --------------------
  // Two lines so "whose turn" is always legible above the instruction.
  const banner = el('div', 'banner');
  banner.dataset.testid = 'prompt';
  banner.style.borderColor = playerColor(curIdx);
  if (gameOver) banner.classList.add('over');

  if (!gameOver) {
    const turnLine = el('div', 'turnline');
    const dot = el('span', 'swatch');
    dot.style.background = playerColor(curIdx);
    turnLine.appendChild(dot);
    const who = document.createElement('strong');
    who.textContent = `${curName}${isAITurn ? ' (AI)' : ''}'s turn`;
    turnLine.appendChild(who);
    banner.appendChild(turnLine);
  }

  // Final-round ("last lap") badge: prominent, visible to everyone, so no player
  // is surprised by the game ending. Driven purely by the view-model.
  if (!gameOver && vm.finalRound) {
    const fr = el('div', 'final-round');
    fr.dataset.testid = 'final-round';
    if (typeof vm.finalTurnsLeft === 'number') fr.dataset.turnsLeft = String(vm.finalTurnsLeft);
    const turns = typeof vm.finalTurnsLeft === 'number'
      ? ` — ${vm.finalTurnsLeft} turn${vm.finalTurnsLeft === 1 ? '' : 's'} left`
      : '';
    fr.textContent = `🏁 FINAL ROUND${turns}`;
    banner.appendChild(fr);
  }
  const promptLine = el('div', 'promptline');
  promptLine.textContent = vm.prompt || (gameOver ? 'Game over' : `Turn: ${curName}`);
  banner.appendChild(promptLine);
  panel.appendChild(banner);

  // --- Ticket-keep decision OR the action bar ----------------------------
  if (pend && !gameOver) {
    panel.appendChild(buildTicketKeep(pend, { human, isAITurn, curName, ticketById, ticketLabel, onKeepTickets }));
  } else {
    panel.appendChild(buildActionBar({ a, human, isAITurn, gameOver, curName, onDrawDeck, onDrawTickets, onPass }));
  }

  // --- Standings: live ranking so the leader is always visible -----------
  panel.appendChild(buildStandings(vm.standings));

  // --- Face-up row -------------------------------------------------------
  panel.appendChild(buildFaceUp(vm.faceUp, { human, mustDrawSecond: !!a.mustDrawSecond, onDrawFaceUp }));

  // --- Per-player blocks (view-model already masks opponents' secrets) ----
  vm.players.forEach((p) => panel.appendChild(buildPlayerBlock(p, gameOver)));

  // --- Log ---------------------------------------------------------------
  panel.appendChild(buildLog(ctx.logLines));
  const logBox = panel.querySelector('.log');
  if (logBox) logBox.scrollTop = logBox.scrollHeight;
}

// ---------------------------------------------------------------------------
// Action bar — Draw Deck / Draw Tickets / Pass, each disabled-with-reason.
// ---------------------------------------------------------------------------

function buildActionBar({ a, human, isAITurn, gameOver, curName, onDrawDeck, onDrawTickets, onPass }) {
  const wrap = el('div', 'actionbar');
  const acts = el('div', 'actions');

  // The turn-level reason that blocks EVERY action (game over / not your turn).
  // `null` means it's the human's turn — fall back to the per-action reason.
  const turnBlock = gameOver ? 'The game is over'
    : isAITurn ? `Waiting for ${curName} to play…`
    : null;

  acts.appendChild(actionBtn('🚂 Draw Deck', 'draw-deck', onDrawDeck, {
    disabled: !(human && a.canDrawDeck),
    reason: turnBlock || (a.canDrawDeck ? null : 'The deck and face-up pile are empty'),
  }));

  acts.appendChild(actionBtn('🎫 Draw Tickets', 'draw-tickets', onDrawTickets, {
    disabled: !(human && a.canDrawTickets),
    reason: turnBlock || drawTicketsReason(a),
  }));

  // Pass is only meaningful when the engine offers it (a forced/optional pass).
  if (a.canPass) {
    acts.appendChild(actionBtn('⏭ Pass', 'pass', () => { if (typeof onPass === 'function') onPass(); }, {
      disabled: !human,
      reason: isAITurn ? `Waiting for ${curName} to play…` : null,
    }));
  }
  wrap.appendChild(acts);

  // Subtle helper text restates the binding constraint where it's NOT obvious —
  // so the "why" lives in the HUD, not buried in the log.
  const help = actionHelp({ a, human, isAITurn, gameOver, curName });
  if (help) wrap.appendChild(helperEl(help));
  return wrap;
}

function drawTicketsReason(a) {
  if (a.canDrawTickets) return null;
  if (a.mustDrawSecond) return 'Finish drawing your 2nd card first';
  return 'No ticket cards left to draw';
}

function actionHelp({ a, human, isAITurn, gameOver, curName }) {
  if (gameOver) return null;
  if (isAITurn) return `Sit tight — ${curName} is taking their turn.`;
  if (!human) return null;
  if (a.mustDrawSecond) {
    return 'You’ve taken one card. Draw a 2nd (deck or a non-wild face-up). Tickets and route claims are locked until you finish.';
  }
  if (a.canPass && !a.canDrawDeck && !a.canDrawTickets) {
    return 'No legal move — Pass to end your turn.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ticket-keep — a clear checklist that enforces minKeep before you can keep.
// ---------------------------------------------------------------------------

function buildTicketKeep(pend, { human, isAITurn, curName, ticketById, ticketLabel, onKeepTickets }) {
  const minKeep = pend.minKeep || 1;
  const tdiv = el('div', 'ticketChoice');
  tdiv.dataset.testid = 'ticket-keep';

  const head = el('div', 'tk-head');
  head.textContent = `Choose tickets to keep (at least ${minKeep} of ${pend.ids.length})`;
  tdiv.appendChild(head);

  const list = el('div', 'tk-list');
  pend.ids.forEach((id) => {
    const lbl = el('label', 'tkrow tk-option');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.tkid = String(id);
    cb.disabled = !human;
    lbl.appendChild(cb);
    const text = document.createElement('span');
    text.textContent = ' ' + (typeof ticketLabel === 'function' ? ticketLabel(ticketById(id)) : String(id));
    lbl.appendChild(text);
    list.appendChild(lbl);
  });
  tdiv.appendChild(list);

  const status = helperEl('');
  tdiv.appendChild(status);

  const keepBtn = actionBtn('Keep selected', 'keep-tickets', () => {
    const keep = selectedIds(list);
    if (keep.length < minKeep) return; // guarded below + engine also guards
    onKeepTickets(keep);
  }, { disabled: !human });
  tdiv.appendChild(keepBtn);

  // Live enforcement: the keep button stays disabled until >= minKeep are kept,
  // and the helper line says exactly how many more are needed.
  const sync = () => {
    const n = selectedIds(list).length;
    const enough = n >= minKeep;
    keepBtn.disabled = !human || !enough;
    if (!human) {
      status.textContent = isAITurn ? `Waiting for ${curName} to choose…` : '';
    } else if (enough) {
      status.textContent = `Keeping ${n} ticket${n === 1 ? '' : 's'}.`;
      keepBtn.removeAttribute('data-reason');
    } else {
      const need = minKeep - n;
      status.textContent = `Keep ${need} more (minimum ${minKeep}).`;
      keepBtn.dataset.reason = `Keep at least ${minKeep} ticket${minKeep === 1 ? '' : 's'}`;
    }
  };
  list.addEventListener('change', sync);
  sync();
  return tdiv;
}

function selectedIds(list) {
  const out = [];
  list.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    if (cb.checked) out.push(cb.dataset.tkid);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Face-up row — clickable with hover; wilds locked during the 2nd-card draw.
// ---------------------------------------------------------------------------

function buildFaceUp(faceUp, { human, mustDrawSecond, onDrawFaceUp }) {
  const wrap = el('div', 'faceup');
  wrap.appendChild(labelEl('Face-up cards'));
  const row = el('div', 'cardrow');
  const cards = Array.isArray(faceUp) ? faceUp : [];
  let shown = 0;
  cards.forEach((card, slot) => {
    if (card == null) return; // empty slot
    shown++;
    const color = cardColorOf(card);
    const isWild = color === WILD;
    const c = el('div', 'card');
    c.style.background = cardColorCss(color);
    c.textContent = abbr(color);
    // A face-up wild may not be taken as the 2nd draw — make that legible.
    const lockedWild = human && mustDrawSecond && isWild;
    if (human && !lockedWild) {
      c.classList.add('clickable');
      c.dataset.action = 'draw-faceup';
      c.dataset.slot = String(slot);
      c.title = isWild ? `${color} (ends your draw)` : String(color);
      c.addEventListener('click', () => onDrawFaceUp(slot));
    } else {
      c.title = lockedWild ? 'Can’t take a wild as your 2nd card' : String(color);
      if (lockedWild) c.classList.add('locked');
    }
    row.appendChild(c);
  });
  if (shown === 0) row.appendChild(noteEl('(none)'));
  wrap.appendChild(row);
  return wrap;
}

// ---------------------------------------------------------------------------
// Standings — current ranking by score; the leader (top score > 0) is marked.
// Scores/points are public info, so this is privacy-safe for all players.
//
// Contract hooks: [data-testid="standings"] wraps the list;
// each row is [data-testid="rank-N"] (N = player index) carrying
// data-rank / data-leader for the e2e suite to read structurally.
// ---------------------------------------------------------------------------

function buildStandings(standings) {
  const wrap = el('div', 'standings');
  wrap.dataset.testid = 'standings';
  wrap.appendChild(labelEl('Standings'));
  const rows = Array.isArray(standings) ? standings : [];
  rows.forEach((s) => {
    const row = el('div', 'standrow');
    row.dataset.testid = `rank-${s.index}`;
    row.dataset.rank = String(s.rank);
    row.dataset.leader = s.isLeader ? 'true' : 'false';
    if (s.isLeader) row.classList.add('leader');

    const mark = el('span', 'standmark');
    mark.textContent = s.isLeader ? '🥇' : `#${s.rank}`;
    row.appendChild(mark);

    const dot = el('span', 'swatch');
    dot.style.background = playerColor(s.index);
    row.appendChild(dot);

    const name = el('span', 'standname');
    name.textContent = `${s.name}${s.isAI ? ' (AI)' : ''}`;
    row.appendChild(name);

    const pts = el('span', 'standpts');
    pts.textContent = `${s.score} pts`;
    row.appendChild(pts);

    wrap.appendChild(row);
  });
  return wrap;
}

// ---------------------------------------------------------------------------
// Per-player block — renders ONLY what the view-model exposes (privacy-safe).
// ---------------------------------------------------------------------------

function buildPlayerBlock(p, gameOver) {
  const block = el('div', 'player');
  block.dataset.testid = `player-${p.index}`;
  block.style.borderLeftColor = playerColor(p.index);

  const head = el('div', 'phead');
  if (p.isActive) head.classList.add('active');
  const dot = el('span', 'swatch');
  dot.style.background = playerColor(p.index);
  head.appendChild(dot);
  const title = document.createElement('strong');
  title.textContent = `${p.name}${p.isAI ? ' (AI)' : ''}`;
  head.appendChild(title);
  const sc = el('span', 'score');
  sc.dataset.testid = `score-${p.index}`;
  sc.textContent = `${p.score} pts`;
  head.appendChild(sc);
  block.appendChild(head);

  // Hand: own/revealed → colored pips; hidden opponent → count only.
  const handRow = el('div', 'hand');
  if (p.handByColor) {
    const entries = Object.keys(p.handByColor);
    if (entries.length === 0) {
      handRow.appendChild(noteEl('(no cards)'));
    } else {
      // Label the revealed own-hand so it obviously reads as the player's cards.
      const lbl = labelEl(`Your hand (${p.handCount})`);
      lbl.dataset.testid = 'my-hand';
      block.appendChild(lbl);
      entries.forEach((color) => handRow.appendChild(pipGroup(color, p.handByColor[color])));
    }
  } else {
    handRow.appendChild(noteEl(`${p.handCount} card${p.handCount === 1 ? '' : 's'} (hidden)`));
  }
  block.appendChild(handRow);

  if (typeof p.trainsLeft === 'number') {
    block.appendChild(noteEl(`Trains: ${p.trainsLeft}`));
  }

  // Tickets: revealed → list with done/!done; hidden → count only.
  if (p.tickets) {
    if (p.tickets.length > 0) {
      const tWrap = el('div', 'tickets');
      tWrap.appendChild(labelEl('Tickets'));
      p.tickets.forEach((tk) => {
        const row = el('div', 'tkrow');
        const mark = el('span', tk.done ? 'done' : 'notdone');
        mark.textContent = tk.done ? '✓' : '✗';
        row.appendChild(mark);
        row.appendChild(document.createTextNode(` ${tk.from} → ${tk.to} (${tk.points})`));
        tWrap.appendChild(row);
      });
      block.appendChild(tWrap);
    }
  } else if (p.ticketCount > 0) {
    block.appendChild(noteEl(`${p.ticketCount} ticket${p.ticketCount === 1 ? '' : 's'} (hidden)`));
  }

  return block;
}

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

function buildLog(logLines) {
  const wrap = el('div', 'logwrap');
  wrap.appendChild(labelEl('Log'));
  const box = el('div', 'log');
  (logLines || []).slice(-40).forEach((line) => {
    const ln = el('div', 'logline');
    ln.textContent = line;
    box.appendChild(ln);
  });
  wrap.appendChild(box);
  return wrap;
}

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
function button(text, onClick) {
  const b = document.createElement('button');
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}
// An action button carrying the Observable State Contract hooks. A blocked
// button gets both `disabled` and a `title`/`data-reason` so the "why" is
// discoverable on hover and to the e2e suite.
function actionBtn(text, action, onClick, { disabled = false, reason = null } = {}) {
  const b = button(text, onClick);
  b.dataset.action = action;
  if (disabled && reason) {
    b.dataset.reason = reason;
    b.title = reason;
  } else {
    b.removeAttribute('data-reason');
    b.removeAttribute('title');
  }
  b.disabled = !!disabled;
  return b;
}
function labelEl(text) {
  const e = el('div', 'label');
  e.textContent = text;
  return e;
}
function noteEl(text) {
  const e = el('div', 'note');
  e.textContent = text;
  return e;
}
function helperEl(text) {
  const e = el('div', 'action-help');
  e.textContent = text;
  return e;
}
function pipGroup(color, count) {
  const grp = el('span', 'pipgrp');
  for (let k = 0; k < Math.min(count, 12); k++) grp.appendChild(pip(color));
  if (count > 12) {
    const more = el('span', 'pipmore');
    more.textContent = `+${count - 12}`;
    grp.appendChild(more);
  }
  const cnt = el('span', 'pipcount');
  cnt.textContent = String(count);
  grp.appendChild(cnt);
  return grp;
}
function pip(color) {
  const span = el('span', 'pip');
  span.style.background = cardColorCss(color);
  span.title = String(color);
  return span;
}
function cardColorOf(card) {
  if (typeof card === 'string') return card;
  return (card && (card.color ?? card.kind)) || 'gray';
}
function abbr(color) {
  const c = String(color);
  return c.length <= 3 ? c.toUpperCase() : c.slice(0, 1).toUpperCase();
}
