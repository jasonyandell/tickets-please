// Unit tests for save/restore (src/ui/persist.js).
//
// Persistence rides on the deterministic engine: the save is the recorded action
// tape (seed + actions), NOT a state snapshot. So the tests pin:
//   - serialize -> JSON -> deserialize round-trips losslessly
//   - restoreGame replays {seed, actions, cursor} to a state deep-equal to the
//     live recorder's state (the proof that "refresh = same game, same point")
//   - corrupt / missing / foreign-version saves deserialize to null (fresh game)
//   - the localStorage glue (saveTo/loadFrom/clearSave) tolerates a fake store
//     and never throws

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SAVE_KEY,
  serializeGame,
  deserializeGame,
  restoreGame,
  saveTo,
  loadFrom,
  clearSave,
  autoReloadDue,
} from '../src/ui/persist.js';
import { createRecorder } from '../src/ui/history.js';
import { initGame } from '../src/engine/state.js';
import { drawDeck } from '../src/engine/actions.js';

// ---- Inline fixture map (mirrors history.test.js — never the real map.js) ----
const FIXTURE = {
  cities: [
    { id: 'A', name: 'A', x: 0, y: 0 },
    { id: 'B', name: 'B', x: 1, y: 0 },
    { id: 'C', name: 'C', x: 2, y: 0 },
    { id: 'D', name: 'D', x: 3, y: 0 },
  ],
  routes: [
    { id: 'ab', a: 'A', b: 'B', length: 2, color: 'red' },
    { id: 'bc', a: 'B', b: 'C', length: 1, color: 'gray' },
    { id: 'cd', a: 'C', b: 'D', length: 6, color: 'blue' },
  ],
  tickets: [
    { id: 't-ad', from: 'A', to: 'D', points: 10 },
    { id: 't-ab', from: 'A', to: 'B', points: 3 },
    { id: 't-bc', from: 'B', to: 'C', points: 2 },
  ],
};

const PLAYER_CONFIGS = [{ name: 'P0', isAI: false }, { name: 'P1', isAI: true }];

function makeInitialState(save) {
  return initGame({
    map: FIXTURE,
    tickets: FIXTURE.tickets,
    playerConfigs: save.playerConfigs,
    seed: save.seed,
  });
}

// Build a live game + recorder with a few applied actions, then return the parts
// a save is made from plus the live state for comparison.
function liveGame(seed = 7) {
  const initialState = makeInitialState({ seed, playerConfigs: PLAYER_CONFIGS });
  const rec = createRecorder({ initialState, map: FIXTURE });
  rec.record(drawDeck(), { by: 0, isAI: false });
  rec.record(drawDeck(), { by: 0, isAI: false });
  rec.record(drawDeck(), { by: 1, isAI: true });
  return { rec, liveState: rec.state(), seed };
}

// ---------------------------------------------------------------------------
// serialize <-> deserialize round-trip
// ---------------------------------------------------------------------------

test('serialize -> JSON -> deserialize round-trips losslessly', () => {
  const { rec, seed } = liveGame();
  const save = serializeGame({
    seed,
    playerConfigs: PLAYER_CONFIGS,
    entries: rec.getEntries(),
    cursor: rec.getCursor(),
  });

  const roundTripped = deserializeGame(JSON.parse(JSON.stringify(save)));
  assert.deepStrictEqual(roundTripped, save, 'JSON round-trip preserves the save');
  assert.equal(save.version, 1);
  assert.equal(save.seed, seed);
  assert.equal(save.actions.length, 3);
  assert.equal(save.cursor, 3);
});

// ---------------------------------------------------------------------------
// restore = replay to a deep-equal state (the heart of the feature)
// ---------------------------------------------------------------------------

test('restoreGame replays {seed,actions,cursor} to the original state', () => {
  const { rec, liveState, seed } = liveGame();
  const save = serializeGame({
    seed,
    playerConfigs: PLAYER_CONFIGS,
    entries: rec.getEntries(),
    cursor: rec.getCursor(),
  });

  // Simulate a reload: only the JSON string survives.
  const fromDisk = deserializeGame(JSON.stringify(save));
  const { state, history } = restoreGame(fromDisk, {
    makeInitialState,
    createRecorder,
    map: FIXTURE,
  });

  assert.deepStrictEqual(state, liveState, 'restored state deep-equals the original');
  assert.equal(history.getCursor(), rec.getCursor(), 'playhead lands where it was');
  // The rebuilt recorder is fully live — undo/redo work as if uninterrupted.
  assert.equal(history.canUndo(), rec.canUndo());
  assert.deepStrictEqual(history.getEntries().map((e) => e.action), rec.getEntries().map((e) => e.action));
});

test('a different seed restores to a different game', () => {
  const a = liveGame(7);
  const b = liveGame(99);
  // Same action tape, different seed → different dealt state.
  assert.notDeepStrictEqual(a.liveState, b.liveState, 'seeds must diverge for this test to mean anything');

  const restoredA = restoreGame(
    deserializeGame(JSON.stringify(serializeGame({
      seed: 7, playerConfigs: PLAYER_CONFIGS, entries: a.rec.getEntries(), cursor: a.rec.getCursor(),
    }))),
    { makeInitialState, createRecorder, map: FIXTURE },
  );
  assert.deepStrictEqual(restoredA.state, a.liveState);
});

// ---------------------------------------------------------------------------
// corrupt / missing / foreign saves → null (caller falls back to a fresh game)
// ---------------------------------------------------------------------------

