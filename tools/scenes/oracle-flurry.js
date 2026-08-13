// FLURRY (ac 2, dc.type 99) — against knight-research/traces/flurry.csv,
// recorded with `tools/oracle-run.sh 1 3 flurry frames=600`.
//
// This scene pins the attack's CADENCE and the handoff to the organism:
// obj_roaringknight_boxsplitter_attack's spawn timer, its shortening
// spawn_speed, slash_count, local_turntimer, the live splitslash population,
// and obj_knight_split_growtangle's con/timer as it is driven by each cut.
//
// TWO RECORDED INPUTS, both documented deviations rather than translations:
//
// 1. PER-SLASH JITTER. Each splitslash draws `angleoffset = random_range(-12,
//    12)` and an axis offset, and at the cut it creates 16 obj_afterimage
//    debris that burn roughly four draws each plus a random(4) for the sound
//    pitch. Reproducing the stream would mean translating the debris — pure
//    cosmetics — so the recorded values are replayed instead. Everything
//    around them is verified normally. Same pattern as rotatingslash's fan
//    angles.
//
// 2. THE HIT AT FRAME 44. The slash's contact test is `scr_precise_hit(3)`,
//    which is NOT the mask-vs-mask overlap the engine implements: it is
//    `collision_rectangle` of a 3x3 box centred on (heart.x + 10, heart.y +
//    10) against the slash's precise mask. That primitive does not exist in
//    sim/masks.js yet, and spr_rk_quickslash's mask is not in sim/data. So
//    the hit is REPLAYED at its recorded frame rather than computed — which
//    is what makes the cadence check meaningful, because a connecting slash
//    feeds back into the manager (`timer -= 5`, `local_turntimer += 5`) and
//    the gap between slashes 1 and 2 is 52 frames instead of 47 because of it.
//
//    What this scene therefore does NOT verify: that the slash hits when it
//    should. Nothing here should be read as evidence about the hit window.

import { spawn } from '../../sim/entity.js';
import { soul } from '../../sim/soul.js';
import { battlebox, settleBox } from '../../sim/battlebox.js';
import { boxsplitterAttack } from '../../sim/attacks/boxsplitter-attack.js';

// Oracle frame the manager is created on. Its first Step is the frame after.
export const MANAGER_FRAME = 13;

// Frames 13..330 cover the whole turn: eight cuts and the wind-down. The
// recording continues past 330 into a second turn, which this scene does not
// model.
export const FLURRY_WINDOW = { from: 13, to: 330 };

// Recorded from traces/flurry.csv at each slash's timer == 1. `vertical` is 0
// for every one because difficulty 0 forces `vertical = force_oneside`, and
// force_oneside came out 0 in this recording.
export const SLASH_PARAMS = [
  { angleoffset: -7.6076513696, xoffset: 0, yoffset: -1.044937484 },
  { angleoffset: 1.6822215412, xoffset: 0, yoffset: 0.5797125176 },
  { angleoffset: -10.5077414755, xoffset: 0, yoffset: -7.707380563 },
  { angleoffset: 11.3408513032, xoffset: 0, yoffset: -15.4386446178 },
  { angleoffset: 4.29655068, xoffset: 0, yoffset: 1.1393650919 },
  { angleoffset: 1.8562225699, xoffset: 0, yoffset: 2.6596869007 },
  { angleoffset: 7.2734510042, xoffset: 0, yoffset: -4.653408289 },
  { angleoffset: 2.4350509811, xoffset: 0, yoffset: -0.2055310383 },
];

export const FLIP_TABLE = [-1, 1, 1, -1, -1, 1, -1, -1];

/** The single frame a slash connected in the recording. See note 2 above. */
export const HIT_FRAMES = [44];

export const ORACLE_FLURRY_INPUT = [{ from: 0 }];

/** Creates the manager on MANAGER_FRAME so its first Step lands the frame
 *  after, exactly as the recording shows. */
const spawner = {
  name: 'flurry_spawner',
  create(e) {
    e.done = false;
  },
  endStep(e, state) {
    if (e.done) return;
    if (state.frame === MANAGER_FRAME) {
      const mg = spawn(state, boxsplitterAttack, { x: 320, y: 170 });
      // obj_dbulletcontroller type 99 sets this from dc.difficulty, which the
      // knight sets from its own `difficulty` — 0 for phase 1 turn 3.
      mg.difficulty = 0;
      mg.force_oneside = 0; // recorded; irandom(1) in Create
      e.done = true;
    }
  },
};

export function buildOracleFlurryScene(state) {
  settleBox(spawn(state, battlebox, { x: 320, y: 170 }));
  state.soul = spawn(state, soul, { x: 310, y: 160 });
  spawn(state, spawner, {});

  state.slashParams = SLASH_PARAMS;
  state.slashIndex = 0;
  state.flipTable = FLIP_TABLE;
  state.flipIndex = 0;
}
