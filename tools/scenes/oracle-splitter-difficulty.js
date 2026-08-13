// BOX SPLITTER at difficulties 1 and 3 — the phase 2 and phase 3 variants
// (turns 7 and 12). Against knight-research/traces/splitter_d1.csv and
// splitter_d3.csv, recorded with `tools/oracle-run.sh 2 2` and `3 2`.
//
// What the difficulty actually changes, all of it confirmed by the recordings:
//
//   0   spawn_speed 50, and `vertical = force_oneside` — the SAME axis every
//       cut for the whole turn.
//   1   spawn_speed 46, decaying to 40 by 3. `vertical` is the live draw, so
//       the cleave axis switches at random per cut. Also rolls `force_swap`
//       (irandom(2) + 1), which nothing in the object ever reads.
//   3   spawn_speed stays at the Create's 40 — difficulty 3 has NO branch in
//       the init block, and the decay line is gated `difficulty <= 2`. Adds
//       DIAGONAL cleaves: each cut passes the current `diagonal` to the slash
//       and then either fires (setting `timer = -4`, which stretches the next
//       gap) or rolls a new one.
//
// That matches the fight as played: "north wind" (one axis), then "north and
// east winds" (switching), then "a tempest" (switching plus diagonals).
//
// REPLAYED DICE: the per-cut `vertical`, the per-cut `diagonal` roll, and
// difficulty 1's `force_swap`. The CADENCE is not replayed — spawn_speed, its
// decay, `timer`, the `timer = -4` diagonal nudge and slash_count are all
// computed, and they are what this suite is for.
//
// Slash jitter (angleoffset/xoffset/yoffset) is NOT compared here; verify-flurry
// covers the slash itself at difficulty 0. This suite is about the manager.
//
// CONTACTS ARE COMPUTED, not replayed — `scr_precise_hit` is implemented now
// (sim/masks.js): spr_rk_quickslash's mask is a RotatedRect, so the test is a
// 3x3 box around the soul's centre against the cut's rotated, scaled bbox.
// `expectedHits` is asserted, so a regression that stops landing the
// difficulty-3 contact — or starts landing one at difficulty 1 — fails.
//
// A slash that connects reaches back into the manager with
// `timer -= 5; local_turntimer += 5`, so a hit visibly shifts the cadence —
// difficulty 3's recording takes one at frame 44 and its `timer` reads 25
// where an untouched run would read 30. As in verify-flurry, the contact is
// replayed at its recorded frame rather than computed: the slash's own test is
// `scr_precise_hit`, which sim/masks.js does not implement. Difficulty 1's
// recording happens to take no hits inside the window.

import { spawn } from '../../sim/entity.js';
import { soul } from '../../sim/soul.js';
import { battlebox, settleBox } from '../../sim/battlebox.js';
import { boxsplitterAttack } from '../../sim/attacks/boxsplitter-attack.js';

export const MANAGER_FRAME = 13;

/** Eight cuts. Ends before the wind-down at local_turntimer <= 30. */
export const SPLIT_WINDOW = { from: 13, to: 330 };

const BOX = { x: 320, y: 170 };
const SOUL_START = { x: 310, y: 160 };

/** Measured, in cut order. */
export const SPLIT_VARIANTS = {
  1: {
    difficulty: 1,
    initVertical: 0,
    force_swap: 3,
    verticals: [0, 0, 0, 0, 1, 1, 0, 0, 0, 0],
    diagonals: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    slashParams: [
      { angleoffset: 0.6413067486, xoffset: 0, yoffset: 5.5430523753 },
      { angleoffset: -10.1224042643, xoffset: 0, yoffset: 6.7059603631 },
      { angleoffset: -5.7560565826, xoffset: 0, yoffset: -13.2339337245 },
      { angleoffset: 0.268997658, xoffset: 0, yoffset: -10.6778928265 },
      { angleoffset: 10.995634513, xoffset: -11.6446231604, yoffset: 0 },
      { angleoffset: -11.3294898123, xoffset: 11.8584930152, yoffset: 0 },
      { angleoffset: 8.540818613, xoffset: 0, yoffset: -1.4076478258 },
      { angleoffset: -5.3656847589, xoffset: 0, yoffset: -11.2145577297 },
    ],
    hitFrames: [],
  },
  3: {
    difficulty: 3,
    initVertical: 1,
    force_swap: -1,
    verticals: [1, 1, 0, 1, 1, 1, 0, 0, 0, 0],
    diagonals: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0],
    slashParams: [
      { angleoffset: 0.6413067486, xoffset: 5.5430523753, yoffset: 0 },
      { angleoffset: 4.7028308026, xoffset: 3.1176965591, yoffset: -1.0005725157 },
      { angleoffset: 9.2248649653, xoffset: 0, yoffset: -1.0472592115 },
      { angleoffset: 3.4935440719, xoffset: -3.9672349989, yoffset: 0 },
      { angleoffset: -9.7658860199, xoffset: -9.123679705, yoffset: 0 },
      { angleoffset: 7.5430625863, xoffset: 9.2837699428, yoffset: 0 },
      { angleoffset: 8.2081133053, xoffset: 0, yoffset: -12.592412442 },
      { angleoffset: 4.1417126209, xoffset: -3.269625837, yoffset: -1.8549327981 },
    ],
    hitFrames: [44],
  },
};

export const ORACLE_SPLIT_INPUT = [{ from: 0 }];

export function buildSplitterDifficultyScene(state, which) {
  const v = SPLIT_VARIANTS[which];
  if (!v) throw new Error(`no such splitter variant: ${which}`);

  state.view = { x: 0, y: 0 };
  state.turntimer = 400;

  settleBox(spawn(state, battlebox, { x: BOX.x, y: BOX.y }));
  state.soul = spawn(state, soul, { ...SOUL_START });

  // See the header: contacts are replayed here, so the computed test is off.
  state.replayContacts = true;

  state.splitterVerticals = v.verticals;
  state.splitterVIndex = 0;
  state.splitterDiagonals = v.diagonals;
  state.splitterDIndex = 0;

  // THE PER-CUT JITTER MUST BE REPLAYED now that contacts are COMPUTED rather
  // than fed in. It decides where each cut actually lands, so with it left to
  // the live RNG the difficulty-1 run landed a hit the real game never takes —
  // the suite passed only because the hit used to be replayed at a recorded
  // frame and the geometry was never consulted.
  state.slashParams = v.slashParams;
  state.slashIndex = 0;

  const spawner = {
    name: 'split_spawner',
    create(e) {
      e.done = false;
    },
    endStep(e, st) {
      if (e.done || st.frame !== MANAGER_FRAME) return;
      const mg = spawn(st, boxsplitterAttack, { x: 425, y: 77.56658 });
      mg.difficulty = v.difficulty;
      // The init block's own `vertical = irandom(1)` runs before any cut, so
      // it is supplied separately rather than from the per-cut table.
      mg.initVertical = v.initVertical;
      mg.force_swap = v.force_swap;
      e.done = true;
    },
  };
  spawn(state, spawner, {});
}
