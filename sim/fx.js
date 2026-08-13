// Visual effects that are real instances in the original.
//
// These are cosmetic — nothing here has a mask, an Other_15, or any way to
// touch the soul — but they are modelled in sim/ rather than invented in the
// renderer, for two reasons. They move with GameMaker's own built-in motion
// (speed, direction, friction), which sim/ already reproduces exactly and the
// renderer has no business reimplementing; and they are spawned from a
// translated Step event, so putting them anywhere else would mean the renderer
// second-guessing when an attack fired.
//
// RNG NOTE: obj_afterimage debris draw from the shared stream in the original
// (roughly four calls each, 16 per cut). Spawning them here consumes those
// draws too, which is MORE faithful than skipping them — but it means a scene
// that wants stream fidelity alongside Flurry must expect them. The oracle
// scene replays recorded values and is unaffected.

import { spawn, destroy } from './entity.js';
import { scrApproach } from './gml.js';

/**
 * `scr_afterimage()` — a ghost of the caller, copying everything that affects
 * how it looks. The caller then overrides alpha/fade/motion as it likes.
 *
 *     afterimage = instance_create(x, y, obj_afterimage);
 *     afterimage.sprite_index = sprite_index;   image_index = image_index;
 *     afterimage.image_blend  = image_blend;    image_speed = 0;
 *     afterimage.depth = depth;
 *     afterimage.image_xscale/yscale/angle = ours
 */
export function scrAfterimage(state, e) {
  const a = spawn(state, afterimage, { x: e.x, y: e.y });
  a.sprite_index = e.sprite_index;
  a.image_index = e.image_index;
  a.image_blend = e.image_blend;
  a.image_speed = 0;
  a.depth = e.depth;
  a.image_xscale = e.image_xscale;
  a.image_yscale = e.image_yscale;
  a.image_angle = e.image_angle;
  return a;
}

/** obj_afterimage — a fading, decelerating streak. */
export const afterimage = {
  name: 'obj_afterimage',

  create(e) {
    e.fadeSpeed = 0.04;
    e.image_alpha = e.image_alpha ?? 1;
    e.builtinMotion = true;
    e.depth = -50;
  },

  step(e) {
    e.image_alpha -= e.fadeSpeed;
    if (e.image_alpha < 0) destroy(e);
  },
};

/**
 * SCREEN SHAKE LIVES IN sim/shake.js, not here.
 *
 * `addShake`/`stepShake` used to be a stand-in: a magnitude the renderer
 * turned into a ±offset that flipped sign every frame. Both the magnitude and
 * that alternation were invented, and the one thing calling it —
 * obj_roaringknight_splitslash — does not shake at all in the original.
 *
 * The real mechanism is obj_shake (sim/shake.js), which moves the CAMERA on a
 * measured 4, -4, 3, -2, 0 decay and is oracle-verified frame for frame.
 * Removed rather than left dormant, so nothing reaches for it again.
 */


/**
 * obj_knight_circle — the expanding ring at an aim point.
 *
 * Rotating slash drops one wherever it locks on, and ROARING fires one on the
 * roar itself. A gradient disc, black at the centre and `rgb(r,g,b)` at the
 * rim, drawn ADDITIVELY so it reads as light rather than paint.
 *
 * It lives 10 frames (`image_alpha -= 0.1`) while `circle_size` runs toward
 * 960 at 40 a frame, so what you see is a fast bloom that never reaches its
 * target size.
 *
 * ORIGINAL BUG preserved: the second destroy test is
 * `if (r == 0 && b == 0 && b == 0)` — `b` twice, `g` never. With the default
 * r of 128 it cannot fire at all, so the alpha countdown is what actually ends
 * the effect. Left as-is.
 */
export const knightCircle = {
  name: 'obj_knight_circle',

  create(e) {
    e.circle_size = 0;
    e.r = e.r ?? 128;
    e.g = e.g ?? 0;
    e.b = e.b ?? 0;
    e.r_goal = 0;
    e.g_goal = 0;
    e.b_goal = 0;
    e.fade_time = 28;
    e.size_goal = 960;
    e.growth = 40;
    e.color_1 = 0;
    e.draw_in_box = e.draw_in_box ?? true;
    e.image_alpha = 1;
    e.depth = -60;
  },

  step(e, state) {
    // `if (!i_ex(obj_knight_roaring_fx)) image_alpha -= 0.1` — the roar's own
    // effect object holds the circle open; nothing else does.
    const held = state.entities.some(
      (x) => x.alive && x.type.name === 'obj_knight_roaring_fx',
    );
    if (!held) e.image_alpha -= 0.1;
    if (e.image_alpha < 0) {
      destroy(e);
      return;
    }
    e.g = scrApproach(e.g, e.g_goal, 255 / e.fade_time);
    e.b = scrApproach(e.b, e.b_goal, 255 / e.fade_time);
    e.circle_size = scrApproach(e.circle_size, e.size_goal, e.growth);
  },
};

