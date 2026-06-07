// Unit tests for the undo/redo recorder/player (src/ui/history.js).
//
// The recorder is a pure tape over the engine: actions are recorded; any past
// state is a REPLAY of an action prefix; undo/redo just move the playhead.
// These tests pin the crux behaviours:
//   - prefix-replay determinism (same prefix => byte-identical state)
//   - undoTarget skips AI actions back to the previous human action
//   - redoTarget advances to the next human decision point (or the tape end)
//   - a new action recorded mid-tape BRANCHES (truncate at cursor + append)
//   - state after undo deep-equals the state that existed at that cursor

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createRecorder,
  replay,
  undoTarget,
  redoTarget,
} from '../src/ui/history.js';
import { applyActions } from '../src/engine/game.js';
import { initGame } from '../src/engine/state.js';
import { drawDeck } from '../src/engine/actions.js';

// ---- Small inline fixture map (never the real map.js for unit tests) ----
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

// A deterministic game that opens directly in 'play' (no starting-ticket choice)
// so the test controls the action sequence outright.
function freshGame(seed = 7) {
  return initGame({
    map: FIXTURE,
    tickets: FIXTURE.tickets,
    playerConfigs: [{ name: 'P0' }, { name: 'P1' }],
    seed,
  });
}

// ---------------------------------------------------------------------------
// Pure target helpers — operate on the entries tape + cursor alone.
// ---------------------------------------------------------------------------

// A hand-built tape: P0 (human) acts twice, then P1 (AI) acts twice, then back
// to a human decision point. Indices: 0:H 1:H 2:AI 3:AI.
const TAPE = [
  { isAI: false }, // 0  human action
  { isAI: false }, // 1  human action
  { isAI: true },  // 2  AI action
  { isAI: true },  // 3  AI action
];

test('undoTarget skips AI actions back to the previous human action', () => {
  // From the end, undo skips the two AI actions and lands on the last human one.
  assert.equal(undoTarget(4, TAPE), 1);
  // Stepping back again finds the earlier human action.
  assert.equal(undoTarget(1, TAPE), 0);
  // Nothing human left before cursor 0.
  assert.equal(undoTarget(0, TAPE), null);
});

test('redoTarget advances to the next human decision point (or the tape end)', () => {
  // From cursor 0, the next human action after 0 is at index 1.
  assert.equal(redoTarget(0, TAPE), 1);
  // From cursor 1, no further human action exists, so redo replays the whole
  // remaining tape (the two trailing AI actions) — target is the tape length.
  assert.equal(redoTarget(1, TAPE), 4);
  // At the end there is nothing to redo.
  assert.equal(redoTarget(4, TAPE), null);
});

test('undo/redo are inverse over a human-then-AI segment', () => {
  // A full segment: undo from the end -> previous human; redo -> back to the end.
  const afterUndo = undoTarget(4, TAPE);      // 1
  assert.equal(redoTarget(afterUndo, TAPE), 4);
});

// ---------------------------------------------------------------------------
// Replay determinism — the same prefix always yields the same state.
// ---------------------------------------------------------------------------

test('prefix replay is deterministic (same prefix => deep-equal state)', () => {
  const initial = freshGame();
  const entries = [
    { action: drawDeck(), by: 0, isAI: false },
    { action: drawDeck(), by: 0, isAI: false },
    { action: drawDeck(), by: 1, isAI: true },
  ];
  for (let count = 0; count <= entries.length; count++) {
    const a = replay(initial, entries, FIXTURE, count);
    const b = replay(initial, entries, FIXTURE, count);
    assert.deepStrictEqual(a, b, `replay(${count}) must be deterministic`);
    // And equal to a direct reduce over the same prefix (no hidden state).
    const direct = applyActions(initial, entries.slice(0, count).map((e) => e.action), FIXTURE);
    assert.deepStrictEqual(a, direct, `replay(${count}) == applyActions prefix`);
  }
});