test('corrupt / missing / foreign saves deserialize to null', () => {
  assert.equal(deserializeGame(null), null, 'missing');
  assert.equal(deserializeGame('not json {{{'), null, 'unparseable');
  assert.equal(deserializeGame('"a string"'), null, 'not an object');
  assert.equal(deserializeGame(JSON.stringify({ version: 999, seed: 1, playerConfigs: PLAYER_CONFIGS, actions: [] })), null, 'wrong version');
  assert.equal(deserializeGame(JSON.stringify({ version: 1, playerConfigs: PLAYER_CONFIGS, actions: [] })), null, 'no seed');
  assert.equal(deserializeGame(JSON.stringify({ version: 1, seed: 1, playerConfigs: [{ name: 'solo' }], actions: [] })), null, 'too few players');
  assert.equal(deserializeGame(JSON.stringify({ version: 1, seed: 1, playerConfigs: PLAYER_CONFIGS, actions: [{ action: { nope: true } }] })), null, 'untyped action');
  // A valid empty-tape save (brand-new game) IS restorable.
  const fresh = deserializeGame(JSON.stringify({ version: 1, seed: 5, playerConfigs: PLAYER_CONFIGS, actions: [] }));
  assert.ok(fresh && fresh.actions.length === 0, 'an empty tape is a valid (just-dealt) save');
});

// ---------------------------------------------------------------------------
// localStorage glue — a fake Storage; the real one can throw (private mode/quota)
// ---------------------------------------------------------------------------

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

test('saveTo / loadFrom / clearSave round-trip through a Storage', () => {
  const store = fakeStorage();
  const { rec, liveState, seed } = liveGame();
  const save = serializeGame({ seed, playerConfigs: PLAYER_CONFIGS, entries: rec.getEntries(), cursor: rec.getCursor() });

  assert.equal(loadFrom(store), null, 'nothing saved yet');
  assert.equal(saveTo(store, save), true);
  assert.equal(store.getItem(SAVE_KEY) != null, true, 'persisted under the versioned key');

  const loaded = loadFrom(store);
  const { state } = restoreGame(loaded, { makeInitialState, createRecorder, map: FIXTURE });
  assert.deepStrictEqual(state, liveState, 'loaded save restores the live state');

  clearSave(store);
  assert.equal(loadFrom(store), null, 'cleared');
});

test('the storage glue never throws on a hostile Storage', () => {
  const hostile = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('quota'); },
    removeItem() { throw new Error('blocked'); },
  };
  assert.equal(saveTo(hostile, { any: 'thing' }), false);
  assert.equal(loadFrom(hostile), null);
  assert.doesNotThrow(() => clearSave(hostile));
  // A null storage (SSR / no window) is also tolerated.
  assert.equal(saveTo(null, {}), false);
  assert.equal(loadFrom(null), null);
  assert.doesNotThrow(() => clearSave(null));
});

// ---------------------------------------------------------------------------
// autoReloadDue — the pure, clock-injected auto-reload policy. No fake timers,
// no waits: every case passes explicit timestamps. (Driver lives in main.js.)
// ---------------------------------------------------------------------------

test('autoReloadDue: in-window AND interval elapsed → true', () => {
  // played 10s ago (inside the 5-min window), last reload 40s ago (>30s gap).
  assert.equal(
    autoReloadDue({ now: 100_000, lastPlayAt: 90_000, lastReloadAt: 60_000 }),
    true,
  );
});

test('autoReloadDue: past the 5-min window → false (player walked away)', () => {
  // last play 6 min ago; even though the interval has elapsed, we stop.
  assert.equal(
    autoReloadDue({ now: 400_000, lastPlayAt: 400_000 - 360_000, lastReloadAt: 0 }),
    false,
  );
});

test('autoReloadDue: interval not elapsed → false', () => {
  // played recently, but only 10s since the last reload (<30s).
  assert.equal(
    autoReloadDue({ now: 100_000, lastPlayAt: 95_000, lastReloadAt: 90_000 }),
    false,
  );
});

test('autoReloadDue: window boundary is inclusive, just past it is not', () => {
  const windowMs = 300_000, intervalMs = 30_000, now = 1_000_000, lastReloadAt = 0;
  // exactly at the window edge → still due
  assert.equal(
    autoReloadDue({ now, lastPlayAt: now - windowMs, lastReloadAt, intervalMs, windowMs }),
    true,
  );
  // 1ms past the edge → not due
  assert.equal(
    autoReloadDue({ now, lastPlayAt: now - windowMs - 1, lastReloadAt, intervalMs, windowMs }),
    false,
  );
});

test('autoReloadDue: interval boundary is inclusive, just under it is not', () => {
  const intervalMs = 30_000, now = 500_000, lastPlayAt = now - 1_000;
  // exactly one interval since the last reload → due
  assert.equal(
    autoReloadDue({ now, lastPlayAt, lastReloadAt: now - intervalMs, intervalMs }),
    true,
  );
  // 1ms short of the interval → not due
  assert.equal(
    autoReloadDue({ now, lastPlayAt, lastReloadAt: now - intervalMs + 1, intervalMs }),
    false,
  );
});

test('autoReloadDue: never played (null/NaN lastPlayAt) or bad now → false', () => {
  assert.equal(autoReloadDue({ now: 100_000, lastPlayAt: null }), false);
  assert.equal(autoReloadDue({ now: 100_000, lastPlayAt: NaN }), false);
  assert.equal(autoReloadDue({ now: NaN, lastPlayAt: 100_000 }), false);
  // first-ever tick after a fresh play (lastReloadAt defaults to 0) → due once
  assert.equal(autoReloadDue({ now: 100_000, lastPlayAt: 95_000 }), true);
});
