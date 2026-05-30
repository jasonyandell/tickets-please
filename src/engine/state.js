// Game state construction. See CONTRACT.md §3 for the full state shape.
//
// This module owns the *shape* of state and the initial deal. The mutation
// rules live in rules.js / game.js. Everything here is pure and deterministic.

import {
  CARD_COLORS,
  TRAIN_COLORS,
  WILD,
  CARDS_PER_COLOR,
  WILD_COUNT,
  FACE_UP_SLOTS,
  MAX_FACE_UP_WILDS,
  STARTING_TRAINS,
  STARTING_HAND,
  STARTING_TICKETS_DEAL,
} from './constants.js';
import { makeRng, shuffle } from './rng.js';

/**
 * Build the full 110-card draw deck as an array of color strings (unshuffled).
 * @returns {string[]}
 */
export function buildDeck() {
  const deck = [];
  for (const color of TRAIN_COLORS) {
    for (let i = 0; i < CARDS_PER_COLOR; i++) deck.push(color);
  }
  for (let i = 0; i < WILD_COUNT; i++) deck.push(WILD);
  return deck;
}

/** An empty hand tally with every color at 0. */
export function emptyHand() {
  const hand = {};
  for (const color of CARD_COLORS) hand[color] = 0;
  return hand;
}

/** Count of all cards in a hand tally. */
export function handSize(hand) {
  let n = 0;
  for (const color of CARD_COLORS) n += hand[color] || 0;
  return n;
}

/**
 * Count the wilds currently shown in a face-up row.
 * @param {string[]} faceUp
 */
export function countFaceUpWilds(faceUp) {
  let n = 0;
  for (const c of faceUp) if (c === WILD) n++;
  return n;
}

/**
 * Refill the face-up row from the deck up to FACE_UP_SLOTS, then enforce the
 * "too many wilds" rule: if MAX_FACE_UP_WILDS or more wilds show AND enough
 * cards remain to re-deal, discard all face-up cards and deal a fresh row.
 * Pure: returns { faceUp, deck, discard }. `rng` is used for reshuffles.
 *
 * @param {{faceUp:string[], deck:string[], discard:string[]}} piles
 * @param {() => number} rng
 */
export function refillFaceUp(piles, rng) {
  let faceUp = piles.faceUp.slice();
  let deck = piles.deck.slice();
  let discard = piles.discard.slice();

  const drawOne = () => {
    if (deck.length === 0) {
      if (discard.length === 0) return null;
      deck = shuffle(discard, rng);
      discard = [];
    }
    return deck.pop();
  };

  // Fill empty slots.
  for (let i = 0; i < FACE_UP_SLOTS; i++) {
    if (faceUp[i] == null) {
      const card = drawOne();
      if (card == null) break;
      faceUp[i] = card;
    }
  }

  // Enforce the wild rule, repeatedly (a fresh deal could itself be wild-heavy).
  // Only re-deal while there are enough total cards to actually replace the row.
  let guard = 0;
  while (countFaceUpWilds(faceUp) >= MAX_FACE_UP_WILDS && guard < 20) {
    const live = faceUp.filter((c) => c != null);
    if (deck.length + discard.length < FACE_UP_SLOTS) break;
    discard = discard.concat(live);
    faceUp = new Array(FACE_UP_SLOTS).fill(null);
    for (let i = 0; i < FACE_UP_SLOTS; i++) {
      const card = drawOne();
      if (card == null) break;
      faceUp[i] = card;
    }
    guard++;
  }

  return { faceUp, deck, discard };
}

/**
 * Create a new game in phase 'play'.
 *
 * @param {object} opts
 * @param {object} opts.map - a map in the CONTRACT §2 format.
 * @param {object[]} opts.tickets - the ticket list (CONTRACT §2).
 * @param {Array<{name:string,isAI?:boolean}>} opts.playerConfigs - 2..5 players.
 * @param {number} [opts.seed=1]
 * @returns {object} state
 */
export function initGame({ map, tickets, playerConfigs, seed = 1 }) {
  if (!playerConfigs || playerConfigs.length < 2 || playerConfigs.length > 5) {
    throw new Error('tickets-please supports 2 to 5 players');
  }
  const rng = makeRng(seed);

  let deck = shuffle(buildDeck(), rng);
  const discard = [];

  const players = playerConfigs.map((cfg, id) => {
    const hand = emptyHand();
    for (let i = 0; i < STARTING_HAND; i++) hand[deck.pop()]++;
    return {
      id,
      name: cfg.name || `Player ${id + 1}`,
      isAI: !!cfg.isAI,
      hand,
      trains: STARTING_TRAINS,
      tickets: [],
      claimedRoutes: [],
      score: 0,
    };
  });

  // Deal face-up row.
  const refilled = refillFaceUp(
    { faceUp: new Array(FACE_UP_SLOTS).fill(null), deck, discard },
    rng
  );
  deck = refilled.deck;

  // Shuffle the ticket deck and deal each player their starting tickets.
  // Default behavior: players keep all starting tickets (simplest correct rule).
  let ticketDeck = shuffle(tickets.map((t) => t.id), rng);
  const ticketById = new Map(tickets.map((t) => [t.id, t]));
  for (const player of players) {
    for (let i = 0; i < STARTING_TICKETS_DEAL && ticketDeck.length > 0; i++) {
      const tid = ticketDeck.pop();
      const t = ticketById.get(tid);
      player.tickets.push({ ...t, done: false });
    }
  }

  return {
    seed,
    players,
    deck,
    discard: refilled.discard,
    faceUp: refilled.faceUp,
    ticketDeck,
    ticketDiscard: [],
    routeOwner: {},
    current: 0,
    phase: 'play',
    finalTurnsLeft: null,
    pending: null,
    cardsDrawnThisTurn: 0,
    moveCount: 0,
    log: [],
    winner: null,
  };
}

/** Deep-ish clone of a state for pure reducers. */
export function cloneState(state) {
  return {
    ...state,
    players: state.players.map((p) => ({
      ...p,
      hand: { ...p.hand },
      tickets: p.tickets.map((t) => ({ ...t })),
      claimedRoutes: p.claimedRoutes.slice(),
    })),
    deck: state.deck.slice(),
    discard: state.discard.slice(),
    faceUp: state.faceUp.slice(),
    ticketDeck: state.ticketDeck.slice(),
    ticketDiscard: state.ticketDiscard.slice(),
    routeOwner: { ...state.routeOwner },
    pending: state.pending ? { ...state.pending, offered: state.pending.offered.slice() } : null,
    log: state.log.slice(),
    winner: state.winner ? state.winner.slice() : null,
  };
}
