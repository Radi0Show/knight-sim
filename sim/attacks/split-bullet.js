// obj_roaringknight_split_bullet — the splitter's teeth.
// Translated from Create_0 / Step_0 (Draw_0 is visual only).
//
// Parent chain: obj_regularbullet -> obj_collidebullet -> obj_bulletparent,
// so event_inherited() opens both Create and Step.
//
// Motion: the spawner gives speed 0, a top_speed, and a NEGATIVE friction.
// Step ramps speed_mult 0 -> 1 by 0.2 and assigns speed = speed_mult *
// top_speed; once the ramp finishes, the negative friction keeps
// accelerating them. Both effects verified against traces/t6-splitter.csv.

import { TOOTH_MASK, HEART_MASK, masksOverlap } from '../masks.js';
import {
  regularbulletCreate,
  regularbulletStep,
  collidebulletOther15,
} from '../bullets/regularbullet.js';

export const splitBullet = {
  name: 'obj_roaringknight_split_bullet',

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
    // line does nothing. Divergent by design. Do not "fix".
    e.destroy_on_hit = false;

    e.grazepoints = 0;

    // ORIGINAL BUG (dead feature): turn_timer / turn_dir / turn_start are
    // assigned here and read NOWHERE in the entire dump — the teeth have
    // turning logic that was never wired up. They fly straight. Kept for
    // fidelity of the variable set; do not implement turning.
    e.turn_timer = 0;
    e.turn_dir = 0;
    e.turn_start = false;

    e.grazed = 1;
    e.distance = 0;
    e.anim_timer = 0;
    e.image_speed = 0;
  },

  step(e, state) {
    regularbulletStep(e, state); // event_inherited()
    e.grazepoints = 3;

    if (e.speed_mult < 1) {
      e.speed_mult += 0.2;
      if (!e.active && e.speed_mult >= 0.1) {
        e.active = true;
      }
      e.speed = e.speed_mult * e.top_speed;
    }

    e.image_xscale = 1;
    e.image_yscale = 1;
    // The original's two `if (image_xscale != 1)` branches follow here and
    // are unreachable — the assignments above just forced them to 1.

    e.distance += e.speed;
  },

  collides(e, heart) {
    return masksOverlap(
      HEART_MASK, heart.x, heart.y,
      TOOTH_MASK, e.x, e.y, e.image_xscale, e.image_yscale, e.image_angle,
    );
  },

  other15: collidebulletOther15,
};
