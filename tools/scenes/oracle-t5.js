// T5 oracle-comparison scene: fountain-bullet lifecycle and contact, against
// knight-research/traces/t5-fountain.csv.
//
// Oracle scenario: frozen soul at (310,162) inside the steady box; at trace
// frame 60 two obj_roaringknight_fountain_bullet spawn 100px below, direction
// 90, speed 0 ramping to top_speed 3 (fixed params — no RNG replay needed):
//
//   A at heart.x+60 = (370, 262): passes wide, destroyed by the parent's
//     wall check at y < view.y - 80 (trace frame 178)
//   B at heart.x+6  = (316, 262): contacts the heart during frame 88 —
//     inv resets to 30 via the DEFAULT collidebullet Other_15 (scr_damage
//     path) and destroyonhit=1 destroys the bullet
//
// What this window verifies beyond T4: built-in speed/direction motion in
// the documented phase slot, event_inherited chains (regularbullet base),
// the f64 speed-ramp arithmetic reaching the trace bit-for-bit, FLOAT32
// position storage (the ramp digits select it uniquely), moving-bullet
// precise-mask contact, and the default damage path.
//
// B dies before A here, so the sim's compacting bullet slots agree with the
// oracle's identity columns for the whole window. A scenario where the
// EARLIER-spawned bullet dies first would break that agreement — the slot
// layout, not the sim, would need rework (track ids like the oracle does).

import { spawn } from '../../sim/entity.js';
import { soul } from '../../sim/soul.js';
import { battlebox, settleBox } from '../../sim/battlebox.js';
import { fountainBullet } from '../../sim/attacks/fountain-bullet.js';

export const T5_WINDOW = { from: 4, to: 193 };
const SPAWN_FRAME = 60;

const fountainSpawner = {
  name: 't5_spawner',
  endStep(e, state) {
    if (state.frame === SPAWN_FRAME) {
      const heart = state.soul;
      // Mirrors the oracle patch: instance_create, then field assignments.
      const a = spawn(state, fountainBullet, { x: heart.x + 60, y: heart.y + 100 });
      a.speed = 0;
      a.top_speed = 3;
      a.direction = 90;

      const b = spawn(state, fountainBullet, { x: heart.x + 6, y: heart.y + 100 });
      b.speed = 0;
      b.top_speed = 3;
      b.direction = 90;
    }
  },
};

export function buildOracleT5Scene(state) {
  state.hp = 0;
  state.invTimer = -4;
  state.phase = 'oracle';
  state.view = { x: 0, y: 0 };
  state.flag22 = 0;
  state.frame = T5_WINDOW.from;

  settleBox(spawn(state, battlebox, { x: 320, y: 170 }));
  // Frozen soul: the tester puts it at (314,162) but with no input it sits
  // wherever the turn cycle last placed it; by the steady window that is
  // (310,162) per the oracle trace.
  state.soul = spawn(state, soul, { x: 310, y: 162 });
  spawn(state, fountainSpawner);
  return state;
}

// No input at all — the soul never moves.
export const ORACLE_T5_INPUT = [{ from: 0 }];
