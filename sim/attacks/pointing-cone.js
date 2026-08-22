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
// THE DRAW EVENT IS NOT PURELY COSMETIC — an earlier version of this note said
// it was, and that was wrong. The cone's OPENING is driven from Draw, not Step:
//
//     if (con <= 1) {
//         if (con == 0) con = 1;
//         ...
//         timer++;
//         if (timer >= 30) { con = 2; }
//     }
//
// Nothing in the Step ever moves `con` past 1, so without this the cone never
// opens at all. Measured: created on frame 13 with con 1, reaching con 2 on
// frame 42. Modelled in `endStep` below, which is this engine's equivalent
// slot — Draw runs after every Step, as endStep does.
//
// NOT translated (genuinely cosmetic): the sprite/surface drawing, the
// `fake_gt` visual offsets, afterimages, star flicker, and sounds. NOTE that
// fake_gt's offsets consume TWO random_range draws per frame from the shared
// stream — see the RNG note in CLAUDE.md; anything needing stream fidelity
// alongside this attack must account for them.

import { scrMovetowards, scrEaseIn, scrEaseOut, lerp } from '../gml.js';
import { cue } from '../audio.js';
import { scrAfterimage } from '../fx.js';
import { gmlIrandom, gmlIrandomRange, gmlRandomRange } from '../rng.js';

/**
 * The end of the cone's Step, verbatim: knockback-or-drift, the two fake_gt
 * jitter draws (REAL stream consumption — the values are visual), the box
 * snap and the soul squeeze. Called exactly once per frame from both the
 * pre-con-2 path and the live path.
 */
function dragStep(e, state, gt, heart) {
  if (e.knockback !== 0) {
    const kb = scrEaseIn(e.knockback / 10, 5) * 10;
    e.gt_x -= kb;
    e.knockback = scrMovetowards(e.knockback, 0, 0.5);
    e.fakeGtXoff = gmlRandomRange(state.gmlRng, -1, 1) * (kb / 10);
    e.fakeGtYoff = gmlRandomRange(state.gmlRng, -1, 1) * (kb / 10);
  } else {
    e.gt_x -= e.angle / e.target_angle / 2;
    e.fakeGtXoff = gmlRandomRange(state.gmlRng, -1, 1) * (e.angle / e.target_angle);
    e.fakeGtYoff = gmlRandomRange(state.gmlRng, -1, 1) * (e.angle / e.target_angle);
  }
  // The box snaps to the integer position; the soul is squeezed against it.
  if (gt) gt.x = Math.round(e.gt_x);
  if (gt && heart) heart.x = Math.min(heart.x, gtMaxX(gt) - 22);
}

function box(state) {
  return state.entities.find((e) => e.alive && e.type.name === 'obj_growtangle');
}

/** gt_maxx() — the box's right edge. */
function gtMaxX(gt) {
  return gt.x + (gt.mask.w * gt.image_xscale) / 2;
}

