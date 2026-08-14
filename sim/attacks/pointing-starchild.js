// obj_knight_pointing_starchild + obj_heart_follower — the shards each Star
// bursts into, and the lagging ghost of the soul that the homing ones chase.
//
// Spawned six at a time by obj_knight_pointing_star's con-3 burst (and by
// obj_knight_roaring_star, which is not translated). What they do depends
// entirely on the `difficulty` the star hands each one:
//
//   difficulty 0 / 1   `delay` stays 0, so `con` never leaves 0 and the child
//                      simply drifts, decelerating toward `minspeed`.
//   difficulty 2       children i=0 and i=3 get difficulty 2 and run the full
//                      con 1-4 homing; the other four get -1 and drift.
//
// I previously recorded in these docs that the homing was dead content. It is
// not — see docs/STATUS.md. The mistake was measuring one instance instead of
// counting across the recording: traces/stars3.csv has 28 children at
// difficulty 2 and 56 at -1.
//
// THE STAGGER. The "one at a time" of the fight comes from a counter that
// lives on the CONTROLLER, not on the child: each child adds the controller's
// running `delay` to its own and then advances it, so every child waits longer
// than the last.
//
//   delay = 25;
//   with (obj_dbulletcontroller) {
//       other.delay += delay;
//       if (subdelay == 4) { subdelay = 0; delay += 5; }
//       else               { subdelay++;   delay++;    }
//   }
//
// Measured delays across one turn: 25, 26, 27, 28, 29, 34, 35, ... 72.
//
// NOT translated (cosmetic): the con-1 colour ramp and yscale pulse, and con
// 3's obj_afterimage_blend trail.

import { spawn, destroy } from '../entity.js';
import {
  angleDifference,
  clamp,
  lengthdirX,
  lengthdirY,
  lerp,
  pointDirection,
  scrMovetowards,
  sign,
  mergeColor,
  WHITE,
  BLACK,
  RED,
} from '../gml.js';
import { scrBulletInit, collidebulletOther15 } from '../bullets/regularbullet.js';
import { starOther15 } from './pointing-star.js';
import { STARCHILD_MASK, STARCHILD_TRAIL_MASK, scrPreciseHit, enginePairHit } from '../masks.js';

/** scr_rotatetowards — step `from` toward `to` by at most `delta`. */
function scrRotatetowards(from, to, delta) {
  const diff = angleDifference(to, from);
  if (Math.abs(diff) > delta) return from + sign(diff) * delta;
  return to;
}

/** scr_angle_lerp — interpolate along the SHORTER arc. */
function scrAngleLerp(from, to, t) {
  return from + lerp(0, angleDifference(to, from), t);
}

/** scr_onscreen_tolerance(self, spacer). */
function onscreen(e, spacer, state) {
  const w = e.sprite_width ?? 0;
  const h = e.sprite_height ?? 0;
  if (e.x + w + spacer < state.view.x) return false;
  if (e.x - spacer > state.view.x + 640) return false;
  if (e.y + h + spacer < state.view.y) return false;
  if (e.y - spacer > state.view.y + 480) return false;
  return true;
}

/**
 * obj_heart_follower — a soft-following ghost of the soul, created by the
 * type-98 controller. The homing children aim at THIS, not at the soul, which
 * is what makes them lead rather than track exactly.
 */
export const heartFollower = {
  name: 'obj_heart_follower',

  create(e) {
    e.smoothing = 0.125;
    e.max_speed = 4;
  },

  step(e, state) {
    const t = state.soul;
    if (!t) return;
    const xdiff = t.x - e.x;
    const ydiff = t.y - e.y;
    e.x = scrMovetowards(e.x, t.x, clamp(Math.abs(xdiff) * e.smoothing, 1, e.max_speed));
    e.y = scrMovetowards(e.y, t.y, clamp(Math.abs(ydiff) * e.smoothing, 1, e.max_speed));
  },
};

