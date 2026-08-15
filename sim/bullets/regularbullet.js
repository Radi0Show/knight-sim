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
import { scrDamageAll, scrDamageSingle } from '../damage.js';

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

/**
 * `scr_bullet_inherit(target)` — copies the CALLER's bullet fields down.
 *
 * This is how damage actually reaches a bullet. `scr_bullet_init` gives every
 * bullet a placeholder `damage = 10`, and 10 is small enough that the party's
 * defence eats almost all of it: `scr_damage_calculation` subtracts 1 per
 * point of DF below maxhp/8, so 10 against 9 DF lands as **1**. A bullet that
 * never inherits therefore does not look broken — it looks weak, which is the
 * quietest possible failure and exactly how Flurry's teeth shipped wrong.
 *
 * The `obj_dbulletcontroller` branch of the original also copies `creatorid`
 * and `creator`; no caller in this fight is a dbulletcontroller, so it is
 * omitted rather than guessed at.
 */
export function scrBulletInherit(self, target) {
  if (!target) return;
  if (self.damage !== -1) target.damage = self.damage;
  if (self.grazepoints !== -1) target.grazepoints = self.grazepoints;
  if (self.timepoints !== -1) target.timepoints = self.timepoints;
  if (self.inv !== -1) target.inv = self.inv;
  if (self.target !== -1) target.target = self.target;
  if (self.grazed !== -1) target.grazed = 0;
  if (self.grazetimer !== -1) target.grazetimer = 0;
  target.element = self.element;
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
  // Oracle parity: when the patched game replaces this handler with a
  // recorder, contact is counted but nothing else happens. See
  // state.damageEnabled.
  if (!state.damageEnabled) return;

  if (e.active === 1 || e.active === true) {
    // obj_collidebullet Other_15, the real routing — and an earlier note
    // here ("the knight's bullets hit the whole party") was WRONG, reported
    // from play as the whole party melting at once:
    //
    //     if (target != 3) scr_damage();       // ONE character, redirected
    //     if (target == 3) scr_damage_all();   // the party, aoedamage set
    //
    // `scr_bullet_init` defaults `target = 0`, so an ordinary bullet takes
    // HP from ONE character, chosen by scr_damage's chapter-3 block (the
    // Kris redirect and the ShadowMantle's two-of-three pull). Only bullets
    // that set target = 3 in their own Other_15 (the slashes, the pointing
    // stars) hit everyone — and those set aoedamage, which SKIPS the
    // redirect, so the AoE path never funnels into the wearer.
    if (state.invTimer < 0) {
      const opts = { flurrySoftened: state.flurrySoftened === true };
      if (e.target === 3) {
        scrDamageAll(state, e.damage ?? 1, opts);
      } else {
        scrDamageSingle(state, e.damage ?? 1, e.target ?? 0, opts);
      }
    }
    if (e.destroyonhit === 1 || e.destroyonhit === true) {
      destroy(e);
    }
  }
}