export const pointingCone = {
  name: 'obj_knight_pointing_cone',
  // THE MIXED STEP ORDER, fitted to two exact measurements the pure orders
  // cannot both satisfy:
  //
  //  * frame 145 (the first star): size = us[38] of the anchored stream
  //    requires the CONTROLLER's rolls before the cone's two drag draws;
  //  * frame 160 (the squeeze release): the soul leaves the pinned clamp at
  //    365 = (new box clamp 369, applied first) - 4, requiring the cone's
  //    drag-and-clamp before the HEART's movement — while the heart is the
  //    OLDER instance.
  //
  // [dc, cone, heart] is the one order satisfying both. The same knob the
  // sword vortex already needs (its sword steps before its older manager);
  // GameMaker's real cross-object scheduling remains unexplained, these
  // measurements are not.
  stepOrder: -1,

  create(e, state) {
    // `obj_knight_enemy.visible = false` — the cone's Create HIDES THE KNIGHT,
    // because the cone draws its own pointing pose in his place. An invisible
    // instance's Draw event does not run at all in GameMaker, so for the whole
    // of Stars the real Knight contributes nothing to the screen.
    //
    // Nothing in the sim set this. clearTurn already restored `visible = true`
    // (standing in for the cone's CleanUp) and carried a comment describing
    // exactly this behaviour — but the flag was only ever set back to true, so
    // the Knight was drawn straight through all six Stars turns on top of the
    // cone's copy of him. The draw log found it: the oracle has ELEVEN windows
    // with no knight draw at all and the sim had six, the five it did have
    // being the sword tunnels.
    {
      const k = state.entities.find((x) => x.alive && x.type.name === 'obj_knight_enemy');
      if (k) k.visible = false;
    }
    // MEASURED from the recording, like the star's. Not in the GML dump.
    //
    // THE CONE IS THE KNIGHT during Stars. Its Draw calls `draw_self()`, and
    // its Create hides obj_knight_enemy — one figure on screen, in the
    // pointing pose, not two. Without the hide you get the idle knight and the
    // pointing knight overlapping, which is exactly what it looked like.
    e.sprite_index = 'spr_roaringknight_point_ol';
    // `image_speed = 0` — the pose is driven BY HAND in Draw, one frame at a
    // time (see endStep). Leaving it at GameMaker's default 1 made the engine
    // advance and wrap it every frame, so the knight flicked through the whole
    // point animation on a loop instead of raising his arm once and holding.
    e.image_speed = 0;
    e.image_index = 0;
    e.image_number = 5; // spr_roaringknight_point_ol
    const gt = box(state);
    e.angle = 0;
    e.target_angle = 60;
    e.tween = 0;
    e.angle_lerp = 0;
    e.image_xscale = 2;
    e.image_yscale = 2;
    // obj_knight_pointing_cone Create: `obj_knight_enemy.visible = false`, and
    // it inherits his afterimage timer so the trail does not restart.
    const knight = state.entities.find(
      (x) => x.alive && x.type.name === 'obj_knight_enemy',
    );
    if (knight) {
      knight.visible = false;
      e.aetimer = knight.aetimer ?? 0;
    } else {
      e.aetimer = 0;
    }

    e.afterimage_spread = 0;
    // `yoff = irandom(60) + 2` — where the charge beam samples the flow
    // texture, so the beam's pattern differs every time the attack runs.
    e.yoff = 2 + gmlIrandom(state.gmlRng, 60);
    e.con = 0;
    e.difficulty = 0;
    // ONE, not zero. The opening counter lives in the Draw event, and
    // GameMaker draws an instance on the frame it is created while its Step
    // does not run until the next one — the recording shows exactly that at
    // frame 13: `con` is already 1 (Draw ran and advanced it) while `tween` is
    // still 0 (Step had not). This engine has no Draw phase, so the cone's
    // endStep first runs a frame later; starting the counter at 1 puts it back
    // in step. Without it the cone opens one frame late and every angle after
    // it is shifted.
    e.timer = 1;
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
    // NO SOUL, NO TARGET. obj_heart exists only during the bullet phase — the
    // Knight delivers it per turn via scr_moveheart and it is gone by the
    // party's menu — so a bullet that outlives its turn by a frame has
    // nothing to aim at. Skipping the frame leaves it where it was until the
    // turn sweep takes it; inventing a position would make it lunge at a soul
    // that is not there.
    if (!heart) return;
    e.timerb += 1;
    // THREE COPIES OF EACH, at the same pitch — the original stacks them to
    // thicken the sound rather than raising the gain, and a single cue is
    // noticeably thinner.
    if (e.timerb === 3) {
      for (let i = 0; i < 3; i++) cue(state, 'snd_knight_drawpower', 1.3);
    }
    if (e.timerb === 120) {
      for (let i = 0; i < 3; i++) cue(state, 'snd_knight_star_explosion_close', 0.7, 2);
    }

    if (e.con === 4) {
      // THE RETURN. `lerp(x, knight.x, 0.15)` each frame, so it eases home and
      // never quite arrives — the cone is cleared by the end-of-turn sweep,
      // not by reaching him. The recording has it back at (425, 77.6) by
      // frame 200; before this it parked where it fired for the whole turn.
      //
      // ORIGINAL BUG: `con = 5` — which restores the knight's visibility — is
      // guarded by `if (tween == 0)`. `tween` starts at 0, is only ever moved
      // TOWARD 1, and is never reset, so that test can never pass once the
      // cone has slid into place. con 5 is unreachable and the restore always
      // comes from CleanUp instead (sim/scenes/fight.js does the CleanUp's
      // job). Translated as-is rather than "corrected".
      if (e.tween === 0) {
        e.con = 5;
        // The same branch restores him: `obj_knight_enemy.visible = true`.
        // Unreachable for the reason above, translated as-is rather than
        // "corrected" — the restore really does come from CleanUp.
        const kv = state.entities.find((x) => x.alive && x.type.name === 'obj_knight_enemy');
        if (kv) kv.visible = true;
      }
      const knight = state.entities.find(
        (x) => x.alive && x.type.name === 'obj_knight_enemy',
      );
      if (knight) {
        e.x = lerp(e.x, knight.x, 0.15);
        e.y = lerp(e.y, knight.y, 0.15);
      }
    } else if (e.tween < 1) {
      e.tween = scrMovetowards(e.tween, 1, 0.05);
      const ease = scrEaseOut(e.tween, 4);
      if (gt) {
        e.x = lerp(e.xstart, gt.x + 115, ease);
        e.y = lerp(e.ystart, gt.y - 56, ease);
      }
    }

    // `if (con < 2) { exit; }` — the Step's own gate, lines 37-40, MEASURED
    // this session after a wrong detour: an earlier change ran the drag from
    // the cone's birth on the theory that the block was top-level. It is not
    // — the exit precedes it — and the oracle's own draw ledger (the first
    // star's size at raw stream position 38, decomposed) confirms the drag
    // consumes only from con 2. The detour is recorded so it is not retaken.
    if (e.con < 2) return;

    if (state.turntimer <= e.endtimer) {
      // FIRE. On the first frame of the closing branch angle_lerp is still 1,
      // so every live star is flipped con 0 -> 1 at once. This is the moment
      // the attack turns from "accumulating" to "incoming".
      if (e.angle_lerp === 1) {
        // NEWEST FIRST. `with (obj_knight_pointing_star)` visits instances in
        // REVERSE creation order, so the stagger `timer = -i` lands on the
        // youngest star first and the oldest last. Iterating oldest-first
        // reverses the whole ripple: the population curve then parts at frame
        // 192, and with this it is exact for the entire 246-frame window.
        // See sim/entity.js — the same ordering shows up in the sword vortex.
        const list = state.entities
          .filter((s) => s.alive && s.type.name === 'obj_knight_pointing_star')
          .reverse();
        let count = 0;
        for (const s of list) {
          s.con = 1;
          s.timer = -count;
          count += 1;
        }
        e.knockback = 10;
      }

      // Closing: the angle eases back down.
      if (e.angle_lerp === 0 && e.con < 3) {
        e.timer = 10;
        e.con = 3;
        // Re-rolled for the closing flare.
        e.yoff = 120 + gmlIrandomRange(state.gmlRng, -60, 60);
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

    dragStep(e, state, gt, heart);
  },

  /** The opening AND the close-out, both driven from the original's Draw. */
  endStep(e, state) {
    // THE AFTERIMAGE TRAIL, every fourth frame while con <= 4. A ghost of the
    // pointing knight that drifts outward: `speed = 2 + afterimage_spread / 30`
    // and `direction = sin(aetimer) * angle / 2`, so it fans WIDER as the cone
    // opens (the direction scales with `angle`) and FASTER as `afterimage_spread`
    // grows. The spread climbs every trail frame from con 1 and is pulled back
    // to 0 at con 4, so the fan collapses as he lowers his arm.
    e.aetimer += 1;
    if (e.con <= 4 && e.aetimer % 4 === 0) {
      const ai = scrAfterimage(state, e);
      ai.image_alpha = 0.6;
      ai.fadeSpeed = 0.02;
      ai.builtinMotion = true;
      ai.speed = 2 + e.afterimage_spread / 30;
      ai.direction = (Math.sin(e.aetimer) * e.angle) / 2;
      const knight = state.entities.find(
        (x) => x.alive && x.type.name === 'obj_knight_enemy',
      );
      ai.depth = (knight ? knight.depth : 88) + 1;
      if (e.con === 4) e.afterimage_spread = scrMovetowards(e.afterimage_spread, 0, 20);
      if (e.con >= 1) e.afterimage_spread += 1;
    }

    // THE POSE, hand-animated in Draw rather than by image_speed:
    //
    //   con < 3   image_index += 0.5, up to the last frame, then it HOLDS —
    //             eight frames to raise the arm, and it stays pointed
    //   con >= 3  a single step back off the last frame, then -0.25 a frame
    //             as he lowers it
    //
    // Slow and one-directional in both halves. Nothing here ever wraps.
    const last = (e.image_number ?? 5) - 1;
    if (e.con >= 3) {
      if (e.image_index === last) e.image_index -= 1;
      else if (e.image_index > 0) e.image_index -= 0.25;
    } else if (e.image_index < last) {
      e.image_index += 0.5;
    }

    if (e.con <= 1) {
      if (e.con === 0) e.con = 1;
      e.timer += 1;
      if (e.timer >= 30) {
        // The charge beam finishing — Draw line 74, on the con 1 -> 2 flip.
        cue(state, 'snd_rocket_long', 0.6);
        e.timer = 0;
        e.con = 2;
      }
    }

    // THE CLOSE. Draw counts `timer` down from 10 once con reaches 3 (the
    // flare that plays as the cone snaps shut) and hands over to con 4, which
    // walks the cone back to the knight. Without this the cone parked where it
    // fired for the rest of the turn — visibly unfinished, and the recording
    // has it back at (425, 77.6) by frame 200.
    if (e.con === 3 && e.timer > 0) {
      e.timer -= 1;
      if (e.timer === 0) e.con = 4;
    }
  },
};