test('replay never mutates the initial state', () => {
  const initial = freshGame();
  const snapshot = structuredClone(initial);
  const entries = [
    { action: drawDeck(), by: 0, isAI: false },
    { action: drawDeck(), by: 0, isAI: false },
  ];
  replay(initial, entries, FIXTURE, entries.length);
  assert.deepStrictEqual(initial, snapshot, 'initial state untouched after replay');
});

// ---------------------------------------------------------------------------
// Recorder — record / undo / redo over the real engine.
// ---------------------------------------------------------------------------

test('state after undo deep-equals the state that existed at that cursor', () => {
  const initial = freshGame();
  const rec = createRecorder({ initialState: initial, map: FIXTURE });

  // P0 (human) draws once → snapshot this exact cursor.
  rec.record(drawDeck(), { by: 0, isAI: false });
  const atCursor1 = rec.state();

  // P0 draws a 2nd card (ends the turn), then P1 (AI) takes two draws.
  rec.record(drawDeck(), { by: 0, isAI: false });
  rec.record(drawDeck(), { by: 1, isAI: true });
  rec.record(drawDeck(), { by: 1, isAI: true });
  assert.equal(rec.getCursor(), 4);

  // Undo skips the AI draws and the human's 2nd draw, landing back at cursor 1.
  const undone = rec.undo();
  assert.equal(rec.getCursor(), 1);
  assert.deepStrictEqual(undone, atCursor1, 'undo replays the exact prior state');

  // Undo again → all the way back to the initial (cursor 0) state.
  const undone2 = rec.undo();
  assert.equal(rec.getCursor(), 0);
  assert.deepStrictEqual(undone2, initial, 'second undo returns to the initial state');
  assert.equal(rec.canUndo(), false, 'nothing left to undo at cursor 0');
});

test('redo fast-forwards through the recorded tape', () => {
  const initial = freshGame();
  const rec = createRecorder({ initialState: initial, map: FIXTURE });
  rec.record(drawDeck(), { by: 0, isAI: false });
  rec.record(drawDeck(), { by: 0, isAI: false });
  rec.record(drawDeck(), { by: 1, isAI: true });
  rec.record(drawDeck(), { by: 1, isAI: true });
  const atEnd = rec.state();

  rec.undo();                 // back to cursor 1
  assert.equal(rec.canRedo(), true);
  const redone = rec.redo();  // no further human action → replay to the tape end
  assert.equal(rec.getCursor(), 4);
  assert.deepStrictEqual(redone, atEnd, 'redo restores the full recorded state');
  assert.equal(rec.canRedo(), false, 'nothing left to redo at the tape end');
});

test('a new action recorded mid-tape branches (truncate at cursor + append)', () => {
  const initial = freshGame();
  const rec = createRecorder({ initialState: initial, map: FIXTURE });
  rec.record(drawDeck(), { by: 0, isAI: false });
  rec.record(drawDeck(), { by: 0, isAI: false });
  rec.record(drawDeck(), { by: 1, isAI: true });
  rec.record(drawDeck(), { by: 1, isAI: true });
  assert.equal(rec.getEntries().length, 4);

  // Rewind to cursor 1, then make a NEW move: the future is discarded.
  rec.undo();
  assert.equal(rec.getCursor(), 1);
  const branchAction = drawDeck();
  rec.record(branchAction, { by: 0, isAI: false });

  const tape = rec.getEntries();
  assert.equal(tape.length, 2, 'tape truncated at the cursor before appending');
  assert.equal(tape[1].action, branchAction, 'the new action is appended at the cursor');
  assert.equal(rec.getCursor(), 2);
  assert.equal(rec.canRedo(), false, 'a branch has no recorded future');
});

test('undo returns null (and is a no-op) when there is no human action to rewind', () => {
  const initial = freshGame();
  const rec = createRecorder({ initialState: initial, map: FIXTURE });
  assert.equal(rec.canUndo(), false);
  assert.equal(rec.undo(), null);
  assert.equal(rec.canRedo(), false);
  assert.equal(rec.redo(), null);

  // A tape of ONLY AI actions still has nothing human to undo to.
  rec.record(drawDeck(), { by: 0, isAI: true });
  assert.equal(rec.canUndo(), false, 'AI-only tape has no human decision point');
  assert.equal(rec.undo(), null);
});
