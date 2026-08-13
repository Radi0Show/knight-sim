// obj_dbulletcontroller, type 98 — the STARS spawner (ac 1).
//
// This lived inside tools/scenes/oracle-stars-full.js, which was fine while
// only the verifier needed it and wrong as soon as the playable build did:
// every other attack's manager is in sim/ and Stars was the one attack the
// fight scheduler could not launch. Same code, same suite
// (tools/verify-stars-full.mjs) — it just lives where the fight can reach it.
//
// The controller derives each star from a pair of values that evolve per star:
//
//   size    += 0.5 + sin(made) * 0.5,  then % 1
//   special += 0.5 + (0.5 + sin(random(1)) * 0.3),  then % 1, then -= 0.5
//   direction = 180 + special * cone.angle
//   speed     = lerp(10, 5, size)
//
// `sin(random(1))` makes the launches unreproducible without the real stream,
// so the ORACLE SCENE replays them from the recording. In the playable build
// there is nothing to replay against, so it rolls them off gmlRng — which is
// the honest behaviour: the real game rerolls every playthrough too.
//
// ORIGINAL BUG, preserved: the controller sets `d.grow_Speed` (capital S)
// while obj_knight_pointing_star reads `growspeed`. Different variables, so
// the intended per-star growth variation never happens and every star in the
// recording grows at the same 0.02.

import { spawn } from '../entity.js';
import { lerp } from '../gml.js';
import { gmlRandom } from '../rng.js';
import { pointingStar } from './pointing-star.js';
import { heartFollower } from './pointing-starchild.js';

export const starsController = {
  name: 'obj_dbulletcontroller',

  create(e, state) {
    e.btimer = 0;
    e.made = 0;
    e.endtimer = 120;
    e.init = 2;
    e.size = 0;
    e.special = 0;

    // obj_heart_follower — the soft-following ghost the homing starchildren
    // aim at (they lead the soul rather than tracking it exactly). The type-98
    // controller creates it, which is here.
    //
    // It was missing outside the oracle scene, which spawned one by hand. In a
    // real turn the difficulty-2 shards therefore had nothing to home toward
    // and flew in straight lines — the "homing stars just move horizontally"
    // report. Nothing in the verifier could catch it: the scene supplied the
    // follower itself, so the suite never exercised the controller's job.
    if (state.soul && !state.entities.some((x) => x.alive && x.type.name === 'obj_heart_follower')) {
      spawn(state, heartFollower, { x: state.soul.x, y: state.soul.y });
    }
    // The controller's own `global.turntimer += 30`.
    state.turntimer += 30;
  },

  step(e, state) {
    if (e.init >= 3) return;

    e.btimer += 1;

    if (state.turntimer <= e.endtimer + 1) {
      e.init = 3;
      return;
    }

    if ((e.made !== 0 && e.btimer >= 4) || e.btimer >= 45) {
      const cone = state.entities.find(
        (x) => x.alive && x.type.name === 'obj_knight_pointing_cone',
      );
      if (!cone) return;

      let direction;
      let speed;
      const replay = state.starVariant ? state.starVariant.launches : null;
      if (replay) {
        const rec = replay[e.made];
        if (!rec) return;
        direction = rec.direction;
        speed = rec.speed;
      } else {
        e.size = (e.size + (0.5 + Math.sin(e.made) * 0.5)) % 1;
        e.special =
          ((e.special + (0.5 + (0.5 + Math.sin(gmlRandom(state.gmlRng, 1)) * 0.3))) % 1) - 0.5;
        direction = 180 + e.special * cone.angle;
        speed = lerp(10, 5, e.size);
      }

      // scr_childbullet(bulletmaker.x + 22, bulletmaker.y + 56, ...)
      const d = spawn(state, pointingStar, { x: cone.x + 22, y: cone.y + 56 });
      d.difficulty = e.difficulty ?? 0;
      d.side = e.side ?? 1;
      d.direction = direction;
      d.speed = speed;

      e.made += 1;
      e.btimer = 0;
    }
  },
};
