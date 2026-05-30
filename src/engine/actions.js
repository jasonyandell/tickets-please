// Action type tags and small constructors. See CONTRACT.md §4.
// Actions are plain serializable objects; these helpers just reduce typos.

export const DRAW_FACEUP = 'DRAW_FACEUP';
export const DRAW_DECK = 'DRAW_DECK';
export const CLAIM_ROUTE = 'CLAIM_ROUTE';
export const DRAW_TICKETS = 'DRAW_TICKETS';
export const KEEP_TICKETS = 'KEEP_TICKETS';

export const drawFaceUp = (slot) => ({ type: DRAW_FACEUP, slot });
export const drawDeck = () => ({ type: DRAW_DECK });
export const claimRoute = (routeId, spend) => ({ type: CLAIM_ROUTE, routeId, spend });
export const drawTickets = () => ({ type: DRAW_TICKETS });
export const keepTickets = (keep) => ({ type: KEEP_TICKETS, keep });