export const pointingStarchild = {
  name: 'obj_knight_pointing_starchild',

  create(e, state) {
    scrBulletInit(e);
    e.deceleration = 0.1;
    e.minspeed = 1;
    e.timer = 0;
    e.drawtimer = 0;
    e.damage = 1;
    e.element = 5;
    e.lifetime = 60;
    e.difficulty = 0;
    e.con = 0;
    e.tracking = true;
    e.start_angle = 0;
    e.target_angle = 0;
    e.rotation = 0;
    e.delay = 0;
    e.init = false;
    e.rotatespeed = 10;
    e.ease = 0;
    e.xscale_start = 0;
    e.yscale_start = 0;
    // `outline = 0` is c_black, which adds nothing under bm_add — the overlay
    // is invisible until the Step's flip drives it toward red.
    e.outline = BLACK;
    e.image_blend = WHITE;
    e.accel = 0.5;
    e.sprite_index = 'spr_knight_starchild_parts';
    e.isBullet = true;
    e.builtinMotion = true;
  },

  step(e, state) {
    if (!e.init) {
      e.init = true;
      if (e.difficulty >= 2) {
        e.delay = 25;
        // The controller's running counter — see the header. Held on `state`
        // because these scenes model the controller only as this pair of
        // fields; a scene with several controllers would need them per
        // instance.
        e.delay += state.childDelay ?? 0;
        if ((state.childSubdelay ?? 0) === 4) {
          state.childSubdelay = 0;
          state.childDelay = (state.childDelay ?? 0) + 5;
        } else {
          state.childSubdelay = (state.childSubdelay ?? 0) + 1;
          state.childDelay = (state.childDelay ?? 0) + 1;
        }
      }
    }

    const follower = state.entities.find(
      (x) => x.alive && x.type.name === 'obj_heart_follower',
    );

    // `con <= 2 && con <= 3` in the original — the second test is redundant.
    if (e.con <= 2) {
      if (e.speed > e.minspeed) {
        e.speed = scrMovetowards(e.speed, e.minspeed, e.deceleration);
      }
      if (e.con === 0 && e.delay > 0) {
        e.timer += 1;
        if (e.timer >= e.delay) {
          // A child that has drifted off screen by the time its turn comes
          // never gets to home.
          if (!onscreen(e, 10, state)) {
            destroy(e);
            return;
          }
          e.timer = 0;
          e.con = 1;
        }
      }
    }

    if (e.con >= 1 && e.con <= 3) {
      if (follower) {
        e.target_angle = pointDirection(e.x, e.y, follower.x + 10, follower.y + 10);
      }
      if (e.con >= 2 && e.tracking) {
        const difference = angleDifference(e.target_angle, e.direction);
        if (Math.abs(difference) < 90) {
          if (e.con < 3) {
            e.direction = scrRotatetowards(e.direction, e.target_angle, 2);
            e.image_angle = e.direction;
          } else if (Math.abs(difference) <= 4) {
            e.rotation = 0;
          } else if (Math.abs(difference) > 30) {
            e.rotation = sign(difference) * 2;
          } else {
            e.rotation = sign(difference);
          }
        } else if (e.con >= 3) {
          // Once the soul is behind it, it gives up and keeps turning the way
          // it was already turning.
          e.tracking = false;
          e.rotation = sign(e.rotation);
        }
      } else {
        e.direction += e.rotation;
        e.image_angle += e.rotation;
      }
    }

    if (e.con === 1) {
      e.image_angle = scrAngleLerp(e.direction, e.target_angle, e.timer / 10);
      e.timer += 1;
      if (e.timer >= 10) {
        e.timer = 0;
        e.con = 2;
        e.direction = e.image_angle;
        e.tracking = true;
      }
      if (e.xscale_start === 0) e.xscale_start = e.image_xscale;
      if (e.yscale_start === 0) e.yscale_start = e.image_yscale;
      const flip = Math.cos((e.timer / 5) * Math.PI);
      e.image_yscale = e.yscale_start * flip;
      // THE FLIP'S COLOUR, on the same cosine as the squash. Visual only, but
      // it belongs in the Step because that is where the original computes it —
      // the Draw event only reads these two. `merge_color` extrapolates past
      // its endpoints for a negative amount and GameMaker clamps the result to
      // a byte, so clamping the parameter is equivalent.
      e.image_blend = mergeColor(WHITE, BLACK, flip);
      e.outline = mergeColor(BLACK, RED, flip);
    }

    if (e.con === 2) {
      e.timer += 1;
      if (e.timer >= 10) {
        e.timer = 0;
        e.con = 3;
      }
    }

    // A backward drift that decays over 40 frames — the child slides away from
    // its target as it winds up, which is what makes the lunge read.
    if (e.con >= 1 && e.ease < 40) {
      const s = (1 - e.ease / 40) * 2;
      e.x -= lengthdirX(s, e.target_angle);
      e.y -= lengthdirY(s, e.target_angle);
      e.ease += 1;
    }

    if (e.con === 3) {
      e.speed = scrMovetowards(e.speed, 25, 0.5);
      e.image_xscale = e.xscale_start + e.speed / 60;
      e.image_yscale = e.yscale_start - e.speed / 90;
    }

    if (e.con === 4) {
      e.speed = 0;
      e.timer += 1;
      if (e.timer >= 4) destroy(e);
    }
  },

  /**
   * THE DRAW EVENT'S TAIL, which is not decoration — it is how the shards die
   * at difficulty 0 and 1.
   *
   *     drawtimer++;
   *     ...
   *     if (difficulty < 2) {
   *         image_alpha = clamp01(remap(lifetime - 15, lifetime, 1, 0, drawtimer));
   *         if (image_alpha < 1) active = false;
   *         if (image_alpha == 0) instance_destroy();
   *     }
   *
   * `lifetime` is 60, so a shard fades over its last 15 frames, stops dealing
   * damage the moment the fade starts, and removes itself at the end. Without
   * it the low-difficulty shards are immortal — they were, here, until this
   * Draw event was read.
   *
   * It runs in endStep because that is the phase that sits where Draw does:
   * after the Step, before the next frame. Difficulty 2 is excluded exactly as
   * the original excludes it — those shards are cleaned up by going offscreen.
   */
  endStep(e, state) {
    e.drawtimer += 1;
    if (e.difficulty >= 2 || e.con === 4) return;
    const fadeStart = e.lifetime - 15;
    e.image_alpha = clamp((e.lifetime - e.drawtimer) / (e.lifetime - fadeStart), 0, 1);
    if (e.image_alpha < 1) e.active = false;
    if (e.image_alpha === 0) destroy(e);
  },

  /**
   * `scr_precise_hit(_hitbox)`, and the SIZE depends on which attack is
   * running — the shards are much more forgiving to be hit by during Stars
   * than during Roaring:
   *
   *     roaring2 alive  ->  2   (and 0 for the shrunken soul sprite)
   *     otherwise       ->  5   (and 1 for it)
   *
   * A 5px probe against a 2px one is a real difficulty difference, not a
   * rounding detail. Falling through to the default sprite-mask overlap — as
   * this did — is stricter than either and dropped hits the game registers.
   */
  collides(e, heart, state) {
    if (e.active !== 1 && e.active !== true) return false;
    const roaring = state.entities.some(
      (x) => x.alive && x.type.name === 'obj_knight_roaring2',
    );
    const n = roaring ? 2 : 5;
    const mask =
      e.sprite_index === 'spr_knight_starchild_trail'
        ? STARCHILD_TRAIL_MASK
        : STARCHILD_MASK;
    // Engine pair test first, then the Other_15 probe — see enginePairHit.
    // Measured at whole-fight f295/296: the probe alone connected a frame
    // before the recording's hit.
    if (!enginePairHit(heart, e, mask)) return false;
    return scrPreciseHit(heart, e, mask, n);
  },

  // The SAME 75-damage party-wide hit as its parent — obj_knight_pointing_
  // starchild's Other_15 is `target = 3; damage = 75; scr_damage_all()`.
  // The children were doing 1 to one character.
  other15: starOther15,
};
