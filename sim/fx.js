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
import { scrLerpvar } from './lerpvar.js';
import { cue } from './audio.js';

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
 * obj_oflash — THE HIT GLOW, and the thing a Rude Buster on the Knight was
 * missing.
 *
 *     // obj_rudebuster_bolt, on impact
 *     scr_damage_enemy(star, damage);
 *     with (target) __of = scr_oflash();
 *     if (red == 1) with (target) __of.flashcolor = c_red;
 *
 * `scr_oflash` copies the target's sprite, index and scales onto a new
 * instance one depth in front, and obj_oflash's Draw redraws that copy FOGGED
 * — every pixel replaced by `flashcolor`, alpha kept — at `sin(siner / 3)`:
 *
 *     siner += flashspeed;                       // 1 a frame
 *     gpu_set_fog(true, flashcolor, 0, 1);
 *     draw_sprite_ext(..., sin(siner / 3));
 *     if (siner > 4 && sin(siner / 3) < 0) instance_destroy();
 *
 * So it is a PULSE, not a fade: up through 1 around siner 4.7 and gone by 9.4,
 * about ten frames of the Knight lit up in his own silhouette. `follow` is
 * false here, so it stays where the hit landed even if he moves.
 *
 * The Knight's own object-definition sprite is `spr_roaringknight_idle`
 * (confirmed with the object_sprite dump, the same technique CLAUDE.md
 * records for obj_basicattack), which is why copying `sprite_index` gives a
 * copy of him rather than something blank.
 */
export const oflash = {
  name: 'obj_oflash',

  create(e) {
    e.flashspeed = 1;
    e.siner = 0;
    e.target = null;
    e.image_speed = 0;
    e.flashcolor = [255, 255, 255];
    e.follow = false;
  },

  step(e) {
    if (e.target && e.target.alive) {
      e.image_index = e.target.image_index;
      e.sprite_index = e.target.sprite_index;
      if (e.follow) {
        e.x = e.target.x;
        e.y = e.target.y;
      }
    }
    e.siner += e.flashspeed;
    if (e.siner > 4 && Math.sin(e.siner / 3) < 0) destroy(e);
  },
};

/** `scr_oflash(follow)` — the copy, made from the caller. */
export function scrOflash(state, target, { follow = false, color = null } = {}) {
  const e = spawn(state, oflash, { x: target.x, y: target.y });
  e.image_xscale = target.image_xscale;
  e.image_yscale = target.image_yscale;
  e.image_speed = 0;
  e.image_index = target.image_index;
  e.sprite_index = target.sprite_index;
  e.depth = (target.depth ?? 0) - 1;
  e.target = target;
  e.follow = follow;
  if (color) e.flashcolor = color;
  return e;
}

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
 * `destroytime` exists in the original and is unused by the knight's callers.
 * `target` IS used — by the underbox's orbs, through
 * `scr_afterimage_grow_attached`, which is the same ghost pinned to the
 * spawner so it swells around a MOVING object instead of being left behind.
 */
export const afterimageGrow = {
  name: 'obj_afterimage_grow',

  create(e) {
    e.xrate = 0.2;
    e.yrate = 0.2;
    e.fade = 0.1;
    e.destroytime = -1;
    e.image_speed = 0;
    e.target = -4;
  },

  step(e) {
    // `if (target != -4 && i_ex(target))` — a dead target is simply not
    // followed; the ghost stays where it was and fades out on its own.
    if (e.target && e.target !== -4 && e.target.alive) {
      e.x = e.target.x;
      e.y = e.target.y;
    }
    e.image_alpha -= e.fade;
    e.image_xscale += e.xrate;
    e.image_yscale += e.yrate;
    if (e.image_alpha < 0) return destroy(e);
    if (e.destroytime > -1) e.destroytime -= 1;
    if (e.destroytime === 0) destroy(e);
  },
};

