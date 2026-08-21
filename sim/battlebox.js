import { mergeColor, gmlRound } from './gml.js';
import { spawn } from './entity.js';
import { afterimage } from './fx.js';
// The battle box — obj_growtangle at steady state.
//
// obj_growtangle's parent object is obj_battlesolid, so the box itself is
// what place_meeting(…, obj_battlesolid) hits: the hollow-ring precise mask
// of spr_battlebg_0, scaled by image_xscale/yscale, origin centred (37,37).
//
// This module models the box ALREADY GROWN (image scale = maxscale, angle 0),
// which is the steady state every attack plays out in. The 15-frame grow-in
// (obj_growtangle Create: timer 0..15, scale ramping, image_angle spinning
// 180..360) is deliberately not modelled: fractional-scale rotated precise
// masks have rasterization semantics the oracle showed we do not reproduce
// (t3 trace frames 0-3). Grow-in support needs its own oracle study first.

import { BATTLEBG_MASK, BATTLEBG_FIGHT_MASK, BATTLEBG_STRETCH_HITBOX_MASK } from './masks.js';

/**
 * Put a box straight into its settled state.
 *
 * The original creates a NEW obj_growtangle for every turn, so it grows in
 * once per attack. The playable scenes create one box and reuse it, which meant
 * it grew at scene build AND again when the first attack launched — the board
 * visibly "starting twice". Scenes call this after spawning so the only
 * grow-in a player sees is the one the attack triggers.
 */
export function settleBox(gt) {
  gt.growcon = 2;
  gt.timer = gt.maxtimer;
  gt.image_xscale = gt.maxxscale;
  gt.image_yscale = gt.maxyscale;
  gt.image_angle = gt.target_angle;
  gt.image_alpha = 1;
  return gt;
}

