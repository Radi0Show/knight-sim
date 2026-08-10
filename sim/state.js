// The simulation state object.
//
// MUTATION, deliberate. `stepFrame` mutates this object in place and returns
// it, rather than building a fresh state each frame. Two reasons: GML semantics
// are mutation, so a translated Step event reads the same on both sides and
// diffs by eye; and deep-cloning every entity 30 times a second buys nothing
// when the only consumer that must not write to state is render/, which is
// enforced by review rather than by the type system.
//
// The consequence to respect: never hold a reference to state across frames
// expecting a snapshot. If you need one, serialise it.

import { createRng } from './rng.js';

export function createState({ seed, traceBulletSlots = 0 } = {}) {
  if (!Number.isInteger(seed)) {
    throw new Error(`seed must be an integer, got ${seed}`);
  }

  return {
    // Index of the frame about to run. Incremented at the end of stepFrame,
    // after the trace row is emitted, so row N describes frame N.
    frame: 0,

    seed,
    rng: createRng(seed),

    entities: [],
    nextSpawnSeq: 0,

    // Convenience handles the trace reads directly.
    soul: null,
    hp: 0,
    invTimer: 0,

    // GML globals the translated code reads. Named for what they are, with the
    // original in a comment so a grep of the dump still finds the connection.
    view: { x: 0, y: 0 }, // __view_get(e__VW.XView/YView, 0)
    flag22: 0, // global.flag[22] — when set, focus-slow is disabled entirely
    sp: 4, // global.sp — base soul speed
    heartx: 0, // global.heartx
    hearty: 0, // global.hearty

    // Battle phase — which part of the fight is running. This is the `phase`
    // column in the trace. Scenes own it; the skeleton never writes it.
    phase: 'none',

    // Which GameMaker event phase is executing right now. Diagnostic only,
    // deliberately NOT in the trace: it is always 'endStep' by the time a row
    // is written, so it would be a constant column. Useful when a handler
    // throws and you need to know where you were.
    eventPhase: 'init',

    // Current frame's input, set by stepFrame.
    input: null,

    traceBulletSlots,
    trace: [],
  };
}
