// T2 acceptance fixture. Not part of the game — this exists to prove the
// skeleton is deterministic before any real behaviour is translated into it.
//
// It deliberately exercises every mechanism that could leak nondeterminism:
//
//   constant-rate movement  -> float accumulation over many frames
//   an alarm that re-arms   -> phase ordering and alarm clear-before-fire
//   the seeded PRNG         -> stream position must be identical run to run
//   input                   -> the frame-indexed table is actually consulted
//   spawn / destroy         -> entity list churn must not perturb ordering
//
// A stub that only moved at a constant rate would pass trivially and prove
// nothing.

import { spawn, destroy } from '../../sim/entity.js';
import { rngIrandom, rngNext } from '../../sim/rng.js';

const stubSoul = {
  name: 'stub_soul',

  create(e) {
    e.x = 100;
    e.y = 100;
    e.vx = 4;
    e.vy = 0;
    e.alarm[0] = 15;
  },

  step(e, state) {
    // Rule 3: written as one expression, not split. Faithful to how a
    // translated GML line should look.
    if (state.input.right) e.x += e.vx;
    if (state.input.left) e.x -= e.vx;

    e.y += e.vy;

    // Rule 4: integer math stays integer. ceil, matching obj_heart's focus
    // halving, which is ceil and not floor.
    if (state.input.focus) {
      e.x = Math.ceil(e.x * 0.5);
    }
  },

  alarm: {
    // Re-arms itself. If alarms were collapsed into a step counter this would
    // drift by a frame and the CSV would diverge from a known-good run.
    0: (e) => {
      e.vy = e.vy === 0 ? 2 : 0;
      e.alarm[0] = 15;
    },
  },
};

const rngTicker = {
  name: 'stub_rng_ticker',

  step(e, state) {
    state.invTimer = rngIrandom(state.rng, 30);
    if (rngNext(state.rng) < 0.25) state.hp -= 1;
  },
};

const bulletChurn = {
  name: 'stub_bullet',

  create(e) {
    e.isBullet = true;
    e.life = 7;
  },

  step(e, state) {
    e.x += 1.5;
    e.y += 0.25;
    e.life -= 1;
    if (e.life <= 0) destroy(e);
  },
};

const spawner = {
  name: 'stub_spawner',

  create(e) {
    e.alarm[1] = 5;
  },

  alarm: {
    1: (e, state) => {
      spawn(state, bulletChurn, { x: 200, y: 50 + state.frame });
      e.alarm[1] = 5;
    },
  },
};

// Stands in for the real attack-phase state machine, so the trace's `phase`
// column carries something that actually changes.
const phaseController = {
  name: 'stub_phase_controller',

  beginStep(e, state) {
    if (state.frame < 100) state.phase = 'opening';
    else if (state.frame < 300) state.phase = 'sweep';
    else if (state.frame < 500) state.phase = 'burst';
    else state.phase = 'recover';
  },
};

/** Populate a fresh state with the stub scene. */
export function buildStubScene(state) {
  state.hp = 90;
  state.invTimer = 0;
  spawn(state, phaseController);
  state.soul = spawn(state, stubSoul);
  spawn(state, rngTicker);
  spawn(state, spawner);
  return state;
}
