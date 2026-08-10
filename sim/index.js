// Public surface of sim/.
//
// Rule: nothing in this directory touches the DOM, a canvas, a timer, the
// keyboard, or the filesystem. It is a pure function of (state, input) that
// advances exactly one frame. That is what makes verification a plain Node
// script instead of a browser session with a human watching.

import { runPhase, runAlarms, reap } from './entity.js';
import { traceRow } from './trace.js';

export { createState } from './state.js';
export { spawn, destroy, ALARM_COUNT } from './entity.js';
export { traceHeader, traceRow, real, int } from './trace.js';
export { createRng, rngNext, rngRandom, rngIrandom, rngRange, rngChoose, rngSnapshot, rngRestore } from './rng.js';
export { FPS, MS_PER_FRAME, drain } from './clock.js';

/**
 * Phase order for one frame. Rule 5 — this is the whole point of the module.
 *
 * GameMaker's order is Begin Step, then Alarms, then Step, then Collision
 * events, then End Step. Collapsing any two of these, or turning an alarm
 * into a countdown checked inside Step, moves behaviour by exactly one frame.
 *
 * Concretely: `scr_heartclamp` is called from obj_roaringknight_slash's End
 * Step, after obj_heart's Step has already moved and collision-resolved the
 * soul. Run the clamp in Step and the soul sits somewhere else for a frame.
 * And a bullet hit registers in the heart's Collision event (which just does
 * `with (other) event_user(5)`) — after the move, before the clamp.
 */
export const PHASES = ['beginStep', 'alarm', 'step', 'motion', 'collision', 'endStep'];

/**
 * GameMaker's built-in motion, applied between the Step event and Collision
 * events (the manual's documented order: "normal step — instances are
 * moved"). Entities opt in with `builtinMotion: true` and plain `speed` /
 * `direction` fields (degrees, CCW on screen).
 *
 * Envelope: translated code only ever assigns speed and direction — no
 * direct hspeed/vspeed writes, no friction, no gravity. Extend when an
 * attack needs them, against an oracle trace.
 *
 * FLOAT32: every built-in field narrows on store (entity.js F32_BUILTINS,
 * measured by oracle_f32_probe). Arithmetic here is f64; the narrowing
 * happens in the field setter.
 */
function runMotion(state) {
  state.eventPhase = 'motion';
  for (const e of state.entities) {
    if (!e.alive || !e.builtinMotion || !e.speed) continue;
    const r = (e.direction * Math.PI) / 180;
    state.counters.motionSteps += 1;
    // No explicit fround: x/y are f32-narrowing accessors (see entity.js
    // F32_BUILTINS). Narrowing is structural so no call site can forget.
    e.x = e.x + e.speed * Math.cos(r);
    e.y = e.y - e.speed * Math.sin(r);
  }
}

/**
 * The heart's Collision_obj_collidebullet event, generalised: for each live
 * bullet whose mask is still on, an overlap with the soul's mask fires the
 * bullet's User Event 5 (`other15`). Bullets opt in via isBullet + a mask.
 */
function runCollisions(state) {
  state.eventPhase = 'collision';
  const heart = state.soul;
  if (!heart || !heart.alive) return;

  for (const b of [...state.entities].sort((a, z) => a.seq - z.seq)) {
    if (!b.alive || !b.isBullet || !b.type.other15) continue;
    if (b.maskOff) continue; // mask_index = spr_nomask
    const collides = b.type.collides;
    if (collides) {
      state.counters.collisionChecks += 1;
      if (collides(b, heart, state)) {
        state.counters.collisionHits += 1;
        b.type.other15(b, state);
      }
    }
  }
}

/**
 * Advance exactly one frame.
 *
 * @param {object} state  mutated in place and returned
 * @param {object} input  this frame's input state; sim never polls for it
 */
export function stepFrame(state, input) {
  state.input = input;

  runPhase(state, 'beginStep');
  runAlarms(state);
  runPhase(state, 'step');
  runMotion(state);
  runCollisions(state);
  runPhase(state, 'endStep');

  // Destroyed entities disappear before the row is written, matching GML
  // instance_destroy() taking effect immediately.
  reap(state);

  state.trace.push(traceRow(state));
  state.frame += 1;

  return state;
}

/** Run `frames` frames, pulling input from `inputAt(frame)`. */
export function runFrames(state, frames, inputAt) {
  for (let i = 0; i < frames; i++) {
    stepFrame(state, inputAt(state.frame));
  }
  return state;
}
