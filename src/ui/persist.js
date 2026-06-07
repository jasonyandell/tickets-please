// persist.js — keep your game across a page reload.
//
// The deterministic engine makes this trivial: the SAVE is just the action log,
// not a snapshot of state. seed + playerConfigs + recorded actions fully
// determine every position, so restore is a pure REPLAY (exactly what the
// undo/redo recorder already does — see history.js). We never serialize engine
// state; we serialize the recipe to rebuild it.
//
// Save shape (localStorage, key SAVE_KEY):
//   { version, seed, playerConfigs, actions:[{action,by,isAI}], cursor }
//
// This module is pure and dependency-injected: it never imports the engine map
// or initGame. The caller supplies how to build the initial state and how to
// create a recorder, so the same code is trivially unit-testable against a
// fixture map. Corrupt/missing/foreign saves deserialize to null — restore then
// falls back to a fresh game and never throws.

export const SAVE_KEY = 'tickets-please/save/v1';
const VERSION = 1;

// ---------------------------------------------------------------------------
// Serialize / deserialize — plain JSON over seed + the recorded action tape.
// ---------------------------------------------------------------------------

/**
 * Build a JSON-able save object from the live game's parts.
 *
 * @param {object} parts
 * @param {number} parts.seed - the game seed (>>> 0).
 * @param {Array<{name:string,isAI:boolean}>} parts.playerConfigs
 * @param {Array<{action:object,by?:number,isAI?:boolean}>} parts.entries
 *   - the recorder tape (history.getEntries()).
 * @param {number} parts.cursor - the playhead (history.getCursor()).
 * @returns {object} the normalized save.
 */
export function serializeGame({ seed, playerConfigs, entries, cursor }) {
  return {
    version: VERSION,
    seed: seed >>> 0,
    playerConfigs: (playerConfigs || []).map((c) => ({
      name: c && c.name != null ? String(c.name) : '',
      isAI: !!(c && (c.isAI ?? c.ai)),
    })),
    actions: (entries || []).map((e) => ({
      action: e.action,
      by: e.by,
      isAI: !!e.isAI,
    })),
    cursor: Number.isFinite(cursor) ? cursor : (entries ? entries.length : 0),
  };
}

/**
 * Parse + validate a raw save (string or object). Returns a normalized save, or
 * null if it is missing, malformed, or a different version. Never throws.
 *
 * @param {string|object|null} raw
 * @returns {object|null}
 */
export function deserializeGame(raw) {
  try {
    if (raw == null) return null;
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!o || typeof o !== 'object') return null;
    if (o.version !== VERSION) return null;
    if (!Number.isFinite(o.seed)) return null;
    if (!Array.isArray(o.playerConfigs) || o.playerConfigs.length < 2) return null;
    if (!Array.isArray(o.actions)) return null;
    for (const e of o.actions) {
      // Every entry must carry a typed engine action (the replay reducer needs it).
      if (!e || typeof e !== 'object' || !e.action || typeof e.action.type !== 'string') {
        return null;
      }
    }
    const cursor = Number.isFinite(o.cursor)
      ? Math.max(0, Math.min(o.cursor, o.actions.length))
      : o.actions.length;
    return {
      version: VERSION,
      seed: o.seed >>> 0,
      playerConfigs: o.playerConfigs.map((c) => ({
        name: c && c.name != null ? String(c.name) : '',
        isAI: !!(c && c.isAI),
      })),
      actions: o.actions.map((e) => ({ action: e.action, by: e.by, isAI: !!e.isAI })),
      cursor,
    };
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// localStorage glue — every call is wrapped (private mode / quota can throw).
// ---------------------------------------------------------------------------

/** Persist a save object. Returns true on success, false if storage rejected it. */
export function saveTo(storage, save) {
  try {
    if (!storage) return false;
    storage.setItem(SAVE_KEY, JSON.stringify(save));
    return true;
  } catch (_) {
    return false;
  }
}

/** Load + validate the persisted save, or null if absent/corrupt/unavailable. */
export function loadFrom(storage) {
  try {
    if (!storage) return null;
    return deserializeGame(storage.getItem(SAVE_KEY));
  } catch (_) {
    return null;
  }
}

/** Remove the persisted save (a no-op if storage is unavailable). */
export function clearSave(storage) {
  try {
    if (storage) storage.removeItem(SAVE_KEY);
  } catch (_) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Auto-reload policy — pure, clock-injected (NO Date.now / setTimeout here).
//
// The driver (main.js) owns the single setInterval and reads the real clock; it
// asks this function whether a reload is due. Keeping the decision pure makes it
// trivially unit-testable with injected timestamps — no fake timers, no waits.
// ---------------------------------------------------------------------------

/**
 * Decide whether an auto-reload should fire right now.
 *
 * True iff we are still inside the "recently played" window AND at least one
 * interval has elapsed since the last reload:
 *   (now - lastPlayAt) <= windowMs    (a move happened within the last 5 min)
 *   (now - lastReloadAt) >= intervalMs (we haven't reloaded in the last 30s)
 *
 * After `windowMs` of idle (no applied moves) it returns false, so the page
 * stops reloading once the player walks away.
 *
 * @param {object} p
 * @param {number} p.now - current time (ms epoch).
 * @param {number|null} p.lastPlayAt - time of the last applied move (ms); null/NaN → never.
 * @param {number} [p.lastReloadAt=0] - time of the last auto-reload (ms).
 * @param {number} [p.intervalMs=30000] - min gap between reloads.
 * @param {number} [p.windowMs=300000] - how long after a play we keep reloading.
 * @returns {boolean}
 */
export function autoReloadDue({ now, lastPlayAt, lastReloadAt = 0, intervalMs = 30000, windowMs = 300000 }) {
  if (!Number.isFinite(now)) return false;
  if (!Number.isFinite(lastPlayAt)) return false; // never played → never auto-reload
  if (now - lastPlayAt > windowMs) return false;  // idle past the window → stop
  if (now - lastReloadAt < intervalMs) return false; // too soon since last reload
  return true;
}

// ---------------------------------------------------------------------------
// Restore — rebuild the recorder (and thus the live state) by pure replay.
// ---------------------------------------------------------------------------

/**
 * Reconstruct a game from a (validated) save by replaying its action tape.
 *
 * Dependency-injected so this stays pure and engine-agnostic:
 *   - makeInitialState(save) -> the post-initGame state (cursor 0). The caller
 *     owns the initGame signature (map, tickets, startingTicketChoice, …).
 *   - createRecorder({ initialState, map }) -> a history.js recorder.
 *
 * The recorder is re-fed the saved actions in order, so seed + tape reproduce
 * the exact position the player left. (Saves are written on every applied
 * action, so the cursor is always at the tape end at save time; we record the
 * full tape and the recorder's cursor lands there.)
 *
 * @param {object} save - a normalized save (from deserializeGame/loadFrom).
 * @param {object} deps
 * @param {(save:object)=>object} deps.makeInitialState
 * @param {Function} deps.createRecorder
 * @param {object} deps.map
 * @returns {{ initialState:object, state:object, history:object }}
 */
export function restoreGame(save, { makeInitialState, createRecorder, map }) {
  const initialState = makeInitialState(save);
  const history = createRecorder({ initialState, map });
  for (const e of save.actions) {
    history.record(e.action, { by: e.by, isAI: e.isAI });
  }
  return { initialState, state: history.state(), history };
}
