// ROTATING SLASH at difficulties 1 and 2 — the phase 2 and phase 3 variants
// (turns 10 and 15). Against knight-research/traces/rotating_d1.csv and
// rotating_d2.csv, recorded with `tools/oracle-run.sh 2 5` and `3 5`.
//
// WHY THIS MATTERS beyond one more suite: the fight is five turns per phase
// reusing seven attacks, so most of what is left is DIFFICULTY VARIANTS rather
// than new objects (CLAUDE.md, THE REAL FIGHT). This is the first of them, and
// the pattern it establishes — record the same ac at each phase, verify the
// state machine, replay only the dice — is what the rest should follow.
//
// The difficulty branches were already translated from the GML and never
// exercised. Both turn out to be right, and the cut counts match the observed
// fight exactly:
//
//   difficulty 0   slash_number 1, array [1,2,2,3,3,4]  ->  1-2-2-3-3-4
//   difficulty 1   slash_number 3, array [2,3,4,4,4,4]  ->  3-3-4-4-4-4
//   difficulty 2   slash_number 3, array [3,4,4,4,4,4]  ->  3-4-4-4-4-4
//
// (The array's first element is never read: `slash_counter` is incremented
// before the lookup, so the opening count comes from `slash_number` and the
// array supplies the five after it. That is why [2,...] yields a 3.)
//
// WHAT THIS VERIFIES: the state machine — state, timer, slash_number,
// slash_counter, slash_base, slash_offset, aim_direction, rotation,
// local_turntimer — and the live slash population.
//
// WHAT IT DOES NOT: the fan ANGLES. `ds_list_shuffle` is unsolved (CLAUDE.md)
// so the per-cut angle order is not reproducible; verify-rotating covers the
// mechanics of a fan at difficulty 0 with a recorded order. Nothing here
// depends on the angles.
//
// REPLAYED DICE: `spin` (a `choose(-1,1)` on every aim entry) and the Create's
// `random_offset`. Both measured.

import { spawn } from '../../sim/entity.js';
import { soul } from '../../sim/soul.js';
import { battlebox, settleBox } from '../../sim/battlebox.js';
import { rotatingSlash } from '../../sim/attacks/rotating-slash.js';

export const MANAGER_FRAME = 13;

/** Six cut cycles, ending before difficulty 2's spiral finisher (see below). */
export const ROT_WINDOW = { from: 13, to: 225 };

/**
 * Difficulty 2 only: through the spiral finisher AND past the attack's own
 * destruction. It ends at 400, the last frame of the recording, because the
 * 28th slash lands at 342 and Alarm_3 does not destroy the object until 363 —
 * stopping at the last slash would have left the lifetime untested.
 */
export const SPIRAL_WINDOW = { from: 226, to: 400 };

const BOX = { x: 320, y: 170 };
const SOUL_START = { x: 310, y: 160 };

/**
 * Measured. Difficulty 2 runs a SPIRAL FINISHER after its six cuts — the
 * `aim_type 2` branch, which the observed fight describes as rapid slashes
 * centred on the box. `slash_number` drops to 1 from slash_counter 6 onward.
 * The window stops before it; that finale is not yet translated.
 */
export const ROT_VARIANTS = {
  1: { difficulty: 1, spins: [-1, 1, 1, -1, -1, 1], random_offset: 5 },
  2: { difficulty: 2, spins: [-1, 1, -1, -1, -1, 1, -1], random_offset: 5 },
};

/**
 * THE BOX TRACK — a recorded input, and the reason is the shuffle problem.
 *
 * `obj_roaringknight_slash` jitters obj_growtangle by a pixel or two every
 * time it fires, off the shared RNG stream. This scene already replays the
 * shuffled fan orders because ds_list_shuffle is unsolved (CLAUDE.md), which
 * means the stream here is not the game's, which means the jitter is not
 * either. Through frame 225 that never mattered — nothing compared depends on
 * where the box is.
 *
 * The SPIRAL depends on it. `do_final` sets `aim_x/aim_y` to the box centre,
 * ONCE, and all 28 slashes of the finale then spawn there; the knight's
 * teleport targets are box-relative too. So the box is fed from the recording
 * over the finale and everything downstream of it is computed.
 *
 * Note the read is one frame stale by construction: obj_growtangle jitters in
 * its End Step, so the rotating slash's Step sees the PREVIOUS frame's
 * position. The recorded 321 at frame 227 is what frame 228's do_final reads.
 */
