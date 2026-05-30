// Game-wide constants. These define the rules numerically and are the single
// source of truth for the engine, the AI, the UI, and the tests.

/** The eight standard train-car colors. */
export const TRAIN_COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'white',
  'black',
];

/** The wild card ("locomotive"). Can substitute for any color when claiming. */
export const WILD = 'rainbow';

/** Every card color that can appear in a hand or the deck. */
export const CARD_COLORS = [...TRAIN_COLORS, WILD];

/** A "gray" route may be claimed with cards of any single color. */
export const GRAY = 'gray';

/** Deck composition: 12 of each of the 8 colors + 14 wilds = 110 cards. */
export const CARDS_PER_COLOR = 12;
export const WILD_COUNT = 14;

/** Number of face-up cards available to draw from. */
export const FACE_UP_SLOTS = 5;

/**
 * If the face-up row ever shows this many wilds, all five are discarded and the
 * row is re-dealt. (Prevents the row from being clogged with locomotives.)
 */
export const MAX_FACE_UP_WILDS = 3;

/** Trains (route segments) each player starts with. */
export const STARTING_TRAINS = 45;

/** Train-car cards dealt to each player at the start. */
export const STARTING_HAND = 4;

/** Destination tickets dealt at the start; players must keep at least 2. */
export const STARTING_TICKETS_DEAL = 3;
export const STARTING_TICKETS_KEEP_MIN = 2;

/** Destination tickets dealt on a mid-game draw; players must keep at least 1. */
export const TICKETS_DEAL = 3;
export const TICKETS_KEEP_MIN = 1;

/**
 * The final round triggers once a player ends a turn with this many or fewer
 * trains remaining. Every player (including the trigger) then takes exactly one
 * more turn.
 */
export const ENDGAME_TRAIN_THRESHOLD = 2;

/** Bonus awarded to the player(s) with the longest continuous path. */
export const LONGEST_PATH_BONUS = 10;

/** Points scored for claiming a route, indexed by its length. */
export const ROUTE_POINTS = {
  1: 1,
  2: 2,
  3: 4,
  4: 7,
  5: 10,
  6: 15,
};

/** Maximum route length the map may contain (and the largest ROUTE_POINTS key). */
export const MAX_ROUTE_LENGTH = 6;
