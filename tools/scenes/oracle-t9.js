// Stars, full arc — against knight-research/traces/t9-star.csv.
//
// This scene models the attack's POPULATION DYNAMICS: the controller's spawn
// cadence, the cone's fire trigger, and each star's lifecycle. It verifies
// star COUNT over time alongside the cone/box/soul columns already covered by
// verify-stars.
//
// Why count rather than per-star positions: the controller computes each
// star's direction and speed from random_range/sin(random(1)), and the cone
// burns two random_range per frame on cosmetic offsets, so per-star spawn
// parameters are not stream-reproducible without recording every one. Count
// is an aggregate that still pins spawn cadence, fire timing, and lifetime —
// if any of those were wrong the population curve would diverge.
//
// turntimer is NOT pinned here either: the scene counts it down exactly as
// obj_battlecontroller does, because the attack sequences itself with it.

import { spawn } from '../../sim/entity.js';
import { soul } from '../../sim/soul.js';
import { battlebox } from '../../sim/battlebox.js';
import { pointingCone } from '../../sim/attacks/pointing-cone.js';
import { pointingStar } from '../../sim/attacks/pointing-star.js';
import { gmlCreate } from '../../sim/rng.js';
import { real, int } from '../../sim/trace.js';

export const T9_WINDOW = { from: 95, to: 300 };
const CONE_FRAME = 61;
const OPEN_FRAME = 91;

// obj_dbulletcontroller type 98, reduced to what moves frame state.
const starController = {
  name: 't9_controller',

  create(e) {
    e.btimer = 0;
    e.made = 0;
    e.endtimer = 120;
    e.done = false;
  },

  step(e, state) {
    if (e.done) return;
    e.btimer += 1;

    if (state.turntimer <= e.endtimer + 1) {
      e.done = true; // init = 3: stop spawning
      return;
    }
    if ((e.made !== 0 && e.btimer >= 4) || e.btimer >= 45) {
      const cone = state.entities.find(
        (x) => x.alive && x.type.name === 'obj_knight_pointing_cone',
      );
      if (!cone) return;
      // scr_childbullet(bulletmaker.x + 22, bulletmaker.y + 56, ...)
      const st = spawn(state, pointingStar, { x: cone.x + 22, y: cone.y + 56 });
      // Direction/speed are RNG-derived per star; the aggregate we verify is
      // population, so a fixed representative launch is used.
      st.direction = 180;
      st.speed = 7;
      e.made += 1;
      e.btimer = 0;
    }
  },
};

const clock = {
  name: 't9_clock',
  // obj_battlecontroller: global.turntimer -= 1 while mnfight == 2.
  beginStep(e, state) {
    state.turntimer -= 1;
  },
};

export function buildOracleT9Scene(state) {
  state.hp = 0;
  state.invTimer = -1;
  state.phase = 'oracle';
  state.view = { x: 0, y: 0 };
  state.flag22 = 0;
  state.frame = 0;
  state.gmlRng = gmlCreate(4242);
  state.damageEnabled = false;
  state.turntimer = 300 + 30; // Create value, plus the controller's init bump

  spawn(state, clock);
  spawn(state, battlebox, { x: 320, y: 170 });
  state.soul = spawn(state, soul, { x: 314, y: 162 });
  state.soul.canmove = 0;

  spawn(state, {
    name: 't9_spawner',
    endStep(e, s) {
      if (s.frame === CONE_FRAME) {
        const c = spawn(s, pointingCone, { x: 425, y: 79.81590270996094 });
        c.tween = 1;
        s.cone = c;
        spawn(s, starController);
      }
      if (s.frame === OPEN_FRAME - 1 && s.cone) s.cone.con = 2;
    },
  });

  state.traceExtraHeader = ['gt_x', 'angle', 'stars', 'turntimer'];
  state.traceExtra = (s) => {
    const gt = s.entities.find((x) => x.alive && x.type.name === 'obj_growtangle');
    const c = s.cone && s.cone.alive ? s.cone : null;
    const stars = s.entities.filter(
      (x) => x.alive && x.type.name === 'obj_knight_pointing_star',
    ).length;
    return [gt ? real(gt.x) : '', c ? real(c.angle) : '', int(stars), int(s.turntimer)];
  };
  return state;
}

export const ORACLE_T9_INPUT = [{ from: 0 }];
