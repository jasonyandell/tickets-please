# Glossary

Terms used across the code and wiki. See [[game-rules]] and [[engine-api]].

- **Train-car card** — a colored card (one of 8 colors) or a **wild**, spent to
  claim routes. The deck holds 110.
- **Wild / locomotive / rainbow** — a card that substitutes for any color.
- **Route** — an edge between two cities, with a `length` (1–6) and a `color`
  (one of 8, or **gray**). Claiming it places that many trains.
- **Gray route** — claimable with any single color (plus wilds).
- **Double / parallel route** — two routes between the same pair of cities; in
  2–3 player games only one may be claimed.
- **Train pieces** — the 45 physical trains a player places; running low (≤ 2)
  ends the game.
- **Destination ticket** — a secret goal: connect two named cities for bonus
  points, or lose points if unfinished. See [[scoring]].
- **Face-up row** — the 5 visible train-car cards available to draw.
- **Action** — a serializable move (`DRAW_DECK`, `CLAIM_ROUTE`, …). See
  [[engine-api]].
- **State** — the complete, immutable game snapshot the reducer transforms.
- **Reducer** — `applyAction(state, action) -> state`; the pure engine core.
- **Longest path** — the longest continuous trail of a player's routes; worth a
  +10 bonus. See [[scoring]].
- **Seed** — the integer that makes a game [[determinism|deterministic]].