export const battlebox = {
  name: 'obj_growtangle',
  // AFTER the soul. The runner's step order is newest-first (three
  // independent receipts: verify21g f1257's newborn soul freezes against
  // the box's PRE-step t=7 ring; f1258's slide needs the t=8 states with
  // the box's own step still pending; the f1094 splitslash payoff lands
  // before the heart's inv decrement). The sim's global order stays
  // oldest-first — flipping it wholesale would unsettle three verified
  // turns — but the box, which every turn's soul is newer than, steps
  // after the 0-order entities so the soul's wall tests see the grow state
  // the game's soul sees.
  stepOrder: 0.5,

  create(e, state) {
    // Defaults from obj_growtangle Create, post-grow values.
    // ONE SCALE, `image_xscale`/`image_yscale`, exactly as the original has it.
    //
    // There used to be a second pair, `xscale`/`yscale`, that the wall
    // collision read while the renderer read the built-ins. Nothing kept them
    // in step, and ROARING is where that broke in the worst way: the attack
    // expands the arena to 17x by tweening `image_xscale`, so the box VANISHED
    // off the edges of the screen while an invisible wall at the old size went
    // on restricting the soul through a full-screen attack.
    if (e.maxxscale === undefined) e.maxxscale = 2;
    if (e.maxyscale === undefined) e.maxyscale = 2;
    e.isSolid = true; // parent: obj_battlesolid
    // THE STORED MASK, both rooms. The one-pixel "effective dilation"
    // (BATTLEBG_FIGHT_MASK) is RETIRED: the fight-vs-tester wall
    // discrepancy it papered over was the HEART's mask difference all
    // along — the fight soul is the spr_dodgeheart 20x20 rect (bbox
    // [0..19]) while the tester soul keeps the heart shape ([2..17]), and
    // all four fight rests (E 372 / W 250 / N 120 / S 242) plus the
    // tester's (E 374) re-derive from the SAME stored ring under each
    // room's true heart bbox. See HEART_RECT in sim/masks.js.
    e.mask = BATTLEBG_MASK;

    // THE ARENA IS GREEN, for the whole fight. `obj_growtangle`'s Create sets
    // `image_blend = merge_color(c_green, c_lime, 0.5)`, and its Draw uses it on
    // an UNDER-LAYER:
    //
    //     draw_sprite_ext(sprite_index, 1, ..., image_blend, image_alpha);
    //     ...
    //     draw_self();
    //
    // Frame 1 tinted green first, then the ordinary frame on top. So
    // spr_battlebg_0's two frames are not an animation at all — they are two
    // layers of one border, and the second one is the green glow. (This is the
    // sprite whose frame count was blamed for the board "flickering"; the real
    // cause was image_speed, but the two frames were never an animation either
    // way.)
    //
    // c_green is RGB(0,128,0) and c_lime is RGB(0,255,0) — GameMaker packs
    // colours BGR, so both have a zero red and blue channel.
    e.image_blend = mergeColor([0, 128, 0], [0, 255, 0], 0.5);
    e.keep = 0;
    e.megakeep = 0;
    // GML built-ins: creation position. The slash's box jitter re-bases off
    // these every frame (x = xstart + choose(...)), it does not accumulate.
    e.xstart = e.x;
    e.ystart = e.y;

    // THE GROW-IN. obj_growtangle Create starts the box at zero size and its
    // Step opens it over 15 frames while spinning half a turn — this is how
    // the arena arrives at the top of every attack, and it was never modelled,
    // so the box simply appeared at full size.
    // obj_growtangle Create: `image_speed = 0`. spr_battlebg_0 has TWO frames
    // and the engine's default image_speed is 1, so without this the box
    // alternated between them every frame — the battle board's edges visibly
    // flickering for the whole fight.
    e.image_speed = 0;
    e.image_index = 0;

    e.growcon = 1;
    e.timer = 0;
    e.maxtimer = 15;
    e.target_angle = 0;
    e.growscale = 2;
    e.image_xscale = 0;
    e.image_yscale = 0;
    e.image_angle = 180;
    e.image_alpha = 0.3;
  },

  /**
   * obj_growtangle Step's growth block. growcon 1 opens, 3 closes (ROARING's
   * ending uses 3), 2 is settled.
   *
   *   sizer       = timer / maxtimer
   *   image_scale = maxscale * sizer
   *   image_angle = 180 + 180 * sizer + target_angle
   *   image_alpha = 0.5 + sizer * 0.5
   *
   * THE WALLS FOLLOW THE DRAWING, because in the original there is only one
   * scale. An earlier version kept collision on a separate `xscale`/`yscale`
   * pair to avoid the grow-in's rotating fractional-scale collision, which
   * CLAUDE.md's T3 note flags as unreproduced by this engine's floor-sampling.
   * That trade was wrong: it let the drawn box and the wall disagree, and
   * ROARING — which expands the arena to 17x by tweening image_xscale — then
   * played out with the box off the edges of the screen and an INVISIBLE WALL
   * at the old size still penning the soul in, through a full-screen attack.
   *
   * The T3 caveat still stands for the 15 grow-in frames: collision there is
   * against a rotating, fractional-scale mask and is not oracle-verified. The
   * soul is centred and still for those frames, so nothing depends on it.
   */
  step(e, state) {
    // THE FIRST-STEP INIT — obj_growtangle's `if (!init)` block, and it is
    // where a custom-sized arena stops being the ring everyone measures.
    //
    //     if (visible && (maxxscale != 2 || maxyscale != 2)
    //         && sprite_index == spr_battlebg_0) {
    //         customBox = true;
    //         sprite_index = spr_battlebg_stretch_hitbox;   // THE MASK SWAPS
    //         if ((maxxscale % 2) != 0)
    //             maxxscale = round(maxxscale * 37.5) / 37.5;
    //         if ((maxyscale % 2) != 0)
    //             maxyscale = round(maxyscale * 37.5) / 37.5;
    //         ...bakes spr_custom_box for the visual...
    //     }
    //
    // TWO consequences, both measured in the whole-fight recording:
    //
    //  * THE SCALE IS QUANTISED to multiples of 1/37.5, so the 75px sprite
    //    lands on whole pixels: Stars' 2.25 x 1.75 becomes **2.24 x 1.76**
    //    (f32: 2.2400000095 / 1.7599999905, exactly the recorded values),
    //    and the sword tunnel's 3 becomes 2.9866666...  The sim's box was
    //    2.25 for the whole turn — every wall sat in a subtly wrong place.
    //
    //  * THE COLLISION MASK CHANGES SPRITE in the original
    //    (spr_battlebg_stretch_hitbox), but the EFFECTIVE interior under the
    //    heart-rect finding is [2..72] on every measured side — identical to
    //    spr_battlebg_0's stored ring, and TWO pixels thinner than the
    //    stretch sprite's stored [4..70]. Re-derivation of the Stars-box
    //    rests (E 381 / N 109 / S 214) with the fight soul's true 20x20
    //    rect: blocked columns start at source 73 and rows at source 1/73 —
    //    all [2..72]. So the stored ring ships for custom boxes too; only
    //    the CORNERS (square here, rounded in the stretch sprite's data)
    //    are unverified, and no measured rest touches a corner.
    if (!e.init) {
      e.init = true;
      if (e.visible !== false && (e.maxxscale !== 2 || e.maxyscale !== 2)) {
        e.customBox = true;
        // GML round() is HALF-TO-EVEN: the tunnel's 3 x 37.5 = 112.5 snaps
        // DOWN to 112 (2.98666...), where Math.round's half-up gave 113
        // (3.01333) — a whole grow-in ring size off, caught by the verify21h
        // box telemetry (xscale 1.3937777281 at t=7 vs the sim's 1.4062).
        if (e.maxxscale % 2 !== 0) e.maxxscale = gmlRound(e.maxxscale * 37.5) / 37.5;
        if (e.maxyscale % 2 !== 0) e.maxyscale = gmlRound(e.maxyscale * 37.5) / 37.5;
        e.mask = BATTLEBG_MASK;
      }
    }

    const growing =
      (e.timer < e.maxtimer && e.growcon === 1) || (e.timer > 0 && e.growcon === 3);
    if (!growing) return;

    if (e.growcon === 1) e.timer += 1;
    if (e.growcon === 3) e.timer -= 1;

    const sizer = e.timer / e.maxtimer;
    e.image_xscale = e.maxxscale * sizer;
    e.image_yscale = e.maxyscale * sizer;
    e.image_angle = 180 + 180 * sizer + e.target_angle;
    e.image_alpha = 0.5 + sizer * 0.5;

    // One afterimage of the box per growth frame. Its alpha is
    // `(1 - image_alpha) + 0.1` — the INVERSE of the box's own, so the echo is
    // strongest while the box is faint and has almost gone by the time it is
    // solid. Its scale is `sizer * growscale`, not the box's image_xscale, so
    // it stays square while the box takes its 2.25 x 1.75 shape. Both were
    // invented here before and read as a flicker.
    if (e.visible !== false) {
      const d = spawn(state, afterimage, { x: e.x, y: e.y });
      d.sprite_index = e.sprite_index ?? 'spr_battlebg_0';
      const sc = sizer * e.growscale;
      d.image_xscale = sc;
      d.image_yscale = sc;
      d.image_angle = e.image_angle;
      d.image_alpha = 1 - e.image_alpha + 0.1;
      d.image_speed = 0;
      d.depth = e.depth - 1;
    }

    if (e.timer >= e.maxtimer && e.growcon === 1) {
      e.growcon = 2;
      e.image_angle = e.target_angle; // snap off the 360 the ramp lands on
    }
    if (e.timer <= 0 && e.growcon === 3) e.growcon = 4;
  },

  // obj_growtangle End Step: while the box is MOVING (path_speed or speed
  // nonzero, or megakeep), the heart is clamped to the interior. Static box
  // (the T3 case) never runs this branch. Translated now, exercised never —
  // do not trust it until a moving-box attack gets an oracle diff.
  endStep(e, state) {
    if (e.keep === 1) {
      const heart = state.soul;
      if (heart && heart.alive) {
        if (e.path_speed !== 0 || e.speed !== 0 || e.megakeep === 1) {
          const lborder = e.x - (e.mask.w * e.image_xscale) / 2;
          const rborder = e.x + (e.mask.w * e.image_xscale) / 2;
          const uborder = e.y - (e.mask.h * e.image_yscale) / 2;
          const dborder = e.y + (e.mask.h * e.image_yscale) / 2;
          if (heart.x < lborder + 5) heart.x = lborder + 5;
          if (heart.x > rborder - 22) heart.x = rborder - 22;
          if (heart.y < uborder + 5) heart.y = uborder + 5;
          if (heart.y > dborder - 22) heart.y = dborder - 22;
        }
      }
    }
  },
};
