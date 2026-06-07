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
