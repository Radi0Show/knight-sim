// Attack 5 oracle-comparison scene: the Stars cone, against
// knight-research/traces/t8-stars.csv.
//
// Verifies the attack's DODGE-RELEVANT core, now including the soul for every
// frame of the window: the cone's angle easing, the per-frame leftward shove
// of the battle box, the box snapping to round(gt_x), and the soul squeezed
// against the box's right edge as the arena closes in.
//
// The stars themselves (obj_knight_pointing_star) are not in this scene yet —
// they are bullets with their own 126-line Step and a gravity phase. The cone
// is what moves the arena and the soul, so it is verified first and on its own.
//
// Timeline taken from the oracle: cone appears at frame 61 with angle 0 and
// gt_x 320; the angle starts opening at frame 91 (con reaches 2).
//
// The soul sits at (314,162) — the box centre, where the tester places it —
// and stays there until frame 215, when the box has slid far enough left that
// the squeeze (obj_heart.x = min(obj_heart.x, gt_maxx() - 22)) starts pushing
// it. That squeeze is the attack's real dodge pressure and is now visible
// because the soul is finally IN the arena: earlier recordings had the knight
// dragging it to x 165 (see CLAUDE.md, "The soul-outside-the-box bug").

import { spawn } from '../../sim/entity.js';
import { soul } from '../../sim/soul.js';
import { battlebox, settleBox } from '../../sim/battlebox.js';
import { pointingCone } from '../../sim/attacks/pointing-cone.js';
import { gmlCreate } from '../../sim/rng.js';
import { real } from '../../sim/trace.js';

export const T8_WINDOW = { from: 91, to: 300 };
const CONE_FRAME = 61;
const OPEN_FRAME = 91;

const spawner = {
  name: 't8_spawner',
  endStep(e, state) {
    if (state.frame === CONE_FRAME) {
      const c = spawn(state, pointingCone, { x: 425, y: 79.81590270996094 });
      c.tween = 1; // already in place by the time the angle opens
      state.cone = c;
    }
    // con < 2 gates the push; the oracle reaches it at frame 91.
    if (state.frame === OPEN_FRAME - 1 && state.cone) state.cone.con = 2;
  },
};

export function buildOracleT8Scene(state) {
  state.hp = 0;
  state.invTimer = -1;
  state.phase = 'oracle';
  state.view = { x: 0, y: 0 };
  state.flag22 = 0;
  state.frame = 0;
  state.gmlRng = gmlCreate(4242);
  state.damageEnabled = false;
  state.cone = null;
  // The cone's push only runs while turntimer is above endtimer (120); the
  // oracle pins turntimer at 999 throughout the recorded window.
  state.turntimer = 999;

  settleBox(spawn(state, battlebox, { x: 320, y: 170 }));
  state.soul = spawn(state, soul, { x: 314, y: 162 });
  state.soul.canmove = 0;
  spawn(state, spawner);

  state.traceExtraHeader = ['gt_x', 'angle', 'anglelerp', 'gtx_internal'];
  state.traceExtra = (s) => {
    const gt = s.entities.find((x) => x.alive && x.type.name === 'obj_growtangle');
    const c = s.cone && s.cone.alive ? s.cone : null;
    return [
      gt ? real(gt.x) : '',
      c ? real(c.angle) : '',
      c ? real(c.angle_lerp) : '',
      c ? real(c.gt_x) : '',
    ];
  };
  return state;
}

export const ORACLE_T8_INPUT = [{ from: 0 }];
