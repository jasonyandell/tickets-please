// history.js — undo/redo as a video recorder/player over the pure engine.
//
// The mental model is a tape, not a stack of "undo deltas":
//   - We RECORD every applied action into an append-only log of entries.
//     seed + entries fully determine the game, so the log IS the game.
//   - The CURSOR is the playhead: the number of entries currently applied.
//   - The state shown is always a pure REPLAY of entries[0..cursor] through the
//     engine reducer (applyActions). We NEVER mutate state to "undo" — we just
//     move the playhead and recompute. Deterministic, timer-free.
//
// Undo/redo operate on HUMAN decision points: undo rewinds past any AI actions
// to the previous human action (so the table lands waiting on that human, and
// the AI never auto-replays); redo fast-forwards to the next human decision
// point (or the end of the tape). A new action recorded while the cursor sits
// before the end is a BRANCH: the tape is truncated at the cursor and the new
// action appended — a genuine do-over.
//
// This module is pure: it owns the log + cursor and computes states by replay.
// It never touches the DOM, timers, or globals. The reducer is injected
// (defaulting to the engine's applyActions) so it is trivially unit-testable.

import { applyActions } from '../engine/game.js';

// ---------------------------------------------------------------------------
// Pure helpers (no instance state) — the core the recorder is built on.
// ---------------------------------------------------------------------------

/**
 * Replay the first `count` recorded actions over `initialState`.
 * Pure: returns a fresh state and never mutates its inputs (the reducer clones).
 *
 * @param {object} initialState - the post-initGame state (cursor 0).
 * @param {Array<{action:object}>} entries - the recorded tape.
 * @param {object} map - engine map, threaded to the reducer.
 * @param {number} count - how many entries to apply (the cursor position).
 * @param {(state:object, actions:object[], map:object)=>object} [reducer]
 * @returns {object} the replayed state.
 */
export function replay(initialState, entries, map, count, reducer = applyActions) {
  const n = Math.max(0, Math.min(count, entries.length));
  const actions = entries.slice(0, n).map((e) => e.action);
  return reducer(initialState, actions, map);
}

/**
 * The cursor undo should jump to: the index of the most recent HUMAN action
 * strictly before the current cursor (skipping AI actions). Setting the cursor
 * there un-applies that human action, landing the game waiting on that human.
 *
 * @returns {number|null} the target cursor, or null if there is nothing to undo.
 */
export function undoTarget(cursor, entries) {
  for (let i = Math.min(cursor, entries.length) - 1; i >= 0; i--) {
    if (!entries[i].isAI) return i;
  }
  return null;
}

/**
 * The cursor redo should jump to: the next HUMAN decision point after the
 * current cursor. We re-apply the human action at the cursor plus any AI actions
 * that follow it, stopping just before the next human action — or replaying the
 * whole remaining tape if no further human action exists.
 *
 * @returns {number|null} the target cursor, or null if there is nothing to redo.
 */
export function redoTarget(cursor, entries) {
  if (cursor >= entries.length) return null;
  for (let j = cursor + 1; j < entries.length; j++) {
    if (!entries[j].isAI) return j;
  }
  return entries.length;
}

// ---------------------------------------------------------------------------
// Recorder — the stateful tape (log + cursor) wired to the reducer.
// ---------------------------------------------------------------------------

/**
 * Create a recorder/player over a freshly-initialised game state.
 *
 * @param {object} opts
 * @param {object} opts.initialState - the post-initGame state (cursor 0).
 * @param {object} opts.map - engine map.
 * @param {Function} [opts.reducer] - reducer for replay (default applyActions).
 * @returns {object} the recorder API.
 */
export function createRecorder({ initialState, map, reducer = applyActions }) {
  let entries = [];
  let cursor = 0;

  const state = () => replay(initialState, entries, map, cursor, reducer);

  return {
    /**
     * Record an applied action. If the cursor is not at the end (we have undone),
     * this BRANCHES: the tape is truncated at the cursor and the action appended.
     * @param {object} action - the engine action that was applied.
     * @param {{by?:number, isAI?:boolean}} [meta] - who acted; isAI drives undo.
     */
    record(action, meta = {}) {
      if (cursor < entries.length) entries = entries.slice(0, cursor);
      entries.push({ action, by: meta.by, isAI: !!meta.isAI });
      cursor = entries.length;
    },

    /** The state at the current cursor (pure replay). */
    state,

    /** True if there is a previous human decision point to rewind to. */
    canUndo() {
      return undoTarget(cursor, entries) !== null;
    },

    /** True if there is a recorded future to fast-forward into. */
    canRedo() {
      return redoTarget(cursor, entries) !== null;
    },

    /**
     * Rewind to the previous human decision point.
     * @returns {object|null} the new state, or null if nothing to undo.
     */
    undo() {
      const t = undoTarget(cursor, entries);
      if (t === null) return null;
      cursor = t;
      return state();
    },

    /**
     * Fast-forward to the next human decision point (or the end of the tape).
     * @returns {object|null} the new state, or null if nothing to redo.
     */
    redo() {
      const t = redoTarget(cursor, entries);
      if (t === null) return null;
      cursor = t;
      return state();
    },

    /** Current cursor position (number of applied entries). */
    getCursor() {
      return cursor;
    },

    /** A shallow copy of the recorded tape (for tests / inspection). */
    getEntries() {
      return entries.slice();
    },
  };
}
