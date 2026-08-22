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
import { collidebulletOther15, regularbulletStep, regularbulletCreate } from '../bullets/regularbullet.js';
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

// spr_knight_starchild_parts, the sprite every shard wears (Create).
// GML's sprite_width/sprite_height are the FULL sprite dimensions times the
// SIGNED image scales — not the bbox, and not origin-adjusted, so
// scr_onscreen_tolerance's `x + sprite_width` treats a centre-origin sprite
// as if its origin were top-left. Faithful: the game's own sloppiness is the
// margin. Reading these as 0 killed a homer whose delay expired at
// y = -10.78: the game sees y + 32*0.73 + 10 = 22.6 (onscreen, turns home,
// verify21j f6496 b10); a zero footprint reads -0.78 and destroys it.
const STARCHILD_SPRITE_W = 33;
const STARCHILD_SPRITE_H = 32;

/** scr_onscreen_tolerance(self, spacer). */
function onscreen(e, spacer, state) {
  const w = STARCHILD_SPRITE_W * (e.image_xscale ?? 1);
  const h = STARCHILD_SPRITE_H * (e.image_yscale ?? 1);
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

  // AFTER THE SHARDS. The runner steps newest-first: the shards (born at
  // the burst) run before the launch-born follower, so their homing reads
  // the follower's PREVIOUS-frame position — live reads in the sim's
  // spawn order handed them the current one. Stepping the follower after
  // every order-0 entity makes the shards' live read exactly that stale
  // value. And the follower itself is newer than the turn's soul, so IT
  // reads the soul pre-step — state.soulPrev, the frame-start snapshot.
  // Both lags are invisible while the soul is parked (turn 1's squeeze,
  // turn 6), and ~1.5px on a moving soul: verify21j f4314's shard turned
  // toward a target 0.86 degrees off, drifting b0_y from f4313.
  stepOrder: 0.5,

  create(e) {
    e.smoothing = 0.125;
    e.max_speed = 4;
  },

  step(e, state) {
    const t = state.soulPrev ?? state.soul;
    if (!t) return;
    const xdiff = t.x - e.x;
    const ydiff = t.y - e.y;
    e.x = scrMovetowards(e.x, t.x, clamp(Math.abs(xdiff) * e.smoothing, 1, e.max_speed));
    e.y = scrMovetowards(e.y, t.y, clamp(Math.abs(ydiff) * e.smoothing, 1, e.max_speed));
  },
};

/**
 * The d2+ shard's homing delay — 25 plus the controller's running counter,
 * which advances +1 per shard with a +5 skip every fifth (measured delays
 * 25, 26, 27, 28, 29, 34, ... 72). The counter lives on `state` because
 * these scenes model the controller as this pair of fields.
 *
 * ASSIGNED IN INIT ORDER. verify21n's shard ledger shows the game handing
 * the chain out in plain creation order for turn 11's cohort (the sim's
 * spawn-order assignment matches it shard-for-shard); a within-burst
 * reversal was tried against that hypothesis and regressed a verified
 * receipt. The --shards replay overrides the value per shard anyway, so
 * any turn where the slot order does scramble the hand-out is covered by
 * the recording rather than a model.
 */
export function chainChildDelay(e, state) {
  e.delay = 25;
  e.delay += state.childDelay ?? 0;
  if ((state.childSubdelay ?? 0) === 4) {
    state.childSubdelay = 0;
    state.childDelay = (state.childDelay ?? 0) + 5;
  } else {
    state.childSubdelay = (state.childSubdelay ?? 0) + 1;
    state.childDelay = (state.childDelay ?? 0) + 1;
  }
}

export const pointingStarchild = {
  name: 'obj_knight_pointing_starchild',

  create(e, state) {
    // `event_inherited()` — the FIRST line of the original's Create. The
    // parent (obj_regularbullet) Create runs scr_bullet_init AND sets the
    // step-cull's fields: `wall_destroy = 1` is what lets the inherited
    // step remove a homer that flies off past view -80 (verify21n's cull
    // ledger). The sim called only scrBulletInit here, so wall_destroy was
    // undefined and the cull never armed.
    regularbulletCreate(e, state);
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
        // The chain always advances — the game's did too — but a replayed
        // delay (matched by frame + position, tools/fullfight-trace.mjs
        // --shards) overrides the value: the chain's hand-out order follows
        // the runner's instance-slot state, which only the recording knows.
        chainChildDelay(e, state);
        const rows = state.shardDelays?.get(state.frame);
        const match = rows?.find((r) => !r.used
          && Math.abs(r.x - e.x) <= 0.1 && Math.abs(r.y - e.y) <= 0.1);
        if (match) {
          match.used = true;
          e.delay = match.delay;
        }
      }
      if (globalThis.process?.env?.KNIGHT_SHARD_DEBUG) {
        console.error(`[shard] init f=${globalThis.__simFrame} seq=${e.seq}`
          + ` diff=${e.difficulty} delay=${e.delay} y=${e.y.toFixed(1)}`);
      }
    }

    // `event_inherited()` — the FIRST line after the init in the original.
    // The parent (obj_regularbullet) runs the wall_destroy cull: any shard
    // past view -80 / +760 / -80 / +580 is destroyed. The homers that miss
    // the soul and fly off are exactly what it removes — verify21n's cull
    // ledger shows the game's leaving at x/y just past -80 from f4372 on,
    // while the sim's flew forever and held the bullet count one high.
    if (globalThis.process?.env?.KNIGHT_SHARD_DEBUG
        && (e.x < state.view.x - 70 || e.y < state.view.y - 70)) {
      console.error(`[shard] edge f=${globalThis.__simFrame} seq=${e.seq}`
        + ` x=${e.x.toFixed(1)} y=${e.y.toFixed(1)} wd=${e.wall_destroy}`
        + ` view=${state.view?.x},${state.view?.y}`);
    }
    regularbulletStep(e, state);
    if (!e.alive) return;

    // `if (!i_ex(obj_knight_roaring2))` WRAPS THE ENTIRE REST OF THE STEP —
    // measured on the dump's brace balance: chars 446-3756 of 3758. While
    // the roar lives, a starchild is an inert ballistic bullet: no
    // deceleration, no delay clock, no homing, no cons — just the parent
    // cull and its own friction. The recording's burst children accelerate
    // 1.1, 1.2, 1.3, 1.4 in a clean line (oracle_roarchild.csv) while the
    // ungated sim ran the minspeed deceleration once and froze them at 1.1
    // (verify21j f11809, b15 0.1px short and compounding).
    if (state.entities.some((x) => x.alive && x.type.name === 'obj_knight_roaring2')) {
      return;
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
          if (globalThis.process?.env?.KNIGHT_SHARD_DEBUG) {
            console.error(`[shard] check f=${globalThis.__simFrame} seq=${e.seq}`
              + ` delay=${e.delay} y=${e.y.toFixed(1)} on=${onscreen(e, 10, state)}`);
          }
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
