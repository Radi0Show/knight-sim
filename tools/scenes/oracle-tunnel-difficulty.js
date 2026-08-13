// SWORD TUNNEL at difficulties 3 and 4 — the phase 2 and phase 3 variants
// (turns 8 and 14). Against knight-research/traces/tunnel_d3.csv and
// tunnel_d4.csv, recorded with `tools/oracle-run.sh 2 3` and `3 4`.
//
// The selector only ever hands ac 13 difficulty 0, 3 or 4, so these two plus
// the already-verified difficulty 0 are the whole attack. Difficulties 1 and 2
// (tobymode 1 and 2) are unreachable and stay untranslated.
//
//   0   tobymode 0, gapsize 45, verticalchange 10 — straight corridor
//   4   tobymode 0, gapsize 40, verticalchange 10 — same, TIGHTER gap
//   3   tobymode 3, and a different attack: the corridor SWEEPS around the box
//
// tobymode 3 is the one that needed new code. `sworddirection` advances 8
// degrees per pair so the corridor rotates, the swords enter along that
// heading rather than straight left, and the gap breathes:
//
//   tobytimer++                                    <-- first increment
//   verticalchange = abs(sin(tobytimer / 8)) * 5
//   gapsize        = 34 + verticalchange * 1.4
//   ...placement...
//   tobytimer++                                    <-- second increment
//
// THE DOUBLE INCREMENT IS REAL and it matters: the sine reads the ODD value.
// At the first pair `tobytimer` is 1, giving `abs(sin(1/8)) * 5 = 0.6234`,
// which is exactly what the recording shows. Reading the post-increment value
// gives 1.237 and every position after it drifts.
//
// Speed falls off as the corridor turns side-on:
// `speedproportion = lerp(1, 0.8, abs(lengthdir_y(1, sworddirection + 180)))`,
// `_speed = -8 * speedproportion`. Measured -8.000 head-on and -7.777 eight
// degrees round, which is what selected this formula over the alternatives.
//
// RECORDED INPUTS, same as the difficulty-0 scene: the Create's
// `timer = -40 + irandom(10)` and the (setcount, waitsetcount, movedirection)
// triple re-rolled at every set boundary. The gap's wandering LOGIC is
// computed, including the two clamps that turn it around at the box edges —
// and those clamps are why the two difficulties' boundary sequences diverge at
// frame 166 despite sharing an RNG stream.
//
// Same scope caveats as difficulty 0: the finale at `finishtimer` max and the
// swept 8px hit test are not translated.

import { spawn } from '../../sim/entity.js';
import { soul } from '../../sim/soul.js';
import { battlebox, settleBox } from '../../sim/battlebox.js';
import { swordTunnelManager } from '../../sim/attacks/sword-tunnel.js';

export const MANAGER_FRAME = 13;

/** Ends before difficulty 3's finale (finishtimermax 250 -> frame 263). */
export const TUNNEL_D_WINDOW = { from: 13, to: 250 };

const BOX = { x: 300, y: 190 };
// See oracle-swordtunnel.js: the soul settles at 264 by frame 10.
const SOUL_START = { x: 264, y: 182 };

const SETS_COMMON = [
  { setcount: 3, waitsetcount: 2, movedirection: 'none' },
  { setcount: 4, waitsetcount: 1, movedirection: 'up' },
  { setcount: 4, waitsetcount: 2, movedirection: 'none' },
  { setcount: 3, waitsetcount: 2, movedirection: 'down' },
  { setcount: 4, waitsetcount: 1, movedirection: 'none' },
  { setcount: 2, waitsetcount: 1, movedirection: 'down' },
  { setcount: 4, waitsetcount: 1, movedirection: 'none' },
  { setcount: 4, waitsetcount: 2, movedirection: 'up' },
  { setcount: 2, waitsetcount: 1, movedirection: 'none' },
  { setcount: 4, waitsetcount: 2, movedirection: 'down' },
  { setcount: 3, waitsetcount: 2, movedirection: 'none' },
];

export const TUNNEL_D_VARIANTS = {
  3: {
    difficulty: 3,
    timerOffset: 3,
    sets: [
      ...SETS_COMMON,
      { setcount: 3, waitsetcount: 2, movedirection: 'down' },
      { setcount: 2, waitsetcount: 3, movedirection: 'none' },
      { setcount: 3, waitsetcount: 1, movedirection: 'down' },
      { setcount: 4, waitsetcount: 1, movedirection: 'none' },
      { setcount: 4, waitsetcount: 2, movedirection: 'down' },
      { setcount: 3, waitsetcount: 3, movedirection: 'none' },
      { setcount: 3, waitsetcount: 1, movedirection: 'up' },
      { setcount: 4, waitsetcount: 2, movedirection: 'none' },
      { setcount: 3, waitsetcount: 2, movedirection: 'down' },
    ],
  },
  4: {
    difficulty: 4,
    timerOffset: 3,
    sets: [
      ...SETS_COMMON,
      { setcount: 3, waitsetcount: 2, movedirection: 'up' },
      { setcount: 2, waitsetcount: 3, movedirection: 'none' },
      { setcount: 3, waitsetcount: 1, movedirection: 'down' },
      { setcount: 4, waitsetcount: 1, movedirection: 'none' },
      { setcount: 4, waitsetcount: 2, movedirection: 'up' },
      { setcount: 3, waitsetcount: 3, movedirection: 'none' },
      { setcount: 3, waitsetcount: 1, movedirection: 'up' },
    ],
  },
};

export const ORACLE_TUNNEL_D_INPUT = [{ from: 0 }];

export function buildTunnelDifficultyScene(state, which) {
  const v = TUNNEL_D_VARIANTS[which];
  if (!v) throw new Error(`no such tunnel variant: ${which}`);

  state.view = { x: 0, y: 0 };
  state.turntimer = 400;

  settleBox(spawn(state, battlebox, { x: BOX.x, y: BOX.y }));
  state.soul = spawn(state, soul, { ...SOUL_START });

  state.tunnelSets = v.sets;
  state.tunnelIndex = 0;

  const spawner = {
    name: 'tunnel_d_spawner',
    create(e) {
      e.done = false;
    },
    endStep(e, st) {
      if (e.done || st.frame !== MANAGER_FRAME) return;
      const mg = spawn(st, swordTunnelManager, {
        x: BOX.x,
        y: st.view.y,
        // The Create reads obj_knight_enemy.difficulty for finishtimermax.
        knightDifficulty: v.difficulty,
      });
      mg.timer = -40 + v.timerOffset;
      mg.setcount = 3;
      mg.waitsetcount = 2;
      mg.movedirection = 'down';
      mg.difficulty = v.difficulty;
      mg.damage = 1;
      swordTunnelManager.init(mg, st);
      e.done = true;
    },
  };
  spawn(state, spawner, {});
}