/**
 * obj_afterimage_grow — a ghost that SWELLS as it fades, rather than drifting.
 *
 *     image_alpha  -= fade      (0.1 by default)
 *     image_xscale += xrate     (0.2)
 *     image_yscale += yrate     (0.2)
 *
 * and it dies when the alpha goes negative. Nothing about it moves, so it reads
 * as a shockwave off whatever spawned it. `obj_tracking_sword1` fires one on
 * lock-on at fade 0.3 — a fast three-frame flare that says "this one is
 * committed"; obj_knight_roaring2 composites others into its vortex surface.
 *
 * `target` (follow an instance) and `destroytime` exist in the original and are
 * unused by the knight's callers.
 */
export const afterimageGrow = {
  name: 'obj_afterimage_grow',

  create(e) {
    e.xrate = 0.2;
    e.yrate = 0.2;
    e.fade = 0.1;
    e.destroytime = -1;
    e.image_speed = 0;
  },

  step(e) {
    e.image_alpha -= e.fade;
    e.image_xscale += e.xrate;
    e.image_yscale += e.yrate;
    if (e.image_alpha < 0) return destroy(e);
    if (e.destroytime > -1) e.destroytime -= 1;
    if (e.destroytime === 0) destroy(e);
  },
};

/**
 * obj_knight_split_growtangle_effect — THE CUT.
 *
 * Ten frames of impact when Flurry slices the arena, and it is the loudest
 * effect in the fight. Its Draw event does three things at once:
 *
 *   * the BOX's two halves are drawn peeling apart at 4, 6 and 8 times the
 *     timer along the cut normal, fading with `(10 - timer) / 10`
 *   * a SNAPSHOT OF THE WHOLE SCREEN, taken on the first frame, is drawn as two
 *     halves sliding apart by `timer * 8` — the picture itself is cut in half
 *   * two white bars along the cut line, `spr_pxwhite10_center` at scale 50 by
 *     `_fade` and `_fade * 1.4`, which is the flash
 *
 * Only `timer` and the geometry live here; the drawing is
 * render/draw/splitcut.js. It destroys itself at timer 10.
 */
export const splitGrowtangleEffect = {
  name: 'obj_knight_split_growtangle_effect',

  create(e) {
    e.timer = 0;
    e.vertical = false;
    e.angle = 0;
    e.diagonal = false;
    e.xoffset = 0;
    e.yoffset = 0;
    e.image_speed = 0;
  },

  /**
   * `timer++` is the FIRST thing the Draw event does and everything else reads
   * it, so this is an increment-before-use counter — endStep, per CLAUDE.md's
   * table. Ten frames, then gone.
   */
  endStep(e) {
    e.timer += 1;
    if (e.timer === 10) destroy(e);
  },
};

/**
 * `scr_marker(x, y, sprite)` — obj_marker, a bare sprite carrier that moves on
 * GameMaker's built-in speed/direction/gravity and nothing else.
 *
 * ROARING's finale uses two of them to carry the two halves of the CUT SCREEN.
 * The sprites are built at runtime with `sprite_create_from_surface`, so what
 * this entity carries is an index into the renderer's snapshot rather than a
 * named sprite — `piece` is 0 for the left half and 1 for the right.
 *
 * Both start at the position their origin was captured at, so the halves sit
 * exactly where the screen was before they begin to move.
 */
export const screenPiece = {
  name: 'obj_marker_screenpiece',

  create(e) {
    e.image_speed = 0;
    e.builtinMotion = true;
    e.piece = 0;
    e.gravityDelay = -1;
    e.depth = -10000;
  },

  step(e) {
    // `scr_script_delayed(scr_var, 12, "gravity", 1)` — gravity switches on 12
    // frames in, along `gravity_direction`, which is the SAME direction each
    // half is already travelling (180 and 0). So they decelerate to a near
    // stop as the lerp runs out and then accelerate away again.
    if (e.gravityDelay > 0) {
      e.gravityDelay -= 1;
      if (e.gravityDelay === 0) e.gravity = 1;
    }
  },
};
