// obj_knight_roaring_star's lifecycle — against
// knight-research/traces/roaring2.csv (phase 4 turn 3, 900 frames).
//
// A focused scene: one star, reproduced from its recorded state at the moment
// the controller releases it (con 1), and run to destruction. That isolates
// the bullet from obj_knight_roaring2, whose Step is a 596-line timeline and
// is not translated.
//
// The star chosen is the longest-lived one in the recording that completes its
// arc:
//
//   f578  spawned, drifting inward
//   f654  con 1 — released; friction 0.5 brakes it
//   f655  con 2 — gravity 0.1 along `direction - 180`, so it reverses and
//         accelerates back the way it came
//   f695  con 3 — grows, bursts into six starchildren, destroyed at timer 4
//
// A 400-frame recording was not enough to see any of this: roaring's intro
// alone runs about 136 frames and no star reached con 3 at all. Hence 900.
//
// WHY THIS ONE IS A GOOD TEST OF THE BOUNDS. At release the star sits at
// x = -98.99 with the camera at 0 — 99 pixels off the left edge — and it
// survives, because `sprite_width / 2` at image_xscale 1.6 is 102.4. With the
// constant margin the Stars attack used to have, it would be destroyed on the
// spot and nothing after this would happen.

import { spawn } from '../../sim/entity.js';
import { soul } from '../../sim/soul.js';
import { roaringStar } from '../../sim/attacks/roaring-star.js';

/** Oracle frame the recorded star is at con 1. */
export const RELEASE_FRAME = 654;

/** From the release to the frame after it is destroyed. */
export const ROARING_STAR_WINDOW = { from: 655, to: 700 };

/** Measured at frame 654. */
export const STAR_STATE = {
  x: -98.9998397827,
  y: 279.1411437988,
  direction: 198,
  speed: 0,
  gravity: 0,
  gravity_direction: 270,
  friction: 0.5,
  image_xscale: 1.6,
  image_yscale: 1.6,
  con: 1,
  timer: 0,
  // MEASURED, and load-bearing: by frame 654 this star has been on screen, so
  // `outbound` is already true and the offscreen cull is live. Leaving it false
  // — as an earlier version of this scene did — makes the cull unreachable and
  // silently removes it from the test: sabotaging the bound back to a constant
  // 12 then still PASSED.
  outbound: true,
};

export const ORACLE_ROARING_STAR_INPUT = [{ from: 0 }];

export function buildOracleRoaringStarScene(state) {
  state.view = { x: 0, y: 0 };
  state.turntimer = 999;

  // Roaring expands the arena to the whole screen; the soul is present only so
  // the starchildren have something to exist alongside. Nothing here reads it.
  state.soul = spawn(state, soul, { x: 320, y: 240 });

  const spawner = {
    name: 'roaring_star_spawner',
    create(e) {
      e.done = false;
    },
    endStep(e, st) {
      if (e.done || st.frame !== RELEASE_FRAME) return;
      const s = spawn(st, roaringStar, { x: STAR_STATE.x, y: STAR_STATE.y });
      Object.assign(s, STAR_STATE);
      e.done = true;
    },
  };
  spawn(state, spawner, {});
}