/** `scr_afterimage_grow()` — the same copy scr_afterimage makes, other type. */
export function scrAfterimageGrow(state, e) {
  const a = spawn(state, afterimageGrow, { x: e.x, y: e.y });
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

/**
 * `scr_afterimage_grow_attached(target, blend, behind)` — one of the above,
 * pinned to an instance and re-tinted. `behind == true` puts it one step in
 * front of the CALLER's depth (`other.depth - 1`), which is what the third
 * argument really controls; the underbox passes false.
 */
export function scrAfterimageGrowAttached(state, e, target, blend, behind) {
  const a = scrAfterimageGrow(state, e);
  a.target = target;
  a.image_blend = blend;
  if (behind === true) a.depth = (e.depth ?? 0) - 1;
  return a;
}

/**
 * obj_knight_warp — THE TELEPORT FLASH, and the only thing that hides and
 * restores the Knight when an attack takes him off the field.
 *
 *   event_user(0)  "warp IN":  master.image_alpha = 0, index 6 then a
 *                  5 -> 8 lerp over 4, and alarm[0] at 4 sets the master
 *                  BACK to alpha 1 before destroying itself
 *   event_user(1)  "warp OUT": master.image_alpha = 0, index 8 then an
 *                  8 -> 5 lerp over 4, alarm[1] destroys it and the master
 *                  STAYS hidden
 *
 * So the two directions are not symmetric: only the in-warp hands the Knight
 * his alpha back. An attack that warps him out is responsible for putting him
 * back itself — the underbox manager does it from its Destroy.
 *
 * It follows its master every Step (`x = master.x + master_xoffset`), has no
 * Draw event (so it is a plain draw_self at scr_darksize's 2x) and no mask.
 */
export const knightWarp = {
  name: 'obj_knight_warp',

  create(e, state) {
    e.master = null;
    e.master_xoffset = 0;
    e.master_yoffset = 0;
    e.image_xscale = 2;
    e.image_yscale = 2;
    e.image_speed = 0;
    e.sprite_index = 'spr_knight_warp'; // object definition
    e.image_index = 8;
    cue(state, 'snd_knight_teleport', 1, 1);
  },

  step(e) {
    if (e.master && e.master.alive) {
      e.x = e.master.x + e.master_xoffset;
      e.y = e.master.y + e.master_yoffset;
    }
  },

  alarm: {
    0(e) {
      if (e.master && e.master.alive) e.master.image_alpha = 1;
      destroy(e);
    },
    1(e) {
      destroy(e);
    },
  },
};

/** obj_knight_warp's event_user(0) — warp in, and give the master back. */
export function knightWarpIn(state, e) {
  if (e.master && e.master.alive) e.master.image_alpha = 0;
  e.image_index = 6;
  scrLerpvar(state, spawn, e, 'image_index', 5, 8, 4);
  e.alarm[0] = 4;
}

/** obj_knight_warp's event_user(1) — warp out; the master stays hidden. */
export function knightWarpOut(state, e) {
  if (e.master && e.master.alive) e.master.image_alpha = 0;
  e.image_index = 8;
  scrLerpvar(state, spawn, e, 'image_index', 8, 5, 4);
  e.alarm[1] = 4;
}

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

/**
 * obj_particle_generic — the plainest bullet-less mote in the game. Its Create
 * is three lines and its Step is the whole object:
 *
 *     image_alpha  = scr_approach(image_alpha, 0, fade_rate);
 *     image_xscale = scr_approach(image_xscale, 0, shrink_rate);
 *     image_yscale = scr_approach(image_yscale, 0, shrink_rate);
 *     ...destroy on any of them reaching 0, or on `timer` counting down to 0
 *
 * All three rates default to ZERO, so a particle created and left alone never
 * fades and never shrinks — `timer` is the only thing that can kill it, and
 * `timer = -1` means it lives forever. ROARING's in-rush streaks set `timer =
 * 18` and drive everything else with lerpvars instead of the rates, which is
 * why this object can be this empty and still do what it does there.
 */
export const particleGeneric = {
  name: 'obj_particle_generic',

  create(e) {
    e.fade_rate = e.fade_rate ?? 0;
    e.shrink_rate = e.shrink_rate ?? 0;
    e.timer = e.timer ?? -1;
    e.image_alpha = e.image_alpha ?? 1;
  },

  step(e) {
    e.image_alpha = scrApproach(e.image_alpha, 0, e.fade_rate);
    e.image_xscale = scrApproach(e.image_xscale, 0, e.shrink_rate);
    e.image_yscale = scrApproach(e.image_yscale, 0, e.shrink_rate);
    if (e.image_xscale === 0 || e.image_yscale === 0) { destroy(e); return; }
    if (e.image_alpha === 0) { destroy(e); return; }
    e.timer -= 1;
    if (e.timer === 0) destroy(e);
  },
};

/**
 * obj_afterimage_screen — A COPY OF THE WHOLE SCREEN, redrawn scaled about the
 * point it was created at:
 *
 *     // Create
 *     anchor_x = x - viewX;  anchor_y = y - viewY;
 *     xscale = 1; yscale = 1; alpha = 0.5;
 *     xrate = 0.01; yrate = 0.01; faderate = 0.00625;
 *     // Step
 *     xscale += xrate; yscale += yrate;
 *     alpha = scr_approach(alpha, 0, faderate);   // destroy at 0
 *     // Draw
 *     draw_surface_ext(copy, x - anchor_x * xscale, y - anchor_y * yscale,
 *                      xscale, yscale, 0, c_white, alpha);
 *
 * NEGATIVE RATES ARE THE POINT in ROARING's first use: `xrate = -0.01` makes
 * the copy shrink INWARD toward the vortex rather than blooming outward, which
 * is the difference between the screen being pulled in and the screen being
 * blown apart. The roar itself uses positive rates for exactly that contrast.
 *
 * `draw_end` makes the object's own Draw exit — those copies are composited by
 * whoever owns the effect instead, in its own layer order.
 */
export const afterimageScreen = {
  name: 'obj_afterimage_screen',

  create(e, state) {
    e.anchor_x = e.x - (state.view?.x ?? 0);
    e.anchor_y = e.y - (state.view?.y ?? 0);
    e.xscale = 1;
    e.yscale = 1;
    e.alpha = 0.5;
    e.xrate = e.xrate ?? 0.01;
    e.yrate = e.yrate ?? 0.01;
    e.faderate = e.faderate ?? 0.00625;
    e.draw_end = e.draw_end ?? false;
  },

  step(e) {
    e.xscale += e.xrate;
    e.yscale += e.yrate;
    e.alpha = scrApproach(e.alpha, 0, e.faderate);
    if (e.alpha === 0) destroy(e);
  },
};
