// obj_roaringknight_fountain_bullet — translated from Create_0 / Step_0.
//
// Parent chain: obj_regularbullet -> obj_collidebullet -> obj_bulletparent.
// event_inherited() opens both Create and Step, so the base runs first.
//
// Movement is entirely built-in speed/direction: the spawner sets speed 0,
// direction +/-90 and a top_speed; Step ramps speed_mult += 0.2 to 1 and
// assigns speed = speed_mult * top_speed. The +0.2 accumulation is inexact
// in binary (0.6000000000000001...) and those digits reach the trace —
// preserved by doing the identical f64 ops, per rule 3.
//
// Faithful oddity, do not "fix": Create sets `destroy_on_hit = false`
// (underscores), but the damage gate in collidebullet's Other_15 reads
// `destroyonhit`, which scr_bullet_init set to 1. The two names are
// different variables, so fountain bullets DO destroy on hit.

import { HEART_MASK, FOUNTAIN_MASK, masksOverlap } from '../masks.js';
import {
  regularbulletCreate,
  regularbulletStep,
  collidebulletOther15,
} from '../bullets/regularbullet.js';

export const fountainBullet = {
  name: 'obj_roaringknight_fountain_bullet',

  create(e, state) {
    regularbulletCreate(e, state); // event_inherited()
    e.element = 5;
    e.speed_mult = 0;
    e.top_speed = 0;
    e.image_xscale = 1;
    e.image_yscale = 1;
    e.active = false;
    // ORIGINAL BUG: Create sets `destroy_on_hit`, the damage gate reads
    // `destroyonhit` (= 1 from scr_bullet_init). Different variables, so this
    // line does nothing and fountain bullets DO destroy on hit.
    // Divergent by design. Do not "fix". Oracle-confirmed at the contact
    // frame in traces/t5-fountain.csv.
    e.destroy_on_hit = false;
    e.grazepoints = 5;
  },

  step(e, state) {
    regularbulletStep(e, state); // event_inherited()
    if (e.speed_mult < 1) {
      e.speed_mult += 0.2;
      if (!e.active && e.speed_mult >= 0.1) {
        e.active = true;
      }
      e.speed = e.speed_mult * e.top_speed;
    }
  },

  collides(e, heart) {
    return masksOverlap(
      heart.mask ?? HEART_MASK, heart.x, heart.y,
      FOUNTAIN_MASK, e.x, e.y, e.image_xscale, e.image_yscale, e.image_angle,
    );
  },

  other15: collidebulletOther15, // no override — parent default
};
