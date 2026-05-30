// Deterministic, seedable pseudo-random number generator.
//
// The entire game engine is deterministic: given the same seed and the same
// sequence of actions, the resulting state is byte-for-byte identical. This is
// what makes the engine fully testable and replayable. Never call Math.random()
// anywhere in the engine — thread an rng created here instead.

/**
 * Create a seeded PRNG (mulberry32). Returns a function that yields floats in
 * the half-open interval [0, 1).
 * @param {number} seed - any 32-bit-coercible integer.
 * @returns {() => number}
 */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Return a new array that is a Fisher-Yates shuffle of `array` using `rng`.
 * Does not mutate the input.
 * @template T
 * @param {T[]} array
 * @param {() => number} rng
 * @returns {T[]}
 */
export function shuffle(array, rng) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

/**
 * Return an integer in [0, n).
 * @param {() => number} rng
 * @param {number} n
 * @returns {number}
 */
export function randInt(rng, n) {
  return Math.floor(rng() * n);
}