export const BOX_TRACK_FROM = 220;
export const BOX_TRACK = [
  [318,168], [320,168], [320,169], [318,170], [318,170], [319,168], [320,169], [321,169],
  [321,169], [318,168], [318,168], [318,168], [318,168], [318,168], [318,168], [318,168],
  [318,168], [318,168], [318,168], [318,168], [318,168], [318,168], [318,168], [318,168],
  [318,168], [318,168], [318,168], [318,168], [318,168], [318,168], [318,168], [318,168],
  [318,168], [318,168], [318,168], [318,168], [318,168], [318,168], [322,168], [319,171],
  [321,171], [322,170], [320,170], [318,168], [320,170], [319,169], [321,171], [321,170],
  [318,172], [320,168], [320,170], [321,169], [322,172], [322,171], [320,169], [320,169],
  [321,168], [319,170], [319,172], [322,171], [318,169], [320,171], [322,169], [318,168],
  [321,169], [319,170], [322,172], [318,172], [319,171], [321,171], [321,171], [319,170],
  [318,169], [320,171], [322,168], [318,170], [320,170], [318,168], [318,170], [321,169],
  [321,169], [320,170], [321,169], [322,169], [322,168], [321,169], [322,169], [322,169],
  [320,170], [320,169], [318,170], [319,168], [319,171], [322,170], [318,170], [318,168],
  [319,170], [320,171], [320,172], [322,168], [319,169], [321,169], [318,172], [321,168],
  [322,169], [318,169], [321,168], [322,172], [318,171], [322,171], [322,168], [322,168],
  [318,169], [318,172], [319,172], [320,171], [320,169], [318,168], [321,172], [321,171],
  [318,171], [320,170], [319,171], [319,168], [320,169], [320,169], [320,169], [320,169],
  [320,169], [320,169], [320,169],
];

export const ORACLE_ROT_INPUT = [{ from: 0 }];

export function buildRotatingDifficultyScene(state, which) {
  const v = ROT_VARIANTS[which];
  if (!v) throw new Error(`no such rotating variant: ${which}`);

  state.view = { x: 0, y: 0 };
  state.turntimer = 400;

  const gt = settleBox(spawn(state, battlebox, { x: BOX.x, y: BOX.y }));

  // Drive the box from the recording once the track starts.
  //
  // beginStep, and the index is f-1, for two reasons that both have to hold:
  // beginStep runs before every Step, so no slash's own jitter can overwrite
  // it first (the slashes are created later, so in endStep they would win);
  // and the value a Step reads is the one the recorder wrote at the END of the
  // previous frame, so frame f must be fed the row recorded at f-1.
  spawn(state, {
    name: 'box_track_driver',
    beginStep(_e, st) {
      const i = st.frame - 1 - BOX_TRACK_FROM;
      if (i < 0 || i >= BOX_TRACK.length) return;
      gt.x = BOX_TRACK[i][0];
      gt.y = BOX_TRACK[i][1];
    },
  }, {});
  state.soul = spawn(state, soul, { ...SOUL_START });

  state.spinSequence = v.spins;
  state.spinIndex = 0;

  const spawner = {
    name: 'rot_spawner',
    create(e) {
      e.done = false;
    },
    endStep(e, st) {
      if (e.done || st.frame !== MANAGER_FRAME) return;
      const a = spawn(st, rotatingSlash, { x: 425, y: 77.56658 });
      a.difficulty = v.difficulty;
      a.random_offset = v.random_offset;
      a.turn_type = 'full';
      rotatingSlash.init(a, st);
      // The Create rolls `spin` too, consuming the table's first entry before
      // the aim state ever runs. The measured sequence is the AIM rolls only,
      // so rewind: the first aim entry must see the first recorded value.
      st.spinIndex = 0;
      e.done = true;
    },
  };
  spawn(state, spawner, {});
}
