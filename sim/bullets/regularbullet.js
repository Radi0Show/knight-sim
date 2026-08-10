// obj_regularbullet — the shared bullet base, translated from:
//   gml_Object_obj_regularbullet_Create_0 / Step_0
//
// Parent chain: obj_collidebullet (Other_15 default damage) -> obj_bulletparent
// (codeless). Children call these from their own create/step in the same
// position their GML calls event_inherited().
//
// The default Other_15 (obj_collidebullet) is also here: children that do
// not override it get scr_damage / scr_damage_all via the gate flags set by
// scr_bullet_init. Dodge-only translation: the observable effect of both
// damage scripts is `if (global.inv < 0) global.inv = global.invc * 30`
// (verified in the dump: scr_damage line 363, scr_damage_all line 17);
// party hp[] bookkeeping is out of scope per CLAUDE.md.

import { destroy } from '../entity.js';

export function scrBulletInit(e) {
  e.grazed = 0;
  e.grazetimer = 0;
  e.destroyonhit = 1;
  e.target = 0;
  e.inv = 60;
  e.damage = 10;
  e.element = 0;
  e.grazepoints = 1;
  e.timepoints = 1;
  e.active = 1;
  e.updateimageangle = 0;
}

export function regularbulletCreate(e, state) {
  scrBulletInit(e);
  e.spin = 0;
  e.spinspeed = 0;
  e.image_alpha = 1;
  if (!state.soul || !state.soul.alive) {
    destroy(e);
  }
  e.wall_destroy = 1;
  e.bottomfade = 0;

  e.isBullet = true;
  e.builtinMotion = true;
  e.speed = 0;
  e.direction = 0;
  e.image_angle = 0;
}

export function regularbulletStep(e, state) {
  if (e.wall_destroy === 1) {
    if (e.x < state.view.x - 80) destroy(e);
    if (e.x > state.view.x + 760) destroy(e);
    if (e.y < state.view.y - 80) destroy(e);
    if (e.y > state.view.y + 580) destroy(e);
  }
  if (e.updateimageangle === 1) {
    e.image_angle = e.direction;
  }
  if (e.spin === 1) {
    e.image_angle += e.spinspeed;
  }
  if (e.bottomfade !== 0) {
    if (e.y > state.view.y + e.bottomfade) {
      e.image_alpha *= 0.8;
    }
  }
}

/** obj_collidebullet Other_15 — the default damage handler. */
export function collidebulletOther15(e, state) {
  if (e.active === 1 || e.active === true) {
    // target != 3 -> scr_damage(); target == 3 -> scr_damage_all().
    // Identical observable at this altitude: inv gate and reset.
    if (state.invTimer < 0) {
      state.invTimer = state.invc * 30;
    }
    if (e.destroyonhit === 1 || e.destroyonhit === true) {
      destroy(e);
    }
  }
}
