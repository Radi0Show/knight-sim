// obj_knight_pointing_cone — the driver of `Stars` (myattackchoice 1,
// dc.type 98), which OPENS EVERY PHASE of the fight.
//
// This is the object that shoves the battle box. Unlike most attacks it does
// not just add bullets: it drags the arena itself leftward every frame and
// squeezes the soul against the shrinking wall, which is the attack's real
// dodge pressure. (It is also the thing that produced the mysterious "box
// drift" during harness work — authentic behaviour all along.)
//
// Shape:
//   tween      ease into position beside the box over ~20 frames
//   open       angle eases 0 -> target_angle (60) via scr_ease_out(_, 6)
//   push       every frame: gt_x -= angle / target_angle / 2, then the box
//              snaps to round(gt_x) and the soul is clamped to its right edge
//   knockback  pulses shove the box harder for a few frames
//
// Verified against traces/t8-stars.csv: the push formula reproduces 44/44
// steady-state frames and box.x == round(gt_x) holds for all 340 frames the
// cone is alive. target_angle = 60 was DERIVED from the trace (steady step
// 0.499512 at angle 59.941406), not assumed.
//
// NOT translated (cosmetic): the cone's own sprite/surface drawing, the
// `fake_gt` visual offsets, afterimages, star flicker, and sounds. NOTE that
// fake_gt's offsets consume TWO random_range draws per frame from the shared
// stream — see the RNG note in CLAUDE.md; anything needing stream fidelity
// alongside this attack must account for them.

import { scrMovetowards, scrEaseIn, scrEaseOut, lerp } from '../gml.js';

function box(state) {
  return state.entities.find((e) => e.alive && e.type.name === 'obj_growtangle');
}

/** gt_maxx() — the box's right edge. */
function gtMaxX(gt) {
  return gt.x + (gt.mask.w * gt.xscale) / 2;
}

export const pointingCone = {
  name: 'obj_knight_pointing_cone',

  create(e, state) {
    const gt = box(state);
    e.angle = 0;
    e.target_angle = 60;
    e.tween = 0;
    e.angle_lerp = 0;
    e.image_xscale = 2;
    e.image_yscale = 2;
    e.con = 0;
    e.difficulty = 0;
    e.timer = 0;
    e.timerb = 0;
    e.gt_x = gt ? gt.x : 320;
    e.knockback = 0;
    e.endtimer = 120;
    e.xstart = e.x;
    e.ystart = e.y;
  },

  step(e, state) {
    const gt = box(state);
    const heart = state.soul;
    e.timerb += 1;

    if (e.con === 4) {
      // Returning to the knight; not exercised in the verified window.
      if (e.tween === 0) e.con = 5;
    } else if (e.tween < 1) {
      e.tween = scrMovetowards(e.tween, 1, 0.05);
      const ease = scrEaseOut(e.tween, 4);
      if (gt) {
        e.x = lerp(e.xstart, gt.x + 115, ease);
        e.y = lerp(e.ystart, gt.y - 56, ease);
      }
    }

    if (e.con < 2) return;

    if (state.turntimer <= e.endtimer) {
      // Closing: the angle eases back down.
      if (e.angle_lerp === 0 && e.con < 3) {
        e.timer = 10;
        e.con = 3;
      }
      e.angle_lerp = scrMovetowards(e.angle_lerp, 0, 0.1);
      e.angle = lerp(0, e.target_angle, scrEaseIn(e.angle_lerp, 6));
    } else if (e.angle < e.target_angle) {
      // Opening.
      e.angle_lerp = scrMovetowards(e.angle_lerp, 1, 0.025);
      e.angle = lerp(0, e.target_angle, scrEaseOut(e.angle_lerp, 6));
    } else {
      e.x += 0.25;
    }

    if (e.knockback !== 0) {
      const kb = scrEaseIn(e.knockback / 10, 5) * 10;
      e.gt_x -= kb;
      e.knockback = scrMovetowards(e.knockback, 0, 0.5);
    } else {
      e.gt_x -= e.angle / e.target_angle / 2;
    }

    // The box snaps to the integer position; the soul is squeezed against it.
    if (gt) gt.x = Math.round(e.gt_x);
    if (gt && heart) heart.x = Math.min(heart.x, gtMaxX(gt) - 22);
  },
};
