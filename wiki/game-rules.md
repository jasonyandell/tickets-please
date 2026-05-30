# Game Rules

The rules of `tickets-please`. Numbers come from `src/engine/constants.js`, which
is authoritative; this page explains them. See also [[scoring]] and [[map]].

## Setup
- 2–5 players. Each starts with **45 train pieces** and **4 train-car cards**.
- The deck is **110 cards**: 12 each of 8 colors + 14 **wild** ("rainbow")
  locomotives.
- **5 cards** are turned face-up beside the deck. If 3+ are wild, all 5 are
  discarded and re-dealt.
- Each player is dealt **3 destination tickets**. (Default rule: keep all; see
  [[engine-api]] for the optional choose-which variant.)

## A turn — do exactly ONE of:

1. **Draw train cards.** Take 2 cards total, each either the top of the deck
   (blind) or one face-up card. Taking a **face-up wild uses your whole turn**
   (you get only that one card). Each face-up card taken is immediately replaced.
2. **Claim a route.** Spend a set of cards equal to the route's length:
   - **Colored route:** cards must match the route's color (wilds substitute for
     any color).
   - **Gray route:** any single color (plus wilds).
   - You must have enough train pieces (≥ the route's length). Place that many
     trains, score immediately (see [[scoring]]), discard the spent cards.
   - **Double routes** (two parallel edges between two cities): in 2–3 player
     games only one of the pair may be claimed, and no player may own both.
3. **Draw destination tickets.** Draw 3 from the ticket deck; keep at least 1,
   return the rest to the bottom.

## End of the game
- When a player finishes a turn with **≤ 2 trains** remaining, the **final round**
  begins: every player (including that one) takes exactly **one more turn**.
- Then the game ends and final [[scoring]] is computed.

## Winning
- Highest total score wins. Total = route points + completed-ticket points −
  incomplete-ticket points + the **+10 longest-path bonus** (to the player with
  the single longest continuous route; ties split — all tied players get it).
- See [[scoring]] for exact computation and tie-breaking.

> Note on heritage: *Ticket to Ride* is a trademark of Days of Wonder. This is an
> independent, public-domain implementation of the **rules** (which are not
> copyrightable) over an **original map**. See [[design-decisions]].
